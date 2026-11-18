import yaml from 'js-yaml';
import { z } from 'zod';
import type { ProjectScript, Step } from '../src/types.js';
import { buildExportScript } from './export-model.js';

const strategy = z.enum(['accessibility id', 'id', '-ios predicate string', '-ios class chain', '-android uiautomator', 'xpath']);
const locator = z.object({ strategy, value: z.string().min(1) });
const candidate = z.object({
  locator,
  matches: z.number().int().nonnegative(),
  unique: z.boolean(),
  score: z.number().min(0).max(100),
  role: z.enum(['recommended', 'alternative', 'brittle']),
  note: z.string().optional(),
  source: z.enum(['attribute', 'semantic', 'resource-id', 'xpath']),
  verified: z.boolean().optional(),
});
const target = z.object({
  locator: locator.optional(),
  label: z.string().optional(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  coordinate: z.object({ xRatio: z.number().min(0).max(1), yRatio: z.number().min(0).max(1) }).optional(),
  candidates: z.array(candidate).max(50).optional(),
  verifiedAt: z.number().optional(),
  warning: z.string().max(500).optional(),
});
const policy = z.object({
  timeout: z.number().int().min(100).max(120000).optional(),
  settleTimeout: z.number().int().min(100).max(60000).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  retryDelay: z.number().int().min(0).max(10000).optional(),
  pollInterval: z.number().int().min(50).max(5000).optional(),
  settle: z.boolean().optional(),
  verify: z.boolean().optional(),
  coordinateFallback: z.boolean().optional(),
  locatorFallback: z.boolean().optional(),
});
const common = { id: z.string().min(1), description: z.string(), note: z.string().max(500).optional(), policy: policy.optional() };
const step = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('tap'), target }),
  z.object({ ...common, action: z.literal('doubleTap'), target }),
  z.object({ ...common, action: z.literal('longPress'), target, duration: z.number().int().min(100).max(10000) }),
  z.object({ ...common, action: z.literal('pinch'), direction: z.enum(['in', 'out']), scale: z.number().min(0.1).max(5), duration: z.number().int().min(100).max(5000), target: target.optional() }),
  z.object({ ...common, action: z.literal('input'), target, value: z.string(), clearFirst: z.boolean(), secret: z.boolean().optional() }),
  z.object({ ...common, action: z.literal('swipe'), direction: z.enum(['up', 'down', 'left', 'right']), duration: z.number().int().min(100).max(5000), start: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).optional(), end: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).optional() }),
  z.object({ ...common, action: z.literal('back') }),
  z.object({
    ...common,
    action: z.literal('wait'),
    target: target.optional(),
    condition: z.enum(['exists', 'visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'empty', 'text', 'stable']).optional(),
    expect: z.string().optional(),
    match: z.enum(['equals', 'contains', 'regex']).optional(),
    timeout: z.number().int().min(100).max(120000),
  }),
]);
const replay = z.object({
  timeout: z.number().int().min(100).max(120000),
  settleTimeout: z.number().int().min(100).max(60000),
  retries: z.number().int().min(0).max(10),
  retryDelay: z.number().int().min(0).max(10000),
  pollInterval: z.number().int().min(50).max(5000),
  settle: z.boolean(),
  stopOnFailure: z.boolean(),
  coordinateFallback: z.boolean(),
  requireApp: z.boolean(),
  locatorFallback: z.boolean(),
}).partial().optional();
const project = z.object({ version: z.literal(1), name: z.string().min(1), platform: z.enum(['android', 'ios']), capabilities: z.record(z.string()), replay, steps: z.array(step).max(10000) });

export function parseScript(content: string): ProjectScript { return project.parse(yaml.load(content)); }
export function validateScript(value: unknown): ProjectScript { return project.parse(value); }
export function stringifyScript(script: ProjectScript): string { return yaml.dump(validateScript(script), { noRefs: true, lineWidth: 120, quotingType: '"', forceQuotes: false }); }
export function stringifyExportScript(script: ProjectScript): string {
  return yaml.dump(validateScript(buildExportScript(validateScript(script))), { noRefs: true, lineWidth: 120, quotingType: '"', forceQuotes: false });
}

