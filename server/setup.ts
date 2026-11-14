import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { InstallResult, SystemInfo } from '../src/types.js';
import { logger } from './logger.js';
import { brewCommand, commandExists, getSystemInfo } from './system.js';

const execFileAsync = promisify(execFile);

export type InstallId = 'driver-uiautomator2' | 'driver-xcuitest' | 'adb' | 'scrcpy' | 'java' | 'xcode';

export interface InstallCommand {
  file: string;
  args: string[];
  timeout: number;
  optional?: boolean;
}

export interface InstallPlan {
  commands: InstallCommand[];
  manual?: string;
  note?: string;
  javaHome?: boolean;
  needsRestart?: boolean;
}

const running = new Map<string, Promise<InstallResult>>();

export function buildInstallPlan(id: string, system: SystemInfo, projectRoot = process.env.ECHOBENCH_APP_ROOT?.trim() || process.cwd()): InstallPlan | null {
  const appiumEntry = join(projectRoot, 'node_modules', 'appium', 'index.js');
  if (id === 'driver-uiautomator2') {
    return {
      commands: [{ file: process.execPath, args: [appiumEntry, 'driver', 'install', 'uiautomator2@8.7.0'], timeout: 300_000 }],
      manual: 'npm run appium:setup:android',
    };
  }
  if (id === 'driver-xcuitest') {
    if (!system.capabilities.ios) return null;
    return {
      commands: [{ file: process.execPath, args: [appiumEntry, 'driver', 'install', 'xcuitest@12.18.1'], timeout: 300_000 }],
      manual: 'npm run appium:setup:ios',
    };
  }
  if (id === 'xcode') {
    if (!system.capabilities.ios) return null;
    return {
      commands: [{ file: 'xcode-select', args: ['--install'], timeout: 60_000 }],
      manual: 'xcode-select --install',
      note: '会打开系统安装窗口，完成后回到体检面板点“重新检查”。',
      needsRestart: true,
    };
  }
  if (id === 'adb') {
    if (system.platform === 'darwin' && system.packageManager === 'brew') {
      return { commands: [{ file: brewCommand(), args: ['install', '--cask', 'android-platform-tools'], timeout: 600_000 }], manual: 'brew install --cask android-platform-tools' };
    }
    if (system.platform === 'win32' && system.packageManager === 'winget') {
      return { commands: [{ file: 'winget', args: ['install', '--id', 'Google.PlatformTools', '-e', '--accept-package-agreements', '--accept-source-agreements', '--silent'], timeout: 600_000 }], manual: 'winget install --id Google.PlatformTools -e' };
    }
    return { commands: [], manual: packageManagerHint(system, 'adb') };
  }
  if (id === 'scrcpy') {
    if (system.platform === 'darwin' && system.packageManager === 'brew') {
      return {
        commands: [
          { file: brewCommand(), args: ['install', 'scrcpy'], timeout: 600_000 },
          { file: brewCommand(), args: ['upgrade', 'scrcpy'], timeout: 600_000, optional: true },
        ],
        manual: 'brew install scrcpy && brew upgrade scrcpy',
      };
    }
    if (system.platform === 'win32' && system.packageManager === 'winget') {
      return { commands: [{ file: 'winget', args: ['install', '--id', 'Genymobile.scrcpy', '-e', '--accept-package-agreements', '--accept-source-agreements', '--silent'], timeout: 600_000 }], manual: 'winget install --id Genymobile.scrcpy -e' };
    }
    return { commands: [], manual: packageManagerHint(system, 'scrcpy') };
  }
  if (id === 'java') {
    if (system.platform === 'darwin' && system.packageManager === 'brew') {
      return {
        commands: [{ file: brewCommand(), args: ['install', 'openjdk@17'], timeout: 600_000 }],
        manual: 'brew install openjdk@17',
        javaHome: true,
      };
    }
    if (system.platform === 'win32' && system.packageManager === 'winget') {
      return {
        commands: [{ file: 'winget', args: ['install', '--id', 'EclipseAdoptium.Temurin.17.JDK', '-e', '--accept-package-agreements', '--accept-source-agreements', '--silent'], timeout: 600_000 }],
        manual: 'winget install --id EclipseAdoptium.Temurin.17.JDK -e',
        javaHome: true,
      };
    }
    return { commands: [], manual: packageManagerHint(system, 'java') };
  }
  return null;
}

