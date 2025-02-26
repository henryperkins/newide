# Comprehensive DeepSeek-R1 Integration Fix

I'll provide a complete solution to fix the DeepSeek-R1 implementation issues in your application. This solution focuses on addressing all the identified discrepancies while working within your existing codebase structure.

## 1. Update `config.py`

First, let's ensure proper default configuration for DeepSeek-R1:

```python
# Add these lines to config.py after the existing environment variables

# DeepSeek-R1 specific settings with proper fallbacks
DEEPSEEK_R1_DEFAULT_TEMPERATURE = 0.7
DEEPSEEK_R1_DEFAULT_MAX_TOKENS = 32000
DEEPSEEK_R1_DEFAULT_API_VERSION = "2024-05-01-preview"

# Utility function to check if a model is DeepSeek-R1
def is_deepseek_model(model_name: str) -> bool:
    """Check if the model is a DeepSeek model based on name."""
    return model_name and model_name.lower().startswith("deepseek")
```

## 2. Fix `clients.py`

Ensure proper client creation for DeepSeek-R1 with better error handling:

```python
# In the _create_client method in ClientPool class
def _create_client(self, model_name: str, model_config: Dict[str, Any]) -> AzureOpenAI:
    """Create an Azure OpenAI client with the given configuration"""
    is_o_series = model_name.startswith("o") or not model_config.get("supports_temperature", True)
    is_deepseek = model_name.lower().startswith("deepseek")
    max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
    
    # Select the proper API key and endpoint based on model type
    if is_deepseek:
        api_key = os.getenv("AZURE_INFERENCE_CREDENTIAL", "")
        endpoint = model_config.get("azure_endpoint", config.AZURE_INFERENCE_ENDPOINT)
        if not endpoint:
            logger.error(f"No Azure Inference endpoint configured for {model_name} model")
            raise ValueError(f"Missing Azure Inference endpoint for {model_name} model")
        api_version = model_config.get("api_version", config.DEEPSEEK_R1_DEFAULT_API_VERSION)
        
        # Validate required config for DeepSeek
        if not api_key:
            logger.error(f"Missing AZURE_INFERENCE_CREDENTIAL for {model_name} model")
            raise ValueError(f"Missing API credential for {model_name} model")
    else:
        api_key = os.getenv("AZURE_OPENAI_API_KEY", "")
        endpoint = model_config.get("azure_endpoint", config.AZURE_OPENAI_ENDPOINT)
        api_version = model_config.get("api_version", config.AZURE_OPENAI_API_VERSION)

    # Validate endpoint is not None
    if not endpoint:
        logger.error(f"No Azure endpoint configured for model '{model_name}'")
        raise ValueError(f"Missing Azure endpoint for model '{model_name}'")

    # ... rest of your existing code ...
```

And in the model initialization section:

```python
# Ensure DeepSeek-R1 model config is correctly created in initialize_clients
# Replace the existing DeepSeek config creation with this improved version
deepseek_config = {
    "name": "DeepSeek-R1",
    "max_tokens": 32000,
    "supports_streaming": True,
    "supports_temperature": True,  # DeepSeek uses temperature parameter
    "supports_json_response": False,  # DeepSeek doesn't support JSON response format
    "base_timeout": 120.0,
    "max_timeout": 300.0,
    "token_factor": 0.05,
    "api_version": config.DEEPSEEK_R1_DEFAULT_API_VERSION,
    "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
    "description": "Model that supports chain-of-thought reasoning with <think> tags"
}
```

## 3. Update `services/chat_service.py`

Improve the parameter handling for DeepSeek-R1:

