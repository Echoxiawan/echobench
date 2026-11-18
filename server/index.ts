import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { delimiter, extname, join, normalize } from 'node:path';
import { homedir } from 'node:os';
import { AppiumClient } from '../electron/appium-client.js';
import { configureAdbEnvironment, configureAdbServerPort, resolveAdbExecutable } from './adb.js';
import { repairAppiumCache } from './appium-cache.js';
import { analyzeElement, applyLiveMatches, isOccurrenceLocator, isScopedLocator, rectWithin, type LiveCandidateMatch } from '../electron/locator.js';
import { generateAiCase, testAiConnection } from './ai.js';
import { flattenElementTree } from './inspector.js';
import { generateJava } from '../electron/export-java.js';
import { generatePython } from '../electron/export-python.js';
import { runReplay, type ReplayAdapter } from '../electron/replay.js';
import { generateJavaScript, parseScript, stringifyExportScript, validateScript } from '../electron/script.js';
import { runDoctor } from './doctor.js';
import { applySimulatorStates, detectIosPlatformVersion, parseAdbDevices, parseSimctlStates, parseXctraceDevices } from './devices.js';
import { detectIosSigning } from './ios-signing.js';
import { formatLogEntry, logger } from './logger.js';
import { MultiDeviceManager } from './multi.js';
import { autoInstallDrivers, runInstall } from './setup.js';
import { getSystemInfo } from './system.js';
import { VideoStreamManager } from './video-stream.js';
import type { AttachSessionRequest, Device, KeyName, Locator, LocatorCandidate, MultiAction, MultiDeviceSelection, Point, ProjectScript, ReplayReport, SessionConfig, Target } from '../src/types.js';
import { connectionEnvironmentError } from '../src/connection-diagnostic.js';

const run = promisify(execFile);
const projectRoot = process.env.ECHOBENCH_APP_ROOT?.trim() || process.cwd();
configureAndroidEnvironment();
configureAdbEnvironment({ appRoot: projectRoot });
const adbServer = configureAdbServerPort();
const client = new AppiumClient();
const video = new VideoStreamManager();
const multi = new MultiDeviceManager({ ensureAppium: startAppium, detectSigning: detectIosSigning, video });

function usesAdbAndroid(): boolean { return activeConfig?.platform === 'android' && !attachedSession; }
const eventClients = new Set<ServerResponse>();
logger.setSink((entry) => emit('server-log', { line: formatLogEntry(entry) }));
const releaseUrl = 'https://github.com/Echoxiawan/echobench/releases/latest';

async function appVersion(): Promise<string> {
  try {
    const value = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof value.version === 'string' ? value.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
let appiumProcess: ChildProcessWithoutNullStreams | null = null;
let appiumStartup: Promise<void> | null = null;
let activeConfig: SessionConfig | null = null;
let androidStayOnBackup: { deviceId: string; value: string } | null = null;
let recordingActive = false;
let attachedSession = false;
let attachedVideo: 'android' | 'ios' | 'none' = 'none';
let attachedMjpegPort: number | undefined;
let shuttingDown = false;
let browserCleanupTimer: NodeJS.Timeout | null = null;
let sessionMutation: Promise<void> = Promise.resolve();
let devicePollTimer: NodeJS.Timeout | null = null;
let devicePolling = false;
let deviceSnapshot = '';

function configureAndroidEnvironment(): void {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.platform === 'darwin' ? join(homedir(), 'Library', 'Android', 'sdk') : undefined,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
    process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Android', 'Sdk') : undefined,
    process.platform === 'linux' ? join(homedir(), 'Android', 'Sdk') : undefined,
  ].filter((value): value is string => Boolean(value));
  const sdkRoot = candidates.find((candidate) => existsSync(candidate));
  if (!sdkRoot) return;
  process.env.ANDROID_SDK_ROOT = sdkRoot;
  process.env.ANDROID_HOME = sdkRoot;
  const platformTools = join(sdkRoot, 'platform-tools');
  const pathEntries = (process.env.PATH ?? '').split(delimiter);
  if (existsSync(platformTools) && !pathEntries.includes(platformTools)) {
    process.env.PATH = `${platformTools}${delimiter}${process.env.PATH ?? ''}`;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/events') return openEventStream(response);
    if (url.pathname === '/api/video/android') {
      if (!activeConfig || activeConfig.platform !== 'android') return sendJson(response, 409, { error: '当前不是 Android 会话' });
      if (attachedSession) {
        if (attachedVideo !== 'android') return sendJson(response, 409, { error: '附加会话没有可用的 Android 视频设备' });
        return await video.streamAndroid(activeConfig.deviceId, response);
      }
      await wakeAndroid(activeConfig.deviceId);
      return await video.streamAndroid(activeConfig.deviceId, response);
    }
    if (url.pathname === '/api/video/ios') {
      if (!activeConfig || activeConfig.platform !== 'ios') return sendJson(response, 409, { error: '当前不是 iOS 会话' });
      if (attachedSession && attachedVideo !== 'ios') return sendJson(response, 409, { error: '附加会话没有提供 WDA MJPEG 端口' });
      video.streamIos(response, attachedSession ? attachedMjpegPort ?? 9100 : 9100); return;
    }
    if (url.pathname === '/api/multi/video' && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId') ?? '';
      if (!deviceId) return sendJson(response, 400, { error: '缺少 deviceId' });
      return await multi.streamVideo(deviceId, response);
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url.pathname);
    await serveStatic(url.pathname, response);
  } catch (cause) {
    logger.error('http', `${request.method ?? 'GET'} ${request.url ?? '/'} 请求失败`, cause);
    sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) });
  }
});

