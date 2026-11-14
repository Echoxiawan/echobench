# EchoBench 文档

README 负责项目定位和快速开始；这里是完整使用与运维文档。

> English documentation: [docs/en/README.md](en/README.md)

## 安装

- [安装与依赖](install.md) — Windows / macOS / Linux、Android SDK、scrcpy、JDK、Xcode 和端口
- [快速开始](quickstart.md) — 连接设备、录制第一条流程、断言、回放和导出

## 使用

- [YAML 脚本格式](yaml.md) — 动作、断言、回放策略和候选定位器结构
- [导出脚本](export.md) — WebdriverIO JavaScript、Appium Python Client、Appium Java Client
- [多端同步](multi-device.md) — 多设备实时画面、同步广播、在线状态和平台风险
- [附加会话与元素树](inspect-session.md) — 接管已有 Appium 会话、Session ID、元素树和按节点定位
- [AI 用例导出](ai-export.md) — OpenAI 兼容配置、CSV 结构和断言生成规则

## 运维与排障

- [运行日志与清理](operations.md) — 日志轮转、环境变量、停止顺序和残留进程检查
- [性能与硬件占用](performance.md) — Android/iOS 视频、iOS 延迟优化和自绘键盘
- [常见问题](troubleshooting.md) — 设备连接、iOS 签名、黑屏、定位风险和 Appium 会话失败
- [安全与已知限制](limitations.md) — 本地服务风险、明文输入、功能边界和平台限制

## 示例

- [示例 YAML](../examples/login.yaml)
- [连接设备与实时画面](screenshots/live.png)
- [录制、断言与候选定位器](screenshots/recording.png)
- [元素树与按节点定位](screenshots/element-tree.png)
- [多端同步](screenshots/multi-device.png)
- [AI 用例导出](screenshots/ai-export.png)
- [全局设置与 AI 配置](screenshots/settings.png)
- [工作台空状态](screenshots/home.png)

## 设计

- [工作原理与代码结构](architecture.md) — 数据流、目录说明、验证环境
- [桌面版与在线更新](desktop.md) — Electron 壳、未签名打包、GitHub Releases 和更新策略
- [同类产品对比](comparison.md) — 与元素检查、流程工具、云设备农场和代码框架的差异
- [贡献指南](../CONTRIBUTING.md) — 开发流程、测试和 CLA
- [安全策略](../SECURITY.md) — 漏洞披露方式
- [行为准则](../CODE_OF_CONDUCT.md)
