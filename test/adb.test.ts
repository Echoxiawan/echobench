import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { configureAdbEnvironment, configureAdbServerPort, resolveAdbExecutable } from '../server/adb.js';

test('优先解析应用内置 adb 并写入子进程 PATH', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'echobench-adb-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'resources', 'platform-tools');
  const executable = join(directory, 'adb');
  await mkdir(directory, { recursive: true });
  await writeFile(executable, '', 'utf8');
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
  assert.equal(resolveAdbExecutable({ env, platform: 'darwin', appRoot: root }), executable);
  assert.equal(configureAdbEnvironment({ env, platform: 'darwin', appRoot: root }), executable);
  assert.equal(env.ECHOBENCH_ADB_PATH, executable);
  assert.equal(env.PATH?.split(delimiter)[0], dirname(executable));
});

test('默认复用标准 ADB Server 并支持显式隔离端口', () => {
  const env: NodeJS.ProcessEnv = {};
  assert.deepEqual(configureAdbServerPort(env), { port: undefined, socket: undefined, isolated: false });
  assert.equal(env.ANDROID_ADB_SERVER_PORT, undefined);

  const isolated: NodeJS.ProcessEnv = { ECHOBENCH_ADB_SERVER_PORT: '15038' };
  assert.deepEqual(configureAdbServerPort(isolated), { port: '15038', isolated: true });
  assert.equal(isolated.ANDROID_ADB_SERVER_PORT, '15038');

  const inherited: NodeJS.ProcessEnv = { ANDROID_ADB_SERVER_PORT: '15039' };
  assert.deepEqual(configureAdbServerPort(inherited), { port: '15039', socket: undefined, isolated: false });

  const socket: NodeJS.ProcessEnv = { ADB_SERVER_SOCKET: 'tcp:192.168.1.10:15040' };
  assert.deepEqual(configureAdbServerPort(socket), { port: undefined, socket: 'tcp:192.168.1.10:15040', isolated: false });
});
