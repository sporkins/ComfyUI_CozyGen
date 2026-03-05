export const ACTIVE_PROJECT_CONTEXT_KEY = 'cozygenActiveProjectContextV1';
export const PROJECTS_STATE_KEY = 'cozygenProjectsStateV1';
export const PROJECT_VIEW_PRESETS_KEY = 'cozygenProjectViewPresetsV1';
export const PROJECT_WORKFLOW_DEFAULTS_KEY = 'cozygenProjectWorkflowDefaultsV1';

export const createProjectId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `project-${crypto.randomUUID()}`;
  }
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createProject = (name = 'New Project') => ({
  id: createProjectId(),
  name: String(name || 'New Project').trim() || 'New Project',
  pinned: false,
  tags: [],
  defaultWorkflow: '',
  workflowPresetDefaults: {},
  created_at: new Date().toISOString(),
});

export const readJsonStorage = (key, fallbackValue) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    const parsed = JSON.parse(raw);
    return parsed ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
};

export const writeJsonStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures to keep UI usable in restricted environments.
  }
};

export const getActiveProjectContext = () => (
  readJsonStorage(ACTIVE_PROJECT_CONTEXT_KEY, null)
);

export const setActiveProjectContext = (context) => {
  if (!context || typeof context !== 'object') return;
  const rawPresetDefaults = context.workflowPresetDefaults && typeof context.workflowPresetDefaults === 'object'
    ? context.workflowPresetDefaults
    : {};
  const workflowPresetDefaults = Object.fromEntries(
    Object.entries(rawPresetDefaults)
      .map(([workflowName, presetName]) => [String(workflowName || '').trim(), String(presetName || '').trim()])
      .filter(([workflowName, presetName]) => Boolean(workflowName && presetName))
  );
  const payload = {
    projectId: String(context.projectId || '').trim(),
    projectName: String(context.projectName || '').trim(),
    defaultWorkflow: String(context.defaultWorkflow || '').trim(),
    workflowPresetDefaults,
  };
  if (!payload.projectId) return;
  writeJsonStorage(ACTIVE_PROJECT_CONTEXT_KEY, payload);
};

export const readProjectWorkflowDefaults = () => (
  readJsonStorage(PROJECT_WORKFLOW_DEFAULTS_KEY, {})
);

export const writeProjectWorkflowDefaults = (value) => {
  writeJsonStorage(PROJECT_WORKFLOW_DEFAULTS_KEY, value && typeof value === 'object' ? value : {});
};

export const getProjectWorkflowDefaults = (projectId, workflowName) => {
  const pid = String(projectId || '').trim();
  const workflow = String(workflowName || '').trim();
  if (!pid || !workflow) return null;
  const allDefaults = readProjectWorkflowDefaults();
  const projectDefaults = allDefaults?.[pid];
  if (!projectDefaults || typeof projectDefaults !== 'object') return null;
  const workflowDefaults = projectDefaults?.[workflow];
  return workflowDefaults && typeof workflowDefaults === 'object' ? workflowDefaults : null;
};

export const upsertProjectWorkflowDefaults = (projectId, workflowName, payload) => {
  const pid = String(projectId || '').trim();
  const workflow = String(workflowName || '').trim();
  if (!pid || !workflow || !payload || typeof payload !== 'object') return;
  const allDefaults = readProjectWorkflowDefaults();
  const projectDefaults = allDefaults?.[pid] && typeof allDefaults[pid] === 'object'
    ? allDefaults[pid]
    : {};
  const existing = projectDefaults?.[workflow] && typeof projectDefaults[workflow] === 'object'
    ? projectDefaults[workflow]
    : {};
  writeProjectWorkflowDefaults({
    ...allDefaults,
    [pid]: {
      ...projectDefaults,
      [workflow]: {
        ...existing,
        ...payload,
      },
    },
  });
};
