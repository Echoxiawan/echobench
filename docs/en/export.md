# Script export

All three exported scripts assume Appium is running at `http://127.0.0.1:4723`. You can start the project's pinned Appium first so the exported script connects to the same service:

```bash
cd /path/to/echobench
npm run appium
```

> All three scripts write device capabilities, input values, and assertions to plaintext files. Move passwords, tokens, and other secrets to environment variables or a secret manager before committing exported code.

Exports are deterministic: each target contains only the locator you selected (or the coordinate when no locator exists). Candidate locators, bounds, verification timestamps, warnings, candidate fallback, and coordinate fallback are not exported. Assertions include an explicit wait condition and match mode. Replay and debug the flow in EchoBench first, then export the script or YAML.

## JavaScript (WebdriverIO)

The exported `app-steps.js` uses WebdriverIO, but EchoBench itself does not depend on WebdriverIO. Run it in a separate directory:

```bash
mkdir app-step-runner
cd app-step-runner
npm init -y
npm install --save-exact webdriverio
```

Copy `app-steps.js` into that directory and run:

```bash
cd /path/to/app-step-runner
node app-steps.js
```

The script uses ES Module `import`. If Node reports a module-type error, add `"type": "module"` to that runner directory's `package.json`.

## Python (Appium Python Client)

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install Appium-Python-Client
python3 app-steps.py
```

The Python script includes capabilities, waits/retries, gestures, and explicit assertions, and closes the session when it finishes.

## Java (Appium Java Client)

Put `AppSteps.java` into a Maven or Gradle project and add the dependencies (adjust versions to match your project):

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

Compile and run the `AppSteps` main class. The Java script uses `AppiumBy` and W3C gestures and includes the same waits and explicit assertions as the YAML format.

## Choosing a format

| Situation | Recommendation |
| --- | --- |
| Continue editing/replaying in EchoBench | YAML |
| Existing WebdriverIO/Node project | JavaScript |
| Existing Python/pytest project | Python |
| Existing Maven/Gradle project | Java |

Before exporting, confirm that the device UDID, app package, or bundle ID matches the runtime environment.
