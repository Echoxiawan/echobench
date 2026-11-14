import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTarget, applyLiveMatches, fallbackLocators, focusedTarget, isOccurrenceLocator, isScopedLocator } from '../electron/locator.js';
import type { Target } from '../src/types.js';

const androidXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]">
    <node index="0" class="android.widget.Button" text="登录" resource-id="com.demo:id/login" content-desc="登录按钮" clickable="true" bounds="[100,1600][980,1750]" />
    <node index="1" class="android.widget.TextView" text="重复项" bounds="[100,200][500,280]" />
    <node index="2" class="android.widget.TextView" text="重复项" bounds="[100,300][500,380]" />
  </node>
</hierarchy>`;

const iosXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <node type="XCUIElementTypeButton" name="login" label="登录" x="100" y="600" width="200" height="60" />
  <node type="XCUIElementTypeButton" name="login2" label="登录" x="100" y="700" width="200" height="60" />
  <node type="XCUIElementTypeTextField" name="username" label="用户名" value="" x="100" y="900" width="600" height="60" />
</hierarchy>`;

test('点击无属性图标时优先使用图标本身而不是父容器', () => {
  const xml = `<hierarchy>
    <node class="android.widget.FrameLayout" clickable="true" resource-id="com.app:id/main_mcv" bounds="[0,100][1080,300]">
      <node class="android.widget.ImageView" bounds="[900,150][1020,270]" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 960, 210, 'android', 1080, 1920);
  assert.equal(target.label !== 'main_mcv', true);
  assert.equal(target.locator?.strategy, 'xpath');
  assert.match(target.locator?.value ?? '', /android\.widget\.ImageView/);
  assert.match(target.locator?.value ?? '', /main_mcv/);
  assert.ok(target.candidates?.some((candidate) => candidate.locator.value.includes('android.widget.ImageView')));
  assert.equal(target.candidates?.some((candidate) => candidate.role === 'recommended'), false);
});

test('自定义子视图无类名属性时补充边界定位候选', () => {
  const xml = `<hierarchy>
    <node class="android.widget.FrameLayout" clickable="true" resource-id="com.app:id/main_mcv" bounds="[0,100][1080,300]">
      <node class="android.view.View" bounds="[900,150][1020,270]" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 960, 210, 'android', 1080, 1920);
  assert.ok(target.candidates?.some((candidate) => candidate.locator.value.includes('@bounds') && candidate.locator.value.includes('[900,150][1020,270]')));
});

test('大面积不可点击容器返回坐标目标而不是容器 id', () => {
  const xml = `<hierarchy>
    <node class="android.widget.FrameLayout" resource-id="com.app:id/frameContent" bounds="[0,0][1080,1920]" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 900, 1500, 'android', 1080, 1920);
  assert.equal(target.locator, undefined);
  assert.equal(target.label, '坐标目标');
  assert.deepEqual(target.coordinate, { xRatio: 0.833333, yRatio: 0.78125 });
});

test('整屏可点击容器没有被点击中语义节点时也返回坐标目标', () => {
  const xml = `<hierarchy>
    <node class="androidx.cardview.widget.CardView" clickable="true" resource-id="com.app:id/main_mcv" bounds="[0,0][1080,1920]" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 900, 1500, 'android', 1080, 1920);
  assert.equal(target.locator, undefined);
  assert.equal(target.label, '坐标目标');
});

test('Android 唯一定位器推荐 accessibility id 并标注来源', () => {
  const target = analyzeTarget(androidXml, 500, 1675, 'android', 1080, 1920);
  assert.equal(target.label, '登录');
  assert.equal(target.locator?.strategy, 'accessibility id');
  assert.equal(target.locator?.value, '登录按钮');
  const recommended = target.candidates?.find((candidate) => candidate.role === 'recommended');
  assert.equal(recommended?.matches, 1);
  assert.ok(target.candidates?.some((candidate) => candidate.locator.strategy === 'id' && candidate.unique));
  assert.ok(target.candidates?.some((candidate) => candidate.locator.strategy === 'xpath'));
  assert.equal(target.verifiedAt !== undefined, true);
});

