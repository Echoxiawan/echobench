import type { AiConfig, AiExportResult, AiTestResult, AppInfo, AttachSessionRequest, Device, DoctorReport, ElementTreeResponse, InstallResult, LogReport, MultiAction, MultiActionResult, MultiDeviceSelection, MultiDeviceStatus, MultiSessionStatus, ProjectScript, SessionConfig, StudioApi, SystemInfo, Target } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const value = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
    throw new Error(value.error ?? `请求失败：HTTP ${response.status}`);
  }
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('json') ? await response.json() : await response.text()) as T;
}

function post<T>(path: string, value: unknown = {}): Promise<T> { return request<T>(path, { method: 'POST', body: JSON.stringify(value) }); }
function download(content: string, filename: string, type: string): string {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}
function selectYaml(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.yaml,.yml,application/yaml,text/yaml';
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.click();
  });
}
function subscribe<T>(eventName: string, callback: (value: T) => void): () => void {
  const source = new EventSource('/api/events');
  source.addEventListener(eventName, (event) => callback(JSON.parse((event as MessageEvent<string>).data)));
  return () => source.close();
}

export const studioApi: StudioApi = {
  listDevices: () => request('/api/devices'),
  appInfo: () => request<AppInfo>('/api/app-info'),
  attachSession: (input: AttachSessionRequest) => post('/api/session/attach', input),
  elements: () => request<ElementTreeResponse>('/api/session/elements'),
  analyzeElement: (path) => post<Target>('/api/session/elements/analyze', { path }),
  startServer: () => post('/api/server/start'),
  createSession: (config: SessionConfig) => post('/api/session', config),
  closeSession: () => request('/api/session', { method: 'DELETE' }),
  releaseSession: () => post('/api/session/release'),
  releaseSessionBeacon: () => navigator.sendBeacon('/api/session/release'),
  screenshot: async () => (await request<{ screenshot: string }>('/api/session/screenshot')).screenshot,
  snapshot: () => request('/api/session/snapshot'),
  refreshSource: () => post('/api/session/source/refresh'),
  tap: (x, y, record = false) => post('/api/session/tap', { x, y, record }),
  setRecording: (recording) => post('/api/record/state', { recording }),
  inspect: (x, y) => post('/api/session/inspect', { x, y }),
  input: (target: Target, value, clearFirst) => post('/api/session/input', { target, value, clearFirst }),
  swipe: (direction, duration, start, end) => post('/api/session/swipe', { direction, duration, start, end }),
  back: () => post('/api/session/back'),
  doubleTap: (target) => post('/api/session/double-tap', { target }),
  longPress: (target, duration) => post('/api/session/long-press', { target, duration }),
  pinch: (input) => post('/api/session/pinch', input),
  verifyTarget: (target) => post('/api/locator/verify', { target }),
  keys: (input) => post('/api/session/keys', input),
  typingSnapshot: () => request('/api/session/focus'),
  saveYaml: async (script: ProjectScript) => download(await post('/api/script/yaml', script), 'app-steps.yaml', 'application/yaml'),
  openYaml: async () => { const content = await selectYaml(); return content ? post('/api/script/parse', { content }) : null; },
  exportJavaScript: async (script: ProjectScript) => download(await post('/api/script/javascript', script), 'app-steps.js', 'text/javascript'),
  exportPython: async (script: ProjectScript) => download(await post('/api/script/python', script), 'app-steps.py', 'text/x-python'),
  exportJava: async (script: ProjectScript) => download(await post('/api/script/java', script), 'AppSteps.java', 'text/x-java'),
  exportAiCase: async (script: ProjectScript, config: AiConfig, title: string) => {
    const result = await post<AiExportResult>('/api/ai/export', { script, config, title });
    return download(`\uFEFF${result.csv}`, result.filename, 'text/csv;charset=utf-8');
  },
  testAiConnection: (config: AiConfig) => post<AiTestResult>('/api/ai/test', { config }),
  system: () => request<SystemInfo>('/api/system'),
  installDependency: (id: string) => post<InstallResult>('/api/setup/install', { id }),
  doctor: () => request<DoctorReport>('/api/doctor'),
  multiStart: (devices: MultiDeviceSelection[], bundleId?: string) => post<MultiSessionStatus>('/api/multi/start', { devices, bundleId }),
  multiStatus: () => request<MultiSessionStatus>('/api/multi/status'),
  multiStop: () => post('/api/multi/stop'),
  multiSetDevice: (deviceId, patch) => post<MultiDeviceStatus[]>('/api/multi/device', { deviceId, ...patch }),
  multiAction: (action: MultiAction) => post<MultiActionResult[]>('/api/multi/action', action),
  multiScreenshot: async (deviceId) => (await request<{ screenshot: string }>(`/api/multi/screenshot?deviceId=${encodeURIComponent(deviceId)}`)).screenshot,
  logs: (limit = 500) => request<LogReport>(`/api/logs?limit=${limit}`),
  replay: (script: ProjectScript, startIndex = 0) => post('/api/script/replay', { script, startIndex }),
  onReplayProgress: (callback) => subscribe('replay-progress', callback),
  onReplayActivity: (callback) => subscribe('replay-activity', callback),
  onServerLog: (callback) => subscribe<{ line: string }>('server-log', (value) => callback(value.line)),
  onDevices: (callback) => subscribe<{ devices: Device[] }>('devices', (value) => callback(value.devices)),
};
