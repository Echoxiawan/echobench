# Multi-device sync

Click **Multi-device sync** in the toolbar and select one or more online devices. Any device can be the operation entry point; the action is broadcast to every participating device so they execute it together. This is a separate feature from the recording workspace: it only operates devices. It does not record, generate steps or assertions, or show a timeline/inspector.

## Behavior

- Each device shows online/offline/connecting/error state, resolution, foreground app, live state, and the latest action result.
- The **Live** switch controls video only. The **Sync** switch controls whether the device receives broadcast actions. They are independent.
- Use **All live** / **All off** and **All sync** / **Pause all**; live views are not mutually exclusive and can all be on.
- Tap any device mirror to broadcast the tap to all participating online devices; drag to send a swipe.
- The bottom bar supports Back, text input, Backspace, Enter, and Delete. Devices without live view can refresh a static screenshot.
- Starting multi-device sync releases the current single-device session to avoid device or WDA port conflicts.
- Operation only: no steps, assertions, locators, timeline, or inspector.

## Platforms and risks

- Android uses ADB and a per-device scrcpy stream. iOS uses a per-device Appium/XCUITest session and MJPEG port.
- An iOS simulator is online only after it has actually booted. `xctrace` lists all created simulators; offline ones show as not started and cannot be selected. Use `xcrun simctl boot <UDID>` or start them from Xcode.
- Windows does not support iOS, so iOS devices cannot be selected. macOS can mix Android and iOS.
- Mixed platforms use relative-coordinate broadcast. Layout, status bars, input methods, and back behavior can differ, so the same coordinate may hit a different control. EchoBench asks for confirmation before mixing and keeps a warning visible.
- Android ADB text input does not support Chinese or other non-ASCII text directly; that device reports an error while other devices continue.
- Multi-device Android defaults to 960 long edge / 15 FPS / 2 Mbps. iOS uses a lower MJPEG quality. Keeping all live views on still increases CPU significantly; EchoBench warns when more than two are live.
- Up to 8 devices per session. The first iOS multi-device connection builds WDA per device and is noticeably slower than Android.
- Broadcast uses relative coordinates, not frame-level synchronization. Runtime add/remove devices and automatic iOS reconnection are not implemented yet.

## Use cases

- Reproduce the same action across multiple Android/iOS devices;
- Compare page behavior across sizes, OS versions, or input methods;
- Run a quick manual regression without generating recording steps.

For replayable flows, return to the single-device workspace and record or load YAML. Multi-device sync does not save steps.
