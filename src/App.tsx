import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, CircleStop, Code2, Copy, Crosshair, FileInput, FileSpreadsheet, FileText, FolderOpen, GripVertical, Hand, Keyboard, Languages, LayoutGrid, MonitorSmartphone, MousePointerClick, Pencil, Play, Radio, RefreshCw, Save, Send, Settings2, Smartphone, Sparkles, Stethoscope, Trash2, Unplug, Undo2, Wifi, WifiOff, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
import type { AiConfig, AppInfo, Device, DoctorReport, ElementTreeResponse, KeyName, Locator, LocatorStrategy, MultiAction, MultiActionResult, MultiDeviceSelection, MultiDeviceStatus, MultiSessionStatus, Platform, ProjectScript, RecordedTap, ReplayActivity, ReplaySettings, ReplayStepResult, SessionConfig, SessionState, Step, SystemInfo, Target, TextMatch, WaitCondition } from './types';
import { buildConnectionDiagnostic, type ConnectionDiagnostic } from './connection-diagnostic';
import { loadAiConfig, normalizeAiConfig, saveAiConfig } from './ai-config';
import { autoInstallCandidates } from './setup-plan';
import { defaultReplaySettings } from './types';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { clampLayout, defaultLayout, layoutLimits, loadLayout, saveLayout, type PanelLayout } from './layout';
import { useI18n } from './i18n';
import { errorText, localeOptions, localizeGeneratedText } from './messages';

