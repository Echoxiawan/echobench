export type Platform = 'android' | 'ios';

export interface AppInfo { version: string; releaseUrl: string; desktop: boolean }

export interface Device { id: string; name: string; platform: Platform; status: string; simulator?: boolean }
export interface Point { x: number; y: number }
export type LocatorStrategy = 'accessibility id' | 'id' | '-ios predicate string' | '-ios class chain' | '-android uiautomator' | 'xpath';
export interface Locator { strategy: LocatorStrategy; value: string }
export interface LocatorCandidate {
  locator: Locator;
  matches: number;
  unique: boolean;
  score: number;
  role: 'recommended' | 'alternative' | 'brittle';
  note?: string;
  source: 'attribute' | 'semantic' | 'resource-id' | 'xpath';
  verified?: boolean;
}
export interface Target {
  locator?: Locator;
  label?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  coordinate?: { xRatio: number; yRatio: number };
  candidates?: LocatorCandidate[];
  verifiedAt?: number;
  warning?: string;
}
export type WaitCondition = 'exists' | 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked' | 'unchecked' | 'empty' | 'text' | 'stable';
export type TextMatch = 'equals' | 'contains' | 'regex';
export interface StepPolicy {
  timeout?: number;
  settleTimeout?: number;
  retries?: number;
  retryDelay?: number;
  pollInterval?: number;
  settle?: boolean;
  verify?: boolean;
  coordinateFallback?: boolean;
  locatorFallback?: boolean;
}
interface StepBase { id: string; description: string; note?: string; policy?: StepPolicy }
export type Step =
  | (StepBase & { action: 'tap'; target: Target })
  | (StepBase & { action: 'doubleTap'; target: Target })
  | (StepBase & { action: 'longPress'; target: Target; duration: number })
  | (StepBase & { action: 'pinch'; direction: 'in' | 'out'; scale: number; duration: number; target?: Target })
  | (StepBase & { action: 'input'; target: Target; value: string; clearFirst: boolean; secret?: boolean })
  | (StepBase & { action: 'swipe'; direction: 'up' | 'down' | 'left' | 'right'; duration: number; start?: Point; end?: Point })
  | (StepBase & { action: 'back' })
  | (StepBase & { action: 'wait'; target?: Target; condition?: WaitCondition; expect?: string; match?: TextMatch; timeout: number });
export interface SessionConfig {
  platform: Platform;
  deviceId: string;
  platformVersion?: string;
  app?: string;
  packageName?: string;
  activity?: string;
  bundleId?: string;
  xcodeOrgId?: string;
  xcodeSigningId?: string;
  wdaBundleId?: string;
  allowProvisioning?: boolean;
  multiDevice?: boolean;
  mjpegServerPort?: number;
  wdaLocalPort?: number;
  derivedDataPath?: string;
}
export interface SessionState { sessionId: string; width: number; height: number; platform: Platform; attached?: boolean; video?: 'android' | 'ios' | 'none' }
export interface Snapshot { screenshot: string; source: string; width: number; height: number }
export interface RecordedTap { target: Target; x: number; y: number }
export interface AttachSessionRequest { appiumUrl: string; sessionId: string; platform: Platform; deviceId?: string; mjpegPort?: number }
export interface ElementNode {
  id: string;
  parentId: string;
  path: number[];
  depth: number;
  type: string;
  name: string;
  label: string;
  text: string;
  value: string;
  resourceId: string;
  bounds?: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
  children: number;
}
export interface ElementTreeResponse { platform: Platform; width: number; height: number; nodes: ElementNode[]; truncated: boolean }
export interface ProjectScript { version: 1; name: string; platform: Platform; capabilities: Record<string, string>; replay?: Partial<ReplaySettings>; steps: Step[] }
export interface ReplaySettings { timeout: number; settleTimeout: number; retries: number; retryDelay: number; pollInterval: number; settle: boolean; stopOnFailure: boolean; coordinateFallback: boolean; requireApp: boolean; locatorFallback: boolean }
export const defaultReplaySettings: ReplaySettings = { timeout: 10000, settleTimeout: 3000, retries: 2, retryDelay: 500, pollInterval: 300, settle: true, stopOnFailure: true, coordinateFallback: false, requireApp: true, locatorFallback: true };
export type ReplayStatus = 'running' | 'passed' | 'failed' | 'skipped';
export type ReplayPhase = 'waiting' | 'retrying' | 'acting' | 'verifying';
export interface ReplayActivity { index: number; phase: ReplayPhase; message: string; attempt: number; attempts: number; elapsed: number }
export type KeyName = 'backspace' | 'enter' | 'tab' | 'escape' | 'delete' | 'left' | 'up' | 'right' | 'down';
export interface TypingSnapshot { target?: Target; value?: string; placeholder?: string; password?: boolean }
export interface ReplayStepResult { index: number; action: Step['action']; description: string; status: ReplayStatus; duration?: number; message?: string; attempts?: number; retried?: number; waited?: number }
export interface ReplayProgress { index: number; total: number; startIndex?: number; action: Step['action']; description: string; status: 'running' | 'passed' | 'failed'; duration?: number; message?: string; attempts?: number; retried?: number; waited?: number }
export interface ReplayReport { status: 'passed' | 'failed'; startedAt: number; finishedAt: number; duration: number; startIndex?: number; results: ReplayStepResult[] }

