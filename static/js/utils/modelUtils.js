/**
 * Utility functions for model configuration and management
 */

/**
 * Generates a default model configuration with consistent defaults
 * @param {string} modelId - The model identifier
 * @param {Object} modelApiConfig - API configuration parameters
 * @returns {Object} Default model configuration
 */
export function generateDefaultModelConfig(modelId, modelApiConfig = {}) {
  modelId = modelId.trim();
  const isOSeries = modelId.toLowerCase().startsWith('o1') || modelId.toLowerCase().startsWith('o3');
  const isDeepSeek = modelId.toLowerCase().includes('deepseek');
  // Enable thinking mode by default for DeepSeek models
  if (isDeepSeek) modelApiConfig.enable_thinking = true;

  // Base configuration that applies to all models
  const config = {
    name: modelId,
    description: isOSeries
      ? "Advanced reasoning model with high-quality outputs"
      : isDeepSeek
        ? "Model with chain-of-thought reasoning capabilities"
        : "Generic AI model",
    azure_endpoint: modelApiConfig.endpoint || "https://o1models.openai.azure.com",
    api_version: modelApiConfig.apiVersion || "2025-02-01-preview",
    max_tokens: modelApiConfig.maxTokens || 128000,
    max_completion_tokens: modelApiConfig.maxCompletionTokens || 100000,
    supports_temperature: modelApiConfig.supportsTemperature || false,
    supports_streaming: modelApiConfig.supportsStreaming || false,
    supports_vision: modelApiConfig.supportsVision || false,
    requires_reasoning_effort: modelApiConfig.requiresReasoningEffort || isOSeries,
    base_timeout: modelApiConfig.baseTimeout || (isOSeries ? 180.0 : 120.0),
    max_timeout: modelApiConfig.maxTimeout || (isOSeries ? 600.0 : 300.0),
    token_factor: modelApiConfig.tokenFactor || (isOSeries ? 0.1 : 0.05),
    model_type: isOSeries
      ? "o-series"
      : isDeepSeek
        ? "deepseek"
        : "standard"
  };

  // Add model-specific configurations
  if (isDeepSeek) {
    config.enable_thinking = true;
    config.display_reasoning_tokens = true;
  }

  if (isOSeries) {
    config.reasoning_effort = modelApiConfig.reasoningEffort || "medium";
  }

  return config;
}

/**
 * Known model configurations to ensure are available
 */
export const KNOWN_MODELS = [
  {
    id: "o1",
    modelApiConfig: {
      endpoint: "https://o1models.openai.azure.com",
      apiVersion: "2025-02-01-preview", // Match documented API version
      maxTokens: 64000,
      supportsTemperature: false,
      supportsStreaming: false,
      requiresReasoningEffort: true,
      baseTimeout: 180.0,
      maxTimeout: 600.0,
      tokenFactor: 0.1
    }
  },
  {
    id: "DeepSeek-R1",
    modelApiConfig: {
      endpoint: "https://DeepSeek-R1D2.eastus2.ai.azure.com",
      apiVersion: "2024-05-01-preview",
      maxTokens: 131072,
      temperature: 0.0,
      headers: {
        "x-ms-thinking-format": "html",
        "x-ms-streaming-version": "2024-05-01-preview"
      },
      supportsStreaming: true,
      baseTimeout: 30.0,
      readTimeout: 120.0,
    }
  }
];
