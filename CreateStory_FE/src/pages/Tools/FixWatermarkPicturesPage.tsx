import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  listWatermarkPictureStories,
  getWatermarkPictureStatus,
  queueWatermarkPictureBatch,
  queueWatermarkPictureStory,
  type SyncJob,
  type WatermarkPictureAssetResult,
  type WatermarkPictureAssetStatus,
  type WatermarkPictureFixPayload,
  type WatermarkPictureStory,
} from '../../api/BedReadDriveSync';
import {
  ActionButton,
  EmptyState,
  PageHeader,
  PageShell,
  StatusBadge,
  Surface,
  TextInput,
} from '../../components/Shared/Primitives';
import { Icon, appIcons } from '../../components/Shared/Icon';
import { showToast } from '../../components/Shared/Toast';
import { getThemeTokens } from '../../components/Shared/design';
import type { ThemeMode } from '../../types/theme';

interface FixWatermarkPicturesPageProps {
  readonly themeMode: ThemeMode;
}

type AssetType = 'cover' | 'banner' | 'intro';
type BadgeTone = 'default' | 'primary' | 'danger' | 'success' | 'warning';

const PAGE_SIZE = 18;
const ASSET_TYPES: AssetType[] = ['cover', 'banner', 'intro'];
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);

const ASSET_STATUS_LABELS: Record<WatermarkPictureAssetStatus, string> = {
  pending: 'Waiting',
  downloading: 'Downloading',
  detecting: 'Detecting',
  uploading: 'Uploading',
  fixed: 'Fixed',
  no_watermark: 'Already clean',
  missing: 'Missing',
  error: 'Failed',
};

function assetStatusTone(status?: WatermarkPictureAssetStatus): BadgeTone {
  if (status === 'fixed' || status === 'no_watermark') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'missing') return 'default';
  if (status && status !== 'pending') return 'primary';
  return 'warning';
}

function jobTone(job: SyncJob | null): BadgeTone {
  if (!job) return 'default';
  if (job.status === 'success') return 'success';
  if (job.status === 'error' || job.status === 'cancelled') return 'danger';
  if (job.status === 'running') return 'primary';
  return 'warning';
}

function jobLabel(job: SyncJob | null): string {
  if (!job) return 'Not checked';
  return {
    queued: 'Queued',
    running: 'Processing',
    success: 'Completed',
    error: 'Needs attention',
    cancelled: 'Cancelled',
  }[job.status];
}

function payloadFor(job: SyncJob | null): WatermarkPictureFixPayload | null {
  if (!job?.payload) return null;
  return job.payload as WatermarkPictureFixPayload;
}

