import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  getCozyHistoryItem,
  getCozyMediaUrl,
  getCozyMediaUrlFromPreviewUrl,
  getHistory,
  getThumbUrl,
  parseMediaRefFromUrl,
} from '../api';
import LazyMedia from '../components/LazyMedia';
import {
  buildHistoryOverrideGroups,
  extractHistoryMedia,
  formatHistoryValueForDisplay,
  getHistoryWorkflowName,
  isGifUrl,
  isVideoUrl,
} from '../utils/historyUtils';

const HISTORY_SELECTION_KEY = 'historySelection';

const copyText = async (text) => {
  if (!navigator?.clipboard?.writeText) {
    throw new Error('Clipboard API unavailable');
  }
  await navigator.clipboard.writeText(text);
};

const filterHistoryPreviewUrls = (previewUrls) => (
  (Array.isArray(previewUrls) ? previewUrls : []).filter((url) => String(parseMediaRefFromUrl(url)?.type || '') !== 'temp')
);

const PREVIEW_GRID_THUMB_OPTIONS = {
  w: 240,
  q: 55,
  fmt: 'webp',
};

const buildPreviewCandidates = (previewUrls, mediaItems, itemId) => {
  if (Array.isArray(previewUrls) && previewUrls.length > 0) {
    return previewUrls.map((url, index) => {
      const mediaRef = parseMediaRefFromUrl(url);
      const nameForType = mediaRef?.filename || url;
      const isVideoFile = isVideoUrl(nameForType);
      const isGifFile = isGifUrl(nameForType);
      const fullUrl = getCozyMediaUrlFromPreviewUrl(url);
      const thumbUrl = mediaRef && !isVideoFile && !isGifFile
        ? getThumbUrl(mediaRef.filename, mediaRef.subfolder, mediaRef.type, PREVIEW_GRID_THUMB_OPTIONS)
        : null;

      return {
        key: `${itemId}-preview-${index}`,
        mediaType: isVideoFile ? 'video' : 'image',
        fullUrl,
        thumbUrl,
        alt: 'History preview',
        sourceLabel: 'Saved preview order',
      };
    });
  }

  if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
    return [];
  }

  return mediaItems.map((media, index) => {
    const isVideoFile = isVideoUrl(media.filename);
    const isGifFile = isGifUrl(media.filename);
    const fullUrl = getCozyMediaUrl(media.filename, media.subfolder, media.type);
    const thumbUrl = !isVideoFile && !isGifFile
      ? getThumbUrl(media.filename, media.subfolder, media.type, PREVIEW_GRID_THUMB_OPTIONS)
      : null;

    return {
      key: `${itemId}-media-${index}`,
      mediaType: isVideoFile ? 'video' : 'image',
      fullUrl,
      thumbUrl,
      alt: media.filename || 'History preview',
      sourceLabel: 'Comfy output order',
    };
  });
};

