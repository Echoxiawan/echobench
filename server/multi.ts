import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppiumClient } from '../electron/appium-client.js';
import { resolveAdbExecutable } from './adb.js';
import { detectIosPlatformVersion } from './devices.js';
import type { SigningSelection } from './ios-signing.js';
import { logger } from './logger.js';
import type { VideoStreamManager } from './video-stream.js';
import type {
  KeyName,
  MultiAction,
  MultiActionResult,
  MultiDeviceSelection,
  MultiDeviceStatus,
  MultiSessionStatus,
  Platform,
  SessionConfig,
} from '../src/types.js';

const execFileAsync = promisify(execFile);
const MAX_DEVICES = 8;
const ANDROID_KEY_CODES: Record<KeyName, string> = { backspace: '67', enter: '66', tab: '61', escape: '111', delete: '112', left: '21', up: '19', right: '22', down: '20' };
const IOS_KEY_CODES: Partial<Record<KeyName, string>> = { backspace: '\uE003', enter: '\uE007', delete: '\uE017' };

interface MultiDeps {
  ensureAppium: () => Promise<void>;
  detectSigning: (deviceId: string, bundleId?: string) => Promise<SigningSelection | null>;
  video: VideoStreamManager;
}

interface MultiDevice {
  info: MultiDeviceSelection;
  platform: Platform;
  client?: AppiumClient;
  width: number;
  height: number;
  state: MultiDeviceStatus['state'];
  online: boolean;
  foregroundApp?: string;
  sync: boolean;
  live: boolean;
  error?: string;
  lastSeen: number;
  lastAction?: MultiDeviceStatus['lastAction'];
  mjpegPort?: number;
  stayOnBackup?: string;
  lastInfoAt: number;
}

export class MultiDeviceManager {
  private devices = new Map<string, MultiDevice>();
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private startedAt: number | undefined;
  private queues = new Map<string, Promise<void>>();
  private queueDepth = new Map<string, number>();

  constructor(private readonly deps: MultiDeps) {}

  async start(selections: MultiDeviceSelection[], bundleId?: string): Promise<MultiSessionStatus> {
    await this.stop();
    if (selections.length === 0) throw new Error('请至少选择一台设备');
    if (selections.length > MAX_DEVICES) throw new Error(`多端同步最多支持 ${MAX_DEVICES} 台设备`);
    const unique = new Map<string, MultiDeviceSelection>();
    for (const item of selections) unique.set(item.deviceId, item);
    const list = [...unique.values()];
    for (const item of list) {
      if (item.platform === 'ios' && process.platform !== 'darwin') throw new Error('当前操作系统不支持 iOS 自动化，仅 macOS 支持');
      this.devices.set(item.deviceId, {
        info: item,
        platform: item.platform,
        width: 0,
        height: 0,
        state: 'connecting',
        online: false,
        sync: true,
        live: true,
        lastSeen: Date.now(),
        lastInfoAt: 0,
      });
    }
    this.startedAt = Date.now();
    if (list.some((item) => item.platform === 'ios')) await this.deps.ensureAppium();
    const usedPorts = new Set<number>();
    let iosIndex = 0;
    for (const item of list) {
      const device = this.devices.get(item.deviceId)!;
      try {
        if (item.platform === 'android') {
          await this.connectAndroid(device);
        } else {
          await this.connectIos(device, bundleId, usedPorts, iosIndex++);
        }
      } catch (cause) {
        device.state = 'error';
        device.online = false;
        device.error = message(cause);
        logger.warn('multi', `设备连接失败：${item.name}`, { deviceId: item.deviceId, message: device.error });
      }
    }
    this.startHeartbeat();
    return this.status();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const devices = [...this.devices.values()];
    this.devices.clear();
    this.startedAt = undefined;
    this.queues.clear();
    this.queueDepth.clear();
    await Promise.allSettled(devices.map(async (device) => {
      if (device.client) await device.client.closeSession().catch(() => undefined);
      if (device.platform === 'android') {
        await this.deps.video.stopAndroid(device.info.deviceId).catch(() => undefined);
        await this.restoreAndroid(device).catch(() => undefined);
      }
    }));
  }

  status(): MultiSessionStatus {
    const devices = [...this.devices.values()].map((device) => this.toStatus(device));
    return {
      active: this.devices.size > 0,
      startedAt: this.startedAt,
      devices,
      mixedPlatform: new Set(devices.map((device) => device.platform)).size > 1,
    };
  }