test('Android 重复文本生成脆弱候选且不会推荐', () => {
  const target = analyzeTarget(androidXml, 300, 240, 'android', 1080, 1920);
  const labelCandidates = target.candidates?.filter((candidate) => candidate.locator.strategy === '-android uiautomator');
  assert.ok(labelCandidates?.some((candidate) => candidate.matches === 2 && candidate.role === 'brittle'));
  assert.ok(labelCandidates?.some((candidate) => isOccurrenceLocator(candidate.locator) && candidate.role === 'brittle'));
  assert.equal(target.candidates?.some((candidate) => candidate.role === 'recommended'), false);
  const fallbacks = fallbackLocators(target);
  assert.ok(fallbacks.length >= 1);
  assert.ok(fallbacks.every((locator) => isOccurrenceLocator(locator)), '重复文本只使用唯一序号候选兜底');
});

test('重复 resource-id 图标优先使用唯一序号定位器', () => {
  const xml = `<hierarchy>
    <node class="android.widget.ImageView" resource-id="com.app:id/icon_iv" clickable="true" bounds="[60,144][132,216]" />
    <node class="android.widget.ImageView" resource-id="com.app:id/icon_iv" clickable="true" bounds="[1308,144][1380,216]" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 1344, 180, 'android', 1440, 2560);
  assert.equal(target.locator?.strategy, '-android uiautomator');
  assert.match(target.locator?.value ?? '', /resourceId\("com\.app:id\/icon_iv"\)\.instance\(1\)/);
  const idCandidate = target.candidates?.find((candidate) => candidate.locator.strategy === 'id');
  assert.equal(idCandidate?.matches, 2);
  const fallbacks = fallbackLocators(target);
  assert.equal(fallbacks[0].value, target.locator?.value);
  assert.ok(fallbacks.some((locator) => isOccurrenceLocator(locator)));
});

test('iOS 生成 predicate、class chain 与 XPath 候选', () => {
  const target = analyzeTarget(iosXml, 150, 620, 'ios', 750, 1334);
  assert.equal(target.locator?.strategy, 'accessibility id');
  assert.equal(target.locator?.value, 'login');
  assert.ok(target.candidates?.some((candidate) => candidate.locator.strategy === '-ios class chain' && candidate.locator.value.includes('XCUIElementTypeButton')));
  assert.ok(target.candidates?.some((candidate) => candidate.locator.strategy === '-ios predicate string' && candidate.locator.value.includes('type ==')));
});

test('iOS accessibility id 只按 name 计数，不会把其他元素的 label 算进来', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeButton" name="login" label="登录" x="100" y="600" width="200" height="60" />
    <node type="XCUIElementTypeStaticText" name="other" label="login" x="100" y="100" width="200" height="60" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 150, 620, 'ios', 750, 1334);
  const accessibility = target.candidates?.find((candidate) => candidate.locator.strategy === 'accessibility id');
  assert.equal(accessibility?.matches, 1);
  assert.equal(accessibility?.role, 'recommended');
});

test('iOS 无 name 时 accessibility id 只统计同样没有 name 的 label 元素', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeButton" label="登录" x="100" y="600" width="200" height="60" />
    <node type="XCUIElementTypeStaticText" name="title" label="登录" x="100" y="100" width="200" height="60" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 150, 620, 'ios', 750, 1334);
  const accessibility = target.candidates?.find((candidate) => candidate.locator.strategy === 'accessibility id');
  assert.equal(accessibility?.matches, 1);
  const labelPredicate = target.candidates?.find((candidate) => candidate.locator.strategy === '-ios predicate string' && candidate.locator.value.startsWith('label =='));
  assert.equal(labelPredicate?.matches, 2);
});

test('iOS 标签引号正确转义', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeButton" name="bob" label="Bob's" x="10" y="10" width="100" height="40" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 50, 30, 'ios', 750, 1334);
  const predicate = target.candidates?.find((candidate) => candidate.locator.strategy === '-ios predicate string' && candidate.locator.value.startsWith('label =='));
  assert.ok(predicate?.locator.value.includes("Bob\\'s"));
  const classChain = target.candidates?.find((candidate) => candidate.locator.strategy === '-ios class chain' && candidate.locator.value.includes('label =='));
  assert.ok(classChain?.locator.value.includes('Bob\'s'));
});

test('iOS 点击卡片背景图时选择最近的可点击 Cell', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeCell" name="market:stock:saudi" label="沙特阿拉伯市场" x="20" y="300" width="710" height="260">
      <node type="XCUIElementTypeImage" name="img_saudi_openbg" x="20" y="300" width="710" height="260" />
      <node type="XCUIElementTypeStaticText" name="title" label="沙特阿拉伯市场" x="40" y="330" width="300" height="40" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 400, 500, 'ios', 750, 1334);
  assert.equal(target.locator?.strategy, 'accessibility id');
  assert.equal(target.locator?.value, 'market:stock:saudi');
  assert.notEqual(target.locator?.value, 'img_saudi_openbg');
});

test('iOS 滚动条指示器不会被当成点击目标', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeOther" name="content" x="0" y="0" width="750" height="1334">
      <node type="XCUIElementTypeCell" name="market:stock:saudi" label="沙特阿拉伯市场" x="20" y="300" width="710" height="260" />
      <node type="XCUIElementTypeOther" label="شريط تمرير رأسي, ‏4 صفحات" x="700" y="200" width="5" height="600" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 702, 500, 'ios', 750, 1334);
  assert.equal(target.locator?.strategy, 'accessibility id');
  assert.equal(target.locator?.value, 'market:stock:saudi');
  assert.doesNotMatch(target.label ?? '', /شريط/);
});

test('iOS 图标位于不可点击容器时仍保留图标本身', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeOther" name="main_mcv" x="20" y="60" width="710" height="100">
      <node type="XCUIElementTypeImage" name="icon_search" x="650" y="75" width="50" height="50" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 675, 100, 'ios', 750, 1334);
  assert.equal(target.locator?.strategy, 'accessibility id');
  assert.equal(target.locator?.value, 'icon_search');
});

test('实时校验会淘汰匹配多个或落在目标范围外的候选', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeCell" name="card" label="卡片" x="20" y="300" width="710" height="260">
      <node type="XCUIElementTypeStaticText" name="title" label="卡片标题" x="40" y="330" width="300" height="40" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 400, 500, 'ios', 750, 1334);
  assert.equal(target.locator?.value, 'card');
  const labelPredicate = target.candidates?.find((candidate) => candidate.locator.strategy === '-ios predicate string' && candidate.locator.value === "label == '卡片'");
  assert.ok(labelPredicate);
  const verified = applyLiveMatches(target, [
    { locator: target.locator!, matches: 2 },
    { locator: labelPredicate!.locator, matches: 1, bounds: { x: 20, y: 300, width: 710, height: 260 } },
    { locator: { strategy: '-ios predicate string', value: "type == 'XCUIElementTypeCell' AND label == '卡片'" }, matches: 1, bounds: { x: 500, y: 900, width: 100, height: 40 } },
  ]);
  assert.equal(verified.locator?.value, "label == '卡片'");
  assert.equal(verified.candidates?.find((candidate) => candidate.locator.value === "label == '卡片'")?.verified, true);
  assert.equal(verified.candidates?.find((candidate) => candidate.locator.value === 'card')?.role, 'brittle');
  assert.equal(verified.warning, undefined);
});

test('iOS 点击大 Cell 里的标题时保留标题本身，不升级到整行或角标', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeCell" x="0" y="196" width="375" height="98">
      <node type="XCUIElementTypeImage" name="HSARSearchKit.SearchAggregateResultViewController:icon_search_hot_rank_1_en" x="51" y="259" width="50" height="24" />
      <node type="XCUIElementTypeStaticText" name="HSARSearchKit.SearchAggregateResultViewController:SAUDI ARAMCO" label="SAUDI ARAMCO" x="51" y="208" width="130" height="20" />
    </node>
  </hierarchy>`;
  const target = analyzeTarget(xml, 115, 218, 'ios', 375, 812);
  assert.equal(target.locator?.value, 'HSARSearchKit.SearchAggregateResultViewController:SAUDI ARAMCO');
  assert.equal(target.label, 'SAUDI ARAMCO');
  assert.doesNotMatch(target.locator?.value ?? '', /hot_rank/);
});

