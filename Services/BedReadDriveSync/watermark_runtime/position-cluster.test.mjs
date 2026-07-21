import assert from 'node:assert/strict';
import test from 'node:test';

import { positionsWithinCluster } from './position-cluster.mjs';

test('accepts nearby watermark layers', () => {
  const anchor = { x: 1760, y: 710, width: 35, height: 35 };
  const nearby = { x: 1700, y: 665, width: 35, height: 35 };
  assert.equal(positionsWithinCluster(anchor, nearby), true);
});

test('rejects distant title-shaped detections', () => {
  const anchor = { x: 1760, y: 710, width: 35, height: 35 };
  const titleLetter = { x: 1570, y: 590, width: 35, height: 35 };
  assert.equal(positionsWithinCluster(anchor, titleLetter), false);
});
