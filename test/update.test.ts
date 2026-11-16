import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchLatestGitHubRelease,
  parseGitHubReleaseApi,
  parseGitHubReleaseAtom,
  pickDownloadUrl,
  type FetchLike,
} from '../electron/update.js';

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/Echoxiawan/echobench/releases/tag/v0.2.0"/>
    <id>tag:github.com,2008:Repository/1457545109/v0.1.9</id>
    <title>EchoBench 稳定版</title>
    <updated>2026-11-16T10:00:00Z</updated>
    <content type="html">&lt;h2&gt;更新&lt;/h2&gt;&lt;p&gt;内置 adb&amp;amp;修复更新检查&lt;/p&gt;</content>
  </entry>
</feed>`;

test('从 Release 链接解析 tag，并清理发布说明', () => {
  const release = parseGitHubReleaseAtom(atom);
  assert.equal(release?.tagName, 'v0.2.0');
  assert.equal(release?.htmlUrl, 'https://github.com/Echoxiawan/echobench/releases/tag/v0.2.0');
  assert.match(release?.body ?? '', /内置 adb&修复更新检查/);
});

test('Releases Atom 按 updated 时间选择最新条目', () => {
  const release = parseGitHubReleaseAtom(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link rel="alternate" href="https://github.com/Echoxiawan/echobench/releases/tag/v0.1.9"/>
    <id>tag:github.com,2008:Repository/1457545109/v0.1.9</id>
    <title>旧版本</title>
    <updated>2026-11-15T10:00:00Z</updated>
    <content type="html">old</content>
  </entry>
  <entry>
    <link rel="alternate" href="https://github.com/Echoxiawan/echobench/releases/tag/v0.2.0"/>
    <id>tag:github.com,2008:Repository/1457545109/v0.2.0</id>
    <title>新版本展示标题</title>
    <updated>2026-11-16T10:00:00Z</updated>
    <content type="html">new</content>
  </entry>
</feed>`);
  assert.equal(release?.tagName, 'v0.2.0');
  assert.equal(release?.htmlUrl, 'https://github.com/Echoxiawan/echobench/releases/tag/v0.2.0');
  assert.equal(release?.body, 'new');
});

test('Atom 返回 403 时降级到 GitHub API', async () => {
  const requested: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('.atom')) return new Response('', { status: 403 });
    return Response.json({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/Echoxiawan/echobench/releases/tag/v0.2.0',
      body: 'API fallback',
      assets: [],
    });
  };
  const release = await fetchLatestGitHubRelease(fetchImpl);
  assert.equal(release.tagName, 'v0.2.0');
  assert.deepEqual(requested.map((url) => url.endsWith('.atom')), [true, false]);
});

test('解析 API 返回并按平台选择安装包', () => {
  const release = parseGitHubReleaseApi({
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/Echoxiawan/echobench/releases/tag/v0.2.0',
    body: 'release',
    assets: [
      { name: 'EchoBench-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.com/app.dmg' },
      { name: 'EchoBench-0.2.0-win-x64.exe', browser_download_url: 'https://example.com/app.exe' },
    ],
  });
  assert.equal(pickDownloadUrl(release.assets, 'darwin'), 'https://example.com/app.dmg');
  assert.equal(pickDownloadUrl(release.assets, 'win32'), 'https://example.com/app.exe');
});
