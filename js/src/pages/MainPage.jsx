import React, { useState, useEffect, useRef, useCallback } from 'react';
import WorkflowSelector from '../components/WorkflowSelector';
import DynamicForm from '../components/DynamicForm';
import ImageInput from '../components/ImageInput'; // Import ImageInput
import { getWorkflows, getWorkflow, queuePrompt, getChoices, getQueue, getHistory, getViewUrl } from '../api';
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
  const [previewImages, setPreviewImages] = useState(JSON.parse(localStorage.getItem('lastPreviewImages')) || []);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const websocketRef = useRef(null);
  const [progressValue, setProgressValue] = useState(0);
  const [progressMax, setProgressMax] = useState(0);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [statusText, setStatusText] = useState('Generating...');
  const workflowDataRef = useRef(null);

  useEffect(() => {
    workflowDataRef.current = workflowData;
  }, [workflowData]);

  const openModalWithImage = (imageSrc) => {
    setSelectedPreviewImage(imageSrc);
    setModalIsOpen(true);
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
      } else if (msg.type === 'executing') {
          const nodeId = msg.data.node;
          // If nodeId is null, it means the prompt is finished, but we wait for our own message.
          if (nodeId && workflowDataRef.current && workflowDataRef.current[nodeId]) {
              const node = workflowDataRef.current[nodeId];
              const nodeName = node.title || node.class_type;
              setStatusText(`Executing: ${nodeName}`);
          }
      } else if (msg.type === 'progress') {
          setProgressValue(msg.data.value);
          setProgressMax(msg.data.max);
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
    if (!selectedWorkflow) return;

    const fetchWorkflowData = async () => {
      try {
        const data = await getWorkflow(selectedWorkflow);
        setWorkflowData(data);

        // Ensure param_name is present in CozyGenImageInput nodes within the workflowData
        for (const nodeId in data) {
            const node = data[nodeId];
            if (node.class_type === 'CozyGenImageInput') {
                if (!node.inputs.param_name) {
                    node.inputs.param_name = "Image Input"; // Set default if missing
                }
            }
        }

        // New: Define all input types the UI should recognize
        const COZYGEN_INPUT_TYPES = [
            'CozyGenDynamicInput', 
            'CozyGenImageInput', 
            'CozyGenFloatInput', 
            'CozyGenIntInput', 
            'CozyGenStringInput',
            'CozyGenChoiceInput',
            'CozyGenLoraInput',
            'CozyGenLoraInputMulti',
            'CozyGenWanVideoModelSelector',
            'CozyGenBoolInput'
        ];

        // Find all nodes that are one of our recognized input types
        const allInputNodes = Object.values(data).filter(node => COZYGEN_INPUT_TYPES.includes(node.class_type));

        // Add the node's ID to its object for easy reference
        for (const nodeId in data) {
            if (COZYGEN_INPUT_TYPES.includes(data[nodeId].class_type)) {
                data[nodeId].id = nodeId;
            }
        }

        // Sort all inputs by the priority field
        allInputNodes.sort((a, b) => (a.inputs['priority'] || 0) - (b.inputs['priority'] || 0));

        // Fetch choices for dropdowns (applies to both Dynamic and Choice inputs)
        const inputsWithChoices = await Promise.all(allInputNodes.map(async (input) => {
            const isDynamicDropdown = input.class_type === 'CozyGenDynamicInput' && input.inputs['param_type'] === 'DROPDOWN';
            const isChoiceNode = input.class_type === 'CozyGenChoiceInput';
            const isLoraNode = ["CozyGenLoraInput", "CozyGenLoraInputMulti"].includes(input.class_type);
            const isWanVideoModelNode = input.class_type === 'CozyGenWanVideoModelSelector';

            if (isDynamicDropdown || isChoiceNode || isLoraNode || isWanVideoModelNode) {
                const param_name = input.inputs['param_name'];
                let choiceType = input.inputs['choice_type'] || (input.properties && input.properties['choice_type']);
                
                if(isLoraNode) choiceType = "loras";

                if (!choiceType && isDynamicDropdown) { // Fallback for older dynamic nodes
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
                        // For dynamic nodes, we put choices in a hidden field.
                        // For the new choice node, the JS will handle it, but we can preload here.
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

        setDynamicInputs(inputsWithChoices);

        const savedFormData = JSON.parse(localStorage.getItem(`${selectedWorkflow}_formData`)) || {};
        
        // Initialize formData with default values if not already present
        const initialFormData = {};
        inputsWithChoices.forEach(input => { // Use inputsWithChoices here
            const param_name = input.inputs['param_name'];
            if (savedFormData[param_name] === undefined) {
                let defaultValue;
                if (['CozyGenDynamicInput', 'CozyGenFloatInput', 'CozyGenIntInput', 'CozyGenStringInput'].includes(input.class_type)) {
                    defaultValue = input.inputs['default_value'];
                    if (input.class_type === 'CozyGenIntInput') {
                        defaultValue = parseInt(defaultValue, 10);
                    } else if (input.class_type === 'CozyGenFloatInput') {
                        defaultValue = parseFloat(defaultValue);
                    }
                } else if (input.class_type === 'CozyGenChoiceInput') {
                    defaultValue = input.inputs.choices && input.inputs.choices.length > 0 ? input.inputs.choices[0] : '';
                } else if(input.class_type === "CozyGenLoraInput") {
                    defaultValue = { lora: input.inputs.lora_value, strength: input.inputs.strength_value };
                } else if(input.class_type === "CozyGenLoraInputMulti") {
                    defaultValue = [0, 1, 2, 3, 4].map((index) => ({
                        lora: input.inputs[`lora_${index}`],
                        strength: input.inputs[`strength_${index}`],
                    }));
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
            } else {
                initialFormData[param_name] = savedFormData[param_name];
            }
        });
        setFormData(initialFormData);

        const savedRandomizeState = JSON.parse(localStorage.getItem(`${selectedWorkflow}_randomizeState`)) || {};
        setRandomizeState(savedRandomizeState);

        const savedBypassedState = JSON.parse(localStorage.getItem(`${selectedWorkflow}_bypassedState`)) || {};
        setBypassedState(savedBypassedState);

      } catch (error) {
        console.error(error);
        handleWorkflowSelect(null);
      }
    };

    fetchWorkflowData();
  }, [selectedWorkflow]);

  // --- Handlers ---
  const handleWorkflowSelect = (workflow) => {
    setSelectedWorkflow(workflow);
    localStorage.setItem('selectedWorkflow', workflow);
    setWorkflowData(null);
    setDynamicInputs([]);
    setFormData({});
    setRandomizeState({});
    setPreviewImages([]);
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

  const extractHistoryImages = (historyEntry) => {
    const outputs = historyEntry?.outputs || {};
    const imageUrls = [];

    Object.values(outputs).forEach((output) => {
      const outputImages = output?.images || output?.gifs || output?.videos;
      if (!Array.isArray(outputImages)) {
        return;
      }
      outputImages.forEach((image) => {
        if (!image) return;
        if (typeof image === 'string') {
          imageUrls.push(getViewUrl(image));
          return;
        }
        if (!image.filename) return;
        imageUrls.push(getViewUrl(image.filename, image.subfolder || '', image.type || 'output'));
      });
    });

    return imageUrls;
  };

  const handleGenerate = async (clear = true) => {
    if (!workflowData) return;
    if(clear) {
        setIsLoading(true);
        setPreviewImages([]); // Clear previous images
        setStatusText('Queuing prompt...');
    }

    try {
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
                if (['CozyGenFloatInput', 'CozyGenIntInput', 'CozyGenStringInput', 'CozyGenDynamicInput'].includes(dynamicNode.class_type)) {
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
                    for (let index = 0; index < 5; index += 1) {
                        const loraValue = loraValues[index] || {};
                        const lora = loraValue.lora ?? "None";
                        const strength = loraValue.strength ?? 0;
                        if(lora !== "None" && strength !== 0) {
                            metaTextLines.push(`${dynamicNode.inputs.param_name} ${index + 1} = ${lora}:${Number(strength).toFixed(2)}`)
                        }
                        nodeToUpdate.inputs[`lora_${index}`] = lora;
                        nodeToUpdate.inputs[`strength_${index}`] = strength;
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
        }

        const queueResponse = await queuePrompt({ prompt: finalWorkflow });
        const promptId = queueResponse?.prompt_id;
        if (promptId) {
          localStorage.setItem('lastPromptId', promptId);
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

  const handleResumeSession = async () => {
    const lastPromptId = localStorage.getItem('lastPromptId');
    if (!lastPromptId) {
      alert('No previous session found to resume.');
      return;
    }

    setStatusText('Checking queue...');

    try {
      let queueData = null;
      let queueFetchSucceeded = false;
      try {
        queueData = await getQueue();
        queueFetchSucceeded = true;
      } catch (error) {
        console.warn('CozyGen: failed to read queue, checking history instead.', error);
      }

      const queueRunning = Array.isArray(queueData?.queue_running) ? queueData.queue_running : [];
      const queuePending = Array.isArray(queueData?.queue_pending) ? queueData.queue_pending : [];
      const allQueueItems = queueData && Array.isArray(queueData) ? queueData : [...queueRunning, ...queuePending];
      const activePromptIds = new Set(allQueueItems.map(extractPromptId).filter(Boolean));

      if (activePromptIds.has(lastPromptId)) {
        setIsLoading(true);
        setStatusText('Resuming prompt...');
        if (!websocketRef.current || websocketRef.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
        return;
      }

      const shouldCheckHistory = !queueFetchSucceeded || activePromptIds.size === 0;
      if (shouldCheckHistory) {
        const historyData = await getHistory(lastPromptId);
        const historyEntry = historyData?.[lastPromptId] || historyData?.history?.[lastPromptId];

        if (!historyEntry) {
          alert('Previous session has expired or is no longer available.');
          localStorage.removeItem('lastPromptId');
          return;
        }

        const imageUrls = extractHistoryImages(historyEntry);
        if (imageUrls.length === 0) {
          alert('Previous session completed, but no images were found.');
          localStorage.removeItem('lastPromptId');
          return;
        }

        setPreviewImages(imageUrls);
        localStorage.setItem('lastPreviewImages', JSON.stringify(imageUrls));
        setIsLoading(false);
        setProgressValue(0);
        setProgressMax(0);
        setStatusText('Finished');
        return;
      }

      setIsLoading(true);
      setStatusText('Resuming prompt...');
      if (!websocketRef.current || websocketRef.current.readyState === WebSocket.CLOSED) {
        connectWebSocket();
      }
    } catch (error) {
      console.error('Failed to resume session:', error);
      alert('Unable to resume the previous session. Please try again.');
    }
  };

  const handleClearPreview = () => {
    setPreviewImages([]);
    localStorage.removeItem('lastPreviewImages');
  };

  const hasImageInput = dynamicInputs.some(input => input.class_type === 'CozyGenImageInput');

  return (
    <div className="max-w-7xl mx-auto">
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
                <button
                  onClick={handleResumeSession}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-base-300 text-white rounded-lg hover:bg-base-300/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Resume Session
                </button>

                {/* Render ImageInput separately */}
                {dynamicInputs.filter(input => input.class_type === 'CozyGenImageInput').map(input => (
                    <ImageInput
                        key={input.id}
                        input={input}
                        value={formData[input.inputs.param_name]}
                        onFormChange={handleFormChange}
                        onBypassToggle={handleBypassToggle}
                        disabled={bypassedState[input.inputs.param_name] || false}
                    />
                ))}
                
                {/* New, Corrected Rendering Logic */}
                <DynamicForm
                    inputs={dynamicInputs
                        .filter(input => input.class_type !== 'CozyGenImageInput')
                        .map(input => {
                            // Map new static node properties to the format DynamicForm expects
                            if (['CozyGenFloatInput', 'CozyGenIntInput', 'CozyGenStringInput', 'CozyGenChoiceInput', 'CozyGenLoraInput', 'CozyGenLoraInputMulti', 'CozyGenWanVideoModelSelector', 'CozyGenBoolInput'].includes(input.class_type)) {
                                let param_type = input.class_type.replace('CozyGen', '').replace('Input', '').toUpperCase();
                                if (param_type === 'CHOICE') {
                                    param_type = 'DROPDOWN'; // Map Choice to Dropdown
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
                                        // Conform to the expected 'Multiline' prop
                                        Multiline: input.inputs.display_multiline || false, 
                                    }
                                };
                            }
                            return input; // Return original CozyGenDynamicInput as is
                        })
                    }
                    formData={formData}
                    onFormChange={handleFormChange}
                    randomizeState={randomizeState}
                    onRandomizeToggle={handleRandomizeToggle}
                    bypassedState={bypassedState}
                    onBypassToggle={handleBypassToggle}
                />

                
            </div>
        </div>

        {/* Sticky Generate Button Footer */}
        <div className="fixed bottom-0 left-0 right-0 bg-base-100/80 backdrop-blur-sm p-4 border-t border-base-300 z-10 shadow-lg">
            <div className="max-w-2xl mx-auto"> {/* Centered and max-width */}
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
    </div>
  );
}
export default App;
