import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenElementTree } from '../server/inspector.js';
import { analyzeElement, nodeAtPath, parseTree } from '../electron/locator.js';

const xml = `<hierarchy>
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,1920]">
    <node class="android.widget.Button" text="登录" resource-id="com.demo:id/login" clickable="true" bounds="[100,1600][980,1750]" />
  </node>
</hierarchy>`;

test('元素树按层级和路径展开', () => {
  const tree = flattenElementTree(xml, 'android', 1080, 1920);
  const button = tree.nodes.find((node) => node.resourceId === 'com.demo:id/login');
  assert.ok(button);
  assert.equal(button?.type, 'android.widget.Button');
  assert.equal(button?.label, '');
  assert.equal(button?.text, '登录');
  assert.deepEqual(button?.bounds, { x: 100, y: 1600, width: 880, height: 150 });
  assert.ok(button!.depth >= 3);
  const node = nodeAtPath(parseTree(xml), button!.path);
  assert.equal(String(node?.['@_resource-id']), 'com.demo:id/login');
});

test('按元素路径精确生成候选定位器', () => {
  const tree = flattenElementTree(xml, 'android', 1080, 1920);
  const button = tree.nodes.find((node) => node.resourceId === 'com.demo:id/login');
  assert.ok(button);
  const target = analyzeElement(xml, button!.path, 'android', 1080, 1920);
  assert.equal(target.label, '登录');
  assert.ok(target.locator);
  assert.ok(target.candidates?.some((candidate) => candidate.locator.strategy === 'id' && candidate.locator.value === 'com.demo:id/login'));
  assert.deepEqual(target.bounds, { x: 100, y: 1600, width: 880, height: 150 });
});

test('节点路径不存在或没有边界时明确报错', () => {
  assert.throws(() => analyzeElement(xml, [99], 'android', 1080, 1920), /元素节点不存在/);
  const noBounds = `<hierarchy><node class="android.view.View" /></hierarchy>`;
  const tree = flattenElementTree(noBounds, 'android', 1080, 1920);
  const node = tree.nodes.at(-1);
  assert.ok(node);
  assert.throws(() => analyzeElement(noBounds, node!.path, 'android', 1080, 1920), /没有边界/);
});
