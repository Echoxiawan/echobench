import assert from 'node:assert/strict';
import test from 'node:test';
import { locatorKey } from '../electron/locator.js';
import { runReplay, type ReplayAdapter } from '../electron/replay.js';
import type { Locator, LocatorCandidate, ProjectScript, Step, Target } from '../src/types.js';
import { defaultReplaySettings } from '../src/types.js';

interface FakeElement { id: string; displayed: boolean; enabled: boolean; text: string; attrs: Record<string, string> }

class FakeAdapter implements ReplayAdapter {
  matches = new Map<string, string[]>();
  elements = new Map<string, FakeElement>();
  clicks: string[] = [];
  gestures: string[] = [];
  failGesture = false;

  session() { return { sessionId: 'session', width: 1080, height: 1920, platform: 'android' as const }; }
  private ids(locator: Locator) { return this.matches.get(locatorKey(locator)) ?? []; }
  async findElement(locator: Locator) { return this.ids(locator)[0] ?? null; }
  async findElements(locator: Locator) { return this.ids(locator); }
  async elementReady(id: string) { const element = this.elements.get(id); return { displayed: element?.displayed ?? true, enabled: element?.enabled ?? true }; }
  async elementValue(id: string) { const element = this.elements.get(id); return { text: element?.text ?? null, password: false }; }
  async elementAttribute(id: string, name: string) {
    const element = this.elements.get(id);
    if (!element || !(name in element.attrs)) throw new Error(`不支持属性 ${name}`);
    return element.attrs[name];
  }
  async click(id: string) { this.clicks.push(id); }
  async tapAt() { this.clicks.push('tap-point'); }
  async setValue() { /* 测试不校验输入。 */ }
  async doubleTap() { this.gestures.push('doubleTap'); if (this.failGesture) throw new Error('手势失败'); }
  async longPress() { this.gestures.push('longPress'); }
  async pinch() { this.gestures.push('pinch'); }
  async swipe() { this.gestures.push('swipe'); }
  async back() { this.gestures.push('back'); }
  async pageSource() { return 'stable-page'; }
  async currentApp() { return 'com.other'; }
}

function locator(strategy: Locator['strategy'], value: string): Locator { return { strategy, value }; }
function candidate(value: Locator, overrides: Partial<LocatorCandidate> = {}): LocatorCandidate {
  return { locator: value, matches: 1, unique: true, score: 100, role: 'recommended', source: 'attribute', ...overrides };
}
function target(locators: Locator[], candidates: LocatorCandidate[] = [], coordinate = { xRatio: 0.5, yRatio: 0.5 }): Target {
  return { locator: locators[0], coordinate, candidates };
}
function script(steps: Step[], replay: Partial<ProjectScript['replay']> = {}, capabilities: Record<string, string> = {}): ProjectScript {
  return {
    version: 1,
    name: '测试',
    platform: 'android',
    capabilities,
    replay: { ...defaultReplaySettings, timeout: 300, retries: 0, retryDelay: 10, pollInterval: 20, settle: false, requireApp: false, locatorFallback: true, ...replay },
    steps,
  };
}

test('主定位失效时降级到唯一候选', async () => {
  const adapter = new FakeAdapter();
  const primary = locator('id', 'primary');
  const alternative = locator('accessibility id', 'alt');
  adapter.matches.set(locatorKey(primary), []);
  adapter.matches.set(locatorKey(alternative), ['alt-1']);
  adapter.elements.set('alt-1', { id: 'alt-1', displayed: true, enabled: true, text: '', attrs: {} });
  const step: Step = { id: 's1', action: 'tap', description: '点击', target: target([primary], [candidate(alternative)]) };
  const report = await runReplay(adapter, script([step]), () => undefined);
  assert.equal(report.status, 'passed');
  assert.deepEqual(adapter.clicks, ['alt-1']);
});

test('主定位匹配多个元素时改用唯一候选', async () => {
  const adapter = new FakeAdapter();
  const primary = locator('id', 'primary');
  const alternative = locator('accessibility id', 'alt');
  adapter.matches.set(locatorKey(primary), ['p1', 'p2']);
  adapter.matches.set(locatorKey(alternative), ['alt-1']);
  adapter.elements.set('alt-1', { id: 'alt-1', displayed: true, enabled: true, text: '', attrs: {} });
  const step: Step = { id: 's1', action: 'tap', description: '点击', target: target([primary], [candidate(alternative)]) };
  const report = await runReplay(adapter, script([step]), () => undefined);
  assert.equal(report.status, 'passed');
  assert.deepEqual(adapter.clicks, ['alt-1']);
});

test('关闭候选降级时保持单定位器行为', async () => {
  const adapter = new FakeAdapter();
  const primary = locator('id', 'primary');
  adapter.matches.set(locatorKey(primary), ['p1', 'p2']);
  const step: Step = { id: 's1', action: 'tap', description: '点击', target: target([primary]) };
  const report = await runReplay(adapter, script([step], { locatorFallback: false }), () => undefined);
  assert.equal(report.status, 'passed');
  assert.deepEqual(adapter.clicks, ['p1']);
});

