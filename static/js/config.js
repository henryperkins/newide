import { showNotification } from './ui/notificationManager.js';
import { eventBus } from './utils/helpers.js';
import { modelManager } from './models.js';
import { generateDefaultModelConfig } from './utils/modelUtils.js';

const DEFAULT_CONFIG = {
  reasoningEffort: "medium",
  includeFiles: false,
  selectedModel: "o1",
  deploymentName: "o1",
  azureOpenAI: {
    apiKey: "",
    endpoint: "https://o1models.openai.azure.com",
    deploymentName: "o1",
    apiVersion: "2025-01-01-preview"
  },
  appSettings: {
    maxTokenLimit: 4096,
    responseTimeout: 30000,
    streamingEnabled: false,
    fontSize: 'text-base',
    enableTelemetry: true
  }
};

let cachedConfig = null;
let lastFetchTime = 0;
const CONFIG_CACHE_TIME = 5 * 60 * 1000;

const REASONING_EFFORT = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  SLIDER: { LOW: 1, MEDIUM: 2, HIGH: 3 },
  fromSlider(value) {
    switch (parseInt(value, 10)) {
      case 1: return this.LOW;
      case 3: return this.HIGH;
      default: return this.MEDIUM;
    }
  },
  toSlider(effort) {
    switch (effort?.toLowerCase()) {
      case this.LOW: return this.SLIDER.LOW;
      case this.HIGH: return this.SLIDER.HIGH;
      default: return this.SLIDER.MEDIUM;
    }
  }
});

export async function getCurrentConfig() {
  const now = Date.now();
  if (cachedConfig && now - lastFetchTime < CONFIG_CACHE_TIME) {
    return cachedConfig;
  }
  try {
    const response = await fetch(`${window.location.origin}/api/config`);
    if (!response.ok) throw new Error(`Failed to load config: ${response.status}`);
    const config = await response.json();
    cachedConfig = config;
    lastFetchTime = now;
    return config;
  } catch (error) {
    console.error('Error loading config:', error);
    const localConfig = loadConfigFromLocalStorage();
    if (localConfig) return localConfig;
    return { ...DEFAULT_CONFIG };
  }
}


import { globalStore } from './store.js';

function loadConfigFromLocalStorage() {
  try {
    // Merge with defaults but pull from globalStore
    const config = { ...DEFAULT_CONFIG };
    config.reasoningEffort = globalStore.reasoningEffort || config.reasoningEffort;
    config.selectedModel = globalStore.selectedModel || config.selectedModel;
    config.appSettings = { ...config.appSettings };
    config.appSettings.streamingEnabled = globalStore.streamingEnabled;
    config.appSettings.fontSize = globalStore.fontSize;
    return config;
  } catch (error) {
    console.error('Error loading config from globalStore:', error);
    return null;
  }
}

function saveConfigToLocalStorage(config) {
  if (!config) return;
  try {
    // Push relevant fields to globalStore
    if (config.reasoningEffort !== undefined) {
      globalStore.reasoningEffort = config.reasoningEffort;
    }
    if (config.selectedModel !== undefined) {
      globalStore.selectedModel = config.selectedModel;
    }
    if (config.appSettings) {
      if (typeof config.appSettings.streamingEnabled !== 'undefined') {
        globalStore.streamingEnabled = !!config.appSettings.streamingEnabled;
      }
      if (config.appSettings.fontSize) {
        globalStore.fontSize = config.appSettings.fontSize;
      }
    }
  } catch (error) {
    console.error('Error saving config to globalStore:', error);
  }
}

function initConfigUI(config) {
  if (!config.reasoningEffort) {
    config.reasoningEffort = "medium";
  }
  const reasoningSlider = document.getElementById('reasoning-effort-slider');
  const reasoningDisplay = document.getElementById('reasoning-effort-display');
  const reasoningDescription = document.getElementById('effort-description-text');
  if (reasoningSlider) {
    reasoningSlider.value = REASONING_EFFORT.toSlider(config.reasoningEffort);
    if (reasoningDisplay) {
      reasoningDisplay.textContent = config.reasoningEffort[0].toUpperCase() + config.reasoningEffort.slice(1);
    }
    if (reasoningDescription) {
      updateReasoningDescription(config.reasoningEffort, reasoningDescription);
    }
  }
  const streamingToggle = document.getElementById('enable-streaming');
  if (streamingToggle) streamingToggle.checked = config.appSettings?.streamingEnabled || false;
  updateModelSelectUI(config.selectedModel);
}

