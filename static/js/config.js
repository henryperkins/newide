/* static/js/config.js */

/**
 * Fallback configuration used if the server config call fails or returns invalid data.
 * This fallback points to an o1 model and does not send disallowed params like temperature.
 */
const fallbackConfig = {
  reasoningEffort: "medium",
  developerConfig: "Formatting re-enabled - use markdown code blocks",
  includeFiles: false,
  selectedModel: "o1model-east2", 
  deploymentName: "o1model-east2",
  azureOpenAI: {
    apiKey: "",  // Will be populated from server response
    endpoint: "https://api.openai.azure.com",
    deploymentName: "o1hp",
    apiVersion: "2025-01-01-preview"
  }
};

/**
 * Caches the fetched configuration for 5 minutes (300,000 ms).
 */
let cachedConfig = null;
let lastFetchTime = 0;

/**
 * Configuration constants for reasoning effort UI elements
 * @typedef {Object} ReasoningEffortConfig
 * @property {string} SLIDER_ID - Slider element ID
 * @property {string} DISPLAY_ID - Display element ID
 * @property {Object<string, number>} LEVEL_VALUES - Mappings from effort level to numeric slider value
 */
const REASONING_EFFORT_CONFIG = Object.freeze({
  SLIDER_ID: 'reasoning-effort-slider',
  DISPLAY_ID: 'reasoning-effort-display',
  LEVEL_VALUES: Object.freeze({
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  })
});

/**
 * Safely fetch a DOM element by ID with logging if missing
 */
function getValidatedElement(elementId) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.warn(`UI Element not found: ${elementId}`);
    return null;
  }
  return element;
}

/**
 * Initialize configuration-dependent UI elements and handle tab switching
 */
export async function initializeConfig() {
  try {
    const appConfig = await getCurrentConfig();
    updateReasoningEffortDisplay();
    await updateModelSpecificUI(appConfig.selectedModel);
  } catch (error) {
    console.error('Failed to initialize UI elements:', error);
  }

  // Basic tab switching for config vs. files
  const configTab = document.getElementById('config-tab');
  const filesTab = document.getElementById('files-tab');
  const configContent = document.getElementById('config-content');
  const filesContent = document.getElementById('files-content');

  if (configTab && filesTab && configContent && filesContent) {
    function switchTab(selectedTab, selectedContent) {
      // Update tab buttons
      [configTab, filesTab].forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
      });
      selectedTab.classList.add('active');
      selectedTab.setAttribute('aria-selected', 'true');
      selectedTab.setAttribute('tabindex', '0');

      // Update tab content
      [configContent, filesContent].forEach(cont => {
        cont.classList.remove('active');
        cont.setAttribute('aria-hidden', 'true');
      });
      selectedContent.classList.add('active');
      selectedContent.setAttribute('aria-hidden', 'false');
    }

    // Default active tab
    configTab.classList.add('active');
    configContent.classList.add('active');

    // Event listeners
    configTab.addEventListener('click', () => switchTab(configTab, configContent));
    filesTab.addEventListener('click', () => switchTab(filesTab, filesContent));
  }
}

/**
 * Retrieve current app config from /api/config, cached for 5 minutes
 */
export async function getCurrentConfig() {
  try {
    // Only fetch from server if cache is stale (> 5 min)
    if (!cachedConfig || Date.now() - lastFetchTime > 300000) {
      console.debug('Fetching config from /api/config/');
      let response;
      let responseData;
      const timeoutDuration = 5000; // 5 seconds
      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

          response = await fetch('/api/config/', { signal: controller.signal });
          clearTimeout(timeoutId);

          console.debug(`Config response status: ${response.status}`);

          if (response.status >= 500) {
            // 5xx server errors
            console.warn(`Server error (${response.status}), using fallback config`);
            throw new Error("Server error: Unable to fetch config");
          }
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          responseData = await response.json();

          // Validate existence of key fields
          if (!responseData.selectedModel || !responseData.reasoningEffort || !responseData.deploymentName) {
            throw new Error('Invalid config structure: missing required fields');
          }
          break;

        } catch (error) {
          if (attempt === maxRetries) throw error;
          console.warn(`Config fetch failed (attempt ${attempt}), retrying...`, error);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
      console.debug('Received config:', responseData);

      // Merge server config with fallback
      cachedConfig = { ...fallbackConfig, ...responseData };
      lastFetchTime = Date.now();
    }
    return cachedConfig;
  } catch (error) {
    console.error('Using fallback config. Error details:', error);
    return fallbackConfig;
  }
}

