import assert from 'node:assert/strict';
import test from 'node:test';
import { autoInstallCandidates } from '../src/setup-plan.js';
import type { DoctorCheck, DoctorReport, PackageManager, SystemInfo } from '../src/types.js';

function report(packageManager: PackageManager, checks: DoctorCheck[]): DoctorReport {
  const system: SystemInfo = {
    platform: packageManager === 'winget' ? 'win32' : packageManager === 'apt' ? 'linux' : 'darwin',
    osName: 'test',
    capabilities: { android: true, ios: packageManager === 'brew' },
    packageManager,
  };
  return { generatedAt: 0, system, checks };
}

function check(id: string, status: DoctorCheck['status'], required: boolean, installable: boolean): DoctorCheck {
  return { id, name: id, status, detail: '', required, installable };
}

test('macOS 有 brew 时自动安装必需的 adb 和 JDK', () => {
  const result = autoInstallCandidates(report('brew', [
    check('adb', 'fail', true, true),
    check('java', 'fail', true, true),
    check('driver-uiautomator2', 'ok', true, true),
  ]));
  assert.deepEqual(result, ['adb', 'java']);
});

test('Windows 使用 winget 自动安装 adb，不含 iOS 驱动', () => {
  const result = autoInstallCandidates(report('winget', [
    check('adb', 'fail', true, true),
    check('driver-uiautomator2', 'ok', true, true),
  ]));
  assert.deepEqual(result, ['adb']);
});

test('Linux 无 sudo 自动安装，仅自动补齐驱动', () => {
  const result = autoInstallCandidates(report('apt', [
    check('adb', 'fail', true, true),
    check('driver-uiautomator2', 'warn', true, true),
  ]));
  assert.deepEqual(result, ['driver-uiautomator2']);
});

test('存在无法自动安装的必需项时不做部分自动安装', () => {
  const result = autoInstallCandidates(report('brew', [
    check('appium', 'fail', true, false),
    check('adb', 'fail', true, true),
  ]));
  assert.equal(result, null);
});
