import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DoctorCheck, DoctorReport, PackageManager } from '../src/types.js';
import { detectPackageManager, systemInfoForPlatform } from './system.js';
import { findScrcpyServer } from './video-stream.js';

const execFileAsync = promisify(execFile);
const MIN_NODE = '22.12.0';

export interface DoctorDeps {
  exec?: (file: string, args: string[], timeout: number) => Promise<{ stdout: string; stderr: string }>;
  fetchStatus?: () => Promise<boolean>;
  scrcpyServer?: () => Promise<string>;
  projectRoot?: string;
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  packageManager?: PackageManager;
}

export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const exec = deps.exec ?? defaultExec;
  const projectRoot = deps.projectRoot ?? (process.env.ECHOBENCH_APP_ROOT?.trim() || process.cwd());
  const nodeVersion = deps.nodeVersion ?? process.version;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const fetchStatus = deps.fetchStatus ?? appiumStatus;
  const scrcpyServer = deps.scrcpyServer ?? findScrcpyServer;
  const packageManager = deps.packageManager ?? await detectPackageManager(platform);
  const system = systemInfoForPlatform(platform, packageManager);
  const driverEntry = join(projectRoot, 'node_modules', 'appium', 'index.js');
  let installedDrivers: string[] = [];
  let driverError = '';
  try {
    const { stdout, stderr } = await exec(process.execPath, [driverEntry, 'driver', 'list', '--installed'], 10_000);
    installedDrivers = [...new Set([...`${stdout}\n${stderr}`.matchAll(/(uiautomator2|xcuitest)@([\w.-]+)/g)].map((match) => `${match[1]}@${match[2]}`))];
  } catch (cause) { driverError = message(cause); }
  const hasDriver = (name: string) => installedDrivers.some((driver) => driver.startsWith(`${name}@`));

  const checks = await Promise.all([
    safeCheck('node', 'Node.js 版本', async () => {
      const version = nodeVersion.replace(/^v/, '');
      return versionAtLeast(version, MIN_NODE)
        ? { status: 'ok', detail: `v${version}` }
        : { status: 'fail', detail: `v${version}`, fix: `升级到 Node.js ${MIN_NODE} 或更高版本` };
    }, { required: true }),
    safeCheck('appium', '内置 Appium', async () => {
      const version = await packageVersion(join(projectRoot, 'node_modules', 'appium', 'package.json'));
      return version
        ? { status: 'ok', detail: `appium@${version}` }
        : { status: 'fail', detail: '未找到 node_modules/appium', fix: '在项目目录执行 npm ci' };
    }, { required: true }),
    safeCheck('driver-uiautomator2', 'UiAutomator2 驱动', async () => {
      const driver = installedDrivers.find((item) => item.startsWith('uiautomator2@'));
      return driver
        ? { status: 'ok', detail: driver }
        : { status: 'warn', detail: driverError || '未检测到 uiautomator2', fix: '点击安装，或执行 npm run appium:setup:android' };
    }, { required: true, installable: true }),
    ...(system.capabilities.ios ? [
      safeCheck('driver-xcuitest', 'XCUITest 驱动', async () => {
        const driver = installedDrivers.find((item) => item.startsWith('xcuitest@'));
        return driver
          ? { status: 'ok', detail: driver }
          : { status: 'warn', detail: driverError || '未检测到 xcuitest', fix: '点击安装，或执行 npm run appium:setup:ios' };
      }, { installable: true }),
    ] : []),
    safeCheck('appium-server', 'Appium 服务', async () => {
      const running = await fetchStatus();
      return running
        ? { status: 'ok', detail: '127.0.0.1:4723 正在运行' }
        : { status: 'warn', detail: '当前未运行', fix: '连接设备时会由本工具自动启动，无需手动处理' };
    }),
    safeCheck('adb', 'adb', async () => {
      let result: { stdout: string; stderr: string };
      try { result = await exec('adb', ['version'], 3_000); }
      catch (cause) { return { status: 'fail', detail: message(cause), fix: installHint(platform, 'adb', packageManager) }; }
      const first = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
      return first
        ? { status: 'ok', detail: first }
        : { status: 'warn', detail: 'adb 无输出', fix: installHint(platform, 'adb', packageManager) };
    }, { required: true, installable: true }),
    safeCheck('android-sdk', 'Android SDK', async () => {
      const candidates = [
        env.ANDROID_SDK_ROOT,
        env.ANDROID_HOME,
        platform === 'darwin' ? join(homedir(), 'Library', 'Android', 'sdk') : undefined,
        platform === 'win32' && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
        platform === 'linux' ? join(homedir(), 'Android', 'Sdk') : undefined,
      ].filter((value): value is string => Boolean(value));
      for (const candidate of candidates) {
        if (await exists(candidate)) return { status: 'ok', detail: candidate };
      }
      return { status: 'warn', detail: '未找到 Android SDK 目录', fix: '在 Android Studio 安装 SDK，或设置 ANDROID_SDK_ROOT；仅使用 adb 时此项不影响连接' };
    }),
    safeCheck('scrcpy', 'scrcpy', async () => {
      let serverPath = '';
      try { serverPath = await scrcpyServer(); } catch { /* 下面继续检查系统命令。 */ }
      let result: { stdout: string; stderr: string };
      try { result = await exec('scrcpy', ['--version'], 3_000); }
      catch (cause) {
        if (serverPath && !serverPath.includes('未找到')) {
          return { status: 'ok', detail: `内置 scrcpy-server：${serverPath}` };
        }
        return { status: 'fail', detail: message(cause), fix: installHint(platform, 'scrcpy', packageManager) };
      }
      const first = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
      if (!first) return { status: 'warn', detail: 'scrcpy 无输出', fix: installHint(platform, 'scrcpy', packageManager) };
      const server = serverPath ? `；server: ${serverPath}` : '；未找到 scrcpy-server';
      return { status: /3\.2/.test(first) && !server.includes('未找到') ? 'ok' : 'warn', detail: `${first}${server}`, fix: installHint(platform, 'scrcpy', packageManager) };
    }, { required: true, installable: true }),
    safeCheck('java', 'Java / JDK', async () => {
      let result: { stdout: string; stderr: string };
      try { result = await exec('java', ['-version'], 3_000); }
      catch (cause) { return { status: 'fail', detail: message(cause), fix: installHint(platform, 'java', packageManager) }; }
      const first = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
      if (!first) return { status: 'warn', detail: 'java 无输出', fix: installHint(platform, 'java', packageManager) };
      return { status: 'ok', detail: `${first}${env.JAVA_HOME ? `；JAVA_HOME=${env.JAVA_HOME}` : ''}` };
    }, { required: true, installable: true }),
    ...(system.capabilities.ios ? [
      safeCheck('xcode', 'Xcode / iOS', async () => {
        let path = '';
        try { path = (await exec('xcode-select', ['-p'], 3_000)).stdout.trim(); }
        catch (cause) { return { status: 'warn', detail: message(cause), fix: '点击安装命令行工具，或在 App Store 安装完整 Xcode' }; }
        const simulators = await exec('xcrun', ['simctl', 'list', 'devices'], 6_000).then((result) => result.stdout).catch(() => '');
        const booted = (simulators.match(/\(Booted\)/g) ?? []).length;
        return { status: path ? 'ok' : 'warn', detail: path ? `${path}；已启动模拟器 ${booted} 个` : '未找到 Xcode 命令行工具', fix: path ? undefined : '点击安装命令行工具，或在 App Store 安装完整 Xcode' };
      }, { installable: true }),
    ] : []),
  ]);

  return { generatedAt: Date.now(), system, checks };
}