server.listen(Number(process.env.PORT) || 4710, '127.0.0.1', () => {
  logger.info('server', `EchoBench 已启动：http://127.0.0.1:${Number(process.env.PORT) || 4710}`, { logFile: logger.path });
  setTimeout(() => { void logStartupEnvironment(); }, 800).unref();
  startDevicePolling();
});

async function handleApi(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const method = request.method ?? 'GET';
  if (method === 'GET' && path === '/api/health') return sendJson(response, 200, { ok: true });
  if (method === 'GET' && path === '/api/app-info') {
    return sendJson(response, 200, {
      version: await appVersion(),
      releaseUrl,
      desktop: process.env.ECHOBENCH_DESKTOP === '1',
    });
  }
  if (method === 'POST' && path === '/api/session/attach') {
    const input = await readBody<AttachSessionRequest>(request);
    const appiumUrl = String(input.appiumUrl ?? '').trim().replace(/\/+$/, '');
    const sessionId = String(input.sessionId ?? '').trim();
    if (!appiumUrl) throw new Error('请填写 Appium Server URL');
    if (!sessionId) throw new Error('请填写 Session ID');
    if (input.platform !== 'android' && input.platform !== 'ios') throw new Error('请选择设备平台');
    if (input.platform === 'ios' && process.platform !== 'darwin') throw new Error('当前操作系统不支持 iOS 自动化，仅 macOS 支持');
    let parsed: URL;
    try { parsed = new URL(appiumUrl); } catch { throw new Error('Appium Server URL 不是合法地址'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Appium Server URL 只支持 http/https');
    const mjpegPort = Number.isFinite(input.mjpegPort) ? Math.trunc(input.mjpegPort!) : undefined;
    if (mjpegPort !== undefined && (mjpegPort < 1 || mjpegPort > 65535)) throw new Error('MJPEG 端口必须在 1–65535 之间');
    const state = await mutateSession(async () => {
      await multi.stop();
      await releaseSessionResources();
      const video = input.platform === 'android'
        ? (input.deviceId?.trim() ? 'android' : 'none')
        : (mjpegPort ? 'ios' : 'none');
      const attached = await client.attachSession(sessionId, input.platform, appiumUrl);
      attachedSession = true;
      attachedVideo = video;
      attachedMjpegPort = mjpegPort;
      activeConfig = { platform: input.platform, deviceId: input.deviceId?.trim() || sessionId };
      logger.info('session', '已附加外部 Appium 会话', { appiumUrl, sessionId, platform: input.platform, video });
      return { ...attached, attached: true, video };
    });
    return sendJson(response, 200, state);
  }
  if (method === 'GET' && path === '/api/devices') return sendJson(response, 200, await listDevices());
  if (method === 'POST' && path === '/api/server/start') { await startAppium(); return sendJson(response, 200, { ok: true }); }
  if (method === 'POST' && path === '/api/session') {
    const config = await readBody<SessionConfig>(request);
    if (config.platform === 'ios' && process.platform !== 'darwin') {
      throw new Error('当前操作系统不支持 iOS 自动化，仅 macOS 支持');
    }
    const environmentReport = await runDoctor();
    const environmentError = connectionEnvironmentError(environmentReport, config.platform);
    if (environmentError) throw new Error(environmentError);
    await startAppium();
    logger.info('session', '创建 Appium 会话', {
      platform: config.platform,
      deviceId: config.deviceId,
      appPackage: config.packageName,
      appActivity: config.activity,
      bundleId: config.bundleId,
      appPath: Boolean(config.app),
    });
    const session = await mutateSession(async () => {
      await multi.stop();
      await releaseSessionResources();
      if (config.platform === 'android') await prepareAndroidDevice(config.deviceId);
      if (config.platform === 'ios' && !config.platformVersion) {
        config.platformVersion = await detectIosPlatformVersion(config.deviceId);
      }
      if (config.platform === 'ios' && !config.xcodeOrgId) {
        logger.info('ios', '未指定 Xcode Team ID，尝试自动选择签名团队');
        try {
          const selection = await detectIosSigning(config.deviceId, config.bundleId);
          if (selection) {
            config.xcodeOrgId = selection.teamId;
            config.xcodeSigningId = selection.signingId;
            if (!config.wdaBundleId) config.wdaBundleId = selection.wdaBundleId;
            config.allowProvisioning = true;
            logger.info('ios', '自动选择 WDA 签名团队', {
              teamId: selection.teamId,
              identity: selection.candidate.identity,
              score: selection.candidate.score,
              reason: selection.candidate.reason,
              profile: selection.candidate.profile?.name,
              wdaBundleId: config.wdaBundleId,
            });
          } else {
            logger.warn('ios', '没有找到可用的 iOS 签名团队，请手动填写 XCODE TEAM ID');
          }
        } catch (cause) {
          logger.warn('ios', '自动检测 iOS 签名失败', cause);
        }
      }
      try {
        const created = await client.createSession(config);
        attachedSession = false;
        attachedVideo = config.platform;
        attachedMjpegPort = undefined;
        activeConfig = config;
        recordingActive = false;
        logger.info('session', '会话已创建', { sessionId: created.sessionId, width: created.width, height: created.height });
        return { ...created, attached: false, video: config.platform };
      } catch (cause) {
        logger.error('session', '创建 Appium 会话失败', cause);
        if (config.platform === 'android') await restoreAndroidDevice(config.deviceId);
        const message = cause instanceof Error ? cause.message : String(cause);
        if (config.platform === 'ios' && /requires a development team|xcodebuild failed with code 65/i.test(message)) {
          const hint = 'iOS 真机需要 WebDriverAgent 签名：请填写 XCODE TEAM ID，或在 Xcode 中为 WebDriverAgentRunner 配置开发团队和 provisioning profile。';
          logger.warn('session', hint);
          throw new Error(`${message}\n${hint}`);
        }
        if (config.platform === 'ios' && /RemoteXPC tunnel|Tunnel registry port not found/i.test(message)) {
          const hint = 'iOS 18+ 真机需要通过 USB 连接，并先在项目目录运行 sudo node node_modules/appium/index.js driver run xcuitest tunnel-creation；纯 Wi-Fi 连接无法创建 RemoteXPC 隧道。';
          logger.warn('session', hint);
          throw new Error(`${message}\n${hint}`);
        }
        throw cause;
      }
    });
    return sendJson(response, 200, session);
  }
  if ((method === 'DELETE' && path === '/api/session') || (method === 'POST' && path === '/api/session/release')) {
    recordingActive = false;
    await mutateSession(releaseSessionResources);
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/record/state') {
    const value = await readBody<{ recording?: boolean }>(request);
    recordingActive = value.recording === true;
    return sendJson(response, 200, { ok: true, recording: recordingActive });
  }
  if (method === 'POST' && path === '/api/multi/start') {
    const value = await readBody<{ devices?: MultiDeviceSelection[]; bundleId?: string }>(request);
    if (!Array.isArray(value.devices)) throw new Error('缺少多端设备列表');
    logger.info('multi', '启动多端同步', { devices: value.devices.map((item) => item.deviceId), bundleId: value.bundleId });
    const status = await mutateSession(async () => {
      recordingActive = false;
      await releaseSessionResources();
      try {
        return await multi.start(value.devices!, typeof value.bundleId === 'string' ? value.bundleId : undefined);
      } catch (cause) {
        await multi.stop().catch(() => undefined);
        throw cause;
      }
    });
    return sendJson(response, 200, status);
  }
  if (method === 'GET' && path === '/api/multi/status') return sendJson(response, 200, multi.status());
  if (method === 'POST' && path === '/api/multi/stop') {
    await multi.stop();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/multi/device') {
    const value = await readBody<{ deviceId?: string; live?: boolean; sync?: boolean }>(request);
    if (!value.deviceId) throw new Error('缺少设备 ID');
    return sendJson(response, 200, multi.setDevice(value.deviceId, { live: value.live, sync: value.sync }));
  }
  if (method === 'POST' && path === '/api/multi/action') {
    const value = await readBody<MultiAction>(request);
    return sendJson(response, 200, await multi.action(value));
  }
  if (method === 'GET' && path === '/api/multi/screenshot') {
    const deviceId = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('deviceId') ?? '';
    if (!deviceId) throw new Error('缺少设备 ID');
    return sendJson(response, 200, { screenshot: await multi.screenshot(deviceId) });
  }
  if (method === 'GET' && path === '/api/session/screenshot') {
    if (usesAdbAndroid()) {
      const screenshot = await adbScreenshot(activeConfig!.deviceId).catch(() => client.screenshot());
      return sendJson(response, 200, { screenshot });
    }
    return sendJson(response, 200, { screenshot: await client.screenshot() });
  }
  if (method === 'GET' && path === '/api/session/snapshot') return sendJson(response, 200, await client.snapshot());
  if (method === 'GET' && path === '/api/session/elements') {
    const session = client.getSession();
    if (!session) throw new Error('尚未连接设备会话');
    const xml = await client.pageSource();
    return sendJson(response, 200, flattenElementTree(xml, session.platform, session.width, session.height));
  }
  if (method === 'POST' && path === '/api/session/elements/analyze') {
    const value = await readBody<{ path?: unknown }>(request);
    const nodePath = Array.isArray(value.path) && value.path.every((item) => Number.isInteger(item) && Number(item) >= 0)
      ? value.path.map(Number)
      : null;
    if (!nodePath) throw new Error('元素路径无效');
    const session = client.getSession();
    if (!session) throw new Error('尚未连接设备会话');
    const xml = await client.pageSource();
    return sendJson(response, 200, analyzeElement(xml, nodePath, session.platform, session.width, session.height));
  }
  if (method === 'POST' && path === '/api/session/source/refresh') { await client.refreshSource(); return sendJson(response, 200, { ok: true }); }
  if (method === 'POST' && path === '/api/session/tap') {
    const value = await readBody<{ x: number; y: number; record?: boolean }>(request);
    const recording = value.record === true;
    recordingActive = recording;
    if (recording && activeConfig?.platform === 'ios') await client.ensureSourceAfterAction();
    // 自有 Android 用最新树；自有 iOS 非录制时读缓存；附加会话统一按需读取最新树。
    let recorded = attachedSession
      ? await client.inspectFresh(value.x, value.y).catch(() => client.inspectCached(value.x, value.y))
      : activeConfig?.platform === 'ios'
        ? client.inspectCached(value.x, value.y)
        : await client.inspectFresh(value.x, value.y).catch(() => client.inspectCached(value.x, value.y));
    if (recording) {
      let target = await verifyRecordedTarget(recorded.target);
      // 自动跳转/异步加载可能改变页面但还没经历一次操作；校验失败时强制换一棵新树再试一次。
      if (!target.candidates?.some((candidate) => candidate.verified) && (activeConfig?.platform === 'ios' || attachedSession)) {
        await client.refreshSource();
        const retry = client.inspectCached(value.x, value.y);
        target = await verifyRecordedTarget(retry.target);
        recorded = { ...retry };
      }
      recorded = { ...recorded, target };
    }
    if (usesAdbAndroid()) {
      await run(resolveAdbExecutable(), ['-s', activeConfig!.deviceId, 'shell', 'input', 'tap', String(value.x), String(value.y)]);
      client.markAction();
    } else {
      await client.tapPoint(value.x, value.y);
    }
    if (recording) {
      const target = recorded.target;
      logger.info('record', `记录点击「${target.label ?? '坐标目标'}」`, {
        strategy: target.locator?.strategy,
        value: target.locator?.value.slice(0, 240),
        verified: target.candidates?.some((candidate) => candidate.verified),
        warning: target.warning,
      });
    }
    scheduleSourceRefresh();
    return sendJson(response, 200, recorded);
  }
  if (method === 'POST' && path === '/api/session/inspect') {
    const value = await readBody<{ x: number; y: number }>(request);
    if (!client.getSession()) throw new Error('尚未连接设备会话');
    return sendJson(response, 200, await client.inspectFresh(value.x, value.y));
  }
  if (method === 'POST' && path === '/api/session/input') {
    const value = await readBody<{ target: Target; value: string; clearFirst: boolean }>(request);
    await client.input(value.target, value.value, value.clearFirst);
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/session/swipe') {
    const value = await readBody<{ direction: 'up' | 'down' | 'left' | 'right'; duration: number; start?: Point; end?: Point }>(request);
    const session = client.getSession();
    if (!session) throw new Error('尚未连接设备会话');
    const start = value.start ? normalizePoint(value.start, session.width, session.height) : undefined;
    const end = value.end ? normalizePoint(value.end, session.width, session.height) : undefined;
    if ((start && !end) || (!start && end)) throw new Error('滑动起止坐标必须同时提供');
    if (usesAdbAndroid()) {
      await androidSwipe(activeConfig!.deviceId, value.direction, value.duration, start, end);
      client.markAction();
    } else await client.swipe(value.direction, value.duration, start, end);
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/session/back') {
    if (usesAdbAndroid()) {
      await run(resolveAdbExecutable(), ['-s', activeConfig!.deviceId, 'shell', 'input', 'keyevent', '4']);
      client.markAction();
    } else await client.back();
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/session/double-tap') {
    const value = await readBody<{ target: Target }>(request);
    requireGestureTarget(value.target);
    await client.doubleTap(value.target);
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/session/long-press') {
    const value = await readBody<{ target: Target; duration?: number }>(request);
    requireGestureTarget(value.target);
    await client.longPress(value.target, clampInteger(value.duration ?? 800, 100, 10_000));
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/session/pinch') {
    const value = await readBody<{ target?: Target; direction?: 'in' | 'out'; scale?: number; duration?: number }>(request);
    if (value.direction !== undefined && value.direction !== 'in' && value.direction !== 'out') throw new Error('pinch 方向必须是 in 或 out');
    if (value.target) requireGestureTarget(value.target);
    await client.pinch(value.target, value.direction ?? 'out', clampNumber(value.scale ?? 2, 0.1, 5), clampInteger(value.duration ?? 600, 100, 5000));
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true });
  }
  if (method === 'POST' && path === '/api/locator/verify') {
    const value = await readBody<{ target: Target }>(request);
    if (!client.getSession()) throw new Error('尚未连接设备会话');
    const candidates = value.target.candidates ?? [];
    if (candidates.length === 0) return sendJson(response, 200, value.target);
    const results = await Promise.all(candidates.map((candidate) => probeCandidate(candidate.locator)));
    return sendJson(response, 200, applyLiveMatches(value.target, results.filter((result) => !result.error || result.matches >= 0)));
  }
  if (method === 'POST' && path === '/api/session/keys') {
    const value = await readBody<{ text?: string; key?: KeyName }>(request);
    let typed = true;
    if (value.key) await pressKey(value.key);
    else if (value.text) {
      if (usesAdbAndroid()) {
        await androidTypeText(activeConfig!.deviceId, value.text);
        typed = client.hasEditableFocus();
        client.markAction();
      } else typed = await client.typeText(value.text);
    }
    scheduleSourceRefresh();
    return sendJson(response, 200, { ok: true, typed });
  }
  if (method === 'GET' && path === '/api/session/focus') {
    const snapshot = await client.typingSnapshot();
    if (recordingActive && snapshot.target) snapshot.target = await verifyRecordedTarget(snapshot.target);
    return sendJson(response, 200, snapshot);
  }
  if (method === 'POST' && path === '/api/script/yaml') return send(response, 200, stringifyExportScript(validateScript(await readBody(request))), 'application/yaml; charset=utf-8');
  if (method === 'POST' && path === '/api/script/parse') return sendJson(response, 200, parseScript((await readBody<{ content: string }>(request)).content));
  if (method === 'POST' && path === '/api/script/javascript') return send(response, 200, generateJavaScript(validateScript(await readBody(request))), 'text/javascript; charset=utf-8');
  if (method === 'POST' && path === '/api/script/python') return send(response, 200, generatePython(validateScript(await readBody(request))), 'text/x-python; charset=utf-8');
  if (method === 'POST' && path === '/api/script/java') return send(response, 200, generateJava(validateScript(await readBody(request))), 'text/x-java; charset=utf-8');
  if (method === 'POST' && path === '/api/ai/test') {
    const body = await readBody<{ config?: unknown }>(request);
    return sendJson(response, 200, await testAiConnection(body.config));
  }
  if (method === 'POST' && path === '/api/ai/export') {
    const body = await readBody<{ script?: unknown; config?: unknown; title?: unknown }>(request);
    const script = validateScript(body.script);
    const title = typeof body.title === 'string' ? body.title : '';
    const result = await generateAiCase(script, body.config, title);
    logger.info('ai', 'AI 用例导出完成', { file: result.filename });
    return sendJson(response, 200, result);
  }
  if (method === 'POST' && path === '/api/script/replay') {
    const payload = await readBody<unknown>(request);
    const envelope = payload && typeof payload === 'object' && 'script' in payload
      ? payload as { script: unknown; startIndex?: unknown }
      : { script: payload };
    const script = validateScript(envelope.script);
    if (script.steps.length === 0) throw new Error('脚本没有可回放的步骤');
    const requestedStart = typeof envelope.startIndex === 'number' && Number.isFinite(envelope.startIndex) ? Math.trunc(envelope.startIndex) : 0;
    if (requestedStart < 0 || requestedStart >= script.steps.length) throw new Error('起始步骤超出范围');
    return sendJson(response, 200, await replay(script, requestedStart));
  }
  if (method === 'GET' && path === '/api/logs') {
    const requested = Number(new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('limit') ?? 500);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(2000, requested)) : 500;
    return sendJson(response, 200, {
      path: logger.path,
      lines: logger.lines(limit),
      size: logger.currentSize,
      maxBytes: logger.maxBytes,
      maxBackups: logger.maxBackups,
      maxLineLength: logger.maxLineLength,
    });
  }
  if (method === 'GET' && path === '/api/doctor') return sendJson(response, 200, await runDoctor());
  if (method === 'GET' && path === '/api/system') return sendJson(response, 200, await getSystemInfo());
  if (method === 'POST' && path === '/api/setup/install') {
    const value = await readBody<{ id?: unknown }>(request);
    const id = typeof value.id === 'string' ? value.id : '';
    if (!id) throw new Error('缺少要安装的组件');
    const result = await runInstall(id);
    return sendJson(response, 200, result);
  }
  sendJson(response, 404, { error: '接口不存在' });
}

