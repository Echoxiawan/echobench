# 导出脚本

三种导出脚本都假设本机 Appium 运行在 `http://127.0.0.1:4723`。可以先回到本项目启动固定版本的 Appium，让导出脚本连接同一个服务：

```bash
cd /你的路径/echobench
npm run appium
```

> 三种脚本都会把当前设备能力、输入内容和断言明文写入文件；密码、令牌等敏感信息请在提交代码前改为环境变量或密钥管理。

## JavaScript（WebdriverIO）

导出的 `app-steps.js` 使用 WebdriverIO，但项目本身运行时不需要 WebdriverIO，所以没有将其加入依赖。在独立目录执行：

```bash
mkdir app-step-runner
cd app-step-runner
npm init -y
npm install --save-exact webdriverio
```

把 `app-steps.js` 放入该目录，另开终端执行：

```bash
cd /你的路径/app-step-runner
node app-steps.js
```

脚本使用 ES Module `import`。如果提示模块类型错误，在该独立目录的 `package.json` 中加入 `"type": "module"`。

## Python（Appium Python Client）

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install Appium-Python-Client
python3 app-steps.py
```

Python 脚本包含能力配置、等待/重试、候选降级、坐标兜底、手势和断言，并会在结束时关闭会话。

## Java（Appium Java Client）

把 `AppSteps.java` 放入 Maven 或 Gradle 工程，加入以下依赖（版本可按项目现有依赖调整）：

```xml
<dependency>
  <groupId>io.appium</groupId>
  <artifactId>java-client</artifactId>
  <version>9.5.0</version>
</dependency>
<dependency>
  <groupId>org.seleniumhq.selenium</groupId>
  <artifactId>selenium-java</artifactId>
  <version>4.27.0</version>
</dependency>
```

编译后运行 `AppSteps` 主类。Java 脚本使用 `AppiumBy` 和 W3C 手势，包含与 YAML 相同的等待、候选降级和断言逻辑。

## 选择哪种格式

| 场景 | 建议 |
| --- | --- |
| 继续在 EchoBench 中编辑/回放 | YAML |
| 已有 WebdriverIO/Node 工程 | JavaScript |
| 已有 Python/pytest 工程 | Python |
| 已有 Maven/Gradle 工程 | Java |

导出前请确认脚本中的设备 UDID、应用包名或 Bundle ID 与运行环境一致。
