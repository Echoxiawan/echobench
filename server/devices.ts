import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Device } from '../src/types.js';

const execFileAsync = promisify(execFile);

export function parseAdbDevices(stdout: string): Device[] {
  const devices: Device[] = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)(?:\s+.*model:(\S+))?/);
    if (match) devices.push({ id: match[1], name: match[3]?.replaceAll('_', ' ') ?? match[1], platform: 'android', status: match[2] });
  }
  return devices;
}

export function parseXctraceDevices(stdout: string): Device[] {
  const devices: Device[] = [];
  let section: 'devices' | 'offline' | 'simulators' | '' = '';
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^== Devices ==/.test(line)) { section = 'devices'; continue; }
    if (/^== Devices Offline ==/.test(line)) { section = 'offline'; continue; }
    if (/^== Simulators ==/.test(line)) { section = 'simulators'; continue; }
    if (!section) continue;
    const withVersion = line.match(/^(.+?) \([^)]*\) \(([0-9A-Fa-f-]{20,}|[0-9A-Fa-f-]{36})\)(?: \((Unavailable)\))?$/);
    const onlyId = line.match(/^(.+?) \(([0-9A-Fa-f-]{20,}|[0-9A-Fa-f-]{36})\)$/);
    const match = withVersion ?? onlyId;
    if (!match) continue;
    const name = match[1].trim();
    if (/MacBook|iMac|Mac mini|Mac Studio|Mac Pro/i.test(name)) continue;
    devices.push({
      id: match[2],
      name,
      platform: 'ios',
      // xctrace 只列出模拟器定义，不告知是否启动；默认离线，随后用 simctl 状态覆盖。
      status: section === 'simulators' || section === 'offline' || match[3] ? 'offline' : 'device',
      ...(section === 'simulators' ? { simulator: true } : {}),
    });
  }
  return devices;
}

export async function detectIosPlatformVersion(udid: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('xcrun', ['xcdevice', 'list', '--timeout', '5'], { timeout: 15_000 });
    const devices = JSON.parse(stdout) as Array<{ identifier?: string; operatingSystemVersion?: string }>;
    const device = devices.find((item) => item.identifier === udid);
    const version = device?.operatingSystemVersion?.trim().split(/\s+/)[0];
    return version || undefined;
  } catch {
    return undefined;
  }
}

export function parseSimctlStates(stdout: string): Map<string, 'device' | 'offline'> {
  const states = new Map<string, 'device' | 'offline'>();
  try {
    const value = JSON.parse(stdout) as { devices?: Record<string, Array<{ udid?: unknown; state?: unknown; isAvailable?: unknown }>> };
    for (const list of Object.values(value.devices ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const udid = typeof item.udid === 'string' ? item.udid : '';
        if (!udid) continue;
        states.set(udid, item.state === 'Booted' && item.isAvailable !== false ? 'device' : 'offline');
      }
    }
  } catch { /* simctl 输出异常时保持模拟器默认离线。 */ }
  return states;
}

export function applySimulatorStates(devices: Device[], states: Map<string, 'device' | 'offline'>): Device[] {
  return devices.map((device) => {
    const status = device.simulator ? states.get(device.id) : undefined;
    return status ? { ...device, status } : device;
  });
}
