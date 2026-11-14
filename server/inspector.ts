import { childEntries, nodeRect, parseTree, type XmlNode } from '../electron/locator.js';
import type { ElementNode, ElementTreeResponse, Platform } from '../src/types.js';

const MAX_NODES = 4000;
const MAX_ATTRIBUTE_LENGTH = 2000;

export function flattenElementTree(xml: string, platform: Platform, width: number, height: number): ElementTreeResponse {
  const root = parseTree(xml);
  const nodes: ElementNode[] = [];
  let truncated = false;

  const walk = (node: XmlNode, path: number[], depth: number, parentId: string, key: string) => {
    if (nodes.length >= MAX_NODES) { truncated = true; return; }
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(node)) {
      if (!name.startsWith('@_')) continue;
      attributes[name.slice(2)] = String(value ?? '').slice(0, MAX_ATTRIBUTE_LENGTH);
    }
    const children = childEntries(node);
    const id = path.length ? path.join('.') : 'root';
    nodes.push({
      id,
      parentId,
      path,
      depth,
      type: attributes.type || attributes.class || key,
      name: attributes.name || '',
      label: attributes.label || '',
      text: attributes.text || '',
      value: attributes.value || '',
      resourceId: attributes['resource-id'] || '',
      bounds: nodeRect(node) ?? undefined,
      attributes,
      children: children.length,
    });
    children.forEach((child, index) => walk(child.node, [...path, index], depth + 1, id, child.key));
  };

  walk(root, [], 0, '', 'root');
  return { platform, width, height, nodes, truncated };
}
