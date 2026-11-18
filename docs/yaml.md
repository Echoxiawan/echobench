# YAML 脚本格式

YAML 是 EchoBench 的可移植录制格式。保存、载入和回放前都会通过结构校验，不执行 YAML 中的任意代码。

## 最小示例

```yaml
version: 1
name: 登录流程
platform: android
replay:              # 可选的全局回放策略
  timeout: 10000     # 单个步骤的等待上限（毫秒）
  retries: 2         # 可安全重试的动作失败次数
  retryDelay: 500    # 重试间隔（毫秒）
  settle: true       # 操作前等待页面稳定
  stopOnFailure: true
  coordinateFallback: false
  requireApp: true
capabilities:
  udid: emulator-5554
  appPackage: com.example.app
  appActivity: .MainActivity
steps:
  - id: step-login
    action: tap
    description: 点击登录
    note: 登录页首个按钮，失败时检查是否弹了更新提示
    target:
      locator:
        strategy: accessibility id
        value: 登录
      coordinate:
        xRatio: 0.5
        yRatio: 0.82
    policy:
      timeout: 20000
      retries: 3
  - id: step-home
    action: wait
    description: 等待首页出现
    condition: visible   # exists | visible | enabled | text | stable
    timeout: 10000
    target:
      locator:
        strategy: id
        value: com.example.app:id/home
  - id: step-toast
    action: wait
    description: 确认登录成功提示
    condition: text
    expect: 登录成功
    match: contains      # equals | contains | regex
    timeout: 8000
    target:
      locator:
        strategy: xpath
        value: "//*[@text='登录成功']"
```

可直接载入的示例见 [`examples/login.yaml`](../examples/login.yaml)。

## 动作

| 动作 | 必要字段 | 行为 |
| --- | --- | --- |
| `tap` | `target` | 优先定位控件并等待其可用，失败时按相对坐标点击 |
| `doubleTap` | `target` | 双击目标控件；录制时先选中步骤再点“双击” |
| `longPress` | `target`、`duration` | 长按目标控件，`duration` 为毫秒 |
| `pinch` | `direction`、`scale`、`duration`，可选 `target` | 双指放大（`out`）或缩小（`in`）；有目标时以目标为中心 |
| `input` | `target`、`value`、`clearFirst`，可选 `secret` | 等待输入框就绪、可选清空、输入文字；`secret: true` 只跳过输入文本校验，不隐藏输入值 |
| `swipe` | `direction`、`duration`，可选 `start`、`end` | 按实际轨迹滑动；没有坐标时按方向使用默认轨迹 |
| `back` | 无 | 返回上一页 |
| `wait` | `timeout`，控件条件需要 `target` | 等待条件满足：存在、可见/隐藏、可用/禁用、选中/未选中、文本匹配、内容为空或页面稳定，超时停止回放 |

## 回放策略

每一步都可加 `policy` 覆盖全局策略：`timeout`、`settleTimeout`、`retries`、`retryDelay`、`pollInterval`、`settle`、`verify`、`coordinateFallback`、`locatorFallback`。

- `timeout` 是单个步骤的总等待上限，元素等待会在该时间内持续轮询；找不到元素不会再多等几轮。
- `retries` 只用于输入/校验等可安全重试的动作失败；点击、滑动、返回和手势一旦发出不会被自动重试，避免重复操作。
- 输入步骤可通过 `policy.verify: true` 在输入后校验控件文本。

### 坐标兜底

`coordinateFallback` 默认关闭：步骤包含定位器时，找不到控件就判失败，不会因为记录了坐标而误点其他页面。只有确实需要坐标兜底时才开启。

没有定位器、只有坐标的步骤不受这个开关影响，会直接按记录坐标点击。

### 候选降级

`locatorFallback` 默认开启：主定位失效或同时匹配多个元素时，先尝试唯一安全候选，再用唯一序号候选兜底；类名、父容器、bounds 等脆弱候选只供手动选择，不参与自动降级。

脚本包含 `appPackage` 或 `bundleId` 时，`requireApp` 会在回放前检查前台应用，目标应用被关闭或切到后台会直接失败。

## 定位器生成规则

### Android

录制点击时优先使用点中的叶子节点，而不是带后代文字的父容器。如果图标没有 id、文字或 accessibility 信息，会生成“祖先容器 + 类名路径”和 bounds 作为脆弱候选，避免把整行容器当成点击目标。

大面积、不可点击的骨架容器（例如滚动容器）会直接返回坐标目标，不会生成一个点击容器中心的错误定位器。滚动条指示器、不可见节点、极小装饰节点和重叠的兄弟控件不会被误选。

### iOS

iOS 没有 `clickable` 属性，因此按控件类型识别可点击性：

- 点到短标签、且外层 `Cell` / `Button` 紧贴点击位置时，会升级到更稳定的可点击控件；
- 点到整行大 `Cell` 里的标题时保留标题本身，不会退化成整行或行内角标；
- 背景图会升级到外层可点击控件；
- 不可点击容器里的搜索图标仍保留图标本身。

### 实时校验

每个录制点击都会把主定位器和少量备选提交给 Appium 做 `/elements` + 元素范围校验。某个候选匹配多个元素、完全没出现、或唯一命中但矩形不在实际点击的控件范围内，都会被降级，主定位自动切换到下一个通过校验的候选；全部失败时步骤会带“定位风险”标记，而不是悄悄保存一个错误定位器。

## 候选定位器结构

`target.candidates` 是可选的；旧脚本没有 `candidates` 也能正常载入和回放。

候选定位器只用于编辑器内的定位、校验和调试。导出 YAML 或自动化脚本时会执行确定性固化：只保留当前选定的 `locator`（没有定位器时保留 `coordinate`），移除 `candidates`、`bounds`、`verifiedAt`、`warning` 以及候选降级/坐标兜底配置；`wait` 步骤会显式写出 `condition`，文本断言会显式写出 `match`。

```yaml
target:
  locator:
    strategy: accessibility id
    value: 登录
  candidates:
    - locator:
        strategy: accessibility id
        value: 登录
      matches: 1
      unique: true
      score: 100
      role: recommended
      source: attribute
    - locator:
        strategy: id
        value: com.example.app:id/login
      matches: 1
      unique: true
      score: 95
      role: alternative
      source: resource-id
    - locator:
        strategy: "-android uiautomator"
        value: new UiSelector().text("登录").instance(0)
      matches: 1
      unique: true
      score: 35
      role: brittle
      note: 依赖序号（共 2 个）
      source: semantic
  coordinate:
    xRatio: 0.5
    yRatio: 0.82
```

候选角色：

- **推荐** — 命中恰好 1 个、策略稳定，并且经 Appium 实时确认元素范围确实落在点击目标内；
- **可用** — 同样唯一但不是首选的候选，可作为回放降级项；
- **脆弱** — 命中多个元素、实时命中其他位置，或依赖 `.instance(n)`、`(xpath)[n]` 等序号。

旧版 v1 YAML 不需要新字段即可解析。未知定位策略和未知动作会被拒绝。
