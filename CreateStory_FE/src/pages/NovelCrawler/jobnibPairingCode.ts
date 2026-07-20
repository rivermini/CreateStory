import type { JobnibBrowserCapturePairResponse } from '../../api';

const PREFIX = 'csjn1.';

export function createJobnibPairingCode(pairing: JobnibBrowserCapturePairResponse, apiBase: string): string {
  const payload = JSON.stringify({
    v: 1,
    api_base: apiBase.replace(/\/+$/, ''),
    batch_id: pairing.batch_id,
    pairing_id: pairing.pairing_id,
    pairing_token: pairing.pairing_token,
    expires_at: pairing.expires_at,
  });
  return `${PREFIX}${btoa(payload).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}
