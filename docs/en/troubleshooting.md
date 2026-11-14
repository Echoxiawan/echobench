# Troubleshooting

## The page opens but the device list is empty

Check the system tool directly:

```bash
adb devices -l
```

If the Android device is not listed here, EchoBench cannot discover it. For a physical device, check the USB cable, USB debugging, and authorization. For an emulator, make sure it reached the home screen. On macOS, check iOS devices with `xcrun xctrace list devices`.

## iOS device will not connect

Click **Logs** and inspect `session` and `xcodebuild` errors. Common causes:

1. **Device is offline**: devices under `== Devices Offline ==` in `xcrun xctrace list devices` cannot connect. EchoBench marks them as `offline` and disables them. Unlock the phone, trust the computer, reconnect USB, or restart the device.
2. **Selected simulator is not booted**: start it in Xcode's Simulator or with `xcrun simctl` before connecting.
3. **WDA signing is not configured**: a physical iOS device needs a valid Xcode development team, provisioning profile, and unique bundle ID, and WebDriverAgentRunner must run once in Xcode. The device panel provides:
   - **XCODE TEAM ID**: Apple Developer Team ID; leave empty to auto-select a signing team;
   - **Signing identity**: defaults to `Apple Development`;
   - **WDA BUNDLE ID**: for example `com.example.WebDriverAgentRunner`; do not conflict with the main app; leave empty to generate from the bundle ID;
   - **Automatic device/signing registration**: lets Xcode register the device and update the profile; enabled by default when a team is auto-selected.

   A typical error:

   ```text
   Signing for "WebDriverAgentRunner" requires a development team.
   Select a development team in the Signing & Capabilities editor.
   xcodebuild exited with code 65
   ```

   This means WDA compiled up to the signing step; add the team/certificate. Inspect local signing identities:

   ```bash
   security find-identity -v -p codesigning
   xcrun xctrace list devices
   ```

   If Team ID is empty, EchoBench scans local Apple Development certificates and provisioning profiles and prefers a team whose profile includes the device, matches the app ID, and is valid. If no profile exists, it chooses a team with a valid certificate and allows Xcode to register the device/generate a profile. The result is written to the `ios` log scope. Results are cached for 60 seconds; restart the service after creating a certificate.

   If the certificate for the Team ID is not on this machine, sign in to that team in **Xcode → Settings → Accounts**, select the team in WebDriverAgent's Signing & Capabilities, or enable **Automatic device/signing registration** and retry. `showXcodeLog` is enabled by default, so the full `xcodebuild` output goes to the runtime log.
4. **Xcode / XCUITest version mismatch**: after upgrading Xcode, if `xcodebuild failed`, compilation errors, or WDA startup failures appear, first test with an iOS Simulator to rule out device issues, then upgrade Appium/XCUITest or switch Xcode versions.
5. **USB/trust/Developer Mode**: enable Developer Mode, connect while unlocked, and refresh the device list after reconnecting.

```bash
xcrun xctrace list devices
npx appium driver list --installed
curl http://127.0.0.1:4723/status
```

## iOS 18+ real device reports Unknown device or Tunnel registry port not found

iOS 17/18 and newer real devices require a RemoteXPC tunnel. Typical errors:

```text
Unknown device or simulator UDID: '00008140-...'
Tunnel registry port not found. Please run the tunnel creation script first.
```

**Tunnel creation requires a USB connection.** A device connected only over Wi-Fi/LAN may appear online but still cannot establish the RemoteXPC tunnel Appium needs; `devicectl` usually reports `transportType: localNetwork` and `tunnelState: disconnected`.

EchoBench reads the device version automatically and prefers devicectl for discovery, but the tunnel still has to be started separately:

1. Connect the iPhone over USB, unlock it, trust the computer, and enable Developer Mode.
2. In a new terminal at the project root, run (root is required):
   ```bash
   sudo node node_modules/appium/index.js driver run xcuitest tunnel-creation
   ```
3. Keep that terminal running. It starts the tunnel registry.
4. Return to EchoBench and connect the device again.
5. If Appium was already running, restart EchoBench or Appium and retry.

If the tunnel is still unavailable, check:

