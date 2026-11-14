import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiMessages,
  chatCompletionsUrl,
  generateAiCase,
  normalizeAiContent,
  prepareAiRows,
  testAiConnection,
  toCsv,
  validateAiConfig,
} from '../server/ai.js';
import type { ProjectScript } from '../src/types.js';

const script: ProjectScript = {
  version: 1,
  name: '登录流程',
  platform: 'ios',
  capabilities: { bundleId: 'com.demo.app' },
  steps: [
    {
      id: 's1',
      action: 'tap',
      description: '点击「用户名」',
      target: { locator: { strategy: 'accessibility id', value: 'username' }, label: '用户名' },
    },
    {
      id: 's2',
      action: 'input',
      description: '输入「******」',
      target: { locator: { strategy: 'accessibility id', value: 'password' }, label: '密码' },
      value: 'hunter2',
      clearFirst: true,
      secret: true,
    },
    {
      id: 's3',
      action: 'wait',
      description: '控件可见：首页',
      condition: 'visible',
      target: { locator: { strategy: 'accessibility id', value: 'home' }, label: '首页' },
      timeout: 5000,
    },
  ],
};

test('AI 提示词保留操作和断言，并对密码脱敏', () => {
  const rows = prepareAiRows(script);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].operation, '点击「用户名」');
  assert.deepEqual(rows[0].assertions, []);
  assert.match(rows[1].operation, /输入「\*\*\*\*\*\*」/);
  assert.deepEqual(rows[1].assertions, ['控件「首页」可见']);
  const messages = buildAiMessages(script, rows);
  const text = messages.map((message) => message.content).join('\n');
  assert.match(text, /登录流程/);
  assert.match(text, /控件「首页」可见/);
  assert.equal(text.includes('hunter2'), false);
  assert.match(text, /只输出一个 JSON/);
});

test('AI CSV 一行一个操作，标题重复且正确转义', () => {
  const csv = toCsv({
    title: '登录, "成功"',
    rows: [
      { operation: '点击「登录」', assertion: '页面出现 "首页"' },
      { operation: '输入账号', assertion: '' },
    ],
  });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '"用例标题","序号","操作步骤","断言"');
  assert.equal(lines[1], '"登录, ""成功""",1,"点击「登录」","页面出现 ""首页"""');
  assert.equal(lines[2], '"登录, ""成功""",2,"输入账号",""');
  assert.equal(lines.length, 3);
});

test('AI 输出兼容代码块和字段别名，标题由人工传入', () => {
  const expected = prepareAiRows(script);
  const content = '```json\n{"rows":[{"step":"点击「用户名」"},{"description":"输入密码","expected":["页面出现首页"]}]}\n```';
  const result = normalizeAiContent(content, expected, '人工标题');
  assert.equal(result.title, '人工标题');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].assertion, '操作后出现「密码」');
  assert.equal(result.rows[1].operation, '输入密码');
  assert.equal(result.rows[1].assertion, '页面出现首页');
  assert.equal(expected[0].hint, '操作后出现「密码」');
  assert.equal(expected[1].hint, '输入完成后，密码框内容已更新');
  assert.throws(() => normalizeAiContent('{"rows":[]}', expected, '标题'), /期望 2 行/);
  assert.throws(() => normalizeAiContent('{"rows":[]}', expected, ''), /请填写用例标题/);
});

test('AI 导出首次格式错误会重试并生成 CSV', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const expected = prepareAiRows(script);
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const content = calls.length === 1
      ? '这不是 JSON'
      : JSON.stringify({ rows: expected.map((row, index) => ({ operation: `操作${index + 1}`, assertion: row.assertions.join('；') })) });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const result = await generateAiCase(script, { baseUrl: 'https://example.com/v1/', model: 'demo', apiKey: 'secret-key' }, '我的用例', fakeFetch);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.com/v1/chat/completions');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer secret-key');
  assert.equal(result.filename, '我的用例-测试用例.csv');
  assert.match(result.csv, /"我的用例",1,"操作1"/);
});

test('AI 连通性检测返回成功、模型和延迟', async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'OK' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const result = await testAiConnection({ baseUrl: 'https://example.com/v1', model: 'demo-model', apiKey: 'k' }, fakeFetch);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'demo-model');
  assert.equal(result.message, 'OK');
  assert.ok(result.latency >= 0);
});

test('AI 连通性检测失败时返回接口错误', async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({
    error: { message: 'invalid api key' },
  }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const result = await testAiConnection({ baseUrl: 'https://example.com/v1', model: 'demo-model', apiKey: 'bad' }, fakeFetch);
  assert.equal(result.ok, false);
  assert.match(result.message, /401/);
  assert.match(result.message, /invalid api key/);
  const invalid = await testAiConnection({ baseUrl: '', model: 'm', apiKey: '' }, fakeFetch);
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /Base URL/);
});

test('AI 配置与 chat 地址校验', () => {
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(
    chatCompletionsUrl('https://api.openai.com/v1/chat/completions'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.throws(() => chatCompletionsUrl('ftp://example.com/v1'), /http\/https/);
  assert.throws(() => validateAiConfig({ baseUrl: 'https://example.com/v1', model: '' }), /Model/);
});
