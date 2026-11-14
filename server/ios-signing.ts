import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CACHE_TTL = 60_000;
let certificateCache: { at: number; teams: Map<string, string> } | null = null;

export interface SigningIdentity {
  hash: string;
  name: string;
  teamId: string;
}

export interface ProfileSummary {
  name: string;
  teamId: string;
  appId: string;
  expiresAt: number;
  devices: string[];
  certSha1s: string[];
  path: string;
}

export interface SigningCandidate {
  teamId: string;
  identity: string;
  profile?: ProfileSummary;
  score: number;
  reason: string;
}

export interface SigningSelection {
  teamId: string;
  signingId: string;
  wdaBundleId: string;
  allowProvisioning: boolean;
  candidate: SigningCandidate;
}

interface Cache {
  at: number;
  identities: SigningIdentity[];
  profiles: ProfileSummary[];
}

let cache: Cache | null = null;

export function parseIdentities(stdout: string): SigningIdentity[] {
  const identities: SigningIdentity[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"Apple Development: (.*?) \(([A-Z0-9]{10})\)"/);
    if (!match) continue;
    // 括号里的值是证书个人标识，不一定等于团队 ID；readIdentities 会用证书 OU 覆盖。
    identities.push({ hash: match[1], name: match[2].trim(), teamId: match[3] });
  }
  return identities;
}

export function extractTeamFromSubject(subject: string): string {
  const normalized = subject.replace(/\s*=\s*/g, '=');
  for (const raw of normalized.split(/[/,]/)) {
    const token = raw.trim();
    if (token.startsWith('OU=')) return token.slice(3).trim();
  }
  return '';
}

async function readIdentities(): Promise<SigningIdentity[]> {
  const { stdout } = await exec('security', ['find-identity', '-v', '-p', 'codesigning'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  const identities = parseIdentities(String(stdout));
  const teams = await certificateTeams().catch(() => new Map<string, string>());
  for (const identity of identities) {
    const team = teams.get(identity.hash.toUpperCase());
    if (team) identity.teamId = team;
  }
  return identities;
}

async function certificateTeams(): Promise<Map<string, string>> {
  if (certificateCache && Date.now() - certificateCache.at < CACHE_TTL) return certificateCache.teams;
  const { stdout } = await exec('security', ['find-certificate', '-a', '-p'], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  const blocks = String(stdout).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const teams = new Map<string, string>();
  const infos = await Promise.all(blocks.map(async (pem) => {
    try { return await opensslCertificateInfo(pem); } catch { return null; }
  }));
  for (const info of infos) {
    if (info?.sha1 && info.team) teams.set(info.sha1, info.team);
  }
  certificateCache = { at: Date.now(), teams };
  return teams;
}

function opensslCertificateInfo(pem: string): Promise<{ sha1: string; team: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('openssl', ['x509', '-noout', '-fingerprint', '-sha1', '-subject'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(error || `openssl exited ${code}`));
      let sha1 = '';
      let subject = '';
      for (const line of output.split(/\r?\n/)) {
        const lower = line.toLowerCase();
        if (lower.startsWith('sha1 fingerprint') || lower.startsWith('sha-1 fingerprint')) {
          sha1 = line.split('=').slice(1).join('=').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        }
        if (lower.startsWith('subject=')) subject = line.slice('subject='.length);
      }
      resolve({ sha1, team: extractTeamFromSubject(subject) });
    });
    child.stdin.end(pem);
  });
}

export function parseProfile(decoded: string, path: string): ProfileSummary | null {
  const teamId = decoded.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/)?.[1] ?? '';
  const name = decoded.match(/<key>Name<\/key>\s*<string>([^<]*)<\/string>/)?.[1] ?? '';
  const appId = decoded.match(/<key>application-identifier<\/key>\s*<string>([^<]*)<\/string>/)?.[1] ?? '';
  const expires = decoded.match(/<key>ExpirationDate<\/key>\s*<date>([^<]*)<\/date>/)?.[1] ?? '';
  if (!teamId || !expires) return null;
  const devicesBlock = decoded.match(/<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  const devices = [...devicesBlock.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]);
  const certBlock = decoded.match(/<key>DeveloperCertificates<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  const certSha1s = [...certBlock.matchAll(/<data>([\s\S]*?)<\/data>/g)]
    .map((match) => createHash('sha1').update(Buffer.from(match[1].replace(/\s/g, ''), 'base64')).digest('hex').toUpperCase());
  const expiresAt = Date.parse(expires);
  return {
    name,
    teamId,
    appId,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    devices,
    certSha1s,
    path,
  };
}

