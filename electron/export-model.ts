import type { Locator, LocatorStrategy, ProjectScript, ReplaySettings, Step, StepPolicy } from '../src/types.js';
import { defaultReplaySettings } from '../src/types.js';
import { fallbackLocators } from './locator.js';
import { resolvePolicy } from './replay.js';

export interface PlannedStep {
  action: Step['action'];
  description: string;
  locators: Locator[];
  coordinate?: { xRatio: number; yRatio: number };
  value?: string;
  clearFirst?: boolean;
  secret?: boolean;
  direction?: string;
  duration?: number;
  scale?: number;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  condition?: string;
  expect?: string;
  match?: string;
  timeout?: number;
  policy: Required<StepPolicy>;
}

export interface ScriptPlan {
  platform: ProjectScript['platform'];
  capabilities: Record<string, string>;
  settings: ReplaySettings;
  expectedApp?: string;
  steps: PlannedStep[];
}

export function buildPlan(script: ProjectScript): ScriptPlan {
  const settings: ReplaySettings = { ...defaultReplaySettings, ...script.replay };
  const steps: PlannedStep[] = script.steps.map((step) => planStep(step, settings));
  return {
    platform: script.platform,
    capabilities: script.capabilities,
    settings,
    expectedApp: script.capabilities.appPackage || script.capabilities.bundleId,
    steps,
  };
}

function planStep(step: Step, settings: ReplaySettings): PlannedStep {
  const policy = resolvePolicy(settings, step);
  const target = 'target' in step ? step.target : undefined;
  const locators = target?.locator
    ? policy.locatorFallback
      ? fallbackLocators(target)
      : [target.locator]
    : [];
  const base: PlannedStep = {
    action: step.action,
    description: step.description,
    locators,
    policy,
    coordinate: target?.coordinate,
  };
  if (step.action === 'input') return { ...base, value: step.value, clearFirst: step.clearFirst, secret: step.secret };
  if (step.action === 'swipe') return { ...base, direction: step.direction, duration: step.duration, start: step.start, end: step.end };
  if (step.action === 'longPress') return { ...base, duration: step.duration };
  if (step.action === 'pinch') return { ...base, direction: step.direction, duration: step.duration, scale: step.scale };
  if (step.action === 'wait') return { ...base, condition: step.condition ?? 'exists', expect: step.expect, match: step.match, timeout: step.timeout };
  return base;
}

export const STRATEGIES: LocatorStrategy[] = ['accessibility id', 'id', '-android uiautomator', '-ios predicate string', '-ios class chain', 'xpath'];

export function jsSelector(locator: Locator): string {
  switch (locator.strategy) {
    case 'accessibility id': return `~${locator.value}`;
    case 'id': return `id=${locator.value}`;
    case '-android uiautomator': return `android=${locator.value}`;
    case '-ios predicate string': return `-ios predicate string:${locator.value}`;
    case '-ios class chain': return `-ios class chain:${locator.value}`;
    default: return locator.value;
  }
}

export function pythonSelector(locator: Locator): string {
  const by = ({
    'accessibility id': 'AppiumBy.ACCESSIBILITY_ID',
    id: 'AppiumBy.ID',
    '-android uiautomator': 'AppiumBy.ANDROID_UIAUTOMATOR',
    '-ios predicate string': 'AppiumBy.IOS_PREDICATE',
    '-ios class chain': 'AppiumBy.IOS_CLASS_CHAIN',
    xpath: 'AppiumBy.XPATH',
  } as Record<LocatorStrategy, string>)[locator.strategy];
  return `${by}, ${pythonString(locator.value)}`;
}

export function javaSelector(locator: Locator): string {
  switch (locator.strategy) {
    case 'accessibility id': return `AppiumBy.accessibilityId(${javaString(locator.value)})`;
    case 'id': return `AppiumBy.id(${javaString(locator.value)})`;
    case '-android uiautomator': return `AppiumBy.androidUIAutomator(${javaString(locator.value)})`;
    case '-ios predicate string': return `AppiumBy.iOSNsPredicateString(${javaString(locator.value)})`;
    case '-ios class chain': return `AppiumBy.iOSClassChain(${javaString(locator.value)})`;
    default: return `AppiumBy.xpath(${javaString(locator.value)})`;
  }
}

export function pythonString(value: string): string {
  return JSON.stringify(value);
}

export function javaString(value: string): string {
  return JSON.stringify(value);
}

export function pythonLiteral(value: unknown): string {
  return JSON.stringify(value);
}
