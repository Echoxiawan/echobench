# 安全策略 / Security Policy

## 支持范围

EchoBench 目前处于 alpha 阶段，只为最新主分支提供安全修复。旧版本、fork 和自行修改的构建不在支持范围内。

## 报告漏洞

请不要在公开 Issue 中披露安全问题。优先使用 GitHub 仓库的 **Private vulnerability reporting / Security Advisory**；如果仓库尚未启用该功能，请通过维护者的 GitHub 主页私信联系，并说明：

- 受影响的版本或提交；
- 操作系统、Node.js、Appium 和设备类型；
- 复现步骤和影响范围；
- 必要的日志或截图（请先脱敏 Session ID、令牌、设备 UDID、页面内容和应用标识）。

维护者会在确认后尽快回复，并在修复可用时协调披露时间。这是个人维护项目，不承诺固定 SLA。

## 安全边界

- EchoBench 本地服务默认只监听 `127.0.0.1:4710`，没有登录鉴权，不应暴露到公网。
- Appium 默认也没有认证；Server URL + Session ID 等同于设备控制权。
- 不要用 EchoBench 录制真实密码、令牌、支付信息或个人敏感数据。
- `secret: true` 只会跳过输入文本校验，不会隐藏或加密 YAML、界面或导出脚本中的值。
- AI 配置只保存在浏览器 localStorage；测试和导出时会临时转发给本地服务，再调用用户指定的 AI 接口。
- 运行日志可能包含页面 source 和设备信息；提交日志前请脱敏。

## 安全研究

欢迎出于防御目的进行安全研究。请只在你拥有或获得明确授权的设备和账号上测试，不要访问他人数据、破坏服务或进行拒绝服务测试。

---

# English

## Supported versions

EchoBench is currently alpha and provides security fixes only for the latest main branch. Older versions, forks, and modified builds are not supported.

## Reporting a vulnerability

Do not disclose security issues in a public Issue. Prefer GitHub's **Private vulnerability reporting / Security Advisory**. If that feature is not enabled, contact the maintainers privately through their GitHub profiles and include:

- affected version or commit;
- operating system, Node.js, Appium, and device type;
- reproduction steps and impact;
- relevant logs or screenshots, with Session IDs, tokens, device UDIDs, page content, and app identifiers redacted.

Maintainers will respond as soon as practical after confirming the report and will coordinate disclosure when a fix is available. This is a personal project without a guaranteed SLA.

## Security boundaries

- The local EchoBench service listens only on `127.0.0.1:4710` and has no authentication. Do not expose it to the public internet.
- Appium also has no authentication by default; a Server URL plus Session ID is equivalent to device control.
- Do not record real passwords, tokens, payment information, or personal sensitive data with EchoBench.
- `secret: true` only skips input verification. It does not hide or encrypt values in YAML, the UI, or exported scripts.
- AI settings live only in browser localStorage; during tests and exports they are forwarded temporarily to the local service, which calls the user-specified AI endpoint.
- Runtime logs may contain page source and device information. Redact them before sharing.

## Security research

Security research for defensive purposes is welcome. Test only devices and accounts you own or are explicitly authorized to use. Do not access other people's data, disrupt services, or run denial-of-service tests.
