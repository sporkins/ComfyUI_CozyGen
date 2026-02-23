import React, { useState, useEffect, useRef, useCallback } from 'react';
import WorkflowSelector from '../components/WorkflowSelector';
import DynamicForm from '../components/DynamicForm';
import ImageInput from '../components/ImageInput'; // Import ImageInput
import SearchableSelect from '../components/SearchableSelect';
import { getWorkflows, getWorkflow, queuePrompt, getChoices, getQueue, getViewUrl, getObjectInfo, saveCozyHistoryItem, updateCozyHistoryItem, getCozySession, saveCozySession, getCozyPresets, saveCozyPresets } from '../api';
import Modal from 'react-modal';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

// Modal styles (copied from Gallery.jsx for consistency)
const isVideo = (url) => /\.(mp4|webm)/i.test(url);

const customStyles = {
  content: {
    position: 'relative',
    top: 'auto',
    left: 'auto',
    right: 'auto',
    bottom: 'auto',
    transform: 'none',
    marginRight: '0',
    backgroundColor: '#2D3748',
    border: 'none',
    borderRadius: '8px',
    padding: '0rem',
    maxHeight: '90vh',
    width: '90vw',
    maxWidth: '864px',
    overflow: 'auto',
    flexShrink: 0,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  }
};

const noteModalStyles = {
  content: {
    ...customStyles.content,
    backgroundColor: '#1F2937',
    padding: '0',
    maxWidth: '720px',
    width: '90vw',
  },
  overlay: customStyles.overlay,
};

Modal.setAppElement('#root');

const renderPreviewContent = (url) => {
    if (!url) return null;
    if (isVideo(url)) {
        return <video src={url} controls autoPlay loop muted className="max-w-full max-h-full object-contain rounded-lg" />;
    } else {
        return <img src={url} alt="Generated preview" className="max-w-full max-h-full object-contain rounded-lg cursor-pointer" />;
    }
};

const renderModalContent = (url) => {
    if (!url) return null;
    if (isVideo(url)) {
        return <video src={url} controls autoPlay loop className="max-w-full max-h-full object-contain rounded-lg" />;
    } else {
        return (
            <TransformWrapper
                initialScale={1}
                minScale={0.5}
                maxScale={5}
                limitToBounds={false}
                doubleClick={{ disabled: true }}
                wheel={true}
            >
                <TransformComponent>
                    <img src={url} alt="Generated preview" className="max-w-full max-h-full object-contain rounded-lg" />
                </TransformComponent>
            </TransformWrapper>
        );
    }
};

// Function to find nodes by class_type
const findNodesByType = (workflow, type) => {
    if (!workflow) return [];
    // Convert the workflow object to an array of nodes, adding the id to each node
    const nodes = Object.entries(workflow).map(([id, node]) => ({ ...node, id }));
    return nodes.filter(node => node.class_type === type);
};

