import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { request as httpRequest, type ServerResponse } from 'node:http';
import { createServer, type Server, type Socket } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const SCRCPY_VERSION = '3.2';
const DEVICE_SERVER_PATH = '/data/local/tmp/app-step-scrcpy-server.jar';

export interface AndroidStreamOptions {
  bitRate?: number;
  maxSize?: number;
  maxFps?: number;
}

interface AndroidStream {
  cleanup: () => Promise<void>;
  teardown: Promise<void> | null;
}

export class VideoStreamManager {
  private androidStreams = new Map<string, AndroidStream>();
  private androidTeardowns = new Map<string, Promise<void>>();

  async streamAndroid(deviceId: string, response: ServerResponse, options: AndroidStreamOptions = {}): Promise<void> {
    // 同一台设备只允许一条流；不同设备互不影响。
    await this.androidTeardowns.get(deviceId);
    if (this.androidStreams.get(deviceId)) {
      response.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: '该设备实时画面已被另一个连接占用' }));
      return;
    }

    let listener: Server | null = null;
    let androidServer: ChildProcess | null = null;
    let videoSocket: Socket | null = null;
    let reverseCreated = false;
    let socketName = '';
    let serverError = '';
    let closed = false;
    let cleanupPromise: Promise<void> | null = null;
    const stream: AndroidStream = { cleanup: async () => undefined, teardown: null };
    const cleanup = async () => {
      if (cleanupPromise) return cleanupPromise;
      closed = true;
      if (this.androidStreams.get(deviceId) === stream) this.androidStreams.delete(deviceId);
      cleanupPromise = (async () => {
        videoSocket?.destroy();
        listener?.close();
        await Promise.all([
          androidServer ? terminateChild(androidServer) : Promise.resolve(),
        ]);
        await terminateDeviceServer(deviceId);
        if (reverseCreated) {
          await execute('adb', ['-s', deviceId, 'reverse', '--remove', `localabstract:${socketName}`]).catch(() => undefined);
        }
      })().finally(() => {
        if (stream.teardown === cleanupPromise) stream.teardown = null;
        if (this.androidTeardowns.get(deviceId) === cleanupPromise) this.androidTeardowns.delete(deviceId);
      });
      stream.teardown = cleanupPromise;
      this.androidTeardowns.set(deviceId, cleanupPromise);
      return cleanupPromise;
    };
    stream.cleanup = cleanup;
    // 在任何异步预检之前占位，避免浏览器的重复媒体请求同时启动两条设备流。
    this.androidStreams.set(deviceId, stream);
    response.once('close', () => void cleanup());
    response.once('error', () => void cleanup());

    try {
      const serverPath = await findScrcpyServer();
      assertStreamOpen(closed);
      console.log(`[视频流] 使用 scrcpy-server：${serverPath}`);
      const scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0');
      socketName = `scrcpy_${scid}`;
      await execute('adb', ['-s', deviceId, 'push', serverPath, DEVICE_SERVER_PATH]);
      assertStreamOpen(closed);
      listener = await createVideoListener();
      assertStreamOpen(closed);
      const listenerAddress = listener.address();
      if (!listenerAddress || typeof listenerAddress === 'string') throw new Error('无法取得 scrcpy 本地监听端口');
      const firstPacket = acceptWithFirstPacket(listener, () => androidServer, () => serverError);
      await execute('adb', ['-s', deviceId, 'reverse', `localabstract:${socketName}`, `tcp:${listenerAddress.port}`]);
      reverseCreated = true;
      assertStreamOpen(closed);
      console.log(`[视频流] ADB reverse 已建立：${socketName} → 127.0.0.1:${listenerAddress.port}`);
      androidServer = spawn('adb', [
        '-s', deviceId, 'shell', `CLASSPATH=${DEVICE_SERVER_PATH}`, 'app_process', '/',
        'com.genymobile.scrcpy.Server', SCRCPY_VERSION, `scid=${scid}`, 'log_level=warn',
        `video_bit_rate=${options.bitRate ?? 4_000_000}`, `max_size=${options.maxSize ?? 1280}`, `max_fps=${options.maxFps ?? 30}`, 'audio=false',
        // 每秒一个关键帧：避免首帧黑屏后，静止页面长时间没有新关键帧。
        'video_codec_options=i-frame-interval:int=1',
        'control=false', 'raw_stream=false', 'send_device_meta=false',
        'send_codec_meta=false', 'send_frame_meta=true', 'cleanup=false',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      androidServer.stderr!.on('data', (chunk: Buffer) => { serverError = `${serverError}${chunk.toString()}`.slice(-2000); });
      videoSocket = await firstPacket;
      assertStreamOpen(closed);
      console.log('[视频流] 已收到 Android H.264 首包');
      response.writeHead(200, {
        'content-type': 'application/vnd.app-step.scrcpy', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', connection: 'keep-alive',
      });
      let streamBytes = 0;
      videoSocket.on('data', (chunk: Buffer) => { streamBytes += chunk.length; });
      // 保留 scrcpy 的 12 字节帧头，浏览器可直接获得关键帧标志和设备 PTS。
      videoSocket.pipe(response);
      videoSocket.resume();
      androidServer.stderr!.on('data', (chunk: Buffer) => reportStreamError(response, 'scrcpy-server', chunk));
      response.once('close', () => {
        console.log(`[视频流] 连接关闭：scrcpy 帧流 ${streamBytes} 字节`);
      });
      videoSocket.once('error', () => void cleanup());
      androidServer.once('exit', () => { if (!response.writableEnded) response.end(); void cleanup(); });
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  streamIos(response: ServerResponse, port = 9100): void {
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 5000 }, (source) => {
      if ((source.statusCode ?? 500) >= 400) {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: `WDA MJPEG 返回 HTTP ${source.statusCode}` }));
        source.resume();
        return;
      }
      response.writeHead(200, {
        'content-type': source.headers['content-type'] ?? 'multipart/x-mixed-replace; boundary=BoundaryString',
        'cache-control': 'no-store', connection: 'keep-alive',
      });
      source.pipe(response);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('连接 WDA MJPEG 超时')));
    upstream.on('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      if (!response.writableEnded) response.end(JSON.stringify({ error: `无法连接 WDA MJPEG：${error.message}` }));
    });
    response.once('close', () => upstream.destroy());
    upstream.end();
  }

  async stopAndroid(deviceId: string): Promise<void> {
    const stream = this.androidStreams.get(deviceId);
    if (!stream) return;
    await stream.cleanup();
    await stream.teardown;
  }

  async close(): Promise<void> {
    await Promise.all([...this.androidStreams.values()].map(async (stream) => {
      await stream.cleanup();
      await stream.teardown;
    }));
  }
}

