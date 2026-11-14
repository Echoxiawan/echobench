# AI test-case export (CSV)

AI configuration lives in the global **Settings** dialog and is completely separate from each export:

1. Click **Settings** in the toolbar and fill in Base URL, API Key, and Model under **AI test cases**; save once and reuse;
2. Click **AI test case** in the toolbar, enter only the test-case title for this export, and export;
3. Click **Test connection** in global settings to send a minimal request and see success/failure, the actual model, and latency.

## Configuration

- **Fields**: Base URL, API Key, Model. Any OpenAI-compatible `/chat/completions` endpoint works. The Base URL usually ends at `/v1`; a URL that already includes `/chat/completions` also works.
- **Storage**: settings are stored only in the current browser's localStorage and are not written to server files or logs. During test/export, the settings are forwarded temporarily to the local service for the AI request and are not retained afterward.
- **Title**: entered manually in the AI export dialog; AI does not generate the title. The title column and download filename both use it.
- **Input**: the current timeline steps and assertions. Password/secret input is redacted as `******`.
- **Assertions**: explicit `wait` assertions recorded in the timeline are preferred. If none exist, EchoBench suggests an assertion based on the current action, target, and next target (for example, verify the field after input or verify the next target after a tap), then asks the model to polish it. It is empty only when nothing can be inferred.

## Output

`<test-case-title>-test-cases.csv`, UTF-8 with BOM, directly openable in Excel.

```csv
"Test case title","No.","Operation","Assertion"
"Open home after login","1","Tap [Username]",""
"Open home after login","2","Type [******]","Control [Home] is visible"
```

- One executable operation per row;
- Assertions may be empty;
- Multiple assertions after the same operation are merged into one cell with semicolons;
- The title is repeated on every row so test-management tools can import by row.

## Limits

- Up to 500 operation steps per export;
- Unsupported model formats or API errors are reported directly; EchoBench does not generate an empty test case;
- AI only organizes steps and assertions. It does not operate devices or perform self-healing;
- Settings exist only in the current browser. Switching browsers or clearing site data requires re-entering them.
