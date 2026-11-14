import { XMLParser } from 'fast-xml-parser';
import type { Locator, LocatorCandidate, Platform, Target } from '../src/types.js';

export interface Rect { x: number; y: number; width: number; height: number }
export interface XmlNode {
  [key: string]: unknown;
  '@_resource-id'?: string;
  '@_content-desc'?: string;
  '@_text'?: string;
  '@_name'?: string;
  '@_label'?: string;
  '@_value'?: string;
  '@_type'?: string;
  '@_class'?: string;
  '@_bounds'?: string;
  '@_x'?: string;
  '@_y'?: string;
  '@_width'?: string;
  '@_height'?: string;
}

export interface SemanticLabel { value: string; attribute: 'text' | 'content-desc' | 'label' | 'name' }
interface FlatNode { node: XmlNode; rect: Rect; area: number; order: number; parent: XmlNode | null }
interface DescribedNode extends FlatNode {
  clickable: boolean;
  actionable: boolean;
  visible: boolean;
  ignored: boolean;
  directLabel: SemanticLabel | null;
  descendantLabel: SemanticLabel | null;
  locator?: Locator;
}
interface RawCandidate {
  locator: Locator;
  source: LocatorCandidate['source'];
  baseScore: number;
  matches: number;
  note?: string;
  indexed?: boolean;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export function parseTree(xml: string): XmlNode {
  return parser.parse(xml) as XmlNode;
}

export function nodeRect(node: XmlNode): Rect | null {
  const bounds = String(node['@_bounds'] ?? '');
  const match = bounds.match(/\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]/);
  if (match) return { x: +match[1], y: +match[2], width: +match[3] - +match[1], height: +match[4] - +match[2] };
  const [x, y, width, height] = ['@_x', '@_y', '@_width', '@_height'].map((key) => Number(node[key]));
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
}

export function visit(value: unknown, callback: (node: XmlNode) => void): void {
  if (!value || typeof value !== 'object') return;
  const node = value as XmlNode;
  callback(node);
  Object.entries(node).forEach(([key, child]) => {
    if (key.startsWith('@_')) return;
    if (Array.isArray(child)) child.forEach((item) => visit(item, callback));
    else visit(child, callback);
  });
}

export function directNodeLabel(node: XmlNode): SemanticLabel | null {
  const fields: Array<[SemanticLabel['attribute'], unknown]> = [
    ['text', node['@_text']],
    ['content-desc', node['@_content-desc']],
    ['label', node['@_label']],
    ['name', node['@_name']],
  ];
  for (const [attribute, raw] of fields) {
    const value = String(raw ?? '').trim();
    if (value) return { value, attribute };
  }
  return null;
}

export function firstDescendantLabel(node: XmlNode): SemanticLabel | null {
  let found: SemanticLabel | null = null;
  for (const [key, child] of Object.entries(node)) {
    if (found || key.startsWith('@_') || !child || typeof child !== 'object') continue;
    const children = Array.isArray(child) ? child : [child];
    for (const item of children) {
      if (found) break;
      const childNode = item as XmlNode;
      found = directNodeLabel(childNode) ?? firstDescendantLabel(childNode);
    }
  }
  return found;
}

export function findFocusedNode(value: unknown): XmlNode | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as XmlNode;
  if (String(node['@_focused'] ?? '') === 'true') return node;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('@_') || !child || typeof child !== 'object') continue;
    const children = Array.isArray(child) ? child : [child];
    for (const item of children) {
      const found = findFocusedNode(item);
      if (found) return found;
    }
  }
  return null;
}

export function isEditableNode(node: XmlNode, platform: Platform): boolean {
  const type = String(node['@_class'] ?? node['@_type'] ?? '');
  if (platform === 'android') return /EditText|AutoCompleteTextView|SearchView/.test(type) || node['@_input-type'] !== undefined;
  return /TextField|TextView|SearchField/.test(type);
}

/** 按 XML 子节点顺序返回元素，供元素树和按路径分析共用。 */
export function childEntries(node: XmlNode): Array<{ key: string; node: XmlNode }> {
  const result: Array<{ key: string; node: XmlNode }> = [];
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('@_') || !child || typeof child !== 'object') continue;
    if (Array.isArray(child)) {
      child.forEach((item) => { if (item && typeof item === 'object') result.push({ key, node: item as XmlNode }); });
    } else {
      result.push({ key, node: child as XmlNode });
    }
  }
  return result;
}

export function nodeAtPath(root: XmlNode, path: number[]): XmlNode | null {
  let current: XmlNode | undefined = root;
  for (const index of path) {
    if (!current) return null;
    const next: { key: string; node: XmlNode } | undefined = childEntries(current)[index];
    if (!next) return null;
    current = next.node;
  }
  return current ?? null;
}