type ReplayRun = { total: number; startIndex: number; status: 'running' | 'passed' | 'failed'; startedAt: number; finishedAt?: number; duration?: number; results: Record<number, ReplayStepResult> };
type DebugRun = { stepId: string; status: 'running' | 'passed' | 'failed'; message?: string; duration?: number; activity?: string };
type InputStep = Extract<Step, { action: 'input' }>;
const specialKeys: Record<string, KeyName> = { Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'escape', Delete: 'delete', ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down' };
const actionNames: Record<Step['action'], string> = { tap: '点击', doubleTap: '双击', longPress: '长按', pinch: '双指缩放', input: '输入', swipe: '滑动', back: '返回', wait: '断言' };
const conditionNames: Record<WaitCondition, string> = { exists: '控件出现', visible: '控件可见', hidden: '控件隐藏', enabled: '控件可用', disabled: '控件禁用', checked: '控件已选中', unchecked: '控件未选中', empty: '控件内容为空', text: '控件文本匹配', stable: '页面稳定' };
const uid = () => crypto.randomUUID();
const DEFAULT_PROJECT_NAMES = new Set(['应用操作录制', 'App recording']);

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [devices, setDevices] = useState<Device[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [discoveringDevices, setDiscoveringDevices] = useState(false);
  const [lastDeviceScan, setLastDeviceScan] = useState<number | null>(null);
  const [config, setConfig] = useState<SessionConfig>({ platform: 'android', deviceId: '' });
  const [session, setSession] = useState<SessionState | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachUrl, setAttachUrl] = useState('http://127.0.0.1:4723');
  const [attachSessionId, setAttachSessionId] = useState('');
  const [attachPlatform, setAttachPlatform] = useState<Platform>('android');
  const [attachDeviceId, setAttachDeviceId] = useState('');
  const [attachMjpegPort, setAttachMjpegPort] = useState('');
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [inspectorMode, setInspectorMode] = useState<'target' | 'tree'>('target');
  const [elementHighlight, setElementHighlight] = useState<Target['bounds'] | null>(null);
  useEffect(() => { void window.studio.appInfo().then(setAppInfo).catch(() => undefined); }, []);
  useEffect(() => { if (!session && inspectorMode === 'tree') { setInspectorMode('target'); setElementHighlight(null); } }, [session, inspectorMode]);
  const [initialShot, setInitialShot] = useState<string | null>(null);
  const [streamNonce, setStreamNonce] = useState(0);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'loading' | 'playing' | 'failed'>('idle');
  const [steps, setSteps] = useState<Step[]>([]);
  const [projectName, setProjectName] = useState(() => t('应用操作录制'));
  const [selected, setSelected] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [replay, setReplay] = useState<ReplayRun | null>(null);
  const [settings, setSettings] = useState<ReplaySettings>(defaultReplaySettings);
  const [activity, setActivity] = useState<ReplayActivity | null>(null);
  const [activityAt, setActivityAt] = useState(0);
  const [activityLog, setActivityLog] = useState<Record<number, string[]>>({});
  const [clock, setClock] = useState(Date.now());
  const [keyboard, setKeyboard] = useState(true);
  const [typingNotice, setTypingNotice] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [connectionFailure, setConnectionFailure] = useState<ConnectionDiagnostic | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [installing, setInstalling] = useState('');
  const [installNotice, setInstallNotice] = useState('');
  const [installError, setInstallError] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);
  const [logPath, setLogPath] = useState('');
  const [assertCondition, setAssertCondition] = useState<WaitCondition>('visible');
  const [assertExpect, setAssertExpect] = useState('');
  const [assertMatch, setAssertMatch] = useState<TextMatch>('contains');
  const [multiOpen, setMultiOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig());
  const [aiTitle, setAiTitle] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const [aiError, setAiError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsConfig, setSettingsConfig] = useState<AiConfig>(() => loadAiConfig());
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [clearStage, setClearStage] = useState<0 | 1 | 2>(0);
  const [debugResults, setDebugResults] = useState<Record<string, DebugRun>>({});
  const [layout, setLayout] = useState<PanelLayout>(() => loadLayout());
  const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 1512 : window.innerWidth));
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<RecordedTap | null>(null);
  const [editLocator, setEditLocator] = useState<{ mode: 'step' | 'picked'; strategy: LocatorStrategy; value: string } | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ mode: 'step' | 'picked'; value: string } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ value: string } | null>(null);
  const [inputEdit, setInputEdit] = useState<{ stepId: string; value: string } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startedAt: number; moved: boolean } | null>(null);
  const suppressTapRef = useRef(false);
  const stepRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const captureRef = useRef<HTMLTextAreaElement | null>(null);
  const recordingRef = useRef(recording);
  const typingPendingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
  const commitTaskRef = useRef<Promise<InputStep | null> | null>(null);
  const keyBufferRef = useRef('');
  const keyFlushTimerRef = useRef<number | null>(null);
  const keyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const typedBufferRef = useRef('');
  const debuggingIdRef = useRef<string | null>(null);
  const replayActiveRef = useRef(false);

  const refreshDevices = useCallback(async (manual = false) => {
    if (manual) setDiscoveringDevices(true);
    try {
      const found = await window.studio.listDevices();
      setDevices(found);
      setLastDeviceScan(Date.now());
      setConfig((old) => {
        const current = found.find((device) => device.id === old.deviceId);
        const next = (current?.status === 'device' ? current : undefined)
          ?? found.find((device) => device.platform === old.platform && device.status === 'device')
          ?? current
          ?? found.find((device) => device.platform === old.platform);
        return next ? { ...old, deviceId: next.id } : old;
      });
    }
    catch (cause) { setError(errorText(locale, cause)); }
    finally { if (manual) setDiscoveringDevices(false); }
  }, []);
  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const shot = await window.studio.screenshot().catch(() => null);
      if (shot) setInitialShot(shot);
      if (session.video === 'none') { setStreamStatus('playing'); return; }
      await window.studio.refreshSource();
      setStreamStatus('loading');
      setStreamNonce((value) => value + 1);
    }
    catch (cause) { setError(errorText(locale, cause)); }
  }, [session]);

  useEffect(() => {
    // 新页面不继承后端旧会话；刷新、崩溃恢复和重新打开都会从干净状态开始。
    void window.studio.releaseSession().finally(() => refreshDevices());
    return window.studio.onServerLog((line) => setLogs((old) => [...old.slice(-499), line.trim()].filter(Boolean)));
  }, [refreshDevices]);
  useEffect(() => window.studio.onDevices((found) => {
    setDevices(found);
    setLastDeviceScan(Date.now());
    // 自动发现只更新列表，不打断当前选择或已连接会话。
    setConfig((old) => {
      if (old.deviceId) return old;
      const next = found.find((device) => device.platform === old.platform && device.status === 'device')
        ?? found.find((device) => device.status === 'device');
      return next ? { ...old, deviceId: next.id } : old;
    });
  }), []);
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setSteps(draft.steps);
      setProjectName(DEFAULT_PROJECT_NAMES.has(draft.name) ? t('应用操作录制') : draft.name);
      setConfig(draft.config);
      setSettings(draft.settings);
      setRestoredAt(draft.savedAt);
    }
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    const flush = () => saveDraft({ name: projectName, config, settings, steps });
    const timer = window.setTimeout(flush, 400);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [draftReady, projectName, config, settings, steps]);
  useEffect(() => {
    setProjectName((current) => DEFAULT_PROJECT_NAMES.has(current) ? t('应用操作录制') : current);
  }, [locale]);
  useEffect(() => { saveLayout(layout); }, [layout]);
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const deviceWidth = viewport <= 1080 ? 230 : viewport <= 1220 ? 240 : 290;
    setLayout((old) => {
      const next = clampLayout(old, viewport, deviceWidth);
      return next.steps === old.steps && next.inspector === old.inspector ? old : next;
    });
  }, [viewport]);
  useEffect(() => {
    if (!session) {
      setPicking(false);
      setPicked(null);
    }
  }, [session]);
  useEffect(() => {
    setLabelEdit((current) => current?.mode === 'step' ? null : current);
    setNoteEdit(null);
    setInputEdit(null);
  }, [selected]);
  useEffect(() => {
    if (!picked) setLabelEdit((current) => current?.mode === 'picked' ? null : current);
  }, [picked]);
  useEffect(() => window.studio.onReplayProgress((progress) => {
    const debugId = debuggingIdRef.current;
    if (debugId) {
      setDebugResults((old) => {
        const current = old[debugId] ?? { stepId: debugId, status: 'running' as const };
        return {
          ...old,
          [debugId]: {
            ...current,
            status: progress.status,
            message: progress.message ?? current.message,
            duration: progress.duration ?? current.duration,
            activity: progress.status === 'running' ? current.activity : undefined,
          },
        };
      });
      return;
    }
    if (!replayActiveRef.current) return;
    setReplay((old) => {
      // 报告已返回时迟到的事件会覆盖最终状态，直接忽略。
      if (old?.finishedAt !== undefined) return old;
      const current: ReplayRun = old ?? { total: progress.total, startIndex: progress.startIndex ?? 0, startedAt: Date.now(), status: 'running', results: {} };
      const finished = progress.status === 'passed' && progress.index + 1 >= progress.total;
      return {
        ...current,
        total: progress.total,
        startIndex: progress.startIndex ?? current.startIndex,
        status: progress.status === 'failed' ? 'failed' : finished ? 'passed' : 'running',
        results: { ...current.results, [progress.index]: { index: progress.index, action: progress.action, description: progress.description, status: progress.status, duration: progress.duration, message: progress.message, attempts: progress.attempts, retried: progress.retried, waited: progress.waited } },
      };
    });
    if (progress.status !== 'running') setActivity((current) => current && current.index === progress.index ? null : current);
  }), []);
  useEffect(() => window.studio.onReplayActivity((value) => {
    const debugId = debuggingIdRef.current;
    if (debugId) {
      setDebugResults((old) => {
        const current = old[debugId] ?? { stepId: debugId, status: 'running' as const };
        return { ...old, [debugId]: { ...current, activity: value.message } };
      });
      return;
    }
    if (!replayActiveRef.current) return;
    setActivity(value);
    setActivityAt(Date.now());
    setActivityLog((old) => {
      const lines = old[value.index] ?? [];
      const line = value.phase === 'waiting' && value.attempt > 1 ? `第 ${value.attempt} 次 · ${value.message}` : value.message;
      if (lines.at(-1) === line) return old;
      return { ...old, [value.index]: [...lines, line].slice(-8) };
    });
  }), []);
  useEffect(() => {
    if (!session) return;
    const release = () => { window.studio.releaseSessionBeacon(); };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [session]);

  const selectedStep = selected === null ? null : steps[selected] ?? null;
  const selectedTarget = selectedStep && 'target' in selectedStep ? selectedStep.target : null;
  const iosSupported = !system || system.capabilities.ios;
  const iosBlocked = config.platform === 'ios' && !iosSupported;
  const aiConfigured = Boolean(aiConfig.baseUrl.trim() && aiConfig.model.trim());
  const onlineDeviceCount = devices.filter((device) => device.status === 'device').length;
  const currentDeviceMissing = Boolean(config.deviceId && lastDeviceScan && !devices.some((device) => device.id === config.deviceId));
  const associatedAssertions = useMemo(() => {
    if (selected === null || !selectedStep || selectedStep.action === 'wait') return [] as Array<{ index: number; step: Extract<Step, { action: 'wait' }> }>;
    const list: Array<{ index: number; step: Extract<Step, { action: 'wait' }> }> = [];
    for (let index = selected + 1; index < steps.length && steps[index].action === 'wait'; index++) {
      list.push({ index, step: steps[index] as Extract<Step, { action: 'wait' }> });
    }
    return list;
  }, [selected, selectedStep, steps]);
  const selectedDebug = selectedStep ? debugResults[selectedStep.id] ?? null : null;
  const selectedSwipeDistance = selectedStep?.action === 'swipe' ? swipeDistance(selectedStep, session) : 0;
  const deviceColumnWidth = viewport <= 1080 ? 230 : viewport <= 1220 ? 240 : 290;
  const panelBudget = Math.max(layoutLimits.steps.min + layoutLimits.inspector.min, viewport - deviceColumnWidth - 260 - 24);
  const maxStepsWidth = Math.max(layoutLimits.steps.min, Math.min(layoutLimits.steps.max, panelBudget - layout.inspector));
  const maxInspectorWidth = Math.max(layoutLimits.inspector.min, Math.min(layoutLimits.inspector.max, panelBudget - layout.steps));
  const filteredDevices = devices.filter((device) => device.platform === config.platform);
  const script = useMemo<ProjectScript>(() => ({
    version: 1, name: projectName, platform: config.platform,
    capabilities: Object.fromEntries(Object.entries({
      udid: config.deviceId,
      app: config.app,
      appPackage: config.packageName,
      appActivity: config.activity,
      bundleId: config.bundleId,
      xcodeOrgId: config.xcodeOrgId,
      xcodeSigningId: config.xcodeSigningId,
      wdaBundleId: config.wdaBundleId,
      allowProvisioning: config.allowProvisioning ? 'true' : undefined,
    }).filter(([, value]) => value).map(([key, value]) => [key, value!])),
    replay: settings,
    steps,
  }), [config, projectName, settings, steps]);

  const replayResults = replay?.results ?? {};
  const runningIndex = Object.values(replayResults).find((result) => result.status === 'running')?.index ?? null;
  const runningStep = runningIndex === null ? null : steps[runningIndex] ?? null;
  const replaying = replay?.status === 'running';
  const executedTotal = replay ? Math.max(0, replay.total - replay.startIndex) : 0;
  const executedDone = replay && runningIndex !== null ? Math.max(0, runningIndex - replay.startIndex + 1) : 0;
  const passedCount = Object.values(replayResults).filter((result) => result.status === 'passed').length;
  const failedResult = Object.values(replayResults).find((result) => result.status === 'failed') ?? null;
  const totalRetries = Object.values(replayResults).reduce((sum, result) => sum + (result.retried ?? 0), 0);
  const activeActivity = runningIndex !== null && activity?.index === runningIndex ? activity : null;
  const activityElapsed = activeActivity ? activeActivity.elapsed + Math.max(0, clock - activityAt) : 0;

  useEffect(() => {
    if (!replaying) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [replaying]);

  useEffect(() => {
    if (runningIndex === null) return;
    stepRefs.current[runningIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [runningIndex]);

  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => {
    typedBufferRef.current = '';
    void window.studio.setRecording(recording).catch(() => undefined);
  }, [recording]);

  const commitTyping = useCallback(async (): Promise<InputStep | null> => {
    if (commitTaskRef.current) return commitTaskRef.current;
    if (!typingPendingRef.current && commitTimerRef.current === null) return null;
    typingPendingRef.current = false;
    if (commitTimerRef.current !== null) { window.clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
    const task = (async (): Promise<InputStep | null> => {
      await keyQueueRef.current;
      if (!recordingRef.current) { typedBufferRef.current = ''; return null; }
      try {
        const snapshot = await window.studio.typingSnapshot();
        if (!snapshot.target?.locator) { typedBufferRef.current = ''; return null; }
        const secret = Boolean(snapshot.password) || isPasswordTarget(snapshot.target);
        const typed = typedBufferRef.current;
        const snapshotValue = snapshot.value !== undefined && snapshot.value !== snapshot.placeholder ? snapshot.value : '';
        const value = secret && typed ? typed : snapshotValue || typed;
        if (!value) { typedBufferRef.current = ''; return null; }
      const step: InputStep = { id: uid(), action: 'input', target: snapshot.target, value, clearFirst: true, secret, description: t('输入「{value}」', { value: maskInput(value) }) };
        setSteps((old) => withInputStep(old, step));
        return step;
      } catch { typedBufferRef.current = ''; return null; }
    })();
    commitTaskRef.current = task;
    try { return await task; } finally { commitTaskRef.current = null; }
  }, []);

  const markTyping = useCallback(() => {
    if (!recordingRef.current) return;
    typingPendingRef.current = true;
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => { commitTimerRef.current = null; void commitTyping(); }, 300);
  }, [commitTyping]);

  const resetTyping = useCallback(() => {
    typingPendingRef.current = false;
    typedBufferRef.current = '';
    if (commitTimerRef.current !== null) { window.clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!keyboard || !session || picking) return;
    let active = true;
    const capture = captureRef.current;
    capture?.focus();
    const refocus = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target === capture || isTextEntry(target)) return;
      window.setTimeout(() => { if (active && document.activeElement !== capture) capture?.focus(); }, 0);
    };
    const send = (payload: { text?: string; key?: KeyName }) => {
      keyQueueRef.current = keyQueueRef.current
        .then(() => window.studio.keys(payload))
        .then((result): void => {
          if (active) setTypingNotice(result.typed ? '' : t('当前没有聚焦的输入框，请先点击设备上的输入框'));
        })
        .catch((cause) => setError(errorText(locale, cause)));
    };
    const flushText = () => {
      if (keyFlushTimerRef.current !== null) { window.clearTimeout(keyFlushTimerRef.current); keyFlushTimerRef.current = null; }
      const text = keyBufferRef.current;
      keyBufferRef.current = '';
      if (!text) return;
      typedBufferRef.current += text;
      send({ text });
      markTyping();
    };
    const appendText = (text: string) => {
      keyBufferRef.current += text;
      if (keyFlushTimerRef.current === null) keyFlushTimerRef.current = window.setTimeout(flushText, 40);
    };
    const pressSpecial = async (key: KeyName) => {
      flushText();
      if (key === 'backspace' || key === 'delete') {
        typedBufferRef.current = typedBufferRef.current.slice(0, -1);
        send({ key });
        markTyping();
        return;
      }
      // 回车、Tab 等按键可能改变焦点，先提交当前输入再发送。
      await keyQueueRef.current;
      if (!active) return;
      await commitTyping();
      typedBufferRef.current = '';
      if (!active) return;
      send({ key });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (replaying || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && target !== capture && isTextEntry(target)) return;
      if (event.key === 'Process' || event.key === 'Unidentified') return;      const special = specialKeys[event.key];
      if (special) { event.preventDefault(); void pressSpecial(special); return; }
      if (event.key.length === 1) { event.preventDefault(); appendText(event.key); }
    };
    let composing = false;
    const onCompositionStart = () => { composing = true; };
    const onCompositionEnd = (event: CompositionEvent) => {
      composing = false;
      if (replaying || event.target !== capture || !event.data) return;
      appendText(event.data);
      flushText();
      if (capture) capture.value = '';
    };
    const onInput = () => { if (!composing && capture) capture.value = ''; };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text');
      if (!text) return;
      event.preventDefault();
      appendText(text);
      flushText();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('compositionstart', onCompositionStart);
    window.addEventListener('compositionend', onCompositionEnd);
    window.addEventListener('pointerup', refocus);
    capture?.addEventListener('input', onInput);
    capture?.addEventListener('paste', onPaste);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('compositionstart', onCompositionStart);
      window.removeEventListener('compositionend', onCompositionEnd);
      window.removeEventListener('pointerup', refocus);
      capture?.removeEventListener('input', onInput);
      capture?.removeEventListener('paste', onPaste);
      capture?.blur();
      setTypingNotice('');
      if (keyFlushTimerRef.current !== null) { window.clearTimeout(keyFlushTimerRef.current); keyFlushTimerRef.current = null; }
    };
  }, [keyboard, session, replaying, picking, commitTyping, markTyping]);

  const runTask = async (label: string, task: () => Promise<void>) => { setBusy(label); setError(''); try { await task(); } catch (cause) { setError(errorText(locale, cause)); } finally { setBusy(''); } };
  const openHelp = () => {
    const help = window.open(locale === 'en-US' ? '/help.en.html' : '/help.html', '_blank', 'noopener,noreferrer');
    if (help) help.opener = null;
  };
  const refreshSourceTree = () => runTask(t('刷新控件树…'), async () => {
    if (!session) throw new Error(t('请先连接设备'));
    await window.studio.refreshSource();
  });
  const connect = () => runTask(t('正在建立 Appium 会话…'), async () => {
    const platform = config.platform;
    try {
      if (!config.deviceId) throw new Error(t('请选择设备或填写设备 UDID'));
      const chosen = devices.find((device) => device.id === config.deviceId);
      if (chosen && chosen.status !== 'device') {
        throw new Error(t('设备当前不可用（{status}）：请解锁手机、信任电脑并重新连接 USB，或选择在线设备', { status: chosen.status }));
      }
      setStreamStatus('loading');
      const created = await window.studio.createSession(config);
      // 会话建立后立刻抓一张首屏，手机画面挂载时就能显示，避免 scrcpy 黑首帧。
      const shot = await window.studio.screenshot().catch(() => null);
      setInitialShot(shot);
      setSession(created);
    } catch (cause) {
      const report = await window.studio.doctor().catch(() => null);
      if (report) {
        setDoctor(report);
        if (report.system) setSystem(report.system);
      }
      setConnectionFailure(buildConnectionDiagnostic(message(cause), report, platform, t));
      throw cause;
    }
  });
  const disconnect = () => runTask(t('正在断开…'), async () => { resetTyping(); await window.studio.closeSession(); setSession(null); setInitialShot(null); setStreamStatus('idle'); });
  const openAttachDialog = () => {
    setAttachUrl('http://127.0.0.1:4723');
    setAttachSessionId('');
    setAttachPlatform(config.platform);
    setAttachDeviceId('');
    setAttachMjpegPort('');
    setAttachError('');
    setAttachOpen(true);
  };
  const attachExisting = async () => {
    setAttachBusy(true);
    setAttachError('');
    try {
      const state = await window.studio.attachSession({
        appiumUrl: attachUrl.trim(),
        sessionId: attachSessionId.trim(),
        platform: attachPlatform,
        deviceId: attachDeviceId.trim() || undefined,
        mjpegPort: attachMjpegPort.trim() ? Number(attachMjpegPort) : undefined,
      });
      const shot = await window.studio.screenshot().catch(() => null);
      setConfig((old) => ({ ...old, platform: state.platform, deviceId: attachDeviceId.trim() || state.sessionId }));
      setSession(state);
      setInitialShot(shot);
      setStreamStatus(state.video === 'none' ? 'playing' : 'loading');
      setStreamNonce((value) => value + 1);
      setInspectorMode('target');
      setElementHighlight(null);
      setAttachOpen(false);
    } catch (cause) { setAttachError(message(cause)); }
    finally { setAttachBusy(false); }
  };

  const pickAt = async (clientX: number, clientY: number, element: HTMLElement) => {
    if (!session || busy) return;
    const rect = element.getBoundingClientRect();
    const x = Math.round((clientX - rect.left) / rect.width * session.width);
    const y = Math.round((clientY - rect.top) / rect.height * session.height);
    await runTask('读取控件定位…', async () => {
      const result = await window.studio.inspect(x, y);
      setPicked(result);
      setSelected(null);
      setEditLocator(null);
    });
  };
  const tapScreen = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!session || busy) return;
    if (picking) return;
    if (suppressTapRef.current) { suppressTapRef.current = false; return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) / rect.width * session.width);
    const y = Math.round((event.clientY - rect.top) / rect.height * session.height);
    await runTask('读取控件并点击…', async () => {
      await commitTyping();
      typedBufferRef.current = '';
      const result = await window.studio.tap(x, y, recording);
      if (recording) {
        if (isKeypadTarget(result.target)) {
          // 自绘数字键盘：把按键合并成输入步骤，回放时不依赖键盘是否展开。
          const snapshot = await window.studio.typingSnapshot().catch(() => null);
          if (snapshot?.target?.locator) {
            const secret = Boolean(snapshot.password) || isPasswordTarget(snapshot.target);
            const value = snapshot.value !== undefined && snapshot.value !== snapshot.placeholder ? snapshot.value : '';
            const inputStep: InputStep = { id: uid(), action: 'input', target: snapshot.target, value, clearFirst: true, secret, description: `输入「${maskInput(value)}」` };
            setSteps((old) => withInputStep(old, inputStep));
            setSelected(steps.length);
            return;
          }
        }
        const step: Step = { id: uid(), action: 'tap', target: result.target, description: `点击「${result.target.label || '坐标目标'}」` };
        setSteps((old) => [...old, step]);
        setSelected(steps.length);
        setPicked(null);
      }
    });
  };
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!session || busy || event.button !== 0) return;
    if (picking) { void pickAt(event.clientX, event.clientY, event.currentTarget); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: performance.now(), moved: false };
    suppressTapRef.current = false;
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 12) drag.moved = true;
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved || !session) return;
    suppressTapRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const toDevice = (clientX: number, clientY: number) => ({
      x: Math.max(0, Math.min(session.width, Math.round((clientX - rect.left) / rect.width * session.width))),
      y: Math.max(0, Math.min(session.height, Math.round((clientY - rect.top) / rect.height * session.height))),
    });
    const start = toDevice(drag.startX, drag.startY);
    const end = toDevice(event.clientX, event.clientY);
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.round(Math.hypot(deltaX, deltaY));
    if (distance < 12) return;
    const direction = Math.abs(deltaX) >= Math.abs(deltaY)
      ? deltaX < 0 ? 'left' : 'right'
      : deltaY < 0 ? 'up' : 'down';
    const duration = Math.max(100, Math.min(5000, Math.round(performance.now() - drag.startedAt)));
    void runTask('执行滑动…', async () => {
      await commitTyping();
      await window.studio.swipe(direction, duration, start, end);
      if (recording) setSteps((old) => [...old, { id: uid(), action: 'swipe', direction, duration, start, end, description: t('{direction}滑 {distance}px', { direction: t(directionName(direction)), distance }) }]);
    });
    setTimeout(() => { suppressTapRef.current = false; }, 0);
  };
  const cancelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const addInput = () => runTask('正在输入…', async () => {
    if (!selectedTarget?.locator) throw new Error('请先在步骤列表中选择一个带定位器的点击步骤');
    await commitTyping();
    typedBufferRef.current = '';
    await window.studio.input(selectedTarget, inputValue, true);
    if (recording) {
      const secret = isPasswordTarget(selectedTarget);
      setSteps((old) => [...old, { id: uid(), action: 'input', target: selectedTarget, value: inputValue, clearFirst: true, secret, description: `输入「${maskInput(inputValue)}」` }]);
    }
    setInputValue('');
  });
  const addGesture = (direction: 'up' | 'down' | 'left' | 'right') => runTask('执行滑动…', async () => {
    if (!session) throw new Error('请先连接设备');
    await commitTyping();
    const points = defaultSwipePoints(direction, session.width, session.height);
    const distance = Math.round(Math.hypot(points.end.x - points.start.x, points.end.y - points.start.y));
    await window.studio.swipe(direction, 520, points.start, points.end);
    if (recording) setSteps((old) => [...old, { id: uid(), action: 'swipe', direction, duration: 520, start: points.start, end: points.end, description: t('{direction}滑 {distance}px', { direction: t(directionName(direction)), distance }) }]);
  });
  const addBack = () => runTask('执行返回…', async () => { await commitTyping(); await window.studio.back(); if (recording) setSteps((old) => [...old, { id: uid(), action: 'back', description: '返回上一页' }]); });
  const runGesture = (gesture: 'doubleTap' | 'longPress' | 'pinchOut' | 'pinchIn') => runTask('执行手势…', async () => {
    if (!session) throw new Error('请先连接设备');
    const target = selectedTarget ?? undefined;
    if ((gesture === 'doubleTap' || gesture === 'longPress') && !target) throw new Error('请先在步骤列表中选择一个带目标的步骤');
    await commitTyping();
    const label = target?.label || target?.locator?.value || '屏幕中心';
    if (gesture === 'doubleTap') {
      await window.studio.doubleTap(target!);
      if (recording) { setSteps((old) => [...old, { id: uid(), action: 'doubleTap', target: target!, description: `双击「${label}」` }]); setSelected(steps.length); }
      return;
    }
    if (gesture === 'longPress') {
      await window.studio.longPress(target!, 800);
      if (recording) { setSteps((old) => [...old, { id: uid(), action: 'longPress', target: target!, duration: 800, description: `长按「${label}」` }]); setSelected(steps.length); }
      return;
    }
    const direction = gesture === 'pinchOut' ? 'out' : 'in';
    const scale = direction === 'out' ? 2 : 0.5;
    await window.studio.pinch({ target, direction, scale, duration: 600 });
    if (recording) {
      const step: Step = target
        ? { id: uid(), action: 'pinch', target, direction, scale, duration: 600, description: `双指${direction === 'out' ? '放大' : '缩小'}「${label}」` }
        : { id: uid(), action: 'pinch', direction, scale, duration: 600, description: `双指${direction === 'out' ? '放大' : '缩小'}屏幕中心` };
      setSteps((old) => [...old, step]);
      setSelected(steps.length);
    }
  });
  const appendAssertion = (target: Target | undefined, insertAt = steps.length) => {
    setError('');
    try {
      const stable = assertCondition === 'stable';
      if (!stable && !target) throw new Error('请先选择或拾取一个目标元素');
      if (!stable && !target?.locator) throw new Error('当前目标没有可用定位器，不能添加元素断言；可选择“页面稳定”');
      if (assertCondition === 'text' && !assertExpect) throw new Error('请填写期望文本');
      const label = target?.label || target?.locator?.value || '目标';
      const description = stable ? '等待页面稳定' : `${conditionNames[assertCondition]}：${label}${assertCondition === 'text' ? `（${assertExpect}）` : ''}`;
      const step: Step = {
        id: uid(),
        action: 'wait',
        description,
        condition: assertCondition,
        timeout: settings.timeout,
        ...(stable ? {} : { target: target! }),
        ...(assertCondition === 'text' ? { expect: assertExpect, match: assertMatch } : {}),
      };
      const index = Math.max(0, Math.min(steps.length, insertAt));
      setSteps((old) => {
        const next = [...old];
        next.splice(index, 0, step);
        return next;
      });
      setSelected(index);
      setPicked(null);
      setEditLocator(null);
    } catch (cause) { setError(message(cause)); }
  };
  const addAssertion = () => {
    let insertAt = steps.length;
    if (selected !== null) {
      insertAt = selected + 1;
      while (insertAt < steps.length && steps[insertAt].action === 'wait') insertAt++;
    }
    appendAssertion(selectedTarget ?? undefined, insertAt);
  };
  const addPickedAssertion = () => appendAssertion(picked?.target);
  const patchSelectedWait = (patch: Partial<Extract<Step, { action: 'wait' }>>) => {
    if (selected === null) return;
    setSteps((old) => old.map((step, index) => {
      if (index !== selected || step.action !== 'wait') return step;
      const next = { ...step, ...patch };
      if (next.condition !== undefined && next.condition !== 'text') {
        delete next.expect;
        delete next.match;
      }
      const label = next.target?.label || next.target?.locator?.value || '目标';
      const condition = next.condition ?? 'exists';
      next.description = condition === 'stable'
        ? '等待页面稳定'
        : `${conditionNames[condition]}：${label}${condition === 'text' && next.expect ? `（${next.expect}）` : ''}`;
      return next;
    }));
  };
  const chooseLocator = (locator: Locator) => {
    if (selected === null) return;
    setSteps((old) => old.map((step, index) => index === selected && 'target' in step
      ? { ...step, target: { ...step.target, locator } } as Step
      : step));
  };
  const verifySelected = () => runTask('校验定位器…', async () => {
    if (selected === null || !selectedTarget?.candidates?.length) throw new Error('当前步骤没有可校验的候选定位器');
    const verified = await window.studio.verifyTarget(selectedTarget);
    setSteps((old) => old.map((step, index) => index === selected && 'target' in step
      ? { ...step, target: verified } as Step
      : step));
  });
  const verifyPicked = () => runTask('校验定位器…', async () => {
    if (!picked) return;
    const verified = await window.studio.verifyTarget(picked.target);
    setPicked({ ...picked, target: verified });
  });
  const reanalyzeSelected = () => runTask('重新解析控件…', async () => {
    if (!session) throw new Error('请先连接设备');
    if (selected === null || !selectedTarget?.coordinate) throw new Error('当前步骤没有可用的记录坐标');
    const x = Math.round(selectedTarget.coordinate.xRatio * session.width);
    const y = Math.round(selectedTarget.coordinate.yRatio * session.height);
    const result = await window.studio.inspect(x, y);
    setSteps((old) => old.map((step, index) => index === selected && 'target' in step
      ? { ...step, target: result.target } as Step
      : step));
    setEditLocator(null);
  });
  const startEditLocator = (mode: 'step' | 'picked', target: Target) => {
    if (!target.locator) return;
    setEditLocator({ mode, strategy: target.locator.strategy, value: target.locator.value });
    setLabelEdit(null);
    setNoteEdit(null);
    setInputEdit(null);
  };
  const startEditLabel = (mode: 'step' | 'picked', target: Target) => {
    setLabelEdit({ mode, value: target.label ?? '' });
    setEditLocator(null);
    setNoteEdit(null);
    setInputEdit(null);
  };
  const startEditNote = (step: Step) => {
    setNoteEdit({ value: step.note ?? '' });
    setLabelEdit(null);
    setEditLocator(null);
    setInputEdit(null);
  };
  const applyNoteEdit = () => {
    if (!noteEdit || !selectedStep) return;
    const note = noteEdit.value.trim();
    const stepId = selectedStep.id;
    setSteps((old) => old.map((step) => step.id === stepId ? { ...step, note: note || undefined } as Step : step));
    setNoteEdit(null);
  };
  const startEditInput = (step: Extract<Step, { action: 'input' }>) => {
    setInputEdit({ stepId: step.id, value: step.value });
    setEditLocator(null);
    setLabelEdit(null);
    setNoteEdit(null);
  };
  const applyInputEdit = () => {
    if (!inputEdit) return;
    const { stepId, value } = inputEdit;
    setSteps((old) => old.map((step) => step.id === stepId && step.action === 'input'
      ? { ...step, value, description: `输入「${maskInput(value)}」` }
      : step));
    setInputEdit(null);
  };
  const moveStep = (from: number, to: number) => {
    if (from === to) return;
    setSteps((old) => {
      if (from < 0 || to < 0 || from >= old.length || to >= old.length) return old;
      const next = [...old];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    if (selected === from) setSelected(to);
    else if (selected !== null) {
      if (selected > from && selected <= to) setSelected(selected - 1);
      else if (selected < from && selected >= to) setSelected(selected + 1);
    }
    setReplay(null);
    setActivity(null);
    setActivityLog({});
  };
  const applyLabelEdit = () => {
    if (!labelEdit) return;
    const label = labelEdit.value.trim();
    if (!label) return;
    if (labelEdit.mode === 'step' && selected !== null) {
      setSteps((old) => old.map((step, index) => {
        if (index !== selected || !('target' in step) || !step.target) return step;
        const oldLabel = step.target.label ?? '';
        const description = oldLabel && step.description.includes(oldLabel)
          ? step.description.replaceAll(oldLabel, label)
          : step.description;
        return { ...step, description, target: { ...step.target, label } } as Step;
      }));
    } else if (labelEdit.mode === 'picked' && picked) {
      setPicked({ ...picked, target: { ...picked.target, label } });
    }
    setLabelEdit(null);
  };
  const applyLocatorEdit = (locator: Locator) => {
    if (!editLocator || !locator.value.trim()) return;
    if (editLocator.mode === 'step' && selected !== null) {
      setSteps((old) => old.map((step, index) => index === selected && 'target' in step
        ? { ...step, target: { ...step.target, locator, candidates: undefined, verifiedAt: undefined } } as Step
        : step));
    } else if (editLocator.mode === 'picked' && picked) {
      setPicked({ ...picked, target: { ...picked.target, locator, candidates: undefined, verifiedAt: undefined } });
    }
    setEditLocator(null);
  };
  const addPickedStep = () => {
    if (!picked) return;
    const label = picked.target.label || '目标';
    const step: Step = {
      id: uid(),
      action: 'tap',
      target: picked.target,
      description: picked.target.locator ? `点击「${label}」` : `坐标点击「${label}」 (${picked.x}, ${picked.y})`,
    };
    setSteps((old) => [...old, step]);
    setSelected(steps.length);
    setPicked(null);
    setEditLocator(null);
  };
  const debugStep = (step: Step) => runTask('正在调试当前步骤…', async () => {
    if (!session) throw new Error('请先连接设备');
    if (debuggingIdRef.current) throw new Error('已有调试正在执行');
    setPicked(null);
    setEditLocator(null);
    const wasRecording = recording;
    debuggingIdRef.current = step.id;
    setDebugResults((old) => ({ ...old, [step.id]: { stepId: step.id, status: 'running', activity: '准备执行…' } }));
    setRecording(false);
    try {
      await commitTyping();
      const report = await window.studio.replay({ ...script, steps: [step] });
      const result = report.results[0];
      const passed = result?.status === 'passed';
      setDebugResults((old) => ({ ...old, [step.id]: { stepId: step.id, status: passed ? 'passed' : 'failed', message: result?.message, duration: result?.duration } }));
      if (!passed) {
        const index = steps.findIndex((item) => item.id === step.id);
        setError(`调试${index >= 0 ? `第 ${index + 1} 步` : '当前步骤'}失败：${result?.message ?? '未知错误'}`);
      }
    } catch (cause) {
      setDebugResults((old) => ({ ...old, [step.id]: { stepId: step.id, status: 'failed', message: message(cause) } }));
      throw cause;
    } finally {
      debuggingIdRef.current = null;
      setRecording(wasRecording);
    }
  });
  const save = () => runTask('保存脚本…', async () => {
    const committed = await commitTyping();
    await window.studio.saveYaml(committed ? { ...script, steps: withInputStep(script.steps, committed) } : script);
  });
  const open = () => runTask('载入脚本…', async () => { const loaded = await window.studio.openYaml(); if (loaded) { resetTyping(); setSteps(loaded.steps); setConfig((old) => ({ ...old, platform: loaded.platform, deviceId: loaded.capabilities.udid ?? old.deviceId, app: loaded.capabilities.app, packageName: loaded.capabilities.appPackage, activity: loaded.capabilities.appActivity, bundleId: loaded.capabilities.bundleId, xcodeOrgId: loaded.capabilities.xcodeOrgId, xcodeSigningId: loaded.capabilities.xcodeSigningId, wdaBundleId: loaded.capabilities.wdaBundleId, allowProvisioning: loaded.capabilities.allowProvisioning === 'true' })); setSettings({ ...defaultReplaySettings, ...loaded.replay }); setProjectName(loaded.name); setSelected(null); setReplay(null); setActivity(null); setActivityLog({}); setDebugResults({}); setClearStage(0); setPicked(null); setEditLocator(null); } });
  const exportJs = () => runTask('导出 JavaScript…', async () => {
    const committed = await commitTyping();
    await window.studio.exportJavaScript(committed ? { ...script, steps: withInputStep(script.steps, committed) } : script);
  });
  const exportPython = () => runTask('导出 Python…', async () => {
    const committed = await commitTyping();
    await window.studio.exportPython(committed ? { ...script, steps: withInputStep(script.steps, committed) } : script);
  });
  const exportJava = () => runTask('导出 Java…', async () => {
    const committed = await commitTyping();
    await window.studio.exportJava(committed ? { ...script, steps: withInputStep(script.steps, committed) } : script);
  });
  const openSettings = () => {
    setExportOpen(false);
    setSettingsOpen(true);
    setSettingsConfig(loadAiConfig());
    setSettingsTesting(false);
    setSettingsNotice('');
    setSettingsError('');
  };
  useEffect(() => {
    const open = () => openSettings();
    window.addEventListener('echobench:open-settings', open);
    return () => window.removeEventListener('echobench:open-settings', open);
  }, []);
  const saveGlobalAiConfig = () => {
    setSettingsNotice('');
    setSettingsError('');
    try {
      const saved = saveAiConfig(settingsConfig);
      setSettingsConfig(saved);
      setAiConfig(saved);
      setSettingsNotice(t('设置已保存'));
      setSettingsOpen(false);
    } catch (cause) { setSettingsError(message(cause)); }
  };
  const testGlobalAiConfig = async () => {
    setSettingsTesting(true);
    setSettingsNotice('');
    setSettingsError('');
    try {
      const config = normalizeAiConfig(settingsConfig);
      const result = await window.studio.testAiConnection(config);
      if (result.ok) {
        const detail = result.message && !/^ok$/i.test(result.message.trim()) ? ` · ${result.message}` : '';
        setSettingsNotice(t('连接成功 · {model} · {latency} ms{detail}', { model: result.model, latency: result.latency, detail }));
      } else {
        setSettingsError(t('连接失败：{message}', { message: result.message }));
      }
    } catch (cause) { setSettingsError(message(cause)); }
    finally { setSettingsTesting(false); }
  };
  const openAiDialog = () => {
    setExportOpen(false);
    setAiOpen(true);
    setAiConfig(loadAiConfig());
    setAiTitle(projectName);
    setAiBusy(false);
    setAiError('');
    setAiNotice('');
  };
  const editAiConfigFromDialog = () => {
    setAiOpen(false);
    openSettings();
  };
  const exportAiCase = async () => {
    setAiBusy(true);
    setAiError('');
    setAiNotice('');
    try {
      if (!aiTitle.trim()) throw new Error(t('请填写用例标题'));
      const config = normalizeAiConfig(loadAiConfig());
      setAiConfig(config);
      const committed = await commitTyping();
      const current = committed ? { ...script, steps: withInputStep(script.steps, committed) } : script;
      const filename = await window.studio.exportAiCase(current, config, aiTitle.trim());
      if (filename) setAiNotice(t('已导出 {filename}', { filename }));
    } catch (cause) { setAiError(errorText(locale, cause)); }
    finally { setAiBusy(false); }
  };
  const openDoctor = async () => {
    setDoctorOpen(true);
    setDoctorBusy(true);
    setError('');
    setInstallNotice('');
    setInstallError('');
    try {
      const report = await window.studio.doctor();
      setDoctor(report);
      if (report.system) setSystem(report.system);
    } catch (cause) { setError(message(cause)); }
    finally { setDoctorBusy(false); }
  };
  const installDependency = async (id: string) => {
    if (installing) return;
    const name = doctor?.checks.find((check) => check.id === id)?.name ?? id;
    setInstalling(id);
    setInstallNotice(t('正在安装 {name}…', { name }));
    setInstallError('');
    try {
      const result = await window.studio.installDependency(id);
      if (result.ok) setInstallNotice(t('{name} 安装完成', { name }));
      else if (result.manual) setInstallNotice(t('{name} 需要手动完成：{manual}', { name, manual: result.manual }));
      else {
        setInstallNotice('');
        setInstallError(t('{name} 安装未完成{restart}', {
          name,
          restart: result.needsRestart ? t('，请重启应用后重新检查') : t('，请查看运行日志'),
        }));
      }
      const report = await window.studio.doctor();
      setDoctor(report);
      if (report.system) setSystem(report.system);
    } catch (cause) {
      setInstallNotice('');
      setInstallError(message(cause));
    }
    finally { setInstalling(''); }
  };
  const installAllDependencies = async () => {
    const targets = doctor?.checks.filter((check) => check.installable && check.status !== 'ok') ?? [];
    for (const check of targets) await installDependency(check.id);
  };
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const info = await window.studio.system();
          if (cancelled) return;
          setSystem(info);
          const report = await window.studio.doctor();
          if (cancelled) return;
          setDoctor(report);
          const candidates = autoInstallCandidates(report);
          if (candidates === null || candidates.length === 0) {
            if (report.checks.some((check) => check.required && check.status !== 'ok')) setDoctorOpen(true);
            return;
          }
          setDoctorOpen(true);
          try {
            const lastAttempt = Number(localStorage.getItem('echobench:auto-install-at') ?? localStorage.getItem('app-step-studio:auto-install-at') ?? 0);
            if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 10 * 60 * 1000) return;
            localStorage.setItem('echobench:auto-install-at', String(Date.now()));
            localStorage.removeItem('app-step-studio:auto-install-at');
          } catch { /* 忽略存储异常；无法记录时仍允许本次自动安装。 */ }
          setInstallNotice(t('检测到缺少 {count} 项基础依赖，正在自动安装；首次安装可能需要几分钟…', { count: candidates.length }));
          for (const id of candidates) await installDependency(id);
        } catch { /* 环境检查失败不阻塞录制，用户仍可手动打开体检。 */ }
      })();
    }, 600);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);
  const openLogs = async () => {
    setLogsOpen(true);
    setError('');
    try {
      const report = await window.studio.logs(500);
      setLogs(report.lines);
      setLogPath(report.path);
    } catch (cause) { setError(message(cause)); }
  };
  const requestClear = () => {
    if (!steps.length || replaying || busy) return;
    setClearStage(1);
  };
  const clearRecord = () => {
    if (!steps.length || replaying || busy) return;
    resetTyping();
    setSteps([]);
    setSelected(null);
    setReplay(null);
    setActivity(null);
    setActivityLog({});
    setDebugResults({});
    setRestoredAt(null);
    setRecording(false);
    setClearStage(0);
    setPicked(null);
    setEditLocator(null);
    clearDraft();
  };
  const deleteSelected = () => {
    if (selected === null) return;
    const stepId = steps[selected]?.id;
    setSteps((old) => old.filter((_, index) => index !== selected));
    setSelected(null);
    setReplay(null);
    setActivity(null);
    setActivityLog({});
    setEditLocator(null);
    if (stepId) setDebugResults((old) => { const next = { ...old }; delete next[stepId]; return next; });
  };
  const play = (startIndex = 0) => runTask(startIndex > 0 ? t('从第 {step} 步开始回放…', { step: startIndex + 1 }) : t('正在回放…'), async () => {
    if (!session) throw new Error(t('请先连接设备'));
    const committed = await commitTyping();
    const replayed = committed ? { ...script, steps: withInputStep(script.steps, committed) } : script;
    if (replayed.steps.length === 0) throw new Error(t('没有可回放的步骤'));
    const start = Math.max(0, Math.min(startIndex, replayed.steps.length - 1));
    const wasRecording = recording;
    replayActiveRef.current = true;
    setPicking(false);
    setPicked(null);
    setEditLocator(null);
    setDebugResults({});
    setReplay({ total: replayed.steps.length, startIndex: start, startedAt: Date.now(), status: 'running', results: {} });
    setActivity(null);
    setActivityAt(0);
    setActivityLog({});
    setRecording(false);
    try {
      const report = await window.studio.replay(replayed, start);
      setReplay({ total: report.results.length, startIndex: report.startIndex ?? start, startedAt: report.startedAt, finishedAt: report.finishedAt, duration: report.duration, status: report.status, results: Object.fromEntries(report.results.map((result) => [result.index, result])) });
      if (report.status === 'failed') {
        const failed = report.results.find((result) => result.status === 'failed');
        const hint = failed?.index === start ? t('；请确认设备已处于该步骤开始前的页面状态，必要时点“刷新控件树”后重试') : '';
        setError(failed ? t('第 {step} 步失败：{message}{hint}', { step: failed.index + 1, message: failed.message ?? t('未知错误'), hint }) : t('回放失败'));
      }
    } finally {
      replayActiveRef.current = false;
      setRecording(wasRecording);
    }
  });

  return <main className="studio">
    <textarea ref={captureRef} className="keyboard-capture" tabIndex={-1} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" />
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><EchoMark /></span><div><strong>ECHOBENCH</strong><span>MOBILE TEST STUDIO</span></div>{appInfo && <span className="brand-version" title={appInfo.releaseUrl}>v{appInfo.version}</span>}</div>
      <div className="project-title"><span>{t('当前项目')}</span><b>{projectName}</b><i className={session ? 'online' : ''}>{session ? t('设备已连接') : t('等待设备')}</i></div>
      <div className="toolbar">
        <button className="multi-entry" onClick={() => setMultiOpen(true)} title={t('多台设备实时画面与同步操作')}>
          <MonitorSmartphone /><span>{t('多端同步')}</span><em>{t('{count} 台在线', { count: onlineDeviceCount })}</em>
        </button>
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <button onClick={open} title={t('载入脚本')}><FolderOpen />{t('载入')}</button><button onClick={save} disabled={!steps.length} title={t('保存脚本')}><Save />{t('保存 YAML')}</button>
        </div>
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <button onClick={openAiDialog} title={t('使用全局 AI 配置导出 CSV 测试用例')}><Sparkles />{t('AI 用例')}</button>
          <button onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')} title={locale === 'zh-CN' ? 'Switch to English' : '切换到中文'}><Languages />{locale === 'zh-CN' ? 'EN' : '中文'}</button>
          <button onClick={openSettings} title={t('全局设置')}><Settings2 />{t('设置')}</button>
        </div>
        <span className="toolbar-sep" />
        <div className="toolbar-group">
          <div className="export-menu" onMouseLeave={() => setExportOpen(false)}>
            <button className="export-toggle" onClick={() => setExportOpen(!exportOpen)} disabled={!steps.length} title={t('导出脚本为 WebdriverIO、Python 或 Java')}><Code2 />{t('导出脚本')}<ChevronDown /></button>
            {exportOpen && <div className="export-list">
              <button onClick={() => { setExportOpen(false); void exportJs(); }} disabled={!steps.length}>WebdriverIO JS</button>
              <button onClick={() => { setExportOpen(false); void exportPython(); }} disabled={!steps.length}>Python (Appium)</button>
              <button onClick={() => { setExportOpen(false); void exportJava(); }} disabled={!steps.length}>Java (Appium)</button>
            </div>}
          </div>
          <button onClick={() => void openLogs()} title={t('查看运行日志和 Appium/WDA 报错')}><FileText />{t('日志')}</button>
          <button onClick={() => void openDoctor()} title={t('检查应用运行所需的系统和移动设备环境')}><Stethoscope />{t('体检')}</button>
          <button onClick={openHelp} title={t('查看 Windows、macOS、Linux 的安装与配置帮助')}><CircleHelp />{t('帮助')}</button>
        </div>
        <span className="toolbar-sep" />
        <button className="play" onClick={() => play(0)} disabled={!steps.length || !session || Boolean(busy)} title={t('回放当前录制步骤')}><Play />{t('回放')}</button>
      </div>
    </header>

    <section className="workspace" style={{ '--steps-width': `${layout.steps}px`, '--inspector-width': `${layout.inspector}px` } as unknown as React.CSSProperties}>
      <aside className="device-panel panel">
        <PanelTitle index="01" title={t('设备与应用')} icon={<Smartphone />} />
        <div className="platform-switch"><button className={config.platform === 'android' ? 'active' : ''} onClick={() => setConfig((old) => ({ ...old, platform: 'android', deviceId: devices.find((d) => d.platform === 'android' && d.status === 'device')?.id ?? old.deviceId }))}>ANDROID</button><button className={config.platform === 'ios' ? 'active' : ''} disabled={!iosSupported} title={iosSupported ? undefined : t('当前操作系统不支持 iOS 自动化，仅 macOS 支持')} onClick={() => setConfig((old) => ({ ...old, platform: 'ios', deviceId: devices.find((d) => d.platform === 'ios' && d.status === 'device')?.id ?? old.deviceId, xcodeSigningId: old.xcodeSigningId || 'Apple Development' }))}>iOS</button></div>
        {system && !system.capabilities.ios && <p className="platform-warning">{t('当前系统为 {os}，仅支持 Android 自动化；iOS 相关功能已禁用。', { os: system.osName })}</p>}
        <label>{t('设备')}<select value={config.deviceId} onChange={(e) => setConfig({ ...config, deviceId: e.target.value })}><option value="">{t('选择或输入 UDID')}</option>{filteredDevices.map((d) => <option key={d.id} value={d.id} disabled={d.status !== 'device'}>{d.name} · {d.status}</option>)}</select></label>
        <div className="device-scan-meta">
          <span className="scan-dot" />
          <span>{t('自动发现 · {count} 台在线', { count: onlineDeviceCount })}</span>
          {lastDeviceScan && <em>{new Date(lastDeviceScan).toLocaleTimeString()}</em>}
        </div>
        {currentDeviceMissing && <p className="device-warning">{t('当前设备已离线或已拔出，请重新连接设备，或点击“发现设备”后选择其他设备。')}</p>}
        <label>{t('设备 UDID')}<input value={config.deviceId} onChange={(e) => setConfig({ ...config, deviceId: e.target.value })} placeholder="emulator-5554 / iPhone UDID" /></label>
        <label>{t('应用路径（可选）')}<input value={config.app ?? ''} onChange={(e) => setConfig({ ...config, app: e.target.value })} placeholder="/path/to/app.apk" /></label>
        {config.platform === 'android' ? <><label>APP PACKAGE<input value={config.packageName ?? ''} onChange={(e) => setConfig({ ...config, packageName: e.target.value })} placeholder="com.example.app" /></label><label>APP ACTIVITY<input value={config.activity ?? ''} onChange={(e) => setConfig({ ...config, activity: e.target.value })} placeholder=".MainActivity" /></label></> : <>
          <label>{t('BUNDLE ID')}<input value={config.bundleId ?? ''} disabled={iosBlocked} onChange={(e) => setConfig({ ...config, bundleId: e.target.value })} placeholder="com.example.app" /></label>
          <label>{t('XCODE TEAM ID')}<input value={config.xcodeOrgId ?? ''} disabled={iosBlocked} onChange={(e) => setConfig({ ...config, xcodeOrgId: e.target.value })} placeholder="9M49ULVKP2" /></label>
          <label>{t('签名身份')}<input value={config.xcodeSigningId ?? ''} disabled={iosBlocked} onChange={(e) => setConfig({ ...config, xcodeSigningId: e.target.value })} placeholder="Apple Development" /></label>
          <label>{t('WDA BUNDLE ID')}<input value={config.wdaBundleId ?? ''} disabled={iosBlocked} onChange={(e) => setConfig({ ...config, wdaBundleId: e.target.value })} placeholder="com.example.WebDriverAgentRunner" /></label>
          <label className="switch inline-switch" title={t('允许 Xcode 自动注册设备并更新签名')}><input type="checkbox" checked={Boolean(config.allowProvisioning)} disabled={iosBlocked} onChange={(e) => setConfig({ ...config, allowProvisioning: e.target.checked })} />{t('自动注册设备/签名')}</label>
          <p className="hint">{t('iOS 真机必须填写 Team ID，并在 Xcode 登录对应 Apple 账号；模拟器可以留空。')}</p>
        </>}
        {iosBlocked && <p className="platform-warning">{t('当前操作系统不支持 iOS 自动化，请切换到 Android，或改用 macOS。')}</p>}
        <div className="connect-row"><button className="primary" onClick={session ? disconnect : connect} disabled={!session && iosBlocked} title={!session && iosBlocked ? t('当前操作系统不支持 iOS 自动化') : undefined}>{session ? <><Unplug />{session.attached ? t('脱离会话') : t('断开设备')}</> : <><Radio />{t('连接设备')}</>}</button><button className="discover" onClick={() => void refreshDevices(true)} disabled={discoveringDevices} title={t('立即扫描 USB 和局域网设备')}><RefreshCw className={discoveringDevices ? 'spin' : ''} />{discoveringDevices ? t('发现中…') : t('发现设备')}</button></div>
        <button className="attach-session" onClick={openAttachDialog} disabled={Boolean(busy)}><MonitorSmartphone />{t('附加已有 Appium 会话')}</button>
        <div className="divider" />
        <PanelTitle index="02" title={t('动作控制')} icon={<Send />} />
        <div className="input-action"><input value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && inputValue && !busy) { event.preventDefault(); void addInput(); } }} placeholder={t('选择目标后输入文本')} /><button onClick={addInput} disabled={!session || !inputValue}><ChevronRight /></button></div>
        <div className="dpad"><button onClick={() => addGesture('up')}><ArrowUp /></button><button onClick={() => addGesture('left')}><ArrowLeft /></button><button className="back" onClick={addBack}><Undo2 /></button><button onClick={() => addGesture('right')}><ArrowRight /></button><button onClick={() => addGesture('down')}><ArrowDown /></button></div>
        <div className="gesture-row">
          <button onClick={() => void runGesture('doubleTap')} disabled={!session || !selectedTarget} title={t('双击当前选中步骤的目标')}><MousePointerClick />{t('双击')}</button>
          <button onClick={() => void runGesture('longPress')} disabled={!session || !selectedTarget} title={t('长按当前选中步骤的目标')}><Hand />{t('长按')}</button>
          <button onClick={() => void runGesture('pinchOut')} disabled={!session} title={t('双指放大，优先作用于选中目标')}><ZoomIn />{t('放大')}</button>
          <button onClick={() => void runGesture('pinchIn')} disabled={!session} title={t('双指缩小，优先作用于选中目标')}><ZoomOut />{t('缩小')}</button>
        </div>
        <button className={`pick-toggle ${picking ? 'active' : ''}`} onClick={() => { setPicking(!picking); if (picking) { setPicked(null); setEditLocator(null); } }} disabled={!session} title={t('开启后点击设备画面只读取控件定位器，不会操作设备')}>
          <Crosshair />{picking ? t('拾取中：点击画面读取定位') : t('开启元素拾取（不操作设备）')}
        </button>
        <button className="source-refresh" onClick={() => void refreshSourceTree()} disabled={!session || Boolean(busy)} title={t('iOS 页面切换后请刷新控件树，保证新页面定位器准确')}>
          <RefreshCw />{t('刷新控件树')}
        </button>
        {config.platform === 'ios' && <p className="hint">{t('录制点击时会在上一操作后自动刷新控件树，并用 Appium 实时校验主定位器；极少数动态页面仍可手动“刷新控件树”后重新拾取。')}</p>}
        <p className="hint">{t('点击设备画面会解析稳定控件定位器；按住并拖动会执行滑动并记录实际轨迹。先选中一个步骤，再用「双击/长按/放大/缩小」补齐手势。')}</p>
      </aside>

      <section className="mirror-panel panel">
        <div className="mirror-head"><PanelTitle index="03" title={t('实时设备画面')} icon={<Radio />} /><button onClick={refresh} disabled={!session}><RefreshCw />{session?.video === 'none' ? t('刷新截图') : t('重连画面')}</button></div>
        <div className="stage">
          <div className="grid-lines" />
          {session ? <div className="phone" style={{ aspectRatio: `${session.width} / ${session.height}`, '--phone-ratio': String(session.width / session.height) } as unknown as React.CSSProperties}>
            <div className="speaker" />
            {session.video === 'none'
              ? initialShot ? <img className="static-mirror" src={`data:image/png;base64,${initialShot}`} alt={t('附加会话截图')} draggable={false} /> : <div className="static-mirror-empty"><RefreshCw /><span>{t('附加会话暂无截图')}</span><button onClick={() => void refresh()} disabled={Boolean(busy)}>{t('刷新截图')}</button></div>
              : session.platform === 'android'
                ? <AndroidVideo key={`android-${streamNonce}`} nonce={streamNonce} initialShot={initialShot} setStreamStatus={setStreamStatus} setError={setError} />
                : <IosVideo key={`ios-${streamNonce}`} nonce={streamNonce} setStreamStatus={setStreamStatus} setError={setError} />}
            <div className={`touch-layer ${picking ? 'picking' : ''}`} onClick={tapScreen} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
            {picked?.target.bounds && <div className="pick-box" style={{ left: `${picked.target.bounds.x / session.width * 100}%`, top: `${picked.target.bounds.y / session.height * 100}%`, width: `${picked.target.bounds.width / session.width * 100}%`, height: `${picked.target.bounds.height / session.height * 100}%` }} />}
            {elementHighlight && <div className="element-highlight" style={{ left: `${elementHighlight.x / session.width * 100}%`, top: `${elementHighlight.y / session.height * 100}%`, width: `${elementHighlight.width / session.width * 100}%`, height: `${elementHighlight.height / session.height * 100}%` }} />}
            {picking && <div className="pick-hint"><Crosshair />{t('元素拾取中 · 点击画面只读取定位器')}</div>}
            {streamStatus !== 'playing' && <div className="stream-state"><RefreshCw />{streamStatus === 'failed' ? t('视频流连接失败，请重连画面') : t('正在连接实时视频流…')}</div>}
          </div> : <div className="empty-device"><Smartphone /><b>{t('尚未连接设备')}</b><span>{t('选择 {platform} 设备后建立 Appium 会话', { platform: iosSupported ? 'Android / iOS' : 'Android' })}</span></div>}
          {replaying && runningStep
            ? <div className="replay-hud">
                <div className="replay-hud-head"><span>{replay?.startIndex ? t('从第 {step} 步', { step: replay.startIndex + 1 }) : t('正在执行')}</span><b>{String(executedDone).padStart(2, '0')} / {String(executedTotal).padStart(2, '0')}</b></div>
                <p>{t(actionNames[runningStep.action])} · {runningStep.description}</p>
                {activeActivity && <div className="replay-activity"><RefreshCw /><span>{activeActivity.message}</span><em>{formatDuration(activityElapsed)}</em></div>}
                <div className="replay-bar"><i style={{ width: `${(executedDone / Math.max(1, executedTotal)) * 100}%` }} /></div>
              </div>
            : busy && <div className="busy"><RefreshCw />{busy}</div>}
          {typingNotice && <div className="typing-notice">{typingNotice}</div>}
        </div>
        <div className="statusbar">
          <span><i className={session ? 'green' : ''} />{session ? `${session.platform.toUpperCase()} · ${session.width} × ${session.height}` : 'OFFLINE'}</span>
          <div className="status-actions">
            <button className={picking ? 'picking' : ''} onClick={() => { setPicking(!picking); if (picking) { setPicked(null); setEditLocator(null); } }} disabled={!session} title={t('开启后点击设备画面只读取控件定位器，不会操作设备')}><Crosshair />{picking ? t('拾取中') : t('元素拾取')}</button>
            <button className={keyboard ? 'keyboard' : ''} onClick={() => setKeyboard(!keyboard)} disabled={!session} title={t('开启后可以直接用电脑键盘向设备输入')}><Keyboard />{keyboard ? t('键盘已开启') : t('键盘输入')}</button>
            <button className={recording ? 'recording' : ''} onClick={() => { const next = !recording; setRecording(next); if (next && session) void window.studio.refreshSource().catch((cause) => setError(errorText(locale, cause))); }}>{recording ? <CircleStop /> : <Radio />}{recording ? t('停止记录') : t('开始记录')}</button>
          </div>
        </div>
      </section>

      <aside className="steps-panel panel">
        <ColumnResizer width={layout.steps} min={layoutLimits.steps.min} max={maxStepsWidth} onChange={(steps) => setLayout((old) => ({ ...old, steps }))} onReset={() => setLayout((old) => ({ ...old, steps: defaultLayout.steps }))} label={t('调整步骤时间线宽度')} />
        <PanelTitle index="04" title={t('步骤时间线')} icon={<FileInput />} />
        <div className="steps-count"><b>{String(steps.length).padStart(2, '0')}</b><span>{t('已记录步骤')}</span><button className="clear-record" onClick={requestClear} disabled={!steps.length || replaying || Boolean(busy)} title={t('清空当前记录并删除本地缓存')}><Trash2 />{t('清空')}</button></div>
        {restoredAt && <div className="draft-note"><RefreshCw /><span>{t('已恢复 {time} 的缓存记录', { time: new Date(restoredAt).toLocaleTimeString() })}</span><button onClick={() => setRestoredAt(null)}>{t('知道了')}</button></div>}
        <details className="replay-settings">
          <summary><Settings2 />{t('回放策略')}<em>{t('默认等待 {seconds}s · 重试 {retries}', { seconds: Math.round(settings.timeout / 1000), retries: settings.retries })}</em></summary>
          <div className="replay-settings-grid">
            <label title={t('单个步骤等待控件/条件就绪的总上限，包含重试时间')}>{t('单步等待上限（秒）')}<input type="number" min={1} max={120} value={Math.round(settings.timeout / 1000)} disabled={replaying} onChange={(event) => setSettings({ ...settings, timeout: clampNumber(event.target.value, 1, 120) * 1000 })} /></label>
            <label title={t('仅用于输入/校验等可安全重试的动作失败；元素等待本身会持续轮询到上限')}>{t('动作重试次数')}<input type="number" min={0} max={10} value={settings.retries} disabled={replaying} onChange={(event) => setSettings({ ...settings, retries: clampNumber(event.target.value, 0, 10) })} /></label>
            <label>{t('重试间隔（毫秒）')}<input type="number" min={0} max={10000} step={100} value={settings.retryDelay} disabled={replaying} onChange={(event) => setSettings({ ...settings, retryDelay: clampNumber(event.target.value, 0, 10000) })} /></label>
            <label className="switch"><input type="checkbox" checked={settings.settle} disabled={replaying} onChange={(event) => setSettings({ ...settings, settle: event.target.checked })} />{t('页面稳定等待')}</label>
            <label className="switch" title={t('定位器找不到时是否点击记录的相对坐标（默认关闭，避免误点其他页面）')}><input type="checkbox" checked={settings.coordinateFallback} disabled={replaying} onChange={(event) => setSettings({ ...settings, coordinateFallback: event.target.checked })} />{t('坐标兜底')}</label>
            <label className="switch" title={t('主定位失效时自动尝试录制时已验证唯一的候选定位器')}><input type="checkbox" checked={settings.locatorFallback} disabled={replaying} onChange={(event) => setSettings({ ...settings, locatorFallback: event.target.checked })} />{t('候选降级')}</label>
            <label className="switch" title={t('回放前检查脚本配置的应用是否在前台')}><input type="checkbox" checked={settings.requireApp} disabled={replaying} onChange={(event) => setSettings({ ...settings, requireApp: event.target.checked })} />{t('校验前台应用')}</label>
            <label className="switch"><input type="checkbox" checked={settings.stopOnFailure} disabled={replaying} onChange={(event) => setSettings({ ...settings, stopOnFailure: event.target.checked })} />{t('失败即停')}</label>
          </div>
        </details>
        {replay && <div className={`replay-summary ${replay.status}`}>
          <span>{replay.status === 'running' ? t('回放中') : replay.status === 'failed' ? t('回放失败') : t('回放完成')}</span>
          <b>{passedCount} / {executedTotal}</b>
          <em>{replay.status === 'running'
            ? `${replay.startIndex ? `${t('从第 {step} 步', { step: replay.startIndex + 1 })} · ` : ''}${activeActivity?.message ?? (runningIndex !== null && runningStep ? t('正在执行 {step}：{description}', { step: runningIndex + 1, description: runningStep.description }) : t('准备执行…'))}`
            : replay.status === 'failed' && failedResult ? t('第 {step} 步失败{retry}：{message}', { step: failedResult.index + 1, retry: failedResult.retried ? t('（重试 {count} 次）', { count: failedResult.retried }) : '', message: failedResult.message ?? t('未知错误') })
            : `${replay.startIndex ? `${t('从第 {step} 步', { step: replay.startIndex + 1 })} · ` : ''}${t('耗时 {duration}', { duration: formatDuration(replay.duration) })}${totalRetries ? t(' · 重试 {count} 次', { count: totalRetries }) : ''}`}</em>
        </div>}
        <div className="timeline">{steps.length ? steps.map((step, index) => {
          const result = replayResults[index];
          const debug = debugResults[step.id];
          const warning = 'target' in step ? step.target?.warning : undefined;
          return <button
            key={step.id}
            ref={(element) => { stepRefs.current[index] = element; }}
            draggable={!replaying && !busy}
            className={`step ${selected === index ? 'selected' : ''} ${result?.status ?? ''} ${runningIndex === index ? 'current' : ''} ${dragIndex === index ? 'dragging' : ''} ${dragOverIndex === index && dragIndex !== null ? 'drag-over' : ''}`}
            title={[debug?.message ?? result?.message, warning, t('拖动可排序')].filter(Boolean).join(' · ')}
            onClick={() => { setSelected(index); setPicked(null); setEditLocator(null); setNoteEdit(null); }}
            onDragStart={(event) => { if (replaying || busy) { event.preventDefault(); return; } setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
            onDragOver={(event) => { if (dragIndex === null) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverIndex(index); }}
            onDrop={(event) => { event.preventDefault(); if (dragIndex !== null) moveStep(dragIndex, index); setDragIndex(null); setDragOverIndex(null); }}
            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
          ><span className="step-index">{String(index + 1).padStart(2, '0')}</span><span className="step-body"><span className="step-title"><GripVertical /><b>{t(actionNames[step.action])}</b></span><small>{localizeGeneratedText(locale, step.description)}</small>{warning && <small className="step-warning">{t('定位风险')}</small>}{step.note && <small className="step-note">{t('备注：{note}', { note: step.note })}</small>}{debug ? <em className={debug.status}>{t('调试 · {status}', { status: debugLabel(debug, t) })}</em> : result && <em className={result.status}>{runningIndex === index && activeActivity ? activeActivity.message : resultLabel(result, t)}</em>}</span><i /></button>;
        }) : <div className="empty-steps">{t('操作设备后，步骤会出现在这里。')}</div>}</div>
      </aside>

      <aside className="inspector-panel panel">
        <ColumnResizer width={layout.inspector} min={layoutLimits.inspector.min} max={maxInspectorWidth} onChange={(inspector) => setLayout((old) => ({ ...old, inspector }))} onReset={() => setLayout((old) => ({ ...old, inspector: defaultLayout.inspector }))} label={t('调整目标检查器宽度')} />
        <PanelTitle index="05" title={t('目标检查器')} icon={<MousePointerClick />} />
        <div className="inspector-tabs">
          <button className={inspectorMode === 'target' ? 'active' : ''} onClick={() => { setInspectorMode('target'); setElementHighlight(null); }}>{t('目标')}</button>
          <button className={inspectorMode === 'tree' ? 'active' : ''} disabled={!session} onClick={() => setInspectorMode('tree')}>{t('元素树')}</button>
        </div>
        {inspectorMode === 'tree' ? <ElementTreePanel session={session} onHighlight={setElementHighlight} /> : <>
        {picked ? <div className="inspector-body">
          <div className="inspector-head">
            <b>{t('拾取结果 · {label}', { label: picked.target.label || t('目标') })}</b>
            <div className="inspector-actions">
              <button title={t('编辑定位器')} onClick={() => startEditLocator('picked', picked.target)} disabled={!picked.target.locator || Boolean(busy)}><Pencil /></button>
              <button title={t('清除拾取结果')} onClick={() => { setPicked(null); setEditLocator(null); }}><XCircle /></button>
            </div>
          </div>
          {editLocator?.mode === 'picked' ? <LocatorEditor value={editLocator} onApply={applyLocatorEdit} onCancel={() => setEditLocator(null)} /> : <>
            {picked.target.locator ? <>
              <KeyValue name={t('策略')} value={picked.target.locator.strategy} />
              <KeyValue name={t('定位值')} value={picked.target.locator.value} copy={picked.target.locator.value} />
            </> : <KeyValue name={t('定位')} value={t('仅坐标（未找到语义节点）')} />}
            {labelEdit?.mode === 'picked'
              ? <LabelEditor value={labelEdit.value} onChange={(value) => setLabelEdit({ mode: 'picked', value })} onApply={applyLabelEdit} onCancel={() => setLabelEdit(null)} />
              : <KeyValue name={t('标签')} value={picked.target.label ?? '—'} copy={picked.target.label} onEdit={() => startEditLabel('picked', picked.target)} />}
            <KeyValue name={t('坐标')} value={`${picked.x}, ${picked.y}`} />
            {picked.target.warning && <p className="target-warning">{picked.target.warning}</p>}
            {!picked.target.locator && <p className="pick-warning">{t('该元素未出现在无障碍控件树中（可能是自定义绘制或未设置 contentDescription），Appium 无法生成语义定位器，只能按坐标点击。可以先编辑标签，再添加为坐标点击步骤；如需稳定定位器，请让开发补充 contentDescription 或 resource-id。')}</p>}
            {session && <AssertionBar
              condition={assertCondition}
              expect={assertExpect}
              match={assertMatch}
              onCondition={setAssertCondition}
              onExpect={setAssertExpect}
              onMatch={setAssertMatch}
              onAdd={addPickedAssertion}
              busy={Boolean(busy)}
            />}
            <div className="picked-actions">
              <button className="primary" onClick={addPickedStep}><Play />{picked.target.locator ? t('添加为点击步骤') : t('添加为坐标点击步骤')}</button>
              <button onClick={() => { setPicked(null); setEditLocator(null); }}>{t('关闭结果')}</button>
            </div>
            {picked.target.candidates?.length ? <CandidateList target={picked.target} busy={Boolean(busy)} onChoose={(locator) => setPicked({ ...picked, target: { ...picked.target, locator } })} onVerify={verifyPicked} /> : null}
          </>}
        </div> : selectedStep ? <div className="inspector-body">
          <div className="inspector-head">
            <b>{localizeGeneratedText(locale, selectedStep.description)}</b>
            <div className="inspector-actions">
              <button title={t('按记录坐标重新识别元素')} onClick={() => void reanalyzeSelected()} disabled={!session || !selectedTarget?.coordinate || Boolean(busy)}><Crosshair /></button>
              <button title={t('编辑定位器')} onClick={() => selectedTarget && startEditLocator('step', selectedTarget)} disabled={!selectedTarget?.locator || Boolean(busy)}><Pencil /></button>
              <button title={t('关闭检查器')} onClick={() => setSelected(null)}><XCircle /></button>
              <button title={t('删除此步骤')} onClick={deleteSelected}><Trash2 /></button>
            </div>
          </div>
          {editLocator?.mode === 'step' ? <LocatorEditor value={editLocator} onApply={applyLocatorEdit} onCancel={() => setEditLocator(null)} /> : selectedTarget ? <>
            <KeyValue name={t('策略')} value={selectedTarget.locator?.strategy ?? t('相对坐标')} />
            <KeyValue name={t('定位值')} value={selectedTarget.locator?.value ?? `${selectedTarget.coordinate?.xRatio}, ${selectedTarget.coordinate?.yRatio}`} copy={selectedTarget.locator?.value} />
            {labelEdit?.mode === 'step'
              ? <LabelEditor value={labelEdit.value} onChange={(value) => setLabelEdit({ mode: 'step', value })} onApply={applyLabelEdit} onCancel={() => setLabelEdit(null)} />
              : <KeyValue name={t('标签')} value={selectedTarget.label ?? '—'} copy={selectedTarget.label} onEdit={() => startEditLabel('step', selectedTarget)} />}
            {selectedTarget.warning && <p className="target-warning">{selectedTarget.warning}</p>}
            </> : <KeyValue name={t('动作')} value={t(actionNames[selectedStep.action])} />}
          {selectedStep.action === 'input' && <>
            {inputEdit
              ? <LabelEditor name={t('输入值')} allowEmpty value={inputEdit.value} onChange={(value) => setInputEdit({ stepId: inputEdit.stepId, value })} onApply={applyInputEdit} onCancel={() => setInputEdit(null)} />
              : <KeyValue name={t('输入值')} value={selectedStep.value} copy={selectedStep.value} onEdit={() => startEditInput(selectedStep)} />}
            <KeyValue name={t('先清空')} value={selectedStep.clearFirst ? t('是') : t('否')} />
          </>}
          {selectedStep.action === 'swipe' && <>
            <KeyValue name={t('方向')} value={t(directionName(selectedStep.direction))} />
            <KeyValue name={t('距离')} value={selectedSwipeDistance ? `${selectedSwipeDistance} px` : t('默认轨迹')} />
            <KeyValue name={t('时长')} value={formatDuration(selectedStep.duration)} />
            {selectedStep.start && <KeyValue name={t('起点')} value={`${selectedStep.start.x}, ${selectedStep.start.y}`} />}
            {selectedStep.end && <KeyValue name={t('终点')} value={`${selectedStep.end.x}, ${selectedStep.end.y}`} />}
          </>}
          {noteEdit
              ? <LabelEditor name={t('备注')} allowEmpty value={noteEdit.value} onChange={(value) => setNoteEdit({ value })} onApply={applyNoteEdit} onCancel={() => setNoteEdit(null)} />
              : <KeyValue name={t('备注')} value={selectedStep.note ?? '—'} copy={selectedStep.note} onEdit={() => startEditNote(selectedStep)} />}
          {associatedAssertions.length > 0 && <div className="associated-assertions">
            <b>关联断言 · {associatedAssertions.length}</b>
            {associatedAssertions.map(({ index, step }) => <button key={step.id} onClick={() => setSelected(index)}>
              <span>{conditionNames[step.condition ?? 'exists']}</span>
              <small>{step.description}</small>
            </button>)}
          </div>}
          {selectedStep.action === 'wait' && (
            <div className="assertion-edit">
              <b className="assertion-heading">断言设置</b>
              <label>断言条件
                <select value={selectedStep.condition ?? 'exists'} onChange={(event) => patchSelectedWait({ condition: event.target.value as WaitCondition })}>
                  {Object.entries(conditionNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {selectedStep.condition === 'text' && <>
                <label>期望文本<input value={selectedStep.expect ?? ''} onChange={(event) => patchSelectedWait({ expect: event.target.value })} placeholder="要匹配的文本" /></label>
                <label>匹配方式<select value={selectedStep.match ?? 'contains'} onChange={(event) => patchSelectedWait({ match: event.target.value as TextMatch })}>
                  <option value="contains">包含</option><option value="equals">等于</option><option value="regex">正则</option>
                </select></label>
              </>}
              <label>超时（秒）<input type="number" min={1} max={120} value={Math.round(selectedStep.timeout / 1000)} onChange={(event) => patchSelectedWait({ timeout: clampNumber(event.target.value, 1, 120) * 1000 })} /></label>
            </div>
          )}
          {selectedStep.action !== 'wait' && <AssertionBar
            condition={assertCondition}
            expect={assertExpect}
            match={assertMatch}
            onCondition={setAssertCondition}
            onExpect={setAssertExpect}
            onMatch={setAssertMatch}
            onAdd={addAssertion}
            busy={Boolean(busy)}
          />}
          <div className="debug-row">
            <button onClick={() => void debugStep(selectedStep)} disabled={!session || replaying || Boolean(busy)} title="只回放当前这一条步骤，用于快速验证"><Bug />调试此步</button>
            <button onClick={() => void play(selected ?? 0)} disabled={!session || replaying || Boolean(busy)} title="从当前步骤开始回放，前面的步骤不执行"><Play />从此步回放</button>
            {selectedDebug && <span className={`debug-state ${selectedDebug.status}`}>{selectedDebug.status === 'running' && <RefreshCw />}{debugLabel(selectedDebug, t)}</span>}
          </div>
          {selectedTarget?.candidates?.length ? <CandidateList target={selectedTarget} busy={Boolean(busy)} onChoose={chooseLocator} onVerify={verifySelected} /> : null}
          {selected !== null && replayResults[selected] && <>
            <KeyValue name="回放结果" value={resultLabel(replayResults[selected], t)} />
            <KeyValue name="回放耗时" value={formatDuration(replayResults[selected].duration)} />
            {replayResults[selected].retried !== undefined && <KeyValue name="重试次数" value={String(replayResults[selected].retried)} />}
            {replayResults[selected].waited !== undefined && <KeyValue name="等待耗时" value={formatDuration(replayResults[selected].waited)} />}
            {replayResults[selected].message && <KeyValue name="失败原因" value={replayResults[selected].message ?? ''} copy={replayResults[selected].message} />}
          </>}
          {selected !== null && activityLog[selected]?.length > 0 && <div className="replay-log">{activityLog[selected].map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div>}
        </div> : <div className="empty-inspector"><Crosshair /><b>{picking ? '元素拾取中' : '选择一个步骤'}</b><span>{picking ? '点击设备画面，只读取控件定位器，不会操作设备' : '点击左侧步骤，查看定位器候选、回放结果和断言入口'}</span></div>}
        </>}
      </aside>
    </section>
    {clearStage !== 0 && <ClearDialog stage={clearStage} count={steps.length} onCancel={() => setClearStage(0)} onNext={() => setClearStage(2)} onConfirm={clearRecord} />}
    {aiOpen && <AiDialog
      config={aiConfig}
      title={aiTitle}
      busy={aiBusy}
      configured={aiConfigured}
      canExport={steps.length > 0}
      notice={aiNotice}
      error={aiError}
      onTitle={setAiTitle}
      onOpenSettings={editAiConfigFromDialog}
      onExport={() => void exportAiCase()}
      onClose={() => setAiOpen(false)}
    />}
    {attachOpen && <AttachDialog
      url={attachUrl}
      sessionId={attachSessionId}
      platform={attachPlatform}
      iosSupported={iosSupported}
      deviceId={attachDeviceId}
      mjpegPort={attachMjpegPort}
      busy={attachBusy}
      error={attachError}
      onUrl={setAttachUrl}
      onSessionId={setAttachSessionId}
      onPlatform={setAttachPlatform}
      onDeviceId={setAttachDeviceId}
      onMjpegPort={setAttachMjpegPort}
      onAttach={() => void attachExisting()}
      onClose={() => { if (!attachBusy) setAttachOpen(false); }}
    />}
    {settingsOpen && <SettingsDialog
      config={settingsConfig}
      testing={settingsTesting}
      notice={settingsNotice}
      error={settingsError}
      onConfig={setSettingsConfig}
      onTest={() => void testGlobalAiConfig()}
      onSave={saveGlobalAiConfig}
      onClose={() => setSettingsOpen(false)}
    />}
    {multiOpen && <MultiWorkspace onClose={() => setMultiOpen(false)} onSessionReleased={() => {
      setSession(null);
      setInitialShot(null);
      setStreamStatus('idle');
    }} />}
    {doctorOpen && <DoctorDialog
      report={doctor}
      busy={doctorBusy}
      installing={installing}
      notice={installNotice}
      error={installError}
      onClose={() => setDoctorOpen(false)}
      onRefresh={() => void openDoctor()}
      onInstall={(id) => void installDependency(id)}
      onInstallAll={() => void installAllDependencies()}
      onHelp={openHelp}
    />}
    {connectionFailure && <ConnectionErrorDialog
      diagnostic={connectionFailure}
      onClose={() => setConnectionFailure(null)}
      onDoctor={() => { setConnectionFailure(null); void openDoctor(); }}
      onLogs={() => { setConnectionFailure(null); void openLogs(); }}
      onHelp={openHelp}
    />}
    {logsOpen && <LogDialog lines={logs} path={logPath} onClose={() => setLogsOpen(false)} onRefresh={() => void openLogs()} />}
    {(error || logs.length > 0) && <footer className={error ? 'console error' : 'console'}><b>{error ? t('执行失败') : 'Appium'}</b><span>{error || logs.at(-1)}</span>{error && <button onClick={() => setError('')}>{t('关闭')}</button>}</footer>}
  </main>;
}

const roleLabels: Record<'recommended' | 'alternative' | 'brittle', string> = { recommended: '推荐', alternative: '可用', brittle: '脆弱' };

function CandidateList({ target, busy, onChoose, onVerify }: { target: Target; busy: boolean; onChoose: (locator: Locator) => void; onVerify: () => void }) {
  const { t } = useI18n();
  const candidates = target.candidates ?? [];
  return <div className="candidate-list">
    <div className="candidate-head"><b>{t('定位器候选 · {count}', { count: candidates.length })}</b><button onClick={onVerify} disabled={busy}><RefreshCw />{t('重新校验')}</button></div>
    {candidates.map((candidate) => {
      const active = Boolean(target.locator && target.locator.strategy === candidate.locator.strategy && target.locator.value === candidate.locator.value);
      return <div key={`${candidate.locator.strategy}\0${candidate.locator.value}`} className={`candidate-row ${candidate.role} ${active ? 'active' : ''}`}>
        <button className="candidate-select" onClick={() => onChoose(candidate.locator)} title={`${candidate.locator.strategy}: ${candidate.locator.value}`}>
          <span className={`badge ${candidate.role}`}>{t(roleLabels[candidate.role])}</span>
          <code>{candidate.locator.strategy} · {candidate.locator.value}</code>
          <em>{candidate.matches}</em>
          {candidate.note && <small>{candidate.note}</small>}
        </button>
        <CopyButton value={candidate.locator.value} title={t('复制定位值')} />
      </div>;
    })}
  </div>;
}

type ElementRow = ElementTreeResponse['nodes'][number];

function ElementTreePanel({ session, onHighlight }: { session: SessionState | null; onHighlight: (bounds: Target['bounds'] | null) => void }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<ElementTreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['root']));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Target | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const result = await window.studio.elements();
      setData(result);
      setSelectedId(null);
      setAnalysis(null);
      setNotice(result.truncated ? t('控件树较大，仅显示前 4000 个节点') : '');
      setExpanded(new Set(['root', ...result.nodes.filter((node) => node.depth <= 2).map((node) => node.id)]));
    } catch (cause) { setError(errorText(locale, cause)); }
    finally { setLoading(false); }
  }, [session]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => onHighlight(null), [onHighlight]);

  const byId = useMemo(() => new Map((data?.nodes ?? []).map((node) => [node.id, node])), [data]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ElementRow[]>();
    for (const node of data?.nodes ?? []) {
      const list = map.get(node.parentId) ?? [];
      list.push(node);
      map.set(node.parentId, list);
    }
    return map;
  }, [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      return data.nodes.filter((node) => [node.type, node.name, node.label, node.text, node.value, node.resourceId, Object.values(node.attributes).join(' ')].join(' ').toLowerCase().includes(keyword)).slice(0, 500);
    }
    const list: ElementRow[] = [];
    const walk = (id: string) => {
      const node = byId.get(id);
      if (!node) return;
      list.push(node);
      if (expanded.has(id)) for (const child of childrenByParent.get(id) ?? []) walk(child.id);
    };
    walk('root');
    return list;
  }, [data, query, expanded, byId, childrenByParent]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const analyze = async (node: ElementRow) => {
    setAnalyzing(true);
    setError('');
    try { setAnalysis(await window.studio.analyzeElement(node.path)); }
    catch (cause) { setError(errorText(locale, cause)); }
    finally { setAnalyzing(false); }
  };
  const select = (node: ElementRow) => {
    setSelectedId(node.id);
    onHighlight(node.bounds ?? null);
    setNotice('');
    void analyze(node);
  };
  const toggle = (id: string) => {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const tapSelected = async () => {
    if (!selected?.bounds) return;
    try {
      await window.studio.tap(Math.round(selected.bounds.x + selected.bounds.width / 2), Math.round(selected.bounds.y + selected.bounds.height / 2), false);
      setNotice(t('已点击选中元素'));
    } catch (cause) { setError(errorText(locale, cause)); }
  };
  const copy = (value: string) => { void navigator.clipboard.writeText(value).catch(() => undefined); };

  if (!session) return <div className="empty-inspector"><Crosshair /><b>{t('尚未连接设备')}</b><span>{t('连接或附加 Appium 会话后可浏览元素树')}</span></div>;
  return <div className="inspector-body tree-panel">
    <div className="tree-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索类型、name、label、resource-id…')} />
      <button onClick={() => void load()} disabled={loading} title={t('刷新 page source')}><RefreshCw className={loading ? 'spin' : ''} /></button>
      <button onClick={() => setExpanded(new Set((data?.nodes ?? []).map((node) => node.id)))} disabled={!data}>{t('展开')}</button>
      <button onClick={() => setExpanded(new Set(['root']))} disabled={!data}>{t('收起')}</button>
    </div>
    {(error || notice) && <p className={error ? 'ai-error' : 'ai-notice'}>{error || notice}</p>}
    <div className="tree-list">
      {loading && !data && <div className="doctor-loading"><RefreshCw />{t('正在读取控件树…')}</div>}
      {!loading && data && rows.length === 0 && <div className="empty-steps">{t('没有匹配的元素')}</div>}
      {rows.map((node) => {
        const hasChildren = node.children > 0;
        const open = expanded.has(node.id);
        return <div key={node.id} className={`tree-row ${selectedId === node.id ? 'selected' : ''}`} style={{ paddingLeft: `${8 + Math.min(node.depth, 18) * 13}px` }}>
          <button className="tree-toggle" onClick={() => toggle(node.id)} disabled={!hasChildren}>{hasChildren ? (open ? <ChevronDown /> : <ChevronRight />) : null}</button>
          <button className="tree-node" onClick={() => select(node)} title={node.path.join('.')}>
            <span className="tree-type">{shortElementType(node.type)}</span>
            <span className="tree-name">{node.label || node.name || node.text || node.resourceId || node.value || '—'}</span>
            {node.bounds && <em>{Math.round(node.bounds.width)}×{Math.round(node.bounds.height)}</em>}
          </button>
        </div>;
      })}
    </div>
    {selected && <div className="tree-detail">
      <div className="tree-detail-head">
        <b>{shortElementType(selected.type)}</b>
        <button onClick={() => copy(JSON.stringify(selected.attributes, null, 2))}><Copy /></button>
      </div>
      <div className="tree-detail-actions">
        <button onClick={() => void analyze(selected)} disabled={analyzing}>{analyzing ? <RefreshCw className="spin" /> : <Crosshair />}{t('生成定位器')}</button>
        <button onClick={() => void tapSelected()} disabled={!selected.bounds}><Play />{t('点击元素')}</button>
        {analysis?.locator && <button onClick={() => copy(analysis.locator!.value)}><Copy />{t('复制定位器')}</button>}
      </div>
      {analysis?.locator && <div className="tree-locator"><span>{analysis.locator.strategy}</span><code>{analysis.locator.value}</code></div>}
      {analysis?.candidates?.length ? <div className="tree-candidates">
        {analysis.candidates.slice(0, 8).map((candidate, index) => <div key={`${candidate.locator.strategy}-${index}`} className={`tree-candidate ${candidate.role}`}>
          <em>{t(candidate.role === 'recommended' ? '推荐' : candidate.role === 'alternative' ? '可用' : '脆弱')}</em>
          <span>{candidate.locator.strategy}</span>
          <code>{candidate.locator.value}</code>
          <button onClick={() => copy(candidate.locator.value)}><Copy /></button>
        </div>)}
      </div> : null}
      <div className="tree-attrs">
        {Object.entries(selected.attributes).filter(([key]) => key !== 'bounds').map(([key, value]) => <div key={key}><span>{key}</span><code>{value}</code></div>)}
      </div>
      {selected.bounds && <div className="tree-bounds">bounds: {selected.bounds.x}, {selected.bounds.y}, {selected.bounds.width}×{selected.bounds.height}</div>}
    </div>}
  </div>;
}

