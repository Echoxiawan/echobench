import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, type WriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';

const APP_PORT = 4710;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const HEALTH_URL = `${APP_URL}/api/health`;
const REPO_URL = 'https://github.com/Echoxiawan/echobench';
const RELEASE_URL = `${REPO_URL}/releases/latest`;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverLog: WriteStream | null = null;
let serverFailure = '';
let serverExited = false;
let shuttingDown = false;
let serverReady = false;
let updateTimer: NodeJS.Timeout | null = null;

function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(root, ...parts);
}

function findBundledJavaHome(): string | null {
  const candidates = [resourcePath('jre'), join(resourcePath('jre'), 'Contents', 'Home')];
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'bin', executable))) return candidate;
  }
  return null;
}

function findSystemJavaHome(): string | null {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    process.env.JAVA_HOME,
    join(homedir(), '.sdkman', 'candidates', 'java', 'current'),
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/usr/lib/jvm/default-java',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Android', 'Android Studio', 'jbr') : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Android', 'Android Studio', 'jre') : undefined,
  ].filter((value): value is string => Boolean(value));
  const roots = [
    join(homedir(), 'Library', 'Java', 'JavaVirtualMachines'),
    '/usr/lib/jvm',
  ];
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        candidates.push(join(root, entry.name, 'Contents', 'Home'));
        candidates.push(join(root, entry.name));
      }
    } catch { /* 没有该 JDK 目录时忽略。 */ }
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'bin', executable))) return candidate;
  }
  return null;
}

function findJavaHome(): string | null {
  return findBundledJavaHome() ?? findSystemJavaHome();
}

function addCommonToolPaths(env: NodeJS.ProcessEnv): void {
  const extra = process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']
    : process.platform === 'linux'
      ? ['/usr/local/bin', '/usr/bin', '/bin', '/usr/lib/jvm/default-java/bin']
      : [];
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    const programFiles = env.ProgramFiles;
    if (localAppData) extra.push(join(localAppData, 'Android', 'Sdk', 'platform-tools'));
    if (programFiles) {
      extra.push(join(programFiles, 'Android', 'Android Studio', 'jbr', 'bin'));
      extra.push(join(programFiles, 'Android', 'Android Studio', 'jre', 'bin'));
    }
  }
  const current = (env.PATH ?? '').split(delimiter).filter(Boolean);
  env.PATH = [...new Set([...extra.filter((value) => existsSync(value)), ...current])].join(delimiter);
}

function isRunningFromDmg(): boolean {
  return app.isPackaged && app.getAppPath().startsWith('/Volumes/');
}

function serverEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(APP_PORT),
    ECHOBENCH_DATA_DIR: app.getPath('userData'),
    ECHOBENCH_APP_ROOT: app.getAppPath(),
    ECHOBENCH_DESKTOP: '1',
    ELECTRON_RUN_AS_NODE: '1',
  };
  const scrcpyServer = resourcePath('scrcpy-server');
  if (existsSync(scrcpyServer)) env.SCRCPY_SERVER_PATH = scrcpyServer;
  addCommonToolPaths(env);
  const javaHome = findJavaHome();
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${join(javaHome, 'bin')}${delimiter}${env.PATH ?? ''}`;
  }
  return env;
}

async function isHealthy(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) return;
    if (serverExited) {
      throw new Error(`本地服务已退出${serverFailure ? `：${serverFailure}` : ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`等待本地服务超时${serverFailure ? `：${serverFailure}` : ''}`);
}