/** 按元素树中的节点路径精确生成候选定位器，不依赖点击坐标和目标选择启发式。 */
export function analyzeElement(xml: string, path: number[], platform: Platform, width: number, height: number): Target {
  const root = parseTree(xml);
  const node = nodeAtPath(root, path);
  if (!node) throw new Error('元素节点不存在，控件树可能已变化');
  const { nodes } = collectNodes(root);
  const described = describeNodes(nodes, platform);
  const selected = described.find((item) => item.node === node);
  if (!selected) throw new Error('该节点没有边界信息，无法生成定位器');
  const xRatio = clamp((selected.rect.x + selected.rect.width / 2) / width);
  const yRatio = clamp((selected.rect.y + selected.rect.height / 2) / height);
  return buildTarget(selected, platform, described, width, height, { xRatio, yRatio }, selected);
}

/** 生成录制目标的候选定位器、推荐项与坐标兜底。 */
export function analyzeTarget(xml: string, x: number, y: number, platform: Platform, width: number, height: number): Target {
  const root = parseTree(xml);
  const { nodes, parents } = collectNodes(root);
  const described = describeNodes(nodes, platform);
  const containing = described
    .filter(({ rect }) => x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height)
    .filter((item) => item.visible && !item.ignored)
    .sort((a, b) => a.area - b.area || b.order - a.order);
  if (containing.length === 0) return coordinateTarget(x, y, width, height);

  const locatorCounts = new Map<string, number>();
  for (const item of described) if (item.locator) locatorCounts.set(locatorKey(item.locator), (locatorCounts.get(locatorKey(item.locator)) ?? 0) + 1);
  const byNode = new Map(described.map((item) => [item.node, item]));
  const screenArea = width * height;
  const leaf = containing[0];
  const leafUnique = Boolean(leaf.locator && locatorCounts.get(locatorKey(leaf.locator)) === 1);
  const selected = selectTarget(leaf, byNode, parents, platform, screenArea, leafUnique);
  // 大面积、无直接标签的容器（尤其整屏可点击容器）点中心容易点错，改用坐标目标。
  const selectedClass = String(selected.node[platform === 'android' ? '@_class' : '@_type'] ?? '');
  const wholeScreen = selected.area > screenArea * (platform === 'android' ? 0.5 : 0.65);
  const structural = (!selected.actionable && selected.area > screenArea * 0.5)
    || (selected.actionable && wholeScreen)
    || (!selected.directLabel && !selected.actionable && selected.area > screenArea * 0.25)
    || (!selected.descendantLabel && selected.area > screenArea * 0.85)
    || /ScrollView|RecyclerView|ViewPager|HorizontalScrollView|CollectionView|TableView/i.test(selectedClass);
  if (structural) return coordinateTarget(x, y, width, height);
  return buildTarget(selected, platform, described, width, height, { xRatio: clamp(x / width), yRatio: clamp(y / height) }, leaf);
}

/** 读取当前焦点输入框的目标信息，用于键盘输入记录。 */
export function focusedTarget(xml: string, platform: Platform, width: number, height: number): Target | undefined {
  const root = parseTree(xml);
  const node = findFocusedNode(root);
  if (!node || !isEditableNode(node, platform)) return undefined;
  const rect = nodeRect(node);
  if (!rect) return undefined;
  const { nodes } = collectNodes(root);
  const described = describeNodes(nodes, platform);
  const focused = described.find((item) => item.node === node);
  if (!focused) return undefined;
  return buildTarget(focused, platform, described, width, height, {
    xRatio: clamp((rect.x + rect.width / 2) / width),
    yRatio: clamp((rect.y + rect.height / 2) / height),
  });
}

export interface LiveCandidateMatch {
  locator: Locator;
  matches: number;
  bounds?: Rect;
  error?: string;
}

/**
 * 用 Appium 实时结果校验候选：只有恰好命中 1 个、且元素范围落在录制目标范围内的定位器才算可靠。
 * 不合法的候选会被降级，主定位会自动切换到已验证候选中分数最高的一个。
 */
