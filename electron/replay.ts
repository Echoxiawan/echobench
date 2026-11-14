import type {
  Locator,
  ProjectScript,
  ReplayActivity,
  ReplayPhase,
  ReplayProgress,
  ReplayReport,
  ReplaySettings,
  ReplayStepResult,
  SessionState,
  Step,
  StepPolicy,
  Target,
  TextMatch,
} from '../src/types.js';
import { defaultReplaySettings } from '../src/types.js';
import { fallbackLocators } from './locator.js';

type SwipeStep = Extract<Step, { action: 'swipe' }>;
type Emit = (event: string, data: unknown) => void;
type Prepared = { elementId?: string };

export interface ReplayAdapter {
  session(): SessionState;
  findElement(locator: Locator): Promise<string | null>;
  findElements(locator: Locator): Promise<string[]>;
  elementReady(elementId: string): Promise<{ displayed: boolean; enabled: boolean }>;
  elementValue(elementId: string): Promise<{ text: string | null; password: boolean }>;
  elementAttribute(elementId: string, name: string): Promise<string>;
  click(elementId: string): Promise<void>;
  tapAt(x: number, y: number): Promise<void>;
  setValue(elementId: string, text: string, clearFirst: boolean): Promise<void>;
  doubleTap(target: Target): Promise<void>;
  longPress(target: Target, duration: number): Promise<void>;
  pinch(target: Target | undefined, direction: 'in' | 'out', scale: number, duration: number): Promise<void>;
  swipe(step: SwipeStep): Promise<void>;
  back(): Promise<void>;
  pageSource(): Promise<string>;
  currentApp(): Promise<string | null>;
}

class StepFailure extends Error {
  constructor(message: string, readonly attempts: number, readonly waited: number, readonly duration: number) {
    super(message);
    this.name = 'StepFailure';
  }
}

export async function runReplay(adapter: ReplayAdapter, script: ProjectScript, emit: Emit, startIndex = 0): Promise<ReplayReport> {
  const startedAt = Date.now();
  const settings: ReplaySettings = { ...defaultReplaySettings, ...script.replay };
  const total = script.steps.length;
  const begin = total === 0 ? 0 : Math.max(0, Math.min(startIndex, total - 1));
  const results: ReplayStepResult[] = script.steps.map((step, index) => ({ index, action: step.action, description: step.description, status: 'skipped' }));
  const context = { pageDirty: false };
  const progress = (index: number, step: Step, status: ReplayProgress['status'], extra: Partial<ReplayProgress> = {}) => {
    emitProgress(emit, index, total, step, status, { ...extra, startIndex: begin });
  };

  const expectedApp = script.capabilities.appPackage || script.capabilities.bundleId;
  if (settings.requireApp && expectedApp && script.steps.length > 0) {
    const current = await adapter.currentApp().catch(() => null);
    if (current && current !== expectedApp) {
      const first = script.steps[begin];
      const message = `目标应用未在前台：期望 ${expectedApp}，当前 ${current}`;
      results[begin] = { index: begin, action: first.action, description: first.description, status: 'failed', duration: 0, message, attempts: 1, retried: 0, waited: 0 };
      progress(begin, first, 'failed', { duration: 0, message, attempts: 1, retried: 0, waited: 0 });
      const finishedAt = Date.now();
      return { status: 'failed', startedAt, finishedAt, duration: finishedAt - startedAt, startIndex: begin, results };
    }
  }

  for (let index = begin; index < total; index++) {
    const step = script.steps[index];
    progress(index, step, 'running');
    try {
      const result = await runStep(adapter, step, index, settings, context, emit);
      results[index] = result;
      progress(index, step, 'passed', { duration: result.duration, attempts: result.attempts, retried: result.retried, waited: result.waited });
    } catch (cause) {
      const failure = cause instanceof StepFailure ? cause : new StepFailure(message(cause), 1, 0, 0);
      results[index] = {
        index,
        action: step.action,
        description: step.description,
        status: 'failed',
        duration: failure.duration,
        message: failure.message,
        attempts: failure.attempts,
        retried: Math.max(0, failure.attempts - 1),
        waited: failure.waited,
      };
      progress(index, step, 'failed', { duration: failure.duration, message: failure.message, attempts: failure.attempts, retried: results[index].retried, waited: failure.waited });
      if (settings.stopOnFailure) break;
    }
  }

  const finishedAt = Date.now();
  return {
    status: results.some((result) => result.status === 'failed') ? 'failed' : 'passed',
    startedAt,
    finishedAt,
    duration: finishedAt - startedAt,
    startIndex: begin,
    results,
  };
}