  setDevice(deviceId: string, patch: { live?: boolean; sync?: boolean }): MultiDeviceStatus[] {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('设备不在多端同步会话中');
    if (typeof patch.live === 'boolean') device.live = patch.live;
    if (typeof patch.sync === 'boolean') device.sync = patch.sync;
    if (patch.live === false && device.platform === 'android') void this.deps.video.stopAndroid(deviceId).catch(() => undefined);
    return this.status().devices;
  }

  async streamVideo(deviceId: string, response: import('node:http').ServerResponse): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('设备不在多端同步会话中');
    if (device.platform === 'android') {
      await this.deps.video.streamAndroid(deviceId, response, { bitRate: 2_000_000, maxSize: 960, maxFps: 15 });
      return;
    }
    if (!device.mjpegPort) throw new Error('该设备没有可用的 MJPEG 端口');
    this.deps.video.streamIos(response, device.mjpegPort);
  }

  async screenshot(deviceId: string): Promise<string> {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('设备不在多端同步会话中');
    if (!device.online) throw new Error('设备当前离线');
    if (device.platform === 'android') return adbScreenshot(deviceId);
    if (!device.client) throw new Error('iOS 会话不存在');
    return device.client.screenshot();
  }

  async action(action: MultiAction): Promise<MultiActionResult[]> {
    const targets = [...this.devices.values()].filter((device) => device.sync && device.online && device.state === 'ready');
    if (targets.length === 0) throw new Error('没有参与同步且在线的设备');
    validateMultiAction(action);
    return Promise.all(targets.map(async (device) => {
      const started = Date.now();
      try {
        await this.enqueue(device.info.deviceId, () => this.execute(device, action));
        const result = { deviceId: device.info.deviceId, ok: true, duration: Date.now() - started };
        device.lastAction = { action: action.action, ...result, at: Date.now() };
        device.lastSeen = Date.now();
        return result;
      } catch (cause) {
        const result = { deviceId: device.info.deviceId, ok: false, duration: Date.now() - started, message: message(cause) };
        device.lastAction = { action: action.action, ...result, at: Date.now() };
        return result;
      }
    }));
  }

  private async connectAndroid(device: MultiDevice): Promise<void> {
    const deviceId = device.info.deviceId;
    const state = await adb(deviceId, ['get-state']).then((result) => result.stdout.trim()).catch(() => '');
    if (state !== 'device') throw new Error('ADB 设备不在线');
    const info = await androidScreenInfo(deviceId);
    device.width = info.width;
    device.height = info.height;
    await prepareAndroid(device);
    device.foregroundApp = await currentAndroidApp(deviceId);
    device.online = true;
    device.state = 'ready';
    device.error = undefined;
    device.lastSeen = Date.now();
    device.lastInfoAt = Date.now();
  }

  private async connectIos(device: MultiDevice, bundleId: string | undefined, usedPorts: Set<number>, index: number): Promise<void> {
    const deviceId = device.info.deviceId;
    const signing = await this.deps.detectSigning(deviceId, bundleId);
    if (!signing) throw new Error('没有找到可用的 iOS 签名团队');
    const platformVersion = await detectIosPlatformVersion(deviceId);
    const wdaLocalPort = await freePort(18100 + index * 10, usedPorts);
    const mjpegServerPort = await freePort(19100 + index * 10, usedPorts);
    const derivedDataPath = join(homedir(), '.echobench', 'multi-wda', safeName(deviceId));
    await mkdir(derivedDataPath, { recursive: true });
    const config: SessionConfig = {
      platform: 'ios',
      deviceId,
      platformVersion,
      bundleId,
      xcodeOrgId: signing.teamId,
      xcodeSigningId: signing.signingId,
      wdaBundleId: signing.wdaBundleId,
      allowProvisioning: true,
      multiDevice: true,
      wdaLocalPort,
      mjpegServerPort,
      derivedDataPath,
    };
    const client = new AppiumClient();
    try {
      const session = await client.createSession(config);
      device.client = client;
      device.mjpegPort = mjpegServerPort;
      device.width = session.width;
      device.height = session.height;
      device.online = true;
      device.state = 'ready';
      device.error = undefined;
      device.lastSeen = Date.now();
      device.lastInfoAt = Date.now();
      device.foregroundApp = await client.currentApp().catch(() => undefined) ?? undefined;
    } catch (cause) {
      await client.closeSession().catch(() => undefined);
      throw cause;
    }
  }

  private startHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), 2500);
    this.timer.unref();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await Promise.all([...this.devices.values()].map(async (device) => {
        if (device.platform === 'android') {
          const state = await adb(device.info.deviceId, ['get-state'], 4000).then((result) => result.stdout.trim()).catch(() => '');
          if (state !== 'device') {
            device.online = false;
            device.state = 'offline';
            return;
          }
          if (!device.online) {
            device.online = true;
            device.state = 'ready';
            device.error = undefined;
          }
          if (Date.now() - device.lastInfoAt > 5000) {
            device.lastInfoAt = Date.now();
            const info = await androidScreenInfo(device.info.deviceId).catch(() => null);
            if (info) { device.width = info.width; device.height = info.height; }
            device.foregroundApp = await currentAndroidApp(device.info.deviceId);
          }
          device.lastSeen = Date.now();
          return;
        }
        if (!device.client) return;
        const healthy = await device.client.healthCheck();
        if (!healthy) {
          device.online = false;
          device.state = 'offline';
          device.error = 'Appium 会话已断开';
          return;
        }
        if (!device.online) {
          device.online = true;
          device.state = 'ready';
          device.error = undefined;
        }
        if (Date.now() - device.lastInfoAt > 5000) {
          device.lastInfoAt = Date.now();
          device.foregroundApp = await device.client.currentApp().catch(() => null) ?? undefined;
        }
        device.lastSeen = Date.now();
      }));
    } finally {
      this.refreshing = false;
    }
  }

  private async execute(device: MultiDevice, action: MultiAction): Promise<void> {
    if (!device.online) throw new Error('设备当前离线');
    if (device.platform === 'android') {
      await this.executeAndroid(device, action);
    } else {
      await this.executeIos(device, action);
    }
  }

  private async executeAndroid(device: MultiDevice, action: MultiAction): Promise<void> {
    const deviceId = device.info.deviceId;
    if (action.action === 'tap') {
      await adb(deviceId, ['shell', 'input', 'tap', String(pointForRatio(device.width, action.xRatio)), String(pointForRatio(device.height, action.yRatio))]);
      return;
    }
    if (action.action === 'swipe') {
      await adb(deviceId, ['shell', 'input', 'swipe',
        String(pointForRatio(device.width, action.startXRatio)), String(pointForRatio(device.height, action.startYRatio)),
        String(pointForRatio(device.width, action.endXRatio)), String(pointForRatio(device.height, action.endYRatio)),
        String(Math.round(action.duration)),
      ]);
      return;
    }
    if (action.action === 'back') {
      await adb(deviceId, ['shell', 'input', 'keyevent', '4']);
      return;
    }
    if (action.action === 'key') {
      await adb(deviceId, ['shell', 'input', 'keyevent', ANDROID_KEY_CODES[action.key]]);
      return;
    }
    if (/[^\x20-\x7E]/.test(action.text)) throw new Error('Android ADB 不支持直接输入非 ASCII 文本');
    if (!action.text) return;
    await adb(deviceId, ['shell', 'input', 'text', `'${action.text.replaceAll("'", "'\\''")}'`]);
  }

  private async executeIos(device: MultiDevice, action: MultiAction): Promise<void> {
    const client = device.client;
    if (!client) throw new Error('iOS 会话不存在');
    if (action.action === 'tap') {
      await client.tapPoint(pointForRatio(device.width, action.xRatio), pointForRatio(device.height, action.yRatio));
      return;
    }
    if (action.action === 'swipe') {
      await client.swipe('up', action.duration,
        { x: pointForRatio(device.width, action.startXRatio), y: pointForRatio(device.height, action.startYRatio) },
        { x: pointForRatio(device.width, action.endXRatio), y: pointForRatio(device.height, action.endYRatio) });
      return;
    }
    if (action.action === 'back') {
      await client.back();
      return;
    }
    if (action.action === 'key') {
      const code = IOS_KEY_CODES[action.key];
      if (!code) throw new Error(`iOS 暂不支持按键 ${action.key}`);
      await client.typeText(code);
      return;
    }
    if (!action.text) return;
    const typed = await client.typeText(action.text);
    if (!typed) throw new Error('当前没有聚焦的输入框');
  }

  private enqueue(deviceId: string, task: () => Promise<void>): Promise<void> {
    const depth = this.queueDepth.get(deviceId) ?? 0;
    if (depth >= 50) return Promise.reject(new Error('该设备的操作队列已满'));
    this.queueDepth.set(deviceId, depth + 1);
    const previous = this.queues.get(deviceId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const stored = next.finally(() => {
      const current = (this.queueDepth.get(deviceId) ?? 1) - 1;
      if (current <= 0) this.queueDepth.delete(deviceId); else this.queueDepth.set(deviceId, current);
      if (this.queues.get(deviceId) === stored) this.queues.delete(deviceId);
    });
    this.queues.set(deviceId, stored);
    return next;
  }

  private toStatus(device: MultiDevice): MultiDeviceStatus {
    return {
      deviceId: device.info.deviceId,
      name: device.info.name,
      platform: device.platform,
      state: device.state,
      online: device.online,
      width: device.width,
      height: device.height,
      foregroundApp: device.foregroundApp,
      sync: device.sync,
      live: device.live,
      lastSeen: device.lastSeen,
      error: device.error,
      lastAction: device.lastAction,
    };
  }

  private async restoreAndroid(device: MultiDevice): Promise<void> {
    if (!device.stayOnBackup) return;
    await adb(device.info.deviceId, ['shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', device.stayOnBackup], 5000).catch(() => undefined);
    device.stayOnBackup = undefined;
  }
}

