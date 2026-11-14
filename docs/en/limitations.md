# Security and limitations

## Security boundaries

- The service listens only on `127.0.0.1:4710` and has no login. Do not reverse-proxy it or expose it to the public internet.
- Appium also has no authentication by default; a server URL plus Session ID is equivalent to device control.
- YAML, the UI, and all three exported scripts show and store input values in plaintext. Do not record real passwords, tokens, or personal sensitive data. `secret: true` only skips text verification; it does not hide or encrypt the value.
- Drafts are cached in the current browser's localStorage and are not uploaded. On a shared computer, clear the draft or the browser data.
- AI settings are stored only in the current browser. Test/export sends them temporarily to the local service, which calls the user-specified AI endpoint; the settings are not retained afterward.
- Runtime logs may contain Appium output, page source, device information, and error stacks. Redact them before filing an issue.

For vulnerability disclosure, see [SECURITY.md](../../SECURITY.md).

## Known limitations

- The single-device workspace maintains one Appium session at a time; multi-device sync supports multiple concurrent sessions. Attach mode does not end external sessions by default.
- The element tree covers the native control tree. WebView contexts, HTML element inspection, and cross-context actions are not implemented.
- There is no standalone headless CLI runner, JUnit/HTML report, failed-video archive, or CI plugin yet; replay is currently started from the workbench.
- Multi-device sync broadcasts relative coordinates, not frame-level synchronization. Runtime add/remove devices and automatic iOS reconnection are not implemented.
- System permission dialogs, notification shade, complex multi-finger gestures, and complex keyboard behavior do not have a unified DSL; only double-tap, long-press, and pinch are currently available.
- Candidate fallback prefers unique safe candidates, then a unique indexed candidate. Class name, parent container, and bounds are not used automatically. Every fallback requires exactly one match; if all candidates fail after the page changes, replay fails or uses coordinate fallback according to policy.
- Android custom-drawn UI or controls missing from the default window may only be reachable by relative coordinates. Multi-window capture is enabled, but coordinate replay can still be affected by layout changes. Ask developers to add contentDescription or resource-id for stable locators.
- iOS smoothness is limited by WDA screenshot mechanics and is usually lower than Android H.264. iOS gestures and locator candidates should still be verified on real devices.
- EchoBench is not a cloud device farm and does not provide large-scale concurrency, device matrices, or enterprise test management.
- EchoBench is licensed under Apache-2.0; third-party dependencies remain subject to their own licenses, and redistribution must retain the corresponding notices.