function packageManagerHint(system: SystemInfo, tool: 'adb' | 'scrcpy' | 'java'): string {
  if (system.platform === 'darwin') return `请先安装 Homebrew（https://brew.sh），再执行 brew 安装 ${tool === 'java' ? 'openjdk@17' : tool}`;
  if (system.platform === 'win32') return `请先安装 App Installer / winget，或手动安装 ${tool}`;
  return linuxManual(system, tool);
}

/** 启动时自动补齐项目内的 Appium 驱动；系统级软件仍由用户在体检面板确认安装。 */
export async function autoInstallDrivers(projectRoot = process.env.ECHOBENCH_APP_ROOT?.trim() || process.cwd()): Promise<string[]> {
  const entry = join(projectRoot, 'node_modules', 'appium', 'index.js');
  if (!existsSync(entry)) {
    logger.warn('setup', '未找到内置 Appium，跳过驱动自动安装');
    return [];
  }
  let output = '';
  try {
    const result = await execFileAsync(process.execPath, [entry, 'driver', 'list', '--installed'], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  } catch (cause) {
    logger.warn('setup', '无法读取 Appium 驱动列表，跳过自动安装', { message: cause instanceof Error ? cause.message : String(cause) });
    return [];
  }
  const ids: InstallId[] = [];
  if (!/uiautomator2@/.test(output)) ids.push('driver-uiautomator2');
  if (process.platform === 'darwin' && !/xcuitest@/.test(output)) ids.push('driver-xcuitest');
  if (ids.length === 0) {
    logger.info('setup', 'Appium 驱动已完整，无需自动安装');
    return [];
  }
  logger.info('setup', `检测到缺失 Appium 驱动：${ids.join('、')}，开始自动安装`);
  const attempted: string[] = [];
  for (const id of ids) {
    attempted.push(id);
    try {
      const result = await runInstall(id);
      if (!result.ok) logger.warn('setup', 'Appium 驱动安装未完成', { id, manual: result.manual });
    } catch (cause) {
      logger.warn('setup', '自动安装 Appium 驱动失败', { id, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return attempted;
}

export async function runInstall(id: string): Promise<InstallResult> {
  const existing = running.get(id);
  if (existing) return existing;
  const task = install(id).finally(() => running.delete(id));
  running.set(id, task);
  return task;
}

async function install(id: string): Promise<InstallResult> {
  const system = await getSystemInfo();
  const plan = buildInstallPlan(id, system);
  if (!plan) {
    return { ok: false, id, output: '', manual: '当前操作系统不支持该组件' };
  }
  if (plan.commands.length === 0) {
    return { ok: false, id, output: '', manual: plan.manual };
  }
  logger.info('setup', '开始安装环境依赖', { id, platform: system.platform, commands: plan.commands.map((command) => `${command.file} ${command.args.join(' ')}`) });
  const output: string[] = [];
  for (const command of plan.commands) {
    try {
      const result = await executeCommand(command);
      output.push(String(result.stdout ?? ''), String(result.stderr ?? ''));
    } catch (cause) {
      const detail = errorOutput(cause);
      output.push(detail);
      if (command.optional) continue;
      logger.warn('setup', '环境依赖安装失败', { id, message: detail.slice(0, 500) });
      return {
        ok: false,
        id,
        output: trimOutput(output.join('\n')),
        manual: plan.manual,
        needsRestart: plan.needsRestart,
      };
    }
  }
  if (plan.javaHome) await configureJavaHome(system);
  await refreshEnvironment(system);
  if (id === 'xcode') {
    return {
      ok: false,
      id,
      output: trimOutput(output.join('\n')),
      manual: '请在系统弹出的安装窗口完成安装，然后点击“重新检查”。',
      needsRestart: true,
    };
  }
  const missing = await stillMissing(id);
  const result: InstallResult = {
    ok: !missing,
    id,
    output: trimOutput(output.join('\n')),
    manual: missing ? plan.manual : undefined,
    needsRestart: Boolean(missing && plan.needsRestart),
  };
  if (missing) result.needsRestart = true;
  logger.info('setup', missing ? '依赖已安装但当前进程未检测到，需刷新 PATH' : '环境依赖安装完成', { id, needsRestart: result.needsRestart });
  return result;
}

async function stillMissing(id: string): Promise<boolean> {
  if (id === 'adb') return !(await commandExists('adb'));
  if (id === 'scrcpy') return !(await commandExists('scrcpy'));
  if (id === 'java') return !(await commandExists('java'));
  if (id === 'xcode') return !(await commandExists('xcode-select'));
  return false;
}

async function configureJavaHome(system: SystemInfo): Promise<void> {
  if (system.platform === 'darwin') {
    try {
      const result = await execFileAsync(brewCommand(), ['--prefix', 'openjdk@17'], { timeout: 20_000, maxBuffer: 1024 * 1024 });
      const prefix = String(result.stdout ?? '').trim();
      if (prefix) {
        process.env.JAVA_HOME = prefix;
        process.env.PATH = `${join(prefix, 'bin')}${separator()}${process.env.PATH ?? ''}`;
      }
    } catch { /* JDK 已安装但 Homebrew 前缀读取失败时，由重新检查提示。 */ }
  } else if (system.platform === 'win32') {
    const candidates = [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Eclipse Adoptium'),
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft'),
    ];
    for (const root of candidates) {
      if (!existsSync(root)) continue;
      try {
        const found = readdirSync(root).find((name) => /jdk-17|jdk17/i.test(name));
        if (found) {
          const home = join(root, found);
          process.env.JAVA_HOME = home;
          process.env.PATH = `${join(home, 'bin')};${process.env.PATH ?? ''}`;
        }
      } catch { /* 忽略无权限目录。 */ }
    }
  }
}

async function refreshEnvironment(system: SystemInfo): Promise<void> {
  if (system.platform !== 'win32') return;
  try {
    const script = [
      "[Environment]::GetEnvironmentVariable('Path','Machine');",
      "[Environment]::GetEnvironmentVariable('Path','User');",
      "[Environment]::GetEnvironmentVariable('JAVA_HOME','Machine');",
      "[Environment]::GetEnvironmentVariable('JAVA_HOME','User');",
    ].join(' ');
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    const lines = String(result.stdout ?? '').split(/\r?\n/);
    const path = lines.slice(0, 2).map((line) => line.trim()).filter(Boolean).join(';');
    const javaHome = lines.slice(2).map((line) => line.trim()).find(Boolean);
    if (path) process.env.PATH = path;
    if (javaHome) process.env.JAVA_HOME = javaHome;
  } catch { /* 刷新失败时，UI 会提示重启应用。 */ }
}

function linuxManual(system: SystemInfo, tool: 'adb' | 'scrcpy' | 'java'): string {
  if (system.packageManager === 'apt') {
    if (tool === 'adb') return 'sudo apt-get install -y adb';
    if (tool === 'scrcpy') return 'sudo apt-get install -y scrcpy';
    return 'sudo apt-get install -y openjdk-17-jdk';
  }
  if (system.packageManager === 'dnf') {
    if (tool === 'adb') return 'sudo dnf install -y android-tools';
    if (tool === 'scrcpy') return 'sudo dnf install -y scrcpy';
    return 'sudo dnf install -y java-17-openjdk';
  }
  if (system.packageManager === 'pacman') {
    if (tool === 'adb') return 'sudo pacman -S android-tools';
    if (tool === 'scrcpy') return 'sudo pacman -S scrcpy';
    return 'sudo pacman -S jdk17-openjdk';
  }
  return '请使用系统包管理器安装 adb / scrcpy / OpenJDK 17';
}

async function executeCommand(command: InstallCommand): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command.file, command.args, {
      timeout: command.timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
  } catch (cause) {
    if (process.platform !== 'win32' || command.file !== 'winget') throw cause;
    return execFileAsync('cmd.exe', ['/d', '/s', '/c', ['winget', ...command.args].join(' ')], {
      timeout: command.timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
  }
}

function errorOutput(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const value = cause as { stdout?: unknown; stderr?: unknown; message?: unknown };
    return [value.stdout, value.stderr, value.message].map(String).filter(Boolean).join('\n');
  }
  return String(cause);
}

function trimOutput(value: string): string {
  const cleaned = value.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return cleaned.length > 20_000 ? `${cleaned.slice(0, 20_000)}\n…` : cleaned;
}

function separator(): string {
  return process.platform === 'win32' ? ';' : ':';
}
