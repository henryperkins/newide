// chat.js

import { initializeSession, sessionId, getLastUserMessage, setLastUserMessage } from '/static/js/session.js';
import { getCurrentConfig, getModelSettings } from '/static/js/config.js';
import { showNotification, showTypingIndicator, removeTypingIndicator, handleMessageError } from '/static/js/ui/notificationManager.js';
import { updateTokenUsage } from '/static/js/utils/helpers.js';
import { displayMessage, processServerResponseData } from '/static/js/ui/displayManager.js';
import { handleStreamingResponse } from '/static/js/streaming.js';
import StatsDisplay from '/static/js/ui/statsDisplay.js';
import { modelManager } from './models.js';
import { 
  isDeepSeekModel, 
  isOSeriesModel, 
  getTimeoutDuration, 
  getModelParameters, 
  supportsStreaming 
} from './utils/model_utils.js';

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

    // Get the current selected model from modelManager
    const modelName = modelManager.currentModel || modelConfig?.name || config.deploymentName;
    
    // Decide a typical request timeout based on "reasoningEffort" or "serverCalculatedTimeout"
    const effortLevel = config?.reasoningEffort || 'medium';
    const timeout = window.serverCalculatedTimeout ? 
      Math.max(window.serverCalculatedTimeout * 1000, 90000) : 
      getTimeoutDuration(modelName, effortLevel);
      
    console.log('[Config] Current settings:', { 
      model: modelName,
      effort: effortLevel, 
      timeout
    });

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
      modelConfig,
      modelName
    });

    // Check if the model supports streaming and user has enabled it
    const modelSupportsStreaming = supportsStreaming(modelName, modelConfig);
    
    if (modelSupportsStreaming && streamingEnabled) {
      await handleStreamingResponse(response, controller, config, statsDisplay);
    } else {
      if (streamingEnabled && !modelSupportsStreaming) {
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

        // Process the final response and display it
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
async function handleChatRequest({ 
  messageContent, 
  controller, 
  developerConfig, 
  reasoningEffort, 
  modelConfig,
  modelName
}) {
  const maxRetries = 3;
  let lastError = null;

  // Use the current selected model 
  console.log(`[handleChatRequest] Using model: ${modelName}`);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await makeApiRequest({
        messageContent,
        controller,
        developerConfig,
        reasoningEffort,
        modelConfig,
        modelName
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
async function makeApiRequest({ 
  messageContent, 
  controller, 
  developerConfig, 
  reasoningEffort, 
  modelConfig,
  modelName
}) {
  // Initialize session if needed
  if (!sessionId) {
    await initializeSession();
    if (!sessionId) {
      throw new Error('Could not initialize session');
    }
  }

  // Get request parameters using shared utility
  const requestBody = getModelParameters(modelName, modelConfig, messageContent, developerConfig);
  
  // Add reasoning effort for o-series models if not already set
  if (isOSeriesModel(modelName) && !requestBody.reasoning_effort) {
    requestBody.reasoning_effort = reasoningEffort || 'medium';
  }

  // Build the URL - always use your server endpoint
  const url = '/api/chat/';

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

  // Implement retry logic with exponential backoff for rate limit errors
  const maxRetries = 3;
  let retryCount = 0;
  let retryDelay = 2000; // Start with 2 seconds

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(url, init);
      
      // If we get a 429, implement retry with exponential backoff
      if (response.status === 429) {
        if (retryCount < maxRetries) {
          console.warn(`[makeApiRequest] Rate limited (429). Retrying in ${retryDelay/1000}s... (Attempt ${retryCount + 1}/${maxRetries})`);
          
          // Show a temporary notification about retrying
          if (typeof showNotification === 'function') {
            showNotification(`Rate limited by Azure. Retrying in ${retryDelay/1000}s... (${retryCount + 1}/${maxRetries})`, 'warning', retryDelay);
          }
          
          // Wait for the retry delay
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          // Increase the retry delay exponentially (2s, 4s, 8s, etc.)
          retryDelay *= 2;
          retryCount++;
          continue;
        }
      }
      
      if (!response.ok) {
        console.error('[makeApiRequest] Error response:', response.status, response.statusText);
        // Skip reading response body here so the caller can parse it once
        console.warn('[makeApiRequest] Skipping response.json() to avoid using the body multiple times.');
      }
      
      return response;
    } catch (error) {
      console.error('[makeApiRequest] Fetch error:', error);
      throw error;
    }
  }
  
  // If we've exhausted all retries, throw an error
  throw new Error(`Rate limit exceeded after ${maxRetries} retries. Please try again later.`);
}

/**
 * Creates an AbortController with a timeout for the API request.
 */
function createAbortController(timeoutDuration) {
  const controller = new AbortController();

  // e.g. minimum 90s or server-provided
  const minTimeout = 90000;
  const actualTimeout = Math.max(timeoutDuration, minTimeout);

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