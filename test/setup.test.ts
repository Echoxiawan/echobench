import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInstallPlan } from '../server/setup.js';
import { systemInfoForPlatform } from '../server/system.js';

test('按操作系统生成对应安装方案', () => {
  const mac = systemInfoForPlatform('darwin', 'brew');
  const win = systemInfoForPlatform('win32', 'winget');
  const linux = systemInfoForPlatform('linux', 'apt');
  assert.equal(mac.capabilities.ios, true);
  assert.equal(win.capabilities.ios, false);
  assert.equal(linux.capabilities.ios, false);

  const macAdb = buildInstallPlan('adb', mac);
  assert.equal(macAdb?.commands[0].args.join(' '), 'install --cask android-platform-tools');
  const winAdb = buildInstallPlan('adb', win);
  assert.equal(winAdb?.commands[0].file, 'winget');
  assert.match(winAdb?.commands[0].args.join(' ') ?? '', /Google\.PlatformTools/);
  const linuxAdb = buildInstallPlan('adb', linux);
  assert.equal(linuxAdb?.commands.length, 0);
  assert.match(linuxAdb?.manual ?? '', /apt-get install -y adb/);

  const xcode = buildInstallPlan('xcode', mac);
  assert.match(xcode?.commands[0].args.join(' ') ?? '', /--install/);
  assert.equal(buildInstallPlan('xcode', win), null);
  assert.equal(buildInstallPlan('driver-xcuitest', win), null);
});

test('驱动安装使用项目内置 Appium', () => {
  const plan = buildInstallPlan('driver-uiautomator2', systemInfoForPlatform('darwin', 'brew'), '/project');
  assert.equal(plan?.commands[0].file, process.execPath);
  assert.match(plan?.commands[0].args.join(' ') ?? '', /driver install uiautomator2@8\.7\.0/);
});