export function applyLiveMatches(target: Target, results: LiveCandidateMatch[]): Target {
  const live = new Map(results.map((item) => [locatorKey(item.locator), item]));
  const candidates: LocatorCandidate[] = (target.candidates ?? []).map((candidate) => {
    const match = live.get(locatorKey(candidate.locator));
    if (!match) return candidate;
    const indexed = isOccurrenceLocator(candidate.locator);
    const stableIndex = !indexed || isScopedLocator(candidate.locator);
    const inTarget = match.bounds ? rectWithin(target.bounds, match.bounds) : true;
    const verified = match.matches === 1 && inTarget && !match.error;
    const note = match.error
      ? `实时校验失败：${match.error}`
      : match.matches === 0
        ? '实时未命中'
        : match.matches > 1
          ? `实时匹配 ${match.matches} 个`
          : inTarget
            ? '实时校验唯一'
            : '实时命中其他位置';
    return {
      ...candidate,
      matches: Math.max(0, match.matches),
      unique: verified,
      verified,
      note,
      role: !stableIndex || !verified ? 'brittle' as const : 'alternative' as const,
      score: scoreFor(candidate.locator, Math.max(0, match.matches), indexed),
    };
  });
  const verified = candidates.filter((candidate) => candidate.verified).sort(byScore);
  const recommended = verified.find((candidate) => candidate.role !== 'brittle');
  for (const candidate of candidates) {
    if (candidate === recommended) candidate.role = 'recommended';
    else if (candidate.role === 'recommended') candidate.role = candidate.unique ? 'alternative' : 'brittle';
  }
  const sorted = sortCandidates(candidates);
  const failed = (candidate: LocatorCandidate) => {
    const match = live.get(locatorKey(candidate.locator));
    return Boolean(match && (match.matches !== 1 || Boolean(match.error) || (match.bounds && !rectWithin(target.bounds, match.bounds))));
  };
  const current = target.locator ? sorted.find((candidate) => locatorKey(candidate.locator) === locatorKey(target.locator!)) : undefined;
  const primary = recommended
    ?? (current && !failed(current) ? current : undefined)
    ?? sorted.find((candidate) => !failed(candidate))
    ?? pickPrimary(sorted);
  const attempted = results.length > 0;
  return {
    ...target,
    locator: primary?.locator ?? target.locator,
    candidates: sorted,
    verifiedAt: attempted ? Date.now() : target.verifiedAt,
    warning: recommended
      ? undefined
      : attempted
        ? verified.length > 0
          ? '该控件只能用带序号的定位器，页面顺序变化时可能点错或回放失败'
          : '当前页面无法唯一定位该控件，回放可能失败；可手动修正定位器或改用坐标'
        : target.warning,
  };
}

/** 兼容旧调用：只更新命中数，不判断元素位置。 */
export function applyCandidateMatches(target: Target, results: Array<{ locator: Locator; matches: number }>): Target {
  return applyLiveMatches(target, results);
}

export function rectWithin(target: Target['bounds'] | Rect | undefined, candidate: Rect): boolean {
  if (!target) return true;
  const tolerance = 3;
  return candidate.x >= target.x - tolerance
    && candidate.y >= target.y - tolerance
    && candidate.x + candidate.width <= target.x + target.width + tolerance
    && candidate.y + candidate.height <= target.y + target.height + tolerance;
}

/** 回放候选链：主定位器 + 已验证唯一的候选；唯一但依赖序号的定位器排在最后兜底。 */
export function fallbackLocators(target: Target): Locator[] {
  const list: Locator[] = [];
  const seen = new Set<string>();
  const push = (locator: Locator | undefined) => {
    if (!locator || seen.has(locatorKey(locator))) return;
    seen.add(locatorKey(locator));
    list.push(locator);
  };
  push(target.locator);
  const candidates = target.candidates ?? [];
  const safe = candidates
    .filter((candidate) => candidate.unique && candidate.role !== 'brittle' && (!isOccurrenceLocator(candidate.locator) || isScopedLocator(candidate.locator)))
    .sort(byScore);
  safe.forEach((candidate) => push(candidate.locator));
  const indexed = candidates
    .filter((candidate) => candidate.unique && isOccurrenceLocator(candidate.locator) && !isScopedLocator(candidate.locator) && candidate.note?.startsWith('依赖序号'))
    .sort(byScore);
  indexed.forEach((candidate) => push(candidate.locator));
  return list;
}

function pickPrimary(candidates: LocatorCandidate[]): LocatorCandidate | undefined {
  const ordered = [...candidates].sort(byScore);
  return ordered.find((candidate) => candidate.role === 'recommended')
    ?? ordered.find((candidate) => candidate.unique && isOccurrenceLocator(candidate.locator))
    ?? ordered.find((candidate) => candidate.unique)
    ?? ordered[0];
}

export function isOccurrenceLocator(locator: Locator): boolean {
  switch (locator.strategy) {
    case '-android uiautomator': return /\.instance\(\s*\d+\s*\)/.test(locator.value);
    case '-ios predicate string': return /\bindex\s*==/.test(locator.value);
    case '-ios class chain': return /\]\[\d+\]/.test(locator.value);
    case 'xpath': return /\[\d+\]$/.test(locator.value.trim());
    default: return false;
  }
}

/** 带语义祖先或容器条件的 XPath 虽然以序号结尾，但不是全局第 n 个同类元素，实时校验唯一后可以作为主定位。 */
export function isScopedLocator(locator: Locator): boolean {
  if (locator.strategy !== 'xpath') return false;
  const value = locator.value.trim();
  if (/^\(\s*\/\//.test(value)) return false;
  if (/@bounds/.test(value)) return false;
  return /\[@[^\]]+=[^\]]+\]\s*\//.test(value) || /\[\.\/\//.test(value);
}

export function locatorKey(locator: Locator): string { return `${locator.strategy}\0${locator.value}`; }

