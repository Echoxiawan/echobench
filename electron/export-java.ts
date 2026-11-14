import type { PlannedStep, ScriptPlan } from './export-model.js';
import { buildPlan, javaString } from './export-model.js';
import type { ProjectScript } from '../src/types.js';

export function generateJava(script: ProjectScript): string {
  const plan = buildPlan(script);
  const caps = Object.entries(plan.capabilities)
    .map(([key, value]) => `    CAPS.put(${javaString(key)}, ${javaString(value)});`)
    .join('\n');
  const steps = plan.steps.map(stepJava).join(',\n  ');
  return `// 由 EchoBench 生成。依赖 Appium Java Client（io.appium:java-client）与 Selenium 4。
import io.appium.java_client.AppiumBy;
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.options.UiAutomator2Options;
import io.appium.java_client.ios.IOSDriver;
import io.appium.java_client.ios.options.XCUITestOptions;
import java.net.URL;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.openqa.selenium.By;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.Rectangle;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.interactions.PointerInput;
import org.openqa.selenium.interactions.Sequence;
import org.openqa.selenium.remote.RemoteWebElement;

public class AppSteps {
  static final String PLATFORM = ${javaString(plan.platform)};
  static final String EXPECTED_APP = ${plan.expectedApp ? javaString(plan.expectedApp) : 'null'};
  static final boolean REQUIRE_APP = ${plan.settings.requireApp};
  static final Map<String, String> CAPS = new LinkedHashMap<>();

  static {
${caps || '    // 无额外 capabilities'}
  }

  record Loc(String strategy, String value) {}

  record Policy(int timeout, int settleTimeout, int retries, int retryDelay, int pollInterval,
                boolean settle, boolean verify, boolean coordinateFallback, boolean locatorFallback) {}

  record Step(String action, String description, List<Loc> locators, double[] coordinate, int[] start, int[] end,
              String value, boolean clearFirst, boolean secret, String direction, int duration, double scale, String condition,
              String expect, String match, int timeout, Policy policy) {}

  static final List<Step> STEPS = List.of(
  ${steps}
  );

  public static void main(String[] args) throws Exception {
    AppiumDriver driver;
    if ("android".equals(PLATFORM)) {
      UiAutomator2Options options = new UiAutomator2Options();
      CAPS.forEach((key, value) -> options.setCapability(key.startsWith("appium:") ? key : "appium:" + key, value));
      driver = new AndroidDriver(new URL("http://127.0.0.1:4723"), options);
    } else {
      XCUITestOptions options = new XCUITestOptions();
      CAPS.forEach((key, value) -> options.setCapability(key.startsWith("appium:") ? key : "appium:" + key, value));
      driver = new IOSDriver(new URL("http://127.0.0.1:4723"), options);
    }
    try {
      if (EXPECTED_APP != null && REQUIRE_APP) {
        String current = currentApp(driver);
        if (current != null && !current.equals(EXPECTED_APP)) {
          throw new RuntimeException("目标应用未在前台：期望 " + EXPECTED_APP + "，当前 " + current);
        }
      }
      boolean pageDirty = false;
      for (Step step : STEPS) {
        Policy policy = step.policy();
        if ("wait".equals(step.action())) {
          System.out.println("等待：" + step.description());
          waitCondition(driver, step, policy);
          continue;
        }
        RuntimeException lastError = null;
        for (int attempt = 0; attempt <= policy.retries(); attempt++) {
          boolean dispatched = false;
          try {
            WebElement element = step.locators().isEmpty() ? null : waitTarget(driver, step, policy);
            if (step.locators().isEmpty() && policy.settle() && pageDirty) {
              if (!pageStable(driver, policy, policy.settleTimeout())) System.out.println("页面持续变化，继续执行");
              pageDirty = false;
            }
            switch (step.action()) {
              case "tap": {
                if (element != null) {
                  element.click();
                } else {
                  if (step.coordinate() == null) throw new RuntimeException("步骤既没有有效定位器，也没有坐标兜底");
                  Dimension size = driver.manage().window().getSize();
                  tapPoint(driver, (int) (size.width * step.coordinate()[0]), (int) (size.height * step.coordinate()[1]));
                }
                dispatched = true;
                break;
              }
              case "doubleTap": {
                doubleTap(driver, step, element);
                dispatched = true;
                break;
              }
              case "longPress": {
                longPress(driver, step, element);
                dispatched = true;
                break;
              }
              case "pinch": {
                pinch(driver, step, element);
                dispatched = true;
                break;
              }
              case "input": {
                if (element == null) throw new RuntimeException("输入步骤必须包含控件定位器");
                dispatched = true;
                if (step.clearFirst()) element.clear();
                element.sendKeys(step.value() == null ? "" : step.value());
                if (policy.verify() && !step.secret()) {
                  String password = element.getAttribute("password");
                  if (!"true".equalsIgnoreCase(password)) {
                    String actual = element.getText();
                    if (actual != null && !actual.equals(step.value())) {
                      throw new RuntimeException("输入校验失败：期望「" + step.value() + "」，实际「" + actual + "」");
                    }
                  }
                }
                break;
              }
              case "swipe": {
                swipe(driver, step);
                dispatched = true;
                break;
              }
              case "back": {
                driver.navigate().back();
                dispatched = true;
                break;
              }
              default:
                throw new RuntimeException("未知动作：" + step.action());
            }
            pageDirty = true;
            lastError = null;
            break;
          } catch (Exception error) {
            lastError = new RuntimeException(error.getMessage(), error);
            boolean retryable = dispatched && "input".equals(step.action()) && (step.clearFirst() || policy.verify());
            if (!retryable || attempt >= policy.retries()) throw error;
            System.out.println("第 " + (attempt + 2) + "/" + (policy.retries() + 1) + " 次尝试：" + error.getMessage());
            Thread.sleep((long) policy.retryDelay() * Math.min(attempt + 1, 3));
            pageDirty = true;
          }
        }
        if (lastError != null) throw lastError;
      }
    } finally {
      driver.quit();
    }
  }

  static By by(Loc loc) {
    switch (loc.strategy()) {
      case "accessibility id": return AppiumBy.accessibilityId(loc.value());
      case "id": return AppiumBy.id(loc.value());
      case "-android uiautomator": return AppiumBy.androidUIAutomator(loc.value());
      case "-ios predicate string": return AppiumBy.iOSNsPredicateString(loc.value());
      case "-ios class chain": return AppiumBy.iOSClassChain(loc.value());
      default: return AppiumBy.xpath(loc.value());
    }
  }

  static List<WebElement> findAll(AppiumDriver driver, Loc loc) {
    try {
      return driver.findElements(by(loc));
    } catch (Exception error) {
      return List.of();
    }
  }

  static boolean ready(WebElement element) {
    try {
      return element.isDisplayed() && element.isEnabled();
    } catch (Exception error) {
      return false;
    }
  }

  static WebElement waitTarget(AppiumDriver driver, Step step, Policy policy) throws Exception {
    if (step.locators().isEmpty()) return null;
    long deadline = System.currentTimeMillis() + policy.timeout();
    String lastError = "控件未出现";
    while (System.currentTimeMillis() < deadline) {
      for (Loc loc : step.locators()) {
        try {
          if (!policy.locatorFallback()) {
            try {
              WebElement element = driver.findElement(by(loc));
              if (ready(element)) return element;
              lastError = "控件尚未就绪";
            } catch (NoSuchElementException ignored) {
              // 继续等待。
            }
            continue;
          }
          List<WebElement> elements = findAll(driver, loc);
          if (elements.size() > 1) {
            lastError = "定位器匹配 " + elements.size() + " 个元素，不使用该定位器";
            continue;
          }
          if (elements.size() == 1) {
            if (ready(elements.get(0))) return elements.get(0);
            lastError = "控件尚未就绪";
          }
        } catch (Exception error) {
          lastError = error.getMessage();
        }
      }
      Thread.sleep(policy.pollInterval());
    }
    if ("tap".equals(step.action()) && step.coordinate() != null && policy.coordinateFallback()) {
      System.out.println("定位器未就绪，使用坐标兜底：" + step.description());
      return null;
    }
    throw new RuntimeException("等待控件就绪超时：" + step.description() + "；已尝试 " + step.locators().size() + " 个定位器；" + lastError);
  }

  static boolean pageStable(AppiumDriver driver, Policy policy, int timeout) throws Exception {
    long deadline = System.currentTimeMillis() + timeout;
    long stableFor = Math.min(500, Math.max(150, timeout / 3));
    String previous = driver.getPageSource();
    long previousAt = System.currentTimeMillis();
    while (System.currentTimeMillis() < deadline) {
      Thread.sleep(policy.pollInterval());
      String current;
      try {
        current = driver.getPageSource();
      } catch (Exception error) {
        return false;
      }
      if (current.equals(previous)) {
        if (System.currentTimeMillis() - previousAt >= stableFor) return true;
      } else {
        previous = current;
        previousAt = System.currentTimeMillis();
      }
    }
    return false;
  }

  static Boolean checkedState(WebElement element) {
    for (String name : List.of("checked", "selected", "value")) {
      try {
        String raw = element.getAttribute(name);
        if (raw == null || raw.trim().isEmpty()) continue;
        String normalized = raw.trim().toLowerCase();
        return normalized.equals("true") || normalized.equals("1") || normalized.equals("yes") || normalized.equals("on");
      } catch (Exception ignored) {
        // 不同平台支持的状态属性不同，继续尝试下一个。
      }
    }
    return null;
  }

  static boolean textMatches(String text, String expect, String match) {
    String value = text == null ? "" : text;
    if ("equals".equals(match)) return value.equals(expect);
    if ("regex".equals(match)) return Pattern.compile(expect).matcher(value).find();
    return value.contains(expect);
  }

  static void waitCondition(AppiumDriver driver, Step step, Policy policy) throws Exception {
    if ("stable".equals(step.condition())) {
      if (!pageStable(driver, policy, step.timeout())) throw new RuntimeException("页面持续变化，等待稳定超时（" + step.timeout() + "ms）");
      return;
    }
    long deadline = System.currentTimeMillis() + step.timeout();
    String lastError = "控件未出现";
    while (System.currentTimeMillis() < deadline) {
      for (Loc loc : step.locators()) {
        List<WebElement> elements = findAll(driver, loc);
        if ("hidden".equals(step.condition())) {
          if (elements.isEmpty() || !elements.get(0).isDisplayed()) return;
          lastError = "控件仍然可见";
          continue;
        }
        if (elements.size() > 1) {
          lastError = "定位器匹配 " + elements.size() + " 个元素，不使用该定位器";
          continue;
        }
        if (elements.isEmpty()) continue;
        WebElement element = elements.get(0);
        if ("exists".equals(step.condition())) return;
        if ("visible".equals(step.condition())) {
          if (element.isDisplayed()) return;
          lastError = "控件不可见";
        } else if ("enabled".equals(step.condition())) {
          if (element.isEnabled()) return;
          lastError = "控件不可用";
        } else if ("disabled".equals(step.condition())) {
          if (!element.isEnabled()) return;
          lastError = "控件仍然可用";
        } else if ("checked".equals(step.condition()) || "unchecked".equals(step.condition())) {
          Boolean state = checkedState(element);
          if (state == null) throw new RuntimeException("无法读取控件勾选状态");
          if ("checked".equals(step.condition()) ? state : !state) return;
          lastError = "勾选状态未满足";
        } else if ("empty".equals(step.condition())) {
          if ("true".equalsIgnoreCase(element.getAttribute("password"))) throw new RuntimeException("密码控件无法校验文本");
          if (element.getText().trim().isEmpty()) return;
          lastError = "控件仍有内容";
        } else if ("text".equals(step.condition())) {
          if ("true".equalsIgnoreCase(element.getAttribute("password"))) throw new RuntimeException("密码控件无法校验文本");
          if (textMatches(element.getText(), step.expect() == null ? "" : step.expect(), step.match() == null ? "contains" : step.match())) return;
          lastError = "文本不匹配";
        }
      }
      Thread.sleep(policy.pollInterval());
    }
    throw new RuntimeException("等待条件超时（" + step.timeout() + "ms）：" + lastError);
  }

  static int[] targetPoint(AppiumDriver driver, Step step, WebElement element) {
    if (element != null) {
      try {
        Rectangle rect = element.getRect();
        return new int[]{rect.x + rect.width / 2, rect.y + rect.height / 2};
      } catch (Exception ignored) {
        // 元素已失效时退回坐标。
      }
    }
    Dimension size = driver.manage().window().getSize();
    if (step.coordinate() != null) {
      return new int[]{(int) (size.width * step.coordinate()[0]), (int) (size.height * step.coordinate()[1])};
    }
    return new int[]{size.width / 2, size.height / 2};
  }

  static void tapPoint(AppiumDriver driver, int x, int y) {
    Map<String, Object> params = new HashMap<>();
    params.put("x", x);
    params.put("y", y);
    driver.executeScript("android".equals(PLATFORM) ? "mobile: clickGesture" : "mobile: tap", params);
  }

  static void doubleTap(AppiumDriver driver, Step step, WebElement element) {
    int[] point = targetPoint(driver, step, element);
    Map<String, Object> params = new HashMap<>();
    params.put("x", point[0]);
    params.put("y", point[1]);
    driver.executeScript("android".equals(PLATFORM) ? "mobile: doubleClickGesture" : "mobile: doubleTap", params);
  }

  static void longPress(AppiumDriver driver, Step step, WebElement element) {
    int[] point = targetPoint(driver, step, element);
    Map<String, Object> params = new HashMap<>();
    params.put("x", point[0]);
    params.put("y", point[1]);
    if ("android".equals(PLATFORM)) {
      params.put("duration", step.duration());
    } else {
      params.put("duration", Math.max(0.5, step.duration() / 1000.0));
    }
    driver.executeScript("android".equals(PLATFORM) ? "mobile: longClickGesture" : "mobile: touchAndHold", params);
  }

  static void pinch(AppiumDriver driver, Step step, WebElement element) {
    Map<String, Object> params = new HashMap<>();
    double scale = step.scale() > 0 ? step.scale() : ("out".equals(step.direction()) ? 2.0 : 0.5);
    if ("android".equals(PLATFORM)) {
      String gesture = "out".equals(step.direction()) ? "mobile: pinchOpenGesture" : "mobile: pinchCloseGesture";
      if (element != null) {
        params.put("elementId", ((RemoteWebElement) element).getId());
      } else {
        Dimension size = driver.manage().window().getSize();
        params.put("left", size.width / 4);
        params.put("top", size.height / 4);
        params.put("width", size.width / 2);
        params.put("height", size.height / 2);
        params.put("percent", 0.75);
      }
      driver.executeScript(gesture, params);
    } else {
      params.put("scale", scale);
      params.put("velocity", 1.0);
      if (element != null) params.put("elementId", ((RemoteWebElement) element).getId());
      driver.executeScript("mobile: pinch", params);
    }
  }

  static void swipe(AppiumDriver driver, Step step) {
    Dimension size = driver.manage().window().getSize();
    int x1;
    int y1;
    int x2;
    int y2;
    if (step.start() != null && step.end() != null) {
      x1 = step.start()[0];
      y1 = step.start()[1];
      x2 = step.end()[0];
      y2 = step.end()[1];
    } else if (step.direction() != null) {
      switch (step.direction()) {
        case "up": x1 = size.width / 2; y1 = (int) (size.height * 0.78); x2 = size.width / 2; y2 = (int) (size.height * 0.25); break;
        case "down": x1 = size.width / 2; y1 = (int) (size.height * 0.25); x2 = size.width / 2; y2 = (int) (size.height * 0.78); break;
        case "left": x1 = (int) (size.width * 0.8); y1 = size.height / 2; x2 = (int) (size.width * 0.2); y2 = size.height / 2; break;
        default: x1 = (int) (size.width * 0.2); y1 = size.height / 2; x2 = (int) (size.width * 0.8); y2 = size.height / 2; break;
      }
    } else {
      x1 = size.width / 2; y1 = (int) (size.height * 0.78); x2 = size.width / 2; y2 = (int) (size.height * 0.25);
    }
    PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
    Sequence sequence = new Sequence(finger, 1);
    sequence.addAction(finger.createPointerMove(Duration.ZERO, PointerInput.Origin.viewport(), x1, y1));
    sequence.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
    sequence.addAction(finger.createPointerMove(Duration.ofMillis(step.duration()), PointerInput.Origin.viewport(), x2, y2));
    sequence.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));
    driver.perform(List.of(sequence));
  }

  static String currentApp(AppiumDriver driver) {
    if ("android".equals(PLATFORM)) {
      try {
        return ((AndroidDriver) driver).getCurrentPackage();
      } catch (Exception error) {
        return null;
      }
    }
    try {
      Object info = driver.executeScript("mobile: activeAppInfo");
      if (info instanceof Map) return (String) ((Map<?, ?>) info).get("bundleId");
    } catch (Exception ignored) {
      // 无法读取前台应用时由后续步骤自行失败。
    }
    return null;
  }
}
`;
}

