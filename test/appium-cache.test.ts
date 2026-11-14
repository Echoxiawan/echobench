import assert from 'node:assert/strict';
import test from 'node:test';
import { repairAppiumDriverPaths } from '../server/appium-cache.js';

test('项目目录改名后修复 Appium 驱动 installPath', () => {
  const manifest = `drivers:\n  xcuitest:\n    installPath: /old/place/node_modules/appium-xcuitest-driver\n  uiautomator2:\n    installPath: /old/place/node_modules/appium-uiautomator2-driver\nplugins: {}\n`;
  const result = repairAppiumDriverPaths(manifest, '/new/place/echobench');
  assert.equal(result.changed, true);
  assert.match(result.text, /installPath: \/new\/place\/echobench\/node_modules\/appium-xcuitest-driver/);
  assert.match(result.text, /installPath: \/new\/place\/echobench\/node_modules\/appium-uiautomator2-driver/);
});

test('路径已正确时不修改清单', () => {
  const manifest = `drivers:\n  xcuitest:\n    installPath: /project/node_modules/appium-xcuitest-driver\n`;
  const result = repairAppiumDriverPaths(manifest, '/project');
  assert.equal(result.changed, false);
  assert.equal(result.text, manifest);
});