function collectNodes(root: XmlNode): { nodes: FlatNode[]; parents: Map<XmlNode, XmlNode | null> } {
  const nodes: FlatNode[] = [];
  const parents = new Map<XmlNode, XmlNode | null>();
  let order = 0;
  const walk = (value: unknown, parent: XmlNode | null) => {
    if (!value || typeof value !== 'object') return;
    const node = value as XmlNode;
    parents.set(node, parent);
    const rect = nodeRect(node);
    if (rect) nodes.push({ node, rect, area: rect.width * rect.height, order: order++, parent });
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('@_')) continue;
      if (Array.isArray(child)) child.forEach((item) => walk(item, node));
      else walk(child, node);
    }
  };
  walk(root, null);
  return { nodes, parents };
}

function describeNodes(nodes: FlatNode[], platform: Platform): DescribedNode[] {
  return nodes.map((item) => {
    const directLabel = directNodeLabel(item.node);
    return {
      ...item,
      clickable: String(item.node['@_clickable'] ?? '') === 'true',
      actionable: isActionableNode(item.node, platform),
      visible: String(item.node['@_visible'] ?? 'true') !== 'false',
      ignored: isIgnoredNode(item.node, item.rect),
      directLabel,
      descendantLabel: directLabel ? null : firstDescendantLabel(item.node),
      locator: makeLocator(item.node, platform),
    };
  });
}

const IOS_ACTIONABLE_TYPES = new Set([
  'XCUIElementTypeButton',
  'XCUIElementTypeCell',
  'XCUIElementTypeLink',
  'XCUIElementTypeTab',
  'XCUIElementTypeSwitch',
  'XCUIElementTypeSlider',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField',
  'XCUIElementTypeTextView',
  'XCUIElementTypePickerWheel',
  'XCUIElementTypeSegmentedControl',
  'XCUIElementTypeStepper',
  'XCUIElementTypeMenuItem',
  'XCUIElementTypeMenuButton',
]);

function isActionableNode(node: XmlNode, platform: Platform): boolean {
  if (isEditableNode(node, platform)) return true;
  if (platform === 'android') return String(node['@_clickable'] ?? '') === 'true';
  const type = String(node['@_type'] ?? node['@_class'] ?? '');
  if (IOS_ACTIONABLE_TYPES.has(type)) return true;
  const traits = String(node['@_traits'] ?? '');
  return /\b(Button|Link|SearchField)\b/.test(traits);
}

function isIgnoredNode(node: XmlNode, rect: Rect): boolean {
  if (Math.min(rect.width, rect.height) <= 6) return true;
  const type = String(node['@_type'] ?? node['@_class'] ?? '');
  if (/ScrollBar|ScrollIndicator/i.test(type)) return true;
  const label = String(node['@_label'] ?? node['@_content-desc'] ?? node['@_text'] ?? '');
  return /scroll\s*(bar|indicator|thumb)|滚动条|شريط\s*تمرير/i.test(label);
}

function selectTarget(leaf: DescribedNode, byNode: Map<XmlNode, DescribedNode>, parents: Map<XmlNode, XmlNode | null>, platform: Platform, screenArea: number, leafUnique: boolean): DescribedNode {
  if (platform === 'android') {
    // Android 优先保留点中的叶子，避免把放大镜这类图标升级成外层可点击容器。
    if (leaf.locator || leaf.directLabel || leaf.descendantLabel) return leaf;
    if (String(leaf.node['@_class'] ?? '')) return leaf;
    return findNearestActionable(leaf, byNode, parents, screenArea) ?? leaf;
  }
  if (leaf.actionable) return leaf;
  const actionable = findNearestActionable(leaf, byNode, parents, screenArea);
  const weak = isWeakLeaf(leaf);
  // 只有紧贴点击位置、且本身带语义的按钮/单元格才值得把叶子升级上去；整行大 Cell 不应覆盖用户点中的标题。
  const closeActionable = Boolean(actionable?.directLabel && actionable.area <= leaf.area * 6 && actionable.area <= screenArea * 0.4);
  if (leafUnique && !weak && !closeActionable) return leaf;
  if (actionable) return actionable;
  if (leafUnique && !weak) return leaf;
  // 不能从重叠的兄弟节点里挑一个“看起来可点击”的控件；那会把标题点击记成页面上的其他按钮。
  return leaf;
}

function isWeakLeaf(item: DescribedNode): boolean {
  const type = String(item.node['@_type'] ?? item.node['@_class'] ?? '');
  if (type !== 'XCUIElementTypeImage' && type !== 'XCUIElementTypeOther') return false;
  const text = `${attr(item.node, '@_name')} ${attr(item.node, '@_label')}`;
  return /(^|[^a-z])(bg|background|openbg|overlay|scrim|mask|shadow|gradient)([^a-z]|$)/i.test(text);
}