function handleReasoningSliderChange(e) {
  const value = parseInt(e.target.value, 10);
  const effortLevel = REASONING_EFFORT.fromSlider(value);
  const effortDisplay = document.getElementById('reasoning-effort-display');
  if (effortDisplay) {
    effortDisplay.textContent = effortLevel[0].toUpperCase() + effortLevel.slice(1);
  }
  const effortDescription = document.getElementById('effort-description-text');
  if (effortDescription) {
    updateReasoningDescription(effortLevel, effortDescription);
  }
  updateConfig({ reasoningEffort: effortLevel });
}

function updateReasoningDescription(effortLevel, descriptionElement) {
  let text = '';
  switch (effortLevel.toLowerCase()) {
    case REASONING_EFFORT.LOW:
      text = 'Low: Faster responses (30-60s) with less depth';
      break;
    case REASONING_EFFORT.HIGH:
      text = 'High: Thorough processing (4-7min) for complex problems';
      break;
    default:
      text = 'Medium: Balanced processing time (1-3min) and quality';
  }
  descriptionElement.textContent = text;
}

function handleStreamingToggleChange(e) {
  updateConfig({
    appSettings: { ...cachedConfig.appSettings, streamingEnabled: e.target.checked }
  });
}

async function handleModelSelectChange(e) {
  const modelId = e.target.value;
  try {
    console.log("Handling model select change to:", modelId);

    // Check if the model config exists in modelManager before switching
    if (!modelManager.modelConfigs[modelId]) {
      console.log(`Model ${modelId} not in modelManager configs, forcing re-initialization`);
      // Force a re-initialization of local model configs
      modelManager.ensureLocalModelConfigs();

      // Log available models after re-initialization
      console.log("Available models after re-initialization:", Object.keys(modelManager.modelConfigs));

      // If still not available, show error
      if (!modelManager.modelConfigs[modelId]) {
        console.error(`Model ${modelId} still not available after re-initialization`);
        showNotification(`Cannot switch to ${modelId} - model configuration not available`, 'error');
        e.target.value = cachedConfig.selectedModel || 'DeepSeek-R1';
        return;
      }
    }

    const success = await modelManager.switchModel(modelId);
    if (success) {
      updateConfig({ selectedModel: modelId });
      updateModelSpecificUI(modelId);
    } else {
      console.warn(`Switch model returned failure for ${modelId}`);
      e.target.value = cachedConfig.selectedModel || 'DeepSeek-R1';
      showNotification('Failed to switch model', 'error');
    }
  } catch (error) {
    console.error('Error switching model:', error);
    showNotification('Error switching model', 'error');
    e.target.value = cachedConfig.selectedModel || 'DeepSeek-R1';
  }
}