async function prepareAndroid(device: MultiDevice): Promise<void> {
  const deviceId = device.info.deviceId;
  await adb(deviceId, ['shell', 'input', 'keyevent', '224'], 5000).catch(() => undefined);
  await adb(deviceId, ['shell', 'wm', 'dismiss-keyguard'], 5000).catch(() => undefined);
  try {
    const value = (await adb(deviceId, ['shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'], 5000)).stdout.trim();
    if (/^\d+$/.test(value)) device.stayOnBackup = value;
  } catch { /* 部分设备不允许读取。 */ }
  await adb(deviceId, ['shell', 'svc', 'power', 'stayon', 'true'], 5000).catch(() => undefined);
}

async function androidScreenInfo(deviceId: string): Promise<{ width: number; height: number }> {
  const size = await adb(deviceId, ['shell', 'wm', 'size'], 5000);
  const match = [...size.stdout.matchAll(/(\d+)x(\d+)/g)].at(-1);
  if (!match) throw new Error('无法读取 Android 屏幕尺寸');
  let width = Number(match[1]);
  let height = Number(match[2]);
  const orientation = await adb(deviceId, ['shell', 'dumpsys', 'input'], 5000)
    .then((result) => result.stdout.match(/SurfaceOrientation:\s*(\d)/)?.[1])
    .catch(() => undefined);
  if (orientation === '1' || orientation === '3') [width, height] = [height, width];
  return { width, height };
}