async function logStartupEnvironment(): Promise<void> {
  try {
    const system = await getSystemInfo();
    logger.info('startup', `环境检查开始：${system.osName} (${system.platform}) · 包管理器 ${system.packageManager} · iOS ${system.capabilities.ios ? '支持' : '不支持'}`);
    logger.info('startup', 'ADB 配置', {
      path: resolveAdbExecutable(),
      endpoint: adbServer.socket ?? (adbServer.port ? `tcp:127.0.0.1:${adbServer.port}` : 'adb 默认'),
      isolated: adbServer.isolated,
    });
    const initial = await runDoctor();
    for (const check of initial.checks) {
      const level = check.status === 'ok' ? 'info' : check.status === 'warn' ? 'warn' : 'error';
      logger[level]('startup', `${check.status.toUpperCase()} ${check.name}: ${check.detail}${check.required ? ' [必需]' : ''}${check.status !== 'ok' && check.installable ? ' [可安装]' : ''}${check.status !== 'ok' && check.fix ? `；建议：${check.fix}` : ''}`);
    }
    logMissingSummary(initial);
    const attempted = await autoInstallDrivers();
    if (attempted.length > 0) {
      logger.info('startup', `驱动自动安装结束：${attempted.join('、')}；重新检查环境`);
      const final = await runDoctor();
      for (const check of final.checks.filter((item) => attempted.includes(item.id))) {
        logger[check.status === 'ok' ? 'info' : 'warn']('startup', `安装后 ${check.name}: ${check.status.toUpperCase()} · ${check.detail}`);
      }
      logMissingSummary(final);
    }
  } catch (cause) {
    logger.warn('startup', '启动环境检查失败', cause);
  }
}

