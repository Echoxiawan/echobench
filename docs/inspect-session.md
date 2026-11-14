# 附加会话与元素树

## 附加已有 Appium 会话

设备面板点击“附加已有 Appium 会话”，填写：

- Appium Server URL，例如 `http://127.0.0.1:4723`；
- 已有 Session ID；
- 平台；
- 可选设备 UDID（Android 用于启动 scrcpy 实时画面）；
- 可选 WDA MJPEG 端口（iOS 用于实时画面）。

附加模式不会创建新会话，也不会在脱离时删除外部会话。没有提供视频信息时使用静态截图模式，点击、输入、回放、定位器校验仍可正常工作。

### Session ID 从哪里来

Session ID 不是设备上的编号，而是 Appium Server 在创建会话时返回的运行时 ID。常见来源：

1. 创建该会话的客户端返回的 `sessionId`；
2. Appium Server 日志中的 `session created successfully` 或 `sessionId`；
3. 测试代码：WebdriverIO `driver.sessionId`、Appium Python `driver.session_id`、Java `driver.getSessionId()`；
4. Appium 3 的 `GET /appium/sessions` 活动会话列表。

Appium 3 的 `/appium/sessions` 默认受 `session_discovery` 不安全特性限制，需要显式启用；当前版本没有自动开启该特性，因此附加弹窗要求手动填写 Session ID。

Session ID 只在会话存活期间有效。创建它的客户端执行 `DELETE /session`、Appium 重启、驱动崩溃或空闲超时后，附加会失败。

> Session ID 等同于设备控制权。不要把 Appium Server 暴露到公网，也不要在公开日志中泄露 Session ID。

## 元素树

连接或附加会话后，检查器顶部切换“元素树”：

- 展开/收起原生控件层级；
- 按类型、name、label、text、value、resource-id 搜索；
- 查看完整属性、bounds 和原始层级路径；
- 在设备画面上高亮选中元素；
- 按节点精确生成推荐/可用/脆弱定位器；
- 复制定位值，或直接点击选中元素。

元素树是原生控件树探索；WebView context / HTML 元素检查暂不在当前版本范围内。

## 按节点生成定位器

从元素树选择节点后，EchoBench 会基于该节点的实际属性生成候选，而不是根据点击坐标猜测。候选包括 accessibility id、resource-id、文本/描述、iOS predicate / class chain、父容器 + 类名、类名序号和 bounds。

重复 id 会生成唯一序号候选；iOS 如果存在带语义祖先或容器条件的唯一路径，会优先使用实时校验通过的路径。候选可以在检查器中点选、复制或编辑。

更多定位器规则见 [YAML 脚本格式](yaml.md#候选定位器结构)。
