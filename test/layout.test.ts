import assert from 'node:assert/strict';
import test from 'node:test';
import { clampLayout, defaultLayout, layoutLimits, loadLayout, saveLayout, type PanelLayout } from '../src/layout.js';
import type { DraftStorage } from '../src/draft.js';

class MemoryStorage implements DraftStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('布局默认值与往返保存', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadLayout(storage), defaultLayout);
  saveLayout({ steps: 420, inspector: 500 }, storage);
  assert.deepEqual(loadLayout(storage), { steps: 420, inspector: 500 });
});

test('损坏数据与越界宽度被修正', () => {
  const storage = new MemoryStorage();
  storage.setItem('echobench:layout:v1', '{bad-json');
  assert.deepEqual(loadLayout(storage), defaultLayout);
  storage.setItem('echobench:layout:v1', JSON.stringify({ steps: 10, inspector: 9999 }));
  assert.deepEqual(loadLayout(storage), { steps: layoutLimits.steps.min, inspector: layoutLimits.inspector.max });
});

test('窄屏时自动压缩两列宽度', () => {
  const layout = clampLayout({ steps: 640, inspector: 700 }, 1100, 230);
  assert.ok(layout.steps + layout.inspector <= 1100 - 230 - 260 - 24);
  assert.ok(layout.steps >= layoutLimits.steps.min);
  assert.ok(layout.inspector >= layoutLimits.inspector.min);
});

test('宽屏时保持用户设置', () => {
  const input: PanelLayout = { steps: 520, inspector: 600 };
  assert.deepEqual(clampLayout(input, 1800, 290), input);
});

test('旧品牌布局自动迁移到 EchoBench 存储键', () => {
  const storage = new MemoryStorage();
  storage.setItem('app-step-studio:layout:v1', JSON.stringify({ steps: 400, inspector: 500 }));
  assert.deepEqual(loadLayout(storage), { steps: 400, inspector: 500 });
  assert.ok(storage.getItem('echobench:layout:v1'));
  assert.equal(storage.getItem('app-step-studio:layout:v1'), null);
});
