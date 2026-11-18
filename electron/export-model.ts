import type { Locator, LocatorStrategy, ProjectScript, ReplaySettings, Step, StepPolicy, Target } from '../src/types.js';
import { defaultReplaySettings } from '../src/types.js';
import { resolvePolicy } from './replay.js';

export type ExportSettings = Omit<ReplaySettings, 'locatorFallback' | 'coordinateFallback'>;
export type ExportPolicy = Omit<Required<StepPolicy>, 'locatorFallback' | 'coordinateFallback'>;

export interface PlannedStep {
  action: Step['action'];
  description: string;
  locator?: Locator;
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
  policy: ExportPolicy;
}

export interface ScriptPlan {
  platform: ProjectScript['platform'];
  capabilities: Record<string, string>;
  settings: ExportSettings;
  expectedApp?: string;
  steps: PlannedStep[];
}

/**
 * 生成用于导出的确定性脚本。
 * 候选定位器、校验时间、风险提示和坐标兜底只服务于编辑器内的调试；
 * 导出时只保留用户最终选定的定位方式和显式断言，避免运行时再次做选择。
 */
export function buildExportScript(script: ProjectScript): ProjectScript {
  return {
    version: 1,
    name: script.name,
    platform: script.platform,
    capabilities: { ...script.capabilities },
    replay: exportReplay(script.replay),
    steps: script.steps.map(exportStep),
  };
}

function exportReplay(replay: Partial<ReplaySettings> | undefined): Partial<ReplaySettings> | undefined {
  if (!replay) return undefined;
  const next = { ...replay };
  delete next.locatorFallback;
  delete next.coordinateFallback;
  return Object.keys(next).length > 0 ? next : undefined;
}

function exportStepPolicy(policy: StepPolicy | undefined): StepPolicy | undefined {
  if (!policy) return undefined;
  const next = { ...policy };
  delete next.locatorFallback;
  delete next.coordinateFallback;
  return Object.keys(next).length > 0 ? next : undefined;
}

function exportTarget(target: Target | undefined): Target | undefined {
  if (!target) return undefined;
  const next: Target = {};
  if (target.label !== undefined) next.label = target.label;
  if (target.locator) {
    next.locator = { strategy: target.locator.strategy, value: target.locator.value };
  } else if (target.coordinate) {
    next.coordinate = { xRatio: target.coordinate.xRatio, yRatio: target.coordinate.yRatio };
  }
  return next;
}

function withPolicy<T extends Step>(step: T): T {
  const policy = exportStepPolicy(step.policy);
  const next = { ...step };
  if (policy) next.policy = policy;
  else delete next.policy;
  return next;
}

function exportStep(step: Step): Step {
  if (step.action === 'swipe' || step.action === 'back') return withPolicy({ ...step });

  const target = exportTarget(step.target);
  if (step.action === 'tap' || step.action === 'doubleTap' || step.action === 'longPress') {
    if (!target?.locator && !target?.coordinate) {
      throw new Error(`步骤「${step.description}」没有选定的定位方式，无法导出`);
    }
    return withPolicy({ ...step, target });
  }
  if (step.action === 'input') {
    if (!target?.locator) {
      throw new Error(`输入步骤「${step.description}」必须包含选定的控件定位器，无法导出`);
    }
    return withPolicy({ ...step, target });
  }
  if (step.action === 'pinch') {
    return withPolicy({ ...step, target: step.target ? target : undefined });
  }

  const condition = step.condition ?? 'exists';
  if (condition !== 'stable' && !target?.locator) {
    throw new Error(`断言步骤「${step.description}」必须包含选定的控件定位器，无法导出`);
  }
  const next: Extract<Step, { action: 'wait' }> = { ...step, target, condition };
  if (condition === 'text') {
    if (!step.expect) throw new Error(`文本断言「${step.description}」必须填写期望值，无法导出`);
    next.expect = step.expect;
    next.match = step.match ?? 'contains';
  } else {
    delete next.expect;
    delete next.match;
  }
  return withPolicy(next);
}

export function buildPlan(script: ProjectScript): ScriptPlan {
  const exported = buildExportScript(script);
  const settings: ReplaySettings = { ...defaultReplaySettings, ...exported.replay };
  const steps: PlannedStep[] = exported.steps.map((step) => planStep(step, settings));
  return {
    platform: exported.platform,
    capabilities: exported.capabilities,
    settings: planSettings(settings),
    expectedApp: exported.capabilities.appPackage || exported.capabilities.bundleId,
    steps,
  };
}

function planStep(step: Step, settings: ReplaySettings): PlannedStep {
  const policy = resolvePolicy(settings, step);
  const target = 'target' in step ? step.target : undefined;
  const base: PlannedStep = {
    action: step.action,
    description: step.description,
    locator: target?.locator,
    policy: planPolicy(policy),
    coordinate: target?.coordinate,
  };
  if (step.action === 'input') return { ...base, value: step.value, clearFirst: step.clearFirst, secret: step.secret };
  if (step.action === 'swipe') return { ...base, direction: step.direction, duration: step.duration, start: step.start, end: step.end };
  if (step.action === 'longPress') return { ...base, duration: step.duration };
  if (step.action === 'pinch') return { ...base, direction: step.direction, duration: step.duration, scale: step.scale };
  if (step.action === 'wait') return { ...base, condition: step.condition ?? 'exists', expect: step.expect, match: step.match, timeout: step.timeout };
  return base;
}

function planSettings(settings: ReplaySettings): ExportSettings {
  return {
    timeout: settings.timeout,
    settleTimeout: settings.settleTimeout,
    retries: settings.retries,
    retryDelay: settings.retryDelay,
    pollInterval: settings.pollInterval,
    settle: settings.settle,
    stopOnFailure: settings.stopOnFailure,
    requireApp: settings.requireApp,
  };
}

function planPolicy(policy: Required<StepPolicy>): ExportPolicy {
  return {
    timeout: policy.timeout,
    settleTimeout: policy.settleTimeout,
    retries: policy.retries,
    retryDelay: policy.retryDelay,
    pollInterval: policy.pollInterval,
    settle: policy.settle,
    verify: policy.verify,
  };
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