async function runStep(adapter: ReplayAdapter, step: Step, index: number, settings: ReplaySettings, context: { pageDirty: boolean }, emit: Emit): Promise<ReplayStepResult> {
  const policy = resolvePolicy(settings, step);
  const startedAt = Date.now();
  let attempts = 0;
  let waited = 0;

  if (step.action === 'wait') {
    emitActivity(emit, index, 'waiting', describeWait(step), 1, 1, startedAt);
    try {
      await waitForCondition(adapter, step, policy, (text) => emitActivity(emit, index, 'waiting', text, 1, 1, startedAt));
    } catch (cause) {
      const duration = Date.now() - startedAt;
      throw new StepFailure(message(cause), 1, duration, duration);
    }
    const duration = Date.now() - startedAt;
    return { index, action: step.action, description: step.description, status: 'passed', duration, attempts: 1, retried: 0, waited: duration };
  }

  let lastError = '未知错误';
  const stepDeadline = startedAt + policy.timeout;
  for (let attempt = 1; attempt <= policy.retries + 1; attempt++) {
    attempts = attempt;
    let phase: 'ready' | 'action' | 'verify' = 'ready';
    try {
      const prepareStarted = Date.now();
      let prepared: Prepared;
      try {
        prepared = await prepare(adapter, step, policy, context, index, attempt, policy.retries + 1, startedAt, stepDeadline, emit);
      } catch (cause) {
        waited += Date.now() - prepareStarted;
        throw cause;
      }
      waited += Date.now() - prepareStarted;

      phase = 'action';
      emitActivity(emit, index, 'acting', actionMessage(step), attempt, policy.retries + 1, startedAt);
      await executeAction(adapter, step, prepared, context);

      phase = 'verify';
      if (step.action === 'input' && policy.verify && !step.secret && prepared.elementId) {
        emitActivity(emit, index, 'verifying', '校验输入结果…', attempt, policy.retries + 1, startedAt);
        await verifyInput(adapter, step, prepared.elementId);
      }

      const duration = Date.now() - startedAt;
      return { index, action: step.action, description: step.description, status: 'passed', duration, attempts, retried: attempts - 1, waited };
    } catch (cause) {
      lastError = message(cause);
      const remaining = stepDeadline - Date.now();
      if (attempt > policy.retries || remaining <= 0 || !isRetryable(phase, step, cause)) {
        throw new StepFailure(lastError, attempts, waited, Date.now() - startedAt);
      }
      emitActivity(emit, index, 'retrying', `第 ${attempt + 1} 次尝试：${lastError}`, attempt + 1, policy.retries + 1, startedAt);
      await delay(Math.min(policy.retryDelay * Math.min(attempt, 3), remaining));
      context.pageDirty = true;
    }
  }
  throw new StepFailure(lastError, attempts, waited, Date.now() - startedAt);
}

async function prepare(adapter: ReplayAdapter, step: Step, policy: Required<StepPolicy>, context: { pageDirty: boolean }, index: number, attempt: number, attempts: number, startedAt: number, deadline: number, emit: Emit): Promise<Prepared> {
  if ('target' in step && step.target?.locator) {
    emitActivity(emit, index, 'waiting', `等待控件就绪：${targetLabel(step.target)}`, attempt, attempts, startedAt);
    const elementId = await waitForTarget(adapter, step, policy, deadline, (text) => emitActivity(emit, index, 'waiting', text, attempt, attempts, startedAt));
    return { elementId };
  }
  if (!policy.settle || !context.pageDirty) return {};

  emitActivity(emit, index, 'waiting', '等待页面稳定…', attempt, attempts, startedAt);
  const remaining = Math.max(200, deadline - Date.now());
  const stable = await pageStable(adapter, Math.min(policy.settleTimeout, remaining), policy.pollInterval).catch(() => true);
  context.pageDirty = false;
  if (!stable) emitActivity(emit, index, 'waiting', '页面持续变化，继续执行', attempt, attempts, startedAt);
  return {};
}

