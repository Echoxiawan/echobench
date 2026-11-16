import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConnectionDiagnostic, connectionEnvironmentError, missingConnectionChecks } from '../src/connection-diagnostic.js';
import type { DoctorReport } from '../src/types.js';

function report(checks: DoctorReport['checks']): DoctorReport {
  return {
    generatedAt: Date.now(),
    system: { platform: 'win32', osName: 'Windows', capabilities: { android: true, ios: false }, packageManager: 'winget' },
    checks,
  };
}

test('缺少 Android SDK 时返回可读的连接环境错误', () => {
  const value = report([
    { id: 'node', name: 'Node.js 版本', status: 'ok', detail: 'v22', required: true },
    { id: 'appium', name: '内置 Appium', status: 'ok', detail: 'appium@3', required: true },
    { id: 'driver-uiautomator2', name: 'UiAutomator2 驱动', status: 'ok', detail: 'uiautomator2@8', required: true },
    { id: 'adb', name: '内置 adb', status: 'ok', detail: 'adb', required: true },
    { id: 'android-sdk', name: 'Android SDK', status: 'warn', detail: '未找到', fix: '安装 Android Studio 并设置 ANDROID_HOME', required: true },
    { id: 'java', name: 'Java / JDK', status: 'ok', detail: 'jdk17', required: true },
  ]);
  assert.match(connectionEnvironmentError(value, 'android') ?? '', /Android SDK/);
  assert.equal(missingConnectionChecks(value, 'android')[0]?.name, 'Android SDK');
});

test('设备未授权时生成授权修复建议', () => {
  const value = buildConnectionDiagnostic('Error: device unauthorized', report([]), 'android');
  assert.match(value.summary, /尚未授权 USB 调试/);
  assert.match(value.suggestions.join('\n'), /允许/);
});

test('Android SDK 错误被转换成人可读原因', () => {
  const value = buildConnectionDiagnostic('Could not find ANDROID_HOME or Android SDK', report([]), 'android');
  assert.match(value.summary, /Android SDK/);
  assert.match(value.suggestions.join('\n'), /ANDROID_HOME/);
});
