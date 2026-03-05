import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCozyPresets,
  getCozyProjects,
  getCozyHistoryList,
  getCozyMediaUrl,
  getCozySession,
  getHistory,
  getQueue,
  saveCozyProject,
  deleteCozyProject,
  updateCozyHistoryItem,
  getWorkflows,
  getThumbUrl,
  parseMediaRefFromUrl,
} from '../api';
import LazyMedia from '../components/LazyMedia';
import MediaComparePanel from '../components/MediaComparePanel';
import SearchableSelect from '../components/SearchableSelect';
import {
  diffComparableHistoryItems,
  extractHistoryMedia,
  formatHistoryValueForDisplay,
  getHistoryWorkflowName,
  isGifUrl,
  isVideoUrl,
} from '../utils/historyUtils';
import {
  createProject,
  PROJECTS_STATE_KEY,
  PROJECT_VIEW_PRESETS_KEY,
  readJsonStorage,
  setActiveProjectContext,
  writeJsonStorage,
} from '../utils/projectUtils';

const MEDIA_FILTERS = ['both', 'image', 'video'];
const THUMB_OPTS = { w: 240, q: 55, fmt: 'webp' };
const DEFAULT_VIEW = { mediaFilter: 'both', finalOnly: false };
const DEFAULT_PROJECT_ID = 'project-1';
const DEFAULT_PROJECT_NAME = 'Project 1';
const HISTORY_SELECTION_KEY = 'historySelection';

const normalizeProject = (project) => ({
  id: String(project?.id || '').trim(),
  name: String(project?.name || '').trim() || 'Untitled Project',
  pinned: Boolean(project?.pinned),
  tags: Array.isArray(project?.tags) ? project.tags.map((t) => String(t || '').trim()).filter(Boolean) : [],
  defaultWorkflow: String(project?.defaultWorkflow || '').trim(),
  workflowPresetDefaults: project?.workflowPresetDefaults && typeof project.workflowPresetDefaults === 'object'
    ? Object.fromEntries(
      Object.entries(project.workflowPresetDefaults)
        .map(([workflowName, presetName]) => [String(workflowName || '').trim(), String(presetName || '').trim()])
        .filter(([workflowName, presetName]) => Boolean(workflowName && presetName))
    )
    : {},
  created_at: String(project?.created_at || '').trim() || new Date().toISOString(),
  updated_at: String(project?.updated_at || '').trim(),
});

const getPromptId = (item) => {
  if (!item) return null;
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  if (typeof item?.prompt_id === 'string' || typeof item?.prompt_id === 'number') return String(item.prompt_id);
  if (Array.isArray(item) && (typeof item[0] === 'string' || typeof item[0] === 'number')) return String(item[0]);
  if (Array.isArray(item) && item[1] && (typeof item[1].prompt_id === 'string' || typeof item[1].prompt_id === 'number')) return String(item[1].prompt_id);
  return null;
};

const isTemp = (url) => String(parseMediaRefFromUrl(url)?.type || '') === 'temp';
const projectIdFor = (run) => String(run?.project_id || run?.fields?.project_id || '').trim();
const projectNameFor = (run) => String(run?.project_name || run?.fields?.project_name || '').trim();
const isFavoriteRun = (run) => Boolean(run?.favorite || run?.fields?.favorite);
const fmtTime = (value) => (value ? new Date(value).toLocaleString() : 'Unknown time');
const fmtRuntime = (run) => {
  const direct = Number(run?.runtime_ms ?? run?.fields?.runtime_ms);
  if (Number.isFinite(direct) && direct > 0) return `${(direct / 1000).toFixed(1)}s`;
  const a = new Date(run?.started_at || run?.fields?.started_at || run?.timestamp || '').getTime();
  const b = new Date(run?.finished_at || run?.fields?.finished_at || '').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 'n/a';
  return `${((b - a) / 1000).toFixed(1)}s`;
};