```python
# In process_chat_message function, update the parameter generation block
# Replace the existing if-elif-else block with this improved version

if is_o_series:
    # For o-series models, use reasoning_effort and max_completion_tokens
    reasoning_effort = getattr(chat_message, "reasoning_effort", "medium")
    params["reasoning_effort"] = reasoning_effort
    
    max_completion_tokens = getattr(chat_message, "max_completion_tokens", 4096)
    params["max_completion_tokens"] = max_completion_tokens
    
    # For o-series models, we need to use developer role instead of system
    if messages and messages[0].get("role") == "system":
        messages[0]["role"] = "developer"
        
    # Add formatting re-enabled to message if not already present
    if messages:
        first_role = messages[0].get("role")
        if first_role == "developer" and not messages[0].get("content", "").startswith("Formatting re-enabled"):
            messages[0]["content"] = "Formatting re-enabled - use markdown code blocks. " + messages[0].get("content", "")
elif is_deepseek:
    # For DeepSeek-R1, use temperature and max_tokens as per documentation
    params["temperature"] = (
        chat_message.temperature if chat_message.temperature is not None 
        else config.DEEPSEEK_R1_DEFAULT_TEMPERATURE
    )
    
    # DeepSeek uses max_tokens, not max_completion_tokens
    max_tokens = getattr(chat_message, "max_completion_tokens", config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS)
    params["max_tokens"] = min(max_tokens, model_config.get("max_tokens", config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS))
    
    # DeepSeek-R1 uses system role
    # Add formatting re-enabled to message if not already present
    if messages:
        first_role = messages[0].get("role")
        if first_role == "system" and not messages[0].get("content", "").startswith("Formatting re-enabled"):
            messages[0]["content"] = "Formatting re-enabled - use markdown code blocks. " + messages[0].get("content", "")
            
    # Remove any unsupported parameters that might cause issues with DeepSeek
    params.pop('response_format', None)  # DeepSeek doesn't support response_format
else:
    # For standard models, use temperature and max_tokens
    params["temperature"] = (
        chat_message.temperature if chat_message.temperature is not None else 0.7
    )
    max_completion_tokens = getattr(chat_message, "max_completion_tokens", 1024)
    params["max_tokens"] = min(max_completion_tokens, model_config.get("max_tokens", 4096))
```

Also, improve the DeepSeek response processing:

```python
# In the same function, update the response processing section
# Add better handling for <think> tags in DeepSeek responses

# Extract content from the response
if not response.choices or len(response.choices) == 0:
    logger.warning(f"[session {session_id}] No choices returned from AzureOpenAI.")
    content = ""
else:
    content = response.choices[0].message.content
    
    # Process DeepSeek-R1 responses if needed
    if model_name == "DeepSeek-R1" and content:
        # By default, keep the thinking process for DeepSeek-R1
        logger.debug(f"[session {session_id}] DeepSeek response received with <think> tags: {('<think>' in content)}")
        
        # Process and format content for display
        formatted_content = content
        
        # Format DeepSeek thinking tags if present
        if '<think>' in content:
            import re
            thinkRegex = r'<think>([\s\S]*?)<\/think>'
            
            matches = re.findall(thinkRegex, content)
            
            # Apply formatting to each thinking block
            for i, match in enumerate(matches):
                thinking_html = f'''<div class="thinking-process">
                  <div class="thinking-header">
                    <button class="thinking-toggle" aria-expanded="true">
                      <span class="toggle-icon">▼</span> Thinking Process
                    </button>
                  </div>
                  <div class="thinking-content">
                    <pre class="thinking-pre">{match}</pre>
                  </div>
                </div>'''
                
                # Replace the original thinking tags with the formatted HTML
                formatted_content = formatted_content.replace(f'<think>{match}</think>', thinking_html, 1)
```

## 4. Improve `static/js/streaming.js`

Fix the streaming implementation for DeepSeek-R1, especially for thinking tags:

