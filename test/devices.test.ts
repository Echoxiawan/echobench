import assert from 'node:assert/strict';
import test from 'node:test';
import { applySimulatorStates, parseAdbDevices, parseSimctlStates, parseXctraceDevices } from '../server/devices.js';

test('解析 xctrace 在线、离线和模拟器状态', () => {
  const output = `== Devices ==
echo的MacBook Pro (B8F3-537B-918C-04B2FB797797)
iPhoneX (16.7.16) (b0975756d5a7fc9c4a5c79ef9be1416b973bf8fd)

== Devices Offline ==
Unknown (600BA52F-4D56-529B-B9E3-F4C8189BFF73)
iPhone (18.7.7) (00008020-001054E83602002E)
xiaoquan的iPhone (18.0) (00008120-000045C61ADB401E)

== Simulators ==
DateFit Test Simulator (26.2) (7590322D-60F1-4644-A422-CD3EE35540A8)
`;
  const devices = parseXctraceDevices(output);
  assert.deepEqual(devices.map((device) => [device.name, device.status]), [
    ['iPhoneX', 'device'],
    ['Unknown', 'offline'],
    ['iPhone', 'offline'],
    ['xiaoquan的iPhone', 'offline'],
    ['DateFit Test Simulator', 'offline'],
  ]);
  assert.equal(devices.at(-1)?.simulator, true);
});

test('用 simctl 启动状态覆盖模拟器在线状态', () => {
  const states = parseSimctlStates(JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [
        { udid: '7590322D-60F1-4644-A422-CD3EE35540A8', state: 'Booted', isAvailable: true },
        { udid: '3DC157E8-DC7F-4EDA-8E32-C838A05DA014', state: 'Shutdown', isAvailable: true },
        { udid: 'UNAVAILABLE-SIM', state: 'Booted', isAvailable: false },
      ],
    },
  }));
  assert.equal(states.get('7590322D-60F1-4644-A422-CD3EE35540A8'), 'device');
  assert.equal(states.get('3DC157E8-DC7F-4EDA-8E32-C838A05DA014'), 'offline');
  assert.equal(states.get('UNAVAILABLE-SIM'), 'offline');
  const devices = applySimulatorStates([
    { id: '7590322D-60F1-4644-A422-CD3EE35540A8', name: 'Booted', platform: 'ios', status: 'offline', simulator: true },
    { id: '3DC157E8-DC7F-4EDA-8E32-C838A05DA014', name: 'Shutdown', platform: 'ios', status: 'offline', simulator: true },
    { id: 'REAL-DEVICE', name: 'iPhone', platform: 'ios', status: 'device' },
  ], states);
  assert.deepEqual(devices.map((device) => device.status), ['device', 'offline', 'device']);
});

test('解析 adb 设备状态', () => {
  const output = `List of devices attached
emulator-5554 device product:sdk model:sdk_phone
abc123 unauthorized
xyz offline
`;
  assert.deepEqual(parseAdbDevices(output), [
    { id: 'emulator-5554', name: 'sdk phone', platform: 'android', status: 'device' },
    { id: 'abc123', name: 'abc123', platform: 'android', status: 'unauthorized' },
    { id: 'xyz', name: 'xyz', platform: 'android', status: 'offline' },
  ]);
});
