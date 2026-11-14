# 常见问题

## 页面能打开，但设备列表为空

先直接检查系统工具：

```bash
adb devices -l
```

Android 设备不在这里时，工作台也无法发现。真机检查 USB 线、USB 调试和授权；模拟器确认已进入桌面。iOS 在 macOS 执行 `xcrun xctrace list devices`。

## iOS 设备连不上

先点顶部“日志”看 `session` 和 `xcodebuild` 报错。常见原因：

1. **设备处于 Offline**：`xcrun xctrace list devices` 中位于 `== Devices Offline ==` 的设备不能连接。本工具会在设备下拉框中把这些设备标记为 `offline` 并禁用。请解锁手机、点“信任此电脑”、重新插拔 USB；必要时重启设备。
2. **选择的是模拟器但未启动**：先在 Xcode 的 Simulator 中启动，或在 `xcrun simctl` 中启动后再连接。
3. **真机 WDA 签名未配置**：iOS 真机需要 Xcode 中有效的开发团队、provisioning profile 和唯一 Bundle ID，并先在 Xcode 中运行一次 WebDriverAgentRunner。设备面板提供：
   - **XCODE TEAM ID**：Apple Developer Team ID；留空时自动选择可用签名团队；
   - **签名身份**：默认 `Apple Development`；
   - **WDA BUNDLE ID**：例如 `com.example.WebDriverAgentRunner`，不要与主 App 冲突；留空时基于 BUNDLE ID 自动生成；
   - **自动注册设备/签名**：允许 Xcode 自动注册设备并更新 profile；自动选择团队时会默认开启。

   典型错误：

   ```text
   Signing for "WebDriverAgentRunner" requires a development team.
   Select a development team in the Signing & Capabilities editor.
   xcodebuild exited with code 65
   ```

   说明 WDA 已经编译到签名阶段，只需补齐开发团队/证书。查看本机可用签名身份：

   ```bash
   security find-identity -v -p codesigning
   xcrun xctrace list devices
   ```

   如果 Team ID 留空，服务会自动扫描本机 Apple Development 证书和 provisioning profile，优先选择“设备已包含 + App ID 匹配 + profile 有效”的团队；没有 profile 时选择有有效证书的团队，并自动允许 Xcode 注册设备/生成 profile。自动选择结果会写入运行日志（`ios` scope）。检测结果缓存 60 秒，创建证书后可稍等或重启服务再试。

   如果 Team ID 对应的证书不在本机，先在 Xcode → Settings → Accounts 登录该团队账号，再在 WebDriverAgent 工程的 Signing & Capabilities 中选择团队，或勾选“自动注册设备/签名”后重试。服务已默认开启 `showXcodeLog`，完整 `xcodebuild` 输出会写入运行日志。
4. **Xcode / XCUITest 版本不匹配**：升级 Xcode 后如果出现 `xcodebuild failed`、编译错误或 WDA 启动失败，先用 iOS 模拟器排除设备问题，再考虑升级 Appium/XCUITest 或切换 Xcode 版本。
5. **USB/信任/开发者模式**：真机需开启 Developer Mode，解锁状态连接；重新插拔后刷新设备列表。

```bash
xcrun xctrace list devices
npx appium driver list --installed
curl http://127.0.0.1:4723/status
```

## iOS 18+ 真机提示 Unknown device 或 Tunnel registry port not found

iOS 17/18 及更新版本的真机需要 RemoteXPC 隧道。常见错误：

```text
Unknown device or simulator UDID: '00008140-...'
Tunnel registry port not found. Please run the tunnel creation script first.
```

**隧道创建需要 USB 连接。** 纯 Wi-Fi/局域网连接的设备即使显示在线，也可能无法建立 Appium 需要的 RemoteXPC 隧道；`devicectl` 通常会显示 `transportType: localNetwork` 和 `tunnelState: disconnected`。

EchoBench 会自动读取设备版本并优先使用 devicectl 发现设备，但隧道仍需要单独启动：

1. 用 USB 连接 iPhone，解锁并选择“信任此电脑”，开启 Developer Mode。
2. 新开一个终端，在项目目录执行（必须使用 `sudo`）：
   ```bash
   sudo node node_modules/appium/index.js driver run xcuitest tunnel-creation
   ```
3. 保持这个终端运行，不要关闭。它会启动 tunnel registry。
4. 回到 EchoBench，重新连接设备。
5. 如果 Appium 已经在运行，重启 EchoBench 或 Appium 后再试。

如果仍然提示 tunnel 不可用，检查：