```javascript
// Add or update the parseChunkForReasoning function
function parseChunkForReasoning(text) {
  // Create the buffers if they don't exist
  if (typeof mainTextBuffer === 'undefined') {
    mainTextBuffer = '';
  }
  if (typeof reasoningBuffer === 'undefined') {
    reasoningBuffer = '';
  }
  if (typeof isThinking === 'undefined') {
    isThinking = false;
  }

  // Process the text chunk
  while (text) {
    if (!isThinking) {
      const thinkStart = text.indexOf('<think>');
      if (thinkStart === -1) {
        // No thinking tag, just regular text
        mainTextBuffer += text;
        text = '';
        if (mainContainer) {
          mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
          mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      } else {
        // Found opening thinking tag
        mainTextBuffer += text.slice(0, thinkStart);
        if (mainContainer) {
          mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
          mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        text = text.slice(thinkStart + '<think>'.length);
        isThinking = true;
        ensureReasoningContainer();
      }
    } else {
      const thinkEnd = text.indexOf('</think>');
      if (thinkEnd === -1) {
        // Still in thinking mode but no closing tag yet
        reasoningBuffer += text;
        text = '';
        if (reasoningContainer) {
          reasoningContainer.innerHTML = safeMarkdownParse(
            '## DeepSeek-R1 Reasoning\n\n' + reasoningBuffer
          );
          reasoningContainer.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
          });
        }
      } else {
        // Found closing thinking tag
        reasoningBuffer += text.slice(0, thinkEnd);
        if (reasoningContainer) {
          reasoningContainer.innerHTML = safeMarkdownParse(
            '## DeepSeek-R1 Reasoning\n\n' + reasoningBuffer
          );
          reasoningContainer.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
          });
        }
        text = text.slice(thinkEnd + '</think>'.length);
        isThinking = false;
      }
    }
  }
}

// Add the missing function if it doesn't exist
function ensureReasoningContainer() {
  if (!reasoningContainer) {
    reasoningContainer = createMessageContainer('assistant-thinking streaming');
  }
}
```

Then update the `handleStreamingResponse` function:

```javascript
// Update the handleStreamingResponse function to properly identify DeepSeek model
export async function handleStreamingResponse(response, controller, config, statsDisplay) {
  console.log('[streaming.js] Starting SSE streaming...');

  const modelName = (config?.selectedModel || '').toLowerCase();
  const showReasoning = modelName.includes('deepseek');

  // ... rest of your existing function ...

  eventSource.onmessage = (event) => {
    try {
      const responseData = JSON.parse(event.data);

      // ... existing error handling ...

      // If partial chunk content
      if (responseData.choices && responseData.choices[0].delta?.content) {
        const chunk = responseData.choices[0].delta.content;

        if (showReasoning) {
          // DeepSeek-R1 => parse <think> in real time
          ensureMainContainer();
          parseChunkForReasoning(chunk);
          updateContainers();
        } else {
          // Another streaming model => just append text to main container
          ensureMainContainer();
          mainTextBuffer += chunk;
          if (mainContainer) {
            mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
            mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        }
      }

      // ... rest of the function ...
    } catch (err) {
      console.error('[streaming.js] SSE parsing error:', err);
      eventSource.close();
      removeTypingIndicator();
    }
  };
  
  // ... rest of the function ...
}
```

## 5. Add Thinking Process Styles to `static/css/tailwind.css`

Ensure the thinking process styles are consistently available by adding them to a global stylesheet:

```css
/* Add to @layer components in tailwind.css */
@layer components {
  /* Thinking Process Components for DeepSeek-R1 */
  .thinking-process {
    @apply my-3 border border-blue-200 dark:border-blue-800 rounded-md overflow-hidden;
  }
  
  .thinking-header {
    @apply bg-blue-50 dark:bg-blue-900/30 px-3 py-2 border-b border-blue-200 dark:border-blue-800;
  }
  
  .thinking-toggle {
    @apply w-full text-left flex items-center justify-between text-blue-700 dark:text-blue-300 font-medium;
  }
  
  .thinking-toggle[aria-expanded="false"] + .thinking-content {
    @apply hidden;
  }
  
  .thinking-toggle[aria-expanded="false"] .toggle-icon {
    @apply transform -rotate-90;
  }
  
  .toggle-icon {
    @apply mr-2 inline-block transition-transform duration-200;
  }
  
  .thinking-content {
    @apply bg-blue-50/50 dark:bg-blue-900/10 px-4 py-3;
  }
  
  .thinking-pre {
    @apply font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200 m-0;
  }
  
  .assistant-thinking {
    @apply chat-bubble
           mr-auto
           max-w-[85%] sm:max-w-[75%] md:max-w-3xl
           rounded-bl-none
           border border-blue-300 dark:border-blue-700
           bg-blue-50 dark:bg-blue-900/30 text-gray-800 dark:text-gray-100;
  }
}
```