function logMissingSummary(report: Awaited<ReturnType<typeof runDoctor>>): void {
  const missing = report.checks.filter((check) => check.required && check.status !== 'ok');
  if (missing.length === 0) {
    logger.info('startup', '必需环境检查通过');
    return;
  }
  const autoSystem = report.system.packageManager === 'brew' || report.system.packageManager === 'winget';
  const items = missing.map((check) => `${check.name}${check.installable ? (autoSystem || check.id.startsWith('driver-') ? '（自动安装）' : '（需手动安装）') : '（需手动处理）'}`);
  logger.warn('startup', `缺少必需环境：${items.join('；')}`);
}

async function startAppium(): Promise<void> {
  await repairAppiumCache(projectRoot);
  if (await isAppiumHealthy()) return;
  if (appiumStartup) return appiumStartup;
  appiumStartup = new Promise((resolve, reject) => {
    const appiumEntry = join(projectRoot, 'node_modules', 'appium', 'index.js');
    logger.info('appium', '启动 Appium 服务', { port: 4723, entry: appiumEntry });
    appiumProcess = spawn(process.execPath, [appiumEntry, '--port', '4723', '--base-path', '/'], { cwd: projectRoot, env: { ...process.env, APPIUM_XCUITEST_PREFER_DEVICECTL: '1' } });
    let finished = false;
    const timer = setTimeout(() => settle(new Error('Appium 服务启动超时')), 30_000);
    const settle = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) { logger.error('appium', 'Appium 服务启动失败', error); appiumStartup = null; reject(error); } else resolve();
    };
    const relay = (chunk: Buffer) => {
      const raw = chunk.toString();
      const line = raw.trimEnd();
      if (line) logger.info('appium', line);
      if (/listener started|Appium REST http interface listener/i.test(raw)) settle();
    };
    appiumProcess.stdout.on('data', relay);
    appiumProcess.stderr.on('data', relay);
    appiumProcess.once('error', settle);
    appiumProcess.once('exit', (code) => {
      appiumProcess = null;
      appiumStartup = null;
      logger.warn('appium', `Appium 服务退出：${code ?? 'unknown'}`);
      if (!finished) settle(new Error(`Appium 服务退出：${code}`));
    });
  });
  return appiumStartup;
}

