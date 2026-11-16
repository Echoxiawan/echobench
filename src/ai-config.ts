import type { AiConfig } from './types';

const AI_CONFIG_KEY = 'echobench:ai:v1';
const LEGACY_AI_CONFIG_KEY = 'app-step-studio:ai:v1';
const AI_CONFIG_VERSION = 1;

export interface AiConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const emptyConfig: AiConfig = { baseUrl: '', model: '', apiKey: '' };

export function loadAiConfig(storage: AiConfigStorage | null = browserStorage()): AiConfig {
  if (!storage) return { ...emptyConfig };
  try {
    const raw = storage.getItem(AI_CONFIG_KEY) ?? storage.getItem(LEGACY_AI_CONFIG_KEY);
    if (!raw) return { ...emptyConfig };
    const config = parseAiConfig(JSON.parse(raw));
    if (config && !storage.getItem(AI_CONFIG_KEY)) {
      storage.setItem(AI_CONFIG_KEY, raw);
      storage.removeItem(LEGACY_AI_CONFIG_KEY);
    }
    return config ?? { ...emptyConfig };
  } catch { return { ...emptyConfig }; }
}

export function saveAiConfig(config: AiConfig, storage: AiConfigStorage | null = browserStorage()): AiConfig {
  // 设置页还包含语言等非 AI 配置；保存时不强制要求 AI 字段完整。
  const normalized = {
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
  };
  try {
    storage?.setItem(AI_CONFIG_KEY, JSON.stringify({
      version: AI_CONFIG_VERSION,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
      apiKey: normalized.apiKey,
      savedAt: Date.now(),
    }));
    storage?.removeItem(LEGACY_AI_CONFIG_KEY);
  } catch { /* 本地存储不可用时仍返回规范化配置，导出可以继续。 */ }
  return normalized;
}

export function clearAiConfig(storage: AiConfigStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(AI_CONFIG_KEY);
    storage?.removeItem(LEGACY_AI_CONFIG_KEY);
  } catch { /* 忽略存储异常。 */ }
}

export function parseAiConfig(value: unknown): AiConfig | null {
  if (!isObject(value) || value.version !== AI_CONFIG_VERSION) return null;
  const baseUrl = stringValue(value.baseUrl);
  const model = stringValue(value.model);
  const apiKey = stringValue(value.apiKey);
  return { baseUrl, model, apiKey };
}

export function normalizeAiConfig(config: AiConfig): AiConfig {
  const baseUrl = config.baseUrl.trim();
  const model = config.model.trim();
  const apiKey = config.apiKey.trim();
  if (!baseUrl) throw new Error('请填写 AI Base URL');
  if (!model) throw new Error('请填写 AI Model');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('AI Base URL 不是合法地址'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('AI Base URL 只支持 http/https');
  if (url.username || url.password) throw new Error('AI Base URL 不能包含用户名或密码');
  return { baseUrl, model, apiKey };
}

function browserStorage(): AiConfigStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
