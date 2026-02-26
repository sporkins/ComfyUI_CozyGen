import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCozyHistoryList,
  getCozyMediaUrl,
  getCozyMediaUrlFromPreviewUrl,
  getHistory,
  parseMediaRefFromUrl,
  getThumbUrl,
} from '../api';
import LazyMedia from './LazyMedia';
import SearchableSelect from './SearchableSelect';
import {
  diffComparableHistoryItems,
  extractHistoryMedia,
  formatHistoryValueForDisplay,
  getHistoryWorkflowName,
  isGifUrl,
  isVideoUrl,
  selectFinalMediaItems,
  selectFinalPreviewUrls,
} from '../utils/historyUtils';

const HISTORY_SORT_KEY = 'historySortOrder';
const HISTORY_SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date: Newest first' },
  { value: 'date_asc', label: 'Date: Oldest first' },
];
const WORKFLOW_FILTER_ALL = '__all__';
const WORKFLOW_FILTER_UNKNOWN = '__unknown__';

const getWorkflowFilterValue = (item) => {
  const workflowName = getHistoryWorkflowName(item);
  return workflowName || WORKFLOW_FILTER_UNKNOWN;
};

const getWorkflowLabel = (item) => getHistoryWorkflowName(item) || 'Unknown workflow';

const formatDiffCell = (value) => {
  if (value === undefined) return '(not set)';
  const text = formatHistoryValueForDisplay(value);
  return text === '' ? '(empty)' : text;
};

const isTempPreviewUrl = (url) => String(parseMediaRefFromUrl(url)?.type || '') === 'temp';

const filterHistoryPreviewUrls = (previewUrls) => (
  (Array.isArray(previewUrls) ? previewUrls : []).filter((url) => !isTempPreviewUrl(url))
);