/**
 * Update a single config key, or bulk updates if an object is passed
 */
export async function updateConfig(key, value) {
  // Handle bulk updates if an object is passed
  if (typeof key === 'object' && key !== null) {
    const updates = key;
    let allSuccess = true;
    for (const [k, v] of Object.entries(updates)) {
      if (typeof k !== 'string' || !k.trim()) {
        console.error('updateConfig: Invalid config key in bulk update:', k);
        allSuccess = false;
        continue;
      }
      try {
        const response = await fetch(`/api/config/${k}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: v })
        });
        if (!response.ok) allSuccess = false;
      } catch (error) {
        console.error('Failed to update config key:', k, error);
        allSuccess = false;
      }
    }
    return allSuccess;
  }

  // Original single key update logic
  if (typeof key !== 'string' || !key.trim() || key === "[object Object]") {
    console.error('updateConfig: Invalid config key:', key);
    return false;
  }
  try {
    const response = await fetch(`/api/config/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to update config:', error);
    return false;
  }
}

/**
 * Return timeouts by reasoning level
 */
export function getTimeoutDurations() {
  return {
    low: 15000,    // 15s
    medium: 30000, // 30s
    high: 60000    // 60s
  };
}

/**
 * Retrieve model settings from the backend configuration
 */
export async function getModelSettings() {
  try {
    const current = await getCurrentConfig();
    return {
      name: current.selectedModel,
      api_version: current.azureOpenAI.apiVersion,
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
    // fallback
    return {
      name: "o1model-east2",
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

/**
 * Get safety config for current model if defined
 */
export async function getSafetyConfig() {
  const modelCfg = await getModelSettings();
  return modelCfg.safety_config || {};
}

/**
 * Get response formatting config for current model if defined
 */
export async function getResponseFormatting() {
  const modelCfg = await getModelSettings();
  return modelCfg.response_format || {};
}

/**
 * Update displayed reasoning effort based on slider
 */
export function updateReasoningEffortDisplay() {
  const slider = getValidatedElement(REASONING_EFFORT_CONFIG.SLIDER_ID);
  const effortDisplay = getValidatedElement(REASONING_EFFORT_CONFIG.DISPLAY_ID);

  if (!slider || !effortDisplay) {
    console.error('Reasoning effort UI elements missing');
    if (effortDisplay) effortDisplay.textContent = 'Medium'; // fallback
    return;
  }

  const minValue = Math.min(...Object.values(REASONING_EFFORT_CONFIG.LEVEL_VALUES));
  const maxValue = Math.max(...Object.values(REASONING_EFFORT_CONFIG.LEVEL_VALUES));
  const clampedValue = Math.max(minValue, Math.min(maxValue, parseInt(slider.value, 10)));
  if (clampedValue !== parseInt(slider.value, 10)) {
    slider.value = clampedValue;
  }

  const effortLabels = Object.keys(REASONING_EFFORT_CONFIG.LEVEL_VALUES).length > 0
    ? Object.keys(REASONING_EFFORT_CONFIG.LEVEL_VALUES)
    : ['low', 'medium', 'high'];

  const valueIndex = Math.max(
    0,
    Math.min(
      parseInt(slider.value, 10) - REASONING_EFFORT_CONFIG.LEVEL_VALUES.LOW,
      effortLabels.length - 1
    )
  );
  const selectedLabel = effortLabels[valueIndex];

  effortDisplay.textContent =
    selectedLabel.charAt(0).toUpperCase() + selectedLabel.slice(1);

  slider.setAttribute('aria-valuenow', slider.value);
  slider.setAttribute('aria-valuetext', selectedLabel);
}

/**
 * Update model-specific UI such as enabling reasoning or streaming toggles
 */
export async function updateModelSpecificUI(model) {
  const modelCfg = await getModelSettings();
  const reasoningControls = document.getElementById('reasoning-controls');
  const streamingToggle = document.getElementById('streaming-toggle');

  const requiresEffort = modelCfg.capabilities?.requires_reasoning_effort ?? true;
  if (reasoningControls) {
    reasoningControls.style.display = requiresEffort ? 'block' : 'none';
  }

  if (streamingToggle) {
    streamingToggle.disabled = !(modelCfg.capabilities?.supports_streaming ?? false);
  }

  const tempElement = document.getElementById('temperature-value');
  if (tempElement && modelCfg.capabilities?.default_temperature !== undefined) {
    tempElement.textContent = modelCfg.capabilities.default_temperature;
  }

  const maxTokensElement = document.getElementById('max-tokens');
  if (maxTokensElement && modelCfg.capabilities?.max_tokens) {
    maxTokensElement.dataset.max = modelCfg.capabilities.max_tokens;
  }
}

/**
 * Tab switching utility
 */
export function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
    content.setAttribute('aria-hidden', 'true');
  });
  document.querySelectorAll('.tab-button').forEach(button => {
    button.classList.remove('active');
    button.setAttribute('aria-selected', 'false');
  });

  const selectedContent = document.getElementById(tabId);
  const selectedTab = document.querySelector(`[data-target-tab="${tabId}"]`);

  if (selectedContent) {
    selectedContent.classList.add('active');
    selectedContent.setAttribute('aria-hidden', 'false');
  }
  if (selectedTab) {
    selectedTab.classList.add('active');
    selectedTab.setAttribute('aria-selected', 'true');
  }
}

/**
 * Safely checks model capabilities
 */
export function checkModelCapabilities(modelConfig) {
  return {
    supportsStreaming: modelConfig.capabilities?.supports_streaming ?? false,
    supportsVision: modelConfig.capabilities?.supports_vision ?? false,
    requiresReasoning: modelConfig.capabilities?.requires_reasoning_effort ?? true,
    maxTokens: modelConfig.capabilities?.max_tokens ?? 4096,
    temperature: modelConfig.capabilities?.fixed_temperature,
    isO1Series: modelConfig.name.includes('o1')
  };
}

/* --------------------------------------------------------------------------------
   Additional snippet for validating config at runtime & version checks
   -------------------------------------------------------------------------------- */
export const config = {
  azureOpenAI: {
    apiKey: "",
    endpoint: "https://api.openai.azure.com",
    deploymentName: "o1hp", 
    apiVersion: "2025-01-01-preview"
  },
  appSettings: {
    maxTokenLimit: 4096,
    responseTimeout: 30000,
    enableTelemetry: true
  }
};

// Validate required config values
const validateConfig = () => {
  const required = [
    'azureOpenAI.apiKey',
    'azureOpenAI.endpoint',
    'azureOpenAI.deploymentName'
  ];

  required.forEach(path => {
    const value = path.split('.').reduce((obj, key) => obj?.[key], config);
    if (!value) {
      throw new Error(`Missing required configuration: ${path}`);
    }
  });

  if (config.appSettings.maxTokenLimit > 8192) {
    console.warn('High token limit may impact performance');
  }
};

try {
  validateConfig();
  console.debug('Configuration validated successfully');
} catch (error) {
  console.error('Configuration error:', error.message);
  const errorDisplay = document.getElementById('error-display');
  if (errorDisplay) {
    errorDisplay.textContent = `Configuration Error: ${error.message}`;
  }
}

// Configuration version check
export const CONFIG_VERSION = '1.0.0';