const PreviewBlock = ({ itemId, previewUrls = [], mediaItems = [] }) => {
  const previewCandidates = useMemo(
    () => buildPreviewCandidates(previewUrls, mediaItems, itemId),
    [itemId, mediaItems, previewUrls]
  );
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    if (previewCandidates.length === 0) {
      setSelectedKey('');
      return;
    }
    setSelectedKey((prev) => (
      previewCandidates.some((candidate) => candidate.key === prev)
        ? prev
        : previewCandidates[previewCandidates.length - 1].key
    ));
  }, [previewCandidates]);

  const selectedPreview = previewCandidates.find((candidate) => candidate.key === selectedKey)
    || previewCandidates[previewCandidates.length - 1]
    || null;

  if (!selectedPreview) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-xs text-gray-400">
          Main preview defaults to the last result. Select another preview below.
        </p>
        <p className="text-xs text-gray-500">
          {previewCandidates.length} preview{previewCandidates.length === 1 ? '' : 's'} • {selectedPreview.sourceLabel}
        </p>
      </div>

      <div className="bg-base-300 rounded-lg overflow-hidden">
        <div className="aspect-square sm:aspect-[4/3]">
          {selectedPreview.mediaType === 'video' ? (
            <LazyMedia
              type="video"
              src={selectedPreview.fullUrl}
              className="w-full h-full object-contain bg-black"
              rootMargin="300px"
            />
          ) : (
            <LazyMedia
              type="image"
              src={selectedPreview.fullUrl}
              fallbackSrc={selectedPreview.fullUrl}
              alt={selectedPreview.alt}
              className="w-full h-full object-contain bg-base-300"
              rootMargin="300px"
            />
          )}
        </div>
      </div>

      {previewCandidates.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Run/job previews</p>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
            {previewCandidates.map((candidate, index) => {
              const isSelected = candidate.key === selectedPreview.key;
              const isVideo = candidate.mediaType === 'video';
              const imageSrc = candidate.thumbUrl || candidate.fullUrl;
              return (
                <button
                  key={candidate.key}
                  type="button"
                  onClick={() => setSelectedKey(candidate.key)}
                  aria-pressed={isSelected}
                  aria-label={`Select preview ${index + 1}`}
                  className={[
                    'relative aspect-square rounded-md overflow-hidden bg-base-300',
                    'border transition-colors',
                    isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-base-content/10 hover:border-base-content/30',
                  ].join(' ')}
                >
                  {isVideo ? (
                    <>
                      <LazyMedia
                        type="video"
                        src={candidate.fullUrl}
                        className="w-full h-full object-cover"
                        rootMargin="200px"
                      />
                      <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">
                        VIDEO
                      </span>
                    </>
                  ) : (
                    <LazyMedia
                      type="image"
                      src={imageSrc}
                      fallbackSrc={candidate.fullUrl}
                      alt={candidate.alt}
                      className="w-full h-full object-cover"
                      rootMargin="200px"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const OverrideSection = ({
  title,
  entries,
  valuePrefix = '',
  onCopyEntry,
}) => {
  if (!entries.length) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <span className="text-xs text-gray-400">0</span>
        </div>
        <p className="text-sm text-gray-400 mt-2">No entries.</p>
      </div>
    );
  }

  return (
    <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <span className="text-xs text-gray-400">{entries.length}</span>
      </div>
      <div className="space-y-2">
        {entries.map(([key, value]) => {
          const copyPayload = `${valuePrefix}${key}: ${formatHistoryValueForDisplay(value)}`;
          return (
            <div key={`${title}-${key}`} className="bg-base-300/40 rounded-md p-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400 break-all">{key}</p>
                  <pre className="mt-1 text-xs text-white whitespace-pre-wrap break-all">
                    {formatHistoryValueForDisplay(value)}
                  </pre>
                </div>
                <button
                  type="button"
                  className="btn btn-xs btn-outline self-start"
                  onClick={() => onCopyEntry(copyPayload)}
                >
                  Copy
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const HistoryDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const historyId = String(params.historyId || '');
  const seedHistoryItem = location.state?.historyItem && String(location.state.historyItem?.id) === historyId
    ? location.state.historyItem
    : null;

  const [historyItem, setHistoryItem] = useState(seedHistoryItem);
  const [historyEntry, setHistoryEntry] = useState(null);
  const [isLoading, setIsLoading] = useState(!seedHistoryItem);
  const [errorText, setErrorText] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadHistoryItem = async () => {
      setIsLoading(true);
      setErrorText('');

      try {
        const [cozyItem, comfyHistoryData] = await Promise.all([
          getCozyHistoryItem(historyId),
          getHistory(historyId).catch(() => null),
        ]);

        if (cancelled) return;

        setHistoryItem(cozyItem);
        const comfyEntry = comfyHistoryData?.[historyId] || comfyHistoryData?.history?.[historyId] || null;
        setHistoryEntry(comfyEntry);
      } catch (error) {
        if (cancelled) return;
        console.warn(`CozyGen: failed to load history item ${historyId}`, error);
        setErrorText('Failed to load history item.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    if (historyId) {
      loadHistoryItem();
    } else {
      setErrorText('Missing history id.');
      setIsLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [historyId]);

  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = window.setTimeout(() => setCopyStatus(''), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const overrideGroups = useMemo(() => buildHistoryOverrideGroups(historyItem), [historyItem]);
  const previewUrls = filterHistoryPreviewUrls(historyItem?.preview_images);
  const mediaItems = useMemo(() => extractHistoryMedia(historyEntry), [historyEntry]);
  const timestamp = historyItem?.timestamp ? new Date(historyItem.timestamp) : null;

  const handleCopy = async (text, label = 'Copied') => {
    try {
      await copyText(text);
      setCopyStatus(label);
    } catch (error) {
      console.warn('CozyGen: failed to copy to clipboard', error);
      window.alert('Failed to copy to clipboard.');
    }
  };

  const handleCopyAll = async () => {
    if (!historyItem) return;
    const payload = {
      selectedWorkflow: getHistoryWorkflowName(historyItem) || undefined,
      formData: Object.fromEntries(overrideGroups.formDataEntries),
      randomizeState: Object.fromEntries(overrideGroups.randomizeEntries),
      bypassedState: Object.fromEntries(overrideGroups.bypassedEntries),
    };
    await handleCopy(JSON.stringify(payload, null, 2), 'Copied all overrides');
  };

  const handleGenerate = () => {
    if (!historyItem?.json) {
      window.alert('This history item does not include a saved workflow payload.');
      return;
    }
    localStorage.setItem(HISTORY_SELECTION_KEY, JSON.stringify(historyItem));
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
        Loading history item...
      </div>
    );
  }

  if (errorText || !historyItem) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-6 space-y-3">
        <p className="text-red-300">{errorText || 'History item not found.'}</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/history')}>
          Back to History
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400">Prompt ID</p>
            <p className="text-white font-semibold break-all">{historyItem.id}</p>
            <p className="text-xs text-gray-400 mt-1 break-all">
              Workflow: {getHistoryWorkflowName(historyItem) || 'Unknown workflow'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {timestamp ? timestamp.toLocaleString() : 'Unknown time'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => navigate('/history')}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleCopyAll}
            >
              Copy All Overrides
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleGenerate}
            >
              Generate
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          This page shows the saved settings payload. Use <span className="text-white">Generate</span> to open the Generate page and apply it.
        </p>
        {copyStatus && (
          <p className="text-xs text-green-300">{copyStatus}</p>
        )}
      </div>

      <div className="bg-base-200 shadow-lg rounded-lg p-4">
        <h2 className="text-lg font-semibold text-white mb-3">Final Result Preview</h2>
        {previewUrls.length === 0 && mediaItems.length === 0 ? (
          <p className="text-sm text-gray-400">No preview media found for this history item.</p>
        ) : (
          <PreviewBlock itemId={String(historyItem.id)} previewUrls={previewUrls} mediaItems={mediaItems} />
        )}
      </div>

      <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Saved Overrides Summary</h2>
          <span className="text-xs text-gray-400">
            {overrideGroups.formDataEntries.length + overrideGroups.randomizeEntries.length + overrideGroups.bypassedEntries.length + (overrideGroups.workflowName ? 1 : 0)} entries
          </span>
        </div>
        <p className="text-xs text-gray-400">
          Note: history entries store the saved settings payload, not per-output media timestamps. Final previews are inferred from preview/output order.
        </p>
        {overrideGroups.workflowName ? (
          <div className="bg-base-300/40 rounded-md p-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-gray-400">selectedWorkflow</p>
                <p className="text-sm text-white break-all">{overrideGroups.workflowName}</p>
              </div>
              <button
                type="button"
                className="btn btn-xs btn-outline self-start"
                onClick={() => handleCopy(`selectedWorkflow: ${overrideGroups.workflowName}`, 'Copied workflow')}
              >
                Copy
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No saved workflow name on this history entry.</p>
        )}
      </div>

      <OverrideSection
        title="Form Data"
        entries={overrideGroups.formDataEntries}
        valuePrefix="formData."
        onCopyEntry={(text) => handleCopy(text, 'Copied form field')}
      />
      <OverrideSection
        title="Randomize Toggles (Enabled)"
        entries={overrideGroups.randomizeEntries}
        valuePrefix="randomizeState."
        onCopyEntry={(text) => handleCopy(text, 'Copied randomize toggle')}
      />
      <OverrideSection
        title="Bypass Toggles (Enabled)"
        entries={overrideGroups.bypassedEntries}
        valuePrefix="bypassedState."
        onCopyEntry={(text) => handleCopy(text, 'Copied bypass toggle')}
      />
    </div>
  );
};

export default HistoryDetail;
