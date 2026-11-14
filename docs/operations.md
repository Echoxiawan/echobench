# 运行日志与清理

服务会把运行日志同时写入控制台、内存和：

```text
logs/echobench.log
```

日志包含服务启动、Appium 子进程输出、会话创建/释放、iOS `xcodebuild`/WDA 报错、回放结果和 HTTP 500 堆栈。顶部“日志”按钮可以查看最近 500 行，支持复制全部和刷新。

## 容量限制

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| 单文件上限 | 5 MB | 超过后轮转为 `.1`，不会无限增长 |
| 备份数量 | 1 份 | 默认最多占用约 10 MB；可通过 `LOG_MAX_BACKUPS` 调整 |
| 单行长度 | 4000 字符 | Appium 整段 page source 等超长输出会被截断并标记 `[truncated]` |
| 内存日志 | 2000 条 | 仅保留最近条目，超出自动丢弃 |
| API 查询 | 最多 2000 行 | `/api/logs?limit=` 会被限制在这个范围 |

可用环境变量覆盖：

```bash
LOG_MAX_BYTES=10485760 LOG_MAX_BACKUPS=2 LOG_MAX_ENTRIES=1000 LOG_MAX_LINE_LENGTH=2000 npm start
```

`logs/` 已加入 `.gitignore`。iOS 页面 source 不再自动轮询后，日志量也会明显下降。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | EchoBench 本地服务端口，默认 `4710` |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | Android SDK 路径 |
| `JAVA_HOME` | JDK 路径 |
| `SCRCPY_SERVER_PATH` | 自定义 `scrcpy-server` 路径 |
| `LOG_MAX_BYTES` | 单个日志文件上限 |
| `LOG_MAX_BACKUPS` | 日志备份数量 |
| `LOG_MAX_ENTRIES` | 内存日志条数 |
| `LOG_MAX_LINE_LENGTH` | 单行日志长度上限 |

## 正确停止

正常停止顺序：先在页面点击“断开设备”，再在运行 `npm start` 的终端按一次 `Ctrl+C`。服务会关闭 Appium 会话、scrcpy-server、ADB reverse，以及由本项目启动的 Appium 子进程。

不要使用 `kill -9` 或任务管理器“结束进程树”，这些方式不给程序执行清理回调的机会。

## macOS 残留检查

```bash
lsof -nP -iTCP:4710 -sTCP:LISTEN
lsof -nP -iTCP:4723 -sTCP:LISTEN
adb reverse --list
ps -axo pid,ppid,etime,command | grep -E 'appium/index.js|app-step-scrcpy-server'
```

正常情况下，前两条没有输出，`adb reverse --list` 中没有 `scrcpy_...`，最后一条只有 `grep` 自身。

不要无差别结束所有 `adb` 或 `scrcpy`，它们可能属于 Android Studio 或其他项目。

## Windows 残留检查

```powershell
Get-NetTCPConnection -LocalPort 4710,4723 -ErrorAction SilentlyContinue
adb reverse --list
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'appium\index.js|app-step-scrcpy-server'
} | Select-Object ProcessId, ParentProcessId, Name, CommandLine
```

如果端口仍被占用，先查精确 PID：

```powershell
Get-NetTCPConnection -LocalPort 4710,4723 -ErrorAction SilentlyContinue |
  Select-Object LocalPort, State, OwningProcess
Get-Process -Id <上一步看到的PID>
```

确认 PID 确实属于本项目后，才执行：

```powershell
Stop-Process -Id <确认后的PID>
```

不要执行 `Stop-Process -Name node`、`taskkill /IM node.exe /F` 或结束全部 ADB，否则会误伤其他开发服务。
