# 安装与依赖

EchoBench 默认在浏览器中运行，本地 Node.js 服务只监听 `127.0.0.1:4710`。Android 支持 Windows、macOS 和 Linux；iOS 自动化只能在 macOS 上运行。

## 前置条件

| 软件 | 最低/固定版本 | 作用 |
| --- | --- | --- |
| Node.js | `22.12+` | 运行本地服务、前端构建和 Appium |
| npm | `10+` | 按锁文件安装依赖 |
| Chrome 或 Edge | 近期版本 | 运行工作台和 WebCodecs 视频解码 |
| Android SDK Platform-Tools | 能运行 `adb` | 发现和控制 Android 设备 |
| scrcpy | `3.2` | 提供与项目协议匹配的 Android 视频服务端 |
| JDK | UiAutomator2 支持的版本 | 运行 Android 自动化驱动 |
| Appium | 项目固定 `3.8.0` | 创建自动化会话并回放 |
| Xcode | 完整版本 | 仅 macOS + iOS 需要 |

项目依赖已经包含 Appium、UiAutomator2 `8.7.0` 和 XCUITest `12.18.1`，不需要全局安装 Appium。使用默认 `npm ci` 会安装 `devDependencies`，其中包含两个驱动；如果使用 `npm ci --omit=dev`，驱动会缺失。

### 端口

| 端口 | 用途 |
| ---: | --- |
| `4710` | EchoBench 本地服务 |
| `4723` | Appium Server |
| `9100` | iOS WDA MJPEG（单设备默认；多设备会分配独立端口） |
| `5173` | 仅开发模式下的 Vite 前端 |

服务默认没有登录鉴权，只应在本机使用，不要反向代理或暴露到公网。

---

## Windows 10/11：Android

启动工作台后会自动检查 Windows 所需的 Android 依赖，并在环境面板提供 winget 一键安装；下面的手动步骤用于全新机器初始化或自动安装失败时排查。每安装一个新程序后，建议关闭旧 PowerShell，再打开新窗口，让新的 `PATH` 生效。

### 1. 安装 Node.js

