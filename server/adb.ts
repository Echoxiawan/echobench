import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export interface AdbPathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  appRoot?: string;
}

/**
 * 解析 adb 可执行文件。安装包优先使用随应用发布的 Platform-Tools，
 * 开发环境或未打包场景再回退到 PATH。
 */
export function resolveAdbExecutable(options: AdbPathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executable = platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    env.ECHOBENCH_ADB_PATH?.trim(),
    env.ECHOBENCH_PLATFORM_TOOLS_DIR?.trim()
      ? join(env.ECHOBENCH_PLATFORM_TOOLS_DIR.trim(), executable)
      : undefined,
    join(options.appRoot?.trim() || env.ECHOBENCH_APP_ROOT?.trim() || process.cwd(), 'resources', 'platform-tools', executable),
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) ?? 'adb';
}

/** 将内置 adb 所在目录放到子进程 PATH 首位，确保 Appium 也使用同一版本。 */
export function configureAdbEnvironment(options: AdbPathOptions = {}): string {
  const env = options.env ?? process.env;
  const executable = resolveAdbExecutable({ ...options, env });
  if (executable === 'adb') return executable;

  env.ECHOBENCH_ADB_PATH = executable;
  const directory = dirname(executable);
  const entries = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (!entries.includes(directory)) env.PATH = [directory, ...entries].join(delimiter);
  return executable;
}

export interface AdbServerConfig {
  port?: string;
  socket?: string;
  isolated: boolean;
}

/**
 * 默认复用系统标准 ADB Server，确保模拟器、IDE 和 EchoBench 看到同一份设备列表。
 * 仅在显式设置 ECHOBENCH_ADB_SERVER_PORT 时启用独立端口。
 */
export function configureAdbServerPort(env: NodeJS.ProcessEnv = process.env): AdbServerConfig {
  const configured = env.ECHOBENCH_ADB_SERVER_PORT?.trim();
  if (configured) {
    env.ANDROID_ADB_SERVER_PORT = configured;
    return { port: configured, isolated: true };
  }
  return {
    port: env.ANDROID_ADB_SERVER_PORT?.trim() || undefined,
    socket: env.ADB_SERVER_SOCKET?.trim() || undefined,
    isolated: false,
  };
}