export async function findScrcpyServer(): Promise<string> {
  const configured = process.env.SCRCPY_SERVER_PATH;
  if (configured && await exists(configured)) return resolve(configured);
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const { stdout } = await execute(lookupCommand, ['scrcpy']).catch(() => ({ stdout: '' }));
  const executable = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!executable) throw new Error('未找到 scrcpy。请安装 scrcpy 3.2，或设置 SCRCPY_SERVER_PATH');
  const realExecutable = await realpath(executable).catch(() => executable);
  const executableDir = dirname(realExecutable);
  const candidates = [
    join(executableDir, 'scrcpy-server'),
    join(executableDir, 'scrcpy-server.jar'),
    join(executableDir, '..', 'share', 'scrcpy', 'scrcpy-server'),
    join(dirname(executableDir), 'share', 'scrcpy', 'scrcpy-server'),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return resolve(candidate);
  throw new Error(`已找到 ${basename(executable)}，但未找到配套 scrcpy-server。请设置 SCRCPY_SERVER_PATH`);
}

function createVideoListener(): Promise<Server> {
  return new Promise((resolveListener, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      listener.removeListener('error', reject);
      resolveListener(listener);
    });
  });
}
function acceptWithFirstPacket(listener: Server, getServerProcess: () => ChildProcess | null, getError: () => string): Promise<Socket> {
  return new Promise((resolveReady, reject) => {
    let settled = false;
    const timer = setTimeout(() => fail(new Error(`等待 scrcpy H.264 首包超时：${getError() || '设备未连接视频通道'}`)), 12_000);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listener.removeAllListeners('connection');
      reject(error);
    };
    listener.once('connection', (socket) => {
      console.log('[视频流] scrcpy-server 已连接主机视频端口');
      socket.setNoDelay(true);
      socket.once('data', (chunk) => {
        if (settled) return socket.destroy();
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.pause();
        socket.unshift(chunk);
        console.log(`[视频流] H.264 首包大小：${chunk.length} 字节`);
        listener.close();
        resolveReady(socket);
      });
      socket.once('end', () => fail(new Error('scrcpy 视频通道在首包前关闭')));
      socket.once('error', fail);
    });
    const watchServer = () => {
      const serverProcess = getServerProcess();
      if (serverProcess) {
        serverProcess.once('exit', (code) => fail(new Error(`scrcpy-server 在首包前退出：${getError() || code}`)));
      } else if (!settled) {
        setImmediate(watchServer);
      }
    };
    watchServer();
  });
}
function reportStreamError(response: ServerResponse, processName: string, chunk: Buffer): void {
  const detail = chunk.toString().trim();
  if (!detail) return;
  console.error(`[视频流] ${processName}：${detail}`);
  if (!response.writableEnded) response.addTrailers({ 'x-stream-error': encodeURIComponent(`${processName}: ${detail.slice(-400)}`) });
}
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
function assertStreamOpen(closed: boolean): void { if (closed) throw new Error('Android 视频请求已取消'); }

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveTermination) => {
    const forceTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
    forceTimer.unref();
    child.once('exit', () => { clearTimeout(forceTimer); resolveTermination(); });
    if (!child.kill('SIGTERM')) { clearTimeout(forceTimer); resolveTermination(); }
  });
}
async function terminateDeviceServer(deviceId: string): Promise<void> {
  await execute('adb', ['-s', deviceId, 'shell', 'pkill', '-f', DEVICE_SERVER_PATH]).catch(() => undefined);
}
