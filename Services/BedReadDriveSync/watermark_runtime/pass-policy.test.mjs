import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMaximumPasses } from './pass-policy.mjs';

test('uses one conservative pass for portrait cover and intro images', () => {
  assert.equal(resolveMaximumPasses(572, 1024, 3), 1);
  assert.equal(resolveMaximumPasses(896, 1200, 3), 1);
});

test('keeps requested passes available for wide banners', () => {
  assert.equal(resolveMaximumPasses(1920, 866, 3), 3);
  assert.equal(resolveMaximumPasses(1024, 459, 3), 3);
});