async function waitForTarget(adapter: ReplayAdapter, step: Step, policy: Required<StepPolicy>, deadline: number, notify: (text: string) => void): Promise<string | undefined> {
  const target = 'target' in step ? step.target : undefined;
  const locator = target?.locator;
  if (!locator) return undefined;
  if (Date.now() >= deadline) throw new Error(`等待控件就绪超时（${policy.timeout}ms）：${locator.value}；控件未出现`);
  // 有坐标兜底的点击不必等满整个超时，避免无效定位器拖慢回放。
  const locatorDeadline = step.action === 'tap' && target?.coordinate && policy.coordinateFallback ? Math.min(deadline, Date.now() + Math.min(policy.timeout, 5000)) : deadline;
  const locators = policy.locatorFallback ? fallbackLocators(target!) : [locator];
  let lastError = '控件未出现';
  let lastNotice = '';
  while (Date.now() < locatorDeadline) {
    for (let index = 0; index < locators.length; index++) {
      const current = locators[index];
      try {
        if (!policy.locatorFallback) {
          const elementId = await adapter.findElement(current);
          if (elementId) {
            const ready = await adapter.elementReady(elementId);
            if (ready.displayed && ready.enabled) return elementId;
            lastError = `控件尚未就绪（displayed=${ready.displayed}，enabled=${ready.enabled}）`;
          }
        } else {
          const ids = await adapter.findElements(current);
          if (ids.length > 1) {
            lastError = `定位器匹配 ${ids.length} 个元素，不使用该定位器`;
            continue;
          }
          if (ids.length === 0) {
            lastError = '控件未出现';
            continue;
          }
          const ready = await adapter.elementReady(ids[0]);
          if (ready.displayed && ready.enabled) {
            if (index > 0) notify(`主定位未命中，使用候选 ${index + 1}/${locators.length}：${describeLocator(current)}`);
            return ids[0];
          }
          lastError = `控件尚未就绪（displayed=${ready.displayed}，enabled=${ready.enabled}）`;
        }
      } catch (cause) {
        lastError = message(cause);
      }
    }
    const notice = `${describeLocator(locator)}：${lastError}`;
    if (notice !== lastNotice && Date.now() + policy.pollInterval < locatorDeadline) {
      lastNotice = notice;
      notify(notice);
    }
    const remaining = locatorDeadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(policy.pollInterval, remaining));
  }
  if (step.action === 'tap' && target?.coordinate && policy.coordinateFallback) {
    notify('定位器未就绪，使用坐标兜底');
    return undefined;
  }
  throw new Error(`等待控件就绪超时（${policy.timeout}ms）：${locator.value}；已尝试 ${locators.length} 个定位器；${lastError}`);
}

async function executeAction(adapter: ReplayAdapter, step: Step, prepared: Prepared, context: { pageDirty: boolean }): Promise<void> {
  if (step.action === 'tap') {
    if (prepared.elementId) await adapter.click(prepared.elementId);
    else {
      const session = adapter.session();
      if (!step.target.coordinate) throw new Error('步骤既没有有效定位器，也没有坐标兜底');
      await adapter.tapAt(Math.round(step.target.coordinate.xRatio * session.width), Math.round(step.target.coordinate.yRatio * session.height));
    }
  } else if (step.action === 'doubleTap') {
    await adapter.doubleTap(step.target);
  } else if (step.action === 'longPress') {
    await adapter.longPress(step.target, step.duration);
  } else if (step.action === 'pinch') {
    await adapter.pinch(step.target, step.direction, step.scale, step.duration);
  } else if (step.action === 'input') {
    if (!prepared.elementId) throw new Error('输入步骤必须包含控件定位器');
    await adapter.setValue(prepared.elementId, step.value, step.clearFirst);
  } else if (step.action === 'swipe') {
    await adapter.swipe(step);
  } else if (step.action === 'back') {
    await adapter.back();
  }
  context.pageDirty = true;
}

async function verifyInput(adapter: ReplayAdapter, step: Extract<Step, { action: 'input' }>, elementId: string): Promise<void> {
  const value = await adapter.elementValue(elementId);
  if (value.password || value.text === null) return;
  if (value.text !== step.value) throw new Error(`输入校验失败：期望「${truncate(step.value)}」，实际「${truncate(value.text)}」`);
}