async function safeCheck(
  id: string,
  name: string,
  operation: () => Promise<Omit<DoctorCheck, 'id' | 'name' | 'required' | 'installable'>>,
  meta: Pick<DoctorCheck, 'required' | 'installable'> = {},
): Promise<DoctorCheck> {
  try {
    const result = await operation();
    return { id, name, ...result, ...meta };
  } catch (cause) {
    return { id, name, status: 'fail', detail: message(cause), fix: '检查对应工具是否已安装并在 PATH 中', ...meta };
  }
}

function installHint(platform: NodeJS.Platform, tool: 'adb' | 'scrcpy' | 'java', packageManager: PackageManager): string {
  if (platform === 'darwin') {
    if (packageManager !== 'brew') return '请先安装 Homebrew（https://brew.sh），再点击安装';
    return tool === 'adb' ? '点击安装，或执行 brew install --cask android-platform-tools'
      : tool === 'scrcpy' ? '点击安装，或执行 brew install scrcpy'
        : '点击安装，或执行 brew install openjdk@17';
  }
  if (platform === 'win32') {
    if (packageManager !== 'winget') return '请先安装 App Installer / winget，再点击安装';
    return tool === 'adb' ? '点击安装，或执行 winget install --id Google.PlatformTools -e'
      : tool === 'scrcpy' ? '点击安装，或执行 winget install --id Genymobile.scrcpy -e'
        : '点击安装，或执行 winget install --id EclipseAdoptium.Temurin.17.JDK -e';
  }
  return tool === 'adb' ? '使用系统包管理器安装 adb'
    : tool === 'scrcpy' ? '使用系统包管理器安装 scrcpy'
      : '使用系统包管理器安装 OpenJDK 17';
}

async function defaultExec(file: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args, { timeout, maxBuffer: 2 * 1024 * 1024 });
  return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

async function appiumStatus(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:4723/status', { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch { return false; }
}

async function packageVersion(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf8');
    const value = JSON.parse(content) as { version?: string };
    return value.version ?? null;
  } catch { return null; }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split('.').map(Number);
  const right = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