function shortElementType(type: string): string {
  return type.replace(/^XCUIElementType/, '').replace(/^android\.widget\./, '').replace(/^android\.view\./, '').replace(/^androidx\.[^.]+\.[^.]+\./, '') || 'Element';
}

function MultiWorkspace({ onClose, onSessionReleased }: { onClose: () => void; onSessionReleased: () => void }) {
  const { locale, t } = useI18n();
  const [devices, setDevices] = useState<Device[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bundleId, setBundleId] = useState('');
  const [status, setStatus] = useState<MultiSessionStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mixedConfirm, setMixedConfirm] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shots, setShots] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [results, setResults] = useState<MultiActionResult[]>([]);
  const [streamNonce, setStreamNonce] = useState(1);
  const statusRef = useRef<MultiSessionStatus | null>(null);
  const active = status?.active ?? false;
  const iosSupported = !system || system.capabilities.ios;
  const available = devices.filter((device) => device.status === 'device' && (device.platform === 'android' || iosSupported));
  const selectedDevices = available.filter((device) => selected.includes(device.id));
  const mixed = new Set(selectedDevices.map((device) => device.platform)).size > 1;
  const selectedHasIos = selectedDevices.some((device) => device.platform === 'ios');

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => window.studio.onDevices((found) => setDevices(found)), []);
  const discoverDevices = async () => {
    setDiscovering(true);
    try {
      setDevices(await window.studio.listDevices());
      setError('');
    } catch (cause) { setError(errorText(locale, cause)); }
    finally { setDiscovering(false); }
  };
  useEffect(() => {
    void (async () => {
      setBusy(t('读取设备和会话状态…'));
      try {
        const [info, list, current] = await Promise.all([window.studio.system(), window.studio.listDevices(), window.studio.multiStatus()]);
        setSystem(info);
        setDevices(list);
        if (current.active) {
          setStatus(current);
          setActiveId(current.devices.find((device) => device.online)?.deviceId ?? null);
          void refreshShots(current);
        }
      } catch (cause) { setError(errorText(locale, cause)); }
      finally { setBusy(''); }
    })();
  }, []);
  useEffect(() => {
    if (!status?.active) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.studio.multiStatus().then((next) => { if (!cancelled) setStatus(next); }).catch(() => undefined);
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [status?.active]);
  useEffect(() => {
    if (!status?.active) return;
    if (!activeId || !status.devices.some((device) => device.deviceId === activeId && device.online)) {
      setActiveId(status.devices.find((device) => device.online)?.deviceId ?? null);
    }
  }, [status, activeId]);

  const refreshShot = async (deviceId: string) => {
    try {
      const screenshot = await window.studio.multiScreenshot(deviceId);
      setShots((old) => ({ ...old, [deviceId]: screenshot }));
    } catch { /* 截图失败不阻塞同步操作。 */ }
  };
  const refreshShots = async (session: MultiSessionStatus | null = statusRef.current) => {
    if (!session) return;
    await Promise.allSettled(session.devices.filter((device) => device.online && !device.live).map((device) => refreshShot(device.deviceId)));
  };
  const close = async () => {
    if (statusRef.current?.active) await window.studio.multiStop().catch(() => undefined);
    onClose();
  };
  const toggleSelected = (deviceId: string) => {
    setMixedConfirm(false);
    setSelected((old) => old.includes(deviceId) ? old.filter((id) => id !== deviceId) : [...old, deviceId]);
  };
  const startSession = async () => {
    setMixedConfirm(false);
    setBusy(t('正在建立多端会话…'));
    setError('');
    setNotice('');
    setResults([]);
    try {
      const selection: MultiDeviceSelection[] = selectedDevices.map((device) => ({ deviceId: device.id, name: device.name, platform: device.platform }));
      onSessionReleased();
      const next = await window.studio.multiStart(selection, bundleId.trim() || undefined);
      setStatus(next);
      statusRef.current = next;
      setActiveId(next.devices.find((device) => device.online)?.deviceId ?? null);
      setStreamNonce((value) => value + 1);
      setNotice(t('多端同步已启动；单设备会话已释放'));
      void refreshShots(next);
    } catch (cause) { setError(errorText(locale, cause)); }
    finally { setBusy(''); }
  };
  const requestStart = () => {
    if (selectedDevices.length === 0) { setError(t('请至少选择一台在线设备')); return; }
    if (mixed) { setMixedConfirm(true); return; }
    void startSession();
  };
  const stopSession = async () => {
    setBusy(t('正在停止多端同步…'));
    try { await window.studio.multiStop(); }
    catch (cause) { setError(errorText(locale, cause)); }
    finally {
      setStatus(null);
      statusRef.current = null;
      setActiveId(null);
      setShots({});
      setResults([]);
      setBusy('');
      setNotice('');
    }
  };
  const toggleDevice = async (device: MultiDeviceStatus, patch: { live?: boolean; sync?: boolean }) => {
    setStatus((old) => old ? { ...old, devices: old.devices.map((item) => item.deviceId === device.deviceId ? { ...item, ...patch } : item) } : old);
    if (patch.live === true && !activeId) setActiveId(device.deviceId);
    try {
      const next = await window.studio.multiSetDevice(device.deviceId, patch);
      setStatus((old) => old ? { ...old, devices: mergeDeviceFlags(old.devices, next) } : old);
      if (patch.live === false) void refreshShot(device.deviceId);
    } catch (cause) {
      setError(errorText(locale, cause));
      const next = await window.studio.multiStatus().catch(() => null);
      if (next) setStatus(next);
    }
  };
  const setAllLive = async (live: boolean) => {
    const targets = status?.devices.filter((device) => device.online) ?? [];
    setStatus((old) => old ? { ...old, devices: old.devices.map((device) => device.online ? { ...device, live } : device) } : old);
    await Promise.allSettled(targets.map((device) => window.studio.multiSetDevice(device.deviceId, { live })));
    const next = await window.studio.multiStatus().catch(() => null);
    if (next) {
      setStatus(next);
      if (live && !activeId) setActiveId(next.devices.find((device) => device.online)?.deviceId ?? null);
      if (!live) void refreshShots(next);
    }
  };
  const setAllSync = async (sync: boolean) => {
    const targets = status?.devices.filter((device) => device.online) ?? [];
    setStatus((old) => old ? { ...old, devices: old.devices.map((device) => device.online ? { ...device, sync } : device) } : old);
    await Promise.allSettled(targets.map((device) => window.studio.multiSetDevice(device.deviceId, { sync })));
    const next = await window.studio.multiStatus().catch(() => null);
    if (next) setStatus(next);
  };
  const act = async (action: MultiAction) => {
    if (!statusRef.current?.active) return;
    setError('');
    try {
      const next = await window.studio.multiAction(action);
      setResults(next);
      setStatus((old) => old ? {
        ...old,
        devices: old.devices.map((device) => {
          const result = next.find((item) => item.deviceId === device.deviceId);
          return result ? { ...device, lastAction: { action: action.action, ...result, at: Date.now() } } : device;
        }),
      } : old);
      const inactive = statusRef.current?.devices.filter((device) => device.online && !device.live) ?? [];
      window.setTimeout(() => { for (const device of inactive) void refreshShot(device.deviceId); }, 300);
    } catch (cause) { setError(errorText(locale, cause)); }
  };
  const sendText = () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    void act({ action: 'text', text: value });
  };

  return <div className="multi-overlay">
    <div className="multi-shell">
      <header className="multi-header">
        <div className="multi-title"><LayoutGrid /><div><b>{t('多端同步')}</b><span>{active ? t('{count} 台设备 · 操作会广播到所有参与同步的设备', { count: status?.devices.length ?? 0 }) : t('选择设备并建立同步会话')}</span></div></div>
        <div className="multi-header-actions">
          {active && <>
            <button onClick={() => void setAllLive(true)}>{t('全部实时')}</button>
            <button onClick={() => void setAllLive(false)}>{t('全部关闭')}</button>
            <button onClick={() => void setAllSync(true)}>{t('全部同步')}</button>
            <button onClick={() => void setAllSync(false)}>{t('全部暂停')}</button>
            <button onClick={() => setStreamNonce((value) => value + 1)}><RefreshCw />{t('重连画面')}</button>
            <button className="danger" onClick={() => void stopSession()} disabled={Boolean(busy)}>{t('停止同步')}</button>
          </>}
          <button onClick={() => void close()} disabled={Boolean(busy)}><XCircle />{t('关闭')}</button>
        </div>
      </header>
      {busy && <div className="multi-busy"><RefreshCw />{busy}</div>}
      {error && <div className="multi-error">{error}</div>}
      {notice && <div className="multi-notice">{notice}</div>}
      {status?.mixedPlatform && <div className="multi-warning">{t('混合平台同步中：Android 与 iOS 的布局、状态栏、输入法和返回行为可能不同，同一操作可能落在不同位置。建议使用同平台、同方向、同一 App 的设备。')}</div>}
      {(status?.devices.filter((device) => device.live).length ?? 0) > 2 && <div className="multi-warning">{t('当前 {count} 路实时画面，软件解码可能占用较高 CPU；可关闭部分实时或减少设备。', { count: status?.devices.filter((device) => device.live).length ?? 0 })}</div>}
      {!active ? <div className="multi-select">
        <div className="multi-select-head">
          <div><b>{t('选择设备')}</b><span>{t('支持多台同时实时画面；任意一台画面都可作为操作入口，操作会广播给所有参与同步的设备。')}</span></div>
          <div className="multi-select-side">
            <span className="multi-count">{t('已选 {selected} / {total}', { selected: selectedDevices.length, total: available.length })}</span>
            <button onClick={() => void discoverDevices()} disabled={discovering}>
              <RefreshCw className={discovering ? 'spin' : ''} />{discovering ? t('发现中…') : t('发现设备')}
            </button>
          </div>
        </div>
        <div className="multi-device-list">
          {devices.map((device) => {
            const usable = device.status === 'device' && (device.platform === 'android' || iosSupported);
            return <label key={device.id} className={`multi-device-option ${selected.includes(device.id) ? 'selected' : ''} ${usable ? '' : 'disabled'}`}>
              <input type="checkbox" checked={selected.includes(device.id)} disabled={!usable} onChange={() => toggleSelected(device.id)} />
              <span className={`multi-platform ${device.platform}`}>{device.platform === 'ios' ? 'iOS' : 'Android'}</span>
              <span className="multi-device-name"><b>{device.name}</b><small>{device.id}</small></span>
              <em className={usable ? 'online' : 'offline'}>{usable ? t('在线') : device.platform === 'ios' && !iosSupported ? t('仅 macOS 支持') : device.simulator ? t('未启动') : device.status}</em>
            </label>;
          })}
          {devices.length === 0 && <div className="multi-empty">{t('没有发现设备，请先连接手机或模拟器。')}</div>}
          {devices.some((device) => device.simulator && device.status !== 'device') && <div className="multi-empty">{t('未启动的模拟器显示为“未启动”，请先在 Xcode/Simulator 或 `xcrun simctl boot` 中启动。')}</div>}
        </div>
        {selectedHasIos && <label className="multi-bundle"><span>{t('iOS BUNDLE ID（可选，用于激活前台 App）')}</span><input value={bundleId} onChange={(event) => setBundleId(event.target.value)} placeholder="com.example.app" /></label>}
        {mixed && <div className="multi-warning">{t('当前选择包含 Android 和 iOS。可以继续，但同一相对坐标可能对应不同布局；推荐使用同一平台。')}</div>}
        <div className="multi-start-row">
          <span>{t('默认所有设备参与同步并开启实时画面，可在进入后单独关闭。')}</span>
          <button className="primary" onClick={requestStart} disabled={Boolean(busy) || selectedDevices.length === 0}>{t('开始多端同步')}</button>
        </div>
      </div> : <div className="multi-workspace">
        <div className="multi-grid">
          {status?.devices.map((device) => <MultiDeviceCard
            key={device.deviceId}
            device={device}
            active={activeId === device.deviceId}
            shot={shots[device.deviceId]}
            nonce={streamNonce}
            onActivate={() => setActiveId(device.deviceId)}
            onToggleLive={() => void toggleDevice(device, { live: !device.live })}
            onToggleSync={() => void toggleDevice(device, { sync: !device.sync })}
            onTap={(x, y) => { setActiveId(device.deviceId); void act({ action: 'tap', xRatio: x, yRatio: y }); }}
            onSwipe={(sx, sy, ex, ey, duration) => { setActiveId(device.deviceId); void act({ action: 'swipe', startXRatio: sx, startYRatio: sy, endXRatio: ex, endYRatio: ey, duration }); }}
            onRefreshShot={() => void refreshShot(device.deviceId)}
          />)}
        </div>
        <div className="multi-actions">
          <button onClick={() => void act({ action: 'back' })}><ArrowLeft />{t('返回')}</button>
          <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); sendText(); } }} placeholder={t('向所有参与同步设备输入文本')} />
          <button onClick={sendText} disabled={!text.trim()}><Send /></button>
          <button onClick={() => void act({ action: 'key', key: 'backspace' })}><Keyboard />{t('退格')}</button>
          <button onClick={() => void act({ action: 'key', key: 'enter' })}>{t('回车')}</button>
          <button onClick={() => void act({ action: 'key', key: 'delete' })}>{t('删除')}</button>
          <button onClick={() => void refreshShots()}><RefreshCw />{t('刷新静态截图')}</button>
          {results.length > 0 && <span className="multi-result-summary">{t('{passed}/{total} 成功', { passed: results.filter((result) => result.ok).length, total: results.length })}</span>}
        </div>
        <div className="multi-hint">{t('点击任意画面即广播操作；拖动发送滑动。实时开关只影响视频，参与同步开关决定是否接收指令。')}</div>
      </div>}
      {mixedConfirm && <div className="multi-modal">
        <div className="multi-modal-box">
          <b>{t('确认混合平台同步')}</b>
          <p>{t('当前选择同时包含 Android 和 iOS。相对坐标广播可能因为布局、状态栏、输入法和返回行为差异，落到不同控件上。建议使用同平台、同方向、同一个 App。')}</p>
          <div className="multi-modal-actions">
            <button onClick={() => setMixedConfirm(false)}>{t('取消')}</button>
            <button className="primary" onClick={() => void startSession()}>{t('我了解风险，开始混合同步')}</button>
          </div>
        </div>
      </div>}
    </div>
  </div>;
}

