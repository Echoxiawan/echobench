import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScript, stringifyExportScript, stringifyScript } from '../electron/script.js';
import { defaultReplaySettings } from '../src/types.js';

const legacyYaml = `version: 1
name: 旧脚本
platform: android
capabilities:
  udid: emulator-5554
steps:
  - id: step-1
    action: tap
    description: 点击登录
    target:
      locator:
        strategy: accessibility id
        value: 登录
      coordinate:
        xRatio: 0.5
        yRatio: 0.8
`;

test('旧版 v1 YAML 无需新字段即可解析', () => {
  const script = parseScript(legacyYaml);
  assert.equal(script.steps.length, 1);
  assert.equal(script.replay, undefined);
  assert.equal(defaultReplaySettings.locatorFallback, true);
});

test('新手势、断言与候选定位器可往返序列化', () => {
  const yaml = `version: 1
name: 新脚本
platform: ios
capabilities:
  bundleId: com.demo.app
replay:
  locatorFallback: false
steps:
  - id: s1
    action: doubleTap
    description: 双击
    note: 关键步骤
    target:
      locator:
        strategy: accessibility id
        value: item
      warning: 页面重复元素
      candidates:
        - locator:
            strategy: accessibility id
            value: item
          matches: 1
          unique: true
          score: 100
          role: recommended
          source: attribute
          verified: true
  - id: s2
    action: longPress
    description: 长按
    duration: 800
    target:
      locator:
        strategy: id
        value: item
  - id: s3
    action: pinch
    description: 放大
    direction: out
    scale: 2
    duration: 600
  - id: s4
    action: wait
    description: 等待选中
    condition: checked
    timeout: 3000
    target:
      locator:
        strategy: xpath
        value: //*[@name="check"]
`;
  const script = parseScript(yaml);
  assert.equal(script.steps.length, 4);
  assert.equal(script.replay?.locatorFallback, false);
  assert.equal(script.steps[0].note, '关键步骤');
  assert.equal(script.steps[0].target.candidates?.[0].role, 'recommended');
  assert.equal(script.steps[0].target.candidates?.[0].verified, true);
  assert.equal(script.steps[0].target.warning, '页面重复元素');
  const roundTrip = parseScript(stringifyScript(script));
  assert.deepEqual(roundTrip, script);
});

test('密码输入步骤的 secret 字段可往返', () => {
  const yaml = `version: 1
name: 密码
platform: android
capabilities: {}
steps:
  - id: pwd
    action: input
    description: 输入密码
    value: s3cret
    clearFirst: true
    secret: true
    target:
      locator:
        strategy: id
        value: com.demo:id/editPwd
`;
  const script = parseScript(yaml);
  const step = script.steps[0];
  assert.equal(step.action, 'input');
  if (step.action === 'input') {
    assert.equal(step.secret, true);
    assert.equal(step.value, 's3cret');
  }
  assert.deepEqual(parseScript(stringifyScript(script)), script);
});

test('导出 YAML 只保留选定的定位方式和显式断言', () => {
  const yaml = `version: 1
name: 导出脚本
platform: android
capabilities: {}
replay:
  timeout: 5000
  locatorFallback: true
  coordinateFallback: true
steps:
  - id: s1
    action: tap
    description: 点击登录
    policy:
      timeout: 3000
      locatorFallback: true
      coordinateFallback: true
    target:
      label: 登录
      locator:
        strategy: accessibility id
        value: 登录
      coordinate:
        xRatio: 0.5
        yRatio: 0.8
      bounds:
        x: 10
        y: 20
        width: 30
        height: 40
      warning: 页面存在重复元素
      verifiedAt: 1730000000000
      candidates:
        - locator:
            strategy: id
            value: com.demo:id/login
          matches: 1
          unique: true
          score: 90
          role: alternative
          source: resource-id
  - id: s2
    action: wait
    description: 等待登录完成
    timeout: 3000
    target:
      locator:
        strategy: id
        value: com.demo:id/home
`;
  const exported = parseScript(stringifyExportScript(parseScript(yaml)));
  const target = exported.steps[0].target;
  assert.deepEqual(target, { label: '登录', locator: { strategy: 'accessibility id', value: '登录' } });
  assert.equal(exported.steps[0].policy?.timeout, 3000);
  assert.equal(exported.steps[0].policy?.locatorFallback, undefined);
  assert.equal(exported.steps[0].policy?.coordinateFallback, undefined);
  assert.equal(exported.replay?.timeout, 5000);
  assert.equal(exported.replay?.locatorFallback, undefined);
  assert.equal(exported.replay?.coordinateFallback, undefined);
  const assertion = exported.steps[1];
  assert.equal(assertion.action, 'wait');
  if (assertion.action === 'wait') {
    assert.equal(assertion.condition, 'exists');
    assert.equal(assertion.expect, undefined);
    assert.equal(assertion.match, undefined);
  }
});

test('文本断言缺少期望值时不生成导出 YAML', () => {
  const script = parseScript(`version: 1
name: 无效断言
platform: android
capabilities: {}
steps:
  - id: s1
    action: wait
    description: 等待文案
    condition: text
    timeout: 3000
    target:
      locator:
        strategy: id
        value: com.demo:id/title
`);
  assert.throws(() => stringifyExportScript(script), /必须填写期望值/);
});

test('只有坐标的步骤保留坐标，缺少定位方式的步骤拒绝导出', () => {
  const coordinateScript = parseScript(`version: 1
name: 坐标步骤
platform: android
capabilities: {}
steps:
  - id: s1
    action: tap
    description: 点击画布
    target:
      label: 画布
      coordinate:
        xRatio: 0.25
        yRatio: 0.75
      candidates:
        - locator:
            strategy: xpath
            value: //*[@bounds="[1,2][3,4]"]
          matches: 1
          unique: false
          score: 20
          role: brittle
          source: xpath
`);
  const exported = parseScript(stringifyExportScript(coordinateScript));
  assert.deepEqual(exported.steps[0].target, { label: '画布', coordinate: { xRatio: 0.25, yRatio: 0.75 } });

  const missingTarget = parseScript(`version: 1
name: 缺少定位
platform: android
capabilities: {}
steps:
  - id: s1
    action: tap
    description: 点击未知目标
    target: {}
`);
  assert.throws(() => stringifyExportScript(missingTarget), /没有选定的定位方式/);
});

test('未知定位策略与未知动作被拒绝', () => {
  assert.throws(() => parseScript(`version: 1
name: bad
platform: android
capabilities: {}
steps:
  - id: s1
    action: tap
    description: 点击
    target:
      locator:
        strategy: magic
        value: x
`));
  assert.throws(() => parseScript(`version: 1
name: bad
platform: android
capabilities: {}
steps:
  - id: s1
    action: explode
    description: 未知
`));
});
