// chat.js

import { initializeSession, sessionId, getLastUserMessage, setLastUserMessage } from '/static/js/session.js';
import { getCurrentConfig, getModelSettings } from '/static/js/config.js';
import { showNotification, showTypingIndicator, removeTypingIndicator, handleMessageError } from '/static/js/ui/notificationManager.js';
import { displayMessage, processServerResponseData } from '/static/js/ui/displayManager.js';
import { handleStreamingResponse } from '/static/js/streaming.js';
import StatsDisplay from '/static/js/ui/statsDisplay.js'; // If you're instantiating StatsDisplay here
import { modelManager } from './models.js';

// Example: if you want a single StatsDisplay instance for the entire app
// you might do this once. Or do so in init.js and import statsDisplay from there.
export const statsDisplay = new StatsDisplay('performance-stats');

// Listen for the global send-message event
window.addEventListener('send-message', () => {
  console.log("Global send-message event received");
  sendMessage();
});

/**
 *  Main request logic for chat:
 * - Called when user presses "Send" in UI
 * - Gathers user input, handles streaming or non-streaming requests
 * - Displays final message(s) and stats
 */
// Expose globally for direct access
window.sendMessage = sendMessage;

export async function sendMessage() {
  let userInput;
  console.log('[DEBUG] Send message function executing!');

  const streamingEl = document.getElementById('enable-streaming');
  const streamingEnabled = streamingEl ? streamingEl.checked : false;
  const sendButton = document.getElementById('send-button');

  // Cache button state to restore later
  const initialButtonText = sendButton ? sendButton.innerHTML : 'Send';
  const initialButtonDisabled = sendButton ? sendButton.disabled : false;

  try {
    userInput = document.getElementById('user-input');
    
    // If userInput isn't found, exit gracefully - DOM might not be ready
    if (!userInput) {
      console.error('[sendMessage] User input element not found');
      return;
    }
    
    const message = userInput.value.trim();
    if (!message) {
      showNotification('Message cannot be empty', 'warning');
      return;
    }

    // Disable button & show feedback - using try/catch for safety
    try {
      if (sendButton) {
        sendButton.disabled = true;
        sendButton.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Sending...';
      }
    } catch (btnErr) {
      console.warn('[sendMessage] Error updating button state:', btnErr);
    }

    // Initialize session if not done already
    if (!sessionId) {
      const initialized = await initializeSession();
      if (!initialized) {
        throw new Error('Failed to initialize session');
      }
    }

    // Disable input while request is in flight - with error handling
    try { 
      if (userInput) {
        userInput.disabled = true;
      }
    } catch (inputErr) {
      console.warn('[sendMessage] Error disabling input:', inputErr);
    }
    
    setLastUserMessage(message);

    // Display user's message in chat
    displayMessage(message, 'user');
    if (userInput) userInput.value = '';

    // Retrieve user config
    const config = await getCurrentConfig();
    const modelConfig = await getModelSettings();

    // Log model info for debugging DeepSeek issues
    logDeepSeekModelInfo(modelConfig);
    
    // Decide a typical request timeout based on "reasoningEffort" or "serverCalculatedTimeout"
    const effortLevel = config?.reasoningEffort || 'medium';
    const timeout = (await getTimeoutDurations(modelConfig))[effortLevel] || 30000;
    console.log('[Config] Current settings:', { effort: effortLevel, timeout, modelConfig });

    // Show typing indicator
    showTypingIndicator();

    // Create an AbortController with your desired timeout
    const { controller } = createAbortController(timeout);

    // Build and send request
    const response = await handleChatRequest({
      messageContent: message,
      controller,
      developerConfig: config.developerConfig,
      reasoningEffort: config.reasoningEffort,
      modelConfig
    });

    // Get model details for streaming decision
    const modelName = modelConfig?.name?.toLowerCase();
    const supportsStreaming = modelConfig?.capabilities?.supports_streaming === true || 
                              modelName?.includes('deepseek'); // DeepSeek models support streaming

    // Check if the model supports streaming and user has enabled it
    if (supportsStreaming && streamingEnabled) {
      await handleStreamingResponse(response, controller, config, statsDisplay);
    } else {
      if (streamingEnabled && !supportsStreaming) {
        console.warn(`Model ${modelName} doesn't support streaming. Using standard request.`);
      }
      
      try {
        // IMPORTANT: First clone the response to read it multiple times if needed
        const responseClone = response.clone();
        
        // Non-streaming: parse final JSON and display
        const data = await responseClone.json();
        
        if (!response.ok) {
          console.error('[sendMessage] API Error details:', data);
          if (response.status === 401 || response.status === 403) {
            showNotification('Please log in to continue.', 'warning');
          } else if (response.status === 404) {
            showNotification('The requested endpoint was not found. Check your server configuration.', 'warning');
          }
          throw new Error(
            `HTTP error! status: ${response.status}, details: ${JSON.stringify(data)}`
          );
        }

        // Possibly update stats usage if data.usage is present
        // Then handle final assistant content in displayManager
        const modelName = data.model || modelConfig?.name || 'unknown';
        processServerResponseData(data, modelName);
      } catch (parseError) {
        console.error('[sendMessage] Error parsing response:', parseError);
        showNotification('Error processing response from server', 'error');
        throw parseError;
      }
    }

  } catch (err) {
    handleMessageError(err);
  } finally {
    // Safely restore UI state
    try {
      if (sendButton) {
        sendButton.disabled = initialButtonDisabled;
        sendButton.innerHTML = initialButtonText;
      }
      removeTypingIndicator();
      if (userInput) {
        userInput.disabled = false;
        userInput.focus();
      }
    } catch (finalErr) {
      console.error('[sendMessage] Error in finally block:', finalErr);
    }
  }
}

