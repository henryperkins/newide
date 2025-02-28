/**
 * Shared model-related utility functions for frontend JavaScript code.
 * This prevents duplicate code across multiple files.
 */

// Default timeout durations in milliseconds
const DEFAULT_TIMEOUTS = {
  deepseek: {
    low: 30000,    // 30s
    medium: 60000,  // 60s
    high: 120000    // 120s
  },
  oSeries: {
    low: 60000,     // 60s
    medium: 120000, // 120s
    high: 300000    // 300s (5 min)
  },
  standard: {
    low: 15000,     // 15s
    medium: 30000,  // 30s
    high: 60000     // 60s
  }
};

/**
 * Check if a model is a DeepSeek model based on its name
 * @param {string} modelName - The model name to check
 * @returns {boolean} - True if it's a DeepSeek model, false otherwise
 */
export function isDeepSeekModel(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return name.includes('deepseek') || name === 'deepseek-r1';
}

/**
 * Check if a model is an O-Series model based on its name
 * @param {string} modelName - The model name to check
 * @returns {boolean} - True if it's an O-Series model, false otherwise
 */
export function isOSeriesModel(modelName) {
  if (!modelName) return false;
  const name = modelName.toLowerCase();
  return name.startsWith('o1') || name.startsWith('o3');
}

/**
 * Get appropriate timeout duration based on model type and effort level
 * @param {string} modelName - The model name
 * @param {string} effortLevel - The reasoning effort level (low, medium, high)
 * @returns {number} - The timeout duration in milliseconds
 */
export function getTimeoutDuration(modelName, effortLevel = 'medium') {
  if (isDeepSeekModel(modelName)) {
    return DEFAULT_TIMEOUTS.deepseek[effortLevel] || DEFAULT_TIMEOUTS.deepseek.medium;
  } else if (isOSeriesModel(modelName)) {
    return DEFAULT_TIMEOUTS.oSeries[effortLevel] || DEFAULT_TIMEOUTS.oSeries.medium;
  } else {
    return DEFAULT_TIMEOUTS.standard[effortLevel] || DEFAULT_TIMEOUTS.standard.medium;
  }
}

/**
 * Get model parameters for request based on model type
 * @param {string} modelName - The model name
 * @param {Object} config - The model configuration 
 * @param {string} message - The user message
 * @param {string} developerConfig - Optional developer configuration
 * @returns {Object} - The request parameters
 */
export function getModelParameters(modelName, config, message, developerConfig) {
  const requestBody = {
    model: modelName,
    messages: [],
    session_id: window.sessionId
  };

  // Add developer/system message if present
  if (developerConfig) {
    if (isOSeriesModel(modelName)) {
      // O-Series models use "developer" role
      requestBody.messages.push({
        role: "developer",
        content: developerConfig
      });
    } else {
      // Other models use "system" role
      requestBody.messages.push({
        role: "system",
        content: developerConfig
      });
    }
  }
  
  // Add user message
  requestBody.messages.push({
    role: "user",
    content: message
  });

  // Set model-specific parameters
  if (isOSeriesModel(modelName)) {
    // O-Series specific parameters
    requestBody.reasoning_effort = config?.reasoningEffort || 'medium';
    
    // O-Series uses max_completion_tokens, not max_tokens
    if (config?.capabilities?.max_completion_tokens) {
      requestBody.max_completion_tokens = config.capabilities.max_completion_tokens;
    } else {
      requestBody.max_completion_tokens = 5000; // Default from docs
    }
    
    // O-Series doesn't use temperature
    delete requestBody.temperature;
  } else if (isDeepSeekModel(modelName)) {
    // DeepSeek models use temperature
    requestBody.temperature = 0.7; // Default temperature for DeepSeek
    
    if (config?.capabilities?.max_tokens) {
      requestBody.max_tokens = config.capabilities.max_tokens;
    } else {
      requestBody.max_tokens = 32000; // Default from docs
    }
    
    // DeepSeek doesn't use reasoning_effort
    delete requestBody.reasoning_effort;
  } else {
    // Standard model parameters
    requestBody.temperature = config?.capabilities?.fixed_temperature || 0.7;
    
    if (config?.capabilities?.max_tokens) {
      requestBody.max_tokens = config.capabilities.max_tokens;
    } else {
      requestBody.max_tokens = 4000; // Default
    }
  }

  return requestBody;
}

/**
 * Check if a model supports streaming
 * @param {string} modelName - The model name
 * @param {Object} modelConfig - The model configuration
 * @returns {boolean} - True if streaming is supported, false otherwise
 */
export function supportsStreaming(modelName, modelConfig) {
  // First check explicit configuration
  if (modelConfig?.capabilities?.supports_streaming !== undefined) {
    return modelConfig.capabilities.supports_streaming;
  }
  
  if (modelConfig?.supports_streaming !== undefined) {
    return modelConfig.supports_streaming;
  }
  
  // Fall back to model type checks
  if (isDeepSeekModel(modelName)) {
    return true; // DeepSeek models support streaming
  }
  
  if (isOSeriesModel(modelName)) {
    // Per docs, only o3-mini supports streaming in o-series
    return modelName.toLowerCase().includes('o3-mini');
  }
  
  // Default for safety
  return false;
}

/**
 * Check if a model supports temperature
 * @param {string} modelName - The model name
 * @param {Object} modelConfig - The model configuration
 * @returns {boolean} - True if temperature is supported, false otherwise
 */
export function supportsTemperature(modelName, modelConfig) {
  // First check explicit configuration
  if (modelConfig?.capabilities?.supports_temperature !== undefined) {
    return modelConfig.capabilities.supports_temperature;
  }
  
  if (modelConfig?.supports_temperature !== undefined) {
    return modelConfig.supports_temperature;
  }
  
  // Fall back to model type checks
  if (isDeepSeekModel(modelName)) {
    return true; // DeepSeek models support temperature
  }
  
  if (isOSeriesModel(modelName)) {
    return false; // O-Series models don't support temperature
  }
  
  // Default
  return true;
}

/**
 * Check if a model requires reasoning effort
 * @param {string} modelName - The model name 
 * @param {Object} modelConfig - The model configuration
 * @returns {boolean} - True if reasoning effort is required, false otherwise
 */
export function requiresReasoningEffort(modelName, modelConfig) {
  // First check explicit configuration
  if (modelConfig?.capabilities?.requires_reasoning_effort !== undefined) {
    return modelConfig.capabilities.requires_reasoning_effort;
  }
  
  if (modelConfig?.requires_reasoning_effort !== undefined) {
    return modelConfig.requires_reasoning_effort;
  }
  
  // Fall back to model type checks
  return isOSeriesModel(modelName);
}

/**
 * Gets the API endpoint URL for a model
 * @param {string} modelName - The model name
 * @returns {string} - The API endpoint URL
 */
export function getModelEndpoint(modelName) {
  return '/api/chat/';
}

// Export other helper functions as needed