## 6. Update `static/js/ui/displayManager.js`

Ensure proper handling of thinking tags in the display manager:

```javascript
// Add or enhance the setupThinkingToggleListeners function
export function setupThinkingToggleListeners() {
  setTimeout(() => {
    document.querySelectorAll('.thinking-toggle').forEach(button => {
      // Remove existing listeners to prevent duplicates
      button.replaceWith(button.cloneNode(true));
      
      // Get the freshly cloned button
      const newButton = document.querySelector(
        `.thinking-toggle[aria-expanded="${button.getAttribute('aria-expanded')}"]`
      );
      
      if (newButton) {
        newButton.addEventListener('click', () => {
          const container = newButton.closest('.thinking-process');
          const content = container.querySelector('.thinking-content');
          const isExpanded = newButton.getAttribute('aria-expanded') === 'true';
          
          if (isExpanded) {
            content.style.display = 'none';
            newButton.setAttribute('aria-expanded', 'false');
            newButton.querySelector('.toggle-icon').textContent = '►';
          } else {
            content.style.display = 'block';
            newButton.setAttribute('aria-expanded', 'true');
            newButton.querySelector('.toggle-icon').textContent = '▼';
          }
        });
      }
    });
  }, 100);
}
```

## 7. Update `static/js/models.js`

Improve the DeepSeek-R1 model configuration:

```javascript
// Update the DeepSeek-R1 model configuration
const deepseekR1Model = {
    name: "DeepSeek-R1",
    description: "Model that supports chain-of-thought reasoning with <think> tags",
    azure_endpoint: "https://aoai-east-inference.cognitiveservices.azure.com",
    api_version: "2024-05-01-preview",
    max_tokens: 32000,
    supports_temperature: true,
    supports_streaming: true,
    supports_json_response: false, // DeepSeek doesn't support JSON response format
    requires_reasoning_effort: false, // Uses temperature instead
    base_timeout: 120.0,
    max_timeout: 300.0,
    token_factor: 0.05
};
```

And update the `switchModel` function to properly handle DeepSeek-R1:

```javascript
async switchModel(modelId) {
    console.log(`Attempting to switch to model: ${modelId}`);
    
    // Validate existence
    if (!this.modelConfigs[modelId]) {
        console.error(`Model ${modelId} not found in configurations`);
        this.showToast(`Model ${modelId} not available`, 'error');
        return false;
    }
    
    try {
        this.showToast(`Switching to ${modelId}...`, 'info');
        
        // Fetch session to get session_id
        const session = await fetch('/api/session').then(r => r.json());
        const sessionId = session?.id;
        
        // Update model-specific UI before making the API call
        this.updateModelSpecificUI(modelId);
        
        // Switch model using simplified endpoint
        const url = `/api/config/models/switch_model/${modelId}${
            sessionId ? `?session_id=${sessionId}` : ''
        }`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to switch model: ${errorText}`);
        }
        
        // Locally record the current model
        this.currentModel = modelId;
        this.showToast(`Now using model: ${modelId}`, 'success');
        return true;
    } catch (error) {
        console.error('Error switching model:', error);
        this.showToast('Failed to switch model', 'error');
        return false;
    }
}

