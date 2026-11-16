import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAiConfig, loadAiConfig, normalizeAiConfig, saveAiConfig, type AiConfigStorage } from '../src/ai-config.js';

class MemoryStorage implements AiConfigStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('AI 配置只保存到浏览器存储并可恢复', () => {
  const storage = new MemoryStorage();
  const saved = saveAiConfig({ baseUrl: ' https://api.openai.com/v1 ', model: ' gpt-4o-mini ', apiKey: ' sk-test ' }, storage);
  assert.deepEqual(saved, { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' });
  assert.deepEqual(loadAiConfig(storage), saved);
});

test('AI 配置损坏或版本不匹配时回到空配置', () => {
  const storage = new MemoryStorage();
  storage.setItem('echobench:ai:v1', '{not-json');
  assert.deepEqual(loadAiConfig(storage), { baseUrl: '', model: '', apiKey: '' });
  storage.setItem('echobench:ai:v1', JSON.stringify({ version: 2, baseUrl: 'https://x', model: 'm', apiKey: '' }));
  assert.deepEqual(loadAiConfig(storage), { baseUrl: '', model: '', apiKey: '' });
});

test('保存设置不要求 AI 字段完整', () => {
  const storage = new MemoryStorage();
  const saved = saveAiConfig({ baseUrl: '', model: '', apiKey: '' }, storage);
  assert.deepEqual(saved, { baseUrl: '', model: '', apiKey: '' });
  assert.deepEqual(loadAiConfig(storage), saved);
  const partial = saveAiConfig({ baseUrl: 'https://example.com/v1', model: '', apiKey: '' }, storage);
  assert.deepEqual(loadAiConfig(storage), partial);
});

test('清空 AI 配置后不残留 Key', () => {
  const storage = new MemoryStorage();
  saveAiConfig({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, storage);
  clearAiConfig(storage);
  assert.deepEqual(loadAiConfig(storage), { baseUrl: '', model: '', apiKey: '' });
});

test('AI 配置校验 Base URL 和 Model', () => {
  assert.throws(() => normalizeAiConfig({ baseUrl: '', model: 'm', apiKey: '' }), /Base URL/);
  assert.throws(() => normalizeAiConfig({ baseUrl: 'not-a-url', model: 'm', apiKey: '' }), /合法地址/);
  assert.throws(() => normalizeAiConfig({ baseUrl: 'ftp://example.com/v1', model: 'm', apiKey: '' }), /http\/https/);
  assert.throws(() => normalizeAiConfig({ baseUrl: 'https://user:pass@example.com/v1', model: 'm', apiKey: '' }), /用户名或密码/);
  assert.throws(() => normalizeAiConfig({ baseUrl: 'https://example.com/v1', model: '', apiKey: '' }), /Model/);
});

test('旧品牌 AI 配置自动迁移到 EchoBench 存储键', () => {
  const storage = new MemoryStorage();
  const legacy = JSON.stringify({ version: 1, baseUrl: 'https://example.com/v1', model: 'demo', apiKey: 'secret' });
  storage.setItem('app-step-studio:ai:v1', legacy);
  assert.deepEqual(loadAiConfig(storage), { baseUrl: 'https://example.com/v1', model: 'demo', apiKey: 'secret' });
  assert.equal(storage.getItem('echobench:ai:v1'), legacy);
  assert.equal(storage.getItem('app-step-studio:ai:v1'), null);
});