function isActive(job: SyncJob | null): boolean {
  return Boolean(job && ACTIVE_JOB_STATUSES.has(job.status));
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) return '';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} s`;
}

function progressFor(job: SyncJob | null): number {
  if (!job) return 0;
  if (job.status === 'success' || job.status === 'error' || job.status === 'cancelled') return 100;
  if (job.status === 'queued') return 4;
  const assets = payloadFor(job)?.assets;
  if (!assets) return 10;
  const weights: Record<WatermarkPictureAssetStatus, number> = {
    pending: 0,
    downloading: 0.18,
    detecting: 0.5,
    uploading: 0.82,
    fixed: 1,
    no_watermark: 1,
    missing: 1,
    error: 1,
  };
  const selectedAssets = payloadFor(job)?.selected_assets?.length
    ? payloadFor(job)!.selected_assets!
    : ASSET_TYPES;
  const done = selectedAssets.reduce((sum, type) => sum + weights[assets[type]?.status ?? 'pending'], 0);
  return Math.max(8, Math.round((done / selectedAssets.length) * 100));
}

function availableAssets(story: WatermarkPictureStory): AssetType[] {
  return ASSET_TYPES.filter((type) => Boolean({
    cover: story.cover_url,
    banner: story.banner_url,
    intro: story.intro_url,
  }[type]));
}

function cacheBustedPreviewUrl(imageUrl: string | null, revision: number): string | null {
  if (!imageUrl) return null;
  const separator = imageUrl.includes('?') ? '&' : '?';
  return `${imageUrl}${separator}_wm_preview=${revision}`;
}

function AssetTile({
  type,
  imageUrl,
  result,
  selected,
  disabled,
  onToggle,
  mutedColor,
  borderColor,
  previewRevision,
}: Readonly<{
  type: AssetType;
  imageUrl: string | null;
  result?: WatermarkPictureAssetResult;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  mutedColor: string;
  borderColor: string;
  previewRevision: number;
}>) {
  const label = type[0].toUpperCase() + type.slice(1);
  const effectiveResult = result?.status === 'missing' && imageUrl ? undefined : result;
  // The catalog URL is the freshly checked server state. A historic job URL
  // is only a fallback for APIs that omit the asset entirely.
  const previewUrl = cacheBustedPreviewUrl(imageUrl || effectiveResult?.output_url || null, previewRevision);
  const [previewFailed, setPreviewFailed] = useState(false);

  return (
    <div className="min-w-0">
      <div
        className="relative h-24 overflow-hidden rounded-xl"
        style={{ border: `1px solid ${borderColor}`, background: 'var(--cs-surface-muted)' }}
      >
        {previewUrl && !previewFailed ? (
          <img
            src={previewUrl}
            alt={`${label} preview`}
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1" style={{ color: mutedColor }}>
            <Icon icon={appIcons.image} className="h-5 w-5 opacity-45" />
            {previewFailed && <span className="text-[9px] font-bold">Preview unavailable</span>}
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white">
          {label}
        </span>
      </div>
      <label
        className={`mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-extrabold ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
        style={{ border: `1px solid ${selected ? '#ff5b00' : borderColor}` }}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Fix ${label}`}
          className="h-3.5 w-3.5 accent-[#ff5b00]"
        />
        Fix {label}
      </label>
      <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
        <StatusBadge tone={assetStatusTone(effectiveResult?.status)}>
          {effectiveResult ? ASSET_STATUS_LABELS[effectiveResult.status] : imageUrl ? 'Ready' : 'Missing'}
        </StatusBadge>
        {effectiveResult?.processing_ms !== undefined && (
          <span className="truncate text-[10px] font-semibold" style={{ color: mutedColor }}>
            {formatDuration(effectiveResult.processing_ms)}
          </span>
        )}
      </div>
      {effectiveResult?.error && (
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-red-600" title={effectiveResult.error}>
          {effectiveResult.error}
        </p>
      )}
    </div>
  );
}

function StoryCard({
  story,
  selected,
  selectedAssets,
  busy,
  onToggle,
  onToggleAsset,
  onQueue,
  themeMode,
  previewRevision,
}: Readonly<{
  story: WatermarkPictureStory;
  selected: boolean;
  selectedAssets: Set<AssetType>;
  busy: boolean;
  onToggle: () => void;
  onToggleAsset: (type: AssetType) => void;
  onQueue: () => void;
  themeMode: ThemeMode;
  previewRevision: number;
}>) {
  const tokens = getThemeTokens(themeMode);
  const job = story.latest_job;
  const payload = payloadFor(job);
  const active = isActive(job);
  const summary = payload?.summary;
  const storyUrls: Record<AssetType, string | null> = {
    cover: story.cover_url,
    banner: story.banner_url,
    intro: story.intro_url,
  };
  const recoveredMissing = ASSET_TYPES.filter(
    (type) => payload?.assets?.[type]?.status === 'missing' && Boolean(storyUrls[type]),
  ).length;
  const displaySummary = summary ? {
    ...summary,
    missing: Math.max(0, summary.missing - recoveredMissing),
  } : null;
  const summaryText = displaySummary
    ? `${displaySummary.fixed} fixed · ${displaySummary.already_clean} already clean · ${displaySummary.missing} missing · ${displaySummary.failed} failed${recoveredMissing ? ` · ${recoveredMissing} recovered, not checked` : ''}`
    : null;
  const canSelect = !active && selectedAssets.size > 0;

  return (
    <Surface className="overflow-hidden">
      <div className="flex items-start gap-3 p-4" style={{ borderBottom: `1px solid ${tokens.colors.border}` }}>
        <input
          type="checkbox"
          checked={selected}
          disabled={!canSelect}
          onChange={onToggle}
          aria-label={`Select ${story.title}`}
          className="mt-1 h-4 w-4 accent-[#ff5b00]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-extrabold" title={story.title}>{story.title}</h2>
            <StatusBadge tone={jobTone(job)}>{jobLabel(job)}</StatusBadge>
          </div>
          <p className="mt-1 truncate text-[11px] font-medium" style={{ color: tokens.colors.textMuted }}>
            Story {story.story_id}
          </p>
        </div>
        <ActionButton
          tone={active ? 'default' : 'primary'}
          icon={active ? 'spinner' : 'refresh'}
          disabled={active || busy || selectedAssets.size === 0}
          onClick={onQueue}
          className={active ? '[&>svg]:animate-spin' : ''}
        >
          {active ? 'In queue' : busy ? 'Queueing…' : `Fix selected (${selectedAssets.size})`}
        </ActionButton>
      </div>

      <div className="grid grid-cols-3 gap-3 p-4">
        {ASSET_TYPES.map((type) => (
          <AssetTile
            key={`${type}-${storyUrls[type] ?? 'missing'}-${payload?.assets?.[type]?.output_url ?? ''}-${previewRevision}`}
            type={type}
            imageUrl={storyUrls[type]}
            result={payload?.assets?.[type]}
            selected={selectedAssets.has(type)}
            disabled={active || !storyUrls[type]}
            onToggle={() => onToggleAsset(type)}
            mutedColor={tokens.colors.textMuted}
            borderColor={tokens.colors.border}
            previewRevision={previewRevision}
          />
        ))}
      </div>

      {job && (
        <div className="px-4 pb-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-bold" style={{ color: tokens.colors.textMuted }}>
            <span>
              {job.status === 'running' && payload?.current_asset
                ? `Working on ${payload.current_asset}`
                : summaryText || job.result_message || jobLabel(job)}
            </span>
            <span>{progressFor(job)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: tokens.colors.surfaceMuted }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressFor(job)}%`,
                background: job.status === 'error' ? tokens.colors.danger : tokens.colors.primary,
              }}
            />
          </div>
          {displaySummary && (
            <p className="mt-2 text-[11px] font-semibold" style={{ color: tokens.colors.textSoft }}>
              {summaryText}
            </p>
          )}
          {(job.error || job.logs.length > 0) && (
            <details className="mt-3 text-[11px]" style={{ color: tokens.colors.textMuted }}>
              <summary className="cursor-pointer font-bold">Processing details</summary>
              <div className="mt-2 max-h-32 overflow-auto rounded-xl p-3" style={{ background: tokens.colors.surfaceMuted }}>
                {job.error && <p className="mb-2 text-red-600">{job.error}</p>}
                {job.logs.map((log, index) => (
                  <p key={`${log.timestamp}-${index}`} className={log.level === 'error' ? 'text-red-600' : ''}>
                    {log.message}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {story.detail_error && (
        <p className="border-t px-4 py-3 text-[11px] text-red-600" style={{ borderColor: tokens.colors.border }}>
          Could not load all picture details: {story.detail_error}
        </p>
      )}
    </Surface>
  );
}

export function FixWatermarkPicturesPage({ themeMode }: Readonly<FixWatermarkPicturesPageProps>) {
  const tokens = getThemeTokens(themeMode);
  const [data, setData] = useState<Awaited<ReturnType<typeof listWatermarkPictureStories>> | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [assetSelections, setAssetSelections] = useState<Map<string, Set<AssetType>>>(new Map());
  const [busyStories, setBusyStories] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [catalogChecked, setCatalogChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const activeCount = (data?.queued ?? 0) + (data?.running ?? 0);
  const hasData = Boolean(data);
  const visibleStoryIdsKey = data?.items.map((story) => story.story_id).join('\n') ?? '';
  const visibleStoryIds = useMemo(
    () => visibleStoryIdsKey ? visibleStoryIdsKey.split('\n') : [],
    [visibleStoryIdsKey],
  );

  const load = useCallback(async (quiet = false, nextPage = page, nextKeyword = keyword) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await listWatermarkPictureStories(nextPage, PAGE_SIZE, nextKeyword);
      setData(response);
      setPreviewRevision(Date.now());
      setAssetSelections((current) => {
        const next = new Map(current);
        response.items.forEach((story) => {
          const allowed = availableAssets(story);
          const previous = current.get(story.story_id);
          next.set(
            story.story_id,
            new Set(previous ? [...previous].filter((type) => allowed.includes(type)) : allowed),
          );
        });
        return next;
      });
      setError(null);
      return true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load server stories.');
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [keyword, page]);

  const refreshStatus = useCallback(async () => {
    if (visibleStoryIds.length === 0) return;
    try {
      const status = await getWatermarkPictureStatus(visibleStoryIds);
      setData((current) => current ? {
        ...current,
        queued: status.queued,
        running: status.running,
        completed: status.completed,
        failed: status.failed,
        items: current.items.map((story) => ({
          ...story,
          latest_job: status.latest_jobs[story.story_id] ?? story.latest_job,
        })),
      } : current);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not refresh repair status.');
    }
  }, [visibleStoryIds]);

  useEffect(() => {
    if (!hasData) return undefined;
    const interval = window.setInterval(() => void refreshStatus(), activeCount > 0 ? 2500 : 15000);
    return () => window.clearInterval(interval);
  }, [activeCount, hasData, refreshStatus]);

  const pageSelectable = useMemo(
    () => data?.items.filter(
      (story) => !isActive(story.latest_job) && (assetSelections.get(story.story_id)?.size ?? 0) > 0,
    ) ?? [],
    [assetSelections, data],
  );
  const pageFullySelected = pageSelectable.length > 0 && pageSelectable.every((story) => selected.has(story.story_id));

  const toggleStory = (story: WatermarkPictureStory) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(story.story_id)) next.delete(story.story_id);
      else next.set(story.story_id, story.title);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((current) => {
      const next = new Map(current);
      if (pageFullySelected) pageSelectable.forEach((story) => next.delete(story.story_id));
      else pageSelectable.forEach((story) => next.set(story.story_id, story.title));
      return next;
    });
  };

  const toggleAsset = (story: WatermarkPictureStory, type: AssetType) => {
    setAssetSelections((current) => {
      const next = new Map(current);
      const storyAssets = new Set(next.get(story.story_id) ?? []);
      if (storyAssets.has(type)) storyAssets.delete(type);
      else storyAssets.add(type);
      next.set(story.story_id, storyAssets);
      if (storyAssets.size === 0) {
        setSelected((selectedStories) => {
          const nextSelected = new Map(selectedStories);
          nextSelected.delete(story.story_id);
          return nextSelected;
        });
      }
      return next;
    });
  };

  const queueStory = async (story: WatermarkPictureStory) => {
    const assets = [...(assetSelections.get(story.story_id) ?? [])];
    if (assets.length === 0) return;
    setBusyStories((current) => new Set(current).add(story.story_id));
    try {
      const result = await queueWatermarkPictureStory(story.story_id, story.title, assets);
      showToast(result.message, 'success', 3000, 'top-center');
      setSelected((current) => {
        const next = new Map(current);
        next.delete(story.story_id);
        return next;
      });
      await refreshStatus();
    } catch (queueError) {
      showToast(queueError instanceof Error ? queueError.message : 'Could not queue picture repair.', 'error', 5000, 'top-center');
    } finally {
      setBusyStories((current) => {
        const next = new Set(current);
        next.delete(story.story_id);
        return next;
      });
    }
  };

  const queueSelected = async () => {
    if (selected.size === 0) return;
    setBatchBusy(true);
    try {
      const response = await queueWatermarkPictureBatch({
        stories: Array.from(selected, ([story_id, title]) => ({
          story_id,
          title,
          asset_types: [...(assetSelections.get(story_id) ?? [])],
        })).filter((story) => story.asset_types.length > 0),
      });
      showToast(
        `${response.queued_count} ${response.queued_count === 1 ? 'story' : 'stories'} queued${response.existing_count ? `; ${response.existing_count} already active` : ''}.`,
        'success',
        4000,
        'top-center',
      );
      setSelected(new Map());
      await refreshStatus();
    } catch (queueError) {
      showToast(queueError instanceof Error ? queueError.message : 'Could not queue selected stories.', 'error', 5000, 'top-center');
    } finally {
      setBatchBusy(false);
    }
  };

  const queueAll = async () => {
    const scope = keyword ? `${data?.total ?? 0} matching stories` : `${data?.total ?? 0} stories`;
    if (!window.confirm(`Queue picture repair for all ${scope}? Jobs will run one story at a time in the background.`)) return;
    setBatchBusy(true);
    try {
      const response = await queueWatermarkPictureBatch({ all_stories: true, keyword });
      showToast(
        `${response.queued_count} stories queued${response.existing_count ? `; ${response.existing_count} already active` : ''}.`,
        'success',
        5000,
        'top-center',
      );
      setSelected(new Map());
      await refreshStatus();
    } catch (queueError) {
      showToast(queueError instanceof Error ? queueError.message : 'Could not queue all stories.', 'error', 5000, 'top-center');
    } finally {
      setBatchBusy(false);
    }
  };

  const checkCatalog = async () => {
    setPage(1);
    setKeyword('');
    setSearchDraft('');
    setSelected(new Map());
    const succeeded = await load(false, 1, '');
    if (succeeded) {
      setCatalogChecked(true);
      showToast('Latest server pictures loaded. Search and repair controls are ready.', 'success', 3500, 'top-center');
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!catalogChecked) return;
    const nextKeyword = searchDraft.trim();
    setPage(1);
    setKeyword(nextKeyword);
    setSelected(new Map());
    void load(false, 1, nextKeyword);
  };

  const clearSearch = () => {
    setSearchDraft('');
    setKeyword('');
    setPage(1);
    setSelected(new Map());
    void load(false, 1, '');
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    setSelected(new Map());
    void load(false, nextPage, keyword);
  };

  const selectedPictureCount = [...selected.keys()].reduce(
    (total, storyId) => total + (assetSelections.get(storyId)?.size ?? 0),
    0,
  );

  const queueCards = [
    { label: 'Server stories', value: data?.total ?? 0, caption: keyword ? 'Matching this search' : 'Available for repair', tone: tokens.colors.text },
    { label: 'Waiting', value: data?.queued ?? 0, caption: 'Persistent background queue', tone: tokens.colors.warning },
    { label: 'Processing', value: data?.running ?? 0, caption: 'One repair story at a time', tone: '#2563eb' },
    { label: 'Completed', value: data?.completed ?? 0, caption: 'Latest repair jobs', tone: tokens.colors.success },
    { label: 'Attention', value: data?.failed ?? 0, caption: 'Review errors and retry', tone: tokens.colors.danger },
  ];

  return (
    <PageShell themeMode={themeMode} className="px-5 py-7 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1560px]">
        <PageHeader
          themeMode={themeMode}
          eyebrow="Server maintenance"
          title="Fix Watermark Pictures"
          description="Check every story's cover, banner, and intro with the automatic detector, clean supported Gemini watermarks, then replace only the pictures that changed. Work is persistent and queued safely in the background."
          actions={(
            <ActionButton
              tone="primary"
              icon={loading ? 'spinner' : 'eye'}
              disabled={loading || refreshing}
              onClick={() => void checkCatalog()}
              className={loading ? '[&>svg]:animate-spin' : ''}
            >
              {loading ? 'Checking…' : catalogChecked ? 'Re-check pictures' : 'Check pictures'}
            </ActionButton>
          )}
        />

        {!catalogChecked && (
          <Surface className="mb-5 flex flex-col items-start justify-between gap-4 border-orange-500/25 p-5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <Icon icon={appIcons.eye} className="mt-1 h-5 w-5 shrink-0 text-[#ff5b00]" />
              <div>
                <h2 className="text-sm font-extrabold">Check the newest server pictures first</h2>
                <p className="mt-1 text-xs leading-5" style={{ color: tokens.colors.textMuted }}>
                  Search and repair stay locked until the current cover, banner, and intro data has been loaded from the server.
                </p>
              </div>
            </div>
            <ActionButton tone="primary" icon={loading ? 'spinner' : 'eye'} disabled={loading} onClick={() => void checkCatalog()}>
              {loading ? 'Checking…' : 'Check pictures'}
            </ActionButton>
          </Surface>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {queueCards.map((card) => (
            <Surface key={card.label} className="p-4">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em]" style={{ color: tokens.colors.textMuted }}>{card.label}</p>
              <p className="mt-2 text-2xl font-black" style={{ color: card.tone }}>{card.value.toLocaleString()}</p>
              <p className="mt-1 text-[11px] font-medium" style={{ color: tokens.colors.textMuted }}>{card.caption}</p>
            </Surface>
          ))}
        </div>

        <Surface className="mt-5 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
              <div className="relative min-w-0 flex-1 xl:max-w-xl">
                <Icon icon={appIcons.search} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: tokens.colors.textMuted }} />
                <TextInput
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search stories by title"
                  disabled={!catalogChecked}
                  className="h-10 w-full pl-9 pr-3 text-sm"
                />
              </div>
              <ActionButton type="submit" disabled={!catalogChecked || loading}>Search</ActionButton>
              {keyword && (
                <ActionButton type="button" onClick={clearSearch}>
                  Clear
                </ActionButton>
              )}
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 px-2 text-xs font-bold" style={{ color: tokens.colors.textSoft }}>
                <input type="checkbox" checked={pageFullySelected} disabled={!catalogChecked} onChange={togglePage} className="h-4 w-4 accent-[#ff5b00]" />
                Select this page
              </label>
              <ActionButton tone="active" icon="refresh" disabled={selected.size === 0 || batchBusy} onClick={() => void queueSelected()}>
                Fix selected ({selectedPictureCount})
              </ActionButton>
              <ActionButton tone="primary" icon="syncHistory" disabled={!data?.total || batchBusy} onClick={() => void queueAll()}>
                {batchBusy ? 'Queueing…' : keyword ? 'Fix all results' : 'Fix all stories'}
              </ActionButton>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-5" style={{ background: tokens.colors.surfaceMuted, color: tokens.colors.textSoft }}>
            <Icon icon={appIcons.info} className="mt-1 h-3 w-3 shrink-0" />
            <span>Normal story uploads and updates always run before this maintenance queue. Clean or missing pictures are not uploaded again; failed assets can be retried from their story card.</span>
          </div>
        </Surface>

        {error && (
          <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/5 p-4 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}

        {!catalogChecked ? (
          <div className="mt-5">
            <EmptyState icon="image" title="Pictures not checked yet" description="Click Check pictures to load the newest server assets before searching or repairing." />
          </div>
        ) : loading && !data ? (
          <div className="flex min-h-80 items-center justify-center gap-3" style={{ color: tokens.colors.textMuted }}>
            <Icon icon={appIcons.spinner} className="h-5 w-5 animate-spin" />
            <span className="text-sm font-bold">Loading server pictures…</span>
          </div>
        ) : data?.items.length ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {data.items.map((story) => (
              <StoryCard
                key={story.story_id}
                story={story}
                selected={selected.has(story.story_id)}
                selectedAssets={assetSelections.get(story.story_id) ?? new Set()}
                busy={busyStories.has(story.story_id)}
                onToggle={() => toggleStory(story)}
                onToggleAsset={(type) => toggleAsset(story, type)}
                onQueue={() => void queueStory(story)}
                themeMode={themeMode}
                previewRevision={previewRevision}
              />
            ))}
          </div>
        ) : (
          <div className="mt-5">
            <EmptyState icon="image" title="No stories found" description={keyword ? 'Try another title search.' : 'The main server returned no stories.'} />
          </div>
        )}

        {data && data.pages > 1 && (
          <div className="mt-6 flex items-center justify-between gap-3 pb-8">
            <p className="text-xs font-semibold" style={{ color: tokens.colors.textMuted }}>
              Page {data.page.toLocaleString()} of {data.pages.toLocaleString()} · {data.total.toLocaleString()} stories
            </p>
            <div className="flex gap-2">
              <ActionButton icon="chevronLeft" disabled={page <= 1 || loading} onClick={() => goToPage(Math.max(1, page - 1))}>Previous</ActionButton>
              <ActionButton icon="chevronRight" disabled={page >= data.pages || loading} onClick={() => goToPage(Math.min(data.pages, page + 1))}>Next</ActionButton>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
