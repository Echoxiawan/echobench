import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

function defaultLogPath(): string {
  const dataDir = process.env.ECHOBENCH_DATA_DIR?.trim();
  return join(dataDir || process.cwd(), 'logs', 'echobench.log');
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
}

export interface LoggerOptions {
  maxBytes?: number;
  maxEntries?: number;
  maxLineLength?: number;
  maxBackups?: number;
}

export function formatLogEntry(entry: LogEntry): string {
  return `[${new Date(entry.at).toISOString()}] ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}`;
}

export class Logger {
  private entries: LogEntry[] = [];
  private sink: ((entry: LogEntry) => void) | null = null;
  private size = 0;
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxLineLength: number;
  readonly maxBackups: number;

  constructor(
    readonly filePath = defaultLogPath(),
    options: LoggerOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? envNumber('LOG_MAX_BYTES', 5 * 1024 * 1024);
    this.maxEntries = options.maxEntries ?? envNumber('LOG_MAX_ENTRIES', 2000);
    this.maxLineLength = options.maxLineLength ?? envNumber('LOG_MAX_LINE_LENGTH', 4000);
    this.maxBackups = options.maxBackups ?? envNumber('LOG_MAX_BACKUPS', 1);
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      this.size = existsSync(filePath) ? statSync(filePath).size : 0;
    } catch { /* 日志不可写时不阻塞主流程。 */ }
  }

  setSink(sink: (entry: LogEntry) => void): void {
    this.sink = sink;
  }

  get path(): string {
    return this.filePath;
  }

  get currentSize(): number {
    return this.size;
  }

  info(scope: string, message: string, detail?: unknown): void { this.write('info', scope, message, detail); }
  warn(scope: string, message: string, detail?: unknown): void { this.write('warn', scope, message, detail); }
  error(scope: string, message: string, detail?: unknown): void { this.write('error', scope, message, detail); }

  lines(limit = 500): string[] {
    return this.entries.slice(-Math.max(1, limit)).map(formatLogEntry);
  }

  private write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
    const entry: LogEntry = { at: Date.now(), level, scope, message: truncate(formatDetail(message, detail), this.maxLineLength) };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    try { this.sink?.(entry); } catch { /* SSE 客户端断开不影响日志。 */ }
    const line = formatLogEntry(entry);
    console.log(line);
    try {
      const bytes = Buffer.byteLength(line) + 1;
      if (this.size + bytes > this.maxBytes && this.size > 0) this.rotate();
      appendFileSync(this.filePath, `${line}\n`);
      this.size += bytes;
    } catch { /* 磁盘异常时仅保留内存日志。 */ }
  }

  private rotate(): void {
    for (let index = this.maxBackups - 1; index >= 1; index--) {
      try { renameSync(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`); } catch { /* 备份文件不存在。 */ }
    }
    try { renameSync(this.filePath, `${this.filePath}.1`); } catch { /* 当前文件不存在。 */ }
    this.size = 0;
  }
}

function formatDetail(message: string, detail: unknown): string {
  if (detail === undefined) return message;
  if (detail instanceof Error) return `${message}\n${detail.stack ?? detail.message}`;
  if (typeof detail === 'string') return `${message} ${detail}`;
  try { return `${message} ${JSON.stringify(detail)}`; } catch { return message; }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max} chars]` : value;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export const logger = new Logger();
