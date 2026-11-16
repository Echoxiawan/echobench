import assert from 'node:assert/strict';
import test from 'node:test';
import { runDoctor, type DoctorDeps } from '../server/doctor.js';

function doctorDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    projectRoot: process.cwd(),
    nodeVersion: 'v22.12.0',
    platform: 'darwin',
    packageManager: 'brew',
    env: {},
    adbExecutable: 'adb',
    fetchStatus: async () => true,
    scrcpyServer: async () => '/tools/scrcpy-server',
    exec: async (file) => {
      if (file === process.execPath) return { stdout: 'uiautomator2@8.7.0\nxcuitest@12.18.1', stderr: '' };
      if (file === 'adb') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
      if (file === 'scrcpy') return { stdout: 'scrcpy 3.2 <https://github.com/Genymobile/scrcpy>', stderr: '' };
      if (file === 'java') return { stdout: '', stderr: 'openjdk version "17.0.10" 2024-01-16' };
      if (file === 'xcode-select') return { stdout: '/Applications/Xcode.app/Contents/Developer', stderr: '' };
      if (file === 'xcrun') return { stdout: '== Devices ==\n    iPhone 15 (Booted)', stderr: '' };
      throw new Error(`未找到 ${file}`);
    },
    ...overrides,
  };
}

test('环境体检返回全部检查项与状态', async () => {
  const report = await runDoctor(doctorDeps());
  assert.ok(report.generatedAt > 0);
  assert.equal(report.checks.length, 10);
  assert.equal(report.system.osName, 'macOS');
  assert.equal(report.system.capabilities.ios, true);
  assert.equal(report.system.packageManager, 'brew');
  const byId = new Map(report.checks.map((check) => [check.id, check]));
  assert.equal(byId.get('node')?.status, 'ok');
  assert.equal(byId.get('appium')?.status, 'ok');
  assert.match(byId.get('driver-uiautomator2')?.detail ?? '', /uiautomator2@8\.7\.0/);
  assert.match(byId.get('driver-xcuitest')?.detail ?? '', /xcuitest@12\.18\.1/);
  assert.equal(byId.get('appium-server')?.status, 'ok');
  assert.equal(byId.get('adb')?.status, 'ok');
  assert.equal(byId.get('scrcpy')?.status, 'ok');
  assert.equal(byId.get('java')?.status, 'ok');
  assert.equal(byId.get('xcode')?.status, 'ok');
  assert.equal(byId.get('xcode')?.installable, true);
});

test('内置 scrcpy-server 时不依赖系统 scrcpy 命令', async () => {
  const report = await runDoctor(doctorDeps({
    exec: async (file) => {
      if (file === process.execPath) return { stdout: 'uiautomator2@8.7.0\nxcuitest@12.18.1', stderr: '' };
      if (file === 'adb') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
      if (file === 'scrcpy') throw new Error('scrcpy 未安装');
      if (file === 'java') return { stdout: '', stderr: 'openjdk version "17.0.10"' };
      if (file === 'xcode-select') return { stdout: '/Xcode', stderr: '' };
      if (file === 'xcrun') return { stdout: '', stderr: '' };
      throw new Error(`未找到 ${file}`);
    },
  }));
  const scrcpy = report.checks.find((check) => check.id === 'scrcpy');
  assert.equal(scrcpy?.status, 'ok');
  assert.match(scrcpy?.detail ?? '', /内置 scrcpy-server/);
});

test('使用内置 adb 时不再提示安装 Platform-Tools', async () => {
  const report = await runDoctor(doctorDeps({
    adbExecutable: '/bundle/adb',
    exec: async (file) => {
      if (file === process.execPath) return { stdout: 'uiautomator2@8.7.0\nxcuitest@12.18.1', stderr: '' };
      if (file === '/bundle/adb') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
      if (file === 'scrcpy') return { stdout: 'scrcpy 3.2', stderr: '' };
      if (file === 'java') return { stdout: '', stderr: 'openjdk version "17.0.10"' };
      if (file === 'xcode-select') return { stdout: '/Xcode', stderr: '' };
      if (file === 'xcrun') return { stdout: '', stderr: '' };
      throw new Error(`未找到 ${file}`);
    },
  }));
  const adb = report.checks.find((check) => check.id === 'adb');
  assert.equal(adb?.name, '内置 adb');
  assert.equal(adb?.status, 'ok');
  assert.equal(adb?.installable, false);
  assert.match(adb?.detail ?? '', /内置 Platform-Tools/);
});

test('缺失的必要依赖会标记为可安装', async () => {
  const report = await runDoctor(doctorDeps({
    exec: async (file) => {
      if (file === process.execPath) return { stdout: 'uiautomator2@8.7.0', stderr: '' };
      if (file === 'adb') throw new Error('adb 未安装');
      if (file === 'scrcpy') return { stdout: 'scrcpy 3.2', stderr: '' };
      if (file === 'java') throw new Error('java 未安装');
      if (file === 'xcode-select') return { stdout: '/Xcode', stderr: '' };
      if (file === 'xcrun') return { stdout: '', stderr: '' };
      throw new Error(`未找到 ${file}`);
    },
  }));
  const adb = report.checks.find((check) => check.id === 'adb');
  assert.equal(adb?.required, true);
  assert.equal(adb?.installable, true);
  assert.match(adb?.fix ?? '', /brew install/);
});

test('单项命令失败时降级为 fail 且不抛出', async () => {
  const report = await runDoctor(doctorDeps({
    exec: async (file) => {
      if (file === 'adb') throw new Error('adb 未安装');
      if (file === process.execPath) return { stdout: 'uiautomator2@8.7.0', stderr: '' };
      if (file === 'scrcpy') return { stdout: 'scrcpy 3.2', stderr: '' };
      if (file === 'java') return { stdout: 'openjdk 17', stderr: '' };
      if (file === 'xcode-select') return { stdout: '/Xcode', stderr: '' };
      if (file === 'xcrun') return { stdout: '', stderr: '' };
      throw new Error(`未找到 ${file}`);
    },
  }));
  const adb = report.checks.find((check) => check.id === 'adb');
  assert.equal(adb?.status, 'fail');
  assert.match(adb?.detail ?? '', /adb 未安装/);
});

test('Node 版本过低时判定失败', async () => {
  const report = await runDoctor(doctorDeps({ nodeVersion: 'v20.11.0' }));
  const node = report.checks.find((check) => check.id === 'node');
  assert.equal(node?.status, 'fail');
  assert.match(node?.fix ?? '', /22\.12/);
});

test('Windows 不检查 iOS 相关项并标记不支持 iOS', async () => {
  const report = await runDoctor(doctorDeps({
    platform: 'win32',
    packageManager: 'winget',
    exec: async (file) => {
      if (file === process.execPath) return { stdout: 'uiautomator2@8.7.0', stderr: '' };
      if (file === 'adb') throw new Error('adb missing');
      if (file === 'scrcpy') return { stdout: 'scrcpy 3.2', stderr: '' };
      if (file === 'java') return { stdout: 'openjdk 17', stderr: '' };
      throw new Error(`未找到 ${file}`);
    },
  }));
  assert.equal(report.system.osName, 'Windows');
  assert.equal(report.system.capabilities.ios, false);
  assert.equal(report.checks.some((check) => check.id === 'xcode'), false);
  assert.equal(report.checks.some((check) => check.id === 'driver-xcuitest'), false);
  const adb = report.checks.find((check) => check.id === 'adb');
  assert.match(adb?.fix ?? '', /winget install/);
});
