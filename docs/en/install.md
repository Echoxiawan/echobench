# Installation

EchoBench runs in your browser and keeps its local Node.js service on `127.0.0.1:4710`. Android works on Windows, macOS, and Linux; iOS automation runs only on macOS.

## Prerequisites

| Software | Minimum / pinned version | Purpose |
| --- | --- | --- |
| Node.js | `22.12+` | Local service, frontend build, and Appium |
| npm | `10+` | Install from the lockfile |
| Chrome or Edge | Recent version | Workbench and WebCodecs video decoding |
| Android SDK Platform-Tools | `adb` must run | Discover and control Android devices |
| scrcpy | `3.2` | Android video server protocol used by EchoBench |
| JDK | A version supported by UiAutomator2 | Android automation driver |
| Appium | Pinned `3.8.0` | Create sessions and replay |
| Xcode | Full installation | macOS + iOS only |

Project dependencies include Appium, UiAutomator2 `8.7.0`, and XCUITest `12.18.1`; a global Appium installation is not required. The default `npm ci` installs `devDependencies`, which include the two drivers. `npm ci --omit=dev` will omit them.

### Ports

| Port | Purpose |
| ---: | --- |
| `4710` | EchoBench local service |
| `4723` | Appium Server |
| `9100` | iOS WDA MJPEG (default for one device; multi-device uses per-device ports) |
| `5173` | Vite frontend in development mode only |

The service has no login by default. Use it locally and never expose it to the public internet.

---

## Windows 10/11: Android

EchoBench checks Windows Android dependencies at startup and offers one-click winget installation in the environment panel. The manual steps below are for a fresh machine or when automatic installation fails. After installing a program, open a new PowerShell window so the updated `PATH` is loaded.

### 1. Install Node.js

