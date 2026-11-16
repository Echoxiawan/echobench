import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasEnglishTranslation, normalizeLocale, translate } from '../src/messages.js';

test('语言代码识别与插值', () => {
  assert.equal(normalizeLocale('zh-TW'), 'zh-CN');
  assert.equal(normalizeLocale('en_GB'), 'en-US');
  assert.equal(normalizeLocale('fr-FR'), null);
  assert.equal(translate('en-US', '{count} 台在线', { count: 3 }), '3 online');
});

test('界面静态文案都有英文翻译', async () => {
  const files = [
    new URL('../src/App.tsx', import.meta.url),
    new URL('../src/connection-diagnostic.ts', import.meta.url),
    new URL('../desktop/main.ts', import.meta.url),
  ];
  const missing = new Set<string>();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\b(?:t|tr)\('((?:\\.|[^'])+)'/g)) {
      const key = match[1].replaceAll("\\'", "'").replaceAll('\\\\', '\\');
      if (!hasEnglishTranslation(key)) missing.add(key);
    }
  }
  assert.deepEqual([...missing], []);
});