test('iOS 不会把重叠的兄弟按钮当成点击目标', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeOther" name="Quotes" x="0" y="156" width="375" height="40">
      <node type="XCUIElementTypeButton" x="0" y="164" width="375" height="32" />
      <node type="XCUIElementTypeImage" name="icon_btn_next" x="338" y="171" width="18" height="18" />
    </node>
    <node type="XCUIElementTypeImage" name="icon_btn_next" x="338" y="445" width="18" height="18" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 347, 180, 'ios', 375, 812);
  assert.equal(target.locator?.strategy, 'xpath');
  assert.match(target.locator?.value ?? '', /XCUIElementTypeImage\[1\]$/);
  assert.doesNotMatch(target.locator?.value ?? '', /XCUIElementTypeButton\[1\]$/);
});

test('带语义祖先的 XPath 可以被实时校验提升为主定位', () => {
  const raw = { strategy: '-ios class chain' as const, value: '**/XCUIElementTypeStaticText[`label == "Quotes"`][3]' };
  const scoped = { strategy: 'xpath' as const, value: "//*[@name='Quotes']/XCUIElementTypeStaticText[1]" };
  assert.equal(isOccurrenceLocator(raw), true);
  assert.equal(isScopedLocator(scoped), true);
  const target: Target = {
    locator: raw,
    label: 'Quotes',
    bounds: { x: 20, y: 171, width: 52, height: 18 },
    candidates: [
      { locator: raw, matches: 1, unique: true, score: 45, role: 'brittle', source: 'semantic' },
      { locator: scoped, matches: 1, unique: true, score: 23, role: 'brittle', source: 'xpath' },
    ],
  };
  const verified = applyLiveMatches(target, [
    { locator: raw, matches: 1, bounds: { x: 20, y: 171, width: 52, height: 18 } },
    { locator: scoped, matches: 1, bounds: { x: 20, y: 171, width: 52, height: 18 } },
  ]);
  assert.deepEqual(verified.locator, scoped);
  assert.equal(verified.candidates?.find((candidate) => candidate.locator.value === scoped.value)?.role, 'recommended');
  assert.equal(verified.warning, undefined);
});

test('实时校验读取范围失败时不会把候选标成可靠', () => {
  const xml = `<hierarchy>
    <node type="XCUIElementTypeButton" name="login" label="登录" x="100" y="600" width="200" height="60" />
  </hierarchy>`;
  const target = analyzeTarget(xml, 150, 620, 'ios', 750, 1334);
  const verified = applyLiveMatches(target, [{ locator: target.locator!, matches: 1, error: '读取元素范围失败' }]);
  assert.equal(verified.candidates?.find((candidate) => candidate.locator.value === 'login')?.verified, false);
  assert.match(verified.warning ?? '', /无法唯一定位/);
});

test('焦点输入框返回目标与候选', () => {
  const xml = `<hierarchy>
    <node class="android.widget.EditText" resource-id="com.demo:id/username" text="" focused="true" clickable="true" bounds="[50,800][1000,900]" />
  </hierarchy>`;
  const target = focusedTarget(xml, 'android', 1080, 1920);
  assert.equal(target?.locator?.strategy, 'id');
  assert.ok(target?.candidates?.length);
});
