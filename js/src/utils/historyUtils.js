const VIDEO_EXT_RE = /\.(mp4|webm)(?:$|[?#])/i;
const GIF_EXT_RE = /\.(gif)(?:$|[?#])/i;

export const isVideoUrl = (value) => VIDEO_EXT_RE.test(String(value || ''));

export const isGifUrl = (value) => GIF_EXT_RE.test(String(value || ''));

export const getHistoryWorkflowName = (historyItem) => {
  const raw =
    historyItem?.fields?.selectedWorkflow ??
    historyItem?.workflow ??
    historyItem?.fields?.workflow ??
    '';
  return String(raw || '').trim();
};

const normalizeMediaEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return {
      filename: entry,
      subfolder: '',
      type: 'output',
    };
  }
  if (!entry.filename) return null;
  return {
    filename: entry.filename,
    subfolder: entry.subfolder || '',
    type: entry.type || 'output',
  };
};

export const extractHistoryMedia = (historyEntry) => {
  const outputs = historyEntry?.outputs || {};
  const mediaItems = [];
  const seen = new Set();

  Object.values(outputs).forEach((output) => {
    const buckets = [output?.images, output?.gifs, output?.videos];
    buckets.forEach((bucket) => {
      if (!Array.isArray(bucket)) return;
      bucket.forEach((entry) => {
        const normalized = normalizeMediaEntry(entry);
        if (normalized) {
          if (String(normalized.type || 'output') === 'temp') return;
          const key = `${normalized.type || 'output'}::${normalized.subfolder || ''}::${normalized.filename || ''}`;
          if (seen.has(key)) return;
          seen.add(key);
          mediaItems.push(normalized);
        }
      });
    });
  });

  return mediaItems;
};

const pickLastImageAndVideo = (items, getValue, isVideoPredicate = isVideoUrl) => {
  let lastImage = null;
  let lastVideo = null;

  items.forEach((item, index) => {
    const value = getValue(item);
    if (!value) return;
    if (isVideoPredicate(value)) {
      lastVideo = { item, index };
      return;
    }
    lastImage = { item, index };
  });

  return [lastImage, lastVideo]
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item);
};

export const selectFinalPreviewUrls = (previewUrls) =>
  pickLastImageAndVideo(
    Array.isArray(previewUrls) ? previewUrls : [],
    (url) => url
  );

export const selectFinalMediaItems = (mediaItems) =>
  pickLastImageAndVideo(
    Array.isArray(mediaItems) ? mediaItems : [],
    (media) => media?.filename
  );

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const stableSerialize = (value) => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

export const formatHistoryValueForDisplay = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
};

const getTruthyStateEntries = (state) => {
  if (!state || typeof state !== 'object') return [];
  return Object.entries(state)
    .filter(([, value]) => Boolean(value))
    .sort(([a], [b]) => a.localeCompare(b));
};

export const buildHistoryOverrideGroups = (historyItem) => {
  const fields = historyItem?.fields && typeof historyItem.fields === 'object' ? historyItem.fields : {};
  const workflowName = getHistoryWorkflowName(historyItem);
  const formData = fields.formData && typeof fields.formData === 'object' ? fields.formData : {};

  return {
    workflowName,
    formDataEntries: Object.entries(formData).sort(([a], [b]) => a.localeCompare(b)),
    randomizeEntries: getTruthyStateEntries(fields.randomizeState),
    bypassedEntries: getTruthyStateEntries(fields.bypassedState),
  };
};

export const buildHistoryComparableMap = (historyItem) => {
  const groups = buildHistoryOverrideGroups(historyItem);
  const comparable = {};

  if (groups.workflowName) {
    comparable.selectedWorkflow = groups.workflowName;
  }

  groups.formDataEntries.forEach(([key, value]) => {
    comparable[`formData.${key}`] = value;
  });
  groups.randomizeEntries.forEach(([key, value]) => {
    comparable[`randomizeState.${key}`] = value;
  });
  groups.bypassedEntries.forEach(([key, value]) => {
    comparable[`bypassedState.${key}`] = value;
  });

  return comparable;
};

export const diffComparableHistoryItems = (leftItem, rightItem) => {
  const leftMap = buildHistoryComparableMap(leftItem);
  const rightMap = buildHistoryComparableMap(rightItem);
  const keys = [...new Set([...Object.keys(leftMap), ...Object.keys(rightMap)])]
    .sort((a, b) => a.localeCompare(b));

  return keys
    .filter((key) => stableSerialize(leftMap[key]) !== stableSerialize(rightMap[key]))
    .map((key) => ({
      key,
      leftValue: leftMap[key],
      rightValue: rightMap[key],
    }));
};