```bash
xcrun xcdevice list --timeout 5
xcrun devicectl list devices
```

The device must be available/paired, connected over USB, and not held by another Xcode/Appium session. `tunnel-creation` requires local administrator privileges and cannot be installed silently with the app.

## Replay fails on the first step

Confirm that the device is on the same page as when recording started. Replay does not restore the starting page; if the first step targets a control on a specific page, that page must already be open.

iOS recording refreshes the UI tree and validates the primary locator automatically, so you do not need to refresh manually for every step. If the page state itself is wrong, replay still fails. Scripts from older versions that recorded custom-keyboard key taps as taps should be recorded again; numeric-keyboard input is merged into one input step.

## "Locator risk" appears in the timeline

This means Appium could not find a locator that is both unique and contained in the tapped control's bounds. Common causes are tapping a background image, a full-screen container, or a page that is still transitioning.

Wait for the page to settle and record the tap again. You can also select the step, click **Revalidate** in the inspector, manually choose a candidate, or edit the locator. If the position has no accessibility semantics, use **Element pick** to add a coordinate step and enable **Coordinate fallback** in the replay policy.

## `adb` or `scrcpy` is not a command

The tool is not installed, or its directory is not on `PATH`. After changing Windows environment variables, open a new PowerShell. After changing `~/.zshrc` on macOS, open a new terminal or run `source ~/.zshrc`. Run the corresponding `--version` command; fix one tool at a time before starting EchoBench.

## Android video shows "connection failed"

```bash
adb -s <device-UDID> get-state
scrcpy --version
```

scrcpy must be 3.2 and must be able to find its matching `scrcpy-server`. Only one browser can consume an Android video stream at a time; a second page receives HTTP 409. Close the duplicate page and click **Reconnect video**.

## Android screen is black

Confirm that the device is unlocked, the screen is on, and the current page does not set `FLAG_SECURE` (common in banking and payment screens). Those pages block screenshots and screen recording; Appium screenshots and scrcpy both return black, and EchoBench cannot bypass it.

EchoBench currently uses software WebCodecs decoding to avoid black frames from some GPU/browser combinations. If it is still black, click **Reconnect video**, then compare with the device screenshot:

```bash
adb -s <device-UDID> exec-out screencap -p > screen.png
```

If `screencap` is also black, the device or a secure window is responsible. If `screencap` works but EchoBench is black, report the browser version and console errors.

## A tap works but only a "coordinate target" is recorded

Recording reads the latest UI tree before tapping, so it does not wait for the 1.5-second cache. Canvas, games, maps, custom-drawn WebView areas, or controls that the default window does not expose (for example, controls in a separate window or bottom bar) may have no semantic node; recording a coordinate is the expected fallback.

Use **Element pick** to edit the label and add a coordinate tap step. Android sessions enable multi-window mode; after reconnecting, these bottom-bar controls usually appear in the UI tree.

## Attach session fails

- Make sure the Appium Server URL matches the one used to create the session;
- Make sure the Session ID has not expired: `DELETE /session`, Appium restart, driver crash, or command timeout invalidates it;
- Confirm the platform selection;
- Appium 3's active-session list requires the `session_discovery` insecure feature; the current version asks for a Session ID manually;
- Do not expose Appium Server to the public internet; a Session ID is equivalent to device control.

## Appium session creation fails

```bash
npx appium driver list --installed
curl http://127.0.0.1:4723/status
```

On Android, also check `adb devices -l`. On iOS, look for `xcodebuild` or signing errors in the server log and fix them in Xcode first. EchoBench reuses a healthy existing Appium instance. If port 4723 is occupied by a non-Appium program, confirm the PID and close only that process.

## `npm ci` fails

Confirm `node -v` is at least 22.12 and that `package-lock.json` exists in the current directory. Do not use administrator privileges or `sudo npm ci` to hide permission problems. In a proxy environment, make sure npm can reach the configured registry.

## `ERR_ABORTED` appears when disconnecting

This is expected. Android video is a long-lived request; when disconnecting or reconnecting the view, the browser aborts the old request and the server cleans up scrcpy-server and ADB reverse.
