import { XMLParser } from 'fast-xml-parser';

const RELEASES_ATOM_URL = 'https://github.com/Echoxiawan/echobench/releases.atom';
const RELEASES_API_URL = 'https://api.github.com/repos/Echoxiawan/echobench/releases/latest';

export interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

export interface GitHubRelease {
  tagName: string;
  htmlUrl: string;
  body: string;
  assets: ReleaseAsset[];
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * GitHub REST API 对匿名请求限制为每小时 60 次。更新检查优先使用不占 API 配额的
 * Releases Atom，只有 Atom 不可用时才降级到 API。
 */
export async function fetchLatestGitHubRelease(fetchImpl: FetchLike = fetch): Promise<GitHubRelease> {
  let lastError: unknown;
  try {
    const response = await fetchImpl(RELEASES_ATOM_URL, {
      headers: { Accept: 'application/atom+xml', 'User-Agent': 'EchoBench' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub Releases Atom HTTP ${response.status}`);
    const release = parseGitHubReleaseAtom(await response.text());
    if (!release) throw new Error('GitHub Releases Atom 中没有发布记录');
    return release;
  } catch (error) {
    lastError = error;
  }

  try {
    const response = await fetchImpl(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'EchoBench',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub Releases API HTTP ${response.status}`);
    return parseGitHubReleaseApi(await response.json());
  } catch (error) {
    throw new Error(`无法获取 GitHub Releases：${message(lastError)}；${message(error)}`);
  }
}

export function parseGitHubReleaseAtom(xml: string): GitHubRelease | null {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const document = parser.parse(xml) as { feed?: { entry?: unknown } };
  const entries = Array.isArray(document.feed?.entry) ? document.feed.entry : [document.feed?.entry];
  const releases = entries
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    .map((entry) => {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const alternate = links.find((value): value is Record<string, unknown> => (
        Boolean(value && typeof value === 'object' && (value as Record<string, unknown>)['@_rel'] === 'alternate')
      ));
      const htmlUrl = typeof alternate?.['@_href'] === 'string' ? alternate['@_href'] : '';
      const tagName = tagFromReleaseUrl(htmlUrl) || tagFromEntryId(text(entry.id));
      const updated = Date.parse(text(entry.updated));
      return {
        tagName,
        htmlUrl,
        body: htmlToText(text(entry.content)),
        assets: [],
        updatedAt: Number.isFinite(updated) ? updated : 0,
      };
    })
    .filter((release) => Boolean(release.tagName && release.htmlUrl))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const release = releases[0];
  if (!release) return null;
  return {
    tagName: release.tagName,
    htmlUrl: release.htmlUrl,
    body: release.body,
    assets: [],
  };
}

export function parseGitHubReleaseApi(value: unknown): GitHubRelease {
  if (!value || typeof value !== 'object') throw new Error('GitHub Releases API 返回格式无效');
  const release = value as { tag_name?: unknown; html_url?: unknown; body?: unknown; assets?: unknown };
  if (typeof release.tag_name !== 'string' || !release.tag_name) throw new Error('GitHub Releases API 缺少 tag_name');
  const assets = Array.isArray(release.assets)
    ? release.assets.filter((asset): asset is ReleaseAsset => Boolean(asset && typeof asset === 'object'))
    : [];
  return {
    tagName: release.tag_name,
    htmlUrl: typeof release.html_url === 'string' ? release.html_url : '',
    body: typeof release.body === 'string' ? release.body : '',
    assets,
  };
}

export function pickDownloadUrl(assets: ReleaseAsset[], platform: NodeJS.Platform = process.platform): string | undefined {
  const patterns = platform === 'win32'
    ? [/\.exe$/i, /\.msi$/i]
    : platform === 'darwin'
      ? [/\.dmg$/i, /\.zip$/i]
      : [/\.AppImage$/i, /\.deb$/i];
  for (const pattern of patterns) {
    const match = assets.find((asset) => asset.name && pattern.test(asset.name) && asset.browser_download_url);
    if (match?.browser_download_url) return match.browser_download_url;
  }
  return undefined;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '#text' in value) return text((value as { '#text'?: unknown })['#text']);
  return '';
}

function tagFromReleaseUrl(value: string): string {
  const match = value.match(/\/releases\/tag\/([^/?#]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function tagFromEntryId(value: string): string {
  const match = value.match(/\/([^/]+)$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