async function waitForCondition(adapter: ReplayAdapter, step: Extract<Step, { action: 'wait' }>, policy: Required<StepPolicy>, notify: (text: string) => void): Promise<void> {
  const timeout = step.timeout;
  if ((step.condition ?? 'exists') === 'stable') {
    const stable = await pageStable(adapter, timeout, policy.pollInterval).catch(() => false);
    if (!stable) throw new Error(`页面持续变化，等待稳定超时（${timeout}ms）`);
    return;
  }
  if (!step.target?.locator) throw new Error('等待步骤需要控件定位器');

  const condition = step.condition ?? 'exists';
  const matcher = condition === 'text' ? textMatcher(step.expect, step.match ?? 'contains') : null;
  const deadline = Date.now() + timeout;
  let lastError = '控件未出现';
  let lastNotice = '';
  while (Date.now() < deadline) {
    try {
      const found = await findUniqueElement(adapter, step.target, policy.locatorFallback);
      if (condition === 'hidden') {
        if (found.matches === 0 && !found.elementId) return;
        if (!found.elementId) {
          lastError = found.error ?? '无法确认控件状态';
        } else {
          const ready = await adapter.elementReady(found.elementId);
          if (!ready.displayed) return;
          lastError = '控件仍然可见';
        }
      } else if (!found.elementId) {
        lastError = found.error ?? '控件未出现';
      } else {
        const elementId = found.elementId;
        if (condition === 'exists') return;
        const ready = await adapter.elementReady(elementId);
        if (condition === 'visible') {
          if (ready.displayed) return;
          lastError = '控件不可见';
        } else if (condition === 'enabled') {
          if (ready.enabled) return;
          lastError = '控件不可用';
        } else if (condition === 'disabled') {
          if (!ready.enabled) return;
          lastError = '控件仍然可用';
        } else if (condition === 'checked' || condition === 'unchecked') {
          const checked = await readChecked(adapter, elementId);
          if (checked === null) throw new Error('无法读取控件勾选状态');
          if (condition === 'checked' ? checked : !checked) return;
          lastError = condition === 'checked' ? '控件未选中' : '控件仍处于选中状态';
        } else if (condition === 'empty') {
          const value = await adapter.elementValue(elementId);
          if (value.password) throw new Error('密码控件无法校验文本');
          if ((value.text ?? '').trim() === '') return;
          lastError = `控件仍有内容：「${truncate(value.text ?? '')}」`;
        } else if (condition === 'text') {
          const value = await adapter.elementValue(elementId);
          if (value.password) throw new Error('密码控件无法校验文本');
          if (matcher!(value.text ?? '')) return;
          lastError = `文本不匹配：当前「${truncate(value.text ?? '')}」`;
        }
      }
    } catch (cause) {
      lastError = message(cause);
    }
    const notice = `${describeWait(step)}（${lastError}）`;
    if (notice !== lastNotice && Date.now() + policy.pollInterval < deadline) {
      lastNotice = notice;
      notify(notice);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(policy.pollInterval, remaining));
  }
  throw new Error(`等待条件超时（${timeout}ms）：${lastError}`);
}

interface UniqueElement { elementId?: string; matches: number; error?: string }

async function findUniqueElement(adapter: ReplayAdapter, target: Target, useFallback: boolean): Promise<UniqueElement> {
  const locators = useFallback ? fallbackLocators(target) : target.locator ? [target.locator] : [];
  if (locators.length === 0) return { matches: 0, error: '控件没有定位器' };
  let lastError = '控件未出现';
  for (const locator of locators) {
    if (!useFallback) {
      const elementId = await adapter.findElement(locator);
      return elementId ? { elementId, matches: 1 } : { matches: 0, error: lastError };
    }
    const ids = await adapter.findElements(locator);
    if (ids.length > 1) {
      lastError = `定位器匹配 ${ids.length} 个元素，不使用该定位器`;
      continue;
    }
    if (ids.length === 1) return { elementId: ids[0], matches: 1 };
    lastError = '控件未出现';
  }
  return { matches: 0, error: lastError };
}

async function readChecked(adapter: ReplayAdapter, elementId: string): Promise<boolean | null> {
  for (const name of ['checked', 'selected', 'value']) {
    try {
      const raw = (await adapter.elementAttribute(elementId, name)).trim().toLowerCase();
      if (!raw || raw === 'null') continue;
      return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    } catch { /* 不同平台支持的状态属性不同，继续尝试下一个。 */ }
  }
  return null;
}

async function pageStable(adapter: ReplayAdapter, timeout: number, interval: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  const stableFor = Math.min(500, Math.max(150, Math.floor(timeout / 3)));
  let previous = await adapter.pageSource();
  let previousAt = Date.now();
  while (Date.now() < deadline) {
    await delay(Math.min(interval, Math.max(50, deadline - Date.now())));
    let current: string;
    try { current = await adapter.pageSource(); } catch { return false; }
    if (current === previous) {
      if (Date.now() - previousAt >= stableFor) return true;
    } else {
      previous = current;
      previousAt = Date.now();
    }
  }
  return false;
}