const getWorkflowNotes = (workflow) => {
  return findNodesByType(workflow, 'CozyGenNote')
    .map((node) => {
      const title = String(node?.inputs?.title ?? '').trim();
      const note = String(node?.inputs?.note ?? '');
      return {
        id: String(node.id),
        title: title || `Note ${node.id}`,
        note,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
};

const choiceTypeMapping = {
  "clip_name1": "clip",
  "clip_name2": "clip",
  "unet_name": "unet",
  "vae_name": "vae",
  "sampler_name": "sampler",
  "scheduler": "scheduler",
  // Add more mappings as needed
};

const WANVIDEO_BASE_PRECISIONS = ["fp32", "bf16", "fp16", "fp16_fast"];
const WANVIDEO_QUANTIZATIONS = [
  "disabled",
  "fp8_e4m3fn",
  "fp8_e4m3fn_fast",
  "fp8_e4m3fn_scaled",
  "fp8_e4m3fn_scaled_fast",
  "fp8_e5m2",
  "fp8_e5m2_fast",
  "fp8_e5m2_scaled",
  "fp8_e5m2_scaled_fast",
];
const WANVIDEO_LOAD_DEVICES = ["main_device", "offload_device"];
const HISTORY_SELECTION_KEY = 'historySelection';
const PRESET_STORAGE_KEY = 'cozygenWorkflowPresetsV1';
const COZYGEN_INPUT_TYPES = [
    'CozyGenDynamicInput', 
    'CozyGenImageInput', 
    'CozyGenFloatInput', 
    'CozyGenIntInput', 
    'CozyGenSeedInput',
    'CozyGenRandomNoiseInput',
    'CozyGenStringInput',
    'CozyGenChoiceInput',
    'CozyGenLoraInput',
    'CozyGenLoraInputMulti',
    'CozyGenWanVideoModelSelector',
    'CozyGenBoolInput'
];
const getCozyInputCollapseKey = (input) => String(input?.id ?? input?.inputs?.param_name ?? '');
const getCollapsedStateStorageKey = (workflowName) => (
  workflowName ? `${workflowName}_collapsedInputNodes` : ''
);
const readCollapsedStateForWorkflow = (workflowName) => {
  if (!workflowName) return {};
  try {
    const raw = localStorage.getItem(getCollapsedStateStorageKey(workflowName));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('CozyGen: failed to read collapsed input state from localStorage.', error);
    return {};
  }
};

const readPresetStore = () => {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('CozyGen: failed to read presets from localStorage.', error);
    return {};
  }
};

const clearLegacyPresetStore = () => {
  localStorage.removeItem(PRESET_STORAGE_KEY);
};

const mergePresetStores = (serverStore, localStore) => {
  const safeServer = serverStore && typeof serverStore === 'object' ? serverStore : {};
  const safeLocal = localStore && typeof localStore === 'object' ? localStore : {};
  const workflowNames = new Set([...Object.keys(safeLocal), ...Object.keys(safeServer)]);
  const merged = {};

  for (const workflowName of workflowNames) {
    const localWorkflowPresets =
      safeLocal[workflowName] && typeof safeLocal[workflowName] === 'object' ? safeLocal[workflowName] : {};
    const serverWorkflowPresets =
      safeServer[workflowName] && typeof safeServer[workflowName] === 'object' ? safeServer[workflowName] : {};
    const mergedWorkflowPresets = {
      ...localWorkflowPresets,
      ...serverWorkflowPresets,
    };
    if (Object.keys(mergedWorkflowPresets).length > 0) {
      merged[workflowName] = mergedWorkflowPresets;
    }
  }

  return merged;
};

function App() {
  const [workflows, setWorkflows] = useState([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState(
    localStorage.getItem('selectedWorkflow') || null
  );
  const [workflowData, setWorkflowData] = useState(null);
  const [dynamicInputs, setDynamicInputs] = useState([]);
  const [formData, setFormData] = useState({});
  const [randomizeState, setRandomizeState] = useState({});
  const [bypassedState, setBypassedState] = useState({});
  const [collapsedInputNodes, setCollapsedInputNodes] = useState({});
  const [presetsByWorkflow, setPresetsByWorkflow] = useState(() => readPresetStore());
  const [selectedPresetName, setSelectedPresetName] = useState('');
  const [presetNameInput, setPresetNameInput] = useState('');
  const [previewImages, setPreviewImages] = useState(JSON.parse(localStorage.getItem('lastPreviewImages')) || []);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const websocketRef = useRef(null);
  const [progressValue, setProgressValue] = useState(0);
  const [progressMax, setProgressMax] = useState(0);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [statusText, setStatusText] = useState('Generating...');
  const [queueRemaining, setQueueRemaining] = useState(null);
  const workflowDataRef = useRef(null);
  const skipWorkflowFetchRef = useRef(false);
  const videoPreviewEntriesRef = useRef({});
  const runIdRef = useRef('');
  const skipNextCollapsedStateSaveRef = useRef(false);

  useEffect(() => {
    workflowDataRef.current = workflowData;
  }, [workflowData]);

  useEffect(() => {
    setSelectedNoteId('');
    setIsNoteModalOpen(false);
  }, [workflowData]);

  useEffect(() => {
    let cancelled = false;

    const loadPresetsFromServer = async () => {
      let serverStore = {};
      try {
        const response = await getCozyPresets();
        serverStore = response?.items && typeof response.items === 'object' ? response.items : {};
      } catch (error) {
        console.warn('CozyGen: failed to load presets from server, using local fallback if available.', error);
        return;
      }

      const legacyLocalStore = readPresetStore();
      const mergedStore = mergePresetStores(serverStore, legacyLocalStore);

      if (!cancelled) {
        setPresetsByWorkflow(mergedStore);
      }

      const hasLegacyPresets = Object.keys(legacyLocalStore).length > 0;
      const needsMigrationSync =
        hasLegacyPresets && JSON.stringify(mergedStore) !== JSON.stringify(serverStore);

      if (!needsMigrationSync) {
        if (hasLegacyPresets) {
          clearLegacyPresetStore();
        }
        return;
      }

      try {
        const saveResponse = await saveCozyPresets(mergedStore);
        const persistedStore =
          saveResponse?.items && typeof saveResponse.items === 'object' ? saveResponse.items : mergedStore;
        if (!cancelled) {
          setPresetsByWorkflow(persistedStore);
        }
        clearLegacyPresetStore();
      } catch (error) {
        console.warn('CozyGen: failed to migrate local presets to server.', error);
      }
    };

    loadPresetsFromServer();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkflow) {
      setSelectedPresetName('');
      return;
    }

    const presetEntries = presetsByWorkflow?.[selectedWorkflow] || {};
    const presetNames = Object.keys(presetEntries);
    if (selectedPresetName && presetNames.includes(selectedPresetName)) {
      return;
    }

    const firstPresetName = [...presetNames].sort((a, b) => a.localeCompare(b))[0] || '';
    setSelectedPresetName(firstPresetName);
  }, [selectedWorkflow, presetsByWorkflow, selectedPresetName]);

  useEffect(() => {
    setCollapsedInputNodes((prev) => {
      const next = {};
      for (const input of dynamicInputs) {
        const key = getCozyInputCollapseKey(input);
        if (!key) continue;
        next[key] = Boolean(prev[key]);
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const unchanged =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key]);

      return unchanged ? prev : next;
    });
  }, [dynamicInputs]);

  useEffect(() => {
    if (!selectedWorkflow) {
      skipNextCollapsedStateSaveRef.current = true;
      setCollapsedInputNodes({});
      return;
    }
    skipNextCollapsedStateSaveRef.current = true;
    setCollapsedInputNodes(readCollapsedStateForWorkflow(selectedWorkflow));
  }, [selectedWorkflow]);

  useEffect(() => {
    if (!selectedWorkflow) return;
    if (skipNextCollapsedStateSaveRef.current) {
      skipNextCollapsedStateSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem(
        getCollapsedStateStorageKey(selectedWorkflow),
        JSON.stringify(collapsedInputNodes || {})
      );
    } catch (error) {
      console.warn('CozyGen: failed to save collapsed input state to localStorage.', error);
    }
  }, [selectedWorkflow, collapsedInputNodes]);

  const buildInputNames = (inputs) => new Set(inputs.map((input) => input.inputs.param_name));

  const filterStateByInputs = (inputNames, stateValues) => Object.fromEntries(
    Object.entries(stateValues || {}).filter(([key]) => inputNames.has(key))
  );

  const getCurrentWorkflowPresetEntries = () => {
    if (!selectedWorkflow) return {};
    const workflowPresets = presetsByWorkflow?.[selectedWorkflow];
    return workflowPresets && typeof workflowPresets === 'object' ? workflowPresets : {};
  };

  const getCurrentWorkflowPresetOptions = () => Object.keys(getCurrentWorkflowPresetEntries())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));

  const prepareWorkflowData = useCallback(async (data, savedFormData = {}, savedRandomizeState = {}, savedBypassedState = {}) => {
    const workflowCopy = JSON.parse(JSON.stringify(data));

    for (const nodeId in workflowCopy) {
      const node = workflowCopy[nodeId];
      if (node.class_type === 'CozyGenImageInput') {
        if (!node.inputs.param_name) {
          node.inputs.param_name = "Image Input";
        }
      }
    }

    const allInputNodes = Object.values(workflowCopy).filter(node => COZYGEN_INPUT_TYPES.includes(node.class_type));

    for (const nodeId in workflowCopy) {
      if (COZYGEN_INPUT_TYPES.includes(workflowCopy[nodeId].class_type)) {
        workflowCopy[nodeId].id = nodeId;
      }
    }

    allInputNodes.sort((a, b) => (a.inputs['priority'] || 0) - (b.inputs['priority'] || 0));

    const inputsWithChoices = await Promise.all(allInputNodes.map(async (input) => {
      const isDynamicDropdown = input.class_type === 'CozyGenDynamicInput' && input.inputs['param_type'] === 'DROPDOWN';
      const isChoiceNode = input.class_type === 'CozyGenChoiceInput';
      const isLoraNode = ["CozyGenLoraInput", "CozyGenLoraInputMulti"].includes(input.class_type);
      const isWanVideoModelNode = input.class_type === 'CozyGenWanVideoModelSelector';

      if (isDynamicDropdown || isChoiceNode || isLoraNode || isWanVideoModelNode) {
        const param_name = input.inputs['param_name'];
        let choiceType = input.inputs['choice_type'] || (input.properties && input.properties['choice_type']);
                
        if(isLoraNode) choiceType = "loras";

        if (!choiceType && isDynamicDropdown) {
          choiceType = choiceTypeMapping[param_name];
        }

        if (isWanVideoModelNode) {
          try {
            const choicesData = await getChoices("wanvideo_models");
            input.inputs.choices = {
              modelNames: choicesData.choices || [],
              basePrecisions: WANVIDEO_BASE_PRECISIONS,
              quantizations: WANVIDEO_QUANTIZATIONS,
              loadDevices: WANVIDEO_LOAD_DEVICES,
            };
          } catch (error) {
            console.error(`Error fetching WanVideo models:`, error);
            input.inputs.choices = {
              modelNames: [],
              basePrecisions: WANVIDEO_BASE_PRECISIONS,
              quantizations: WANVIDEO_QUANTIZATIONS,
              loadDevices: WANVIDEO_LOAD_DEVICES,
            };
          }
        } else if (choiceType) {
          try {
            const choicesData = await getChoices(choiceType);
            input.inputs.choices = choicesData.choices || [];
            if(isLoraNode && !input.inputs.choices.includes("None")) {
              input.inputs.choices.unshift("None");
            }
          } catch (error) {
            console.error(`Error fetching choices for ${param_name} (choiceType: ${choiceType}):`, error);
            input.inputs.choices = [];
          }
        }
      }
      return input;
    }));

    const inputNames = buildInputNames(inputsWithChoices);
    const filteredRandomizeState = filterStateByInputs(inputNames, savedRandomizeState);
    const filteredBypassedState = filterStateByInputs(inputNames, savedBypassedState);

    const initialFormData = {};
    inputsWithChoices.forEach(input => {
      const param_name = input.inputs['param_name'];
      if (Object.prototype.hasOwnProperty.call(savedFormData, param_name)) {
        initialFormData[param_name] = savedFormData[param_name];
        return;
      }

      let defaultValue;
      if (['CozyGenDynamicInput', 'CozyGenFloatInput', 'CozyGenIntInput', 'CozyGenStringInput'].includes(input.class_type)) {
        defaultValue = input.inputs['default_value'];
        if (input.class_type === 'CozyGenIntInput') {
          defaultValue = parseInt(defaultValue, 10);
        } else if (input.class_type === 'CozyGenFloatInput') {
          defaultValue = parseFloat(defaultValue);
        }
      } else if (input.class_type === 'CozyGenSeedInput') {
        defaultValue = parseInt(input.inputs.seed, 10);
        if (Number.isNaN(defaultValue)) {
          defaultValue = 0;
        }
      } else if (input.class_type === 'CozyGenRandomNoiseInput') {
        defaultValue = parseInt(input.inputs.noise_seed, 10);
        if (Number.isNaN(defaultValue)) {
          defaultValue = 0;
        }
      } else if (input.class_type === 'CozyGenChoiceInput') {
        const choiceOptions = Array.isArray(input.inputs.choices) ? input.inputs.choices : [];
        const configuredDefault = input.inputs.value || input.inputs.default_choice;
        const normalizeChoice = (value) => String(value || '').trim().replace(/\\/g, '/');
        const normalizedDefault = normalizeChoice(configuredDefault);
        const resolvedChoice = choiceOptions.find((choice) => normalizeChoice(choice) === normalizedDefault);
        if (resolvedChoice) {
          defaultValue = resolvedChoice;
        } else {
          defaultValue = choiceOptions.length > 0 ? choiceOptions[0] : '';
        }
      } else if(input.class_type === "CozyGenLoraInput") {
        defaultValue = { lora: input.inputs.lora_value, strength: input.inputs.strength_value };
      } else if(input.class_type === "CozyGenLoraInputMulti") {
        defaultValue = [0, 1, 2, 3, 4].map((index) => ({
          lora: input.inputs[`lora_${index}`],
          strength: input.inputs[`strength_${index}`],
        }));
        const configuredCount = Number(input.inputs.num_loras);
        defaultValue.num_loras = Number.isFinite(configuredCount)
          ? Math.max(1, Math.min(5, configuredCount))
          : 5;
      } else if(input.class_type === "CozyGenWanVideoModelSelector") {
        defaultValue = {
          model_name: input.inputs.model_name || input.inputs.choices?.modelNames?.[0] || 'none',
          base_precision: input.inputs.base_precision || WANVIDEO_BASE_PRECISIONS[0],
          quantization: input.inputs.quantization || WANVIDEO_QUANTIZATIONS[0],
          load_device: input.inputs.load_device || WANVIDEO_LOAD_DEVICES[1],
        };
      } else if (input.class_type === 'CozyGenImageInput') {
        defaultValue = input.inputs.image;
      } else if(input.class_type === 'CozyGenBoolInput') {
        defaultValue = input.inputs.value;
      }
      initialFormData[param_name] = defaultValue;
    });

    setWorkflowData(workflowCopy);
    setDynamicInputs(inputsWithChoices);
    setFormData(initialFormData);
    setRandomizeState(filteredRandomizeState);
    setBypassedState(filteredBypassedState);

    return { inputsWithChoices, initialFormData, filteredRandomizeState, filteredBypassedState };
  }, []);

  const getWorkflowMismatchWarnings = (workflow, objectInfo) => {
    if (!workflow || !objectInfo) return [];
    const warnings = [];
    const seenClasses = new Set();
    Object.values(workflow).forEach((node) => {
      const classType = node?.class_type;
      if (!classType || seenClasses.has(classType)) return;
      seenClasses.add(classType);

      const info = objectInfo[classType];
      if (!info) {
        warnings.push(`${classType} (missing class)`);
        return;
      }

      const requiredInputs = info?.input?.required || {};
      const optionalInputs = info?.input?.optional || {};
      const infoInputs = new Set([...Object.keys(requiredInputs), ...Object.keys(optionalInputs)]);
      const nodeInputs = Object.keys(node.inputs || {});
      const hasDifference = nodeInputs.some((key) => !infoInputs.has(key)) || [...infoInputs].some((key) => !nodeInputs.includes(key));
      if (hasDifference) {
        warnings.push(`${classType} (inputs differ)`);
      }
    });
    return warnings;
  };

  const applyHistorySelection = useCallback(async (historyItem) => {
    if (!historyItem?.json) return;
    const workflow = historyItem.json?.prompt || historyItem.json;
    if (!workflow) return;

    try {
      const objectInfo = await getObjectInfo();
      const warnings = getWorkflowMismatchWarnings(workflow, objectInfo);
      if (warnings.length > 0) {
        const proceed = window.confirm(
          `This workflow may be outdated. The following mismatches were found:\n\n${warnings.join('\n')}\n\nLoad anyway?`
        );
        if (!proceed) {
          return;
        }
      }
    } catch (error) {
      console.warn('CozyGen: unable to verify workflow compatibility.', error);
    }

    const fields = historyItem.fields || {};
    const savedFormData = fields.formData || {};
    const savedRandomizeState = fields.randomizeState || {};
    const savedBypassedState = fields.bypassedState || {};
    const workflowName = fields.selectedWorkflow;

    if (workflowName) {
      skipWorkflowFetchRef.current = true;
      setSelectedWorkflow(workflowName);
      localStorage.setItem('selectedWorkflow', workflowName);
    }

    await prepareWorkflowData(workflow, savedFormData, savedRandomizeState, savedBypassedState);

    if (workflowName) {
      localStorage.setItem(`${workflowName}_formData`, JSON.stringify(savedFormData));
      localStorage.setItem(`${workflowName}_randomizeState`, JSON.stringify(savedRandomizeState));
      localStorage.setItem(`${workflowName}_bypassedState`, JSON.stringify(savedBypassedState));
    }
  }, [prepareWorkflowData]);

  const openModalWithImage = (imageSrc) => {
    setSelectedPreviewImage(imageSrc);
    setModalIsOpen(true);
  };

  const closeNoteModal = () => {
    setIsNoteModalOpen(false);
    setSelectedNoteId('');
  };

  // --- WebSocket Connection ---
  const connectWebSocket = useCallback(() => {
    if (websocketRef.current && [WebSocket.OPEN, WebSocket.CONNECTING].includes(websocketRef.current.readyState)) {
      return;
    }

    const protocol = window.location.protocol.startsWith('https') ? 'wss' : 'ws';
    const host = window.location.host;
    const wsUrl = `${protocol}://${host}/ws`;

    websocketRef.current = new WebSocket(wsUrl);

    websocketRef.current.onmessage = (event) => {
      if (typeof event.data !== 'string') {
          console.log("CozyGen: Received binary WebSocket message, ignoring.");
          return;
      }

      const msg = JSON.parse(event.data);

      if (msg.type === 'cozygen_batch_ready') {
          const imageUrls = msg.data.images.map(image => image.url);
          if (imageUrls.length > 0) {
              setPreviewImages(imageUrls);
              localStorage.setItem('lastPreviewImages', JSON.stringify(imageUrls));
          }
          setIsLoading(false);
          setProgressValue(0);
          setProgressMax(0);
          setStatusText('Finished');
          const lastPromptId = localStorage.getItem('lastPromptId');
          if (lastPromptId && imageUrls.length > 0) {
            updateCozyHistoryItem(lastPromptId, { preview_images: imageUrls }).catch((error) => {
              console.warn('CozyGen: failed to update history previews', error);
            });
          }
          saveCozySession({
            id: lastPromptId,
            status: 'finished',
            preview_images: imageUrls,
            updated_at: new Date().toISOString(),
          }).catch(() => {});
        } else if (msg.type === 'cozygen_video_ready') {
          const data = msg?.data || {};
          const videoUrl = data.video_url
            || (data.filename ? getViewUrl(data.filename, data.subfolder || '', data.type || 'output') : null);
          const fallbackKey = data.filename ? `${data.subfolder || ''}/${data.filename}` : videoUrl;
          const previewKey = data.preview_key || fallbackKey;
          const previewPriority = Number.isFinite(Number(data.priority)) ? Number(data.priority) : 9999;
          const previewOrder = Number.isFinite(Number(data.order)) ? Number(data.order) : 0;
          const previewName = data.param_name || data.filename || 'Video Preview';
          if (videoUrl && previewKey) {
            videoPreviewEntriesRef.current[previewKey] = {
              url: videoUrl,
              priority: previewPriority,
              order: previewOrder,
              param_name: String(previewName),
            };
          }
          const previewUrls = Object.values(videoPreviewEntriesRef.current)
            .sort((a, b) => {
              if (a.priority !== b.priority) return a.priority - b.priority;
              if (a.order !== b.order) return a.order - b.order;
              return a.param_name.localeCompare(b.param_name);
            })
            .map((entry) => entry.url);
          if (previewUrls.length > 0) {
            setPreviewImages(previewUrls);
            localStorage.setItem('lastPreviewImages', JSON.stringify(previewUrls));
          }
          setIsLoading(false);
          setProgressValue(0);
          setProgressMax(0);
          setStatusText('Finished');
          const lastPromptId = localStorage.getItem('lastPromptId');
          if (lastPromptId && previewUrls.length > 0) {
            updateCozyHistoryItem(lastPromptId, { preview_images: previewUrls }).catch((error) => {
              console.warn('CozyGen: failed to update history previews', error);
            });
          }
          saveCozySession({
            id: lastPromptId,
            status: 'finished',
            preview_images: previewUrls,
            updated_at: new Date().toISOString(),
          }).catch(() => {});
        } else if (msg.type === 'cozygen_run_end') {
          const eventRunId = msg?.data?.run_id;
          if (eventRunId && runIdRef.current && eventRunId !== runIdRef.current) {
            return;
          }
          let latestPreviewImages = [];
          try {
            latestPreviewImages = JSON.parse(localStorage.getItem('lastPreviewImages') || '[]');
          } catch {
            latestPreviewImages = [];
          }
          setIsLoading(false);
          setProgressValue(0);
          setProgressMax(0);
          setStatusText('Finished');
          const lastPromptId = localStorage.getItem('lastPromptId');
          if (lastPromptId) {
            saveCozySession({
              id: lastPromptId,
              status: 'finished',
              preview_images: latestPreviewImages,
              updated_at: new Date().toISOString(),
            }).catch(() => {});
          }
        } else if (msg.type === 'executing') {
          const nodeId = msg.data.node;
          // If nodeId is null, it means the prompt is finished, but we wait for our own message.
          if (nodeId && workflowDataRef.current && workflowDataRef.current[nodeId]) {
              const node = workflowDataRef.current[nodeId];
              const nodeName = node.title || node.class_type;
              setStatusText(`Executing: ${nodeName}`);
          }
          const lastPromptId = localStorage.getItem('lastPromptId');
          if (lastPromptId) {
            saveCozySession({
              id: lastPromptId,
              status: 'running',
              updated_at: new Date().toISOString(),
            }).catch(() => {});
          }
      } else if (msg.type === 'progress') {
          setProgressValue(msg.data.value);
          setProgressMax(msg.data.max);
          const lastPromptId = localStorage.getItem('lastPromptId');
          if (lastPromptId) {
            saveCozySession({
              id: lastPromptId,
              status: 'running',
              progress: { value: msg.data.value, max: msg.data.max },
              updated_at: new Date().toISOString(),
            }).catch(() => {});
          }
      } else if (msg.type === 'status') {
          const remaining = msg?.data?.status?.exec_info?.queue_remaining;
          if (typeof remaining === 'number') {
            setQueueRemaining(remaining);
          }
      } else if (msg.type === 'execution_interrupted') {
          const messagePromptId = msg?.data?.prompt_id ? String(msg.data.prompt_id) : null;
          const activePromptId = localStorage.getItem('lastPromptId');
          if (messagePromptId && activePromptId && messagePromptId !== activePromptId) {
            return;
          }
          let latestPreviewImages = [];
          try {
            latestPreviewImages = JSON.parse(localStorage.getItem('lastPreviewImages') || '[]');
          } catch {
            latestPreviewImages = [];
          }
          setIsLoading(false);
          setProgressValue(0);
          setProgressMax(0);
          setStatusText('Finished');
          if (activePromptId) {
            saveCozySession({
              id: activePromptId,
              status: 'finished',
              preview_images: latestPreviewImages,
              updated_at: new Date().toISOString(),
            }).catch(() => {});
          }
      }
    };

    websocketRef.current.onclose = () => {
      setTimeout(connectWebSocket, 1000);
    };

    websocketRef.current.onerror = (err) => {
      console.error('CozyGen: WebSocket error: ', err);
      websocketRef.current.close();
    };
  }, []);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // --- Data Fetching ---
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const data = await getWorkflows();
        setWorkflows(data.workflows || []);
      } catch (error) {
        console.error(error);
      }
    };
    fetchWorkflows();
  }, []);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const session = await getCozySession();
        if (!session?.id) return;
        localStorage.setItem('lastPromptId', session.id);

        if (Array.isArray(session.preview_images) && session.preview_images.length > 0) {
          setPreviewImages(session.preview_images);
          localStorage.setItem('lastPreviewImages', JSON.stringify(session.preview_images));
          setStatusText(session.status === 'finished' ? 'Finished' : 'Generating...');
        }
        if (session?.progress && typeof session.progress.value === 'number') {
          setProgressValue(session.progress.value);
          setProgressMax(session.progress.max || 0);
        }

        let isActive = false;
        try {
          const queueData = await getQueue();
          const queueRunning = Array.isArray(queueData?.queue_running) ? queueData.queue_running : [];
          const queuePending = Array.isArray(queueData?.queue_pending) ? queueData.queue_pending : [];
          const allQueueItems = Array.isArray(queueData) ? queueData : [...queueRunning, ...queuePending];
          const activeIds = new Set(allQueueItems.map((item) => {
            if (!item) return null;
            if (typeof item === 'string' || typeof item === 'number') return String(item);
            if (typeof item.prompt_id === 'string' || typeof item.prompt_id === 'number') return String(item.prompt_id);
            if (Array.isArray(item) && (typeof item[0] === 'string' || typeof item[0] === 'number')) return String(item[0]);
            if (Array.isArray(item) && item[1] && (typeof item[1].prompt_id === 'string' || typeof item[1].prompt_id === 'number')) return String(item[1].prompt_id);
            return null;
          }).filter(Boolean));
          isActive = activeIds.has(session.id);
        } catch (error) {
          console.warn('CozyGen: failed to read queue for session restore', error);
        }

        if (isActive) {
          setIsLoading(true);
          setStatusText('Generating...');
          connectWebSocket();
        } else if (session.status === 'finished') {
          setIsLoading(false);
          setStatusText('Finished');
        } else {
          setIsLoading(false);
        }
      } catch (error) {
        // no session yet
      }
    };

    loadSession();
  }, [connectWebSocket]);

  useEffect(() => {
    if (!selectedWorkflow) return;

    const fetchWorkflowData = async () => {
      try {
        if (skipWorkflowFetchRef.current) {
          skipWorkflowFetchRef.current = false;
          return;
        }

        const data = await getWorkflow(selectedWorkflow);
        const savedFormData = JSON.parse(localStorage.getItem(`${selectedWorkflow}_formData`)) || {};
        const savedRandomizeState = JSON.parse(localStorage.getItem(`${selectedWorkflow}_randomizeState`)) || {};
        const savedBypassedState = JSON.parse(localStorage.getItem(`${selectedWorkflow}_bypassedState`)) || {};

        await prepareWorkflowData(data, savedFormData, savedRandomizeState, savedBypassedState);

      } catch (error) {
        console.error(error);
        handleWorkflowSelect(null);
      }
    };

    fetchWorkflowData();
  }, [selectedWorkflow, prepareWorkflowData]);

  useEffect(() => {
    const storedHistory = localStorage.getItem(HISTORY_SELECTION_KEY);
    if (!storedHistory) {
      return;
    }
    localStorage.removeItem(HISTORY_SELECTION_KEY);
    try {
      const historyItem = JSON.parse(storedHistory);
      applyHistorySelection(historyItem);
    } catch (error) {
      console.warn('CozyGen: failed to load history selection.', error);
    }
  }, [applyHistorySelection]);

  // --- Handlers ---
  const handleWorkflowSelect = (workflow) => {
    setSelectedWorkflow(workflow);
    localStorage.setItem('selectedWorkflow', workflow);
    setWorkflowData(null);
    setDynamicInputs([]);
    setCollapsedInputNodes({});
    setFormData({});
    setRandomizeState({});
    setPreviewImages([]);
    videoPreviewEntriesRef.current = {};
    runIdRef.current = '';
  };

  const handleFormChange = (inputName, value) => {
    const newFormData = { ...formData, [inputName]: value };
    setFormData(newFormData);
    localStorage.setItem(`${selectedWorkflow}_formData`, JSON.stringify(newFormData));
  };

  const handleRandomizeToggle = (inputName, isRandom) => {
    const newRandomizeState = { ...randomizeState, [inputName]: isRandom };
    setRandomizeState(newRandomizeState);
    localStorage.setItem(`${selectedWorkflow}_randomizeState`, JSON.stringify(newRandomizeState));
  };

  const handleBypassToggle = (inputName, isBypassed) => {
    const newBypassedState = { ...bypassedState, [inputName]: isBypassed };
    setBypassedState(newBypassedState);
    localStorage.setItem(`${selectedWorkflow}_bypassedState`, JSON.stringify(newBypassedState));
  };

  const handleToggleInputCollapse = (inputKey) => {
    if (!inputKey) return;
    setCollapsedInputNodes((prev) => ({
      ...prev,
      [inputKey]: !prev[inputKey],
    }));
  };

  const setAllInputNodesCollapsed = (collapsed) => {
    const nextState = {};
    dynamicInputs.forEach((input) => {
      const key = getCozyInputCollapseKey(input);
      if (!key) return;
      nextState[key] = collapsed;
    });
    setCollapsedInputNodes(nextState);
  };

  const handleSavePreset = async () => {
    if (!selectedWorkflow || !workflowData) {
      window.alert('Select a workflow before saving a preset.');
      return;
    }

    const presetName = presetNameInput.trim();
    if (!presetName) {
      window.alert('Enter a preset name.');
      return;
    }

    const existingPreset = presetsByWorkflow?.[selectedWorkflow]?.[presetName];
    if (existingPreset) {
      const overwrite = window.confirm(`Preset "${presetName}" already exists for "${selectedWorkflow}". Overwrite it?`);
      if (!overwrite) {
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const presetPayload = {
      name: presetName,
      workflowName: selectedWorkflow,
      saved_at: nowIso,
      created_at: existingPreset?.created_at || nowIso,
      input_names: dynamicInputs.map((input) => input.inputs?.param_name).filter(Boolean),
      formData: JSON.parse(JSON.stringify(formData || {})),
      randomizeState: JSON.parse(JSON.stringify(randomizeState || {})),
      bypassedState: JSON.parse(JSON.stringify(bypassedState || {})),
    };

    const nextStore = {
      ...presetsByWorkflow,
      [selectedWorkflow]: {
        ...(presetsByWorkflow?.[selectedWorkflow] || {}),
        [presetName]: presetPayload,
      },
    };

    try {
      const response = await saveCozyPresets(nextStore);
      const persistedStore =
        response?.items && typeof response.items === 'object' ? response.items : nextStore;
      setPresetsByWorkflow(persistedStore);
      setSelectedPresetName(presetName);
      setPresetNameInput(presetName);
      clearLegacyPresetStore();
    } catch (error) {
      console.warn('CozyGen: failed to save preset to server.', error);
      window.alert('Failed to save preset to server.');
    }
  };

  const handleLoadPreset = () => {
    if (!selectedWorkflow) {
      window.alert('Select a workflow before loading a preset.');
      return;
    }
    if (!selectedPresetName) {
      window.alert('Select a preset to load.');
      return;
    }

    const preset = presetsByWorkflow?.[selectedWorkflow]?.[selectedPresetName];
    if (!preset) {
      window.alert(`Preset "${selectedPresetName}" was not found.`);
      return;
    }

    const inputNames = buildInputNames(dynamicInputs);
    const presetKeys = new Set([
      ...Object.keys(preset.formData || {}),
      ...Object.keys(preset.randomizeState || {}),
      ...Object.keys(preset.bypassedState || {}),
    ]);
    const missingFields = [...presetKeys]
      .filter((key) => !inputNames.has(key))
      .sort((a, b) => a.localeCompare(b));

    if (missingFields.length > 0) {
      const visibleFields = missingFields.slice(0, 20);
      const remainingCount = missingFields.length - visibleFields.length;
      const proceed = window.confirm(
        `Preset "${selectedPresetName}" has fields that do not exist in the current workflow:\n\n${visibleFields.join('\n')}${
          remainingCount > 0 ? `\n...and ${remainingCount} more` : ''
        }\n\nApply matching fields anyway?`
      );
      if (!proceed) {
        return;
      }
    }

    const filteredPresetFormData = filterStateByInputs(inputNames, preset.formData || {});
    const filteredPresetRandomize = filterStateByInputs(inputNames, preset.randomizeState || {});
    const filteredPresetBypassed = filterStateByInputs(inputNames, preset.bypassedState || {});

    const nextFormData = { ...formData, ...filteredPresetFormData };
    const nextRandomizeState = { ...randomizeState, ...filteredPresetRandomize };
    const nextBypassedState = { ...bypassedState, ...filteredPresetBypassed };

    setFormData(nextFormData);
    setRandomizeState(nextRandomizeState);
    setBypassedState(nextBypassedState);
    localStorage.setItem(`${selectedWorkflow}_formData`, JSON.stringify(nextFormData));
    localStorage.setItem(`${selectedWorkflow}_randomizeState`, JSON.stringify(nextRandomizeState));
    localStorage.setItem(`${selectedWorkflow}_bypassedState`, JSON.stringify(nextBypassedState));
    setPresetNameInput(selectedPresetName);
  };

  const handleDeletePreset = async () => {
    if (!selectedWorkflow || !selectedPresetName) {
      return;
    }

    const confirmDelete = window.confirm(`Delete preset "${selectedPresetName}" for "${selectedWorkflow}"?`);
    if (!confirmDelete) {
      return;
    }

    const workflowPresets = { ...(presetsByWorkflow?.[selectedWorkflow] || {}) };
    delete workflowPresets[selectedPresetName];

    const nextStore = { ...presetsByWorkflow };
    if (Object.keys(workflowPresets).length > 0) {
      nextStore[selectedWorkflow] = workflowPresets;
    } else {
      delete nextStore[selectedWorkflow];
    }

    try {
      const response = await saveCozyPresets(nextStore);
      const persistedStore =
        response?.items && typeof response.items === 'object' ? response.items : nextStore;
      setPresetsByWorkflow(persistedStore);
      if (presetNameInput === selectedPresetName) {
        setPresetNameInput('');
      }
      setSelectedPresetName('');
      clearLegacyPresetStore();
    } catch (error) {
      console.warn('CozyGen: failed to delete preset on server.', error);
      window.alert('Failed to delete preset on server.');
    }
  };

  const extractPromptId = (item) => {
    if (!item) return null;
    if (typeof item === 'string') return item;
    if (typeof item.prompt_id === 'string' || typeof item.prompt_id === 'number') return String(item.prompt_id);
    if (Array.isArray(item) && (typeof item[0] === 'string' || typeof item[0] === 'number')) return String(item[0]);
    if (Array.isArray(item) && item[1] && (typeof item[1].prompt_id === 'string' || typeof item[1].prompt_id === 'number')) {
      return String(item[1].prompt_id);
    }
    return null;
  };

  const appendHistoryEntry = async (entry) => {
    try {
      await saveCozyHistoryItem(entry);
    } catch (error) {
      console.warn('CozyGen: failed to save history item', error);
    }
  };

  const handleGenerate = async (clear = true) => {
    if (!workflowData) return;
    if(clear) {
        setIsLoading(true);
        setPreviewImages([]); // Clear previous images
        videoPreviewEntriesRef.current = {};
        runIdRef.current = '';
        setStatusText('Queuing prompt...');
    }

    try {
        const runId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        runIdRef.current = runId;
        const queueWarningThreshold = 10;
        try {
          const queueData = await getQueue();
          const queueRunning = Array.isArray(queueData?.queue_running) ? queueData.queue_running : [];
          const queuePending = Array.isArray(queueData?.queue_pending) ? queueData.queue_pending : [];
          const queueLength = Array.isArray(queueData) ? queueData.length : queueRunning.length + queuePending.length;
          if (queueLength > queueWarningThreshold) {
            const proceed = window.confirm(
              `There are currently ${queueLength} prompts in the queue. Submitting another job may take a while. Continue?`
            );
            if (!proceed) {
              setIsLoading(false);
              setStatusText('Cancelled');
              return;
            }
          }
        } catch (error) {
          console.warn('CozyGen: unable to read queue for warning prompt.', error);
        }

        let finalWorkflow = JSON.parse(JSON.stringify(workflowData));
        const metaTextLines = [];

        // --- Bypass and Value Injection Logic (condensed for brevity) ---
        const COZYGEN_INPUT_TYPES_WITH_BYPASS = ['CozyGenDynamicInput', 'CozyGenChoiceInput'];
        const bypassedNodes = dynamicInputs.filter(dn => bypassedState[dn.inputs.param_name] && COZYGEN_INPUT_TYPES_WITH_BYPASS.includes(dn.class_type));
        
        for (const bypassedNode of bypassedNodes) {
            // Find the node that our CozyGen input is connected to (e.g., a LoraLoader).
            let targetNodeId = Object.keys(finalWorkflow).find(id => 
                Object.values(finalWorkflow[id].inputs).some(input => Array.isArray(input) && input[0] === bypassedNode.id)
            );

            if (!targetNodeId) continue;

            const targetNode = finalWorkflow[targetNodeId];

            // Find the "real" upstream input to the target node (e.g., the model output from a previous loader).
            // This is the input we want to connect *past* the bypassed node.
            const upstreamSources = {};
            for (const inputName in targetNode.inputs) {
                const input = targetNode.inputs[inputName];
                if (Array.isArray(input) && finalWorkflow[input[0]] && !COZYGEN_INPUT_TYPES_WITH_BYPASS.includes(finalWorkflow[input[0]].class_type)) {
                    upstreamSources[inputName] = input;
                }
            }

            // If there's no other upstream source, we can't bypass.
            if (Object.keys(upstreamSources).length === 0) continue;

            // Find all nodes that are connected to our target node.
            const downstreamConnections = [];
            for (const nodeId in finalWorkflow) {
                for (const inputName in finalWorkflow[nodeId].inputs) {
                    const input = finalWorkflow[nodeId].inputs[inputName];
                    if (Array.isArray(input) && input[0] === targetNodeId) {
                        downstreamConnections.push({ nodeId, inputName });
                    }
                }
            }

            // Rewire the downstream connections to point to the upstream source, skipping the target.
            for (const conn of downstreamConnections) {
                // The input name on the downstream node should match the input name on the target node
                // that had the upstream source. E.g., 'MODEL' -> 'MODEL'.
                const upstreamSource = upstreamSources[conn.inputName];
                if (upstreamSource) {
                    finalWorkflow[conn.nodeId].inputs[conn.inputName] = upstreamSource;
                }
            }

            // Delete the bypassed nodes from the workflow.
            delete finalWorkflow[targetNodeId];
            delete finalWorkflow[bypassedNode.id];
        }

        let updatedFormData = { ...formData };
        dynamicInputs.forEach(dynamicNode => {
            if (!finalWorkflow[dynamicNode.id]) return;
            const param_name = dynamicNode.inputs.param_name;
            if (dynamicNode.class_type === 'CozyGenImageInput') return;
            let valueToInject = randomizeState[param_name] 
                ? (dynamicNode.inputs.param_type === 'FLOAT' ? Math.random() * ((dynamicNode.inputs.max_value || 1000000) - (dynamicNode.inputs.min_value || 0)) + (dynamicNode.inputs.min_value || 0) : Math.floor(Math.random() * ((dynamicNode.inputs.max_value || 1000000) - (dynamicNode.inputs.min_value || 0) + 1)) + (dynamicNode.inputs.min_value || 0))
                : formData[param_name];
            updatedFormData[param_name] = valueToInject;

            const nodeToUpdate = finalWorkflow[dynamicNode.id];
            if (nodeToUpdate) {
                if (dynamicNode.class_type === 'CozyGenSeedInput') {
                    const parsedSeed = Number.parseInt(valueToInject, 10);
                    nodeToUpdate.inputs.seed = Number.isNaN(parsedSeed) ? 0 : parsedSeed;
                } else if (dynamicNode.class_type === 'CozyGenRandomNoiseInput') {
                    const parsedSeed = Number.parseInt(valueToInject, 10);
                    nodeToUpdate.inputs.noise_seed = Number.isNaN(parsedSeed) ? 0 : parsedSeed;
                } else if (['CozyGenFloatInput', 'CozyGenIntInput', 'CozyGenStringInput', 'CozyGenDynamicInput'].includes(dynamicNode.class_type)) {
                    nodeToUpdate.inputs.default_value = valueToInject;
                } else if (dynamicNode.class_type === 'CozyGenChoiceInput') {
                    nodeToUpdate.inputs.value = valueToInject;
                } else if(dynamicNode.class_type === 'CozyGenLoraInput') {
                    const lora = valueToInject?.lora ?? "None";
                    const strength = valueToInject?.strength ?? 0;
                    if(lora !== "None" && strength !== 0) {
                        
                        metaTextLines.push(`${dynamicNode.inputs.param_name} = ${lora}:${Number(strength).toFixed(2)}`)
                    }
                    nodeToUpdate.inputs.strength_value = strength;
                    nodeToUpdate.inputs.lora_value = lora;
                } else if(dynamicNode.class_type === 'CozyGenLoraInputMulti') {
                    const loraValues = Array.isArray(valueToInject) ? valueToInject : [];
                    const requestedNumLoras = Number(loraValues.num_loras);
                    let highestActiveIndex = -1;
                    for (let index = 0; index < 5; index += 1) {
                        const loraValue = loraValues[index] || {};
                        const lora = loraValue.lora ?? "None";
                        const strength = loraValue.strength ?? 0;
                        if(lora !== "None" && strength !== 0) {
                            highestActiveIndex = index;
                            metaTextLines.push(`${dynamicNode.inputs.param_name} ${index + 1} = ${lora}:${Number(strength).toFixed(2)}`)
                        }
                        nodeToUpdate.inputs[`lora_${index}`] = lora;
                        nodeToUpdate.inputs[`strength_${index}`] = strength;
                    }
                    if (Number.isFinite(requestedNumLoras)) {
                        nodeToUpdate.inputs.num_loras = Math.max(1, Math.min(5, requestedNumLoras));
                    } else {
                        const fallbackNumLoras = Number.isFinite(Number(dynamicNode.inputs.num_loras))
                            ? Number(dynamicNode.inputs.num_loras)
                            : 5;
                        const inferredNumLoras = highestActiveIndex >= 0 ? (highestActiveIndex + 1) : fallbackNumLoras;
                        nodeToUpdate.inputs.num_loras = Math.max(1, Math.min(5, inferredNumLoras));
                    }
                } else if(dynamicNode.class_type === 'CozyGenWanVideoModelSelector') {
                    const modelValue = valueToInject || {};
                    nodeToUpdate.inputs.model_name = modelValue.model_name || 'none';
                    nodeToUpdate.inputs.base_precision = modelValue.base_precision || 'bf16';
                    nodeToUpdate.inputs.quantization = modelValue.quantization || 'disabled';
                    nodeToUpdate.inputs.load_device = modelValue.load_device || 'offload_device';
                } else if(dynamicNode.class_type === 'CozyGenBoolInput') {
                    nodeToUpdate.inputs.value = valueToInject;
                }
            }
        });
        setFormData(updatedFormData);
        localStorage.setItem(`${selectedWorkflow}_formData`, JSON.stringify(updatedFormData));

        const imageInputNodes = dynamicInputs.filter(dn => dn.class_type === 'CozyGenImageInput');
        for (const node of imageInputNodes) {
            const image_filename = formData[node.inputs.param_name];
            if (!image_filename) {
                alert(`Please upload an image for "${node.inputs.param_name}" before generating.`);
                setIsLoading(false);
                return;
            }
            if (finalWorkflow[node.id]) {
                finalWorkflow[node.id].inputs.image = image_filename;
            }
        }

        for(const id of Object.keys(finalWorkflow)) {
            const node = finalWorkflow[id];
            if(!node || !node.class_type || !node.class_type.startsWith("CozyGen")) continue;
            
            console.log(node);

            if(!node.inputs) node.inputs = {};

            node.inputs.is_cozy = true;

            if(node.class_type === "CozyGenMetaText") {
                node.inputs.value = metaTextLines.join("\n");
            }
            if (["CozyGenOutput", "CozyGenVideoOutput", "CozyGenVideoPreviewOutput", "CozyGenVideoPreviewOutputMulti", "CozyGenEnd"].includes(node.class_type)) {
                node.inputs.run_id = runId;
            }
        }

        const promptPayload = { prompt: finalWorkflow };
        const queueResponse = await queuePrompt(promptPayload);
        const promptId = queueResponse?.prompt_id;
        if (promptId) {
          const promptIdString = String(promptId);
          localStorage.setItem('lastPromptId', promptIdString);
          saveCozySession({
            id: promptIdString,
            status: 'queued',
            workflow: selectedWorkflow,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).catch(() => {});
          appendHistoryEntry({
            id: promptIdString,
            timestamp: new Date().toISOString(),
            json: promptPayload,
            fields: {
              formData: updatedFormData,
              randomizeState,
              bypassedState,
              selectedWorkflow,
            },
          });
        } else {
          console.warn('CozyGen: queue response missing prompt_id.');
          localStorage.removeItem('lastPromptId');
        }

    } catch (error) {
        console.error("Failed to queue prompt:", error);
        setIsLoading(false);
        setStatusText('Error queuing prompt');
    }
  };

  const handleClearPreview = () => {
    setPreviewImages([]);
    videoPreviewEntriesRef.current = {};
    runIdRef.current = '';
    localStorage.removeItem('lastPreviewImages');
  };

  const controlInputs = dynamicInputs
    .filter(input => input.class_type !== 'CozyGenImageInput')
    .map(input => {
      if (['CozyGenFloatInput', 'CozyGenIntInput', 'CozyGenSeedInput', 'CozyGenRandomNoiseInput', 'CozyGenStringInput', 'CozyGenChoiceInput', 'CozyGenLoraInput', 'CozyGenLoraInputMulti', 'CozyGenWanVideoModelSelector', 'CozyGenBoolInput'].includes(input.class_type)) {
        let param_type = input.class_type.replace('CozyGen', '').replace('Input', '').toUpperCase();
        if (param_type === 'CHOICE') {
          param_type = 'DROPDOWN';
        }
        if (input.class_type === 'CozyGenRandomNoiseInput') {
          param_type = 'SEED';
        }
        if (param_type === 'LORAMULTI') {
          param_type = 'LORA_MULTI';
        }
        if (input.class_type === 'CozyGenWanVideoModelSelector') {
          param_type = 'WANVIDEO_MODEL';
        }
        return {
          ...input,
          inputs: {
            ...input.inputs,
            param_type: param_type,
            Multiline: input.inputs.display_multiline || false,
          }
        };
      }
      return input;
    });
  const hasImageInput = dynamicInputs.some(input => input.class_type === 'CozyGenImageInput');
  const presetOptions = getCurrentWorkflowPresetOptions();
  const workflowNotes = getWorkflowNotes(workflowData);
  const workflowNoteOptions = workflowNotes.map((note) => ({ value: note.id, label: note.title }));
  const activeWorkflowNote = workflowNotes.find((note) => String(note.id) === String(selectedNoteId)) || null;

  return (
    <div className="w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-28">
            {/* Right Column: Preview & Generate Button */}
            <div className="flex flex-col space-y-2">
                <div className="bg-base-200 shadow-lg rounded-lg p-3 min-h-[400px] lg:min-h-[500px] flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold text-white">Preview</h2>
                        <button 
                            onClick={handleClearPreview}
                            className="px-3 py-1 bg-base-300 text-gray-300 rounded-md text-sm hover:bg-base-300/70 transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="flex-grow flex items-center justify-center border-2 border-dashed border-base-300 rounded-lg p-2 overflow-y-auto">
                        {isLoading && <div className="text-center w-full"><p className="text-lg">{statusText}</p></div>}
                        {!isLoading && previewImages.length === 0 && (
                            <p className="text-gray-400">Your generated image or video will appear here.</p>
                        )}
                        {!isLoading && previewImages.length === 1 && (
                            <div className="w-full h-full flex items-center justify-center cursor-pointer" onClick={() => openModalWithImage(previewImages[0])}>
                                {renderPreviewContent(previewImages[0])}
                            </div>
                        )}
                        {!isLoading && previewImages.length > 1 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 w-full h-full">
                                {previewImages.map((src, index) => (
                                    <div key={index} className="aspect-square bg-base-300 rounded-lg overflow-hidden cursor-pointer" onClick={() => openModalWithImage(src)}>
                                        {renderPreviewContent(src)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                {/* Generate button moved to sticky footer */}
            </div>
            {/* Left Column: Controls */}
            <div className="flex flex-col space-y-2">
                <WorkflowSelector 
                  workflows={workflows}
                  selectedWorkflow={selectedWorkflow}
                  onSelect={handleWorkflowSelect}
                />
                <div className="bg-base-200 shadow-lg rounded-lg p-3 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <h2 className="text-lg font-semibold text-white">Presets</h2>
                        {selectedWorkflow ? (
                          <span className="text-xs text-gray-400 break-all">{selectedWorkflow}</span>
                        ) : (
                          <span className="text-xs text-gray-500">Select a workflow to use presets</span>
                        )}
                    </div>

                    <div className="flex flex-col lg:flex-row gap-2">
                        <input
                            type="text"
                            value={presetNameInput}
                            onChange={(event) => setPresetNameInput(event.target.value)}
                            placeholder="Preset name"
                            className="input input-bordered w-full"
                            disabled={!selectedWorkflow}
                        />
                        <button
                            type="button"
                            onClick={handleSavePreset}
                            disabled={!selectedWorkflow || !workflowData}
                            className="btn btn-primary lg:w-auto"
                        >
                            Save Preset
                        </button>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-2 items-stretch">
                        <SearchableSelect
                            id="workflow-preset-selector"
                            className="w-full"
                            buttonClassName="select select-bordered w-full bg-base-100 text-left"
                            value={selectedPresetName}
                            onChange={(nextName) => {
                              setSelectedPresetName(nextName);
                              setPresetNameInput(nextName);
                            }}
                            options={presetOptions}
                            placeholder={presetOptions.length > 0 ? '-- Select a preset --' : 'No presets yet'}
                            disabled={!selectedWorkflow || presetOptions.length === 0}
                            listMaxHeightClassName="max-h-56"
                        />
                        <button
                            type="button"
                            onClick={handleLoadPreset}
                            disabled={!selectedWorkflow || !selectedPresetName}
                            className="btn btn-accent lg:w-auto"
                        >
                            Load
                        </button>
                        <button
                            type="button"
                            onClick={handleDeletePreset}
                            disabled={!selectedWorkflow || !selectedPresetName}
                            className="btn btn-outline lg:w-auto"
                        >
                            Delete
                        </button>
                    </div>
                </div>
                {workflowNoteOptions.length > 0 && (
                    <div className="bg-base-200 shadow-lg rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold text-white">Workflow Notes</h2>
                            <span className="text-xs text-gray-400">{workflowNoteOptions.length}</span>
                        </div>
                        <SearchableSelect
                            id="workflow-notes-selector"
                            className="w-full"
                            buttonClassName="select select-bordered w-full bg-base-100 text-left"
                            value={selectedNoteId}
                            onChange={(noteId) => {
                              setSelectedNoteId(String(noteId));
                              setIsNoteModalOpen(true);
                            }}
                            options={workflowNoteOptions}
                            placeholder="Select a note to view"
                            listMaxHeightClassName="max-h-56"
                        />
                    </div>
                )}
                {dynamicInputs.length > 0 && (
                    <div className="bg-base-200 shadow-lg rounded-lg p-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="text-sm text-gray-300">
                                Input Groups: <span className="font-semibold text-white">{dynamicInputs.length}</span>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAllInputNodesCollapsed(false)}
                                    className="btn btn-xs btn-outline"
                                >
                                    Expand All
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAllInputNodesCollapsed(true)}
                                    className="btn btn-xs btn-outline"
                                >
                                    Collapse All
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Render ImageInput separately */}
                {dynamicInputs.filter(input => input.class_type === 'CozyGenImageInput').map(input => (
                    <ImageInput
                        key={input.id}
                        input={input}
                        value={formData[input.inputs.param_name]}
                        onFormChange={handleFormChange}
                        onBypassToggle={handleBypassToggle}
                        disabled={bypassedState[input.inputs.param_name] || false}
                        collapsed={Boolean(collapsedInputNodes[getCozyInputCollapseKey(input)])}
                        onToggleCollapse={() => handleToggleInputCollapse(getCozyInputCollapseKey(input))}
                    />
                ))}
                
                {/* New, Corrected Rendering Logic */}
                <DynamicForm
                    inputs={controlInputs}
                    formData={formData}
                    onFormChange={handleFormChange}
                    randomizeState={randomizeState}
                    onRandomizeToggle={handleRandomizeToggle}
                    bypassedState={bypassedState}
                    onBypassToggle={handleBypassToggle}
                    collapsedInputs={collapsedInputNodes}
                    onToggleCollapse={handleToggleInputCollapse}
                />

                
            </div>
        </div>

        {/* Sticky Generate Button Footer */}
        <div className="fixed bottom-0 left-0 right-0 bg-base-100/80 backdrop-blur-sm p-4 border-t border-base-300 z-10 shadow-lg">
            <div className="w-full">
                <div class="flex flex-row w-full gap-x-4">
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading || !workflowData}
                        className="w-full disabled:w-1/2 bg-accent text-white font-bold text-lg py-4 px-4 rounded-lg hover:bg-accent-focus transition duration-300 disabled:bg-base-300 disabled:cursor-not-allowed shadow-lg"
                    >
                        {isLoading ? 'Generating...' : 'Generate'}
                    </button>
                    {
                        isLoading && <button 
                            onClick={handleGenerate}
                            disabled={!workflowData}
                            class="w-1/2 bg-accent text-white font-bold text-lg py-4 px-4 rounded-lg hover:bg-accent-focus transition duration-300 disabled:bg-base-300 disabled:cursor-not-allowed shadow-lg">
                                Add to Queue
                        </button>
                    }
                </div>
                {(isLoading && progressMax > 0) && (
                    <div className="w-full bg-base-300 rounded-full h-2.5 mt-2">
                        <div
                            className="bg-accent h-2.5 rounded-full transition-all duration-1000 ease-out"
                            style={{ width: `${(progressValue / progressMax) * 100}%` }}
                        ></div>
                    </div>
                )}
                {(isLoading && typeof queueRemaining === 'number') && (
                  <p className="mt-2 text-xs text-gray-400 text-center">
                    Queue remaining: {queueRemaining}
                  </p>
                )}
            </div>
        </div>

        {/* Image Preview Modal */}
        {selectedPreviewImage && (
            <Modal
                isOpen={modalIsOpen}
                onRequestClose={() => setModalIsOpen(false)}
                style={customStyles}
                contentLabel="Image Preview"
            >
                <div className="flex flex-col h-full w-full">
                    <div className="flex-grow flex items-center justify-center min-h-0">
                        {renderModalContent(selectedPreviewImage)}
                    </div>
                    <div className="flex-shrink-0 p-2 flex justify-center">
                        <button
                            onClick={() => setModalIsOpen(false)}
                            className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-focus transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </Modal>
        )}

        {/* Workflow Note Modal */}
        {activeWorkflowNote && (
            <Modal
                isOpen={isNoteModalOpen}
                onRequestClose={closeNoteModal}
                style={noteModalStyles}
                contentLabel="Workflow Note"
            >
                <div className="flex flex-col max-h-[85vh]">
                    <div className="flex items-start justify-between gap-3 p-4 border-b border-base-300">
                        <h3 className="text-lg font-semibold text-white break-words">
                            {activeWorkflowNote.title}
                        </h3>
                        <button
                            type="button"
                            onClick={closeNoteModal}
                            className="btn btn-ghost btn-sm shrink-0"
                            aria-label="Close note"
                        >
                            X
                        </button>
                    </div>
                    <div className="p-4 overflow-auto">
                        <div className="whitespace-pre-wrap text-sm text-gray-100 leading-relaxed">
                            {activeWorkflowNote.note?.trim()
                              ? activeWorkflowNote.note
                              : 'This note is empty.'}
                        </div>
                    </div>
                </div>
            </Modal>
        )}
    </div>
  );
}
export default App;