function stepJava(step: PlannedStep): string {
  const locators = step.locators
    .map((locator) => `new Loc(${javaString(locator.strategy)}, ${javaString(locator.value)})`)
    .join(', ');
  const coordinate = step.coordinate ? `new double[]{${step.coordinate.xRatio}, ${step.coordinate.yRatio}}` : 'null';
  const start = step.start ? `new int[]{${step.start.x}, ${step.start.y}}` : 'null';
  const end = step.end ? `new int[]{${step.end.x}, ${step.end.y}}` : 'null';
  const policy = step.policy;
  const args = [
    javaString(step.action),
    javaString(step.description),
    `List.of(${locators})`,
    coordinate,
    start,
    end,
    nullable(step.value),
    String(step.clearFirst ?? false),
    String(step.secret ?? false),
    nullable(step.direction),
    String(step.duration ?? 0),
    String(step.scale ?? 0),
    nullable(step.condition),
    nullable(step.expect),
    nullable(step.match),
    String(step.timeout ?? 0),
    `new Policy(${policy.timeout}, ${policy.settleTimeout}, ${policy.retries}, ${policy.retryDelay}, ${policy.pollInterval}, ${policy.settle}, ${policy.verify}, ${policy.coordinateFallback}, ${policy.locatorFallback})`,
  ];
  return `new Step(${args.join(', ')})`;
}

function nullable(value: string | undefined): string {
  return value === undefined ? 'null' : javaString(value);
}
