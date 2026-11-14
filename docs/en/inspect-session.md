# Attach session and element tree

## Attach an existing Appium session

In the device panel, click **Attach existing Appium session** and fill in:

- Appium Server URL, for example `http://127.0.0.1:4723`;
- an existing Session ID;
- platform;
- optional device UDID (Android uses it to start the scrcpy live stream);
- optional WDA MJPEG port (iOS live view).

Attach mode does not create a new session and does not delete the external session when detaching. Without video information, EchoBench uses static screenshots; taps, input, replay, and locator validation still work.

### Where the Session ID comes from

A Session ID is not a device identifier. It is the runtime ID returned by the Appium server when a session is created. Common sources:

1. the `sessionId` returned by the client that created the session;
2. the Appium server log (`session created successfully` or `sessionId`);
3. test code: WebdriverIO `driver.sessionId`, Appium Python `driver.session_id`, Java `driver.getSessionId()`;
4. Appium 3's `GET /appium/sessions` active-session list.

Appium 3's `/appium/sessions` endpoint is gated by the `session_discovery` insecure feature and must be explicitly enabled. The current version does not enable it automatically, so the attach dialog asks for a Session ID manually.

A Session ID is valid only while the session is alive. It stops working after the creating client sends `DELETE /session`, Appium restarts, the driver crashes, or the command timeout expires.

> A Session ID is equivalent to device control. Do not expose Appium Server to the public internet or leak Session IDs in public logs.

## Element tree

After connecting or attaching a session, switch to **Element tree** at the top of the inspector:

- expand/collapse the native control hierarchy;
- search by type, name, label, text, value, or resource-id;
- inspect complete attributes, bounds, and the original hierarchy path;
- highlight the selected element on the device mirror;
- generate recommended/alternative/brittle locators from a node;
- copy a locator or tap the selected element directly.

The element tree covers the native control tree. WebView contexts / HTML element inspection are not part of the current version.

## Generate locators from a node

Selecting a node generates candidates from the node's actual attributes instead of guessing from tap coordinates. Candidates include accessibility id, resource-id, text/description, iOS predicate / class chain, parent + class name, class index, and bounds.

Repeated ids produce unique indexed candidates. On iOS, if a unique path with a semantic ancestor or container condition exists, EchoBench prefers the path that passes real-time validation. Candidates can be selected, copied, or edited in the inspector.

See [YAML format](yaml.md#candidate-structure) for the candidate structure.