async function isAppiumHealthy(): Promise<boolean> {
  try { const response = await fetch('http://127.0.0.1:4723/status', { signal: AbortSignal.timeout(800) }); return response.ok; } catch { return false; }
}

function startDevicePolling(): void {
  if (devicePollTimer) return;
  devicePollTimer = setInterval(() => { void pollDevices(); }, 4000);
  devicePollTimer.unref();
}

async function pollDevices(): Promise<void> {
  if (devicePolling || eventClients.size === 0) return;
  devicePolling = true;
  try {
    const devices = await listDevices();
    const snapshot = JSON.stringify(devices.map((device) => [device.id, device.name, device.platform, device.status, device.simulator === true]));
    if (snapshot === deviceSnapshot) return;
    deviceSnapshot = snapshot;
    emit('devices', { devices, scannedAt: Date.now() });
    logger.info('devices', `设备列表变化：${devices.length} 台`, {
      devices: devices.map((device) => `${device.platform}:${device.name}:${device.status}`),
    });
  } catch (cause) {
    logger.warn('devices', '自动发现设备失败', cause);
  } finally {
    devicePolling = false;
  }
}

async function listDevices(): Promise<Device[]> {
  const devices: Device[] = [];
  try {
    const { stdout } = await run(resolveAdbExecutable(), ['devices', '-l']);
    devices.push(...parseAdbDevices(stdout));
  } catch (cause) {
    logger.warn('devices', 'ADB 设备发现失败', cause);
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('xcrun', ['xctrace', 'list', 'devices']);
      const parsed = parseXctraceDevices(stdout);
      const simulatorStates = await run('xcrun', ['simctl', 'list', 'devices', '--json'])
        .then((result) => parseSimctlStates(result.stdout))
        .catch(() => new Map<string, 'device' | 'offline'>());
      devices.push(...applySimulatorStates(parsed, simulatorStates));
    } catch { /* 未配置 Xcode 时不影响 Android。 */ }
  }
  return devices;
}