// Enhance updateModelSpecificUI to properly handle DeepSeek-R1
updateModelSpecificUI(modelId) {
    const config = this.modelConfigs[modelId];
    if (!config) return;
    
    // Show/hide reasoning controls
    const reasoningControls = document.getElementById('reasoning-controls');
    if (reasoningControls) {
        // Only show reasoning controls for o-series models that require it
        const isOSeries = modelId.toLowerCase().startsWith('o1') || 
                          modelId.toLowerCase().startsWith('o3');
        const requiresReasoning = config.requires_reasoning_effort !== false;
        
        if (isOSeries && requiresReasoning) {
            reasoningControls.classList.remove('hidden');
        } else {
            reasoningControls.classList.add('hidden');
        }
    }
    
    // Update streaming toggle if present
    const streamingToggle = document.getElementById('enable-streaming');
    if (streamingToggle) {
        streamingToggle.disabled = !config.supports_streaming;
        if (!config.supports_streaming) {
            streamingToggle.checked = false;
        }
    }
    
    // Update "Model Info" text with more detailed capabilities
    const modelInfo = document.querySelector('.hidden.md\\:block.text-sm');
    if (modelInfo) {
        const modelFeatures = [];
        
        if (modelId.toLowerCase().startsWith('deepseek')) {
            modelFeatures.push('chain-of-thought reasoning with &lt;think&gt; tags');
        } else if (modelId.toLowerCase().startsWith('o1') || modelId.toLowerCase().startsWith('o3')) {
            modelFeatures.push('advanced reasoning');
        }
        
        if (config.supports_streaming) modelFeatures.push('streaming');
        if (config.supports_vision) modelFeatures.push('vision');
        
        const featuresText = modelFeatures.length > 0 ? 
            `with ${modelFeatures.join(' & ')}` : '';
        
        modelInfo.innerHTML = `
            <p><strong>Model Info:</strong> Using ${modelId} model ${featuresText}</p>
        `;
    }
}
```

## 8. Update `routers/chat.py`

Improve the handling of DeepSeek-R1 in your routing:

```python
# In the stream_chat_response function, add better handling for model capabilities
async def stream_chat_response(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    config_service: ConfigService = Depends(get_config_service),
):
    # ... existing code ...

    model_name = request_data.get("model", config.AZURE_OPENAI_DEPLOYMENT_NAME)
    
    # Get model configs from database with better error handling
    try:
        model_configs = await config_service.get_config("model_configs")
        model_config = model_configs.get(model_name, {}) if model_configs else {}
        
        # For DeepSeek, ensure streaming is supported
        if model_name == "DeepSeek-R1" and not model_config.get("supports_streaming", False):
            logger.warning(f"DeepSeek-R1 model configured without streaming support, but it should support streaming")
            # Force enable streaming for DeepSeek-R1
            model_config["supports_streaming"] = True
            
    except Exception as e:
        logger.error(f"Error getting model configurations: {str(e)}")
        model_config = {}
            
    if not model_config.get("supports_streaming", False):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "message": f"Streaming not supported for model: {model_name}",
                    "type": "validation_error",
                }
            },
        )
    
    # ... continue with the rest of the function ...
```

## 9. Integrating the Solution

This comprehensive fix addresses all the identified issues with DeepSeek-R1 by:

1. Ensuring correct parameter handling (temperature vs reasoning_effort)
2. Setting proper endpoint requirements
3. Properly processing and displaying `<think>` tags
4. Adding better error handling for unsupported parameters
5. Maintaining API version consistency
6. Correctly handling system vs developer roles
7. Improving streaming implementation
8. Adding consistent UI styling for thinking process
9. Adding better environment variable validation
10. Adding parameter validation for unsupported features

The solution maintains your existing codebase structure while fixing the discrepancies specific to DeepSeek-R1 integration. By implementing these changes, your application will handle DeepSeek-R1 correctly and consistently across all scenarios.