/**
 * If user clicks "Regenerate" button, just re-send the last user message.
 */
export async function regenerateResponse() {
  const lastMessage = getLastUserMessage();
  if (lastMessage) {
    document.getElementById('user-input').value = lastMessage;
    await sendMessage();
  }
}

/**
 * Handles the chat request with optional retries on timeouts.
 */
async function handleChatRequest({ messageContent, controller, developerConfig, reasoningEffort, modelConfig }) {
  const maxRetries = 3;
  let lastError = null;

  // Get the current selected model from modelManager
  const selectedModelId = modelManager.currentModel;
  console.log(`[handleChatRequest] Using model: ${selectedModelId}`);

  // If modelManager has a selected model, ensure it's used
  if (selectedModelId && (!modelConfig || modelConfig.name !== selectedModelId)) {
    // Get the config for this model
    console.log(`[handleChatRequest] Overriding model config with selected model: ${selectedModelId}`);
    modelConfig = modelManager.modelConfigs[selectedModelId] || modelConfig;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await makeApiRequest({
        messageContent,
        controller,
        developerConfig,
        reasoningEffort,
        modelConfig
      });
      return response;
    } catch (error) {
      lastError = error;

      // Only retry on timeout/abort
      if (
        attempt < maxRetries - 1 &&
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        const delay = 60000 * (attempt + 1); // e.g. 60s, 120s
        console.warn(
          `[handleChatRequest] Attempt ${attempt + 1} failed, retrying in ${delay}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      // For other errors, do not retry
      throw error;
    }
  }
  throw lastError;
}

/**
 * Actually performs the API fetch call to Azure/OpenAI
 */
async function makeApiRequest({ messageContent, controller, developerConfig, reasoningEffort, modelConfig }) {
  const config = await getCurrentConfig();

  // Use the selected model from modelManager if available
  const currentModelId = modelManager.currentModel;
  
  // For debugging
  console.log('[makeApiRequest] Current model from modelManager:', currentModelId);
  console.log('[makeApiRequest] Passed modelConfig:', modelConfig?.name);
  
  // Use model from modelManager, fallback to passed modelConfig, then deployment name
  const modelName = currentModelId || modelConfig?.name || config.deploymentName;
  
  // Initialize session if needed
  if (!sessionId) {
    await initializeSession();
    if (!sessionId) {
      throw new Error('Could not initialize session');
    }
  }

  // Determine model type for parameter selection
  const modelNameLower = modelName.toLowerCase();
  const isDeepSeek = modelNameLower.includes('deepseek');
  const isOSeries = modelNameLower.startsWith('o1') || modelNameLower.startsWith('o3');

  // IMPORTANT: Structure the messages array properly
  const messages = [];
  
  // Add developer/system prompt if present
  if (developerConfig) {
    if (isOSeries) {
      messages.push({
        role: "developer",
        content: developerConfig
      });
    } else {
      messages.push({
        role: "system", 
        content: developerConfig
      });
    }
  }
  
  // Always add the user's message
  messages.push({
    role: 'user',
    content: messageContent
  });

  // Basic request body - UPDATED to always use the current model
  const requestBody = {
    model: modelName,
    messages: messages,
    session_id: sessionId,
    stream: document.getElementById('enable-streaming')?.checked || false
  };

  // Set model-specific parameters
  if (isOSeries) {
    requestBody.reasoning_effort = reasoningEffort || 'medium';
    
    if (modelConfig?.capabilities?.max_completion_tokens) {
      requestBody.max_completion_tokens = modelConfig.capabilities.max_completion_tokens;
    } else {
      requestBody.max_completion_tokens = 5000;
    }
  } else if (isDeepSeek) {
    requestBody.temperature = 0.7;
    if (modelConfig?.capabilities?.max_tokens) {
      requestBody.max_tokens = modelConfig.capabilities.max_tokens;
    } else {
      requestBody.max_tokens = 32000;
    }
  } else {
    if (modelConfig?.capabilities?.temperature !== undefined) {
      requestBody.temperature = modelConfig.capabilities.temperature;
    } else {
      requestBody.temperature = 0.7;
    }
    
    if (modelConfig?.capabilities?.max_tokens) {
      requestBody.max_tokens = modelConfig.capabilities.max_tokens;
    } else {
      requestBody.max_tokens = 4000;
    }
  }

  // Build the URL - now simplified to your server endpoint
  const url = await buildAzureOpenAIUrl();

  console.log('[makeApiRequest] Request URL:', url);
  console.log('[makeApiRequest] Sending payload:', JSON.stringify(requestBody, null, 2));

  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    signal: controller.signal,
    body: JSON.stringify(requestBody)
  };

  try {
    const response = await fetch(url, init);
    
    if (!response.ok) {
      console.error('[makeApiRequest] Error response:', response.status, response.statusText);
      const errorData = await response.json().catch(() => ({}));
      console.error('[makeApiRequest] Error details:', errorData);
    }
    
    return response;
  } catch (error) {
    console.error('[makeApiRequest] Fetch error:', error);
    throw error;
  }
}

/**
 * Creates an AbortController with a fallback/override for server-suggested timeouts.
 */
function createAbortController(timeoutDuration) {
  const controller = new AbortController();

  // e.g. minimum 90s or server-provided
  const minTimeout = 90000;
  const actualTimeout = window.serverCalculatedTimeout
    ? Math.max(window.serverCalculatedTimeout * 1000, minTimeout)
    : Math.max(timeoutDuration, minTimeout);

  console.log(`[createAbortController] Setting timeout: ${actualTimeout}ms`);

  const timeoutId = setTimeout(() => {
    console.log(`[createAbortController] Request timed out after ${actualTimeout}ms`);
    controller.abort(
      new DOMException(
        `Request exceeded time limit of ${actualTimeout}ms`,
        'TimeoutError'
      )
    );
  }, actualTimeout);

  return { controller, timeoutId };
}

/**
 * Retrieves timeouts for low/medium/high effort, adjusting if needed for special models.
 */
async function getTimeoutDurations(modelConfig) {
  const modelName = modelConfig?.name?.toLowerCase() || '';
  const isDeepSeek = modelName.includes('deepseek');
  const isOSeries = modelName.startsWith('o1') || modelName.startsWith('o3');

  if (isDeepSeek) {
    return {
      low: 30000,    // 30s
      medium: 60000, // 60s
      high: 120000   // 120s
    };
  } else if (isOSeries) {
    return {
      low: 60000,     // 60s 
      medium: 120000, // 120s
      high: 300000    // 300s - O-series models can take much longer
    };
  }

  // Default timeouts for standard models
  return {
    low: 15000,
    medium: 30000,
    high: 60000
  };
}

/**
 * Helper to distinguish if the model is "O1"
 */
function isO1Model(modelConfig) {
  const name = modelConfig?.name?.toLowerCase() || '';
  return name.startsWith('o1') || name.startsWith('o3');
}

/**
 * Helper to distinguish if the model is "DeepSeek"
 */
function isDeepSeekModel(modelConfig) {
  const name = modelConfig?.name?.toLowerCase() || '';
  return name.includes('deepseek');
  // Note: DeepSeek models use temperature parameter, not reasoning_effort
  // This matches the API documentation in deepseek-reference.md
}

// Debug helper for DeepSeek models
function logDeepSeekModelInfo(modelConfig) {
  if (isDeepSeekModel(modelConfig)) {
    console.log('DeepSeek model detected:', {
      name: modelConfig.name,
      supports_temperature: modelConfig.supports_temperature,
      supports_streaming: modelConfig.supports_streaming
    });
  }
}

/**
 * Build the API endpoint for chat completion
 */
async function buildAzureOpenAIUrl(deploymentName, apiVersion) {
  const config = await getCurrentConfig();
  
  // Check if this is a DeepSeek model (needs Azure Inference endpoint)
  const isDeepSeek = (deploymentName || '').toLowerCase().includes('deepseek');
  
  let baseUrl;
  if (isDeepSeek) {
    // For DeepSeek models, use Azure Inference endpoint
    baseUrl = config?.azureInference?.endpoint || "https://DeepSeek-R1D2.eastus2.models.ai.azure.com";
    if (!apiVersion) {
      apiVersion = "2024-05-01-preview"; // Default API version for DeepSeek
    }
  } else {
    // For other models, use Azure OpenAI endpoint
    baseUrl = config?.azureOpenAI?.endpoint || "https://aoai-east-2272068338224.cognitiveservices.azure.com";
    if (!apiVersion) {
      apiVersion = "2025-01-01-preview";
    }
  }
  
  if (!baseUrl) {
    throw new Error('Missing endpoint configuration - check environment variables');
  }

  // Make sure deploymentName is defined
  const actualDeployment = deploymentName || config?.deploymentName || "o1hp";
  
  // Create proper URL
  const url = new URL(
    `openai/deployments/${actualDeployment}/chat/completions`, 
    baseUrl
  );
  
  // Add API version as query parameter
  url.searchParams.append('api-version', apiVersion);
  return url.toString();
}