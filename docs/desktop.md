# 桌面版与在线更新

EchoBench 保留原有浏览器运行方式，同时提供 Electron 桌面壳。桌面版复用同一套前端、服务端和 Appium 会话，不修改用户已有的 Node、Appium、JDK、adb 或 PATH。

## 本地开发

```bash
npm ci
npm run desktop:dev
```

`desktop:dev` 会先构建 `dist`、`dist-server` 和 `dist-desktop`，然后启动 Electron。Electron 主进程会：

1. 通过 `ELECTRON_RUN_AS_NODE` 启动本地服务；
2. 将 `ECHOBENCH_DATA_DIR` 指向 Electron 的 `userData`；
3. 将 `ECHOBENCH_APP_ROOT` 指向应用目录；
4. 设置 `SCRCPY_SERVER_PATH=resources/scrcpy-server`；
5. 如果 `resources/jre` 存在，仅为子进程设置 `JAVA_HOME` 和 `PATH`。

不会写入系统环境变量，也不会调用 `brew`、`winget`、`apt` 或 `npm -g`。

## 打包

使用仓库中的 `local-package.sh`：

```bash
# 仅生成未安装的应用目录，用于本地验证（跳过代码签名）
./local-package.sh --dir

# 生成当前系统的安装包（macOS 为 DMG）
./local-package.sh --dist

# 连同本地 JRE 一起打包
./local-package.sh --dist --with-jre
```

也可以直接使用 Electron Builder：

```bash
npx electron-builder --dir
npx electron-builder --mac dmg
```

如果要让安装包内置 JRE：

```bash
npm run desktop:prepare
npx electron-builder --mac dmg
```

`desktop:prepare` 会从 `JAVA_HOME` 复制一份 JRE 到 `resources/jre`。该目录默认不提交到 Git，CI 使用 `actions/setup-java` 后自动生成。

## 安装

不要把 `EchoBench.app` 直接从 DMG 里运行；DMG 是只读卷，依赖安装、Appium 缓存和更新可能异常。请先拖到“应用程序”文件夹再启动。

首次启动时环境体检会检查 JDK、adb、scrcpy、Xcode 等系统工具。CI 安装包会内置固定版本的 Android Platform-Tools、Electron/Node、Appium、驱动和 scrcpy-server；JDK 和 Xcode 仍需本机或环境面板处理。需要内置 JRE 时用 `./local-package.sh --dist --with-jre`。本地打包如需同样内置 adb，先执行 `node scripts/prepare-platform-tools.mjs`。

Finder 启动的 Electron 应用不会继承终端完整 PATH，EchoBench 会把 `/opt/homebrew/bin`、`/usr/local/bin` 等常见路径加入子进程环境，便于找到 Homebrew 安装的工具。

Windows 安装包使用 NSIS，通常安装到用户可写目录；Windows 不检查 iOS/Xcode，只检查 JDK、adb 和 Android 相关工具。Linux AppImage 本身是只读挂载，如果遇到 Appium 缓存或安装目录不可写，建议用 AppImageLauncher 或解包到用户可写目录后运行。Windows/Linux 的 CI 包会通过 `desktop:prepare` 内置 JRE；本地构建需要 `--with-jre`。

## 运行时布局

```text
EchoBench.app / EchoBench.exe
├── dist/                  # 前端
├── dist-server/           # 服务端
├── dist-desktop/          # Electron 主进程
├── node_modules/          # 生产依赖和 Appium 驱动
├── resources/
│   ├── platform-tools/    # 内置 adb（CI 打包）
│   ├── scrcpy-server
│   └── jre/               # 可选
└── userData/
    ├── logs/
    └── ...
```

`electron-builder.yml` 使用 `asar: false`，保证服务端和 Appium 可以在真实文件系统上加载驱动和动态资源。

## 在线更新

更新源为 GitHub Releases：<https://github.com/Echoxiawan/echobench/releases>

- 启动后 8 秒检查一次；
- 进程持续运行时每 24 小时检查一次；
- 菜单和“检查更新”入口可手动检查；
- 优先读取 GitHub Releases Atom，避免匿名 API 每小时 60 次的限流；Atom 不可用时才降级到 API；
- 所有平台发现新版本后都会弹窗显示版本、发布说明和对应平台下载地址；
- 用户点击“打开下载页”后由浏览器下载安装包并手动安装；
- 不执行就地更新，不改 `userData`，不执行 npm install，不修改系统工具。

发布 tag：

```bash
git tag -a v0.1.0 -m "## EchoBench v0.1.0"
git push origin v0.1.0
```

仓库不包含交互式发布脚本；维护者可在本机使用自己的 `release-tag.sh`（不提交）。它可以从提交自动生成说明、允许编辑版本和发布说明，然后提交、打 tag 并推送。

GitHub Actions 会构建 Windows/macOS/Linux 包并上传到 Release。版本号会写入 `package.json`，Electron 运行时通过 `app.getVersion()` 读取并用于更新检查。

## 签名策略

当前版本默认**不签名**，目标是先保证应用可以运行：

- macOS：生成未签名 DMG。首次打开需要右键 → 打开，或移除 quarantine；不启用 macOS 自动更新。
- Windows：生成未签名安装包，可能出现 SmartScreen“未知发布者”提示。
- Linux：生成未签名 AppImage，可正常使用。
- 在线更新：所有平台统一检查 GitHub Releases；有更新时提示并打开对应平台安装包的下载地址，不做就地自动更新。

macOS 手动放行：

```bash
xattr -dr com.apple.quarantine /Applications/EchoBench.app
```

如果以后获得 Apple Developer Program 个人账号，再配置 Developer ID 证书和 notarization，并移除 `electron-builder.yml` 中的 `mac.identity: null`。Windows 代码签名同理，可后续接入 OV/EV 证书或云端签名。

## 边界

- Xcode 无法随包，macOS iOS 仍要求用户安装 Xcode 并配置 WDA 签名。
- Windows/Linux 只支持 Android。
- 当前桌面壳使用 Electron 自带 Node 运行服务端；如果后续需要固定独立 Node 运行时，可在 `resources/runtime` 增加并按平台选择。
- 真机/模拟器、Appium 会话和视频流仍需在本地验证；CI 只负责构建、签名和发布。
