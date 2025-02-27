import { modelManager } from './models.js';
import { showNotification } from './ui/notificationManager.js';
import { eventBus } from './utils/helpers.js';

const DEFAULT_CONFIG = {
  reasoningEffort: "medium",
  developerConfig: "Formatting re-enabled - use markdown code blocks",
  includeFiles: false,
  selectedModel: "o1hp",
  deploymentName: "o1hp",
  azureOpenAI: {
    apiKey: "",
    endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
    deploymentName: "o1hp",
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

export async function initializeConfig() {
  try {
    const config = await getCurrentConfig();
    cachedConfig = config;
    initConfigUI(config);
    setupConfigEventHandlers();
    eventBus.publish('configLoaded', { config });
    return config;
  } catch (error) {
    console.error('Failed to initialize configuration:', error);
    cachedConfig = loadConfigFromLocalStorage() || { ...DEFAULT_CONFIG };
    return cachedConfig;
  }
}

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

function loadConfigFromLocalStorage() {
  try {
    const config = { ...DEFAULT_CONFIG };
    config.reasoningEffort = localStorage.getItem('reasoningEffort') || config.reasoningEffort;
    config.developerConfig = localStorage.getItem('developerConfig') || config.developerConfig;
    config.selectedModel = localStorage.getItem('selectedModel') || config.selectedModel;
    config.appSettings = { ...config.appSettings };
    config.appSettings.streamingEnabled = localStorage.getItem('streamingEnabled') === 'true';
    config.appSettings.fontSize = localStorage.getItem('fontSize') || config.appSettings.fontSize;
    return config;
  } catch (error) {
    console.error('Error loading config from localStorage:', error);
    return null;
  }
}

function saveConfigToLocalStorage(config) {
  if (!config) return;
  try {
    localStorage.setItem('reasoningEffort', config.reasoningEffort || DEFAULT_CONFIG.reasoningEffort);
    localStorage.setItem('developerConfig', config.developerConfig || DEFAULT_CONFIG.developerConfig);
    localStorage.setItem('selectedModel', config.selectedModel || DEFAULT_CONFIG.selectedModel);
    if (config.appSettings) {
      localStorage.setItem('streamingEnabled', config.appSettings.streamingEnabled ? 'true' : 'false');
      if (config.appSettings.fontSize) localStorage.setItem('fontSize', config.appSettings.fontSize);
    }
  } catch (error) {
    console.error('Error saving config to localStorage:', error);
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
  const developerConfigInput = document.getElementById('developer-config');
  if (developerConfigInput) developerConfigInput.value = config.developerConfig || '';
  const streamingToggle = document.getElementById('enable-streaming');
  if (streamingToggle) streamingToggle.checked = config.appSettings?.streamingEnabled || false;
  updateModelSelectUI(config.selectedModel);
}

function setupConfigEventHandlers() {
  const reasoningSlider = document.getElementById('reasoning-effort-slider');
  if (reasoningSlider) reasoningSlider.addEventListener('input', handleReasoningSliderChange);
  const developerConfigInput = document.getElementById('developer-config');
  if (developerConfigInput) developerConfigInput.addEventListener('change', handleDeveloperConfigChange);
  const streamingToggle = document.getElementById('enable-streaming');
  if (streamingToggle) streamingToggle.addEventListener('change', handleStreamingToggleChange);
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) modelSelect.addEventListener('change', handleModelSelectChange);
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

function handleDeveloperConfigChange(e) {
  updateConfig({ developerConfig: e.target.value });
}

function handleStreamingToggleChange(e) {
  updateConfig({
    appSettings: { ...cachedConfig.appSettings, streamingEnabled: e.target.checked }
  });
}

async function handleModelSelectChange(e) {
  const modelId = e.target.value;
  try {
    const success = await modelManager.switchModel(modelId);
    if (success) {
      updateConfig({ selectedModel: modelId });
      updateModelSpecificUI(modelId);
    } else {
      e.target.value = cachedConfig.selectedModel;
      showNotification('Failed to switch model', 'error');
    }
  } catch (error) {
    console.error('Error switching model:', error);
    showNotification('Error switching model', 'error');
    e.target.value = cachedConfig.selectedModel;
  }
}

export async function updateModelSpecificUI(modelName) {
  try {
    const modelConfig = modelManager.modelConfigs[modelName] || await modelManager.getModelConfig(modelName);
    if (!modelConfig) return;
    const isOSeries = modelName.toLowerCase().startsWith('o1') || modelName.toLowerCase().startsWith('o3');
    const supportsStreaming = modelConfig.supports_streaming || false;
    const supportsVision = modelConfig.supports_vision || false;
    const reasoningControls = document.getElementById('reasoning-controls');
    if (reasoningControls) {
      reasoningControls.classList.toggle('hidden', !isOSeries);
    }
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
    const modelInfoSection = document.querySelector('.model-info');
    if (modelInfoSection) {
      const features = [];
      if (isOSeries) features.push('advanced reasoning');
      if (supportsStreaming) features.push('streaming');
      if (supportsVision) features.push('vision');
      const featuresText = features.length > 0 ? `with ${features.join(' & ')}` : '';
      modelInfoSection.innerHTML = `<p><strong>Model:</strong> ${modelName} ${featuresText}</p>`;
    }
    const modelBadge = document.getElementById('model-badge');
    if (modelBadge) {
      modelBadge.textContent = modelName;
    }
    eventBus.publish('modelUpdated', {
      modelName,
      capabilities: { isOSeries, supportsStreaming, supportsVision }
    });
  } catch (error) {
    console.error('Error updating model-specific UI:', error);
  }
}

function updateModelSelectUI(selectedModel) {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect) return;
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
  if (updates.developerConfig) serverUpdates.developerConfig = updates.developerConfig;
  if (updates.selectedModel) serverUpdates.selectedModel = updates.selectedModel;
  if (updates.includeFiles !== undefined) serverUpdates.includeFiles = updates.includeFiles;
  if (!Object.keys(serverUpdates).length) return;

  const promises = Object.entries(serverUpdates).map(async ([key, value]) => {
    try {
      let formattedValue = value;
      if (key === 'reasoningEffort') formattedValue = String(value).toLowerCase();
      else if (key === 'includeFiles') formattedValue = Boolean(value);
      else if (key === 'selectedModel' || key === 'developerConfig') formattedValue = String(value);
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
      name: "o1hp",
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
  switch (featureName) {
    case 'streaming':
      return cachedConfig.appSettings?.streamingEnabled
             && isModelStreamingSupported(cachedConfig.selectedModel);
    case 'reasoning':
      return cachedConfig.selectedModel?.toLowerCase().startsWith('o1')
             || cachedConfig.selectedModel?.toLowerCase().startsWith('o3');
    default:
      return false;
  }
}

function isModelStreamingSupported(modelName) {
  const model = modelManager.modelConfigs[modelName];
  return model ? !!model.supports_streaming : false;
}

export function getReasoningEffort() {
  return cachedConfig?.reasoningEffort || REASONING_EFFORT.MEDIUM;
}

export function getDeveloperConfig() {
  return cachedConfig?.developerConfig || DEFAULT_CONFIG.developerConfig;
}

export async function getModelAPIConfig(modelName) {
  const config = await getCurrentConfig();
  const modelConfig = modelManager.modelConfigs[modelName];
  if (modelConfig) {
    return {
      endpoint: modelConfig.azure_endpoint || config.azureOpenAI?.endpoint,
      apiVersion: modelConfig.api_version || config.azureOpenAI?.apiVersion,
      deploymentName: modelName,
      maxTokens: modelConfig.max_tokens || config.maxTokenLimit,
      maxCompletionTokens: modelConfig.max_completion_tokens || config.maxCompletionTokens
    };
  }
  return {
    endpoint: config.azureOpenAI?.endpoint,
    apiVersion: config.azureOpenAI?.apiVersion,
    deploymentName: modelName,
    maxTokens: config.maxTokenLimit || 4096,
    maxCompletionTokens: config.maxCompletionTokens || 4096
  };
}

export {
  REASONING_EFFORT,
  DEFAULT_CONFIG
};