export function scoreCandidate(identity: SigningIdentity, profile: ProfileSummary | undefined, deviceId: string, bundleId?: string): SigningCandidate {
  const deviceIncluded = Boolean(profile?.devices.includes(deviceId));
  const wildcard = profile ? /(^|\.)\*$/.test(profile.appId) : false;
  const appIdSuffix = profile ? profile.appId.slice(profile.appId.indexOf('.') + 1) : '';
  const appMatch = Boolean(profile && bundleId && (wildcard || appIdSuffix.startsWith(bundleId) || bundleId.startsWith(appIdSuffix.replace(/\*$/, ''))));
  const future = Boolean(profile && profile.expiresAt > Date.now());
  const certIncluded = !profile || profile.certSha1s.length === 0 || profile.certSha1s.includes(identity.hash.toUpperCase());
  const score = profile && !future
    ? -100
    : !certIncluded
      ? -200
      : (deviceIncluded ? 100 : 0) + (appMatch ? 60 : 0) + (wildcard ? 20 : 0) + (future ? 20 : 0) + (profile ? 10 : 0);
  const reasons: string[] = [];
  if (profile) reasons.push(future ? 'profile 有效' : 'profile 已过期');
  if (profile && !certIncluded) reasons.push('profile 不包含该证书');
  if (deviceIncluded) reasons.push('设备已包含');
  if (appMatch) reasons.push('App ID 匹配');
  if (wildcard) reasons.push('通配 App ID');
  if (!profile) reasons.push('无 profile，允许自动注册');
  return {
    teamId: identity.teamId,
    identity: identity.name,
    profile,
    score,
    reason: reasons.join(' / '),
  };
}

export function chooseSigning(identities: SigningIdentity[], profiles: ProfileSummary[], deviceId: string, bundleId?: string): SigningSelection | null {
  if (identities.length === 0) return null;
  const candidates: SigningCandidate[] = [];
  for (const identity of identities) {
    const teamProfiles = profiles.filter((profile) => profile.teamId === identity.teamId);
    // 没有可用 profile 时仍可依靠自动注册，保留一个无 profile 候选作为兜底。
    candidates.push(scoreCandidate(identity, undefined, deviceId, bundleId));
    let best: SigningCandidate | null = null;
    for (const profile of teamProfiles) {
      const candidate = scoreCandidate(identity, profile, deviceId, bundleId);
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best && best.score >= 0) candidates.push(best);
  }
  candidates.sort((left, right) => right.score - left.score || left.teamId.localeCompare(right.teamId));
  const winner = candidates[0];
  if (!winner) return null;
  return {
    teamId: winner.teamId,
    signingId: 'Apple Development',
    wdaBundleId: deriveWdaBundleId(bundleId),
    allowProvisioning: true,
    candidate: winner,
  };
}

export async function detectIosSigning(deviceId: string, bundleId?: string): Promise<SigningSelection | null> {
  if (process.platform !== 'darwin') return null;
  const data = await loadSigningData();
  return chooseSigning(data.identities, data.profiles, deviceId, bundleId);
}

async function loadSigningData(): Promise<{ identities: SigningIdentity[]; profiles: ProfileSummary[] }> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache;
  const identities = await readIdentities().catch(() => []);
  const profiles = await readProfiles().catch(() => []);
  cache = { at: Date.now(), identities, profiles };
  return cache;
}

async function readProfiles(): Promise<ProfileSummary[]> {
  const dirs = [
    join(homedir(), 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles'),
    join(homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles'),
  ];
  const profiles: ProfileSummary[] = [];
  for (const dir of dirs) {
    let files: string[];
    try { files = await readdir(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.mobileprovision')) continue;
      const path = join(dir, file);
      try {
        const { stdout } = await exec('security', ['cms', '-D', '-i', path], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
        const summary = parseProfile(String(stdout), path);
        if (summary) profiles.push(summary);
      } catch { /* 跳过损坏或无法解码的 profile。 */ }
    }
  }
  return profiles;
}

function deriveWdaBundleId(bundleId?: string): string {
  const base = (bundleId ?? 'com.appstep').replace(/[^A-Za-z0-9.-]/g, '');
  return `${base || 'com.appstep'}.WebDriverAgentRunner`;
}
