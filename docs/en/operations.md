# Logs and cleanup

EchoBench writes runtime logs to the console, memory, and:

```text
logs/echobench.log
```

Logs include service startup, Appium subprocess output, session creation/release, iOS `xcodebuild`/WDA errors, replay results, and HTTP 500 stack traces. The **Logs** button in the toolbar shows the latest 500 lines and supports copy-all and refresh.

## Rotation limits

| Item | Default | Description |
| --- | --- | --- |
| File size | 5 MB | Rotates to `.1` instead of growing forever |
| Backup count | 1 | About 10 MB total by default; adjust with `LOG_MAX_BACKUPS` |
| Line length | 4000 characters | Long Appium page sources are truncated and marked `[truncated]` |
| In-memory entries | 2000 | Only the latest entries are kept |
| API query | 2000 lines | `/api/logs?limit=` is capped |

Override with environment variables:

```bash
LOG_MAX_BYTES=10485760 LOG_MAX_BACKUPS=2 LOG_MAX_ENTRIES=1000 LOG_MAX_LINE_LENGTH=2000 npm start
```

`logs/` is ignored by Git. iOS page source is no longer polled while idle, which also reduces log volume significantly.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | EchoBench local service port, default `4710` |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | Android SDK path |
| `JAVA_HOME` | JDK path |
| `SCRCPY_SERVER_PATH` | Custom `scrcpy-server` path |
| `LOG_MAX_BYTES` | Maximum size of one log file |
| `LOG_MAX_BACKUPS` | Number of log backups |
| `LOG_MAX_ENTRIES` | Number of in-memory log entries |
| `LOG_MAX_LINE_LENGTH` | Maximum length of one log line |

## Shutdown

The normal order is: click **Disconnect** in the UI, then press `Ctrl+C` once in the terminal running `npm start`. The service closes the Appium session, scrcpy-server, ADB reverse, and the Appium child process it started.

Do not use `kill -9` or the task manager's "end process tree"; those skip cleanup callbacks.

## macOS residual checks

```bash
lsof -nP -iTCP:4710 -sTCP:LISTEN
lsof -nP -iTCP:4723 -sTCP:LISTEN
adb reverse --list
ps -axo pid,ppid,etime,command | grep -E 'appium/index.js|app-step-scrcpy-server'
```

Normally the first two commands have no output, `adb reverse --list` has no `scrcpy_...`, and the last command only shows `grep` itself.

Do not kill all `adb` or `scrcpy` processes; they may belong to Android Studio or another project.

## Windows residual checks

```powershell
Get-NetTCPConnection -LocalPort 4710,4723 -ErrorAction SilentlyContinue
adb reverse --list
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'appium\index.js|app-step-scrcpy-server'
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine
```

If a port is still occupied, find the exact PID:

```powershell
Get-NetTCPConnection -LocalPort 4710,4723 -ErrorAction SilentlyContinue |
  Select-Object LocalPort, State, OwningProcess
Get-Process -Id <PID-from-the-previous-step>
```

Only after confirming that the PID belongs to EchoBench:

```powershell
Stop-Process -Id <confirmed-PID>
```

Do not run `Stop-Process -Name node`, `taskkill /IM node.exe /F`, or kill all ADB processes; that can affect other development services.
