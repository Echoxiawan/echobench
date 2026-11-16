# Desktop app and online updates

EchoBench keeps its browser workflow and also provides an Electron desktop shell. The desktop app reuses the same frontend, server, and Appium sessions without modifying the user's existing Node, Appium, JDK, adb, or PATH.

## Local development

```bash
npm ci
npm run desktop:dev
```

`desktop:dev` builds `dist`, `dist-server`, and `dist-desktop`, then starts Electron. The main process:

1. starts the local service through `ELECTRON_RUN_AS_NODE`;
2. sets `ECHOBENCH_DATA_DIR` to Electron's `userData`;
3. sets `ECHOBENCH_APP_ROOT` to the app directory;
4. sets `SCRCPY_SERVER_PATH=resources/scrcpy-server`;
5. when `resources/jre` exists, sets `JAVA_HOME` and `PATH` for child processes only.

It never writes system environment variables and never calls `brew`, `winget`, `apt`, or `npm -g`.

## Packaging

Use the repository's `local-package.sh`:

```bash
# Unpacked app directory for local verification (skips code signing)
./local-package.sh --dir

# Installer for the current OS (DMG on macOS)
./local-package.sh --dist

# Bundle the local JRE as well
./local-package.sh --dist --with-jre
```

Or use Electron Builder directly:

```bash
npx electron-builder --dir
npx electron-builder --mac dmg
```

To bundle a JRE:

```bash
npm run desktop:prepare
npx electron-builder --mac dmg
```

`desktop:prepare` copies `JAVA_HOME` into `resources/jre`. The directory is ignored by Git; CI generates it after `actions/setup-java`.

## Installation

Do not run `EchoBench.app` directly from the DMG. The DMG is a read-only volume; dependency installation, Appium caches, and updates can fail. Drag it to Applications first.

The first launch checks system tools such as JDK, adb, scrcpy, and Xcode. CI installers bundle a pinned Android Platform-Tools release, Electron/Node, Appium, drivers, and scrcpy-server; JDK and Xcode still come from the machine or the environment panel. To bundle a JRE, use `./local-package.sh --dist --with-jre`. For a local package with bundled adb, run `node scripts/prepare-platform-tools.mjs` first.

Electron apps launched from Finder do not inherit the full terminal PATH. EchoBench adds common paths such as `/opt/homebrew/bin` and `/usr/local/bin` to child processes so Homebrew-installed tools can be found.

Windows NSIS installs into a user-writable directory by default; Windows does not check iOS/Xcode and only checks JDK, adb, and Android tools. Linux AppImage is a read-only mount; if Appium caches or the install directory cannot be written, use AppImageLauncher or extract the AppImage into a user-writable directory. CI packages for Windows/Linux bundle a JRE through `desktop:prepare`; local builds need `--with-jre`.

## Runtime layout

```text
EchoBench.app / EchoBench.exe
├── dist/                  # frontend
├── dist-server/           # server
├── dist-desktop/          # Electron main process
├── node_modules/          # production dependencies and Appium drivers
├── resources/
│   ├── platform-tools/    # bundled adb (CI package)
│   ├── scrcpy-server
│   └── jre/               # optional
└── userData/
    ├── logs/
    └── ...
```

`electron-builder.yml` uses `asar: false` so the server and Appium can load drivers and dynamic resources from the real filesystem.

## Online updates

Updates come from GitHub Releases: <https://github.com/Echoxiawan/echobench/releases>

- checks once 8 seconds after startup;
- checks every 24 hours while the process stays alive;
- manual check from the menu and the update entry;
- reads the GitHub Releases Atom feed first to avoid the anonymous API limit of 60 requests per hour, falling back to the API only when needed;
- every platform shows the version, release notes, and a platform-specific download URL when an update exists;
- clicking "Open download page" opens the installer download in the browser for manual installation;
- no in-place update, no `userData` changes, no npm install, and no system tool changes.

Publish a tag:

```bash
git tag -a v0.1.0 -m "## EchoBench v0.1.0"
git push origin v0.1.0
```

The repository does not include an interactive release script. Maintainers may use a local `release-tag.sh` (not committed) to bump the version, edit generated notes, commit, tag, and push.

GitHub Actions builds the Windows/macOS/Linux packages and uploads them to the release. The version is stored in `package.json`; Electron reads it with `app.getVersion()` for update checks.

## Signing policy

The current release is **unsigned** by default so the app can run first:

- macOS: unsigned DMG. On first launch, use right-click → Open or remove quarantine; macOS auto-update is disabled.
- Windows: unsigned installer; SmartScreen may show an "Unknown publisher" warning.
- Linux: unsigned AppImage works normally.
- Updates: every platform checks GitHub Releases; when an update exists, it shows the platform installer download URL. No in-place automatic update is performed.

Manual macOS quarantine removal:

```bash
xattr -dr com.apple.quarantine /Applications/EchoBench.app
```

If an Apple Developer Program individual account becomes available later, add Developer ID signing and notarization, then remove `mac.identity: null` from `electron-builder.yml`. Windows signing can be added later with an OV/EV certificate or a cloud signing service.

## Boundaries

- Xcode cannot be bundled. macOS iOS still requires a user-installed Xcode and WDA signing.
- Windows/Linux support Android only.
- The desktop shell currently runs the server with Electron's embedded Node. A separate pinned Node runtime can be added under `resources/runtime` later.
- Real devices/emulators, Appium sessions, and video still need local verification; CI only builds, signs, and publishes.