export async function updateModelSpecificUI(modelName) {
  try {
    const modelConfig = modelManager.modelConfigs[modelName] || await modelManager.getModelConfig(modelName);
    if (!modelConfig) return;

    // Determine model type
    const modelType = modelConfig.model_type || 'standard';
    const isOSeries = modelType === 'o-series' || modelName.toLowerCase().startsWith('o1') || modelName.toLowerCase().startsWith('o3');
    const isDeepSeek = modelType === 'deepseek' || modelName.toLowerCase().includes('deepseek');

    // Get capabilities
    const supportsStreaming = modelConfig.supports_streaming || false;
    const supportsVision = modelConfig.supports_vision || false;
    const apiVersion = modelConfig.api_version || '2025-01-01-preview';

    // Update reasoning controls visibility
    const reasoningControls = document.getElementById('reasoning-controls');
    if (reasoningControls) {
      reasoningControls.classList.toggle('hidden', !isOSeries || isDeepSeek);
    }

    // Update thinking controls visibility (for DeepSeek models)
    const thinkingControls = document.getElementById('thinking-controls');
    if (thinkingControls) {
      thinkingControls.classList.toggle('hidden', !isDeepSeek);
    }

    // Update streaming toggle
    const streamingToggle = document.getElementById('enable-streaming');
    if (streamingToggle) {
      streamingToggle.disabled = !supportsStreaming;
      const streamingLabel = streamingToggle.parentElement?.querySelector('label');
      if (streamingLabel) {
        streamingLabel.classList.toggle('text-dark-400', !supportsStreaming);
      }
      if (!supportsStreaming && streamingToggle.checked) {
        streamingToggle.checked = false;
        updateConfig({ appSettings: { ...cachedConfig.appSettings, streamingEnabled: false } });
      }
    }

    // Update model info display
    const modelInfoSection = document.querySelector('.model-info');
    if (modelInfoSection) {
      const features = [];
      if (isOSeries) features.push('advanced reasoning');
      if (isDeepSeek) features.push('thinking process');
      if (supportsStreaming) features.push('streaming');
      if (supportsVision) features.push('vision');

      const featuresText = features.length > 0 ? `with ${features.join(' & ')}` : '';
      const apiVersionText = `<span class="text-xs text-gray-500">(API: ${apiVersion})</span>`;

      modelInfoSection.innerHTML = `
        <p><strong>Model:</strong> ${modelName} ${featuresText}</p>
        <p class="text-xs text-gray-500">Type: ${modelType} ${apiVersionText}</p>
      `;
    }

    // Update model badge
    const modelBadge = document.getElementById('model-badge');
    if (modelBadge) {
      modelBadge.textContent = modelName;
    }

    // Publish event for other components
    eventBus.publish('modelUpdated', {
      modelName,
      modelType,
      apiVersion,
      capabilities: {
        isOSeries,
        isDeepSeek,
        supportsStreaming,
        supportsVision,
        apiVersion
      }
    });
  } catch (error) {
    console.error('Error updating model-specific UI:', error);
  }
}

function updateModelSelectUI(selectedModel) {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect) return;
  if (!modelManager.modelConfigs) {
    console.warn("No model configs found");
    return;
  }
  const models = Object.keys(modelManager.modelConfigs);
  if (!models.length) return;
  modelSelect.innerHTML = '';
  models.forEach(modelId => {
    const model = modelManager.modelConfigs[modelId];
    const option = document.createElement('option');
    option.value = modelId;
    option.textContent = model.description ? `${modelId} (${model.description})` : modelId;
    option.selected = modelId === selectedModel;
    modelSelect.appendChild(option);
  });
}

export async function updateConfig(updates) {
  if (!updates || typeof updates !== 'object') return false;
  try {
    cachedConfig = { ...cachedConfig, ...updates };
    if (updates.appSettings) {
      cachedConfig.appSettings = { ...cachedConfig.appSettings, ...updates.appSettings };
    }
    saveConfigToLocalStorage(cachedConfig);
    await saveConfigToServer(updates);
    eventBus.publish('configUpdated', { config: cachedConfig, updates });
    return true;
  } catch (error) {
    console.error('Failed to update config:', error);
    return false;
  }
}

