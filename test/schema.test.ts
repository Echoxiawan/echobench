import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScript, stringifyScript } from '../electron/script.js';
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
