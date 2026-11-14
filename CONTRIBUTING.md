# 贡献指南

感谢你愿意为 EchoBench 贡献代码、文档或测试。

## 首次贡献：签署 CLA

提交第一个 Pull Request 之前，请先阅读 [CLA.md](CLA.md)。EchoBench 使用 CLA 明确贡献授权，贡献者保留自己的版权，同时授予项目按 Apache-2.0 及后续其他许可（包括商业许可）分发贡献的权利。

在 PR 评论中粘贴以下内容完成签署：

```text
I have read the EchoBench CLA and I hereby sign it.

GitHub username: @your-handle
Date: YYYY-MM-DD
```

只勾选 PR 模板里的 CLA 复选框不算完成签署，必须以 PR 评论中的声明为准。首次打开 PR 时，CLA 机器人会自动评论操作说明；请按说明新开一条 PR 评论并粘贴固定文案，不要直接回复机器人评论。

如果贡献属于你的雇主，或你的雇主对你在工作中创造的知识产权享有权利，请使用 [CCLA.md](CCLA.md)，填写 Schedule A 并由公司授权代表签署。

> CLA 文本是通用模板，不构成法律意见；涉及商业授权或企业贡献时，建议由律师审阅。

## 开发流程

1. Fork 仓库并从主分支创建功能分支。
2. 安装依赖：

   ```bash
   npm ci
   ```

3. 本地运行：

   ```bash
   npm run dev
   ```

4. 提交前执行：

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

5. 在 PR 中说明变更目的、影响范围和验证方式。UI 改动请附截图或操作说明。

## 代码与数据约定

- 不要提交真实密码、令牌、设备证书、个人数据或生产日志。
- 新增交互或回放逻辑时，优先补充对应测试。
- 保持现有本地优先架构：不要默认上传设备数据、页面结构或用户输入。
- 第三方代码、图片、字体和模型必须确认许可证兼容，并在 PR 中注明来源。

## 许可证

除非另有明确说明，你提交的贡献按 [Apache License 2.0](LICENSE) 授权，并同时受 [CLA.md](CLA.md) 约束。