function findNearestActionable(leaf: DescribedNode, byNode: Map<XmlNode, DescribedNode>, parents: Map<XmlNode, XmlNode | null>, screenArea: number): DescribedNode | undefined {
  let rawParent = parents.get(leaf.node) ?? null;
  while (rawParent) {
    const ancestor = byNode.get(rawParent);
    if (ancestor) {
      const usable = Boolean(ancestor.directLabel || ancestor.descendantLabel || ancestor.locator);
      const maxArea = Math.min(screenArea * 0.6, Math.max(leaf.area * 12, screenArea * 0.25));
      if (ancestor.visible && !ancestor.ignored && ancestor.actionable && usable && ancestor.area <= maxArea) return ancestor;
    }
    rawParent = parents.get(rawParent) ?? null;
  }
  return undefined;
}

function buildTarget(selected: DescribedNode, platform: Platform, tree: DescribedNode[], width: number, height: number, coordinate: Target['coordinate'], tapNode?: DescribedNode): Target {
  const tapped = tapNode && tapNode.node !== selected.node && !isWeakLeaf(tapNode) ? tapNode : undefined;
  const semanticLabel = tapped?.directLabel ?? selected.directLabel ?? selected.descendantLabel;
  const raw = tapped?.directLabel
    ? [
      ...generateRawCandidates(tapped, tapped.directLabel, platform, tree, tapped),
      ...generateRawCandidates(selected, null, platform, tree, tapNode),
    ]
    : generateRawCandidates(selected, semanticLabel, platform, tree, tapNode);
  const candidates = rankCandidates(raw);
  const primary = pickPrimary(candidates);
  const resourceId = String(selected.node['@_resource-id'] ?? '');
  const fallbackLabel = resourceId ? readableResourceId(resourceId) : primary ? readableLocatorName(primary.locator) : '';
  const warning = !primary
    ? '未找到可用定位器，已记录相对坐标'
    : isOccurrenceLocator(primary.locator) && !isScopedLocator(primary.locator)
      ? '控件在页面中重复，主定位依赖序号；页面顺序变化时可能点错或回放失败'
      : undefined;
  return {
    locator: primary?.locator ?? selected.locator,
    label: semanticLabel?.value || fallbackLabel || '坐标目标',
    bounds: selected.rect,
    coordinate,
    candidates,
    verifiedAt: Date.now(),
    warning,
  };
}

function coordinateTarget(x: number, y: number, width: number, height: number): Target {
  return {
    label: '坐标目标',
    coordinate: { xRatio: clamp(x / width), yRatio: clamp(y / height) },
    warning: '点击位置没有可用控件，已记录相对坐标；回放需开启坐标兜底',
  };
}

