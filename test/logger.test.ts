import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Logger } from '../server/logger.js';

test('日志按大小轮转且限制备份数量', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-step-logger-'));
  try {
    const file = join(dir, 'test.log');
    const logger = new Logger(file, { maxBytes: 600, maxEntries: 3, maxLineLength: 80, maxBackups: 1 });
    for (let index = 0; index < 20; index++) logger.info('test', `line-${index}-${'x'.repeat(120)}`);
    assert.equal(logger.lines(100).length, 3);
    assert.ok(existsSync(`${file}.1`));
    assert.equal(existsSync(`${file}.2`), false);
    assert.ok(statSync(file).size <= 800);
    assert.ok(statSync(`${file}.1`).size <= 800);
    const content = readFileSync(file, 'utf8');
    assert.match(content, /truncated/);
    for (const line of logger.lines(10)) assert.ok(line.length <= 160);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('多份备份按序号滚动', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-step-logger-'));
  try {
    const file = join(dir, 'test.log');
    const logger = new Logger(file, { maxBytes: 300, maxEntries: 10, maxLineLength: 50, maxBackups: 2 });
    for (let index = 0; index < 30; index++) logger.info('test', `entry-${index}`);
    assert.ok(existsSync(`${file}.1`));
    assert.ok(existsSync(`${file}.2`));
    assert.equal(existsSync(`${file}.3`), false);
    assert.ok(statSync(file).size <= 500);
    assert.ok(statSync(`${file}.1`).size <= 500);
    assert.ok(statSync(`${file}.2`).size <= 500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
