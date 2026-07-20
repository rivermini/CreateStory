// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { createJobnibPairingCode } from './jobnibPairingCode';

describe('Jobnib standalone pairing code', () => {
  it('encodes the public API origin and short-lived pairing secret', () => {
    const code = createJobnibPairingCode({
      batch_id: 'deadbeef',
      pairing_id: 'a'.repeat(32),
      pairing_token: 'b'.repeat(43),
      row_index: null,
      status: 'active',
      created_at: '2026-07-20T10:00:00Z',
      expires_at: '2026-07-20T10:15:00Z',
      idle_ttl_seconds: 900,
    }, 'https://stories.example.com/');

    expect(code.startsWith('csjn1.')).toBe(true);
    const encoded = code.slice('csjn1.'.length).replaceAll('-', '+').replaceAll('_', '/');
    const payload = JSON.parse(atob(encoded)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      v: 1,
      api_base: 'https://stories.example.com',
      batch_id: 'deadbeef',
      pairing_id: 'a'.repeat(32),
      pairing_token: 'b'.repeat(43),
    });
  });
});