function generateRawCandidates(selected: DescribedNode, semanticLabel: SemanticLabel | null, platform: Platform, tree: DescribedNode[], tapNode?: DescribedNode): RawCandidate[] {
  const raw: RawCandidate[] = [];
  const add = (locator: Locator, source: RawCandidate['source'], baseScore: number, matches: number, note?: string, indexed = false) => {
    if (matches <= 0) return;
    raw.push({ locator, source, baseScore, matches, note, indexed });
  };

  if (platform === 'android') {
    const desc = attr(selected.node, '@_content-desc');
    const text = attr(selected.node, '@_text');
    const resourceId = attr(selected.node, '@_resource-id');
    if (desc) {
      const matches = countAttr(tree, '@_content-desc', desc);
      add({ strategy: 'accessibility id', value: desc }, 'attribute', 100, matches);
      add({ strategy: '-android uiautomator', value: `new UiSelector().description(${javaString(desc)})` }, 'semantic', 72, matches);
      if (matches > 1) {
        const index = occurrenceIndex(tree, selected.node, (node) => attr(node, '@_content-desc') === desc);
        add({ strategy: '-android uiautomator', value: `new UiSelector().description(${javaString(desc)}).instance(${index - 1})` }, 'semantic', 72, 1, `依赖序号（共 ${matches} 个）`, true);
      }
    }
    if (text) {
      const matches = countAttr(tree, '@_text', text);
      add({ strategy: '-android uiautomator', value: `new UiSelector().text(${javaString(text)})` }, 'semantic', 70, matches);
      add({ strategy: 'xpath', value: `//*[@text=${xpathLiteral(text)}]` }, 'xpath', 50, matches);
      if (matches > 1) {
        const index = occurrenceIndex(tree, selected.node, (node) => attr(node, '@_text') === text);
        add({ strategy: '-android uiautomator', value: `new UiSelector().text(${javaString(text)}).instance(${index - 1})` }, 'semantic', 70, 1, `依赖序号（共 ${matches} 个）`, true);
        add({ strategy: 'xpath', value: `(//*[@text=${xpathLiteral(text)}])[${index}]` }, 'xpath', 50, 1, `依赖序号（共 ${matches} 个）`, true);
      }
    }
    if (desc) {
      add({ strategy: 'xpath', value: `//*[@content-desc=${xpathLiteral(desc)}]` }, 'xpath', 58, countAttr(tree, '@_content-desc', desc));
    }
    if (resourceId) {
      const matches = countAttr(tree, '@_resource-id', resourceId);
      add({ strategy: 'id', value: resourceId }, 'resource-id', 95, matches);
      add({ strategy: '-android uiautomator', value: `new UiSelector().resourceId(${javaString(resourceId)})` }, 'resource-id', 88, matches);
      add({ strategy: 'xpath', value: `//*[@resource-id=${xpathLiteral(resourceId)}]` }, 'xpath', 52, matches);
      if (matches > 1) {
        const index = occurrenceIndex(tree, selected.node, (node) => attr(node, '@_resource-id') === resourceId);
        const note = `依赖序号（共 ${matches} 个）`;
        add({ strategy: '-android uiautomator', value: `new UiSelector().resourceId(${javaString(resourceId)}).instance(${index - 1})` }, 'resource-id', 88, 1, note, true);
        add({ strategy: 'xpath', value: `(//*[@resource-id=${xpathLiteral(resourceId)}])[${index}]` }, 'xpath', 52, 1, note, true);
      }
    }
    if (raw.length === 0 && semanticLabel) {
      add(androidSemanticLocator(semanticLabel), 'semantic', 68, countSemantic(tree, semanticLabel));
    }
  } else {
    const name = attr(selected.node, '@_name');
    const label = attr(selected.node, '@_label');
    const type = attr(selected.node, '@_type');
    const nameMatches = name ? countAttr(tree, '@_name', name) : 0;
    const labelOnlyMatches = label ? tree.filter((item) => !attr(item.node, '@_name') && attr(item.node, '@_label') === label).length : 0;
    // WDA 的 accessibility id 先匹配 identifier(name)，只有没有 name 时才回退到 label。
    const accessibilityMatches = name ? nameMatches : labelOnlyMatches;
    if (accessibilityMatches > 0) {
      add(
        { strategy: 'accessibility id', value: name || label },
        'attribute',
        name ? 100 : 62,
        accessibilityMatches,
        name ? undefined : '无 name，按未命名元素的 label 匹配',
      );
    }
    if (name) {
      add({ strategy: 'xpath', value: `//*[@name=${xpathLiteral(name)}]` }, 'xpath', 55, nameMatches);
      add({ strategy: '-ios predicate string', value: `name == ${predicateLiteral(name)}` }, 'semantic', 92, nameMatches);
      if (type) {
        add({ strategy: '-ios predicate string', value: `type == ${predicateLiteral(type)} AND name == ${predicateLiteral(name)}` }, 'semantic', 90, nameMatches);
        add({ strategy: '-ios class chain', value: `**/${type}[\`name == ${classChainLiteral(name)}\`]` }, 'semantic', 88, nameMatches);
      }
    }
    if (label) {
      const labelMatches = countAttr(tree, '@_label', label);
      add({ strategy: '-ios predicate string', value: `label == ${predicateLiteral(label)}` }, 'semantic', 75, labelMatches);
      add({ strategy: 'xpath', value: `//*[@label=${xpathLiteral(label)}]` }, 'xpath', 48, labelMatches);
      if (type) {
        const typedMatches = tree.filter((item) => attr(item.node, '@_type') === type && attr(item.node, '@_label') === label).length;
        add({ strategy: 'xpath', value: iosXpath(type, label) }, 'xpath', 50, typedMatches);
        add({ strategy: '-ios predicate string', value: `type == ${predicateLiteral(type)} AND label == ${predicateLiteral(label)}` }, 'semantic', 85, typedMatches);
        add({ strategy: '-ios class chain', value: `**/${type}[\`label == ${classChainLiteral(label)}\`]` }, 'semantic', 80, typedMatches);
        if (name) {
          const nameLabelMatches = tree.filter((item) => attr(item.node, '@_name') === name && attr(item.node, '@_label') === label).length;
          add({ strategy: '-ios predicate string', value: `name == ${predicateLiteral(name)} AND label == ${predicateLiteral(label)}` }, 'semantic', 84, nameLabelMatches);
        }
        if (typedMatches > 1) {
          const index = occurrenceIndex(tree, selected.node, (node) => attr(node, '@_type') === type && attr(node, '@_label') === label);
          add({ strategy: '-ios class chain', value: `**/${type}[\`label == ${classChainLiteral(label)}\`][${index}]` }, 'semantic', 80, 1, `依赖序号（共 ${typedMatches} 个）`, true);
          add({ strategy: 'xpath', value: `(${iosXpath(type, label)})[${index}]` }, 'xpath', 50, 1, `依赖序号（共 ${typedMatches} 个）`, true);
        }
      } else if (labelMatches > 1) {
        const index = occurrenceIndex(tree, selected.node, (node) => attr(node, '@_label') === label);
        add({ strategy: 'xpath', value: `(//*[@label=${xpathLiteral(label)}])[${index}]` }, 'xpath', 48, 1, `依赖序号（共 ${labelMatches} 个）`, true);
      }
    }
    if (raw.length === 0 && semanticLabel) {
      if (semanticLabel.attribute === 'name') {
        const matches = countAttr(tree, '@_name', semanticLabel.value);
        add({ strategy: 'accessibility id', value: semanticLabel.value }, 'attribute', 100, matches);
        add({ strategy: '-ios predicate string', value: `name == ${predicateLiteral(semanticLabel.value)}` }, 'semantic', 90, matches);
      } else {
        add({ strategy: '-ios predicate string', value: `label == ${predicateLiteral(semanticLabel.value)}` }, 'semantic', 70, countSemantic(tree, semanticLabel));
      }
    }
  }

  const classAttribute = platform === 'android' ? '@_class' : '@_type';
  const className = attr(selected.node, classAttribute);
  if (className) {
    const sameClass = tree.filter((item) => attr(item.node, classAttribute) === className);
    const index = sameClass.findIndex((item) => item.node === selected.node) + 1;
    if (index > 0) {
      const note = `依赖类名序号（共 ${sameClass.length} 个）`;
      if (platform === 'android') {
        add({ strategy: '-android uiautomator', value: `new UiSelector().className(${javaString(className)}).instance(${index - 1})` }, 'semantic', 42, 1, note, true);
      } else {
        add({ strategy: '-ios class chain', value: `**/${className}[${index}]` }, 'semantic', 42, 1, note, true);
      }
      const parentPath = classPathXPath(selected, tree, classAttribute);
      if (parentPath) {
        add({ strategy: 'xpath', value: parentPath.value }, 'xpath', 58, parentPath.baseMatches, '依赖祖先容器与类名路径', true);
      } else {
        add({ strategy: 'xpath', value: `(//${className})[${index}]` }, 'xpath', 45, 1, note, true);
      }
    }
  }

  // 补一个按边界定位的候选：点中的最小节点与选中节点不一致时优先使用它，避免只能点到父容器。
  const boundsNode = tapNode ?? selected;
  const preciseLeaf = Boolean(tapNode && tapNode.node !== selected.node);
  if (platform === 'android') {
    const bounds = boundsText(boundsNode.rect);
    const boundsMatches = tree.filter((item) => boundsText(item.rect) === bounds).length;
    add({ strategy: 'xpath', value: `//*[@bounds=${xpathLiteral(bounds)}]` }, 'xpath', preciseLeaf ? 70 : 45, boundsMatches, '依赖控件边界，布局变化会失效', true);
  } else {
    const rect = boundsNode.rect;
    const matches = tree.filter((item) => item.rect.x === rect.x && item.rect.y === rect.y && item.rect.width === rect.width && item.rect.height === rect.height).length;
    add({ strategy: 'xpath', value: `//*[@x=${xpathLiteral(String(rect.x))}][@y=${xpathLiteral(String(rect.y))}][@width=${xpathLiteral(String(rect.width))}][@height=${xpathLiteral(String(rect.height))}]` }, 'xpath', preciseLeaf ? 66 : 42, matches, '依赖控件位置和尺寸，布局变化会失效', true);
  }

  return raw;
}

