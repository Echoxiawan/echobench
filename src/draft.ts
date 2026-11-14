import type { Platform, ReplaySettings, SessionConfig, Step } from './types.js';
import { defaultReplaySettings } from './types.js';

const DRAFT_KEY = 'echobench:draft:v1';
const LEGACY_DRAFT_KEY = 'app-step-studio:draft:v1';
const DRAFT_VERSION = 1;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StudioDraft {
  version: 1;
  savedAt: number;
  name: string;
  config: SessionConfig;
  settings: ReplaySettings;
  steps: Step[];
}

export type DraftInput = Pick<StudioDraft, 'name' | 'config' | 'settings' | 'steps'>;

export function saveDraft(draft: DraftInput, storage: DraftStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    if (draft.steps.length === 0) {
      storage.removeItem(DRAFT_KEY);
      storage.removeItem(LEGACY_DRAFT_KEY);
      return;
    }
    const value: StudioDraft = { version: DRAFT_VERSION, savedAt: Date.now(), ...draft };
    storage.setItem(DRAFT_KEY, JSON.stringify(value));
    storage.removeItem(LEGACY_DRAFT_KEY);
  } catch { /* 本地存储不可用或已满时不影响录制。 */ }
}

export function loadDraft(storage: DraftStorage | null = browserStorage()): StudioDraft | null {
  if (!storage) return null;
  for (const [key, legacy] of [[DRAFT_KEY, false], [LEGACY_DRAFT_KEY, true]] as const) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = parseDraft(JSON.parse(raw));
      if (!parsed) continue;
      if (legacy) {
        storage.setItem(DRAFT_KEY, raw);
        storage.removeItem(LEGACY_DRAFT_KEY);
      }
      return parsed;
    } catch { /* 继续尝试旧键。 */ }
  }
  return null;
}

export function clearDraft(storage: DraftStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(DRAFT_KEY);
    storage?.removeItem(LEGACY_DRAFT_KEY);
  } catch { /* 忽略存储异常。 */ }
}

export function parseDraft(value: unknown): StudioDraft | null {
  if (!isObject(value)) return null;
  if (value.version !== DRAFT_VERSION) return null;
  if (!Array.isArray(value.steps)) return null;
  const steps = value.steps.filter(isStep);
  if (steps.length === 0) return null;
  const platform: Platform = value.config && isObject(value.config) && value.config.platform === 'ios' ? 'ios' : 'android';
  const rawConfig = isObject(value.config) ? value.config : {};
  const config: SessionConfig = {
    platform,
    deviceId: stringValue(rawConfig.deviceId),
    ...optional('app', rawConfig.app),
    ...optional('packageName', rawConfig.packageName),
    ...optional('activity', rawConfig.activity),
    ...optional('bundleId', rawConfig.bundleId),
    ...optional('xcodeOrgId', rawConfig.xcodeOrgId),
    ...optional('xcodeSigningId', rawConfig.xcodeSigningId),
    ...optional('wdaBundleId', rawConfig.wdaBundleId),
    allowProvisioning: rawConfig.allowProvisioning === true || rawConfig.allowProvisioning === 'true',
  };
  const rawSettings = isObject(value.settings) ? value.settings : {};
  const settings: ReplaySettings = {
    timeout: numberValue(rawSettings.timeout, defaultReplaySettings.timeout, 100, 120_000),
    settleTimeout: numberValue(rawSettings.settleTimeout, defaultReplaySettings.settleTimeout, 100, 60_000),
    retries: numberValue(rawSettings.retries, defaultReplaySettings.retries, 0, 10),
    retryDelay: numberValue(rawSettings.retryDelay, defaultReplaySettings.retryDelay, 0, 10_000),
    pollInterval: numberValue(rawSettings.pollInterval, defaultReplaySettings.pollInterval, 50, 5000),
    settle: booleanValue(rawSettings.settle, defaultReplaySettings.settle),
    stopOnFailure: booleanValue(rawSettings.stopOnFailure, defaultReplaySettings.stopOnFailure),
    coordinateFallback: booleanValue(rawSettings.coordinateFallback, defaultReplaySettings.coordinateFallback),
    requireApp: booleanValue(rawSettings.requireApp, defaultReplaySettings.requireApp),
    locatorFallback: booleanValue(rawSettings.locatorFallback, defaultReplaySettings.locatorFallback),
  };
  const name = typeof value.name === 'string' && value.name.trim() ? value.name : '应用操作录制';
  const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : Date.now();
  return { version: DRAFT_VERSION, savedAt, name, config, settings, steps };
}

function isStep(value: unknown): value is Step {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.description !== 'string') return false;
  const action = value.action;
  if (typeof action !== 'string') return false;
  switch (action) {
    case 'tap':
    case 'doubleTap':
      return isObject(value.target);
    case 'longPress':
      return isObject(value.target) && isFiniteNumber(value.duration);
    case 'pinch':
      return (value.direction === 'in' || value.direction === 'out')
        && isFiniteNumber(value.scale)
        && isFiniteNumber(value.duration)
        && (value.target === undefined || isObject(value.target));
    case 'input':
      return isObject(value.target) && typeof value.value === 'string' && typeof value.clearFirst === 'boolean';
    case 'swipe':
      return (value.direction === 'up' || value.direction === 'down' || value.direction === 'left' || value.direction === 'right')
        && isFiniteNumber(value.duration);
    case 'back':
      return true;
    case 'wait':
      return isFiniteNumber(value.timeout) && (value.target === undefined || isObject(value.target));
    default:
      return false;
  }
}

function browserStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch { return null; }
}

function optional<K extends keyof SessionConfig>(key: K, value: unknown): Partial<SessionConfig> {
  return typeof value === 'string' && value ? { [key]: value } as Partial<SessionConfig> : {};
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  return isFiniteNumber(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
