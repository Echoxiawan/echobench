# EchoBench Documentation

The README covers project positioning and quick start; these documents cover the full workflow.

## Setup

- [Installation](install.md) — Windows / macOS / Linux, Android SDK, scrcpy, JDK, Xcode, and ports
- [Quick start](quickstart.md) — connect a device, record the first flow, add assertions, replay, and export

## Usage

- [EchoBench user guide](user-guide.md) - a beginner-oriented walkthrough from first launch and environment checks through recording, assertions, replay, export, and troubleshooting
- [YAML format](yaml.md) — actions, assertions, replay policy, and locator candidates
- [Script export](export.md) — WebdriverIO JavaScript, Appium Python Client, and Appium Java Client
- [Multi-device sync](multi-device.md) — one-device operation, multi-device execution, live views, and platform risks
- [Attach session and element tree](inspect-session.md) — existing Appium sessions, Session ID, element tree, and node-based locators
- [AI test-case export](ai-export.md) — OpenAI-compatible configuration, CSV structure, and assertion rules

## Operations and troubleshooting

- [Logs and cleanup](operations.md) — log rotation, environment variables, shutdown order, and residual processes
- [Performance](performance.md) — Android/iOS video, iOS latency optimizations, and custom keyboards
- [Troubleshooting](troubleshooting.md) — device connection, iOS signing, black screens, locator risk, and session failures
- [Security and limitations](limitations.md) — local-service risks, plaintext input, boundaries, and platform limits

## Design and project

- [Architecture](architecture.md) — data flow, source layout, verified environment, and design tradeoffs
- [Desktop app and online updates](desktop.md) — Electron shell, unsigned packaging, GitHub Releases, and update policy
- [Comparison](comparison.md) — differences from inspection, flow, cloud-farm, and code-framework tools
- [Contributing guide](../../CONTRIBUTING.en.md) — development workflow, tests, and CLA
- [Security policy](../../SECURITY.md) — vulnerability disclosure
- [Code of Conduct](../../CODE_OF_CONDUCT.md)

## Examples

- [Example YAML](../../examples/login.yaml)
- [Connected device and live view](../screenshots/live.png)
- [Recording, assertions, and locator candidates](../screenshots/recording.png)
- [Element tree and node-based locators](../screenshots/element-tree.png)
- [Multi-device sync](../screenshots/multi-device.png)
- [AI test-case export](../screenshots/ai-export.png)
- [Global settings and AI configuration](../screenshots/settings.png)