async function currentAndroidApp(deviceId: string): Promise<string | undefined> {
  try {
    const { stdout } = await adb(deviceId, ['shell', 'dumpsys', 'window'], 5000);
    const match = stdout.match(/mCurrentFocus=Window\{[^}]*?\s([A-Za-z0-9_.]+)\//)
      ?? stdout.match(/mFocusedApp=ActivityRecord\{[^}]*?\s([A-Za-z0-9_.]+)\//);
    return match?.[1];
  } catch { return undefined; }
}

async function adb(deviceId: string, args: string[], timeout = 15_000): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(resolveAdbExecutable(), ['-s', deviceId, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 });
  return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

function adbScreenshot(deviceId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(resolveAdbExecutable(), ['-s', deviceId, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 25 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(Buffer.from(stdout).toString('base64'));
    });
  });
}

async function freePort(preferred: number, used: Set<number>): Promise<number> {
  for (let port = preferred; port < preferred + 500; port++) {
    if (used.has(port)) continue;
    if (!(await portAvailable(port))) continue;
    used.add(port);
    return port;
  }
  throw new Error('没有可用的本机端口');
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export function pointForRatio(size: number, ratio: number): number {
  return Math.max(0, Math.min(size - 1, Math.round(size * ratio)));
}

export function validateMultiAction(action: MultiAction): void {
  if (action.action === 'tap') {
    if (!ratio(action.xRatio) || !ratio(action.yRatio)) throw new Error('点击坐标超出范围');
    return;
  }
  if (action.action === 'swipe') {
    if (!ratio(action.startXRatio) || !ratio(action.startYRatio) || !ratio(action.endXRatio) || !ratio(action.endYRatio)) throw new Error('滑动坐标超出范围');
    if (!Number.isFinite(action.duration) || action.duration < 100 || action.duration > 5000) throw new Error('滑动时长必须在 100–5000ms 之间');
    return;
  }
  if (action.action === 'key' && !(action.key in ANDROID_KEY_CODES)) throw new Error('不支持的按键');
  if (action.action === 'text' && action.text.length > 5000) throw new Error('输入文本过长');
}

function ratio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
