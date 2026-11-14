import assert from 'node:assert/strict';
import test from 'node:test';
import { MultiDeviceManager, pointForRatio, validateMultiAction } from '../server/multi.js';

test('多端相对坐标按每台设备尺寸换算并限制边界', () => {
  assert.equal(pointForRatio(1080, 0.5), 540);
  assert.equal(pointForRatio(1080, 0), 0);
  assert.equal(pointForRatio(1080, 1), 1079);
  assert.equal(pointForRatio(0, 0.5), 0);
});

test('多端操作参数校验', () => {
  assert.doesNotThrow(() => validateMultiAction({ action: 'tap', xRatio: 0.5, yRatio: 0.5 }));
  assert.throws(() => validateMultiAction({ action: 'tap', xRatio: 1.2, yRatio: 0.5 }), /范围/);
  assert.throws(() => validateMultiAction({ action: 'swipe', startXRatio: 0.1, startYRatio: 0.2, endXRatio: 0.8, endYRatio: 0.8, duration: 20 }), /时长/);
  assert.throws(() => validateMultiAction({ action: 'key', key: 'unknown' as never }), /按键/);
});

test('未启动多端同步时状态为空', () => {
  const manager = new MultiDeviceManager({
    ensureAppium: async () => undefined,
    detectSigning: async () => null,
    video: {} as never,
  });
  const status = manager.status();
  assert.equal(status.active, false);
  assert.equal(status.devices.length, 0);
  assert.equal(status.mixedPlatform, false);
});