test('checked / empty / hidden / disabled 断言通过', async () => {
  const adapter = new FakeAdapter();
  const checked = locator('id', 'checkbox');
  adapter.matches.set(locatorKey(checked), ['c1']);
  adapter.elements.set('c1', { id: 'c1', displayed: true, enabled: false, text: '', attrs: { checked: 'true' } });
  const steps: Step[] = [
    { id: 's1', action: 'wait', description: '已选中', condition: 'checked', target: target([checked]), timeout: 200 },
    { id: 's2', action: 'wait', description: '为空', condition: 'empty', target: target([checked]), timeout: 200 },
    { id: 's3', action: 'wait', description: '已禁用', condition: 'disabled', target: target([checked]), timeout: 200 },
    { id: 's4', action: 'wait', description: '隐藏', condition: 'hidden', target: target([locator('id', 'missing')]), timeout: 200 },
  ];
  const report = await runReplay(adapter, script(steps), () => undefined);
  assert.equal(report.status, 'passed', report.results.map((result) => result.message).join('；'));
});

test('unchecked 断言在已选中时失败', async () => {
  const adapter = new FakeAdapter();
  const checkbox = locator('id', 'checkbox');
  adapter.matches.set(locatorKey(checkbox), ['c1']);
  adapter.elements.set('c1', { id: 'c1', displayed: true, enabled: true, text: '', attrs: { checked: 'true' } });
  const step: Step = { id: 's1', action: 'wait', description: '未选中', condition: 'unchecked', target: target([checkbox]), timeout: 120 };
  const report = await runReplay(adapter, script([step]), () => undefined);
  assert.equal(report.status, 'failed');
  assert.match(report.results[0].message ?? '', /等待条件超时/);
});

test('手势步骤发出后不自动重试', async () => {
  const adapter = new FakeAdapter();
  adapter.failGesture = true;
  const targetValue = target([locator('accessibility id', 'item')]);
  adapter.matches.set(locatorKey(targetValue.locator!), ['e1']);
  adapter.elements.set('e1', { id: 'e1', displayed: true, enabled: true, text: '', attrs: {} });
  const step: Step = { id: 's1', action: 'doubleTap', description: '双击', target: targetValue };
  const report = await runReplay(adapter, script([step], { retries: 3 }), () => undefined);
  assert.equal(report.status, 'failed');
  assert.deepEqual(adapter.gestures, ['doubleTap']);
});

test('长按与 pinch 正确委派', async () => {
  const adapter = new FakeAdapter();
  const targetValue = target([locator('accessibility id', 'item')]);
  adapter.matches.set(locatorKey(targetValue.locator!), ['e1']);
  adapter.elements.set('e1', { id: 'e1', displayed: true, enabled: true, text: '', attrs: {} });
  const steps: Step[] = [
    { id: 's1', action: 'longPress', description: '长按', duration: 800, target: targetValue },
    { id: 's2', action: 'pinch', description: '放大', direction: 'out', scale: 2, duration: 600, target: targetValue },
  ];
  const report = await runReplay(adapter, script(steps), () => undefined);
  assert.equal(report.status, 'passed');
  assert.deepEqual(adapter.gestures, ['longPress', 'pinch']);
});

test('从指定步骤开始回放时跳过前面的步骤', async () => {
  const adapter = new FakeAdapter();
  const first = locator('accessibility id', 'first');
  const second = locator('accessibility id', 'second');
  adapter.matches.set(locatorKey(first), ['e1']);
  adapter.matches.set(locatorKey(second), ['e2']);
  adapter.elements.set('e1', { id: 'e1', displayed: true, enabled: true, text: '', attrs: {} });
  adapter.elements.set('e2', { id: 'e2', displayed: true, enabled: true, text: '', attrs: {} });
  const steps: Step[] = [
    { id: 's1', action: 'tap', description: '第一步', target: target([first]) },
    { id: 's2', action: 'tap', description: '第二步', target: target([second]) },
  ];
  const report = await runReplay(adapter, script(steps), () => undefined, 1);
  assert.equal(report.status, 'passed');
  assert.equal(report.startIndex, 1);
  assert.equal(report.results[0].status, 'skipped');
  assert.equal(report.results[1].status, 'passed');
  assert.deepEqual(adapter.clicks, ['e2']);
});

test('前台应用不匹配时在第一步失败', async () => {
  const adapter = new FakeAdapter();
  const step: Step = { id: 's1', action: 'tap', description: '点击', target: target([locator('id', 'button')]) };
  adapter.matches.set(locatorKey(locator('id', 'button')), ['b1']);
  adapter.elements.set('b1', { id: 'b1', displayed: true, enabled: true, text: '', attrs: {} });
  const report = await runReplay(adapter, script([step], { requireApp: true }, { appPackage: 'com.demo' }), () => undefined);
  assert.equal(report.status, 'failed');
  assert.match(report.results[0].message ?? '', /目标应用未在前台/);
  assert.deepEqual(adapter.clicks, []);
});