export function resolvePolicy(settings: ReplaySettings, step: Step): Required<StepPolicy> {
  return {
    timeout: step.policy?.timeout ?? settings.timeout,
    settleTimeout: step.policy?.settleTimeout ?? settings.settleTimeout,
    retries: step.policy?.retries ?? settings.retries,
    retryDelay: step.policy?.retryDelay ?? settings.retryDelay,
    pollInterval: step.policy?.pollInterval ?? settings.pollInterval,
    settle: step.policy?.settle ?? settings.settle,
    verify: step.policy?.verify ?? false,
    coordinateFallback: step.policy?.coordinateFallback ?? settings.coordinateFallback,
    locatorFallback: step.policy?.locatorFallback ?? settings.locatorFallback,
  };
}

function isRetryable(phase: 'ready' | 'action' | 'verify', step: Step, error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['invalid session id', 'session not created', 'unknown method'].includes(code)) return false;
  // 元素等待本身已经持续轮询到 timeout，不再叠加整轮重试；重试只服务于动作/校验失败。
  if (phase === 'ready') return false;
  return phase === 'verify' || (phase === 'action' && step.action === 'input' && step.clearFirst);
}

function textMatcher(expect: string | undefined, match: TextMatch): (text: string) => boolean {
  if (expect === undefined) throw new Error('等待文本条件必须提供 expect');
  if (match === 'regex') {
    let pattern: RegExp;
    try { pattern = new RegExp(expect); } catch { throw new Error(`无效的正则表达式：${expect}`); }
    return (text) => pattern.test(text);
  }
  return match === 'equals' ? (text) => text === expect : (text) => text.includes(expect);
}

function emitProgress(emit: Emit, index: number, total: number, step: Step, status: ReplayProgress['status'], extra: Partial<ReplayProgress> = {}): void {
  emit('replay-progress', { index, total, action: step.action, description: step.description, status, ...extra } satisfies ReplayProgress);
}

function emitActivity(emit: Emit, index: number, phase: ReplayPhase, messageText: string, attempt: number, attempts: number, startedAt: number): void {
  emit('replay-activity', { index, phase, message: messageText, attempt, attempts, elapsed: Date.now() - startedAt } satisfies ReplayActivity);
}

function describeWait(step: Extract<Step, { action: 'wait' }>): string {
  const condition = step.condition ?? 'exists';
  if (condition === 'stable') return '等待页面稳定…';
  const label = targetLabel(step.target);
  if (condition === 'visible') return `等待控件可见：${label}`;
  if (condition === 'hidden') return `等待控件隐藏：${label}`;
  if (condition === 'enabled') return `等待控件可用：${label}`;
  if (condition === 'disabled') return `等待控件禁用：${label}`;
  if (condition === 'checked') return `等待控件选中：${label}`;
  if (condition === 'unchecked') return `等待控件未选中：${label}`;
  if (condition === 'empty') return `等待控件内容为空：${label}`;
  if (condition === 'text') return `等待控件文本${matchLabel(step.match ?? 'contains')}「${truncate(step.expect ?? '')}」`;
  return `等待控件出现：${label}`;
}

function actionMessage(step: Step): string {
  if (step.action === 'tap') return `正在点击：${targetLabel(step.target)}`;
  if (step.action === 'doubleTap') return `正在双击：${targetLabel(step.target)}`;
  if (step.action === 'longPress') return `正在长按：${targetLabel(step.target)}`;
  if (step.action === 'pinch') return `正在双指${step.direction === 'out' ? '放大' : '缩小'}…`;
  if (step.action === 'input') return '正在输入…';
  if (step.action === 'swipe') return '正在滑动…';
  return '正在返回…';
}

function describeLocator(locator: Locator): string {
  return `${locator.strategy} · ${truncate(locator.value, 48)}`;
}

function targetLabel(target: Target | undefined): string { return target?.label || target?.locator?.value || '坐标目标'; }
function matchLabel(match: TextMatch): string { return ({ equals: '等于', contains: '包含', regex: '匹配' })[match]; }
function truncate(value: string, max = 40): string { return value.length > max ? `${value.slice(0, max)}…` : value; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
