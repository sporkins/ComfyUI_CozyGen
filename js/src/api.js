const BASE_URL = '/cozygen';

export const getWorkflows = async () => {
  const response = await fetch(`${BASE_URL}/workflows`);
  if (!response.ok) {
    throw new Error('Failed to fetch workflows');
  }
  return response.json();
};

export const getWorkflow = async (filename) => {
  const response = await fetch(`${BASE_URL}/workflows/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch workflow: ${filename}`);
  }
  return response.json();
};

export const queuePrompt = async (prompt) => {
    const response = await fetch(window.location.protocol + '//' + window.location.host + '/prompt', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(prompt)
    });
    if (!response.ok) {
        throw new Error('Failed to queue prompt');
    }
    return response.json();
};

export const getQueue = async () => {
  const response = await fetch(window.location.protocol + '//' + window.location.host + '/queue');
  if (!response.ok) {
    throw new Error('Failed to fetch queue');
  }
  return response.json();
};

export const deleteQueueItem = async (promptId) => {
  const response = await fetch(window.location.protocol + '//' + window.location.host + '/queue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ delete: [promptId] }),
  });
  if (!response.ok) {
    throw new Error('Failed to delete queue item');
  }
  return response.json();
};

export const interruptQueue = async () => {
  const response = await fetch(window.location.protocol + '//' + window.location.host + '/interrupt', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to interrupt execution');
  }
  return response.json();
};

export const getHistory = async (promptId) => {
  const response = await fetch(window.location.protocol + '//' + window.location.host + `/history/${promptId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch history for prompt: ${promptId}`);
  }
  return response.json();
};

export const getCozyHistoryList = async () => {
  const response = await fetch(`${BASE_URL}/history`);
  if (!response.ok) {
    throw new Error('Failed to fetch CozyGen history list');
  }
  return response.json();
};

export const getCozyHistoryItem = async (historyId) => {
  const response = await fetch(`${BASE_URL}/history/${historyId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch CozyGen history item: ${historyId}`);
  }
  return response.json();
};

export const saveCozyHistoryItem = async (payload) => {
  const response = await fetch(`${BASE_URL}/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to save CozyGen history item');
  }
  return response.json();
};

export const updateCozyHistoryItem = async (historyId, payload) => {
  const response = await fetch(`${BASE_URL}/history/${historyId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to update CozyGen history item');
  }
  return response.json();
};

export const getCozySession = async () => {
  const response = await fetch(`${BASE_URL}/session`);
  if (!response.ok) {
    throw new Error('Failed to fetch CozyGen session');
  }
  return response.json();
};

export const saveCozySession = async (payload) => {
  const response = await fetch(`${BASE_URL}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to save CozyGen session');
  }
  return response.json();
};

export const getCozyPresets = async () => {
  const response = await fetch(`${BASE_URL}/presets`);
  if (!response.ok) {
    throw new Error('Failed to fetch CozyGen presets');
  }
  return response.json();
};

export const getCozyLogs = async (options = {}) => {
  const params = new URLSearchParams();
  if (options.afterId !== undefined && options.afterId !== null && options.afterId !== '') {
    params.set('after_id', String(options.afterId));
  }
  if (options.limit !== undefined && options.limit !== null && options.limit !== '') {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  const response = await fetch(`${BASE_URL}/logs${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error('Failed to fetch CozyGen logs');
  }
  return response.json();
};

export const getCozyLogsConfig = async () => {
  const response = await fetch(`${BASE_URL}/logs/config`);
  if (!response.ok) {
    throw new Error('Failed to fetch CozyGen logs config');
  }
  return response.json();
};

export const saveCozyLogsConfig = async (payload) => {
  const response = await fetch(`${BASE_URL}/logs/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to save CozyGen logs config');
  }
  return response.json();
};

export const clearCozyLogs = async () => {
  const response = await fetch(`${BASE_URL}/logs/clear`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to clear CozyGen logs');
  }
  return response.json();
};

export const saveCozyPresets = async (items) => {
  const response = await fetch(`${BASE_URL}/presets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    throw new Error('Failed to save CozyGen presets');
  }
  return response.json();
};

export const getViewUrl = (filename, subfolder = '', type = 'output', options = {}) => {
  const baseUrl = window.location.protocol + '//' + window.location.host;
  const params = new URLSearchParams({
    filename,
    subfolder,
    type,
  });
  if (options && typeof options === 'object') {
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
  }
  return `${baseUrl}/view?${params.toString()}`;
};

export const getCozyMediaUrl = (filename, subfolder = '', type = 'output', options = {}) => {
  const baseUrl = window.location.protocol + '//' + window.location.host;
  const params = new URLSearchParams({
    filename,
    subfolder,
    type,
  });
  if (options && typeof options === 'object') {
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
  }
  return `${baseUrl}/cozygen/media?${params.toString()}`;
};

export const getThumbUrl = (filename, subfolder = '', type = 'output', options = {}) => {
  const baseUrl = window.location.protocol + '//' + window.location.host;
  const params = new URLSearchParams({
    filename,
    subfolder,
    type,
  });
  if (options && typeof options === 'object') {
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
  }
  return `${baseUrl}/cozygen/thumb?${params.toString()}`;
};

export const parseMediaRefFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url, window.location.protocol + '//' + window.location.host);
    const pathname = parsed.pathname || '';
    const supportedPath = pathname === '/view'
      || pathname === '/cozygen/media'
      || pathname === '/cozygen/thumb';
    if (!supportedPath) return null;

    const filename = parsed.searchParams.get('filename') || '';
    if (!filename) return null;
    return {
      filename,
      subfolder: parsed.searchParams.get('subfolder') || '',
      type: parsed.searchParams.get('type') || 'output',
    };
  } catch {
    return null;
  }
};

export const getCozyMediaUrlFromPreviewUrl = (url) => {
  const mediaRef = parseMediaRefFromUrl(url);
  if (!mediaRef) return url;
  return getCozyMediaUrl(mediaRef.filename, mediaRef.subfolder, mediaRef.type);
};

export const getObjectInfo = async () => {
  const response = await fetch(window.location.protocol + '//' + window.location.host + '/object_info');
  if (!response.ok) {
    throw new Error('Failed to fetch object info');
  }
  return response.json();
};

export const getGallery = async (subfolder = '', page = 1, pageSize = 20, options = {}) => {
    const params = new URLSearchParams({
      subfolder,
      page: String(page),
      per_page: String(pageSize),
    });
    if (options?.fileType) {
      params.set('file_type', String(options.fileType));
    }
    if (options?.sort) {
      params.set('sort', String(options.sort));
    }
    const response = await fetch(`/cozygen/gallery?${params.toString()}`);
    if (!response.ok) {
        throw new Error('Failed to fetch gallery items');
    }
    return response.json();
};

export const getChoices = async (type) => {
  const response = await fetch(`${BASE_URL}/get_choices?type=${encodeURIComponent(type)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch choices for type: ${type}`);
  }
  return response.json();
};

export const uploadImage = async (imageFile) => {
  const formData = new FormData();
  formData.append('image', imageFile);

  const response = await fetch(`${BASE_URL}/upload_image`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to upload image');
  }
  return response.json();
};