async function saveConfigToServer(updates) {
  const serverUpdates = {};
  if (updates.reasoningEffort) serverUpdates.reasoningEffort = updates.reasoningEffort;
  if (updates.selectedModel) serverUpdates.selectedModel = updates.selectedModel;
  if (updates.includeFiles !== undefined) serverUpdates.includeFiles = updates.includeFiles;
  if (!Object.keys(serverUpdates).length) return;

  const promises = Object.entries(serverUpdates).map(async ([key, value]) => {
    try {
      let formattedValue = value;
      if (key === 'reasoningEffort') formattedValue = String(value).toLowerCase();
      else if (key === 'includeFiles') formattedValue = Boolean(value);
      else if (key === 'selectedModel') formattedValue = String(value);
      const response = await fetch(`${window.location.origin}/api/config/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: formattedValue, description: '', is_secret: false })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to update config');
      }
      return true;
    } catch (error) {
      console.error(`Failed to update config key: ${key}`, error);
      return false;
    }
  });
  return Promise.all(promises);
}

export async function getModelSettings() {
  try {
    const current = await getCurrentConfig();
    return {
      name: current.selectedModel,
      api_version: current.azureOpenAI?.apiVersion,
      capabilities: {
        requires_reasoning_effort: true,
        supports_streaming: current.supportsStreaming,
        supports_vision: current.supportsVision,
        max_completion_tokens: current.maxCompletionTokens,
        fixed_temperature: current.fixedTemperature
      }
    };
  } catch (error) {
    console.error('Failed to get model settings:', error);
    return {
      name: "o1",
      api_version: "2025-01-01-preview",
      capabilities: {
        requires_reasoning_effort: true,
        supports_streaming: false,
        supports_vision: false,
        max_completion_tokens: 4096,
        fixed_temperature: 0.7
      }
    };
  }
}

export function isFeatureEnabled(featureName) {
  if (!cachedConfig) return false;
  const modelName = cachedConfig.selectedModel;
  const model = modelManager.modelConfigs[modelName];

  switch (featureName) {
    case 'streaming':
      return cachedConfig.appSettings?.streamingEnabled &&
        model?.supports_streaming;
    case 'reasoning':
      return model?.requires_reasoning_effort ||
        model?.model_type === 'o-series' ||
        modelName?.toLowerCase().startsWith('o1') ||
        modelName?.toLowerCase().startsWith('o3');
    case 'vision':
      return model?.supports_vision;
    case 'thinking':
      return model?.model_type === 'deepseek' ||
        model?.enable_thinking;
    default:
      return false;
  }
}

export function getReasoningEffort() {
  return cachedConfig?.reasoningEffort || REASONING_EFFORT.MEDIUM;
}

export async function getModelAPIConfig(modelName) {
  const config = await getCurrentConfig();
  let modelConfig = null;

  try {
    // First check if the model is already in modelManager
    if (modelManager.modelConfigs[modelName]) {
      modelConfig = modelManager.modelConfigs[modelName];
    } else {
      // If not, try to fetch from server
      const resp = await fetch(`${window.location.origin}/api/config/models/${encodeURIComponent(modelName)}`);
      if (resp.ok) {
        modelConfig = await resp.json();
      }
    }
  } catch (error) {
    console.error('Error fetching model config:', error);
  }

  // Map the model config to API config format
  if (modelConfig) {
    return {
      endpoint: modelConfig.azure_endpoint || config.azureOpenAI?.endpoint,
      apiVersion: modelConfig.api_version || config.azureOpenAI?.apiVersion,
      deploymentName: modelName,
      maxTokens: modelConfig.max_tokens || config.maxTokenLimit || 4096,
      maxCompletionTokens: modelConfig.max_completion_tokens || config.maxCompletionTokens || 4096,
      supportsStreaming: modelConfig.supports_streaming || false,
      supportsTemperature: modelConfig.supports_temperature || false,
      supportsVision: modelConfig.supports_vision || false,
      requiresReasoningEffort: modelConfig.requires_reasoning_effort || false
    };
  }

  // Return default config if no model config found
  return {
    endpoint: config.azureOpenAI?.endpoint || "https://o1models.openai.azure.com",
    apiVersion: config.azureOpenAI?.apiVersion || "2025-01-01-preview",
    deploymentName: modelName,
    maxTokens: config.maxTokenLimit || 4096,
    maxCompletionTokens: config.maxCompletionTokens || 4096,
    supportsStreaming: false,
    supportsTemperature: false,
    supportsVision: false,
    requiresReasoningEffort: modelName.toLowerCase().startsWith('o')
  };
}

export function setupConfigEventHandlers() {
  const reasoningSlider = document.getElementById('reasoning-effort-slider');
  if (reasoningSlider) reasoningSlider.addEventListener('input', handleReasoningSliderChange);

  const streamingToggle = document.getElementById('enable-streaming');
  if (streamingToggle) streamingToggle.addEventListener('change', handleStreamingToggleChange);

  const modelSelect = document.getElementById('model-select');
  if (modelSelect) modelSelect.addEventListener('change', handleModelSelectChange);

  // Get the current configuration and initialize the UI
  getCurrentConfig().then(config => {
    if (config) {
      initConfigUI(config);
    }
  });

  console.log('Config event handlers initialized');
}

export {
  REASONING_EFFORT,
  DEFAULT_CONFIG
};