Download the 22.12+ LTS 64-bit installer from [nodejs.org](https://nodejs.org/). Keep **Add to PATH** selected. Open a new PowerShell:

```powershell
node -v
npm -v
```

Expected:

```text
v22.12.0
10.x.x
```

Node.js must be at least 22.12.

### 2. Install Android Studio and the Android SDK

1. Install Android Studio from [developer.android.com/studio](https://developer.android.com/studio).
2. Complete the standard first-run setup so Android Studio creates the SDK directory.
3. Open **More Actions → SDK Manager**.
4. Install at least one Android platform under **SDK Platforms**.
5. Under **SDK Tools**, install Android SDK Platform-Tools, Android Emulator, and Android SDK Command-line Tools (latest).
6. Note the **Android SDK Location** shown at the top of SDK Manager. The default is usually:

```text
C:/Users/<your-user>/AppData/Local/Android/Sdk
```

### 3. Configure Windows environment variables

Open **Edit system environment variables** and edit the user variables:

1. Create `ANDROID_SDK_ROOT` with your SDK path, for example `%LOCALAPPDATA%/Android/Sdk`.
2. Add these entries to `Path`:

```text
%ANDROID_SDK_ROOT%/platform-tools
%ANDROID_SDK_ROOT%/emulator
```

Open a new PowerShell and verify:

```powershell
$env:ANDROID_SDK_ROOT
adb version
```

EchoBench also probes `%LOCALAPPDATA%/Android/Sdk` automatically; setting the variable lets you use `adb` from any terminal.

### 4. Install a JDK

UiAutomator2 requires a JDK. Install JDK 17 or newer from [Adoptium](https://adoptium.net/) and point `JAVA_HOME` at the JDK directory. Verify:

```powershell
java -version
$env:JAVA_HOME
```

### 5. Create and start an Android emulator

1. Open **More Actions → Virtual Device Manager** in Android Studio.
2. Click **Create device** and choose a phone.
3. Download a system image that matches your computer architecture.
4. Create the device and start it.
5. Wait for the Android home screen, then run:

```powershell
adb devices -l
```

Expected:

```text
List of devices attached
emulator-5554 device product:... model:...
```

The state must be `device`. `offline` means the emulator is not ready yet; wait and retry.

### 6. Connect a physical Android device (optional)

1. Enable Developer options by tapping the build number repeatedly.
2. Enable USB debugging.
3. Connect the phone with a data-capable USB cable.
4. Accept the authorization prompt and select **Always allow**.
5. Run `adb devices -l`. If the state is `unauthorized`, unlock the phone and confirm the prompt again.

### 7. Install scrcpy 3.2

Download the Windows 64-bit `3.2` ZIP from [scrcpy releases](https://github.com/Genymobile/scrcpy/releases) and extract it to a fixed directory, for example:

```text
C:/tools/scrcpy
```

The directory must contain both `scrcpy.exe` and `scrcpy-server`. Add `C:/tools/scrcpy` to the user `Path`, open a new PowerShell, and verify:

```powershell
scrcpy --version
```

The first line should contain `scrcpy 3.2`. EchoBench looks for `scrcpy-server` next to `scrcpy.exe`. If your layout differs, set the path explicitly:

```powershell
$env:SCRCPY_SERVER_PATH = "C:/tools/scrcpy/scrcpy-server"
```

To persist it, add a `SCRCPY_SERVER_PATH` variable in the Windows environment variables UI.

### 8. Install project dependencies

Extract the project if it was downloaded as a ZIP, then open PowerShell in the directory containing `package.json`:

```powershell
cd "D:/path/to/echobench"
npm ci
```

`npm ci` installs the pinned versions from `package-lock.json`. Check the Appium drivers:

```powershell
npx appium driver list --installed
```

You should see:

```text
uiautomator2@8.7.0
xcuitest@12.18.1
```

Windows only uses `uiautomator2`. If it is missing:

```powershell
npm run appium:setup:android
```

### 9. Build and start

```powershell
npm run build
npm start
```

Expected output:

```text
EchoBench 已启动：http://127.0.0.1:4710
```

Keep the PowerShell window open. Open [http://127.0.0.1:4710](http://127.0.0.1:4710) in Chrome or Edge. Appium starts automatically on the first device connection; you do not need a second Appium terminal.

---

## macOS: Android

EchoBench checks Android and iOS dependencies at startup and offers Homebrew installation in the environment panel. The manual steps below are for a fresh machine or when automatic installation fails.

### 1. Install Node.js

Install Node.js 22.12+ from [nodejs.org](https://nodejs.org/), or use your existing version manager. Open a new terminal:

```bash
node -v
npm -v
```

Node.js must be at least 22.12 and npm at least 10.

### 2. Install Android Studio, the SDK, and an emulator

1. Install Android Studio from [developer.android.com/studio](https://developer.android.com/studio).
2. Install Android SDK Platform-Tools, Android Emulator, Command-line Tools, and at least one Android platform from **SDK Manager**.
3. Create and start a virtual device in **Virtual Device Manager**.
4. The default SDK path on macOS is usually `~/Library/Android/sdk`; EchoBench probes it automatically.

To use SDK commands from your shell, add this to `~/.zshrc`:

```bash
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"
```

Open a new terminal or run `source ~/.zshrc`, then verify:

```bash
adb version
adb devices -l
```

### 3. Install a JDK and scrcpy

```bash
brew install openjdk@17
brew install scrcpy
```

You can install Platform-Tools separately:

```bash
brew install --cask android-platform-tools
```

Verify:

```bash
java -version
adb devices -l
scrcpy --version
```

scrcpy must be `3.2`. If multiple versions are installed, use `which scrcpy` to confirm the active path.

### 4. Install dependencies and start

```bash
cd /path/to/echobench
npm ci
npx appium driver list --installed
npm run build
npm start
```

Expected:

```text
EchoBench 已启动：http://127.0.0.1:4710
```

Open [http://127.0.0.1:4710](http://127.0.0.1:4710) in Chrome or Edge. Android live video uses WebCodecs, so use a recent Chrome or Edge version.

---

## macOS: additional iOS setup

iOS cannot run on Windows or Linux. You need a full Xcode installation in addition to Node.js and project dependencies.

### 1. Install and initialize Xcode

1. Install the full Xcode from the Mac App Store.
2. Open Xcode once, accept the license, and wait for additional components.
3. Verify the command-line tools:

```bash
xcode-select -p
xcrun xctrace list devices
```

The second command should list an iOS Simulator or a connected device.

### 2. Prepare an iOS Simulator

Open **Window → Devices and Simulators → Simulators** in Xcode, create a simulator, and start it. Run `xcrun xctrace list devices` again; EchoBench reads the simulator UUIDs listed there.

### 3. Prepare a physical iOS device

1. Connect the iPhone over USB, unlock it, and choose **Trust**.
2. Enable Developer Mode in iPhone Settings and restart if requested.
3. Sign in to an Apple Developer account in **Xcode → Settings → Accounts**.
4. Configure a development team, valid signing, and a unique bundle ID for the WebDriverAgent used by the Appium XCUITest driver.
5. Before the first use, run WebDriverAgentRunner on the target device from Xcode and confirm that the device accepts the developer certificate.

If session creation reports `xcodebuild`, signing, or provisioning-profile errors, fix signing in Xcode first. EchoBench cannot bypass Apple's signing restrictions.

### 4. Check the driver and start

```bash
cd /path/to/echobench
npx appium driver list --installed
```

If `xcuitest@12.18.1` is missing:

```bash
npm run appium:setup:ios
```

Then:

```bash
npm run build
npm start
```

The iOS session uses local port `9100` for WDA MJPEG; it must be free.

iOS 18+ real devices also require a RemoteXPC tunnel. Before the first connection, start it with administrator privileges and keep it running:

```bash
sudo node node_modules/appium/index.js driver run xcuitest tunnel-creation
```

See [Troubleshooting](troubleshooting.md#ios-18-real-device-reports-unknown-device-or-tunnel-registry-port-not-found) for details.

---

## Linux: Android

Linux supports Android only. Install Node.js 22.12+, a JDK, Android SDK Platform-Tools, and scrcpy 3.2, and make sure `adb`, `java`, and `scrcpy` are on `PATH`. Use `apt`, `dnf`, or `pacman` depending on the distribution; the EchoBench environment check prints the corresponding commands but never escalates privileges silently.

```bash
node -v
adb version
java -version
scrcpy --version
npm ci
npm run build
npm start
```

There is no Xcode, XCUITest, or iOS Simulator on Linux, so the iOS entry point is disabled.

## Environment check

About 0.6 seconds after the page opens, EchoBench runs an environment check even before a device is connected. If a required item is missing, the environment panel opens automatically. It checks:

- Node.js 22.12 or newer;
- bundled Appium and UiAutomator2; macOS additionally checks XCUITest;
- whether Appium is running on 4723 (a warning only; EchoBench starts it automatically when a device connects);
- `adb`, Android SDK, scrcpy 3.2, and its `scrcpy-server`;
- JDK / `JAVA_HOME`;
- on macOS only, Xcode command-line tools and the number of started simulators.

Results are marked **required** or **installable**. Missing system software has an **Install** button, and the panel also offers **Install missing items**. Installation strategy:

| OS | Package manager | Method |
| --- | --- | --- |
| macOS | Homebrew | `brew install` / `brew install --cask` |
| Windows | winget | `winget install` |
| Linux | apt / dnf / pacman | Prints the matching `sudo` command; never escalates silently |

EchoBench installs project-local Appium drivers automatically; you do not need to run `appium driver install` manually. System-level installs show the actual command and keep the **Install** button visible. If the package manager updates `PATH` but the current process has not inherited it, EchoBench asks you to restart the app.

Windows hides Xcode / XCUITest checks and disables iOS. Linux also keeps Android only. You can click **Check again** at any time.

## If startup fails

- Make sure ports `4710` and `4723` are free.
- Confirm Node.js is at least 22.12.
- Run `npx appium driver list --installed`.
- Open the **Environment** panel in the toolbar for missing items and install commands.
- See [Troubleshooting](troubleshooting.md) for more.