async function replay(script: ProjectScript, startIndex = 0): Promise<ReplayReport> {
  const session = client.getSession();
  if (!session) throw new Error('尚未连接设备会话');
  logger.info('replay', '开始回放', { steps: script.steps.length, startIndex, platform: session.platform });
  const adapter: ReplayAdapter = {
    session: () => session,
    findElement: (locator) => client.findElementId(locator),
    findElements: (locator) => client.findElementIds(locator),
    elementReady: (elementId) => client.elementReady(elementId),
    elementValue: (elementId) => client.elementValue(elementId),
    elementAttribute: (elementId, name) => client.elementAttribute(elementId, name),
    click: (elementId) => client.clickElement(elementId),
    tapAt: (x, y) => client.tapPoint(x, y),
    setValue: (elementId, text, clearFirst) => client.setElementValue(elementId, text, clearFirst),
    doubleTap: (target) => client.doubleTap(target),
    longPress: (target, duration) => client.longPress(target, duration),
    pinch: (target, direction, scale, duration) => client.pinch(target, direction, scale, duration),
    swipe: async (step) => {
      if (usesAdbAndroid()) await androidSwipe(activeConfig!.deviceId, step.direction, step.duration, step.start, step.end);
      else await client.swipe(step.direction, step.duration, step.start, step.end);
    },
    back: async () => {
      if (usesAdbAndroid()) await run(resolveAdbExecutable(), ['-s', activeConfig!.deviceId, 'shell', 'input', 'keyevent', '4']);
      else await client.back();
    },
    pageSource: () => client.pageSource(),
    currentApp: async () => usesAdbAndroid() ? currentAndroidApp(activeConfig?.deviceId) : client.currentApp(),
  };
  const report = await runReplay(adapter, script, emit, startIndex);
  const failed = report.results.find((result) => result.status === 'failed');
  logger[report.status === 'passed' ? 'info' : 'warn']('replay', `回放${report.status === 'passed' ? '完成' : '失败'}`, {
    duration: report.duration,
    startIndex,
    failedStep: failed ? failed.index + 1 : undefined,
    message: failed?.message,
  });
  return report;
}

