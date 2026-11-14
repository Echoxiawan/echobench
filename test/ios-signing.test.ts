import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSigning, parseIdentities, parseProfile, scoreCandidate } from '../server/ios-signing.js';

const profileXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Name</key><string>iOS Team Provisioning Profile: *</string>
<key>TeamIdentifier</key><array><string>TEAM000001</string></array>
<key>ExpirationDate</key><date>2030-01-01T00:00:00Z</date>
<key>ProvisionedDevices</key><array><string>device-1</string><string>device-2</string></array>
<key>Entitlements</key><dict>
<key>application-identifier</key><string>TEAM000001.*</string>
</dict>
</dict></plist>`;

test('解析有效 Apple Development 签名身份', () => {
  const identities = parseIdentities(`  1) EC38F0ECE6DA2A132FE94205478C191132F7BB0F "Apple Development: Dev One (TEAM000001)"
  2) 8246A8E029B3D96156237EFF147916A677F0DCBD "Developer ID Application: Other (TEAM000009)"
     2 valid identities found`);
  assert.deepEqual(identities, [{ hash: 'EC38F0ECE6DA2A132FE94205478C191132F7BB0F', name: 'Dev One', teamId: 'TEAM000001' }]);
});

test('解析 provisioning profile 的团队、App ID、设备和过期时间', () => {
  const profile = parseProfile(profileXml, '/tmp/demo.mobileprovision');
  assert.ok(profile);
  assert.equal(profile.teamId, 'TEAM000001');
  assert.equal(profile.appId, 'TEAM000001.*');
  assert.deepEqual(profile.devices, ['device-1', 'device-2']);
  assert.ok(profile.expiresAt > Date.now());
});

test('优先选择设备已包含且 App ID 匹配的团队', () => {
  const identityA = { hash: 'a'.repeat(40), name: 'A', teamId: 'TEAM000001' };
  const identityB = { hash: 'b'.repeat(40), name: 'B', teamId: 'TEAM000002' };
  const profileA = parseProfile(profileXml, '/tmp/a.mobileprovision')!;
  const profileB = {
    name: 'Other Team Profile',
    teamId: 'TEAM000002',
    appId: 'TEAM000002.com.other.app',
    expiresAt: Date.now() + 86_400_000,
    devices: ['device-1'],
    certSha1s: [],
    path: '/tmp/b.mobileprovision',
  };
  const selection = chooseSigning([identityA, identityB], [profileA, profileB], 'device-1', 'com.demo.app');
  assert.ok(selection);
  assert.equal(selection.teamId, 'TEAM000001');
  assert.equal(selection.candidate.profile?.name, profileA.name);
  assert.equal(selection.wdaBundleId, 'com.demo.app.WebDriverAgentRunner');
  assert.equal(selection.allowProvisioning, true);
});

test('过期 profile 不会压过有有效证书但需要自动注册的团队', () => {
  const identity = { hash: 'a'.repeat(40), name: 'A', teamId: 'TEAM000001' };
  const expired = { ...parseProfile(profileXml, '/tmp/a.mobileprovision')!, expiresAt: Date.now() - 86_400_000 };
  const candidate = scoreCandidate(identity, expired, 'device-1', 'com.demo.app');
  assert.ok(candidate.score < 0);
});

test('没有签名身份时不自动选择', () => {
  assert.equal(chooseSigning([], [], 'device-1', 'com.demo.app'), null);
});
