import type { Locator, LocatorCandidate, Platform, Point, RecordedTap, SessionConfig, SessionState, Snapshot, Target, TypingSnapshot } from '../src/types.js';
import { analyzeTarget, findFocusedNode, focusedTarget, isEditableNode, parseTree, type Rect } from './locator.js';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export class AppiumError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'AppiumError';
  }
}

export class AppiumClient {
  private session: SessionState | null = null;
  private sourceCache: { xml: string; updatedAt: number; editableFocused: boolean } | null = null;
  private sourceTimer: NodeJS.Timeout | null = null;
  private sourceRequest: Promise<void> | null = null;
  private lastActionAt = 0;
  private generation = 0;
  private baseUrl: string;
  private readonly defaultBaseUrl: string;
  constructor(baseUrl = 'http://127.0.0.1:4723') {
    this.baseUrl = baseUrl;
    this.defaultBaseUrl = baseUrl;
  }

  async createSession(config: SessionConfig): Promise<SessionState> {
    // 附加外部会话会改写 baseUrl；新建自有会话时回到本机默认 Appium。
    this.baseUrl = this.defaultBaseUrl;
    const android = config.platform === 'android';
    const alwaysMatch: Record<string, unknown> = {
      platformName: android ? 'Android' : 'iOS',
      'appium:automationName': android ? 'UiAutomator2' : 'XCUITest',
      'appium:udid': config.deviceId,
      'appium:newCommandTimeout': 3600,
      'appium:noReset': true,
    };
    if (config.app) alwaysMatch['appium:app'] = config.app;
    if (android && config.packageName) alwaysMatch['appium:appPackage'] = config.packageName;
    if (android && config.activity) alwaysMatch['appium:appActivity'] = config.activity;
    // 部分应用把底栏/弹层放在独立窗口；多窗口模式才能让 page source 带出 llUnlock 这类控件。
    if (android) alwaysMatch['appium:enableMultiWindows'] = true;
    if (!android && config.bundleId) alwaysMatch['appium:bundleId'] = config.bundleId;
    if (!android) {
      if (config.platformVersion) alwaysMatch['appium:platformVersion'] = config.platformVersion;
      alwaysMatch['appium:mjpegServerPort'] = config.mjpegServerPort ?? 9100;
      alwaysMatch['appium:showXcodeLog'] = true;
      if (config.xcodeOrgId) alwaysMatch['appium:xcodeOrgId'] = config.xcodeOrgId;
      if (config.xcodeOrgId) alwaysMatch['appium:xcodeSigningId'] = config.xcodeSigningId || 'Apple Development';
      if (config.wdaBundleId) alwaysMatch['appium:updatedWDABundleId'] = config.wdaBundleId;
      if (config.wdaLocalPort) alwaysMatch['appium:wdaLocalPort'] = config.wdaLocalPort;
      if (config.derivedDataPath) alwaysMatch['appium:derivedDataPath'] = config.derivedDataPath;
      if (config.allowProvisioning) alwaysMatch['appium:allowProvisioningDeviceRegistration'] = true;
    }
    const value = await this.request<{ sessionId?: string; capabilities?: unknown }>('POST', '/session', { capabilities: { alwaysMatch, firstMatch: [{}] } }, 180_000);
    const sessionId = value.sessionId;
    if (!sessionId) throw new Error('Appium 未返回会话 ID');
    const rect = await this.request<Rect>('GET', `/session/${sessionId}/window/rect`);
    this.session = { sessionId, width: rect.width, height: rect.height, platform: config.platform };
    if (!android) {
      await this.request('POST', `/session/${sessionId}/appium/settings`, {
        settings: {
          mjpegServerFramerate: config.multiDevice ? 10 : 15,
          mjpegScalingFactor: config.multiDevice ? 35 : 50,
          mjpegServerScreenshotQuality: config.multiDevice ? 35 : 45,
          // XCUITest 默认会在每个命令前等待页面 idle 最多 2 秒，这是 iOS 操作慢的主要原因之一。
          waitForIdleTimeout: 0,
          animationCoolOffTimeout: 0,
          // 深度太小会裁掉表单输入框；保留 visible/accessible/traits 用于区分可点击目标，只排除无关属性。
          snapshotMaxDepth: 30,
          pageSourceExcludedAttributes: 'enabled,accessible,index,processId,bundleId',
        },
      });
    }
    if (!config.multiDevice) await this.startSourceCache();
    return this.session;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.session) return false;
    try {
      await this.request('GET', `/session/${this.session.sessionId}/window/rect`, undefined, 3000);
      return true;
    } catch { return false; }
  }

  async closeSession(): Promise<void> {
    if (!this.session) return;
    const id = this.session.sessionId;
    this.detachSession();
    await this.request('DELETE', `/session/${id}`);
  }

  /** 绑定一个已经存在的 Appium 会话，不创建、也不结束它。 */
  async attachSession(sessionId: string, platform: Platform, baseUrl: string): Promise<SessionState> {
    this.detachSession();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    const rect = await this.request<Rect>('GET', `/session/${sessionId}/window/rect`, undefined, 5000);
    this.session = { sessionId, width: rect.width, height: rect.height, platform, attached: true, video: 'none' };
    await this.startSourceCache(false);
    return this.session;
  }

  /** 只断开本地绑定，不向外部 Appium 服务发送 DELETE。 */
  detachSession(): void {
    this.generation++;
    this.session = null;
    this.sourceCache = null;
    if (this.sourceTimer) clearInterval(this.sourceTimer);
    this.sourceTimer = null;
    this.lastActionAt = 0;
  }

  async snapshot(): Promise<Snapshot> {
    const session = this.requireSession();
    const [screenshot, source] = await Promise.all([
      this.request<string>('GET', this.path('/screenshot')),
      this.request<string>('GET', this.path('/source')),
    ]);
    this.sourceCache = this.parseSource(source);
    return { screenshot, source, width: session.width, height: session.height };
  }

  async screenshot(): Promise<string> {
    this.requireSession();
    return this.request<string>('GET', this.path('/screenshot'));
  }

  inspectCached(x: number, y: number): RecordedTap {
    const session = this.requireSession();
    const target = this.sourceCache
      ? analyzeTarget(this.sourceCache.xml, x, y, session.platform, session.width, session.height)
      : { label: '坐标目标', coordinate: { xRatio: x / session.width, yRatio: y / session.height } };
    return { target, x, y };
  }

  /** 元素拾取使用最新 page source，不依赖缓存。 */
  async inspectFresh(x: number, y: number): Promise<RecordedTap> {
    const session = this.requireSession();
    const xml = await this.pageSource();
    this.sourceCache = this.parseSource(xml);
    return { target: analyzeTarget(xml, x, y, session.platform, session.width, session.height), x, y };
  }

  /** 录制点击优先使用较新的缓存；缓存过旧或不存在时才刷新一次。 */
  async inspectBest(x: number, y: number, maxAgeMs: number): Promise<RecordedTap> {
    if (this.sourceCache && Date.now() - this.sourceCache.updatedAt <= maxAgeMs) return this.inspectCached(x, y);
    await this.refreshSource();
    return this.inspectCached(x, y);
  }

  getSession(): SessionState | null { return this.session; }

  async refreshSource(): Promise<void> {
    if (!this.session || this.sourceRequest) return this.sourceRequest ?? Promise.resolve();
    const startedAt = Date.now();
    const generation = this.generation;
    this.sourceRequest = this.request<string>('GET', this.path('/source'))
      .then((xml) => {
        // 请求发出后设备又发生了操作，或者会话已经切换，这份树直接丢弃。
        if (generation === this.generation && startedAt >= this.lastActionAt) this.sourceCache = this.parseSource(xml);
      })
      .catch(() => undefined)
      .finally(() => { this.sourceRequest = null; });
    return this.sourceRequest;
  }

  /** 标记一次设备操作，用于丢弃操作前发起的旧控件树。 */
  markAction(): void { this.lastActionAt = Date.now(); }

  /**
   * 录制前确保缓存树是上一次设备操作之后读取的。
   * 页面切换后先等动画稳定一点，再刷新；只有缓存确实过期时才会产生等待。
   */
  async ensureSourceAfterAction(settleMs = 500): Promise<void> {
    if (!this.session) return;
    const fresh = this.sourceCache && this.sourceCache.updatedAt > this.lastActionAt;
    if (fresh) return;
    const wait = Math.max(0, settleMs - (Date.now() - this.lastActionAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    await this.refreshSource();
    if (!this.sourceCache || this.sourceCache.updatedAt <= this.lastActionAt) {
      try {
        this.sourceCache = this.parseSource(await this.pageSource());
      } catch { /* 读取失败时继续使用旧缓存，由实时校验兜底。 */ }
    }
  }

  private parseSource(xml: string): { xml: string; updatedAt: number; editableFocused: boolean } {
    let editableFocused = false;
    if (this.session) {
      try {
        const node = findFocusedNode(parseTree(xml));
        editableFocused = Boolean(node && isEditableNode(node, this.session.platform));
      } catch { /* 控件树解析失败时仅影响键盘提示。 */ }
    }
    return { xml, updatedAt: Date.now(), editableFocused };
  }

  async tap(target: Target): Promise<void> {
    let elementId: string | null = null;
    try { elementId = target.locator ? await this.findElement(target.locator, true) : null; } catch { elementId = null; }
    if (elementId) {
      await this.clickElement(elementId);
      return;
    }
    if (!target.coordinate) throw new Error('步骤既没有有效定位器，也没有坐标兜底');
    const session = this.requireSession();
    await this.performTap(Math.round(target.coordinate.xRatio * session.width), Math.round(target.coordinate.yRatio * session.height));
  }

  async input(target: Target, value: string, clearFirst: boolean): Promise<void> {
    if (!target.locator) throw new Error('输入步骤必须包含控件定位器');
    const id = await this.findElement(target.locator, true);
    if (!id) throw new Error(`未找到输入控件：${target.locator.value}`);
    await this.setElementValue(id, value, clearFirst);
  }

  async findElementId(locator: Locator): Promise<string | null> { return this.findElement(locator, true); }

  async findElementIds(locator: Locator, timeout = 20_000): Promise<string[]> {
    const list = await this.request<Array<Record<string, string>>>('POST', this.path('/elements'), { using: locator.strategy, value: locator.value }, timeout);
    if (!Array.isArray(list)) return [];
    return list.map((element) => element[ELEMENT_KEY] ?? element.ELEMENT).filter((id): id is string => Boolean(id));
  }

  async elementBounds(elementId: string, timeout = 20_000): Promise<Rect> {
    return this.request<Rect>('GET', this.path(`/element/${elementId}/rect`), undefined, timeout);
  }

  async elementReady(elementId: string): Promise<{ displayed: boolean; enabled: boolean }> {
    const [displayed, enabled] = await Promise.all([
      this.request<boolean>('GET', this.path(`/element/${elementId}/displayed`)),
      this.request<boolean>('GET', this.path(`/element/${elementId}/enabled`)),
    ]);
    return { displayed: Boolean(displayed), enabled: Boolean(enabled) };
  }

  async elementValue(elementId: string): Promise<{ text: string | null; password: boolean }> {
    const [text, password, type] = await Promise.all([
      this.readValue(elementId).catch((error) => {
        if (error instanceof AppiumError && (error.status === 404 || error.code === 'stale element reference')) throw error;
        return null;
      }),
      this.readAttribute(elementId, 'password').catch(() => ''),
      this.readAttribute(elementId, 'type').catch(() => ''),
    ]);
    return { text, password: password === 'true' || /SecureTextField/.test(type) };
  }

  async elementAttribute(elementId: string, name: string): Promise<string> {
    return this.readAttribute(elementId, name);
  }

  async clickElement(elementId: string): Promise<void> {
    await this.request('POST', this.path(`/element/${elementId}/click`), {});
    this.markAction();
  }

  async tapPoint(x: number, y: number): Promise<void> {
    await this.performTap(x, y);
    this.markAction();
  }

  async setElementValue(elementId: string, value: string, clearFirst: boolean): Promise<void> {
    if (clearFirst) await this.request('POST', this.path(`/element/${elementId}/clear`), {});
    await this.request('POST', this.path(`/element/${elementId}/value`), { text: value, value: [...value] });
    this.markAction();
  }

  async doubleTap(target: Target): Promise<void> {
    const session = this.requireSession();
    const elementId = await this.findOptionalElement(target);
    if (session.platform === 'android') {
      const params = elementId ? { elementId } : this.pointFor(target);
      await this.executeScript('mobile: doubleClickGesture', [params]);
      this.markAction();
      return;
    }
    const point = await this.centerFor(target, elementId);
    await this.executeScript('mobile: doubleTap', [point]);
    this.markAction();
  }

  async longPress(target: Target, duration: number): Promise<void> {
    const session = this.requireSession();
    const elementId = await this.findOptionalElement(target);
    if (session.platform === 'android') {
      const params = elementId ? { elementId, duration } : { ...this.pointFor(target), duration };
      await this.executeScript('mobile: longClickGesture', [params]);
      this.markAction();
      return;
    }
    const point = await this.centerFor(target, elementId);
    await this.executeScript('mobile: touchAndHold', [{ ...point, duration: Math.max(0.5, duration / 1000) }]);
    this.markAction();
  }

  async pinch(target: Target | undefined, direction: 'in' | 'out', scale: number, duration: number): Promise<void> {
    const session = this.requireSession();
    const elementId = target ? await this.findOptionalElement(target) : null;
    if (session.platform === 'android') {
      const script = direction === 'out' ? 'mobile: pinchOpenGesture' : 'mobile: pinchCloseGesture';
      const params = elementId ? { elementId, percent: 0.75 } : { ...this.pinchRect(target), percent: 0.75 };
      await this.executeScript(script, [params]);
      this.markAction();
      return;
    }
    if (elementId) {
      const pinchScale = direction === 'out' ? Math.max(1.2, scale) : Math.min(0.8, scale);
      await this.executeScript('mobile: pinch', [{ elementId, scale: pinchScale, velocity: 1.0 }]);
      this.markAction();
      return;
    }
    const point = target ? this.pointFor(target) : { x: Math.round(session.width / 2), y: Math.round(session.height / 2) };
    await this.pinchAt(point.x, point.y, direction, scale, duration);
    this.markAction();
  }

  async pageSource(): Promise<string> {
    this.requireSession();
    return this.request('GET', this.path('/source'));
  }

  /** 读取当前前台应用的 bundleId，Android 由服务端通过 adb 获取。 */
  async currentApp(): Promise<string | null> {
    const session = this.requireSession();
    if (session.platform === 'android') {
      try {
        const pkg = await this.request<unknown>('GET', this.path('/appium/device/current_package'));
        return pkg ? String(pkg) : null;
      } catch { return null; }
    }
    try {
      const info = await this.request<{ bundleId?: string }>('POST', this.path('/execute/sync'), { script: 'mobile: activeAppInfo', args: [] });
      return info?.bundleId ?? null;
    } catch { return null; }
  }

  async swipe(direction: 'up' | 'down' | 'left' | 'right', duration: number, start?: Point, end?: Point): Promise<void> {
    const { width, height } = this.requireSession();
    const points = {
      up: [width * .5, height * .78, width * .5, height * .25],
      down: [width * .5, height * .25, width * .5, height * .78],
      left: [width * .8, height * .5, width * .2, height * .5],
      right: [width * .2, height * .5, width * .8, height * .5],
    }[direction];
    const [x1, y1, x2, y2] = points.map(Math.round);
    const from = start ?? { x: x1, y: y1 };
    const to = end ?? { x: x2, y: y2 };
    await this.actions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, x: from.x, y: from.y, origin: 'viewport' }, { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 120 }, { type: 'pointerMove', duration, x: to.x, y: to.y, origin: 'viewport' }, { type: 'pointerUp', button: 0 },
    ] }]);
    this.markAction();
  }

  async back(): Promise<void> {
    const session = this.requireSession();
    if (session.platform === 'android') await this.request('POST', this.path('/back'), {});
    else await this.request('POST', this.path('/actions'), { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
    this.markAction();
  }

  /** 向当前获得焦点的控件输入文本，没有可输入控件时静默忽略。 */
  async typeText(text: string): Promise<boolean> {
    const elementId = await this.activeElement();
    if (elementId) {
      try {
        await this.request('POST', this.path(`/element/${elementId}/value`), { text, value: [...text] });
        this.markAction();
        return true;
      } catch { /* 某些自定义输入框不支持 setValue，继续尝试 W3C keys。 */ }
    }
    try {
      await this.request('POST', this.path('/keys'), { value: [...text] });
      this.markAction();
      return true;
    } catch { return false; }
  }

  /** 当前是否聚焦在可输入控件上，用于提示键盘输入是否生效。 */
  hasEditableFocus(): boolean {
    return this.sourceCache?.editableFocused ?? true;
  }

  /** 读取当前焦点控件的定位目标和已输入内容，用于把键盘输入记录成步骤。 */
  async typingSnapshot(): Promise<TypingSnapshot> {
    const session = this.requireSession();
    const elementId = await this.activeElement();
    let target: Target | undefined;
    if (session.platform === 'ios' && elementId) {
      target = await this.targetFromElement(elementId).catch(() => undefined);
    }
    if (!target) {
      let xml = this.sourceCache?.xml;
      if (session.platform === 'android' || !xml) {
        try {
          xml = await this.pageSource();
          this.sourceCache = this.parseSource(xml);
        } catch { /* 读取失败时退回缓存，不影响键盘输入本身。 */ }
      }
      target = xml ? focusedTarget(xml, session.platform, session.width, session.height) : undefined;
    }
    const value = elementId ? await this.elementValue(elementId).catch(() => null) : null;
    const placeholder = elementId ? await this.readAttribute(elementId, 'placeholderValue').catch(() => '') : '';
    return { target, value: value?.text ?? undefined, placeholder: placeholder || undefined, password: value?.password ?? false };
  }

  /** 从 active element 直接构造输入步骤目标，避免依赖完整 page source。 */
  private async targetFromElement(elementId: string): Promise<Target | undefined> {
    const session = this.requireSession();
    const [rect, name, label, type] = await Promise.all([
      this.elementRect(elementId).catch(() => null),
      this.readAttribute(elementId, 'name').catch(() => ''),
      this.readAttribute(elementId, 'label').catch(() => ''),
      this.readAttribute(elementId, 'type').catch(() => ''),
    ]);
    if (!rect || !/TextField|TextView|SearchField/i.test(type)) return undefined;
    const candidates: LocatorCandidate[] = [];
    const add = (locator: Locator, score: number, source: LocatorCandidate['source']) => candidates.push({ locator, matches: 1, unique: false, score, role: 'alternative', source });
    if (name) {
      add({ strategy: 'accessibility id', value: name }, 100, 'attribute');
      add({ strategy: '-ios predicate string', value: `name == '${escapeIos(name)}'` }, 92, 'semantic');
      if (type) add({ strategy: '-ios predicate string', value: `type == '${escapeIos(type)}' AND name == '${escapeIos(name)}'` }, 90, 'semantic');
    }
    if (label) {
      add({ strategy: '-ios predicate string', value: `label == '${escapeIos(label)}'` }, 75, 'semantic');
      if (type) add({ strategy: '-ios predicate string', value: `type == '${escapeIos(type)}' AND label == '${escapeIos(label)}'` }, 85, 'semantic');
    }
    add({
      strategy: 'xpath',
      value: `//*[@x='${rect.x}'][@y='${rect.y}'][@width='${rect.width}'][@height='${rect.height}']`,
    }, 42, 'xpath');
    const locator = candidates[0]?.locator;
    return {
      locator,
      label: name || label || '输入框',
      bounds: rect,
      coordinate: {
        xRatio: clamp((rect.x + rect.width / 2) / session.width),
        yRatio: clamp((rect.y + rect.height / 2) / session.height),
      },
      candidates,
      warning: locator ? undefined : '输入框没有可用定位器',
      verifiedAt: undefined,
    };
  }

  private async findOptionalElement(target: Target): Promise<string | null> {
    if (!target.locator) return null;
    try { return await this.findElement(target.locator, true); } catch { return null; }
  }

  private async centerFor(target: Target, elementId: string | null): Promise<Point> {
    if (elementId) {
      const rect = await this.elementRect(elementId).catch(() => null);
      if (rect) return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }
    return this.pointFor(target);
  }

  private pointFor(target: Target): Point {
    const session = this.requireSession();
    if (target.bounds) return { x: Math.round(target.bounds.x + target.bounds.width / 2), y: Math.round(target.bounds.y + target.bounds.height / 2) };
    if (target.coordinate) return { x: Math.round(target.coordinate.xRatio * session.width), y: Math.round(target.coordinate.yRatio * session.height) };
    return { x: Math.round(session.width / 2), y: Math.round(session.height / 2) };
  }

  private pinchRect(target: Target | undefined): { left: number; top: number; width: number; height: number } {
    const session = this.requireSession();
    const bounds = target?.bounds;
    if (bounds) return { left: Math.round(bounds.x), top: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
    return { left: Math.round(session.width * .25), top: Math.round(session.height * .25), width: Math.round(session.width * .5), height: Math.round(session.height * .5) };
  }

  private async pinchAt(x: number, y: number, direction: 'in' | 'out', scale: number, duration: number): Promise<void> {
    const { height } = this.requireSession();
    const radius = Math.max(40, Math.round(Math.min(this.requireSession().width, height) / 6));
    const factor = direction === 'out' ? Math.max(1.2, scale) : Math.min(0.8, scale);
    const endRadius = Math.round(radius * factor);
    await this.actions([
      { type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, x, y: y - radius, origin: 'viewport' }, { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration, x, y: y - endRadius, origin: 'viewport' }, { type: 'pointerUp', button: 0 },
      ] },
      { type: 'pointer', id: 'finger2', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, x, y: y + radius, origin: 'viewport' }, { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration, x, y: y + endRadius, origin: 'viewport' }, { type: 'pointerUp', button: 0 },
      ] },
    ]);
  }

  private async elementRect(elementId: string): Promise<Rect> {
    return this.request<Rect>('GET', this.path(`/element/${elementId}/rect`));
  }

  private async executeScript(script: string, args: unknown[]): Promise<void> {
    await this.request('POST', this.path('/execute/sync'), { script, args });
  }

  private async activeElement(): Promise<string | null> {
    try {
      const element = await this.request<Record<string, string>>('GET', this.path('/element/active'));
      return element[ELEMENT_KEY] ?? element.ELEMENT ?? null;
    } catch { return null; }
  }

  private async readValue(elementId: string): Promise<string | null> {
    // iOS 的 Button/StaticText 往往没有 value，却有 label；/text 会返回实际可见文本。
    for (const suffix of [`/element/${elementId}/text`, `/element/${elementId}/attribute/value`, `/element/${elementId}/attribute/label`]) {
      try {
        const value = await this.request<unknown>('GET', this.path(suffix));
        if (value !== null && value !== undefined) return String(value);
      } catch { /* 不同控件支持的可读属性不同，继续尝试下一个。 */ }
    }
    return null;
  }

  private async readAttribute(elementId: string, name: string): Promise<string> {
    return String(await this.request('GET', this.path(`/element/${elementId}/attribute/${name}`)));
  }

  private async performTap(x: number, y: number): Promise<void> {
    await this.actions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, x, y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 },
    ] }]);
  }

  private async startSourceCache(poll = true): Promise<void> {
    if (this.sourceTimer) clearInterval(this.sourceTimer);
    this.sourceTimer = null;
    // 首次读取阻塞在会话创建里，保证第一次点击有控件树可用。
    await this.refreshSource();
    // 外部附加会话默认不周期轮询，避免干扰正在使用该会话的其他客户端。
    if (poll && this.session?.platform === 'android') {
      this.sourceTimer = setInterval(() => void this.refreshSource(), 1500);
      this.sourceTimer.unref();
    }
  }

  private async actions(actions: unknown[]): Promise<void> { await this.request('POST', this.path('/actions'), { actions }); }

  private async findElement(locator: Locator, allowMissing = false): Promise<string | null> {
    try {
      const element = await this.request<Record<string, string>>('POST', this.path('/element'), { using: locator.strategy, value: locator.value });
      return element[ELEMENT_KEY] ?? element.ELEMENT ?? null;
    } catch (error) {
      if (allowMissing && error instanceof AppiumError && (error.status === 404 || error.code === 'no such element' || error.code === 'stale element reference')) return null;
      throw error;
    }
  }

  private path(suffix: string): string { return `/session/${this.requireSession().sessionId}${suffix}`; }
  private requireSession(): SessionState { if (!this.session) throw new Error('尚未连接设备会话'); return this.session; }

  private async request<T = unknown>(method: string, path: string, body?: unknown, timeout = 20_000): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) throw new AppiumError(`Appium 请求超时（${timeout}ms）`, 'timeout');
      throw cause;
    }
    const data = await response.json().catch(() => ({ value: { message: `HTTP ${response.status}` } })) as { value?: T & { message?: string; error?: string }; sessionId?: string };
    if (!response.ok) {
      const detail = data.value as { message?: string; error?: string } | undefined;
      throw new AppiumError(detail?.message ?? `Appium 请求失败：HTTP ${response.status}`, detail?.error, response.status);
    }
    const value = data.value as T;
    if (value && typeof value === 'object' && !('sessionId' in value) && data.sessionId) Object.assign(value, { sessionId: data.sessionId });
    return value;
  }
}

function escapeIos(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}
