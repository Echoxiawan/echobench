# YAML format

YAML is EchoBench's portable recording format. EchoBench validates the structure before saving, loading, and replaying; it never executes arbitrary code from YAML.

## Minimal example

```yaml
version: 1
name: Login flow
platform: android
replay:
  timeout: 10000
  retries: 2
  retryDelay: 500
  settle: true
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
    description: Tap Login
    note: First button on the login page; check for an update dialog on failure
    target:
      locator:
        strategy: accessibility id
        value: Login
      coordinate:
        xRatio: 0.5
        yRatio: 0.82
    policy:
      timeout: 20000
      retries: 3
  - id: step-home
    action: wait
    description: Wait for the home page
    condition: visible   # exists | visible | enabled | text | stable
    timeout: 10000
    target:
      locator:
        strategy: id
        value: com.example.app:id/home
  - id: step-toast
    action: wait
    description: Confirm the success toast
    condition: text
    expect: Login successful
    match: contains      # equals | contains | regex
    timeout: 8000
    target:
      locator:
        strategy: xpath
        value: "//*[@text='Login successful']"
```

A loadable example is available at [`examples/login.yaml`](../../examples/login.yaml).

## Actions

| Action | Required fields | Behavior |
| --- | --- | --- |
| `tap` | `target` | Locate the control and wait until it is usable; fall back to relative coordinates on failure |
| `doubleTap` | `target` | Double-tap the target; select a step before recording the gesture |
| `longPress` | `target`, `duration` | Long-press the target; `duration` is in milliseconds |
| `pinch` | `direction`, `scale`, `duration`, optional `target` | Pinch out (`out`) or in (`in`); uses the target center when available |
| `input` | `target`, `value`, `clearFirst`, optional `secret` | Wait for the field, optionally clear it, and type; `secret: true` skips text verification but does not hide the value |
| `swipe` | `direction`, `duration`, optional `start`, `end` | Swipe along the recorded trajectory; uses a default trajectory when coordinates are absent |
| `back` | None | Go back |
| `wait` | `timeout`; control conditions require `target` | Wait for exists, visible/hidden, enabled/disabled, checked/unchecked, text, empty, or page stable; timeout stops replay |

## Replay policy

A step can override the global policy with `policy`: `timeout`, `settleTimeout`, `retries`, `retryDelay`, `pollInterval`, `settle`, `verify`, `coordinateFallback`, and `locatorFallback`.

- `timeout` is the total wait budget for one step; element waits keep polling within it.
- `retries` applies only to actions that are safe to retry, such as input verification. Taps, swipes, back, and gestures are never retried after they are sent.
- Input steps can use `policy.verify: true` to verify the field text after typing.

### Coordinate fallback

`coordinateFallback` is off by default. If a step has a locator and the control cannot be found, replay fails instead of silently tapping a recorded coordinate that may belong to another screen. Enable it only when coordinate fallback is intentional.

Steps with only coordinates and no locator are not affected by this switch; they always use the recorded coordinate.

### Locator fallback

`locatorFallback` is on by default. If the primary locator is missing or matches multiple elements, EchoBench tries other unique safe candidates, then a unique indexed candidate. Brittle candidates such as class name, parent container, and bounds are only available for manual selection and never used automatically.

If the script contains `appPackage` or `bundleId`, `requireApp` checks the foreground app before replay. If the target app is closed or in the background, replay fails immediately.

## Candidate structure

`target.candidates` is optional. Older scripts without candidates still load and replay.

```yaml
target:
  locator:
    strategy: accessibility id
    value: Login
  candidates:
    - locator:
        strategy: accessibility id
        value: Login
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
        value: new UiSelector().text("Login").instance(0)
      matches: 1
      unique: true
      score: 35
      role: brittle
      note: Depends on an index (2 matches)
      source: semantic
  coordinate:
    xRatio: 0.5
    yRatio: 0.82
```

Roles:

- **Recommended** — exactly one match, a stable strategy, and Appium confirmed that the element bounds contain the actual tap target;
- **Alternative** — also unique but not preferred; can be used as a fallback;
- **Brittle** — matches multiple elements, matches the wrong bounds, or depends on an index such as `.instance(n)` or `(xpath)[n]`.

## Locator generation rules

### Android

Recording prefers the leaf that was actually tapped instead of a parent container with descendant text. If an icon has no id, text, or accessibility information, EchoBench generates a vulnerable "ancestor container + class path" and bounds candidate instead of treating the whole row container as the tap target.

Large non-clickable layout containers (such as scroll containers) produce a coordinate target instead of a locator that points to the center of the container. Scrollbar indicators, invisible nodes, tiny decorative nodes, and overlapping sibling controls are not selected.

### iOS

iOS does not expose a `clickable` attribute, so EchoBench infers clickability from control type:

- a short label whose enclosing `Cell` / `Button` is adjacent to the tap is promoted to the more stable clickable control;
- a title inside a large `Cell` stays as the title instead of expanding to the whole row or a badge;
- a background image is promoted to the enclosing clickable control;
- a search icon inside a non-clickable container remains the icon itself.

### Real-time validation

Every recording tap submits the primary locator and a few alternatives to Appium `/elements` plus bounds validation. A candidate that matches multiple elements, does not appear, or matches an element whose bounds do not contain the actual tap is demoted. The primary locator moves to the next valid candidate. If all fail, the step is marked **Locator risk** instead of silently saving a wrong locator.

Older v1 YAML files load without the new fields. Unknown locator strategies and unknown actions are rejected.
