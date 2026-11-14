# Performance and resource usage

## Android

Android defaults to a maximum of 30 FPS, a long edge of 1280 pixels, and 4 Mbps. H.264 is encoded on the Android device and decoded in the browser through WebCodecs. The main computer cost is browser video decoding, Appium, and UI-tree parsing.

To avoid black frames from some GPU/browser combinations when using hardware H.264 decoding, EchoBench currently uses software decoding. CPU usage at 720p is slightly higher than hardware decoding.

When the page is static, the Android encoder may reduce its frame rate; the browser keeps the last frame, which is expected. The stream resumes when the device animates or receives an action. Live frames exist only in memory and are not written to disk continuously.

## iOS

iOS defaults to 15 FPS, 60% scaling, and JPEG quality 50. WDA continuously takes screenshots and JPEG-encodes them, so it usually uses more CPU and USB bandwidth than Android H.264.

### iOS latency optimizations

XCUITest normally waits up to 2 seconds for the page to become idle before every command, and a single iOS `page source` usually takes about 3–4 seconds. EchoBench applies these optimizations:

- session creation sets `waitForIdleTimeout=0`, `animationCoolOffTimeout=0`, and UI-tree depth 30; only `enabled/accessible/index/processId/bundleId` are excluded, while `visible` is retained to filter invisible nodes; a source call is still around 1 second;
- iOS is **not polled** while idle, so WDA is not saturated by source requests; during recording, the tree refreshes once after each action, while non-recording operations keep the low-load path;
- recording taps use the cached tree from after the previous action and validate the primary locator with Appium; if the page changes quickly and the cache is stale, EchoBench waits for a refresh before recording;
- element picking, **re-identify by coordinate**, and manual **Refresh UI tree** use the latest page source for accurate manual inspection;
- iOS MJPEG scaling is set to 50% and JPEG quality to 45 to reduce stream size;
- the "connecting video" overlay is dismissed after the first MJPEG frame to avoid a false failure.

As a result, iOS taps no longer wait a fixed 3–4 seconds, and non-recording interaction remains interactive-first. During recording, the first tap after navigation waits for a UI-tree refresh, and every tap is validated with Appium, so it is slightly slower than pure operation; this is the cost of reliable replay locators. WDA architecture still makes iOS slower than Android ADB.

## Multi-device sync

- Android uses a per-device scrcpy stream, defaulting to 960 long edge / 15 FPS / 2 Mbps;
- iOS uses a per-device Appium/XCUITest session and MJPEG port with lower quality;
- keeping all live views on significantly increases CPU and USB bandwidth; EchoBench warns above two live streams;
- up to 8 devices per session. The first iOS multi-device connection builds WDA for every device and is noticeably slower than Android.

## Custom numeric keyboards

Some apps use a custom-drawn keyboard. The keys are clickable controls, but the input field is deep in the hierarchy. EchoBench handles this by:

- using the active element as the input-step target instead of recording each keyboard key as a tap;
- merging consecutive key presses into one `input` step; replay clears the field and enters the final value without depending on the keyboard being open;
- refreshing the UI tree once when recording starts.

Scripts recorded by older versions that contain many keyboard-key taps need to be recorded again.

If keyboard input keeps reporting "no focused input field", `snapshotMaxDepth` is usually too small and the deep `XCUIElementTypeTextField` is being cut off, which also makes `element/active` fail. EchoBench uses depth 30 and excludes unrelated attributes by default. If the problem persists, check whether `element/active` returns an element in the log, or reconnect the session.

## Hardware guidance

- Single Android device: a normal developer machine is enough; the main cost is browser decoding and Appium;
- Multi-device sync: 16 GB RAM or more is recommended; multiple iOS devices need more CPU and USB bandwidth;
- The first iOS connection compiles WebDriverAgent and briefly uses significant CPU and disk;
- Device video is a live stream and is not continuously written to disk; logs rotate by size.
