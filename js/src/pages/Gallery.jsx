import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCozyHistoryList,
  getCozyMediaUrl,
  getHistory,
  getThumbUrl,
  parseMediaRefFromUrl,
} from '../api';
import LazyMedia from '../components/LazyMedia';
import SearchableSelect from '../components/SearchableSelect';
import { extractHistoryMedia, getHistoryWorkflowName, isGifUrl, isVideoUrl } from '../utils/historyUtils';
import { PROJECTS_STATE_KEY, readJsonStorage, setActiveProjectContext } from '../utils/projectUtils';

const HISTORY_SELECTION_KEY = 'historySelection';
const PROJECT_FILTER_ALL = '__all__';
const PROJECT_FILTER_UNASSIGNED = '__unassigned__';
const TYPE_FILTER_ALL = 'all';
const SORT_DATE_DESC = 'date_desc';
const SORT_DATE_ASC = 'date_asc';
const THUMB_OPTIONS = { w: 360, q: 55, fmt: 'webp' };

const TYPE_FILTER_OPTIONS = [
  { value: TYPE_FILTER_ALL, label: 'Type: All' },
  { value: 'image', label: 'Type: Image' },
  { value: 'video', label: 'Type: Video' },
  { value: 'gif', label: 'Type: GIF' },
  { value: 'audio', label: 'Type: Audio' },
  { value: 'other', label: 'Type: Other' },
];

const SORT_OPTIONS = [
  { value: SORT_DATE_DESC, label: 'Date: Newest first' },
  { value: SORT_DATE_ASC, label: 'Date: Oldest first' },
];

const isTempPreview = (url) => String(parseMediaRefFromUrl(url)?.type || '') === 'temp';

const projectIdFor = (run) => String(run?.project_id || run?.fields?.project_id || '').trim();
const projectNameFor = (run) => String(run?.project_name || run?.fields?.project_name || '').trim();
const isFavoriteRun = (run) => Boolean(run?.favorite || run?.fields?.favorite);

