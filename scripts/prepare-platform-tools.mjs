import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REVISION = '37.0.1';
const packages = {
  darwin: {
    archive: `platform-tools_r${REVISION}-darwin.zip`,
    sha256: 'ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d',
    files: ['adb', 'NOTICE.txt', 'source.properties'],
  },
  win32: {
    archive: `platform-tools_r${REVISION}-win.zip`,
    sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99',
    files: ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt', 'source.properties'],
  },
  linux: {
    archive: `platform-tools_r${REVISION}-linux.zip`,
    sha256: 'd230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1',
    files: ['adb', 'NOTICE.txt', 'source.properties'],
  },
};

const root = resolve(process.cwd());
const target = join(root, 'resources', 'platform-tools');
const temporary = join(tmpdir(), `echobench-platform-tools-${process.pid}-${Date.now()}`);
const selected = packages[process.platform];
if (!selected) throw new Error(`不支持的打包平台：${process.platform}`);

const archivePath = join(temporary, selected.archive);
const extractPath = join(temporary, 'extracted');
const url = `https://dl.google.com/android/repository/${selected.archive}`;

try {
  await mkdir(temporary, { recursive: true });
  await mkdir(extractPath, { recursive: true });
  console.log(`[platform-tools] 下载 Android Platform-Tools ${REVISION}：${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'EchoBench-Build' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));

  const actualHash = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (actualHash !== selected.sha256) {
    throw new Error(`Platform-Tools 校验失败：期望 ${selected.sha256}，实际 ${actualHash}`);
  }

  await extractZip(archivePath, extractPath);
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(target)) {
    if (entry !== '.gitkeep') await rm(join(target, entry), { recursive: true, force: true });
  }
  for (const file of selected.files) {
    await copyFile(join(extractPath, 'platform-tools', file), join(target, file));
  }
  if (process.platform !== 'win32') await chmod(join(target, 'adb'), 0o755);
  await writeFile(join(target, 'VERSION'), `${REVISION}\n`, 'utf8');
  await verifyAdb(join(target, process.platform === 'win32' ? 'adb.exe' : 'adb'));
  console.log(`[platform-tools] 已内置到 ${target}`);
} finally {
  await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
}

async function extractZip(archive, destination) {
  if (process.platform === 'win32') {
    await execute('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:ECHOBENCH_ZIP -DestinationPath $env:ECHOBENCH_EXTRACT -Force',
    ], { ECHOBENCH_ZIP: archive, ECHOBENCH_EXTRACT: destination });
    return;
  }
  await execute('unzip', ['-q', archive, '-d', destination]);
}

function execute(file, args, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${file} 退出码 ${code ?? 'unknown'}`));
    });
  });
}

function verifyAdb(executable) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ['version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 && /Android Debug Bridge version/i.test(output)) resolvePromise();
      else reject(new Error(`内置 adb 自检失败：退出码 ${code ?? 'unknown'}\n${output}`));
    });
  });
}
