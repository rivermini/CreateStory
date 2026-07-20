import { useEffect, useState } from 'react';

import {
  getJobnibCompanionDownloadUrl,
  getJobnibCompanionManifest,
  type JobnibCompanionManifest,
} from '../../api';
import { downloadWithAuth } from '../../api/client';
import { Icon, appIcons } from '../../components/Shared/Icon';

export function JobnibCompanionDownloadButton() {
  const [manifest, setManifest] = useState<JobnibCompanionManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getJobnibCompanionManifest()
        .then(setManifest)
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not check capture-tool availability.'));
    }, 0);
    return () => { window.clearTimeout(timer); };
  }, []);

  const download = async () => {
    if (!manifest?.available) return;
    setBusy(true);
    setError('');
    try {
      await downloadWithAuth(getJobnibCompanionDownloadUrl(), manifest.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the capture tool.');
    } finally {
      setBusy(false);
    }
  };

  const unavailable = manifest && !manifest.available;
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void download()}
        disabled={!manifest?.available || busy}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon icon={busy || !manifest ? appIcons.spinner : appIcons.download} className={`h-4 w-4 ${busy || !manifest ? 'animate-spin' : ''}`} />
        {busy ? 'Downloading…' : !manifest ? 'Checking capture tool…' : 'Download capture tool'}
      </button>
      {manifest?.available && <span className="ml-2 text-xs" style={{ color: 'var(--cs-text-faint)' }}>Windows x64 {manifest.version ? `v${manifest.version}` : ''} · {(manifest.size / 1024 / 1024).toFixed(1)} MB</span>}
      {(error || unavailable) && <p className="mt-2 text-xs text-amber-500">{error || manifest?.message}</p>}
    </div>
  );
}
