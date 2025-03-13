/* ───────── Imports ───────── */
import { showNotification } from './ui/notificationManager.js';
import { eventBus } from './utils/helpers.js';
import { modelManager } from './models.js';
import { generateDefaultModelConfig } from './utils/modelUtils.js';
import { globalStore } from './store.js';

/* ───────── Constants & Defaults ───────── */
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

/* ───────── Load & Fetch ───────── */
export async function getCurrentConfig() {
  const now = Date.now();
  if (cachedConfig && now - lastFetchTime < CONFIG_CACHE_TIME) return cachedConfig;
  try {
    const response = await fetch(`${window.location.origin}/api/config`);
    if (!response.ok) throw new Error(`Failed to load config: ${response.status}`);
    const config = await response.json();
    cachedConfig = config;
    lastFetchTime = now;
    return config;
  } catch (error) {
    const localConfig = loadConfigFromLocalStore();
    return localConfig || { ...DEFAULT_CONFIG };
  }
}

function loadConfigFromLocalStore() {
  try {
    const config = { ...DEFAULT_CONFIG };
    config.reasoningEffort = globalStore.reasoningEffort || config.reasoningEffort;
    config.selectedModel = globalStore.selectedModel || config.selectedModel;
    config.appSettings = { ...config.appSettings };
    config.appSettings.streamingEnabled = globalStore.streamingEnabled;
    config.appSettings.fontSize = globalStore.fontSize;
    return config;
  } catch {
    return null;
  }
}

function saveConfigToLocalStore(config) {
  if (!config) return;
  try {
    if (config.reasoningEffort !== undefined) globalStore.reasoningEffort = config.reasoningEffort;
    if (config.selectedModel !== undefined) globalStore.selectedModel = config.selectedModel;
    if (config.appSettings) {
      if (typeof config.appSettings.streamingEnabled !== 'undefined') {
        globalStore.streamingEnabled = !!config.appSettings.streamingEnabled;
      }
      if (config.appSettings.fontSize) {
        globalStore.fontSize = config.appSettings.fontSize;
      }
    }
  } catch { }
}

/* ───────── UI Initialization ───────── */
function initConfigUI(config) {
  if (!config.reasoningEffort) config.reasoningEffort = "medium";
  const slider = document.getElementById('reasoning-effort-slider');
  const disp = document.getElementById('reasoning-effort-display');
  const desc = document.getElementById('effort-description-text');
  if (slider) {
    slider.value = REASONING_EFFORT.toSlider(config.reasoningEffort);
    if (disp) disp.textContent = config.reasoningEffort[0].toUpperCase() + config.reasoningEffort.slice(1);
    if (desc) updateReasoningDescription(config.reasoningEffort, desc);
  }
  const streamingToggle = document.getElementById('enable-streaming');
  if (streamingToggle) streamingToggle.checked = config.appSettings?.streamingEnabled || false;
  updateModelSelectUI(config.selectedModel);
}

function handleReasoningSliderChange(e) {
  const val = parseInt(e.target.value, 10);
  const level = REASONING_EFFORT.fromSlider(val);
  const disp = document.getElementById('reasoning-effort-display');
  if (disp) disp.textContent = level[0].toUpperCase() + level.slice(1);
  const desc = document.getElementById('effort-description-text');
  if (desc) updateReasoningDescription(level, desc);
  updateConfig({ reasoningEffort: level });
}

function updateReasoningDescription(effortLevel, el) {
  let txt = '';
  switch (effortLevel.toLowerCase()) {
    case REASONING_EFFORT.LOW:
      txt = 'Low: Faster responses (30-60s) with less depth';
      break;
    case REASONING_EFFORT.HIGH:
      txt = 'High: Thorough processing (4-7min) for complex problems';
      break;
    default:
      txt = 'Medium: Balanced processing time (1-3min) and quality';
  }
  el.textContent = txt;
}

function handleStreamingToggleChange(e) {
  updateConfig({ appSettings: { ...cachedConfig.appSettings, streamingEnabled: e.target.checked } });
}