async function startServer(): Promise<void> {
  if (await isHealthy()) return;
  const appRoot = app.getAppPath();
  const serverEntry = join(appRoot, 'dist-server', 'server', 'index.js');
  if (!existsSync(serverEntry)) {
    throw new Error('未找到 dist-server/server/index.js，请先执行 npm run build');
  }
  const logPath = join(app.getPath('userData'), 'logs', 'desktop.log');
  mkdirSync(dirname(logPath), { recursive: true });
  serverLog = createWriteStream(logPath, { flags: 'a' });
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: appRoot,
    env: serverEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const relay = (chunk: Buffer) => {
    serverLog?.write(chunk);
    const text = chunk.toString('utf8').trim();
    if (text) {
      serverFailure = text.slice(-2000);
      console.log(`[server] ${text}`);
    }
  };
  serverProcess.stdout?.on('data', relay);
  serverProcess.stderr?.on('data', relay);
  serverProcess.once('exit', (code, signal) => {
    serverExited = true;
    serverProcess = null;
    if (!shuttingDown) console.error(`[server] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  await waitForHealth();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b0e0a',
    title: 'EchoBench',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL(APP_URL);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    void dialog.showMessageBox({
      type: 'error',
      title: 'EchoBench',
      message: '工作台加载失败',
      detail: `${description} (${code})\n\n请确认本地服务日志：${join(app.getPath('userData'), 'logs')}`,
    });
  });
}

async function checkForUpdates(manual = false): Promise<void> {
  if (!app.isPackaged) {
    if (manual) await dialog.showMessageBox({ type: 'info', title: '检查更新', message: '开发模式下不检查更新。', detail: '请使用打包后的安装包测试在线更新。' });
    return;
  }
  await checkGitHubRelease(manual);
}

function versionParts(value: string): number[] {
  return value.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const now = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index];
  }
  return false;
}

async function checkGitHubRelease(manual: boolean): Promise<void> {
  try {
    const response = await fetch('https://api.github.com/repos/Echoxiawan/echobench/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EchoBench' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub Releases HTTP ${response.status}`);
    const release = await response.json() as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const latest = release.tag_name?.replace(/^v/, '') ?? '';
    if (latest && isNewerVersion(latest, app.getVersion())) {
      const notes = (release.body ?? '').trim().slice(0, 4000);
      const downloadUrl = pickDownloadUrl(release.assets ?? []) ?? release.html_url ?? RELEASE_URL;
      const result = await dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `EchoBench ${latest} 可用（当前 ${app.getVersion()}）`,
        detail: `请从 GitHub Releases 下载安装。\n\n${notes || '查看发布页了解更新内容。'}\n\n下载地址：${downloadUrl}`,
        buttons: ['打开下载页', '稍后'],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) void shell.openExternal(downloadUrl);
    } else if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '当前已经是最新版本。',
        detail: `发布页：${RELEASE_URL}`,
      });
    }
  } catch (error) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'error',
        title: '检查更新失败',
        message: '暂时无法检查更新。',
        detail: `${error instanceof Error ? error.message : String(error)}\n\n发布页：${RELEASE_URL}`,
      });
    }
  }
}

function pickDownloadUrl(assets: Array<{ name?: string; browser_download_url?: string }>): string | undefined {
  const patterns = process.platform === 'win32'
    ? [/\.exe$/i, /\.msi$/i]
    : process.platform === 'darwin'
      ? [/\.dmg$/i, /\.zip$/i]
      : [/\.AppImage$/i, /\.deb$/i];
  for (const pattern of patterns) {
    const match = assets.find((asset) => asset.name && pattern.test(asset.name) && asset.browser_download_url);
    if (match?.browser_download_url) return match.browser_download_url;
  }
  return undefined;
}

function showAbout(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: '关于 EchoBench',
    message: `EchoBench ${app.getVersion()}`,
    detail: `本地优先的 Android / iOS 移动测试工作台\n\n发布页：${RELEASE_URL}`,
    buttons: ['确定'],
  });
}

function buildMenu(): void {
  const updateItem = (): MenuItemConstructorOptions => ({
    label: '检查更新…',
    click: () => void checkForUpdates(true),
  });
  const aboutItem = (): MenuItemConstructorOptions => ({
    label: '关于 EchoBench',
    click: showAbout,
  });
  const openLogs: MenuItemConstructorOptions = {
    label: '打开日志目录',
    click: () => void shell.openPath(join(app.getPath('userData'), 'logs')),
  };
  const openReleases: MenuItemConstructorOptions = {
    label: '打开发布页',
    click: () => void shell.openExternal(RELEASE_URL),
  };
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({
      role: 'appMenu',
      submenu: [
        { role: 'about', label: '关于 EchoBench' },
        { type: 'separator' },
        updateItem(),
        openReleases,
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  template.push(
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [updateItem(), openReleases, aboutItem(), openLogs] },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopServer(): void {
  if (!serverProcess) return;
  const child = serverProcess;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 5000).unref();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('before-quit', (event) => {
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    if (shuttingDown || !serverProcess) return;
    event.preventDefault();
    shuttingDown = true;
    const child = serverProcess;
    const finish = () => { serverProcess = null; app.quit(); };
    child.once('exit', finish);
    child.kill('SIGTERM');
    setTimeout(finish, 5000).unref();
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.echobench.app');
    if (isRunningFromDmg()) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '请先安装 EchoBench',
        message: '不要直接从 DMG 运行',
        detail: 'DMG 是只读卷，直接运行会导致依赖安装、Appium 缓存和更新异常。请将 EchoBench.app 拖到“应用程序”文件夹，再从那里打开。',
        buttons: ['知道了'],
      });
      app.quit();
      return;
    }
    app.setAboutPanelOptions({
      applicationName: 'EchoBench',
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: 'Copyright © 2026 EchoBench contributors',
      credits: RELEASE_URL,
    });
    buildMenu();
    try {
      await startServer();
      serverReady = true;
      createWindow();
      setTimeout(() => void checkForUpdates(false), 8000);
      updateTimer = setInterval(() => void checkForUpdates(false), 24 * 60 * 60 * 1000);
      updateTimer.unref();
    } catch (error) {
      dialog.showErrorBox('EchoBench 启动失败', error instanceof Error ? error.message : String(error));
      app.quit();
    }
  }).catch((error) => {
    dialog.showErrorBox('EchoBench 启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow && serverReady) createWindow();
  });
}
