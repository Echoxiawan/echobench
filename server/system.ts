import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { PackageManager, SystemInfo } from '../src/types.js';

const execFileAsync = promisify(execFile);

export async function getSystemInfo(platform: NodeJS.Platform = process.platform): Promise<SystemInfo> {
  const packageManager = await detectPackageManager(platform);
  return systemInfoForPlatform(platform, packageManager);
}

export function systemInfoForPlatform(platform: NodeJS.Platform, packageManager: PackageManager = 'none'): SystemInfo {
  return {
    platform,
    osName: platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform,
    capabilities: { android: true, ios: platform === 'darwin' },
    packageManager,
  };
}

export async function detectPackageManager(platform: NodeJS.Platform): Promise<PackageManager> {
  if (platform === 'darwin') return existsSync('/opt/homebrew/bin/brew') || existsSync('/usr/local/bin/brew') || await commandExists('brew') ? 'brew' : 'none';
  if (platform === 'win32') return await commandExists('winget') ? 'winget' : 'none';
  if (platform === 'linux') {
    for (const candidate of ['apt-get', 'dnf', 'pacman'] as const) {
      if (await commandExists(candidate)) return candidate === 'apt-get' ? 'apt' : candidate;
    }
  }
  return 'none';
}

export async function commandExists(command: string): Promise<boolean> {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await execFileAsync(lookup, [command], { timeout: 2500, maxBuffer: 512 * 1024 });
    return Boolean(String(result.stdout ?? '').trim());
  } catch { return false; }
}

export function brewCommand(): string {
  if (existsSync('/opt/homebrew/bin/brew')) return '/opt/homebrew/bin/brew';
  if (existsSync('/usr/local/bin/brew')) return '/usr/local/bin/brew';
  return 'brew';
}
