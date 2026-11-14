import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDraft, loadDraft, parseDraft, saveDraft, type DraftStorage } from '../src/draft.js';
import { defaultReplaySettings } from '../src/types.js';
import type { Step } from '../src/types.js';

class MemoryStorage implements DraftStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const tapStep: Step = {
  id: 's1',
  action: 'tap',
  description: '点击登录',
  target: {
    locator: { strategy: 'accessibility id', value: '登录' },
    coordinate: { xRatio: 0.5, yRatio: 0.8 },
  },
};

test('保存后可恢复最近一次记录', () => {
  const storage = new MemoryStorage();
  saveDraft({
    name: '登录流程',
    config: { platform: 'android', deviceId: 'emulator-5554', packageName: 'com.demo' },
    settings: { ...defaultReplaySettings, retries: 3 },
    steps: [tapStep],
  }, storage);
  const draft = loadDraft(storage);
  assert.ok(draft);
  assert.equal(draft.name, '登录流程');
  assert.equal(draft.config.deviceId, 'emulator-5554');
  assert.equal(draft.settings.retries, 3);
  assert.deepEqual(draft.steps, [tapStep]);
  assert.ok(draft.savedAt > 0);
});

test('步骤为空时删除缓存', () => {
  const storage = new MemoryStorage();
  saveDraft({ name: 'x', config: { platform: 'android', deviceId: '' }, settings: defaultReplaySettings, steps: [tapStep] }, storage);
  assert.ok(loadDraft(storage));
  saveDraft({ name: 'x', config: { platform: 'android', deviceId: '' }, settings: defaultReplaySettings, steps: [] }, storage);
  assert.equal(loadDraft(storage), null);
});

test('清空缓存后无法恢复', () => {
  const storage = new MemoryStorage();
  saveDraft({ name: 'x', config: { platform: 'android', deviceId: '' }, settings: defaultReplaySettings, steps: [tapStep] }, storage);
  clearDraft(storage);
  assert.equal(loadDraft(storage), null);
});

test('损坏的 JSON 与未知版本返回 null', () => {
  const storage = new MemoryStorage();
  storage.setItem('echobench:draft:v1', '{not-json');
  assert.equal(loadDraft(storage), null);
  storage.setItem('echobench:draft:v1', JSON.stringify({ version: 2, steps: [tapStep] }));
  assert.equal(loadDraft(storage), null);
});

test('无效步骤被丢弃，设置越界会被修正', () => {
  const draft = parseDraft({
    version: 1,
    savedAt: 123,
    name: '   ',
    config: { platform: 'ios', deviceId: 42 },
    settings: { timeout: 999999, retries: -5, settle: 'yes' },
    steps: [
      tapStep,
      { id: 'bad', action: 'tap', description: '缺目标' },
      { id: 'bad2', action: 'explode', description: '未知动作' },
    ],
  });
  assert.ok(draft);
  assert.equal(draft.name, '应用操作录制');
  assert.equal(draft.config.platform, 'ios');
  assert.equal(draft.config.deviceId, '');
  assert.equal(draft.settings.timeout, 120_000);
  assert.equal(draft.settings.retries, 0);
  assert.equal(draft.settings.settle, defaultReplaySettings.settle);
  assert.equal(draft.steps.length, 1);
  assert.equal(draft.steps[0].id, 's1');
});

test('没有任何有效步骤时不恢复', () => {
  assert.equal(parseDraft({ version: 1, steps: [{ id: 'x', action: 'tap', description: '缺目标' }] }), null);
});

test('旧品牌草稿自动迁移到 EchoBench 存储键', () => {
  const storage = new MemoryStorage();
  const legacy = JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    name: '旧品牌草稿',
    config: { platform: 'android', deviceId: 'emulator-5554' },
    settings: defaultReplaySettings,
    steps: [tapStep],
  });
  storage.setItem('app-step-studio:draft:v1', legacy);
  const draft = loadDraft(storage);
  assert.equal(draft?.name, '旧品牌草稿');
  assert.equal(storage.getItem('echobench:draft:v1'), legacy);
  assert.equal(storage.getItem('app-step-studio:draft:v1'), null);
});