/** Android 直接走 adb 截图，比 Appium 截图快，用于首屏兜底。 */
function adbScreenshot(deviceId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(resolveAdbExecutable(), ['-s', deviceId, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 25 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(Buffer.from(stdout).toString('base64'));
    });
  });
}

/** 连接和重连画面时唤醒设备，避免息屏/锁屏状态下拿到纯黑首帧。 */
async function wakeAndroid(deviceId: string): Promise<void> {
  await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'input', 'keyevent', '224']).catch(() => undefined);
  await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'wm', 'dismiss-keyguard']).catch(() => undefined);
}

/** 会话期间保持屏幕常亮，并在断开时恢复设备原来的设置。 */
async function prepareAndroidDevice(deviceId: string): Promise<void> {
  await wakeAndroid(deviceId);
  try {
    const { stdout } = await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in']);
    const value = stdout.trim();
    if (/^\d+$/.test(value)) androidStayOnBackup = { deviceId, value };
  } catch { /* 部分设备不允许读取该设置。 */ }
  await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'svc', 'power', 'stayon', 'true']).catch(() => undefined);
}

async function restoreAndroidDevice(deviceId: string): Promise<void> {
  const backup = androidStayOnBackup;
  androidStayOnBackup = null;
  if (!backup || backup.deviceId !== deviceId) return;
  await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', backup.value]).catch(() => undefined);
}

async function currentAndroidApp(deviceId?: string): Promise<string | null> {
  if (!deviceId) return null;
  try {
    const { stdout } = await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'dumpsys', 'window']);
    const match = stdout.match(/mCurrentFocus=Window\{[^}]*?\s([A-Za-z0-9_.]+)\//)
      ?? stdout.match(/mFocusedApp=ActivityRecord\{[^}]*?\s([A-Za-z0-9_.]+)\//);
    return match?.[1] ?? null;
  } catch { return null; }
}

async function androidSwipe(deviceId: string, direction: 'up' | 'down' | 'left' | 'right', duration: number, start?: Point, end?: Point): Promise<void> {
  const session = client.getSession();
  if (!session) throw new Error('尚未连接设备会话');
  const points = (start && end ? [start.x, start.y, end.x, end.y] : {
    up: [session.width * .5, session.height * .78, session.width * .5, session.height * .25],
    down: [session.width * .5, session.height * .25, session.width * .5, session.height * .78],
    left: [session.width * .8, session.height * .5, session.width * .2, session.height * .5],
    right: [session.width * .2, session.height * .5, session.width * .8, session.height * .5],
  }[direction]).map(Math.round);
  const boundedDuration = Math.max(100, Math.min(5000, Math.round(duration)));
  await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'input', 'swipe', ...points.map(String), String(boundedDuration)]);
}

function normalizePoint(point: Point, width: number, height: number): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('滑动坐标必须是有效数字');
  return {
    x: Math.max(0, Math.min(width, Math.round(point.x))),
    y: Math.max(0, Math.min(height, Math.round(point.y))),
  };
}

function requireGestureTarget(target: Target | undefined): void {
  if (!target || (!target.locator && !target.coordinate && !target.bounds)) throw new Error('手势需要控件定位器或坐标目标');
}

/** 记录期间才在 iOS 后台刷新控件树；非录制状态保持低负载，手动刷新和元素拾取仍按需取最新树。 */
function scheduleSourceRefresh(): void {
  if (activeConfig?.platform === 'ios' && !recordingActive) return;
  const delay = activeConfig?.platform === 'ios' ? 600 : 250;
  setTimeout(() => {
    if (activeConfig?.platform !== 'ios' || recordingActive) void client.refreshSource();
  }, delay).unref();
}

/** 录制时只校验少量候选：主定位优先，命中唯一且落在目标范围内就停止。 */
async function verifyRecordedTarget(target: Target): Promise<Target> {
  const candidates = target.candidates ?? [];
  if (candidates.length === 0) return target;
  const ordered = [...candidates].sort((a, b) => verificationRank(target, a) - verificationRank(target, b)).slice(0, 5);
  const results: LiveCandidateMatch[] = [];
  for (const candidate of ordered) {
    const result = await probeCandidate(candidate.locator);
    results.push(result);
    const stable = !isOccurrenceLocator(candidate.locator) || isScopedLocator(candidate.locator);
    if (stable && result.matches === 1 && (!result.bounds || rectWithin(target.bounds, result.bounds))) break;
  }
  return applyLiveMatches(target, results);
}

