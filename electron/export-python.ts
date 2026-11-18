import type { ProjectScript } from '../src/types.js';
import { buildPlan, pythonString } from './export-model.js';

export function generatePython(script: ProjectScript): string {
  const plan = pythonString(JSON.stringify(buildPlan(script)));
  return `# 由 EchoBench 生成。依赖：pip install Appium-Python-Client
import json
import re
import time

from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.options.ios import XCUITestOptions
from appium.webdriver.common.appiumby import AppiumBy

PLAN = json.loads(${plan})
PLATFORM = PLAN["platform"]
CAPS = PLAN["capabilities"]
SETTINGS = PLAN["settings"]
EXPECTED_APP = PLAN.get("expectedApp")
STEPS = PLAN["steps"]

STRATEGY = {
    "accessibility id": AppiumBy.ACCESSIBILITY_ID,
    "id": AppiumBy.ID,
    "-android uiautomator": AppiumBy.ANDROID_UIAUTOMATOR,
    "-ios predicate string": AppiumBy.IOS_PREDICATE,
    "-ios class chain": AppiumBy.IOS_CLASS_CHAIN,
    "xpath": AppiumBy.XPATH,
}


def sleep_ms(ms):
    time.sleep(max(0, ms) / 1000)


def find_all(driver, locator):
    try:
        return driver.find_elements(STRATEGY[locator["strategy"]], locator["value"])
    except Exception:
        return []


def element_ready(element):
    try:
        return element.is_displayed() and element.is_enabled()
    except Exception:
        return False


def wait_target(driver, step, policy):
    locator = step.get("locator")
    if not locator:
        return None
    deadline = time.time() + policy["timeout"] / 1000
    last_error = "控件未出现"
    while time.time() < deadline:
        try:
            elements = find_all(driver, locator)
            if len(elements) > 1:
                last_error = "定位器匹配 %d 个元素" % len(elements)
            elif len(elements) == 1:
                if element_ready(elements[0]):
                    return elements[0]
                last_error = "控件尚未就绪"
        except Exception as exc:
            last_error = str(exc)
        sleep_ms(policy["pollInterval"])
    raise RuntimeError("等待控件就绪超时：%s；%s" % (step["description"], last_error))


def page_stable(driver, policy, timeout):
    deadline = time.time() + timeout / 1000
    stable_for = min(0.5, max(0.15, timeout / 3000))
    previous = driver.page_source
    previous_at = time.time()
    while time.time() < deadline:
        sleep_ms(policy["pollInterval"])
        try:
            current = driver.page_source
        except Exception:
            return False
        if current == previous:
            if time.time() - previous_at >= stable_for:
                return True
        else:
            previous = current
            previous_at = time.time()
    return False


def checked_state(element):
    for name in ("checked", "selected", "value"):
        try:
            raw = element.get_attribute(name)
        except Exception:
            continue
        if raw is None or str(raw).strip() == "":
            continue
        return str(raw).strip().lower() in ("true", "1", "yes", "on")
    return None


def text_matches(text, expect, match):
    text = text or ""
    if match == "equals":
        return text == expect
    if match == "regex":
        return re.search(expect, text) is not None
    return expect in text


def wait_condition(driver, step, policy):
    condition = step.get("condition") or "exists"
    if condition == "stable":
        if not page_stable(driver, policy, step["timeout"]):
            raise RuntimeError("页面持续变化，等待稳定超时（%dms）" % step["timeout"])
        return
    locator = step.get("locator")
    if not locator:
        raise RuntimeError("等待步骤需要控件定位器")
    deadline = time.time() + step["timeout"] / 1000
    last_error = "控件未出现"
    while time.time() < deadline:
        elements = find_all(driver, locator)
        if condition == "hidden":
            if not elements or not elements[0].is_displayed():
                return
            last_error = "控件仍然可见"
        elif len(elements) > 1:
            last_error = "定位器匹配 %d 个元素" % len(elements)
        elif elements:
            element = elements[0]
            if condition == "exists":
                return
            if condition == "visible":
                if element.is_displayed():
                    return
                last_error = "控件不可见"
            elif condition == "enabled":
                if element.is_enabled():
                    return
                last_error = "控件不可用"
            elif condition == "disabled":
                if not element.is_enabled():
                    return
                last_error = "控件仍然可用"
            elif condition in ("checked", "unchecked"):
                state = checked_state(element)
                if state is None:
                    raise RuntimeError("无法读取控件勾选状态")
                if (state if condition == "checked" else not state):
                    return
                last_error = "勾选状态未满足"
            elif condition == "empty":
                if (element.get_attribute("password") or "").lower() == "true":
                    raise RuntimeError("密码控件无法校验文本")
                if (element.text or "").strip() == "":
                    return
                last_error = "控件仍有内容"
            elif condition == "text":
                if (element.get_attribute("password") or "").lower() == "true":
                    raise RuntimeError("密码控件无法校验文本")
                if text_matches(element.text, step.get("expect") or "", step.get("match") or "contains"):
                    return
                last_error = "文本不匹配"
        sleep_ms(policy["pollInterval"])
    raise RuntimeError("等待条件超时（%dms）：%s" % (step["timeout"], last_error))


def target_point(driver, step, element):
    if element is not None:
        try:
            rect = element.rect
            return int(rect["x"] + rect["width"] / 2), int(rect["y"] + rect["height"] / 2)
        except Exception:
            pass
    coordinate = step.get("coordinate")
    size = driver.get_window_size()
    if coordinate:
        return int(size["width"] * coordinate["xRatio"]), int(size["height"] * coordinate["yRatio"])
    return size["width"] // 2, size["height"] // 2


def tap_point(driver, x, y):
    if PLATFORM == "android":
        driver.execute_script("mobile: clickGesture", {"x": x, "y": y})
    else:
        driver.execute_script("mobile: tap", {"x": x, "y": y})


def double_tap(driver, step, element):
    x, y = target_point(driver, step, element)
    if PLATFORM == "android":
        driver.execute_script("mobile: doubleClickGesture", {"x": x, "y": y})
    else:
        driver.execute_script("mobile: doubleTap", {"x": x, "y": y})


def long_press(driver, step, element):
    x, y = target_point(driver, step, element)
    duration = step.get("duration") or 800
    if PLATFORM == "android":
        driver.execute_script("mobile: longClickGesture", {"x": x, "y": y, "duration": duration})
    else:
        driver.execute_script("mobile: touchAndHold", {"x": x, "y": y, "duration": max(0.5, duration / 1000)})


def pinch(driver, step, element):
    direction = step.get("direction") or "out"
    scale = step.get("scale") or (2.0 if direction == "out" else 0.5)
    if PLATFORM == "android":
        gesture = "mobile: pinchOpenGesture" if direction == "out" else "mobile: pinchCloseGesture"
        if element is not None:
            driver.execute_script(gesture, {"elementId": element.id})
        else:
            size = driver.get_window_size()
            driver.execute_script(gesture, {
                "left": int(size["width"] * 0.25),
                "top": int(size["height"] * 0.25),
                "width": int(size["width"] * 0.5),
                "height": int(size["height"] * 0.5),
                "percent": 0.75,
            })
    else:
        params = {"scale": scale, "velocity": 1.0}
        if element is not None:
            params["elementId"] = element.id
        driver.execute_script("mobile: pinch", params)


def swipe(driver, step):
    size = driver.get_window_size()
    width, height = size["width"], size["height"]
    start = step.get("start")
    end = step.get("end")
    direction = step.get("direction") or "up"
    if start and end:
        x1, y1, x2, y2 = start["x"], start["y"], end["x"], end["y"]
    else:
        points = {
            "up": (width * 0.5, height * 0.78, width * 0.5, height * 0.25),
            "down": (width * 0.5, height * 0.25, width * 0.5, height * 0.78),
            "left": (width * 0.8, height * 0.5, width * 0.2, height * 0.5),
            "right": (width * 0.2, height * 0.5, width * 0.8, height * 0.5),
        }
        x1, y1, x2, y2 = points[direction]
    driver.swipe(int(x1), int(y1), int(x2), int(y2), step.get("duration") or 520)


def current_app(driver):
    if PLATFORM == "android":
        try:
            return driver.current_package
        except Exception:
            return None
    try:
        info = driver.execute_script("mobile: activeAppInfo")
        return info.get("bundleId")
    except Exception:
        return None


def main():
    options = UiAutomator2Options() if PLATFORM == "android" else XCUITestOptions()
    for key, value in CAPS.items():
        options.set_capability(key if key.startswith("appium:") else "appium:" + key, value)
    driver = webdriver.Remote("http://127.0.0.1:4723", options=options)
    try:
        if EXPECTED_APP and SETTINGS.get("requireApp", True):
            current = current_app(driver)
            if current and current != EXPECTED_APP:
                raise RuntimeError("目标应用未在前台：期望 %s，当前 %s" % (EXPECTED_APP, current))
        page_dirty = False
        for step in STEPS:
            policy = step["policy"]
            if step["action"] == "wait":
                print("等待：" + step["description"])
                wait_condition(driver, step, policy)
                continue
            last_error = None
            for attempt in range(policy["retries"] + 1):
                dispatched = False
                try:
                    element = wait_target(driver, step, policy) if step.get("locator") else None
                    if not step.get("locator") and policy["settle"] and page_dirty:
                        if not page_stable(driver, policy, policy["settleTimeout"]):
                            print("页面持续变化，继续执行")
                        page_dirty = False
                    action = step["action"]
                    if action == "tap":
                        if element is not None:
                            element.click()
                        else:
                            coordinate = step.get("coordinate")
                            if not coordinate:
                                raise RuntimeError("步骤既没有定位器，也没有坐标")
                            size = driver.get_window_size()
                            tap_point(driver, int(size["width"] * coordinate["xRatio"]), int(size["height"] * coordinate["yRatio"]))
                        dispatched = True
                    elif action == "doubleTap":
                        double_tap(driver, step, element)
                        dispatched = True
                    elif action == "longPress":
                        long_press(driver, step, element)
                        dispatched = True
                    elif action == "pinch":
                        pinch(driver, step, element)
                        dispatched = True
                    elif action == "input":
                        if element is None:
                            raise RuntimeError("输入步骤必须包含控件定位器")
                        dispatched = True
                        if step.get("clearFirst"):
                            element.clear()
                        element.send_keys(step.get("value") or "")
                        if policy["verify"] and not step.get("secret"):
                            password = (element.get_attribute("password") or "").lower()
                            if password != "true":
                                actual = element.text
                                if actual is not None and actual != step.get("value"):
                                    raise RuntimeError("输入校验失败：期望「%s」，实际「%s」" % (step.get("value"), actual))
                    elif action == "swipe":
                        swipe(driver, step)
                        dispatched = True
                    elif action == "back":
                        driver.back()
                        dispatched = True
                    page_dirty = True
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    retryable = dispatched and step["action"] == "input" and (step.get("clearFirst") or policy["verify"])
                    if not retryable or attempt >= policy["retries"]:
                        raise
                    print("第 %d/%d 次尝试：%s" % (attempt + 2, policy["retries"] + 1, exc))
                    sleep_ms(policy["retryDelay"] * min(attempt + 1, 3))
                    page_dirty = True
            if last_error is not None:
                raise last_error
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
`;
}