const initialProjects = () => {
  const saved = readJsonStorage(PROJECTS_STATE_KEY, null);
  if (saved?.projects?.length) {
    const projects = saved.projects
      .map((p) => normalizeProject(p))
      .filter((p) => p.id);
    if (projects.length) {
      const ids = new Set(projects.map((p) => p.id));
      const open = (Array.isArray(saved.openProjectIds) ? saved.openProjectIds : [])
        .map((id) => String(id || ''))
        .filter((id) => ids.has(id));
      const openProjectIds = open.length ? open : [projects[0].id];
      const activeProjectId = ids.has(String(saved.activeProjectId || ''))
        ? String(saved.activeProjectId)
        : openProjectIds[0];
      return { projects, openProjectIds, activeProjectId };
    }
  }
  const first = normalizeProject({ ...createProject(DEFAULT_PROJECT_NAME), id: DEFAULT_PROJECT_ID });
  return { projects: [first], openProjectIds: [first.id], activeProjectId: first.id };
};

const mediaForRun = (run, historyEntry) => {
  const seen = new Set();
  const out = [];
  const push = (m) => {
    if (!m?.filename) return;
    const key = `${m.type || 'output'}::${m.subfolder || ''}::${m.filename}`;
    if (seen.has(key)) return;
    seen.add(key);
    const video = isVideoUrl(m.filename);
    const gif = isGifUrl(m.filename);
    if (!video && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(m.filename)) return;
    const fullUrl = getCozyMediaUrl(m.filename, m.subfolder || '', m.type || 'output');
    out.push({
      key,
      filename: m.filename,
      subfolder: m.subfolder || '',
      mediaKind: video ? 'video' : 'image',
      fullUrl,
      thumbUrl: !video && !gif ? getThumbUrl(m.filename, m.subfolder || '', m.type || 'output', THUMB_OPTS) : null,
    });
  };
  const previews = (Array.isArray(run?.preview_images) ? run.preview_images : []).filter((url) => !isTemp(url));
  previews.forEach((url) => push(parseMediaRefFromUrl(url)));
  extractHistoryMedia(historyEntry).forEach((m) => push(m));
  return out;
};