export function generateJavaScript(script: ProjectScript): string {
  const data = JSON.stringify(buildExportScript(validateScript(script)), null, 2);
  return `// 由 EchoBench 生成。运行前请安装 webdriverio。
import { remote } from 'webdriverio';

const script = ${data};
const defaults = { timeout: 10000, settleTimeout: 3000, retries: 2, retryDelay: 500, pollInterval: 300, settle: true, verify: false, requireApp: true, ...script.replay };
const policy = (step) => ({ ...defaults, ...step.policy });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const driver = await remote({
  hostname: '127.0.0.1', port: 4723, path: '/',
  capabilities: {
    platformName: script.platform === 'android' ? 'Android' : 'iOS',
    'appium:automationName': script.platform === 'android' ? 'UiAutomator2' : 'XCUITest',
    ...Object.fromEntries(Object.entries(script.capabilities).map(([key, value]) => [key.startsWith('appium:') ? key : \`appium:\${key}\`, value])),
  },
});

const selector = (locator) => {
  if (locator.strategy === 'accessibility id') return \`~\${locator.value}\`;
  if (locator.strategy === 'id') return \`id=\${locator.value}\`;
  if (locator.strategy === '-android uiautomator') return \`android=\${locator.value}\`;
  if (locator.strategy === '-ios predicate string') return \`-ios predicate string:\${locator.value}\`;
  if (locator.strategy === '-ios class chain') return \`-ios class chain:\${locator.value}\`;
  return locator.value;
};
const findMany = async (locator) => {
  try { return await driver.$$(selector(locator)); } catch { return []; }
};
const state = async (target) => ({
  displayed: await target.isDisplayed().catch(() => false),
  enabled: await target.isEnabled().catch(() => false),
});
const waitTarget = async (step, p) => {
  const locator = step.target && step.target.locator;
  if (!locator) return null;
  const deadline = Date.now() + p.timeout;
  let lastError = '控件未出现';
  while (Date.now() < deadline) {
    try {
      const foundList = await findMany(locator);
      if (foundList.length > 1) lastError = '定位器匹配 ' + foundList.length + ' 个元素';
      else if (foundList.length === 1) {
        const ready = await state(foundList[0]);
        if (ready.displayed && ready.enabled) return foundList[0];
        lastError = '控件尚未就绪（displayed=' + ready.displayed + '，enabled=' + ready.enabled + '）';
      }
    } catch (error) { lastError = error.message; }
    await sleep(p.pollInterval);
  }
  throw new Error('等待控件就绪超时（' + p.timeout + 'ms）：' + step.description + '；' + lastError);
};
const pageStable = async (p, timeout) => {
  const deadline = Date.now() + timeout;
  const stableFor = Math.min(500, Math.max(150, Math.floor(timeout / 3)));
  let previous = await driver.getPageSource();
  let previousAt = Date.now();
  while (Date.now() < deadline) {
    await sleep(Math.min(p.pollInterval, Math.max(50, deadline - Date.now())));
    const current = await driver.getPageSource();
    if (current === previous) { if (Date.now() - previousAt >= stableFor) return true; }
    else { previous = current; previousAt = Date.now(); }
  }
  return false;
};
const matches = (text, expect, match) => match === 'equals' ? text === expect : match === 'regex' ? new RegExp(expect).test(text) : text.includes(expect);
const checkedState = async (element) => {
  for (const name of ['checked', 'selected', 'value']) {
    try {
      const raw = await element.getAttribute(name);
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      const value = String(raw).trim().toLowerCase();
      return ['true', '1', 'yes', 'on'].includes(value);
    } catch { /* 平台属性支持不同，继续尝试。 */ }
  }
  return null;
};
const waitCondition = async (step, p) => {
  const condition = step.condition || 'exists';
  if (condition === 'stable') {
    if (!(await pageStable(p, step.timeout))) throw new Error('页面持续变化，等待稳定超时（' + step.timeout + 'ms）');
    return;
  }
  if (!step.target || !step.target.locator) throw new Error('等待步骤需要控件定位器');
  const locator = step.target.locator;
  const deadline = Date.now() + step.timeout;
  let lastError = '控件未出现';
  while (Date.now() < deadline) {
    const foundList = await findMany(locator);
    if (condition === 'hidden') {
      if (!foundList.length) return;
      const ready = await state(foundList[0]);
      if (!ready.displayed) return;
      lastError = '控件仍然可见';
    } else if (foundList.length > 1) {
      lastError = '定位器匹配 ' + foundList.length + ' 个元素';
    } else if (foundList.length === 1) {
      const found = foundList[0];
      if (condition === 'exists') return;
      if (condition === 'visible') {
        if ((await state(found)).displayed) return;
        lastError = '控件不可见';
      } else if (condition === 'enabled') {
        if ((await state(found)).enabled) return;
        lastError = '控件不可用';
      } else if (condition === 'disabled') {
        if (!(await state(found)).enabled) return;
        lastError = '控件仍然可用';
      } else if (condition === 'checked' || condition === 'unchecked') {
        const checked = await checkedState(found);
        if (checked === null) throw new Error('无法读取控件勾选状态');
        if (condition === 'checked' ? checked : !checked) return;
        lastError = '勾选状态未满足';
      } else if (condition === 'empty') {
        if ((await found.getAttribute('password').catch(() => 'false')) === 'true') throw new Error('密码控件无法校验文本');
        const text = await found.getText().catch(() => '');
        if (!String(text).trim()) return;
        lastError = '控件仍有内容';
      } else if (condition === 'text') {
        if ((await found.getAttribute('password').catch(() => 'false')) === 'true') throw new Error('密码控件无法校验文本');
        const text = await found.getText().catch(() => '');
        if (matches(text, step.expect || '', step.match || 'contains')) return;
        lastError = '文本不匹配：当前「' + text + '」';
      }
    }
    await sleep(p.pollInterval);
  }
  throw new Error('等待条件超时（' + step.timeout + 'ms）：' + lastError);
};
const gestureCenter = async (step, found) => {
  if (found) {
    try { const rect = await found.getRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; } catch { /* 元素失效时退回坐标。 */ }
  }
  const size = await driver.getWindowSize();
  if (step.target && step.target.coordinate) return { x: Math.round(size.width * step.target.coordinate.xRatio), y: Math.round(size.height * step.target.coordinate.yRatio) };
  return { x: Math.round(size.width / 2), y: Math.round(size.height / 2) };
};
const tapAt = async (x, y) => {
  await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
    { type: 'pointerMove', duration: 0, x, y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
  ] }]);
};
const doubleTap = async (step, found) => {
  const point = await gestureCenter(step, found);
  await tapAt(point.x, point.y);
  await sleep(80);
  await tapAt(point.x, point.y);
};
const longPress = async (step, found) => {
  const point = await gestureCenter(step, found);
  await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
    { type: 'pointerMove', duration: 0, ...point, origin: 'viewport' }, { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: step.duration || 800 }, { type: 'pointerUp', button: 0 },
  ] }]);
};
const pinch = async (step, found) => {
  const point = await gestureCenter(step, found);
  const size = await driver.getWindowSize();
  const radius = Math.max(40, Math.round(Math.min(size.width, size.height) / 6));
  const direction = step.direction || 'out';
  const scale = step.scale || (direction === 'out' ? 2 : 0.5);
  const factor = direction === 'out' ? Math.max(1.2, scale) : Math.min(0.8, scale);
  const endRadius = Math.round(radius * factor);
  await driver.performActions([
    { type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, x: point.x, y: point.y - radius, origin: 'viewport' }, { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: step.duration || 600, x: point.x, y: point.y - endRadius, origin: 'viewport' }, { type: 'pointerUp', button: 0 },
    ] },
    { type: 'pointer', id: 'finger2', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, x: point.x, y: point.y + radius, origin: 'viewport' }, { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: step.duration || 600, x: point.x, y: point.y + endRadius, origin: 'viewport' }, { type: 'pointerUp', button: 0 },
    ] },
  ]);
};
const tapPoint = async (target) => {
  const size = await driver.getWindowSize();
  const x = Math.round(size.width * target.coordinate.xRatio);
  const y = Math.round(size.height * target.coordinate.yRatio);
  await driver.performActions([{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x, y }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }]);
};

let pageDirty = false;
try {
  const expectedApp = script.capabilities.appPackage || script.capabilities.bundleId;
  if (script.replay?.requireApp !== false && expectedApp) {
    const current = script.platform === 'android'
      ? await driver.getCurrentPackage().catch(() => null)
      : await driver.executeScript('mobile: activeAppInfo', []).then((info) => info?.bundleId ?? null).catch(() => null);
    if (current && current !== expectedApp) throw new Error('目标应用未在前台：期望 ' + expectedApp + '，当前 ' + current);
  }
  for (const step of script.steps) {
    const p = policy(step);
    if (step.action === 'wait') { console.log('等待：' + step.description); await waitCondition(step, p); continue; }

    let lastError = null;
    for (let attempt = 0; attempt <= p.retries; attempt++) {
      let dispatched = false;
      try {
        let found = null;
        if (step.target && step.target.locator) {
          console.log('等待控件就绪：' + step.description);
          found = await waitTarget(step, p);
        } else if (p.settle && pageDirty) {
          console.log('等待页面稳定：' + step.description);
          if (!(await pageStable(p, p.settleTimeout).catch(() => true))) console.log('页面持续变化，继续执行');
          pageDirty = false;
        }

        if (step.action === 'tap') {
          dispatched = true;
          if (found) await found.click();
          else await tapPoint(step.target);
          pageDirty = true;
        } else if (step.action === 'doubleTap') {
          dispatched = true;
          await doubleTap(step, found);
          pageDirty = true;
        } else if (step.action === 'longPress') {
          dispatched = true;
          await longPress(step, found);
          pageDirty = true;
        } else if (step.action === 'pinch') {
          dispatched = true;
          await pinch(step, found);
          pageDirty = true;
        } else if (step.action === 'input') {
          if (!found) throw new Error('输入步骤必须包含控件定位器');
          dispatched = true;
          if (step.clearFirst) await found.clearValue();
          await found.setValue(step.value);
          if (p.verify && !step.secret) {
            const password = await found.getAttribute('password').catch(() => 'false');
            if (password !== 'true') {
              const actual = await found.getText().catch(() => null);
              if (actual !== null && actual !== step.value) throw new Error('输入校验失败：期望「' + step.value + '」，实际「' + actual + '」');
            }
          }
          pageDirty = true;
        } else if (step.action === 'swipe') {
          const size = await driver.getWindowSize(); const horizontal = ['left', 'right'].includes(step.direction); const reverse = ['down', 'right'].includes(step.direction);
          const a = reverse ? .25 : .75, b = reverse ? .75 : .25;
          const start = step.start ?? { x: Math.round(size.width * (horizontal ? a : .5)), y: Math.round(size.height * (horizontal ? .5 : a)) };
          const end = step.end ?? { x: Math.round(size.width * (horizontal ? b : .5)), y: Math.round(size.height * (horizontal ? .5 : b)) };
          dispatched = true;
          await driver.performActions([{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: start.x, y: start.y }, { type: 'pointerDown', button: 0 }, { type: 'pointerMove', duration: step.duration, x: end.x, y: end.y }, { type: 'pointerUp', button: 0 }] }]);
          pageDirty = true;
        } else if (step.action === 'back') {
          dispatched = true;
          await driver.back();
          pageDirty = true;
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        // tap/swipe/back 等动作发出后不再自动重试，避免重复操作；输入仅在允许清空或校验时重试。
        const retryable = dispatched && step.action === 'input' && (step.clearFirst || p.verify);
        if (!retryable || attempt >= p.retries) throw error;
        console.log('第 ' + (attempt + 2) + '/' + (p.retries + 1) + ' 次尝试：' + error.message);
        await sleep(p.retryDelay * Math.min(attempt + 1, 3));
        pageDirty = true;
      }
    }
    if (lastError) throw lastError;
  }
} finally { await driver.deleteSession(); }
`;
}

export function stepLabel(step: Step): string { return step.description || step.action; }