const HistoryPreviewGrid = ({ itemId, previewUrls = [], mediaItems = [] }) => {
  const finalPreviewUrls = selectFinalPreviewUrls(previewUrls);
  const finalMediaItems = selectFinalMediaItems(mediaItems);

  if (finalPreviewUrls.length === 0 && finalMediaItems.length === 0) {
    return null;
  }

  if (finalPreviewUrls.length > 0) {
    return (
      <div className="space-y-2">
        {previewUrls.length > finalPreviewUrls.length && (
          <p className="text-xs text-gray-500">
            Showing final result previews only (last image/video).
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {finalPreviewUrls.map((url, index) => {
            const resolvedUrl = getCozyMediaUrlFromPreviewUrl(url);
            const isVideoFile = isVideoUrl(url);
            return (
              <div
                key={`${itemId}-preview-${index}`}
                className="aspect-square bg-base-300 rounded-lg overflow-hidden"
              >
                {isVideoFile ? (
                  <LazyMedia
                    type="video"
                    src={resolvedUrl}
                    className="w-full h-full object-cover"
                    rootMargin="300px"
                  />
                ) : (
                  <LazyMedia
                    type="image"
                    src={resolvedUrl}
                    alt="History preview"
                    className="w-full h-full object-cover"
                    rootMargin="300px"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {mediaItems.length > finalMediaItems.length && (
        <p className="text-xs text-gray-500">
          Showing final result previews only (last image/video).
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {finalMediaItems.map((media, index) => {
          const isVideoFile = isVideoUrl(media.filename);
          const isGifFile = isGifUrl(media.filename);
          const fullUrl = getCozyMediaUrl(media.filename, media.subfolder, media.type);
          const thumbUrl = getThumbUrl(media.filename, media.subfolder, media.type, {
            w: 256,
            q: 45,
            fmt: 'webp',
          });
          return (
            <div
              key={`${itemId}-media-${index}`}
              className="aspect-square bg-base-300 rounded-lg overflow-hidden"
            >
              {isVideoFile ? (
                <LazyMedia
                  type="video"
                  src={fullUrl}
                  className="w-full h-full object-cover"
                  rootMargin="300px"
                />
              ) : (
                <LazyMedia
                  type="image"
                  src={isGifFile ? fullUrl : (thumbUrl || fullUrl)}
                  fallbackSrc={fullUrl}
                  alt="History preview"
                  className="w-full h-full object-cover"
                  rootMargin="300px"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const HistoryTab = () => {
  const navigate = useNavigate();
  const [historyItems, setHistoryItems] = useState([]);
  const [historyOutputs, setHistoryOutputs] = useState({});
  const [sortOrder, setSortOrder] = useState(localStorage.getItem(HISTORY_SORT_KEY) || 'date_desc');
  const [workflowFilter, setWorkflowFilter] = useState(WORKFLOW_FILTER_ALL);
  const [compareSelection, setCompareSelection] = useState([]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const data = await getCozyHistoryList();
        setHistoryItems(data.items || []);
      } catch (error) {
        console.warn('CozyGen: failed to load history list', error);
        setHistoryItems([]);
      }
    };

    loadHistory();
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_SORT_KEY, sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    if (historyItems.length === 0) {
      return;
    }

    const fetchOutputs = async () => {
      const outputsById = {};
      await Promise.all(historyItems.map(async (item) => {
        if (!item?.id) return;
        if (historyOutputs[item.id]) return;
        const nonTempPreviewUrls = filterHistoryPreviewUrls(item.preview_images);
        if (nonTempPreviewUrls.length > 0) return;
        try {
          const historyData = await getHistory(item.id);
          const historyEntry = historyData?.[item.id] || historyData?.history?.[item.id];
          if (historyEntry) {
            outputsById[item.id] = historyEntry;
          }
        } catch (error) {
          console.warn(`CozyGen: failed to fetch history for ${item.id}`, error);
        }
      }));

      if (Object.keys(outputsById).length > 0) {
        setHistoryOutputs((prev) => ({ ...prev, ...outputsById }));
      }
    };

    fetchOutputs();
  }, [historyItems, historyOutputs]);

  useEffect(() => {
    const validIds = new Set(historyItems.map((item) => String(item?.id || '')));
    setCompareSelection((prev) => prev.filter((id) => validIds.has(String(id))));
  }, [historyItems]);

  const historyItemsById = useMemo(() => (
    Object.fromEntries(historyItems.map((item) => [String(item.id), item]))
  ), [historyItems]);

  const workflowFilterOptions = useMemo(() => {
    const workflowNames = new Set();
    let hasUnknown = false;

    historyItems.forEach((item) => {
      const workflowName = getHistoryWorkflowName(item);
      if (workflowName) {
        workflowNames.add(workflowName);
      } else {
        hasUnknown = true;
      }
    });

    const options = [
      { value: WORKFLOW_FILTER_ALL, label: 'All workflows' },
      ...[...workflowNames]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
    ];

    if (hasUnknown) {
      options.push({ value: WORKFLOW_FILTER_UNKNOWN, label: 'Unknown workflow' });
    }

    return options;
  }, [historyItems]);

  const visibleHistoryItems = useMemo(() => {
    const parseTimestamp = (item) => {
      const ts = item?.timestamp;
      const parsed = ts ? new Date(ts).getTime() : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const filtered = historyItems.filter((item) => {
      if (workflowFilter === WORKFLOW_FILTER_ALL) return true;
      return getWorkflowFilterValue(item) === workflowFilter;
    });

    filtered.sort((a, b) => {
      const diff = parseTimestamp(a) - parseTimestamp(b);
      if (diff !== 0) {
        return sortOrder === 'date_desc' ? -diff : diff;
      }
      return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    });

    return filtered;
  }, [historyItems, sortOrder, workflowFilter]);

  const comparedItems = compareSelection
    .map((id) => historyItemsById[String(id)])
    .filter(Boolean);

  const compareDiffs = useMemo(() => {
    if (comparedItems.length !== 2) return [];
    return diffComparableHistoryItems(comparedItems[0], comparedItems[1]);
  }, [comparedItems]);

  const toggleCompareSelection = (itemId) => {
    const nextId = String(itemId);
    setCompareSelection((prev) => {
      if (prev.includes(nextId)) {
        return prev.filter((id) => id !== nextId);
      }
      const next = [...prev, nextId];
      return next.length <= 2 ? next : next.slice(next.length - 2);
    });
  };

  const handleHistoryClick = (item) => {
    if (!item?.id) return;
    navigate(`/history/${encodeURIComponent(String(item.id))}`, {
      state: { historyItem: item },
    });
  };

  if (historyItems.length === 0) {
    return (
      <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
        No history entries yet. Generate something to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="bg-base-200 shadow-lg rounded-lg p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-400 whitespace-nowrap">Sort:</span>
        <SearchableSelect
          id="history-sort-order"
          className="w-48 sm:w-56"
          buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
          value={sortOrder}
          onChange={setSortOrder}
          options={HISTORY_SORT_OPTIONS}
          listMaxHeightClassName="max-h-40"
        />
        <span className="text-sm text-gray-400 whitespace-nowrap sm:ml-2">Workflow:</span>
        <SearchableSelect
          id="history-workflow-filter"
          className="w-56 sm:w-72"
          buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
          value={workflowFilter}
          onChange={setWorkflowFilter}
          options={workflowFilterOptions}
          listMaxHeightClassName="max-h-56"
        />
        <div className="sm:ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">
            Compare: {compareSelection.length}/2 selected
          </span>
          <button
            type="button"
            onClick={() => setCompareSelection([])}
            disabled={compareSelection.length === 0}
            className="btn btn-xs btn-outline"
          >
            Clear Compare
          </button>
        </div>
      </div>

      {comparedItems.length === 2 && (
        <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-white">Compare History Items</h2>
              <p className="text-xs text-gray-400">
                Showing differences in saved workflow/form fields and toggles only (ignores prompt id/timestamps/runtime fields).
              </p>
            </div>
            <div className="text-xs text-gray-400">
              {comparedItems[0]?.id} vs {comparedItems[1]?.id}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {comparedItems.map((item, index) => (
              <div key={`${item.id}-${index}`} className="bg-base-300/40 rounded-md p-3">
                <p className="text-xs text-gray-400">Item {index + 1}</p>
                <p className="font-semibold text-white break-all">{item.id}</p>
                <p className="text-xs text-gray-400 mt-1">{getWorkflowLabel(item)}</p>
              </div>
            ))}
          </div>

          {compareDiffs.length === 0 ? (
            <p className="text-sm text-gray-300">
              No differences in the saved field overrides for these two history items.
            </p>
          ) : (
            <div className="space-y-2">
              {compareDiffs.map((diff) => (
                <div key={diff.key} className="bg-base-300/40 rounded-md p-3">
                  <p className="text-xs text-gray-400 mb-2">{diff.key}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="rounded-md bg-base-100/60 p-2">
                      <p className="text-xs text-gray-400 mb-1">Item 1</p>
                      <pre className="text-xs text-white whitespace-pre-wrap break-all">
                        {formatDiffCell(diff.leftValue)}
                      </pre>
                    </div>
                    <div className="rounded-md bg-base-100/60 p-2">
                      <p className="text-xs text-gray-400 mb-1">Item 2</p>
                      <pre className="text-xs text-white whitespace-pre-wrap break-all">
                        {formatDiffCell(diff.rightValue)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {visibleHistoryItems.length === 0 && (
        <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
          No history entries match the selected workflow filter.
        </div>
      )}

      {visibleHistoryItems.map((item) => {
        const itemId = String(item.id);
        const historyEntry = historyOutputs[item.id];
        const mediaItems = extractHistoryMedia(historyEntry);
        const previewUrls = filterHistoryPreviewUrls(item.preview_images);
        const timestamp = item.timestamp ? new Date(item.timestamp) : null;
        const isSelectedForCompare = compareSelection.includes(itemId);

        return (
          <div
            key={itemId}
            className="bg-base-200 shadow-lg rounded-lg p-4 space-y-3 cursor-pointer hover:bg-base-300/70 transition-colors"
            onClick={() => handleHistoryClick(item)}
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-400">Prompt ID</p>
                  <p className="text-white font-semibold break-all">{itemId}</p>
                  <p className="text-xs text-gray-400 mt-1 break-all">
                    Workflow: {getWorkflowLabel(item)}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <div className="text-sm text-gray-400">
                    {timestamp ? timestamp.toLocaleString() : 'Unknown time'}
                  </div>
                  <button
                    type="button"
                    className={`btn btn-xs ${isSelectedForCompare ? 'btn-accent' : 'btn-outline'}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCompareSelection(itemId);
                    }}
                  >
                    {isSelectedForCompare ? 'Selected' : 'Compare'}
                  </button>
                </div>
              </div>
            </div>

            {mediaItems.length === 0 && previewUrls.length === 0 && (
              <p className="text-sm text-gray-400">
                {historyEntry ? 'No previews found for this prompt.' : 'Loading previews...'}
              </p>
            )}

            <HistoryPreviewGrid itemId={itemId} previewUrls={previewUrls} mediaItems={mediaItems} />

            <div className="text-xs text-gray-500">
              Click to open history details and copy/apply saved settings.
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default HistoryTab;