function verificationRank(target: Target, candidate: LocatorCandidate): number {
  const isPrimary = target.locator
    && candidate.locator.strategy === target.locator.strategy
    && candidate.locator.value === target.locator.value;
  if (isPrimary) return -1;
  if (isScopedLocator(candidate.locator)) return 0;
  if (candidate.verified) return 1;
  if (candidate.role === 'recommended') return 2;
  if (candidate.role === 'alternative') return 3;
  return 4;
}

async function probeCandidate(locator: Locator): Promise<LiveCandidateMatch> {
  try {
    const ids = await client.findElementIds(locator, 2000);
    if (ids.length !== 1) return { locator, matches: ids.length };
    const bounds = await client.elementBounds(ids[0], 2000).catch(() => null);
    if (!bounds) return { locator, matches: 1, error: '读取元素范围失败' };
    return { locator, matches: 1, bounds };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { locator, matches: -1, error: detail.slice(0, 200) };
  }
}

function clampInteger(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min;
}

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

const ANDROID_KEY_CODES: Record<KeyName, string> = { backspace: '67', enter: '66', tab: '61', escape: '111', delete: '112', left: '21', up: '19', right: '22', down: '20' };
// XCUITest 会把 W3C 键码里的退格和回车转成真实按键，其余方向键在 iOS 上先不映射。
const IOS_KEY_CODES: Partial<Record<KeyName, string>> = { backspace: '\uE003', enter: '\uE007', delete: '\uE017' };

async function pressKey(key: KeyName): Promise<void> {
  if (usesAdbAndroid()) {
    await run(resolveAdbExecutable(), ['-s', activeConfig!.deviceId, 'shell', 'input', 'keyevent', ANDROID_KEY_CODES[key]]);
    client.markAction();
    return;
  }
  const code = IOS_KEY_CODES[key];
  if (code) await client.typeText(code);
}

/** Android 用 adb 逐字输入：与 Appium setValue 不同，它会在光标处追加而不会覆盖已有内容。 */
async function androidTypeText(deviceId: string, text: string): Promise<void> {
  const normalized = text.replace(/[\r\n]+/g, ' ');
  if (!normalized) return;
  await run(resolveAdbExecutable(), ['-s', deviceId, 'shell', 'input', 'text', `'${normalized.replaceAll("'", "'\\''")}'`]);
}

function openEventStream(response: ServerResponse): void {
  if (browserCleanupTimer) clearTimeout(browserCleanupTimer);
  browserCleanupTimer = null;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  response.write(': connected\n\n');
  eventClients.add(response);
  response.on('close', () => {
    eventClients.delete(response);
    if (eventClients.size > 0 || shuttingDown) return;
    browserCleanupTimer = setTimeout(() => {
      browserCleanupTimer = null;
      if (eventClients.size === 0) void mutateSession(async () => {
        await releaseSessionResources();
        await multi.stop();
        await stopManagedAppium();
      });
    }, 5000);
    browserCleanupTimer.unref();
  });
}

function emit(event: string, data: unknown): void {
  for (const response of eventClients) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readBody<T = unknown>(request: IncomingMessage): Promise<T> {
  let content = '';
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 10 * 1024 * 1024) throw new Error('请求内容超过 10MB');
  }
  return JSON.parse(content || '{}') as T;
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = join(projectRoot, 'dist', safePath);
  try { if (!(await stat(filePath)).isFile()) throw new Error('非文件'); } catch { filePath = join(projectRoot, 'dist', 'index.html'); }
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
  send(response, 200, await readFile(filePath), types[extname(filePath)] ?? 'application/octet-stream');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void { send(response, status, JSON.stringify(value), 'application/json; charset=utf-8'); }
function send(response: ServerResponse, status: number, value: string | Buffer, type: string): void {
  if (response.headersSent) return;
  response.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  response.end(value);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const eventClient of eventClients) eventClient.end();
  eventClients.clear();
  if (browserCleanupTimer) clearTimeout(browserCleanupTimer);
  browserCleanupTimer = null;
  if (devicePollTimer) clearInterval(devicePollTimer);
  devicePollTimer = null;
  try { await mutateSession(releaseSessionResources); } catch { /* 退出时忽略已失效会话。 */ }
  try { await multi.stop(); } catch { /* 退出时忽略已失效会话。 */ }
  if (appiumProcess) await terminateChild(appiumProcess);
  if (adbServer.isolated) await run(resolveAdbExecutable(), ['kill-server']).catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function releaseSessionResources(): Promise<void> {
  logger.info('session', '释放会话资源');
  try {
    await video.close();
    if (attachedSession) client.detachSession();
    else await client.closeSession();
  } finally {
    if (usesAdbAndroid()) await restoreAndroidDevice(activeConfig!.deviceId);
    attachedSession = false;
    attachedVideo = 'none';
    attachedMjpegPort = undefined;
    activeConfig = null;
    logger.info('session', '会话资源已释放');
  }
}
async function stopManagedAppium(): Promise<void> {
  if (!appiumProcess) return;
  await terminateChild(appiumProcess);
  appiumProcess = null;
  appiumStartup = null;
}
function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionMutation.then(operation, operation);
  sessionMutation = result.then(() => undefined, () => undefined);
  return result;
}
async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 3000);
    forceTimer.unref();
    child.once('exit', () => { clearTimeout(forceTimer); resolve(); });
    if (!child.kill('SIGTERM')) { clearTimeout(forceTimer); resolve(); }
  });
}
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