export type DoctorStatus = 'ok' | 'warn' | 'fail';
export type PackageManager = 'brew' | 'winget' | 'apt' | 'dnf' | 'pacman' | 'none';
export interface SystemInfo {
  platform: string;
  osName: string;
  capabilities: { android: boolean; ios: boolean };
  packageManager: PackageManager;
}
export interface DoctorCheck {
  id: string;
  name: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
  required?: boolean;
  installable?: boolean;
}
export interface DoctorReport { generatedAt: number; system: SystemInfo; checks: DoctorCheck[] }
export interface InstallResult {
  ok: boolean;
  id: string;
  output: string;
  manual?: string;
  needsRestart?: boolean;
  doctor?: DoctorReport;
}
export type MultiDeviceState = 'connecting' | 'ready' | 'offline' | 'error';
export interface MultiDeviceSelection { deviceId: string; name: string; platform: Platform }
export interface MultiDeviceStatus {
  deviceId: string;
  name: string;
  platform: Platform;
  state: MultiDeviceState;
  online: boolean;
  width: number;
  height: number;
  foregroundApp?: string;
  sync: boolean;
  live: boolean;
  lastSeen: number;
  error?: string;
  lastAction?: { action: string; ok: boolean; duration: number; message?: string; at: number };
}
export interface MultiSessionStatus { active: boolean; startedAt?: number; devices: MultiDeviceStatus[]; mixedPlatform: boolean }
export interface MultiActionResult { deviceId: string; ok: boolean; duration: number; message?: string }
export type MultiAction =
  | { action: 'tap'; xRatio: number; yRatio: number }
  | { action: 'swipe'; startXRatio: number; startYRatio: number; endXRatio: number; endYRatio: number; duration: number }
  | { action: 'back' }
  | { action: 'text'; text: string }
  | { action: 'key'; key: KeyName };
export interface LogReport { path: string; lines: string[]; size?: number; maxBytes?: number; maxBackups?: number; maxLineLength?: number }
export interface AiConfig { baseUrl: string; model: string; apiKey: string }
export interface AiExportResult { filename: string; csv: string }
export interface AiTestResult { ok: boolean; message: string; model: string; latency: number }

export interface StudioApi {
  listDevices(): Promise<Device[]>;
  appInfo(): Promise<AppInfo>;
  attachSession(input: AttachSessionRequest): Promise<SessionState>;
  elements(): Promise<ElementTreeResponse>;
  analyzeElement(path: number[]): Promise<Target>;
  startServer(): Promise<void>;
  createSession(config: SessionConfig): Promise<SessionState>;
  closeSession(): Promise<void>;
  releaseSession(): Promise<void>;
  releaseSessionBeacon(): boolean;
  screenshot(): Promise<string>;
  snapshot(): Promise<Snapshot>;
  refreshSource(): Promise<void>;
  tap(x: number, y: number, record?: boolean): Promise<RecordedTap>;
  setRecording(recording: boolean): Promise<void>;
  inspect(x: number, y: number): Promise<RecordedTap>;
  input(target: Target, value: string, clearFirst: boolean): Promise<void>;
  swipe(direction: 'up' | 'down' | 'left' | 'right', duration: number, start?: Point, end?: Point): Promise<void>;
  back(): Promise<void>;
  doubleTap(target: Target): Promise<void>;
  longPress(target: Target, duration: number): Promise<void>;
  pinch(input: { target?: Target; direction: 'in' | 'out'; scale: number; duration: number }): Promise<void>;
  verifyTarget(target: Target): Promise<Target>;
  keys(input: { text?: string; key?: KeyName }): Promise<{ typed: boolean }>;
  typingSnapshot(): Promise<TypingSnapshot>;
  saveYaml(script: ProjectScript): Promise<string | null>;
  openYaml(): Promise<ProjectScript | null>;
  exportJavaScript(script: ProjectScript): Promise<string | null>;
  exportPython(script: ProjectScript): Promise<string | null>;
  exportJava(script: ProjectScript): Promise<string | null>;
  exportAiCase(script: ProjectScript, config: AiConfig, title: string): Promise<string | null>;
  testAiConnection(config: AiConfig): Promise<AiTestResult>;
  system(): Promise<SystemInfo>;
  installDependency(id: string): Promise<InstallResult>;
  doctor(): Promise<DoctorReport>;
  multiStart(devices: MultiDeviceSelection[], bundleId?: string): Promise<MultiSessionStatus>;
  multiStatus(): Promise<MultiSessionStatus>;
  multiStop(): Promise<void>;
  multiSetDevice(deviceId: string, patch: { live?: boolean; sync?: boolean }): Promise<MultiDeviceStatus[]>;
  multiAction(action: MultiAction): Promise<MultiActionResult[]>;
  multiScreenshot(deviceId: string): Promise<string>;
  logs(limit?: number): Promise<LogReport>;
  replay(script: ProjectScript, startIndex?: number): Promise<ReplayReport>;
  onReplayProgress(callback: (data: ReplayProgress) => void): () => void;
  onReplayActivity(callback: (data: ReplayActivity) => void): () => void;
  onServerLog(callback: (line: string) => void): () => void;
  onDevices(callback: (devices: Device[]) => void): () => void;
}

declare global { interface Window { studio: StudioApi } }