function boundsText(rect: Rect): string {
  return `[${rect.x},${rect.y}][${rect.x + rect.width},${rect.y + rect.height}]`;
}

function classPathXPath(selected: DescribedNode, tree: DescribedNode[], classAttribute: string): { value: string; baseMatches: number } | null {
  const platform: Platform = classAttribute === '@_class' ? 'android' : 'ios';
  const segments: string[] = [];
  let current: DescribedNode | undefined = selected;
  while (current && current.parent) {
    const className = attr(current.node, classAttribute);
    if (!className) return null;
    const parentNode: XmlNode = current.parent;
    const siblings = tree.filter((item) => item.parent === parentNode && attr(item.node, classAttribute) === className);
    const index = siblings.findIndex((item) => item.node === current!.node) + 1;
    if (index <= 0) return null;
    segments.unshift(`${className}[${index}]`);
    const base = elementSelector(parentNode, platform);
    if (base) {
      const baseAttribute = platform === 'android'
        ? base.includes('@resource-id') ? '@_resource-id' : '@_content-desc'
        : base.includes('@name') ? '@_name' : '@_label';
      const baseValue = attr(parentNode, baseAttribute);
      const baseMatches = tree.filter((item) => attr(item.node, baseAttribute) === baseValue).length;
      return { value: `${base}/${segments.join('/')}`, baseMatches };
    }
    current = tree.find((item) => item.node === parentNode);
  }
  return null;
}

function elementSelector(node: XmlNode, platform: Platform): string {
  if (platform === 'android') {
    const resourceId = attr(node, '@_resource-id');
    if (resourceId) return `//*[@resource-id=${xpathLiteral(resourceId)}]`;
    const desc = attr(node, '@_content-desc');
    if (desc) return `//*[@content-desc=${xpathLiteral(desc)}]`;
  } else {
    const name = attr(node, '@_name');
    if (name) return `//*[@name=${xpathLiteral(name)}]`;
    const label = attr(node, '@_label');
    if (label) return `//*[@label=${xpathLiteral(label)}]`;
  }
  return '';
}

