# Quick start

## Five-minute path

Prerequisites: Node.js 22.12+, Chrome/Edge, Android SDK + scrcpy 3.2. iOS also requires macOS and a full Xcode installation.

```bash
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4710`, choose an Android or iOS device, and click **Connect**. Appium starts automatically on the first connection.

See [Installation](install.md) for complete environment setup.

## First launch: run the environment check

About 0.6 seconds after the workbench opens, it checks the runtime environment. If a required item is missing, the **Environment check** dialog opens automatically. You can also click **Environment** in the toolbar.

1. Wait for the check to finish and inspect failing items marked **Required** first.
2. For an installable missing item, click **Install**; for several items, click **Install missing items**.
3. macOS uses Homebrew and Windows uses winget. On Linux the dialog shows the matching `sudo` command and does not elevate privileges silently.
4. Project-local Appium drivers are installed automatically; no manual driver installation is required.
5. Wait for the result to refresh after installation. If the app asks you to restart, close and reopen EchoBench.
6. Click **Recheck** and confirm that all required items for your target platform pass before connecting a device.

See [Installation](install.md#environment-check) for the complete checks and manual fallback.

## Connect a device

1. Make sure the emulator or physical device is running and visible in `adb devices -l` or `xcrun xctrace list devices`.
2. Select **ANDROID** or **iOS** on the left.
3. Choose a device from the **Device** list, or type its UDID.
4. Leave the app path, package name, and activity empty to work with the current foreground app.
5. To launch a specific installed Android app, fill in `APP PACKAGE` and `APP ACTIVITY`; to install an APK, enter its absolute path.
6. For iOS, enter a `BUNDLE ID` to use an installed app, or an absolute `.app` path to install one.
7. Click **Connect**. The first connection starts Appium and the device driver, so it is slower than later connections.
8. Wait for the live view and the resolution in the status bar.

### Connection fields

| Field | Android | iOS | Description |
| --- | --- | --- | --- |
| Device UDID | Required | Required | Android serial from `adb devices`; iOS physical UDID or simulator UUID |
| App path | Optional | Optional | Absolute APK or `.app` path on the computer |
| APP PACKAGE | Optional | N/A | Android package name |
| APP ACTIVITY | Optional | N/A | Android launch activity |
| BUNDLE ID | N/A | Optional | iOS bundle identifier |

## Record the first flow

Recording is off by default. Explore the page first, then start recording when you are ready.

1. Click **Start recording** at the bottom.
2. Tap the device mirror. The tap is sent to the device and added to the timeline.
3. While recording, EchoBench refreshes the iOS UI tree and uses Appium to confirm that the primary locator is unique and inside the tapped control.
4. If no candidate is reliable, the timeline shows **Locator risk**. Select the step to see why.
5. The **Target inspector** lists recommended, alternative, and brittle candidates. You can switch the primary locator, click **Revalidate**, copy a selector, or edit the value with the pencil button.
6. Use the arrow buttons to record swipes in each direction, and the back button to record a back action.
7. Select a step first, then use **Double tap**, **Long press**, **Pinch out**, or **Pinch in** to record a gesture.
8. Keyboard input is enabled by default. Tap an input field on the device and type with the computer keyboard, including Chinese input methods. After about 0.3 seconds without typing, the input is merged into one step.
9. Selecting a swipe step shows its direction, distance, duration, and start/end coordinates in the inspector.
10. Drag steps in the timeline to reorder them. Select a step to edit its label and note in the inspector.

### Element picking

To inspect an element without operating the device, enable **Element pick** and tap the mirror. EchoBench only reads the locator and does not send a tap. The result can be added as a tap step.

### Add assertions

In the target inspector, choose a condition (exists, visible/hidden, enabled/disabled, checked/unchecked, text, empty, or page stable), enter expected text or a match mode if needed, and click **Add assertion**. This appends an independent `wait` step.

You can also use **Element pick** to select the current element and add an assertion without recording a tap first. Select the assertion step to edit its condition, expected text, match mode, and timeout. iOS text assertions read the visible text; a Button's label also matches.

## Replay

Click **Replay** in the toolbar to run from the beginning. To continue from a specific step:

1. Select the step in the timeline.
2. Click **Replay from this step** in the target inspector.
3. Earlier steps are marked as skipped; progress and statistics only count executed steps.

The device must already be in the state before that step. Replay does not reconstruct earlier navigation. During replay, recording pauses, the live view shows the current step and states such as "waiting for control", "waiting for page settle", or "retry 2/3", and the inspector records the result, attempts, duration, and failure reason.

Replay settings (timeout, retry count, page settle wait, and locator fallback) are in the **Replay policy** section. See [YAML format](yaml.md) for the fields.

## Save and export

- Click **Save YAML** to download `app-steps.yaml`.
- Expand **Export script** to download WebdriverIO JavaScript, Python, or Java test code.
- Configure AI globally in **Settings**, then click **AI test case** and enter only the test-case title to export CSV.
- Use **Environment** in the toolbar to view the **Environment check** results and missing dependencies.

## Drafts and clearing

Steps, project name, device configuration, and replay settings are cached in the browser. Refreshing the page restores the latest draft.

Click **Clear** in the step panel and confirm twice to delete the current steps and cache. Recording stays off after clearing.

## Attach an existing session

If a session was created by a test script or another client, click **Attach existing Appium session** in the device panel and enter the Appium Server URL and Session ID. Attach mode does not create or delete the external session.

See [Attach session and element tree](inspect-session.md).

## Stop

Click **Disconnect** first, then press `Ctrl+C` in the terminal running the service. EchoBench closes the Appium session, scrcpy-server, ADB reverse, and the Appium child process it started.

See [Logs and cleanup](operations.md) for manual cleanup.
