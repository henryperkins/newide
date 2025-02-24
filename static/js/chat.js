// chat.js

import { initializeSession, sessionId, getLastUserMessage, setLastUserMessage } from '/static/js/session.js';
import { getCurrentConfig, getModelSettings } from '/static/js/config.js';
import { showNotification, showTypingIndicator, removeTypingIndicator, handleMessageError } from '/static/js/ui/notificationManager.js';
import { displayMessage, processServerResponseData } from '/static/js/ui/displayManager.js';
import { handleStreamingResponse } from '/static/js/streaming.js';
import StatsDisplay from '/static/js/ui/statsDisplay.js'; // If you're instantiating StatsDisplay here

// Example: if you want a single StatsDisplay instance for the entire app
// you might do this once. Or do so in init.js and import statsDisplay from there.
export const statsDisplay = new StatsDisplay('performance-stats');

/**
 * Main request logic for chat:
 * - Called when user presses "Send" in UI
 * - Gathers user input, handles streaming or non-streaming requests
 * - Displays final message(s) and stats
 */
export async function sendMessage() {
  let userInput;
  console.log('[DEBUG] Send button clicked!');

  const streamingEl = document.getElementById('enable-streaming');
  const streamingEnabled = streamingEl ? streamingEl.checked : false;

  try {
    userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (!message) {
      showNotification('Message cannot be empty', 'warning');
      return;
    }

    // Initialize session if not done already
    if (!sessionId) {
      const initialized = await initializeSession();
      if (!initialized) {
        throw new Error("Failed to initialize session");
      }
    }

    // Disable input while request is in flight
    userInput.disabled = true;
    setLastUserMessage(message);

    // Display user's message in chat
    displayMessage(message, 'user');
    userInput.value = '';

    // Retrieve user config
    const config = await getCurrentConfig();
    const modelConfig = await getModelSettings();

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

    // If streaming is supported and user toggled streaming, handle SSE
    const isDeepSeek = modelConfig?.name?.toLowerCase().includes('deepseek');
    const isGenericStreaming = !!modelConfig?.supportsStreaming;
    if ((isDeepSeek || isGenericStreaming) && streamingEnabled) {
      await handleStreamingResponse(response, controller, config, statsDisplay);
    } else {
      // Non-streaming: parse final JSON and display
      const data = await response.json();
      if (!response.ok) {
        console.error('[sendMessage] API Error details:', data);
        throw new Error(
          `HTTP error! status: ${response.status}, details: ${JSON.stringify(data)}`
        );
      }

      // Possibly update stats usage if data.usage is present
      // Then handle final assistant content in displayManager
      const modelName = data.model || modelConfig?.name || 'unknown';
      processServerResponseData(data, modelName);
    }

  } catch (err) {
    handleMessageError(err);
  } finally {
    removeTypingIndicator();
    userInput.disabled = false;
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

  // Deployment name is necessary for Azure; ensure it's configured
  const deploymentName = config.deploymentName;
  if (!deploymentName) {
    throw new Error('No valid deployment name found in configuration.');
  }

  // Initialize session if needed
  if (!sessionId) {
    await initializeSession();
    if (!sessionId) {
      throw new Error('Could not initialize session');
    }
  }

  // Basic request body
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: messageContent
      }
    ]
  };

  // Insert developer or system prompt if present
  if (developerConfig) {
    const roleName = isO1Model(modelConfig) ? 'developer' : 'system';
    requestBody.messages.unshift({
      role: roleName,
      content: developerConfig
    });
  }

  // If it's a "DeepSeek" or O1 model, apply specialized fields
  if (isDeepSeekModel(modelConfig)) {
    requestBody.reasoning_effort = reasoningEffort || 'medium';
    if (modelConfig.capabilities?.max_tokens) {
      requestBody.max_tokens = modelConfig.capabilities.max_tokens;
    }
  } else if (isO1Model(modelConfig)) {
    // O1 model
    if (modelConfig.capabilities?.max_completion_tokens) {
      requestBody.max_completion_tokens = modelConfig.capabilities.max_completion_tokens;
    }
    if (modelConfig.capabilities?.fixed_temperature !== undefined) {
      requestBody.temperature = modelConfig.capabilities.fixed_temperature;
    }
  } else {
    // Standard model
    if (modelConfig.capabilities?.temperature !== undefined) {
      requestBody.temperature = modelConfig.capabilities.temperature;
    }
  }

  // Example: read from config data
  const apiKey = config.azureOpenAI?.apiKey;
  if (!apiKey) {
    throw new Error('Azure OpenAI API key not configured');
  }

  // e.g. if your getModelSettings() returns { name: "gpt-4", api_version: "2025-01-01-preview" }
  const apiVersion = modelConfig.api_version || '2025-01-01-preview';

  // Build the URL (some utility function you'd have)
  const url = await buildAzureOpenAIUrl(deploymentName, apiVersion);

  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey
    },
    signal: controller.signal,
    body: JSON.stringify(requestBody)
  };

  console.log('[makeApiRequest] Sending payload:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(url, init);
  return response;
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
  const isDeepSeek = modelConfig?.name?.toLowerCase().includes('deepseek');

  if (isDeepSeek) {
    return {
      low: 30000,    // 30s
      medium: 60000, // 60s
      high: 120000   // 120s
    };
  }

  // Default timeouts for non-DeepSeek
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
  return name.includes('o1model') || name.includes('o1-preview');
}

/**
 * Helper to distinguish if the model is "DeepSeek"
 */
function isDeepSeekModel(modelConfig) {
  const name = modelConfig?.name?.toLowerCase() || '';
  return name.includes('deepseek');
}

/**
 * Possibly a helper to build the Azure endpoint for a given deploymentName + API version
 */
async function buildAzureOpenAIUrl(deploymentName, apiVersion) {
  // For example:
  // return `https://YOUR-RESOURCE-NAME.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  // ... or fetch from config.
  const config = await getCurrentConfig();
  const baseUrl = config?.azureOpenAI?.endpointUrl || '';
  return `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
}