function MultiDeviceCard({ device, active, shot, nonce, onActivate, onToggleLive, onToggleSync, onTap, onSwipe, onRefreshShot }: {
  device: MultiDeviceStatus;
  active: boolean;
  shot?: string;
  nonce: number;
  onActivate: () => void;
  onToggleLive: () => void;
  onToggleSync: () => void;
  onTap: (x: number, y: number) => void;
  onSwipe: (startX: number, startY: number, endX: number, endY: number, duration: number) => void;
  onRefreshShot: () => void;
}) {
  const { t } = useI18n();
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startedAt: number; moved: boolean } | null>(null);
  const initialShotRef = useRef<string | null>(shot ?? null);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'loading' | 'playing' | 'failed'>('loading');
  const [streamError, setStreamError] = useState('');
  const screenshot = useCallback(() => window.studio.multiScreenshot(device.deviceId), [device.deviceId]);
  useEffect(() => { setStreamStatus('loading'); setStreamError(''); }, [device.live, device.online, nonce]);
  const ratioNumber = device.width > 0 && device.height > 0 ? device.width / device.height : 375 / 812;
  const phoneStyle = { '--ratio': String(ratioNumber), aspectRatio: device.width > 0 && device.height > 0 ? `${device.width} / ${device.height}` : '375 / 812' } as React.CSSProperties;
  const point = (clientX: number, clientY: number) => {
    const rect = mediaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!device.online) return;
    onActivate();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: performance.now(), moved: false };
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 12) drag.moved = true;
  };
  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const start = point(drag.startX, drag.startY);
    const end = point(event.clientX, event.clientY);
    if (!drag.moved) { onTap(start.x, start.y); return; }
    onSwipe(start.x, start.y, end.x, end.y, Math.max(100, Math.min(5000, Math.round(performance.now() - drag.startedAt))));
  };
  const live = device.live && device.online;
  const src = `/api/multi/video?deviceId=${encodeURIComponent(device.deviceId)}`;
  return <div className={`multi-card ${active ? 'active' : ''} ${device.online ? '' : 'offline'}`}>
    <div className="multi-card-head">
      <div className="multi-card-title">
        <span className={`multi-status-dot ${device.state}`} />
        <b>{device.name}</b>
        <em>{device.platform === 'ios' ? 'iOS' : 'Android'}</em>
        {active && <strong>{t('操作源')}</strong>}
      </div>
      <div className="multi-card-toggles">
        <button className={device.live ? 'on' : ''} onClick={onToggleLive}>{t('实时')}</button>
        <button className={device.sync ? 'on' : ''} onClick={onToggleSync}>{t('同步')}</button>
      </div>
    </div>
    <div className="multi-phone-stage">
      <div className="multi-phone" style={phoneStyle}>
        <div className="multi-speaker" />
        <div className="multi-card-media" ref={mediaRef}>
          {live ? (device.platform === 'android'
            ? <AndroidVideo nonce={nonce} src={src} initialShot={initialShotRef.current} screenshot={screenshot} setStreamStatus={setStreamStatus} setError={setStreamError} />
            : <IosVideo nonce={nonce} src={src} setStreamStatus={setStreamStatus} setError={setStreamError} />)
            : shot ? <img src={`data:image/png;base64,${shot}`} alt={`${device.name} ${t('静态画面')}`} draggable={false} />
              : <div className="multi-no-video"><WifiOff /><span>{device.online ? t('实时画面已关闭') : t('设备离线')}</span>{device.online && <button onClick={onRefreshShot}>{t('刷新截图')}</button>}</div>}
          {live && streamStatus !== 'playing' && <div className="multi-stream-state"><RefreshCw />{streamStatus === 'failed' ? streamError || t('视频连接失败') : t('正在连接实时画面…')}</div>}
          <div className="multi-touch" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { dragRef.current = null; }} />
        </div>
      </div>
    </div>
    <div className="multi-card-foot">
      <span>{device.online ? <Wifi /> : <WifiOff />}{device.state === 'ready' ? t('在线') : device.state === 'connecting' ? t('连接中') : device.state === 'offline' ? t('离线') : t('异常')}</span>
      <span>{device.width}×{device.height}</span>
      {device.foregroundApp && <span title={device.foregroundApp}>{device.foregroundApp}</span>}
      {device.lastAction && <span className={device.lastAction.ok ? 'ok' : 'fail'} title={device.lastAction.message}>{device.lastAction.ok ? t('操作成功') : `${t('操作失败')}${device.lastAction.message ? ` · ${device.lastAction.message}` : ''}`} · {device.lastAction.duration}ms</span>}
      {!device.live && device.online && <button onClick={onRefreshShot}><RefreshCw />{t('截图')}</button>}
    </div>
    {device.error && <div className="multi-card-error">{device.error}</div>}
  </div>;
}

