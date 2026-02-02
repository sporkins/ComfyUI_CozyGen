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

export const getViewUrl = (filename, subfolder = '', type = 'output') => {
  const baseUrl = window.location.protocol + '//' + window.location.host;
  const params = new URLSearchParams({
    filename,
    subfolder,
    type,
  });
  return `${baseUrl}/view?${params.toString()}`;
};

export const getObjectInfo = async () => {
  const response = await fetch(window.location.protocol + '//' + window.location.host + '/object_info');
  if (!response.ok) {
    throw new Error('Failed to fetch object info');
  }
  return response.json();
};

export const getGallery = async (subfolder = '', page = 1, pageSize = 20) => {
    const response = await fetch(`/cozygen/gallery?subfolder=${encodeURIComponent(subfolder)}&page=${page}&per_page=${pageSize}`);
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
