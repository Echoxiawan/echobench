import type { DraftStorage } from './draft.js';

const LAYOUT_KEY = 'echobench:layout:v1';
const LEGACY_LAYOUT_KEY = 'app-step-studio:layout:v1';

export interface PanelLayout {
  steps: number;
  inspector: number;
}

export const defaultLayout: PanelLayout = { steps: 320, inspector: 380 };
export const layoutLimits = {
  steps: { min: 240, max: 640 },
  inspector: { min: 280, max: 700 },
};

export function loadLayout(storage: DraftStorage | null = browserStorage()): PanelLayout {
  if (!storage) return { ...defaultLayout };
  try {
    const raw = storage.getItem(LAYOUT_KEY) ?? storage.getItem(LEGACY_LAYOUT_KEY);
    if (!raw) return { ...defaultLayout };
    const value = JSON.parse(raw) as Partial<PanelLayout>;
    const layout = {
      steps: clamp(value.steps, layoutLimits.steps, defaultLayout.steps),
      inspector: clamp(value.inspector, layoutLimits.inspector, defaultLayout.inspector),
    };
    if (!storage.getItem(LAYOUT_KEY)) {
      storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      storage.removeItem(LEGACY_LAYOUT_KEY);
    }
    return layout;
  } catch { return { ...defaultLayout }; }
}

export function saveLayout(layout: PanelLayout, storage: DraftStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify({
      steps: clamp(layout.steps, layoutLimits.steps, defaultLayout.steps),
      inspector: clamp(layout.inspector, layoutLimits.inspector, defaultLayout.inspector),
    }));
    storage.removeItem(LEGACY_LAYOUT_KEY);
  } catch { /* 本地存储不可用时忽略。 */ }
}

export function clampLayout(layout: PanelLayout, viewportWidth: number, deviceWidth: number, mirrorMin = 260): PanelLayout {
  const available = Math.max(layoutLimits.steps.min + layoutLimits.inspector.min, viewportWidth - deviceWidth - mirrorMin - 24);
  let steps = clamp(layout.steps, layoutLimits.steps, defaultLayout.steps);
  let inspector = clamp(layout.inspector, layoutLimits.inspector, defaultLayout.inspector);
  const overflow = steps + inspector - available;
  if (overflow > 0) inspector = Math.max(layoutLimits.inspector.min, inspector - overflow);
  const remaining = steps + inspector - available;
  if (remaining > 0) steps = Math.max(layoutLimits.steps.min, steps - remaining);
  return { steps, inspector };
}

function clamp(value: number | undefined, limits: { min: number; max: number }, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(limits.min, Math.min(limits.max, Math.round(value)))
    : fallback;
}

function browserStorage(): DraftStorage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
