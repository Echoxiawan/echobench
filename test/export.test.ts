import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateJava } from '../electron/export-java.js';
import { generatePython } from '../electron/export-python.js';
import { generateJavaScript } from '../electron/script.js';
import type { Locator, LocatorCandidate, ProjectScript } from '../src/types.js';

const primary: Locator = { strategy: 'accessibility id', value: 'login' };
const alternative: Locator = { strategy: '-ios class chain', value: '**/XCUIElementTypeButton[`name == "login"`]' };
const candidate: LocatorCandidate = { locator: alternative, matches: 1, unique: true, score: 80, role: 'alternative', source: 'semantic' };
const target = {
  locator: primary,
  label: '登录',
  coordinate: { xRatio: 0.5, yRatio: 0.82 },
  candidates: [candidate],
};

const script: ProjectScript = {
  version: 1,
  name: '导出测试',
  platform: 'ios',
  capabilities: { udid: 'device-1', bundleId: 'com.demo.app' },
  replay: { locatorFallback: true, retries: 1, timeout: 5000 },
  steps: [
    { id: 's1', action: 'tap', description: '点击登录', target },
    { id: 's2', action: 'doubleTap', description: '双击', target },
    { id: 's3', action: 'longPress', description: '长按', duration: 800, target },
    { id: 's4', action: 'pinch', description: '放大', direction: 'out', scale: 2, duration: 600, target },
    { id: 's5', action: 'input', description: '输入用户名', target, value: 'demo', clearFirst: true },
    { id: 's6', action: 'swipe', description: '上滑', direction: 'up', duration: 520, start: { x: 540, y: 1500 }, end: { x: 540, y: 500 } },
    { id: 's7', action: 'back', description: '返回' },
    { id: 's8', action: 'wait', description: '等待选中', condition: 'checked', timeout: 3000, target },
  ],
};

test('JavaScript 导出只包含选定的定位器、手势与断言', () => {
  const output = generateJavaScript(script);
  for (const expected of ['const waitCondition', 'checkedState', 'doubleTap', 'longPress', 'pinch']) {
    assert.ok(output.includes(expected), `缺少 ${expected}`);
  }
  assert.ok(!output.includes('**/XCUIElementTypeButton[`name == "login"`]'), '不应导出备选候选定位器');
  assert.ok(!output.includes('"candidates"'), '不应导出候选定位器列表');
  assert.ok(!output.includes('locatorFallback'), '不应导出候选降级开关');
  assert.ok(!output.includes('coordinateFallback'), '不应导出坐标兜底开关');
  const start = output.indexOf('const script = ') + 'const script = '.length;
  const end = output.indexOf(';\nconst defaults');
  const exported = JSON.parse(output.slice(start, end));
  assert.deepEqual(exported.steps[0].target, { label: '登录', locator: primary });
  assert.equal(exported.steps.at(-1).condition, 'checked');
  assert.ok(!/NaN|\[object Object\]/.test(output));
});

test('Python 导出只包含选定的定位器、手势与断言', () => {
  const output = generatePython(script);
  for (const expected of ['AppiumBy.IOS_CLASS_CHAIN', 'def wait_target', 'def wait_condition', 'checked_state', 'mobile: doubleClickGesture', 'json.loads']) {
    assert.ok(output.includes(expected), `缺少 ${expected}`);
  }
  assert.ok(!output.includes('**/XCUIElementTypeButton[`name == "login"`]'), '不应导出备选候选定位器');
  assert.ok(!output.includes('"candidates"'), '不应导出候选定位器列表');
  assert.ok(!output.includes('locatorFallback'), '不应导出候选降级开关');
  assert.ok(!output.includes('coordinateFallback'), '不应导出坐标兜底开关');
  const start = output.indexOf('PLAN = json.loads(') + 'PLAN = json.loads('.length;
  const end = output.indexOf(')\nPLATFORM', start);
  const plan = JSON.parse(JSON.parse(output.slice(start, end)));
  assert.deepEqual(plan.steps[0].locator, primary);
  assert.equal(plan.steps[0].locators, undefined);
  assert.equal(plan.steps[0].policy.locatorFallback, undefined);
  assert.equal(plan.steps[0].coordinate, undefined);
  assert.ok(!/NaN|\[object Object\]/.test(output));
});

test('Java 导出只包含选定的定位器、记录类型与手势', () => {
  const output = generateJava(script);
  for (const expected of ['AppiumBy.iOSClassChain', 'record Step', 'waitCondition', 'mobile: doubleClickGesture']) {
    assert.ok(output.includes(expected), `缺少 ${expected}`);
  }
  assert.ok(!output.includes('**/XCUIElementTypeButton[`name == "login"`]'), '不应导出备选候选定位器');
  assert.ok(!output.includes('candidates'), '不应导出候选定位器列表');
  assert.ok(!output.includes('locatorFallback'), '不应导出候选降级开关');
  assert.ok(!output.includes('coordinateFallback'), '不应导出坐标兜底开关');
  assert.ok(output.includes(`new Loc("accessibility id", "login")`), '应导出选定的定位器');
  assert.ok(!/undefined|NaN|\[object Object\]/.test(output));
  assert.equal((output.match(/new Step\(/g) ?? []).length, script.steps.length);
  assert.equal(count(output, '{'), count(output, '}'), '花括号应平衡');
  assert.equal(count(output, '('), count(output, ')'), '圆括号应平衡');
});

test('Python 产物通过 py_compile 语法校验', (t) => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); }
  catch { t.skip('python3 不可用'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'echobench-'));
  try {
    const file = join(dir, 'app_steps.py');
    writeFileSync(file, generatePython(script), 'utf8');
    execFileSync('python3', ['-m', 'py_compile', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function count(value: string, token: string): number {
  return value.split(token).length - 1;
}