const ProjectsPage = () => {
  const navigate = useNavigate();
  const init = useMemo(() => initialProjects(), []);
  const [projects, setProjects] = useState(init.projects);
  const [openProjectIds, setOpenProjectIds] = useState(init.openProjectIds);
  const [activeProjectId, setActiveProjectId] = useState(init.activeProjectId);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [views, setViews] = useState(() => readJsonStorage(PROJECT_VIEW_PRESETS_KEY, {}));
  const [historyItems, setHistoryItems] = useState([]);
  const [historyOutputs, setHistoryOutputs] = useState({});
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [workflows, setWorkflows] = useState([]);
  const [presetsByWorkflow, setPresetsByWorkflow] = useState({});
  const [presetWorkflowEditor, setPresetWorkflowEditor] = useState('');
  const [presetNameEditor, setPresetNameEditor] = useState('');
  const [visibleRunCount, setVisibleRunCount] = useState(40);
  const [compareMedia, setCompareMedia] = useState([]);
  const [compareRuns, setCompareRuns] = useState([]);
  const [globalRun, setGlobalRun] = useState({ isActive: false, promptId: '', projectId: '', projectName: '' });
  const prevGlobalActiveRef = useRef(false);

  const projectsById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const activeProject = projectsById[activeProjectId] || projects[0] || null;
  const view = views[activeProjectId] || DEFAULT_VIEW;
  const mediaFilter = MEDIA_FILTERS.includes(view.mediaFilter) ? view.mediaFilter : 'both';
  const finalOnly = Boolean(view.finalOnly);

  useEffect(() => {
    writeJsonStorage(PROJECTS_STATE_KEY, { projects, openProjectIds, activeProjectId });
  }, [projects, openProjectIds, activeProjectId]);
  useEffect(() => {
    let dead = false;
    const loadProjects = async () => {
      try {
        const data = await getCozyProjects();
        if (dead) return;
        const remote = (Array.isArray(data?.items) ? data.items : [])
          .map((item) => normalizeProject(item))
          .filter((item) => item.id);
        if (remote.length > 0) {
          const ids = new Set(remote.map((p) => p.id));
          setProjects(remote);
          setOpenProjectIds((prev) => {
            const next = (Array.isArray(prev) ? prev : [])
              .map((id) => String(id || '').trim())
              .filter((id) => ids.has(id));
            return next.length ? next : [remote[0].id];
          });
          setActiveProjectId((prev) => (ids.has(String(prev || '').trim()) ? String(prev).trim() : remote[0].id));
        }
      } catch (error) {
        if (!dead) {
          console.warn('CozyGen: failed to load projects from backend; using local fallback.', error);
        }
      } finally {
        if (!dead) setProjectsLoaded(true);
      }
    };
    loadProjects();
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    if (!projectsLoaded) return;
    let dead = false;
    const syncProjects = async () => {
      await Promise.all(projects.map(async (project) => {
        try {
          await saveCozyProject(project);
        } catch (error) {
          if (!dead) {
            console.warn(`CozyGen: failed to persist project ${project?.id || ''}`, error);
          }
        }
      }));
    };
    syncProjects();
    return () => { dead = true; };
  }, [projects, projectsLoaded]);
  useEffect(() => writeJsonStorage(PROJECT_VIEW_PRESETS_KEY, views), [views]);
  useEffect(() => {
    if (!activeProject) return;
    setActiveProjectContext({
      projectId: activeProject.id,
      projectName: activeProject.name,
      defaultWorkflow: activeProject.defaultWorkflow,
      workflowPresetDefaults: activeProject.workflowPresetDefaults,
    });
  }, [activeProject]);

  useEffect(() => {
    let dead = false;
    const loadChoices = async () => {
      try {
        const [workflowData, presetData] = await Promise.all([
          getWorkflows(),
          getCozyPresets(),
        ]);
        if (dead) return;
        setWorkflows(Array.isArray(workflowData?.workflows) ? workflowData.workflows : []);
        setPresetsByWorkflow(presetData?.items && typeof presetData.items === 'object' ? presetData.items : {});
      } catch {
        if (dead) return;
        setWorkflows([]);
        setPresetsByWorkflow({});
      }
    };
    loadChoices();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const defaultWorkflow = String(activeProject?.defaultWorkflow || '').trim();
    const firstWorkflow = workflows[0] || '';
    const chosenWorkflow = defaultWorkflow || firstWorkflow;
    setPresetWorkflowEditor(chosenWorkflow);
  }, [activeProject, workflows]);

  useEffect(() => {
    const wf = String(presetWorkflowEditor || '').trim();
    if (!wf || !activeProject) {
      setPresetNameEditor('');
      return;
    }
    const assigned = String(activeProject.workflowPresetDefaults?.[wf] || '').trim();
    setPresetNameEditor(assigned);
  }, [presetWorkflowEditor, activeProject]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await getCozyHistoryList();
      setHistoryItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const refreshGlobal = useCallback(async () => {
    let session = null;
    let queueData = null;
    try { session = await getCozySession(); } catch {}
    try { queueData = await getQueue(); } catch {}
    const promptId = String(session?.id || '');
    const qRun = Array.isArray(queueData?.queue_running) ? queueData.queue_running : [];
    const qPend = Array.isArray(queueData?.queue_pending) ? queueData.queue_pending : [];
    const allQ = Array.isArray(queueData) ? queueData : [...qRun, ...qPend];
    const activeIds = new Set(allQ.map((i) => getPromptId(i)).filter(Boolean));
    const isActive = Boolean(promptId) && (activeIds.has(promptId) || (session?.status && session.status !== 'finished'));
    const projectId = String(session?.project_id || '');
    setGlobalRun({ isActive, promptId, projectId, projectName: String(session?.project_name || projectsById[projectId]?.name || '') });
  }, [projectsById]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    refreshGlobal();
    const t = window.setInterval(refreshGlobal, 2500);
    return () => window.clearInterval(t);
  }, [refreshGlobal]);
  useEffect(() => {
    if (prevGlobalActiveRef.current && !globalRun.isActive) loadHistory();
    prevGlobalActiveRef.current = globalRun.isActive;
  }, [globalRun.isActive, loadHistory]);

  const runs = useMemo(() => (
    historyItems
      .filter((r) => {
        const runProjectId = projectIdFor(r);
        if (runProjectId && runProjectId === activeProjectId) {
          return true;
        }
        const activeName = String(activeProject?.name || '').trim().toLowerCase();
        const runName = projectNameFor(r).toLowerCase();
        return Boolean(activeName && runName && activeName === runName);
      })
      .sort((a, b) => new Date(b?.timestamp || '').getTime() - new Date(a?.timestamp || '').getTime())
  ), [historyItems, activeProjectId, activeProject]);
  const visibleRuns = runs.slice(0, visibleRunCount);

  useEffect(() => {
    setVisibleRunCount(40);
  }, [activeProjectId]);

  useEffect(() => {
    const needed = runs.filter((r) => !historyOutputs[r.id]);
    if (!needed.length) return;
    let dead = false;
    Promise.all(needed.map(async (run) => {
      try {
        const data = await getHistory(run.id);
        const entry = data?.[run.id] || data?.history?.[run.id] || null;
        return [run.id, entry];
      } catch {
        return [run.id, null];
      }
    })).then((pairs) => {
      if (dead) return;
      const next = {};
      pairs.forEach(([id, entry]) => { if (entry) next[id] = entry; });
      if (Object.keys(next).length) setHistoryOutputs((prev) => ({ ...prev, ...next }));
    });
    return () => { dead = true; };
  }, [runs, historyOutputs]);

  const runMap = useMemo(() => Object.fromEntries(runs.map((r) => [String(r.id), r])), [runs]);
  const runDiffs = useMemo(() => {
    if (compareRuns.length !== 2) return [];
    const left = runMap[String(compareRuns[0])];
    const right = runMap[String(compareRuns[1])];
    if (!left || !right) return [];
    return diffComparableHistoryItems(left, right);
  }, [compareRuns, runMap]);

  const isBlocked = globalRun.isActive;
  const compared = compareMedia.length === 2 ? compareMedia : [];
  const canCompareType = (kind) => (compareMedia.length === 0 || compareMedia[0].media.mediaKind === kind);
  const workflowOptions = workflows.map((name) => ({ value: name, label: name }));
  const presetOptionsForEditor = useMemo(() => {
    const wf = String(presetWorkflowEditor || '').trim();
    const entries = presetsByWorkflow?.[wf];
    if (!entries || typeof entries !== 'object') return [];
    return Object.keys(entries).sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  }, [presetWorkflowEditor, presetsByWorkflow]);

  const applyProjectPresetDefault = () => {
    if (!activeProject || !presetWorkflowEditor || !presetNameEditor) return;
    const workflowName = String(presetWorkflowEditor).trim();
    const presetName = String(presetNameEditor).trim();
    if (!workflowName || !presetName) return;
    setProjects((prev) => prev.map((project) => {
      if (project.id !== activeProject.id) return project;
      return {
        ...project,
        workflowPresetDefaults: {
          ...(project.workflowPresetDefaults || {}),
          [workflowName]: presetName,
        },
      };
    }));
  };

  const clearProjectPresetDefault = () => {
    if (!activeProject || !presetWorkflowEditor) return;
    const workflowName = String(presetWorkflowEditor).trim();
    if (!workflowName) return;
    setProjects((prev) => prev.map((project) => {
      if (project.id !== activeProject.id) return project;
      const next = { ...(project.workflowPresetDefaults || {}) };
      delete next[workflowName];
      return { ...project, workflowPresetDefaults: next };
    }));
    setPresetNameEditor('');
  };

  const deleteProject = async (project) => {
    const projectId = String(project?.id || '').trim();
    if (!projectId) return;
    const projectName = String(project?.name || projectId).trim();
    const confirmed = window.confirm(
      `Move "${projectName}" to deleted projects?\n\nTo restore it later, move its JSON file from '.cache/projects/deleted' back to '.cache/projects/active'.`
    );
    if (!confirmed) return;

    try {
      await deleteCozyProject(projectId);
    } catch (error) {
      console.warn(`CozyGen: failed to delete project ${projectId}`, error);
      window.alert('Failed to move project to deleted folder.');
      return;
    }

    setViews((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, projectId)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });

    const remaining = projects.filter((item) => String(item?.id || '') !== projectId);
    const ensured = remaining.length ? remaining : [normalizeProject(createProject(DEFAULT_PROJECT_NAME))];
    const ids = new Set(ensured.map((item) => item.id));
    setProjects(ensured);
    setOpenProjectIds((prevOpen) => {
      const filtered = (Array.isArray(prevOpen) ? prevOpen : [])
        .map((id) => String(id || '').trim())
        .filter((id) => ids.has(id));
      return filtered.length ? filtered : [ensured[0].id];
    });
    setActiveProjectId((prevActive) => {
      const active = String(prevActive || '').trim();
      return ids.has(active) ? active : ensured[0].id;
    });
  };

  const loadRunIntoGenerate = (run) => {
    if (!run || !activeProject) return;
    try {
      localStorage.setItem(HISTORY_SELECTION_KEY, JSON.stringify(run));
    } catch {}
    setActiveProjectContext({
      projectId: activeProject.id,
      projectName: activeProject.name,
      defaultWorkflow: activeProject.defaultWorkflow,
      workflowPresetDefaults: activeProject.workflowPresetDefaults,
    });
    navigate('/generate');
  };

  const toggleRunFavorite = async (run) => {
    const runId = String(run?.id || '');
    if (!runId) return;
    const nextFavorite = !isFavoriteRun(run);
    setHistoryItems((prev) => prev.map((item) => (
      String(item?.id || '') === runId ? { ...item, favorite: nextFavorite } : item
    )));
    try {
      await updateCozyHistoryItem(runId, { favorite: nextFavorite });
    } catch (error) {
      console.warn(`CozyGen: failed to update favorite for run ${runId}`, error);
      setHistoryItems((prev) => prev.map((item) => (
        String(item?.id || '') === runId ? { ...item, favorite: !nextFavorite } : item
      )));
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="bg-base-200 shadow-lg rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <h2 className="text-lg font-semibold text-white">Projects</h2>
          <button className="btn btn-sm btn-primary" onClick={() => {
            const name = window.prompt('New project name:', `Project ${projects.length + 1}`);
            if (name === null) return;
            const next = createProject(name || `Project ${projects.length + 1}`);
            setProjects((prev) => [...prev, next]);
            setOpenProjectIds((prev) => [...prev, next.id]);
            setActiveProjectId(next.id);
          }}>New</button>
          <span className="ml-auto text-sm">{globalRun.isActive ? `Running ${globalRun.projectName ? `in ${globalRun.projectName}` : ''}` : 'Idle'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {openProjectIds.map((id) => {
            const p = projectsById[id];
            if (!p) return null;
            return (
              <div key={id} className={`rounded-md border px-2 py-1 ${id === activeProjectId ? 'border-accent bg-accent/20' : 'border-base-300'}`}>
                <button className="text-sm" onClick={() => setActiveProjectId(id)}>{p.pinned ? '★ ' : ''}{p.name}</button>
              </div>
            );
          })}
        </div>
      </div>

      {activeProject && (
        <div className="bg-base-200 shadow-lg rounded-lg p-3 space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <h3 className="text-lg font-semibold text-white">{activeProject.name}</h3>
            <button className="btn btn-xs btn-outline" onClick={() => {
              const rawName = window.prompt('Rename project:', activeProject.name);
              if (rawName === null) return;
              const name = String(rawName || '').trim();
              if (!name || name === activeProject.name) return;
              setProjects((prev) => prev.map((p) => (p.id === activeProject.id ? { ...p, name } : p)));
              setActiveProjectContext({
                projectId: activeProject.id,
                projectName: name,
                defaultWorkflow: activeProject.defaultWorkflow,
                workflowPresetDefaults: activeProject.workflowPresetDefaults,
              });
              setGlobalRun((prev) => (
                String(prev.projectId || '') === String(activeProject.id || '')
                  ? { ...prev, projectName: name }
                  : prev
              ));
            }}>Rename</button>
            <button className="btn btn-xs btn-outline" onClick={() => setProjects((prev) => prev.map((p) => (
              p.id === activeProject.id ? { ...p, pinned: !p.pinned } : p
            )))}>{activeProject.pinned ? 'Unpin' : 'Pin'}</button>
            <button
              className="btn btn-xs btn-outline btn-error"
              disabled={globalRun.isActive && String(globalRun.projectId || '') === String(activeProject.id || '')}
              onClick={() => deleteProject(activeProject)}
              title={(globalRun.isActive && String(globalRun.projectId || '') === String(activeProject.id || ''))
                ? 'Cannot delete project while it has a running job.'
                : 'Move project to deleted folder'}
            >
              Delete
            </button>
            <button className="btn btn-sm btn-accent ml-auto" disabled={isBlocked} onClick={() => {
              setActiveProjectContext({
                projectId: activeProject.id,
                projectName: activeProject.name,
                defaultWorkflow: activeProject.defaultWorkflow,
                workflowPresetDefaults: activeProject.workflowPresetDefaults,
              });
              navigate('/generate');
            }}>Generate</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-gray-400">Project Default Workflow</label>
              <SearchableSelect
                id={`project-default-workflow-${activeProject.id}`}
                className="w-full"
                buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
                value={activeProject.defaultWorkflow || ''}
                onChange={(nextWorkflow) => setProjects((prev) => prev.map((project) => (
                  project.id === activeProject.id ? { ...project, defaultWorkflow: String(nextWorkflow || '') } : project
                )))}
                options={[{ value: '', label: '(None)' }, ...workflowOptions]}
                listMaxHeightClassName="max-h-56"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">Per-Workflow Preset Default</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <SearchableSelect
                  id={`project-preset-workflow-${activeProject.id}`}
                  className="w-full"
                  buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
                  value={presetWorkflowEditor}
                  onChange={setPresetWorkflowEditor}
                  options={workflowOptions}
                  placeholder="Workflow"
                  listMaxHeightClassName="max-h-56"
                />
                <SearchableSelect
                  id={`project-preset-name-${activeProject.id}`}
                  className="w-full"
                  buttonClassName="select select-bordered select-sm bg-base-100 w-full text-left"
                  value={presetNameEditor}
                  onChange={setPresetNameEditor}
                  options={presetOptionsForEditor}
                  placeholder="Preset"
                  disabled={!presetWorkflowEditor}
                  listMaxHeightClassName="max-h-56"
                />
                <button className="btn btn-xs btn-outline" onClick={applyProjectPresetDefault} disabled={!presetWorkflowEditor || !presetNameEditor}>
                  Set
                </button>
                <button className="btn btn-xs btn-outline" onClick={clearProjectPresetDefault} disabled={!presetWorkflowEditor}>
                  Clear
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {MEDIA_FILTERS.map((f) => (
              <button key={f} className={`btn btn-xs ${mediaFilter === f ? 'btn-accent' : 'btn-outline'}`} onClick={() => setViews((prev) => ({
                ...prev,
                [activeProjectId]: { ...(prev[activeProjectId] || DEFAULT_VIEW), mediaFilter: f },
              }))}>{f === 'both' ? 'Both' : f === 'image' ? 'Images' : 'Videos'}</button>
            ))}
            <button className={`btn btn-xs ${finalOnly ? 'btn-accent' : 'btn-outline'}`} onClick={() => setViews((prev) => ({
              ...prev,
              [activeProjectId]: { ...(prev[activeProjectId] || DEFAULT_VIEW), finalOnly: !finalOnly },
            }))}>Final Only</button>
            <span className="text-xs text-gray-400">Media Compare {compareMedia.length}/2</span>
            <button className="btn btn-xs btn-outline" onClick={() => setCompareMedia([])} disabled={!compareMedia.length}>Clear</button>
            <span className="text-xs text-gray-400">Run Diff {compareRuns.length}/2</span>
            <button className="btn btn-xs btn-outline" onClick={() => setCompareRuns([])} disabled={!compareRuns.length}>Clear</button>
          </div>
          <input
            className="input input-bordered input-sm w-full sm:max-w-xl"
            value={(activeProject.tags || []).join(', ')}
            onChange={(e) => setProjects((prev) => prev.map((p) => (
              p.id === activeProject.id ? { ...p, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } : p
            )))}
            placeholder="tags: mobile, product, cinematic"
          />
        </div>
      )}

      {compared.length === 2 && (
        <MediaComparePanel
          leftItem={{ filename: compared[0].media.filename, subfolder: compared[0].media.subfolder }}
          rightItem={{ filename: compared[1].media.filename, subfolder: compared[1].media.subfolder }}
        />
      )}

      {compareRuns.length === 2 && (
        <div className="bg-base-200 shadow-lg rounded-lg p-4 space-y-2">
          <h3 className="text-lg font-semibold text-white">Run Settings Diff</h3>
          {runDiffs.length === 0 ? <p className="text-sm text-gray-300">No differences.</p> : runDiffs.map((d) => (
            <div key={d.key} className="bg-base-300/40 rounded-md p-2">
              <p className="text-xs text-gray-400">{d.key}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <pre className="text-xs whitespace-pre-wrap break-all">{formatHistoryValueForDisplay(d.leftValue)}</pre>
                <pre className="text-xs whitespace-pre-wrap break-all">{formatHistoryValueForDisplay(d.rightValue)}</pre>
              </div>
            </div>
          ))}
        </div>
      )}

      {loadingHistory ? (
        <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">Loading runs...</div>
      ) : runs.length === 0 ? (
        <div className="bg-base-200 shadow-lg rounded-lg p-6 text-center text-gray-400">No runs yet in this project.</div>
      ) : (
        <>
        {visibleRuns.map((run) => {
          const favorite = isFavoriteRun(run);
          const rowMedia = mediaForRun(run, historyOutputs[run.id]);
          const filtered = rowMedia.filter((m) => mediaFilter === 'both' || mediaFilter === m.mediaKind);
          const newest = filtered.slice().reverse();
          const kindSeen = new Set();
          const shown = newest.filter((m) => {
            if (!finalOnly) return true;
            if (kindSeen.has(m.mediaKind)) return false;
            kindSeen.add(m.mediaKind);
            return true;
          });
          const finalSeen = new Set();
          return (
            <div key={run.id} className="bg-base-200 shadow-lg rounded-lg p-3 border border-base-300/60">
              <div className="flex flex-wrap gap-2 items-center mb-2">
                <button
                  className="btn btn-xs btn-accent"
                  onClick={() => loadRunIntoGenerate(run)}
                >
                  Load Run {run.id}
                </button>
                <button
                  className={`btn btn-xs ${favorite ? 'btn-warning' : 'btn-outline'}`}
                  onClick={() => toggleRunFavorite(run)}
                >
                  {favorite ? 'Favorited' : 'Favorite'}
                </button>
                <span className="text-xs text-gray-400">{fmtTime(run.timestamp || run.started_at)}</span>
                <span className="text-xs text-gray-400">Runtime: {fmtRuntime(run)}</span>
                <span className="text-xs text-gray-400">Workflow: {getHistoryWorkflowName(run) || 'Unknown'}</span>
                <button className="btn btn-xs btn-outline" onClick={() => navigate(`/history/${encodeURIComponent(String(run.id))}`, { state: { historyItem: run } })}>
                  Details
                </button>
                <button className={`btn btn-xs ml-auto ${compareRuns.includes(String(run.id)) ? 'btn-accent' : 'btn-outline'}`} onClick={() => setCompareRuns((prev) => {
                  const id = String(run.id);
                  if (prev.includes(id)) return prev.filter((x) => x !== id);
                  const next = [...prev, id];
                  return next.length <= 2 ? next : next.slice(next.length - 2);
                })}>{compareRuns.includes(String(run.id)) ? 'Run Selected' : 'Run Compare'}</button>
              </div>
              {shown.length === 0 ? (
                <p className="text-xs text-gray-500">No media for current filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="flex gap-2 min-w-max pb-1">
                    {shown.map((m) => {
                      const selected = compareMedia.some((x) => x.runId === String(run.id) && x.media.key === m.key);
                      const disabled = !selected && !canCompareType(m.mediaKind);
                      const isFinal = !finalSeen.has(m.mediaKind);
                      if (isFinal) finalSeen.add(m.mediaKind);
                      return (
                        <button
                          key={m.key}
                          disabled={disabled}
                          className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-md overflow-hidden border ${selected ? 'border-accent ring-2 ring-accent/40' : 'border-base-300/70'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          onClick={() => setCompareMedia((prev) => {
                            const key = `${run.id}::${m.key}`;
                            if (prev.some((x) => `${x.runId}::${x.media.key}` === key)) return prev.filter((x) => `${x.runId}::${x.media.key}` !== key);
                            const next = [...prev, { runId: String(run.id), media: m }];
                            return next.length <= 2 ? next : next.slice(next.length - 2);
                          })}
                        >
                          {m.mediaKind === 'video' ? (
                            <LazyMedia type="video" src={m.fullUrl} className="w-full h-full object-cover" rootMargin="250px" />
                          ) : (
                            <LazyMedia type="image" src={m.thumbUrl || m.fullUrl} fallbackSrc={m.fullUrl} alt={m.filename} className="w-full h-full object-cover" rootMargin="250px" />
                          )}
                          {isFinal && <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">Final {m.mediaKind}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {runs.length > visibleRuns.length && (
          <div className="flex justify-center">
            <button className="btn btn-sm btn-outline" onClick={() => setVisibleRunCount((prev) => prev + 30)}>
              Load More Runs
            </button>
          </div>
        )}
        </>
      )}
    </div>
  );
};

export default ProjectsPage;