function rankCandidates(raw: RawCandidate[]): LocatorCandidate[] {
  const ranked: LocatorCandidate[] = raw.map((item) => {
    const indexed = Boolean(item.indexed);
    const unique = item.matches === 1;
    let note = item.note;
    let score = item.baseScore;
    if (item.matches > 1) score -= 50;
    if (indexed) score -= 35;
    if (item.locator.value.length > 40) {
      score -= 5;
      note ??= '值较长，可能随内容变化';
    }
    if (!note && item.matches > 1) note = `匹配 ${item.matches} 个`;
    return {
      locator: item.locator,
      matches: item.matches,
      unique,
      score: Math.max(0, Math.min(100, score)),
      role: indexed || !unique ? 'brittle' : 'alternative',
      note,
      source: item.source,
    };
  });

  const best = new Map<string, LocatorCandidate>();
  for (const candidate of ranked) {
    const key = locatorKey(candidate.locator);
    const existing = best.get(key);
    if (!existing || existing.score < candidate.score) best.set(key, candidate);
  }
  const list = [...best.values()].sort(byScore);
  const recommended = list.find((candidate) => candidate.unique && candidate.role !== 'brittle');
  if (recommended) recommended.role = 'recommended';
  return sortCandidates(list);
}

function sortCandidates(candidates: LocatorCandidate[]): LocatorCandidate[] {
  const order = { recommended: 0, alternative: 1, brittle: 2 };
  return [...candidates].sort((a, b) => order[a.role] - order[b.role] || byScore(a, b));
}

function byScore(a: LocatorCandidate, b: LocatorCandidate): number {
  return b.score - a.score || a.locator.value.localeCompare(b.locator.value);
}

function scoreFor(locator: Locator, matches: number, indexed: boolean): number {
  const base = baseScore(locator);
  return Math.max(0, Math.min(100, base - (matches > 1 ? 50 : 0) - (indexed ? 35 : 0)));
}

function baseScore(locator: Locator): number {
  if (locator.strategy === 'accessibility id') return 100;
  if (locator.strategy === 'id') return 95;
  if (locator.strategy === '-ios class chain') return 80;
  if (locator.strategy === '-android uiautomator') return 72;
  if (locator.strategy === '-ios predicate string') return locator.value.includes('type ==') ? 85 : 75;
  return 50;
}

function makeLocator(node: XmlNode, platform: Platform): Locator | undefined {
  const accessibility = attr(node, platform === 'android' ? '@_content-desc' : '@_name');
  if (accessibility) return { strategy: 'accessibility id', value: accessibility };
  const id = attr(node, '@_resource-id');
  if (id) return { strategy: 'id', value: id };
  if (platform === 'ios') {
    const label = attr(node, '@_label');
    const type = attr(node, '@_type');
    if (label) {
      return type
        ? { strategy: '-ios predicate string', value: `type == ${predicateLiteral(type)} AND label == ${predicateLiteral(label)}` }
        : { strategy: '-ios predicate string', value: `label == ${predicateLiteral(label)}` };
    }
  }
  return undefined;
}

function androidSemanticLocator(label: SemanticLabel): Locator {
  if (label.attribute === 'content-desc') return { strategy: '-android uiautomator', value: `new UiSelector().description(${javaString(label.value)})` };
  return { strategy: '-android uiautomator', value: `new UiSelector().text(${javaString(label.value)})` };
}

function countSemantic(tree: DescribedNode[], label: SemanticLabel): number {
  return tree.filter((item) => {
    const direct = directNodeLabel(item.node);
    return direct?.attribute === label.attribute && direct.value === label.value;
  }).length;
}

function iosXpath(type: string, label: string): string {
  return type ? `//${type}[@label=${xpathLiteral(label)}]` : `//*[@label=${xpathLiteral(label)}]`;
}

function countAttr(tree: DescribedNode[], attribute: string, value: string): number {
  return tree.filter((item) => attr(item.node, attribute) === value).length;
}

function occurrenceIndex(tree: DescribedNode[], node: XmlNode, predicate: (node: XmlNode) => boolean): number {
  const matches = tree.filter((item) => predicate(item.node));
  const index = matches.findIndex((item) => item.node === node);
  return index >= 0 ? index + 1 : 1;
}

function attr(node: XmlNode, name: string): string {
  return String(node[name] ?? '');
}

function readableLocatorName(locator: Locator): string {
  const segments = locator.value.split(/[/:]/).filter(Boolean);
  return segments.at(-1) ?? locator.value;
}

function readableResourceId(resourceId: string): string {
  const marker = ':id/';
  const markerIndex = resourceId.lastIndexOf(marker);
  return markerIndex >= 0 ? resourceId.slice(markerIndex + marker.length) : resourceId.split('/').at(-1) ?? resourceId;
}

export function javaString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function predicateLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function classChainLiteral(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replaceAll("'", "',\"'\",'")}')`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}