const parseTimestampMs = (run) => {
  const value = run?.timestamp || run?.finished_at || run?.started_at || run?.fields?.finished_at || run?.fields?.started_at || '';
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTimestamp = (valueMs) => (valueMs > 0 ? new Date(valueMs).toLocaleString() : 'Unknown time');

const formatRuntime = (run) => {
  const direct = Number(run?.runtime_ms ?? run?.fields?.runtime_ms);
  if (Number.isFinite(direct) && direct > 0) return `${(direct / 1000).toFixed(1)}s`;
  const startMs = new Date(run?.started_at || run?.fields?.started_at || '').getTime();
  const endMs = new Date(run?.finished_at || run?.fields?.finished_at || run?.timestamp || '').getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 'n/a';
  return `${((endMs - startMs) / 1000).toFixed(1)}s`;
};

const mediaTypeFromFilename = (filename) => {
  const value = String(filename || '');
  if (isVideoUrl(value)) return 'video';
  if (isGifUrl(value)) return 'gif';
  if (/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(value)) return 'image';
  if (/\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(value)) return 'audio';
  return 'other';
};

const readSavedProjectNames = () => {
  const state = readJsonStorage(PROJECTS_STATE_KEY, null);
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  return Object.fromEntries(
    projects
      .map((project) => {
        const id = String(project?.id || '').trim();
        const name = String(project?.name || '').trim();
        return [id, name];
      })
      .filter(([id, name]) => Boolean(id && name))
  );
};

const projectMetaForRun = (run, savedProjectNames) => {
  const projectId = projectIdFor(run);
  const projectName = savedProjectNames[projectId] || projectNameFor(run) || '';
  if (projectId) {
    return {
      projectId,
      projectName,
      projectLabel: projectName || projectId,
      projectFilterKey: `id:${projectId}`,
    };
  }
  if (projectName) {
    return {
      projectId: '',
      projectName,
      projectLabel: projectName,
      projectFilterKey: `name:${projectName.toLowerCase()}`,
    };
  }
  return {
    projectId: '',
    projectName: '',
    projectLabel: 'Unassigned',
    projectFilterKey: '',
  };
};

const buildMediaForRun = (run, historyEntry) => {
  const merged = [];
  const seen = new Set();

  const pushRef = (entry) => {
    if (!entry?.filename) return;
    const normalized = {
      filename: String(entry.filename),
      subfolder: String(entry.subfolder || ''),
      type: String(entry.type || 'output'),
    };
    if (normalized.type === 'temp') return;
    const key = `${normalized.type}::${normalized.subfolder}::${normalized.filename}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...normalized, key });
  };

  const previewUrls = Array.isArray(run?.preview_images) ? run.preview_images : [];
  previewUrls
    .filter((url) => !isTempPreview(url))
    .forEach((url) => {
      const parsed = parseMediaRefFromUrl(url);
      if (parsed) pushRef(parsed);
    });

  extractHistoryMedia(historyEntry).forEach((entry) => pushRef(entry));

  const lastIndexByType = {};
  merged.forEach((entry, index) => {
    const mediaType = mediaTypeFromFilename(entry.filename);
    lastIndexByType[mediaType] = index;
  });

  return merged.map((entry, index) => {
    const mediaType = mediaTypeFromFilename(entry.filename);
    return {
      ...entry,
      mediaType,
      sequenceIndex: index,
      isFinalForType: lastIndexByType[mediaType] === index,
      fullUrl: getCozyMediaUrl(entry.filename, entry.subfolder, entry.type),
      thumbUrl: mediaType === 'image'
        ? getThumbUrl(entry.filename, entry.subfolder, entry.type, THUMB_OPTIONS)
        : null,
    };
  });
};

const MediaPreview = ({ item }) => {
  if (!item) return null;
  if (item.mediaType === 'video') {
    return <LazyMedia type="video" src={item.fullUrl} className="w-full h-full object-cover" rootMargin="300px" />;
  }
  if (item.mediaType === 'audio') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-base-300/50 text-gray-300 text-xs px-2 text-center">
        Audio file
      </div>
    );
  }
  if (item.mediaType === 'gif') {
    return (
      <LazyMedia
        type="image"
        src={item.fullUrl}
        fallbackSrc={item.fullUrl}
        alt={item.filename}
        className="w-full h-full object-cover"
        rootMargin="300px"
      />
    );
  }
  return (
    <LazyMedia
      type="image"
      src={item.thumbUrl || item.fullUrl}
      fallbackSrc={item.fullUrl}
      alt={item.filename}
      className="w-full h-full object-cover"
      rootMargin="300px"
    />
  );
};

const Gallery = () => {
  const navigate = useNavigate();
  const [historyItems, setHistoryItems] = useState([]);
  const [historyOutputs, setHistoryOutputs] = useState({});
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingOutputs, setLoadingOutputs] = useState(false);
  const [outputProgress, setOutputProgress] = useState({ loaded: 0, total: 0 });
  const [errorText, setErrorText] = useState('');
  const [projectFilter, setProjectFilter] = useState(PROJECT_FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState(TYPE_FILTER_ALL);
  const [sortOrder, setSortOrder] = useState(SORT_DATE_DESC);
  const [searchText, setSearchText] = useState('');
  const [finalOnly, setFinalOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [savedProjectNames] = useState(() => readSavedProjectNames());

  useEffect(() => {
    let cancelled = false;
    const loadHistoryList = async () => {
      setLoadingRuns(true);
      setErrorText('');
      try {
        const data = await getCozyHistoryList();
        if (cancelled) return;
        setHistoryItems(Array.isArray(data?.items) ? data.items : []);
      } catch (error) {
        if (cancelled) return;
        console.warn('CozyGen: failed to load history for gallery', error);
        setHistoryItems([]);
        setErrorText('Failed to load runs.');
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    };
    loadHistoryList();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (historyItems.length === 0) {
      setHistoryOutputs({});
      setLoadingOutputs(false);
      setOutputProgress({ loaded: 0, total: 0 });
      return;
    }

    let cancelled = false;
    const loadRunOutputs = async () => {
      setHistoryOutputs({});
      setLoadingOutputs(true);
      setOutputProgress({ loaded: 0, total: historyItems.length });

      const chunkSize = 8;
      for (let offset = 0; offset < historyItems.length; offset += chunkSize) {
        if (cancelled) return;
        const chunk = historyItems.slice(offset, offset + chunkSize);
        const results = await Promise.all(
          chunk.map(async (item) => {
            const runId = String(item?.id || '');
            if (!runId) return [runId, null];
            try {
              const data = await getHistory(runId);
              const entry = data?.[runId] || data?.history?.[runId] || null;
              return [runId, entry];
            } catch {
              return [runId, null];
            }
          })
        );
        if (cancelled) return;

        const nextEntries = {};
        results.forEach(([runId, entry]) => {
          if (runId && entry) {
            nextEntries[runId] = entry;
          }
        });
        if (Object.keys(nextEntries).length > 0) {
          setHistoryOutputs((prev) => ({ ...prev, ...nextEntries }));
        }
        setOutputProgress((prev) => ({
          ...prev,
          loaded: Math.min(historyItems.length, offset + chunk.length),
        }));
      }

      if (!cancelled) setLoadingOutputs(false);
    };

    loadRunOutputs();
    return () => { cancelled = true; };
  }, [historyItems]);

  const mediaItems = useMemo(() => {
    return historyItems.flatMap((run) => {
      const runId = String(run?.id || '');
      if (!runId) return [];
      const runTimestampMs = parseTimestampMs(run);
      const workflowName = getHistoryWorkflowName(run) || 'Unknown workflow';
      const runtimeText = formatRuntime(run);
      const projectMeta = projectMetaForRun(run, savedProjectNames);
      const runMedia = buildMediaForRun(run, historyOutputs[runId]);
      return runMedia.map((media) => ({
        id: `${runId}::${media.key}`,
        runId,
        runTimestampMs,
        timestampLabel: formatTimestamp(runTimestampMs),
        workflowName,
        runtimeText,
        favorite: isFavoriteRun(run),
        projectId: projectMeta.projectId,
        projectName: projectMeta.projectName,
        projectLabel: projectMeta.projectLabel,
        projectFilterKey: projectMeta.projectFilterKey,
        mediaType: media.mediaType,
        sequenceIndex: media.sequenceIndex,
        isFinalForType: media.isFinalForType,
        filename: media.filename,
        subfolder: media.subfolder,
        fullUrl: media.fullUrl,
        thumbUrl: media.thumbUrl,
        run,
      }));
    });
  }, [historyItems, historyOutputs, savedProjectNames]);

  const projectFilterOptions = useMemo(() => {
    const optionsByKey = new Map();
    mediaItems.forEach((item) => {
      if (!item.projectFilterKey) return;
      if (optionsByKey.has(item.projectFilterKey)) return;
      optionsByKey.set(item.projectFilterKey, {
        value: item.projectFilterKey,
        label: item.projectLabel,
      });
    });
    const sorted = [...optionsByKey.values()].sort((a, b) => a.label.localeCompare(b.label));
    return [
      { value: PROJECT_FILTER_ALL, label: 'Project: All' },
      ...sorted,
      { value: PROJECT_FILTER_UNASSIGNED, label: 'Project: Unassigned' },
    ];
  }, [mediaItems]);

  const visibleItems = useMemo(() => {
    const needle = searchText.trim().toLowerCase();

    const filtered = mediaItems.filter((item) => {
      if (projectFilter === PROJECT_FILTER_UNASSIGNED && item.projectFilterKey) return false;
      if (projectFilter !== PROJECT_FILTER_ALL && projectFilter !== PROJECT_FILTER_UNASSIGNED) {
        if (item.projectFilterKey !== projectFilter) return false;
      }
      if (typeFilter !== TYPE_FILTER_ALL && item.mediaType !== typeFilter) return false;
      if (finalOnly && !item.isFinalForType) return false;
      if (favoritesOnly && !item.favorite) return false;

      if (!needle) return true;
      const haystack = `${item.filename} ${item.projectLabel} ${item.workflowName} ${item.runId}`.toLowerCase();
      return haystack.includes(needle);
    });

    filtered.sort((a, b) => {
      const tsDiff = a.runTimestampMs - b.runTimestampMs;
      if (tsDiff !== 0) {
        return sortOrder === SORT_DATE_DESC ? -tsDiff : tsDiff;
      }
      if (a.runId === b.runId) {
        return sortOrder === SORT_DATE_DESC
          ? b.sequenceIndex - a.sequenceIndex
          : a.sequenceIndex - b.sequenceIndex;
      }
      return a.runId.localeCompare(b.runId);
    });

    return filtered;
  }, [favoritesOnly, finalOnly, mediaItems, projectFilter, searchText, sortOrder, typeFilter]);

  const visibleRunCount = useMemo(
    () => new Set(visibleItems.map((item) => item.runId)).size,
    [visibleItems]
  );

  const handleLoadRun = (item) => {
    if (!item?.run?.json) {
      window.alert('This run does not include a saved workflow payload.');
      return;
    }
    try {
      localStorage.setItem(HISTORY_SELECTION_KEY, JSON.stringify(item.run));
    } catch {
      window.alert('Failed to prepare run settings for Generate.');
      return;
    }

    if (item.projectId) {
      setActiveProjectContext({
        projectId: item.projectId,
        projectName: item.projectName,
      });
    }
    navigate('/generate');
  };

  const openRunDetails = (item) => {
    navigate(`/history/${encodeURIComponent(item.runId)}`, {
      state: { historyItem: item.run },
    });
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="bg-base-200 shadow-lg rounded-lg p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Gallery</h2>
          <span className="text-xs text-gray-400 ml-auto">
            {visibleItems.length} media items across {visibleRunCount} runs
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            id="gallery-project-filter"
            className="w-56 sm:w-72"
            buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
            value={projectFilter}
            onChange={setProjectFilter}
            options={projectFilterOptions}
            listMaxHeightClassName="max-h-56"
          />
          <SearchableSelect
            id="gallery-type-filter"
            className="w-44 sm:w-52"
            buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_FILTER_OPTIONS}
            listMaxHeightClassName="max-h-56"
          />
          <SearchableSelect
            id="gallery-sort-order"
            className="w-56 sm:w-64"
            buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
            value={sortOrder}
            onChange={setSortOrder}
            options={SORT_OPTIONS}
            listMaxHeightClassName="max-h-40"
          />
          <input
            type="text"
            className="input input-bordered input-sm w-full sm:w-72"
            placeholder="Search filename, project, workflow, run id..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <button
            type="button"
            className={`btn btn-xs ${finalOnly ? 'btn-accent' : 'btn-outline'}`}
            onClick={() => setFinalOnly((prev) => !prev)}
          >
            Final Only
          </button>
          <button
            type="button"
            className={`btn btn-xs ${favoritesOnly ? 'btn-accent' : 'btn-outline'}`}
            onClick={() => setFavoritesOnly((prev) => !prev)}
          >
            Favorites Only
          </button>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => {
              setProjectFilter(PROJECT_FILTER_ALL);
              setTypeFilter(TYPE_FILTER_ALL);
              setSortOrder(SORT_DATE_DESC);
              setSearchText('');
              setFinalOnly(false);
              setFavoritesOnly(false);
            }}
          >
            Reset
          </button>
        </div>

        {(loadingRuns || loadingOutputs) && (
          <p className="text-xs text-gray-400">
            {loadingRuns
              ? 'Loading runs...'
              : `Loading run outputs ${outputProgress.loaded}/${outputProgress.total}...`}
          </p>
        )}
      </div>

      {errorText && (
        <div className="bg-base-200 shadow-lg rounded-lg p-4 text-red-300">{errorText}</div>
      )}

      {!loadingRuns && mediaItems.length === 0 && (
        <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
          No generated output found yet.
        </div>
      )}

      {!loadingRuns && mediaItems.length > 0 && visibleItems.length === 0 && (
        <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">
          No media matches the current filters.
        </div>
      )}

      {visibleItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visibleItems.map((item) => (
            <div key={item.id} className="bg-base-200 rounded-lg shadow-lg overflow-hidden border border-base-300/60">
              <button
                type="button"
                className="relative w-full aspect-square bg-base-300"
                onClick={() => setSelectedMedia(item)}
              >
                <MediaPreview item={item} />
                <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white uppercase">
                  {item.mediaType}
                </span>
                {item.isFinalForType && (
                  <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/90 text-white">
                    Final
                  </span>
                )}
              </button>
              <div className="p-2 space-y-1">
                <p className="text-xs text-white truncate" title={item.filename}>{item.filename}</p>
                <p className="text-[11px] text-gray-400 truncate" title={item.projectLabel}>
                  {item.projectLabel} • Run {item.runId}
                </p>
                <p className="text-[11px] text-gray-500 truncate" title={`${item.timestampLabel} • ${item.runtimeText}`}>
                  {item.timestampLabel} • {item.runtimeText}
                </p>
                <div className="flex items-center gap-1 pt-1">
                  <button
                    type="button"
                    className="btn btn-xs btn-accent flex-1"
                    onClick={() => handleLoadRun(item)}
                  >
                    Load Run
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => openRunDetails(item)}
                  >
                    Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedMedia && (
        <div
          className="fixed inset-0 z-[1000] bg-black/80 p-3 sm:p-6 flex items-center justify-center"
          onClick={() => setSelectedMedia(null)}
        >
          <div
            className="bg-base-200 rounded-lg shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-3 border-b border-base-300 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-semibold truncate" title={selectedMedia.filename}>
                  {selectedMedia.filename}
                </p>
                <p className="text-xs text-gray-400">
                  {selectedMedia.projectLabel} • Run {selectedMedia.runId} • {selectedMedia.timestampLabel}
                </p>
              </div>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setSelectedMedia(null)}>
                Close
              </button>
            </div>
            <div className="p-3 overflow-auto flex-1 flex items-center justify-center bg-base-300/40">
              {selectedMedia.mediaType === 'video' && (
                <video src={selectedMedia.fullUrl} controls autoPlay className="max-h-[72vh] max-w-full object-contain rounded-md" />
              )}
              {selectedMedia.mediaType === 'audio' && (
                <div className="w-full max-w-xl space-y-3">
                  <p className="text-sm text-gray-300">Audio preview</p>
                  <audio src={selectedMedia.fullUrl} controls className="w-full" />
                </div>
              )}
              {selectedMedia.mediaType !== 'video' && selectedMedia.mediaType !== 'audio' && (
                <img src={selectedMedia.fullUrl} alt={selectedMedia.filename} className="max-h-[72vh] max-w-full object-contain rounded-md" />
              )}
            </div>
            <div className="p-3 border-t border-base-300 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm btn-accent"
                onClick={() => handleLoadRun(selectedMedia)}
              >
                Load Run
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => openRunDetails(selectedMedia)}
              >
                Run Details
              </button>
              <a
                href={selectedMedia.fullUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-outline"
              >
                Open File
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Gallery;