/* ───────── Model Selection ───────── */
async function handleModelSelectChange(e) {
  const modelId = e.target.value;
  if (!modelManager.modelConfigs[modelId]) {
    modelManager.ensureLocalModelConfigs();
    if (!modelManager.modelConfigs[modelId]) {
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
    e.target.value = cachedConfig.selectedModel || 'DeepSeek-R1';
    showNotification('Failed to switch model', 'error');
  }
}

export async function updateModelSpecificUI(modelName) {
  if (!modelManager.modelConfigs) return;
  try {
    const modelConfig = modelManager.modelConfigs[modelName] || await modelManager.getModelConfig(modelName);
    if (!modelConfig) return;
    const modelType = modelConfig.model_type || 'standard';
    const isOSeries = modelType === 'o-series' || modelName.toLowerCase().startsWith('o1') || modelName.toLowerCase().startsWith('o3');
    const isDeepSeek = modelType === 'deepseek' || modelName.toLowerCase().includes('deepseek');
    const supportsStreaming = modelConfig.supports_streaming || false;
    const supportsVision = modelConfig.supports_vision || false;
    const apiVersion = modelConfig.api_version || '2025-01-01-preview';
    const reasoningControls = document.getElementById('reasoning-controls');
    if (reasoningControls) reasoningControls.classList.toggle('hidden', !isOSeries || isDeepSeek);
    const thinkingControls = document.getElementById('thinking-controls');
    if (thinkingControls) thinkingControls.classList.toggle('hidden', !isDeepSeek);
    const streamingToggle = document.getElementById('enable-streaming');
    if (streamingToggle) {
      streamingToggle.disabled = !supportsStreaming;
      const label = streamingToggle.parentElement?.querySelector('label');
      if (label) label.classList.toggle('text-dark-400', !supportsStreaming);
      if (!supportsStreaming && streamingToggle.checked) {
        streamingToggle.checked = false;
        updateConfig({ appSettings: { ...cachedConfig.appSettings, streamingEnabled: false } });
      }
    }
    const modelInfo = document.querySelector('.model-info');
    if (modelInfo) {
      const feats = [];
      if (isOSeries) feats.push('advanced reasoning');
      if (isDeepSeek) feats.push('thinking process');
      if (supportsStreaming) feats.push('streaming');
      if (supportsVision) feats.push('vision');
      const featText = feats.length ? `with ${feats.join(' & ')}` : '';
      modelInfo.innerHTML = `
        <p><strong>Model:</strong> ${modelName} ${featText}</p>
        <p class="text-xs text-gray-500">Type: ${modelType} <span class="text-xs text-gray-500">(API: ${apiVersion})</span></p>
      `;
    }
    const badge = document.getElementById('model-badge');
    if (badge) badge.textContent = modelName;
    eventBus.publish('modelUpdated', {
      modelName, modelType, apiVersion,
      capabilities: { isOSeries, isDeepSeek, supportsStreaming, supportsVision, apiVersion }
    });
  } catch { }
}

function updateModelSelectUI(selectedModel) {
  const sel = document.getElementById('model-select');
  if (!sel || !modelManager.modelConfigs) return;
  const models = Object.keys(modelManager.modelConfigs);
  if (!models.length) return;
  sel.innerHTML = '';
  models.forEach(mId => {
    const m = modelManager.modelConfigs[mId];
    const option = document.createElement('option');
    option.value = mId;
    option.textContent = m.description ? `${mId} (${m.description})` : mId;
    option.selected = mId === selectedModel;
    sel.appendChild(option);
  });
}

/* ───────── Updating Config ───────── */
export async function updateConfig(updates) {
  if (!updates || typeof updates !== 'object') return false;
  try {
    cachedConfig = { ...cachedConfig, ...updates };
    if (updates.appSettings) {
      cachedConfig.appSettings = { ...cachedConfig.appSettings, ...updates.appSettings };
    }
    saveConfigToLocalStore(cachedConfig);
    await saveConfigToServer(updates);
    eventBus.publish('configUpdated', { config: cachedConfig, updates });
    return true;
  } catch {
    return false;
  }
}

async function saveConfigToServer(updates) {
  const serverUpdates = {};
  if (updates.reasoningEffort) serverUpdates.reasoningEffort = updates.reasoningEffort;
  if (updates.selectedModel) serverUpdates.selectedModel = updates.selectedModel;
  if (updates.includeFiles !== undefined) serverUpdates.includeFiles = updates.includeFiles;
  if (!Object.keys(serverUpdates).length) return;
  const promises = Object.entries(serverUpdates).map(async ([k, v]) => {
    try {
      let val = v;
      if (k === 'reasoningEffort') val = String(v).toLowerCase();
      else if (k === 'includeFiles') val = Boolean(v);
      else if (k === 'selectedModel') val = String(v);
      const r = await fetch(`${window.location.origin}/api/config/${k}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val, description: '', is_secret: false })
      });
      if (!r.ok) throw new Error('Failed to update config');
      return true;
    } catch {
      return false;
    }
  });
  return Promise.all(promises);
}

/* ───────── Model Settings & Feature Check ───────── */
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
  } catch {
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
      return cachedConfig.appSettings?.streamingEnabled && model?.supports_streaming;
    case 'reasoning':
      return model?.requires_reasoning_effort ||
        model?.model_type === 'o-series' ||
        modelName?.toLowerCase().startsWith('o1') ||
        modelName?.toLowerCase().startsWith('o3');
    case 'vision': return model?.supports_vision;
    case 'thinking':
      return model?.model_type === 'deepseek' || model?.enable_thinking;
    default: return false;
  }
}

export function getReasoningEffort() {
  return cachedConfig?.reasoningEffort || REASONING_EFFORT.MEDIUM;
}

export async function getModelAPIConfig(modelName) {
  const config = await getCurrentConfig();
  let modelConfig;
  try {
    if (modelManager.modelConfigs[modelName]) {
      modelConfig = modelManager.modelConfigs[modelName];
    } else {
      const resp = await fetch(`${window.location.origin}/api/config/models/${encodeURIComponent(modelName)}`);
      if (resp.ok) modelConfig = await resp.json();
    }
  } catch { }
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

/* ───────── User Event Handlers ───────── */
export function setupConfigEventHandlers() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) slider.addEventListener('input', handleReasoningSliderChange);
  const streaming = document.getElementById('enable-streaming');
  if (streaming) streaming.addEventListener('change', handleStreamingToggleChange);
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) modelSelect.addEventListener('change', handleModelSelectChange);
  getCurrentConfig().then(config => { if (config) initConfigUI(config); });
}

/* ───────── Exports ───────── */
export { REASONING_EFFORT, DEFAULT_CONFIG };