function mergeDeviceFlags(current: MultiDeviceStatus[], next: MultiDeviceStatus[]): MultiDeviceStatus[] {
  const map = new Map(next.map((device) => [device.deviceId, device]));
  return current.map((device) => map.get(device.deviceId) ?? device);
}

function AttachDialog(props: {
  url: string;
  sessionId: string;
  platform: Platform;
  iosSupported: boolean;
  deviceId: string;
  mjpegPort: string;
  busy: boolean;
  error: string;
  onUrl: (value: string) => void;
  onSessionId: (value: string) => void;
  onPlatform: (value: Platform) => void;
  onDeviceId: (value: string) => void;
  onMjpegPort: (value: string) => void;
  onAttach: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const disabled = props.busy;
  return <div className="doctor-overlay" onMouseDown={() => { if (!disabled) props.onClose(); }}>
    <div className="doctor-dialog attach-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><b>{t('附加已有 Appium 会话')}</b><button onClick={props.onClose} disabled={disabled}>{t('关闭')}</button></header>
      <div className="ai-form">
        <p className="ai-hint">{t('不新建、也不结束外部会话。脱离时只断开本工具绑定；需要可选的设备 UDID 或 WDA MJPEG 端口才能显示实时画面，否则使用截图模式。')}</p>
        <label>Appium Server URL<input value={props.url} onChange={(event) => props.onUrl(event.target.value)} placeholder="http://127.0.0.1:4723" spellCheck={false} autoComplete="off" /></label>
        <label>{t('Session ID')}<input value={props.sessionId} onChange={(event) => props.onSessionId(event.target.value)} placeholder={t('粘贴 Appium 会话 ID')} spellCheck={false} autoComplete="off" /></label>
        <p className="ai-hint">{t('Session ID 由创建该会话的客户端返回，也可在 Appium Server 日志中查看。只想自己开始测试时不必附加，直接新建会话即可。')}</p>
        <label>{t('平台')}<select value={props.platform} onChange={(event) => props.onPlatform(event.target.value as Platform)}><option value="android">Android</option><option value="ios" disabled={!props.iosSupported}>{t('iOS（仅 macOS）')}</option></select></label>
        <label>{props.platform === 'android' ? t('设备 UDID（可选，用于启动实时画面）') : t('设备 UDID（可选）')}<input value={props.deviceId} onChange={(event) => props.onDeviceId(event.target.value)} placeholder={props.platform === 'android' ? t('adb devices 中的序列号') : 'iPhone UDID'} spellCheck={false} autoComplete="off" /></label>
        {props.platform === 'ios' && <label>{t('WDA MJPEG 端口（可选）')}<input value={props.mjpegPort} onChange={(event) => props.onMjpegPort(event.target.value)} placeholder={t('例如 9100；留空则使用静态截图')} inputMode="numeric" /></label>}
        {props.error && <p className="ai-error">{props.error}</p>}
      </div>
      <div className="ai-actions">
        <button className="primary" onClick={props.onAttach} disabled={disabled}>{disabled ? <RefreshCw /> : <MonitorSmartphone />}{disabled ? t('正在附加…') : t('附加会话')}</button>
        <button onClick={props.onClose} disabled={disabled}>{t('取消')}</button>
      </div>
    </div>
  </div>;
}

function AiDialog(props: {
  config: AiConfig;
  title: string;
  busy: boolean;
  configured: boolean;
  canExport: boolean;
  notice: string;
  error: string;
  onTitle: (title: string) => void;
  onOpenSettings: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const disabled = props.busy;
  return <div className="doctor-overlay" onMouseDown={() => { if (!disabled) props.onClose(); }}>
    <div className="doctor-dialog ai-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><b>{t('AI 用例导出')}</b><button onClick={props.onClose} disabled={disabled}>{t('关闭')}</button></header>
      <div className="ai-form">
        <label>{t('用例标题')}<input value={props.title} onChange={(event) => props.onTitle(event.target.value)} placeholder={t('例如：登录后进入行情页')} maxLength={200} /></label>
        <div className="ai-config-line">
          <span className="ai-config-summary" title={props.config.baseUrl}>{props.configured ? `${props.config.model} · ${props.config.baseUrl}` : t('尚未配置 AI 接口')}</span>
          <button onClick={props.onOpenSettings} disabled={disabled}>{t('AI 配置')}</button>
        </div>
        <p className="ai-hint">{t('使用全局设置里的 AI 配置导出，不需要每次重复填写。配置只保存在当前浏览器，CSV 每行一个操作步骤，断言可为空。')}</p>
        {!props.configured && <p className="ai-error">{t('请先在顶部“设置”中完成 Base URL、Model 和 API Key 配置。')}</p>}
        {props.error && <p className="ai-error">{props.error}</p>}
        {props.notice && <p className="ai-notice">{props.notice}</p>}
        {!props.canExport && <p className="ai-hint">{t('当前没有步骤，先录制或载入脚本后再导出。')}</p>}
      </div>
      <div className="ai-actions">
        <button className="primary" onClick={props.onExport} disabled={disabled || !props.canExport || !props.configured}>
          {props.busy ? <RefreshCw /> : <FileSpreadsheet />}{props.busy ? t('正在生成…') : t('导出 CSV')}
        </button>
        <button onClick={props.onClose} disabled={disabled}>{t('关闭')}</button>
      </div>
    </div>
  </div>;
}

function SettingsDialog(props: {
  config: AiConfig;
  testing: boolean;
  notice: string;
  error: string;
  onConfig: (config: AiConfig) => void;
  onTest: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const { config } = props;
  const disabled = props.testing;
  return <div className="doctor-overlay" onMouseDown={() => { if (!disabled) props.onClose(); }}>
    <div className="doctor-dialog settings-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><b>{t('全局设置')}</b><button onClick={props.onClose} disabled={disabled}>{t('关闭')}</button></header>
      <div className="ai-form">
        <section className="settings-section">
          <h3>{t('界面语言')}</h3>
          <p className="ai-hint">{t('语言设置只影响界面文案，不会改变设备、脚本或导出数据的语言。')}</p>
          <label>{t('界面语言')}<select value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)}>{localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </section>
        <section className="settings-section">
          <h3>{t('AI 用例')}</h3>
          <p className="ai-hint">{t('供顶部“AI 用例”导出使用。配置只保存在当前浏览器 localStorage，不写入服务端；测试和导出时仅随本次请求临时转发给本地服务。测试连接不会自动保存，修改后请点“保存配置”。')}</p>
          <label>Base URL<input value={config.baseUrl} onChange={(event) => props.onConfig({ ...config, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" spellCheck={false} autoComplete="off" /></label>
          <label>{t('API Key')}<input type="password" value={config.apiKey} onChange={(event) => props.onConfig({ ...config, apiKey: event.target.value })} placeholder={t('sk-...；本地兼容服务可留空')} spellCheck={false} autoComplete="off" /></label>
          <label>Model<input value={config.model} onChange={(event) => props.onConfig({ ...config, model: event.target.value })} placeholder="gpt-4o-mini" spellCheck={false} autoComplete="off" /></label>
        </section>
        {props.error && <p className="ai-error">{props.error}</p>}
        {props.notice && <p className="ai-notice">{props.notice}</p>}
      </div>
      <div className="ai-actions">
        <button onClick={props.onTest} disabled={disabled}>{props.testing ? <><RefreshCw />{t('测试中…')}</> : t('测试连接')}</button>
        <button className="primary" onClick={props.onSave} disabled={disabled}>{t('保存配置')}</button>
        <button onClick={props.onClose} disabled={disabled}>{t('关闭')}</button>
      </div>
    </div>
  </div>;
}

function DoctorDialog({ report, busy, installing, notice, error, onClose, onRefresh, onInstall, onInstallAll, onHelp }: {
  report: DoctorReport | null;
  busy: boolean;
  installing: string;
  notice: string;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onInstall: (id: string) => void;
  onInstallAll: () => void;
  onHelp: () => void;
}) {
  const { t } = useI18n();
  const installable = report?.checks.filter((check) => check.installable && check.status !== 'ok') ?? [];
  const system = report?.system;
  return <div className="doctor-overlay" onMouseDown={() => { if (!installing) onClose(); }}>
    <div className="doctor-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><b>{t('环境体检')}</b><div className="doctor-header-actions"><button onClick={onHelp} disabled={Boolean(installing)}><CircleHelp />{t('安装帮助')}</button><button onClick={onClose} disabled={Boolean(installing)}>{t('关闭')}</button></div></header>
      <div className="doctor-actions">
        <span>{system ? `${system.osName} · ${system.packageManager === 'none' ? t('未检测到包管理器') : system.packageManager} · ` : ''}{report ? new Date(report.generatedAt).toLocaleString() : t('尚未检查')}</span>
        <div className="doctor-action-buttons">
          {installable.length > 0 && <button onClick={onInstallAll} disabled={busy || Boolean(installing)}>{t('一键安装缺失项')}</button>}
          <button onClick={onRefresh} disabled={busy || Boolean(installing)}><RefreshCw />{busy ? t('检查中…') : t('重新检查')}</button>
        </div>
      </div>
      {notice && <p className="doctor-notice">{notice}</p>}
      {error && <p className="doctor-error">{error}</p>}
      <div className="doctor-list">
        {busy && !report ? <div className="doctor-loading"><RefreshCw />{t('正在检查环境…')}</div> : report?.checks.map((check) => <div key={check.id} className={`doctor-check ${check.status}`}>
          <span className="doctor-status">{check.status === 'ok' ? <CheckCircle2 /> : check.status === 'warn' ? <AlertTriangle /> : <XCircle />}</span>
          <div>
            <b>{t(check.name)}{check.required && check.status !== 'ok' ? ` · ${t('必需')}` : ''}</b>
            <small>{t(check.detail)}</small>
            {check.status !== 'ok' && check.fix && <em>{t(check.fix)}</em>}
            {check.installable && check.status !== 'ok' && <div className="doctor-install"><button onClick={() => onInstall(check.id)} disabled={busy || Boolean(installing)}>{installing === check.id ? <><RefreshCw />{t('安装中…')}</> : t('安装')}</button></div>}
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}

function ConnectionErrorDialog({ diagnostic, onClose, onDoctor, onLogs, onHelp }: {
  diagnostic: ConnectionDiagnostic;
  onClose: () => void;
  onDoctor: () => void;
  onLogs: () => void;
  onHelp: () => void;
}) {
  const { t } = useI18n();
  return <div className="doctor-overlay" onMouseDown={onClose}>
    <div className="doctor-dialog connection-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><b><AlertTriangle />{diagnostic.title}</b><button onClick={onClose}>{t('关闭')}</button></header>
      <div className="connection-body">
        <p className="connection-summary">{diagnostic.summary}</p>
        {diagnostic.blockers.length > 0 && <section className="connection-section">
          <h3>{t('缺少的必要环境')}</h3>
          <div className="connection-blockers">
            {diagnostic.blockers.map((check) => <article key={check.id} className={`connection-blocker ${check.status}`}>
              <b>{check.status === 'fail' ? <XCircle /> : <AlertTriangle />}{t(check.name)}</b>
              <span>{t(check.detail)}</span>
              {check.fix && <em>{t(check.fix)}</em>}
            </article>)}
          </div>
        </section>}
        {diagnostic.suggestions.length > 0 && <section className="connection-section">
          <h3>{t('建议处理')}</h3>
          <ul>{diagnostic.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
        </section>}
        {diagnostic.details && <details className="connection-details">
          <summary>{t('查看技术详情')}</summary>
          <pre>{diagnostic.details}</pre>
        </details>}
      </div>
      <div className="connection-actions">
        <button onClick={onHelp}><CircleHelp />{t('安装帮助')}</button>
        <button onClick={onDoctor}><Stethoscope />{t('环境体检')}</button>
        <button onClick={onLogs}><FileText />{t('运行日志')}</button>
        <button className="primary" onClick={onClose}>{t('知道了')}</button>
      </div>
    </div>
  </div>;
}

function LogDialog({ lines, path, onClose, onRefresh }: { lines: string[]; path: string; onClose: () => void; onRefresh: () => void }) {
  const { t } = useI18n();
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines]);
  return <div className="doctor-overlay" onMouseDown={onClose}>
    <div className="doctor-dialog log-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header><b>{t('运行日志')}</b><button onClick={onClose}>{t('关闭')}</button></header>
      <div className="doctor-actions log-toolbar">
        <span className="log-path" title={path}>{path || 'logs/echobench.log'}</span>
        <div className="log-actions">
          <button onClick={() => { void navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined); }}>{t('复制全部')}</button>
          <button onClick={onRefresh}><RefreshCw />{t('刷新')}</button>
        </div>
      </div>
      <div className="log-list">
        {lines.length ? lines.map((line, index) => <div key={`${index}-${line}`} className={`log-line ${logLevel(line)}`}>{line}</div>) : <div className="doctor-loading">{t('暂无日志')}</div>}
        <div ref={endRef} />
      </div>
    </div>
  </div>;
}

function logLevel(line: string): string {
  if (/\sERROR\s/.test(line)) return 'error';
  if (/\sWARN\s/.test(line)) return 'warn';
  return '';
}

function ClearDialog({ stage, count, onCancel, onNext, onConfirm }: { stage: 1 | 2; count: number; onCancel: () => void; onNext: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const second = stage === 2;
  return <div className="confirm-overlay" onMouseDown={onCancel}>
    <div className={`confirm-dialog ${second ? 'danger' : ''}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><b>{second ? t('再次确认清空') : t('清空当前记录？')}</b><button onClick={onCancel}>{t('取消')}</button></header>
      <p>{second ? t('将永久删除 {count} 条步骤和本地缓存，此操作不可恢复。', { count }) : t('即将清空 {count} 条步骤，下一步还会再确认一次。', { count })}</p>
      <div className="confirm-actions">
        <button onClick={onCancel}>{t('取消')}</button>
        {second
          ? <button className="danger" onClick={onConfirm}><Trash2 />{t('确认清空')}</button>
          : <button className="danger-outline" onClick={onNext}>{t('继续')}</button>}
      </div>
    </div>
  </div>;
}

function PanelTitle({ index, title, icon }: { index: string; title: string; icon: React.ReactNode }) { return <div className="panel-title"><span>{index}</span>{icon}<h2>{title}</h2></div>; }

function ColumnResizer({ width, min, max, onChange, onReset, label }: { width: number; min: number; max: number; onChange: (width: number) => void; onReset: () => void; label: string }) {
  const dragRef = useRef<{ startX: number; width: number } | null>(null);
  return <div
    className="column-resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    title="拖动调整宽度，双击恢复默认"
    onDoubleClick={onReset}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      dragRef.current = { startX: event.clientX, width };
      const move = (native: PointerEvent) => {
        if (!dragRef.current) return;
        onChange(Math.max(min, Math.min(max, dragRef.current.width - (native.clientX - dragRef.current.startX))));
      };
      const up = () => {
        dragRef.current = null;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }}
  />;
}
function KeyValue({ name, value, copy, onEdit }: { name: string; value: string; copy?: string; onEdit?: () => void }) {
  const { t } = useI18n();
  return <div className="key-value"><span>{t(name)}</span><div className="key-value-body"><code title={value}>{value}</code>{onEdit && <button className="copy-button" title={t('编辑')} onClick={onEdit}><Pencil /></button>}{copy !== undefined && <CopyButton value={copy} />}</div></div>;
}
function CopyButton({ value, title = '复制' }: { value: string; title?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return <button className="copy-button" title={copied ? t('已复制') : t(title)} onClick={async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* 剪贴板不可用时保持静默。 */ }
  }}>{copied ? <CheckCircle2 /> : <Copy />}</button>;
}

const locatorStrategies: LocatorStrategy[] = ['accessibility id', 'id', '-android uiautomator', '-ios predicate string', '-ios class chain', 'xpath'];

function LocatorEditor({ value, onApply, onCancel }: { value: { strategy: LocatorStrategy; value: string }; onApply: (locator: Locator) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [strategy, setStrategy] = useState<LocatorStrategy>(value.strategy);
  const [text, setText] = useState(value.value);
  return <div className="locator-editor">
    <label>{t('定位策略')}<select value={strategy} onChange={(event) => setStrategy(event.target.value as LocatorStrategy)}>{locatorStrategies.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <label>{t('定位值')}<textarea rows={3} value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} /></label>
    <div className="locator-editor-actions"><button onClick={onCancel}>{t('取消')}</button><button className="primary" onClick={() => onApply({ strategy, value: text.trim() })} disabled={!text.trim()}>{t('应用修改')}</button></div>
  </div>;
}

function LabelEditor({ name = '标签', value, allowEmpty = false, onChange, onApply, onCancel }: { name?: string; value: string; allowEmpty?: boolean; onChange: (value: string) => void; onApply: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return <div className="label-editor">
    <span>{t(name)}</span>
    <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); onApply(); }
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    }} />
    <button className="primary" onClick={onApply} disabled={!allowEmpty && !value.trim()}>{t('应用')}</button>
    <button onClick={onCancel}>{t('取消')}</button>
  </div>;
}

const ANDROID_VIDEO_CODEC = 'avc1.42C029';
const SCRCPY_FRAME_HEADER_SIZE = 12;
const MAX_SCRCPY_PACKET_SIZE = 16 * 1024 * 1024;
const SCRCPY_PACKET_FLAG_CONFIG = 1n << 63n;
const SCRCPY_PACKET_FLAG_KEY_FRAME = 1n << 62n;
const SCRCPY_PACKET_PTS_MASK = (1n << 62n) - 1n;

const EchoMark = () => <svg className="echo-mark" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="3.5" y="3.5" width="12" height="25" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
  <path d="M7.5 6.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  <path d="M8.5 12.5l5.5 3.5-5.5 3.5v-7z" fill="currentColor" />
  <path d="M19 10a8 8 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
  <path d="M23 6.5a13 13 0 0 1 0 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".65" />
  <path d="M27 3a18 18 0 0 1 0 26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".35" />
</svg>;

const IosVideo = ({ nonce, src = '/api/video/ios', setStreamStatus, setError }: {
  nonce: number;
  src?: string;
  setStreamStatus: React.Dispatch<React.SetStateAction<'idle' | 'loading' | 'playing' | 'failed'>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
}) => {
  const { t } = useI18n();
  const failedRef = useRef(false);
  useEffect(() => {
    failedRef.current = false;
    // Chrome 对 multipart/x-mixed-replace 图片通常不触发 onLoad，首帧到达后主动解除遮罩。
    const timer = window.setTimeout(() => { if (!failedRef.current) setStreamStatus('playing'); }, 800);
    return () => window.clearTimeout(timer);
  }, [nonce, setStreamStatus]);
  return <img
    key={`ios-${nonce}`}
    src={`${src}${src.includes('?') ? '&' : '?'}v=${nonce}`}
    onLoad={() => setStreamStatus('playing')}
    onError={() => { failedRef.current = true; setStreamStatus('failed'); setError(t('iOS 视频流连接失败')); }}
    alt={t('iOS 实时设备画面')}
    draggable={false}
  />;
};

const AndroidVideo = ({ nonce, src = '/api/video/android', initialShot, screenshot, setStreamStatus, setError }: {
  nonce: number;
  src?: string;
  initialShot: string | null;
  screenshot?: () => Promise<string>;
  setStreamStatus: React.Dispatch<React.SetStateAction<'idle' | 'loading' | 'playing' | 'failed'>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
}) => {
  const { locale, t } = useI18n();
  const localRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const video = localRef.current;
    if (!video) return;
    if (!('VideoDecoder' in window)) {
      setStreamStatus('failed');
      setError(t('当前浏览器不支持 WebCodecs，请使用最新版 Chrome 或 Edge'));
      return;
    }

    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let disposed = false;
    let pending = new Uint8Array(0);
    let codecConfig = new Uint8Array(0);
    let basePts: bigint | null = null;
    let lastTimestamp = -1;
    let receivedKeyFrame = false;
    let initialScreenshot: HTMLImageElement | null = null;
    let videoVisible = false;

    const drawToCanvas = (source: CanvasImageSource, width: number, height: number) => {
      const canvas = canvasRef.current;
      if (!canvas || width <= 0 || height <= 0) return false;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.drawImage(source, 0, 0, width, height);
      return true;
    };
    const canvasIsBlack = () => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return true;
      const probe = document.createElement('canvas');
      probe.width = 16;
      probe.height = 16;
      const context = probe.getContext('2d');
      if (!context) return true;
      context.drawImage(canvas, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) sum += pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
      return sum / (16 * 16 * 3) < 8;
    };
    const loadInitialScreenshot = async () => {
      try {
        const shot = initialShot ?? await (screenshot ? screenshot() : window.studio.screenshot());
        if (disposed) return;
        const image = new Image();
        image.onload = () => {
          if (disposed || videoVisible) return;
          initialScreenshot = image;
          if (canvasIsBlack()) {
            drawToCanvas(image, image.naturalWidth, image.naturalHeight);
            setStreamStatus('playing');
          } else {
            videoVisible = true;
            setStreamStatus('playing');
          }
        };
        image.src = `data:image/png;base64,${shot}`;
      } catch {
        // 实时帧会继续到达，首屏截图失败不终止视频。
      }
    };
    const guardScreenshot = () => {
      if (!initialScreenshot || videoVisible) return;
      // 实时流稳定出画前，持续用截图覆盖黑帧，避免连接后黑屏等待。
      if (canvasIsBlack()) {
        drawToCanvas(initialScreenshot, initialScreenshot.naturalWidth, initialScreenshot.naturalHeight);
        setStreamStatus('playing');
      } else {
        videoVisible = true;
        setStreamStatus('playing');
      }
    };

    const fail = (cause: unknown) => {
      if (disposed || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      setStreamStatus('failed');
      setError(t('Android 视频流失败：{message}', { message: errorText(locale, cause) }));
    };
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (!disposed) {
            drawToCanvas(frame, frame.displayWidth, frame.displayHeight);
            if (!videoVisible) guardScreenshot();
          }
        }
        finally { frame.close(); }
      },
      error: fail,
    });
    decoder.configure({ codec: ANDROID_VIDEO_CODEC, optimizeForLatency: true, hardwareAcceleration: 'prefer-software' });

    const decodePacket = (flagsAndPts: bigint, payload: Uint8Array) => {
      if ((flagsAndPts & SCRCPY_PACKET_FLAG_CONFIG) !== 0n) { codecConfig = payload.slice(); return; }
      const keyFrame = (flagsAndPts & SCRCPY_PACKET_FLAG_KEY_FRAME) !== 0n;
      if (!receivedKeyFrame && !keyFrame) return;
      const pts = flagsAndPts & SCRCPY_PACKET_PTS_MASK;
      basePts ??= pts;
      let timestamp = Number(pts - basePts);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) timestamp = Math.max(0, lastTimestamp + 1);
      timestamp = Math.max(timestamp, lastTimestamp + 1);
      lastTimestamp = timestamp;
      if (!keyFrame && decoder.decodeQueueSize > 2) return;
      const data = keyFrame && codecConfig.byteLength > 0 ? concatenateBytes(codecConfig, payload) : payload;
      decoder.decode(new EncodedVideoChunk({ type: keyFrame ? 'key' : 'delta', timestamp, data }));
      if (keyFrame) receivedKeyFrame = true;
    };
    const parsePackets = () => {
      let offset = 0;
      const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
      while (pending.byteLength - offset >= SCRCPY_FRAME_HEADER_SIZE) {
        const packetSize = view.getUint32(offset + 8);
        if (packetSize === 0 || packetSize > MAX_SCRCPY_PACKET_SIZE) throw new Error(`非法 scrcpy 帧长度：${packetSize}`);
        const packetEnd = offset + SCRCPY_FRAME_HEADER_SIZE + packetSize;
        if (packetEnd > pending.byteLength) break;
        decodePacket(view.getBigUint64(offset), pending.subarray(offset + SCRCPY_FRAME_HEADER_SIZE, packetEnd));
        offset = packetEnd;
      }
      if (offset > 0) pending = pending.slice(offset);
    };

    const start = async () => {
      try {
        const response = await fetch(`${src}${src.includes('?') ? '&' : '?'}v=${nonce}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const value = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
          throw new Error(value.error ?? `HTTP ${response.status}`);
        }
        if (!response.body) throw new Error('浏览器未提供流式响应读取能力');
        reader = response.body.getReader();
        while (!disposed) {
          const result = await reader.read();
          if (result.done) break;
          if (result.value.byteLength > 0) { pending = concatenateBytes(pending, result.value); parsePackets(); }
        }
      } catch (cause) { fail(cause); }
    };

    void loadInitialScreenshot();
    void start();
    return () => {
      disposed = true;
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      if (decoder.state !== 'closed') decoder.close();
      pending = new Uint8Array(0);
    };
  }, [nonce, src, initialShot, screenshot, setError, setStreamStatus]);

  return <><canvas ref={canvasRef} className="android-video-canvas" /><video ref={localRef} className="android-video-decoder" muted playsInline /></>;
};

function concatenateBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

function isTextEntry(element: HTMLElement): boolean { return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName); }
function withInputStep(list: Step[], step: InputStep | null): Step[] {
  if (!step) return list;
  const last = list.at(-1);
  if (last?.action === 'input' && sameLocator(last.target, step.target)) {
    return [...list.slice(0, -1), { ...last, value: step.value, clearFirst: true, secret: step.secret ?? last.secret, description: step.description }];
  }
  return [...list, step];
}
function sameLocator(left: Target, right: Target): boolean {
  return Boolean(left.locator && right.locator && left.locator.strategy === right.locator.strategy && left.locator.value === right.locator.value);
}
function resultLabel(result: ReplayStepResult, t: (source: string, params?: Record<string, string | number>) => string): string {
  if (result.status === 'running') return t('执行中…');
  if (result.status === 'skipped') return t('未执行');
  if (result.status === 'failed') return `${t('失败')} · ${result.retried ? `${t('重试 {count}', { count: result.retried })} · ` : ''}${result.message ?? t('未知错误')}`;
  const retry = result.retried ? ` · ${t('重试 {count}', { count: result.retried })}` : '';
  return `${t('通过')} · ${formatDuration(result.duration)}${retry}`;
}
function debugLabel(result: DebugRun, t: (source: string, params?: Record<string, string | number>) => string): string {
  if (result.status === 'running') return result.activity ?? t('执行中…');
  if (result.status === 'passed') return `${t('通过')} · ${formatDuration(result.duration)}`;
  return `${t('失败')} · ${result.message ?? t('未知错误')}`;
}
function clampNumber(value: string, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}
function formatDuration(duration?: number): string { return duration === undefined ? '—' : duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(2)}s`; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function directionName(direction: string): string { return ({ up: '上', down: '下', left: '左', right: '右' } as Record<string, string>)[direction]; }

type SwipeStep = Extract<Step, { action: 'swipe' }>;

function defaultSwipePoints(direction: SwipeStep['direction'], width: number, height: number): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const points = {
    up: [0.5, 0.78, 0.5, 0.25],
    down: [0.5, 0.25, 0.5, 0.78],
    left: [0.8, 0.5, 0.2, 0.5],
    right: [0.2, 0.5, 0.8, 0.5],
  }[direction];
  return {
    start: { x: Math.round(width * points[0]), y: Math.round(height * points[1]) },
    end: { x: Math.round(width * points[2]), y: Math.round(height * points[3]) },
  };
}

function swipeDistance(step: SwipeStep, session: SessionState | null): number {
  const points = step.start && step.end
    ? { start: step.start, end: step.end }
    : session ? defaultSwipePoints(step.direction, session.width, session.height) : null;
  return points ? Math.round(Math.hypot(points.end.x - points.start.x, points.end.y - points.start.y)) : 0;
}
function maskInput(value: string): string { return value.length > 18 ? `${value.slice(0, 15)}…` : value; }
function isPasswordTarget(target: Target): boolean {
  return /(pwd|password|passwd|密码)/i.test(`${target.locator?.value ?? ''} ${target.label ?? ''}`);
}
function AssertionBar(props: {
  condition: WaitCondition;
  expect: string;
  match: TextMatch;
  busy: boolean;
  onCondition: (value: WaitCondition) => void;
  onExpect: (value: string) => void;
  onMatch: (value: TextMatch) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  return <div className="assertion-bar">
    <select value={props.condition} onChange={(event) => props.onCondition(event.target.value as WaitCondition)} title={t('选择断言条件')}>
      {Object.entries(conditionNames).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
    </select>
    {props.condition === 'text' && <>
      <input value={props.expect} onChange={(event) => props.onExpect(event.target.value)} placeholder={t('期望文本')} />
      <select value={props.match} onChange={(event) => props.onMatch(event.target.value as TextMatch)}>
        <option value="contains">{t('包含')}</option><option value="equals">{t('等于')}</option><option value="regex">{t('正则')}</option>
      </select>
    </>}
    <button onClick={props.onAdd} disabled={props.busy || (props.condition === 'text' && !props.expect)}>{t('添加断言')}</button>
  </div>;
}

function isKeypadTarget(target: Target): boolean {
  return /numberkeyboard|numberpad|keyboardvc|keypad|softkeyboard/i.test(`${target.label ?? ''} ${target.locator?.value ?? ''}`);
}