```bash
xcrun xcdevice list --timeout 5
xcrun devicectl list devices
```

设备必须显示为可用/已配对，USB 连接正常，且没有被其他 Xcode/Appium 会话占用。`tunnel-creation` 需要本机管理员权限，无法随应用静默安装。

## 回放第一步就失败

先确认设备停在与录制开始时相同的页面。回放不会自动还原到录制起点；如果第一步是某个页面的控件，当前页面必须已经打开该页面。

iOS 录制时会自动刷新控件树并校验主定位器，不需要每次手动刷新；如果页面状态本身不对，仍会失败。旧版本把自绘键盘按键记成 tap 的脚本，请在升级后重新录制，数字键盘输入会合并成 input 步骤。

## 时间线出现“定位风险”

说明录制时 Appium 无法为点击位置找到一个“唯一且落在该控件范围内”的定位器。常见原因是点在了背景图、整屏容器或页面正在切换的瞬间。

等页面稳定后重新点击录制；也可以选中步骤，在检查器里点“重新校验”、手动选择候选或编辑定位器。若该位置本来就没有无障碍语义，可改用“元素拾取”添加坐标步骤，并开启回放策略里的“坐标兜底”。

## `adb` 或 `scrcpy` 不是命令

说明程序没有安装，或安装目录没有加入 `PATH`。Windows 修改环境变量后必须新开 PowerShell；macOS 修改 `~/.zshrc` 后新开终端或执行 `source ~/.zshrc`。分别运行对应的 `--version` 命令，单个命令通过后再启动项目。

## Android 视频显示“连接失败”

```bash
adb -s <设备UDID> get-state
scrcpy --version
```

scrcpy 必须为 3.2，且必须能找到配套 `scrcpy-server`。同一时间只允许一个浏览器消费 Android 视频，第二个页面会收到 HTTP 409。关闭重复页面后点“重连画面”。

## Android 画面纯黑

先确认设备已解锁、屏幕已点亮，并且当前页面没有设置 `FLAG_SECURE`（银行、支付类页面常见）。这类页面系统禁止截屏和录屏，Appium 截图和 scrcpy 都会是黑屏，工作台无法绕过。

本项目已固定使用 WebCodecs 软件解码，规避部分显卡/浏览器组合硬件解码输出黑帧的问题。仍黑屏时，先点“重连画面”，再用下面的命令对比设备实际截图：

```bash
adb -s <设备UDID> exec-out screencap -p > screen.png
```

如果 `screencap` 也是黑的，问题在设备或安全窗口；如果 `screencap` 正常而工作台黑屏，请反馈浏览器版本和控制台错误。

## 点击有反应，但只记录“坐标目标”

录制点击会先读取最新控件树，因此不需要等待 1.5 秒缓存。Canvas、游戏、地图、WebView 内自绘区域，或默认窗口没有带出的控件（例如位于独立窗口/底栏的控件）可能没有语义节点，此时记录坐标是预期兜底。

可以在“元素拾取”里编辑标签后添加为坐标点击步骤。Android 会话已开启多窗口模式，重新连接后这类底栏控件通常会出现在控件树中。

## 附加会话失败

- 确认 Appium Server URL 与创建会话时使用的地址一致；
- 确认 Session ID 没有过期：客户端执行 `DELETE /session`、Appium 重启、驱动崩溃或空闲超时后都会失效；
- 确认平台选择正确；
- Appium 3 的活动会话列表需要启用 `session_discovery` 不安全特性；当前版本要求手动填写 Session ID；
- 不要把 Appium Server 暴露到公网，Session ID 等同于设备控制权。

## Appium 会话创建失败

```bash
npx appium driver list --installed
curl http://127.0.0.1:4723/status
```

Android 还应检查 `adb devices -l`。iOS 应从服务终端日志中找 `xcodebuild` 或签名错误，并先在 Xcode 中解决。工具会复用健康的现有 Appium；若 4723 被其他非 Appium 程序占用，请按 PID 确认并关闭它。

## `npm ci` 安装失败

确认 `node -v` 不低于 22.12，且当前目录存在 `package-lock.json`。不要用管理员权限或 `sudo npm ci` 掩盖权限问题。网络代理环境还需要确保 npm 能访问所配置的 registry。

## 断开时控制台出现视频请求 `ERR_ABORTED`

这是正常行为。Android 视频是持续请求，断开设备或重连画面时，浏览器会主动中止旧请求，服务端随即清理 scrcpy-server 和 ADB reverse。