从 [Node.js 官方网站](https://nodejs.org/) 下载 22.12 或更高版本的 LTS 64 位安装程序。安装时保留“Add to PATH”选项。安装完成后打开新 PowerShell：

```powershell
node -v
npm -v
```

预期输出类似：

```text
v22.12.0
10.x.x
```

版本可以更高，但 Node.js 不能低于 22.12。

### 2. 安装 Android Studio 和 Android SDK

1. 从 [Android Studio 官方网站](https://developer.android.com/studio) 下载并安装 Android Studio。
2. 第一次启动时完成标准安装，让 Android Studio 创建 SDK 目录。
3. 打开 **More Actions → SDK Manager**。
4. 在 **SDK Platforms** 中至少安装一个 Android 平台。
5. 在 **SDK Tools** 中勾选并安装 Android SDK Platform-Tools、Android Emulator 和 Android SDK Command-line Tools（latest）。
6. 记下 SDK Manager 顶部的 Android SDK Location。默认通常是：

```text
C:/Users/你的用户名/AppData/Local/Android/Sdk
```

### 3. 配置 Windows 环境变量

按 `Win + S` 搜索“编辑系统环境变量”，打开“环境变量”。在“用户变量”中：

1. 新建 `ANDROID_SDK_ROOT`，值填写自己的 SDK 目录，例如 `%LOCALAPPDATA%/Android/Sdk`。
2. 编辑 `Path`，新增：

```text
%ANDROID_SDK_ROOT%/platform-tools
%ANDROID_SDK_ROOT%/emulator
```

保存所有窗口，重新打开 PowerShell，然后验证：

```powershell
$env:ANDROID_SDK_ROOT
adb version
```

程序也会自动查找 `%LOCALAPPDATA%/Android/Sdk`；配置环境变量的好处是可以在任何终端直接使用 `adb`。

### 4. 安装 JDK

UiAutomator2 需要 JDK。可以从 [Adoptium](https://adoptium.net/) 安装 JDK 17 或更高版本，并确保 `JAVA_HOME` 指向 JDK 目录。验证：

```powershell
java -version
$env:JAVA_HOME
```

### 5. 创建并启动 Android 模拟器

1. 在 Android Studio 打开 **More Actions → Virtual Device Manager**。
2. 点击 **Create device**，选择一款手机。
3. 下载一个与电脑架构匹配的 System Image。
4. 完成创建，点击设备右侧的启动按钮。
5. 等待模拟器显示 Android 桌面，再运行：

```powershell
adb devices -l
```

正确输出示例：

```text
List of devices attached
emulator-5554 device product:... model:...
```

状态必须是 `device`。`offline` 表示模拟器还没准备好，等待后重试。

### 6. 连接 Android 真机（不用真机可跳过）

1. 在手机“关于手机”中连续点击版本号，开启开发者选项。
2. 在开发者选项中开启 USB 调试。
3. 使用支持数据传输的 USB 线连接电脑。
4. 手机弹出授权窗口时勾选“始终允许”并确认。
5. 运行 `adb devices -l`。如果状态是 `unauthorized`，解锁手机并重新确认授权。

### 7. 安装 scrcpy 3.2

从 [scrcpy 官方 Releases](https://github.com/Genymobile/scrcpy/releases) 下载 Windows 64 位 `3.2` ZIP，解压到固定目录，例如：

```text
C:/tools/scrcpy
```

解压目录应同时包含 `scrcpy.exe` 和 `scrcpy-server`。将 `C:/tools/scrcpy` 添加到用户 `Path`，打开新 PowerShell：

```powershell
scrcpy --version
```

预期第一行包含 `scrcpy 3.2`。程序会自动从 `scrcpy.exe` 同目录寻找 `scrcpy-server`。若目录结构不同，可在当前 PowerShell 指定：

```powershell
$env:SCRCPY_SERVER_PATH = "C:/tools/scrcpy/scrcpy-server"
```

想永久保存该变量，可在 Windows“环境变量”界面新建 `SCRCPY_SERVER_PATH`。

### 8. 安装项目依赖

如果项目是 ZIP，先完整解压。PowerShell 进入含有 `package.json` 的目录：

```powershell
cd "D:/你的项目目录/echobench"
npm ci
```

`npm ci` 会严格按照 `package-lock.json` 安装固定版本。完成后检查 Appium 驱动：

```powershell
npx appium driver list --installed
```

预期包含：

```text
uiautomator2@8.7.0
xcuitest@12.18.1
```

Windows 实际只使用 `uiautomator2`。如果列表中缺少它，再执行：

```powershell
npm run appium:setup:android
```

### 9. 构建并启动

仍在项目目录中执行：

```powershell
npm run build
npm start
```

构建成功后，终端应出现：

```text
EchoBench 已启动：http://127.0.0.1:4710
```

不要关闭这个 PowerShell。用 Chrome 或 Edge 打开 [http://127.0.0.1:4710](http://127.0.0.1:4710)。Appium 会在第一次连接设备时由项目自动启动，无需再开第二个 Appium 终端。

---

## macOS：Android

启动工作台后会自动检查 Android / iOS 所需依赖，并在环境面板提供 Homebrew 一键安装；下面的手动步骤用于全新机器初始化或自动安装失败时排查。

### 1. 安装 Node.js

从 [Node.js 官方网站](https://nodejs.org/) 安装 22.12 或更高版本的 LTS，或使用已有的 Node.js 版本管理器。打开新终端：

```bash
node -v
npm -v
```

Node.js 版本必须不低于 22.12，npm 必须不低于 10。

### 2. 安装 Android Studio、SDK 和模拟器

1. 从 [Android Studio 官方网站](https://developer.android.com/studio) 安装 Android Studio。
2. 在 **More Actions → SDK Manager** 安装 Android SDK Platform-Tools、Android Emulator、Command-line Tools 和至少一个 Android 平台。
3. 在 **Virtual Device Manager** 创建虚拟设备并启动。
4. macOS 默认 SDK 路径通常是 `~/Library/Android/sdk`，项目会自动探测该目录。

如需让终端也能直接使用 SDK 命令，在 `~/.zshrc` 加入：

```bash
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"
```

重新打开终端，或执行 `source ~/.zshrc`，然后验证：

```bash
adb version
adb devices -l
```

### 3. 安装 JDK 和 scrcpy

```bash
brew install openjdk@17
brew install scrcpy
```

也可单独安装 Platform-Tools：

```bash
brew install --cask android-platform-tools
```

验证：

```bash
java -version
adb devices -l
scrcpy --version
```

scrcpy 必须为 `3.2`。如果安装了多个版本，可用 `which scrcpy` 确认当前终端实际使用的路径。

### 4. 安装项目并启动

进入含有 `package.json` 的项目目录：

```bash
cd /你的路径/echobench
npm ci
npx appium driver list --installed
npm run build
npm start
```

预期输出：

```text
EchoBench 已启动：http://127.0.0.1:4710
```

用 Chrome 或 Edge 打开 [http://127.0.0.1:4710](http://127.0.0.1:4710)。Android 实时画面使用 WebCodecs，请使用近期版本的 Chrome 或 Edge。

---

## macOS：iOS 额外配置

iOS 部分不能在 Windows 或 Linux 上执行。除了前面的 Node.js 和项目依赖，还需要完整 Xcode。

### 1. 安装并初始化 Xcode

1. 从 Mac App Store 安装完整 Xcode。
2. 首次打开 Xcode，同意许可证并等待附加组件安装完成。
3. 在终端确认命令行工具可用：

```bash
xcode-select -p
xcrun xctrace list devices
```

第二条命令应列出 iOS Simulator 或已连接真机。

### 2. 准备 iOS 模拟器

在 Xcode 打开 **Window → Devices and Simulators → Simulators**，创建并启动模拟器。再次执行 `xcrun xctrace list devices`，工作台会读取这里列出的模拟器 UUID。

### 3. 准备 iOS 真机

1. USB 连接 iPhone，解锁并选择“信任此电脑”。
2. 在 iPhone 设置中开启 Developer Mode；系统要求重启时按提示完成。
3. 在 Xcode 的 **Settings → Accounts** 登录 Apple Developer 账号。
4. 为 Appium XCUITest Driver 使用的 WebDriverAgent 配置开发团队、有效签名和唯一 Bundle ID。
5. 首次使用前在 Xcode 中将 WebDriverAgentRunner 运行到目标设备，确认设备接受开发者证书。

若创建会话时报 `xcodebuild`、签名或 provisioning profile 错误，应先在 Xcode 中解决签名，工作台无法绕过 Apple 的签名限制。

### 4. 检查驱动并启动

```bash
cd /你的路径/echobench
npx appium driver list --installed
```

若缺少 `xcuitest@12.18.1`：

```bash
npm run appium:setup:ios
```

然后执行：

```bash
npm run build
npm start
```

iOS 会话使用本地 `9100` 端口承载 WDA MJPEG，该端口必须空闲。

iOS 18+ 真机还需要 RemoteXPC 隧道。首次连接前，在项目目录用管理员权限启动并保持运行：

```bash
sudo node node_modules/appium/index.js driver run xcuitest tunnel-creation
```

详细排障见 [常见问题](troubleshooting.md#ios-18-真机提示-unknown-device-或-tunnel-registry-port-not-found)。

---

## Linux：Android

Linux 只支持 Android。安装 Node.js 22.12+、JDK、Android SDK Platform-Tools 和 scrcpy 3.2，并确保 `adb`、`java`、`scrcpy` 在 `PATH` 中。不同发行版可使用 `apt`、`dnf` 或 `pacman` 安装系统软件；EchoBench 的环境体检会给出对应命令，但不会静默提权。

```bash
node -v
adb version
java -version
scrcpy --version
npm ci
npm run build
npm start
```

Linux 上没有 Xcode、XCUITest 或 iOS Simulator，iOS 入口会被禁用。

## 启动环境自检

启动页面约 0.6 秒后会自动执行一次环境检查，不需要先连接设备。缺少必需项时会自动打开环境面板：

- Node.js 版本是否不低于 22.12；
- 项目内置 Appium 与 UiAutomator2 驱动；macOS 额外检查 XCUITest；
- Appium 服务是否已在 4723 运行（未运行只提示；连接设备时会由本工具自动启动）；
- `adb`、Android SDK、`scrcpy` 3.2 及配套 `scrcpy-server`；
- JDK / `JAVA_HOME`；
- 仅 macOS 检查 Xcode 命令行工具和已启动模拟器数量。

检查结果按状态标记“必需 / 可安装”，缺失的系统软件旁有“安装”按钮，也可以点“一键安装缺失项”。安装策略按操作系统自动选择：

| 系统 | 包管理器 | 安装方式 |
| --- | --- | --- |
| macOS | Homebrew | `brew install` / `brew install --cask` |
| Windows | winget | `winget install` |
| Linux | apt / dnf / pacman | 给出对应 `sudo` 命令，不会静默提权 |

项目内的 Appium 驱动会在启动后自动补齐，无需手动执行 `appium driver install`。系统级软件安装会显示实际命令并保留可见的“安装”按钮，避免静默修改系统。安装后会自动刷新检查结果；如果包管理器刷新了 `PATH` 而当前进程尚未继承，会提示重启应用。

Windows 不会显示 Xcode / XCUITest 检查项，iOS 平台切换按钮置灰；Linux 同样只保留 Android。可以随时点击“重新检查”。

## 启动失败时

- 确认 `4710` 和 `4723` 未被其他程序占用。
- 确认 Node.js 版本不低于 22.12。
- 运行 `npx appium driver list --installed` 检查驱动。
- 打开顶部“环境体检”查看缺失项和安装命令。
- 更多问题见 [常见问题](troubleshooting.md)。
