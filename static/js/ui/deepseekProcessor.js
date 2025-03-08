/**
 * deepseekProcessor.js
 *
 * Consolidated module for parsing, processing, and rendering
 * "DeepSeek"-style chain-of-thought content, plus a no-op
 * initializeExistingBlocks() to avoid errors in init.js.
 *
 * Added replaceThinkingBlocks() so displayManager.js can call it.
 */

/* -------------------------------------------------------------------------
 * 1. SSE chunk processing (formerly in streaming_utils.js)
 * ------------------------------------------------------------------------- */

/**
 * Takes incoming SSE data (data.choices[]), updates the main text buffer
 * and chain-of-thought buffer. This replaces the old "processDataChunk".
 *
 * @param {Object} data - Parsed JSON from SSE (e.g. { choices: [...] }).
 * @param {string} chunkBuffer - Temporary leftover text not yet assigned.
 * @param {string} mainTextBuffer - Accumulated user-visible content so far.
 * @param {string} thinkingTextBuffer - Accumulated chain-of-thought text so far.
 * @param {boolean} isThinking - Flag if we are currently inside <think>...</think>.
 * @returns {Object} updated { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking }
 */
function processChunkAndUpdateBuffers(data, chunkBuffer, mainTextBuffer, thinkingTextBuffer, isThinking) {
  // CRITICAL FIX: Handle both structured choices format and direct text format
  console.log('[processChunkAndUpdateBuffers] Processing data:', 
    JSON.stringify(data).substring(0, 100));
    
  // Handle the choices format (standard OpenAI format)
  if (data.choices && data.choices.length > 0) {
    data.choices.forEach(choice => {
      // Each token
      if (choice.delta && choice.delta.content) {
        const text = choice.delta.content;
        chunkBuffer += text;

        // Let processStreamingChunk do the <think> splitting
        const result = processStreamingChunk(chunkBuffer, isThinking, mainTextBuffer, thinkingTextBuffer);
        mainTextBuffer = result.mainBuffer;
        thinkingTextBuffer = result.thinkingBuffer;
        isThinking = result.isThinking;
        chunkBuffer = result.remainingChunk;
      }

      // If server signals the end
      if (choice.finish_reason) {
        if (chunkBuffer) {
          mainTextBuffer += chunkBuffer;
          chunkBuffer = '';
        }
        isThinking = false; // turn off chain-of-thought at final chunk
      }
    });
  } 
  // CRITICAL FIX: Handle the text-direct format (e.g., {"text":"Okay"})
  else if (data.text !== undefined) {
    console.log('[processChunkAndUpdateBuffers] Processing text format:', data.text);
    
    // Add the text to the chunk buffer
    const text = data.text || '';
    chunkBuffer += text;
    
    // Process the chunk and update buffers
    const result = processStreamingChunk(chunkBuffer, isThinking, mainTextBuffer, thinkingTextBuffer);
    mainTextBuffer = result.mainBuffer;
    thinkingTextBuffer = result.thinkingBuffer;
    isThinking = result.isThinking;
    chunkBuffer = result.remainingChunk;
    
    console.log('[processChunkAndUpdateBuffers] Updated mainBuffer length:', mainTextBuffer.length);
  } 
  // If we don't recognize the format, attempt to interpret as text
  else if (data.usage) {
    console.log('[processChunkAndUpdateBuffers] Ignoring usage data:', data.usage);
    // Do nothing
  } else {
    console.warn('[processChunkAndUpdateBuffers] Unrecognized data format:', data);
    if (typeof data === 'object' && !Array.isArray(data)) {
      const fallbackText = String(data) || '';
      chunkBuffer += fallbackText;
      const result = processStreamingChunk(chunkBuffer, isThinking, mainTextBuffer, thinkingTextBuffer);
      mainTextBuffer = result.mainBuffer;
      thinkingTextBuffer = result.thinkingBuffer;
      isThinking = result.isThinking;
      chunkBuffer = result.remainingChunk;
    }
  }

  return { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking };
}

/**
 * Splits text into user-visible vs. chain-of-thought by scanning <think>...</think>.
 *
 * @param {string} chunkBuffer
 * @param {boolean} isThinking
 * @param {string} mainBuffer
 * @param {string} thinkingBuffer
 * @returns {Object} { mainBuffer, thinkingBuffer, isThinking, remainingChunk }
 */
function processStreamingChunk(chunkBuffer, isThinking, mainBuffer, thinkingBuffer) {
  // CRITICAL FIX: Add detailed debug logging for thinking blocks
  console.log('[processStreamingChunk] Processing:', {
    bufferLength: chunkBuffer?.length || 0,
    isThinking: isThinking,
    mainBufferLength: mainBuffer?.length || 0,
    thinkingBufferLength: thinkingBuffer?.length || 0,
    bufferSample: chunkBuffer?.substring(0, 20) || '',
    hasThinkTag: chunkBuffer?.includes('<think>') || false,
    hasCloseThinkTag: chunkBuffer?.includes('</think>') || false
  });

  const result = {
    mainBuffer: mainBuffer || '',
    thinkingBuffer: thinkingBuffer || '',
    isThinking: isThinking || false,
    remainingChunk: ''
  };
  if (!chunkBuffer) return result;

  let buffer = chunkBuffer;
  while (buffer.length > 0) {
    if (result.isThinking) {
      // Look for closing </think>
      const closeIdx = buffer.indexOf('</think>');
      if (closeIdx === -1) {
        // Not found, so everything goes into chain-of-thought
        // FIXED: Don't truncate logs or thinking content
        result.thinkingBuffer += buffer;
        console.log('[processStreamingChunk] Added to thinking buffer (no close tag):', 
                   `[${buffer.length} chars total]`);
        buffer = '';
      } else {
        // Found it
        result.thinkingBuffer += buffer.substring(0, closeIdx);
        console.log('[processStreamingChunk] Added to thinking buffer (found close tag):', 
                   `[${buffer.substring(0, closeIdx).length} chars]`);
        result.isThinking = false;
        buffer = buffer.substring(closeIdx + 8); // skip </think>
      }
    } else {
      // We are in user-visible text, look for <think>
      const openIdx = buffer.indexOf('<think>');
      if (openIdx === -1) {
        // No opening tag found => all user-visible
        result.mainBuffer += buffer;
        console.log('[processStreamingChunk] Added to main buffer (no open tag):', 
                   `[${buffer.length} chars total]`);
        buffer = '';
      } else {
        // <think> found
        if (openIdx > 0) {
          const beforeThink = buffer.substring(0, openIdx);
          result.mainBuffer += beforeThink;
          console.log('[processStreamingChunk] Added to main buffer (before think tag):', 
                     `[${beforeThink.length} chars]`);
        }
        result.isThinking = true;
        buffer = buffer.substring(openIdx + 7); // skip <think>
        console.log('[processStreamingChunk] Found <think> tag, switching to thinking mode');
      }
    }
  }

  // We consumed the entire chunk. No leftover partial text remains
  result.remainingChunk = '';

  console.log('[processStreamingChunk] Final result:', {
    mainBufferLength: result.mainBuffer.length,
    thinkingBufferLength: result.thinkingBuffer.length,
    isThinking: result.isThinking
  });

  return result;
}

/**
 * At the end of streaming, separate the user-facing content
 * (removing leftover <think> tags) vs. chain-of-thought content.
 *
 * @param {string} mainBuffer
 * @param {string} thinkingBuffer
 * @returns {Object} { mainContent, thinkingContent }
 */
function separateContentBuffers(mainBuffer, thinkingBuffer) {
  // Remove any stray <think> tags in main content
  const cleanedMain = (mainBuffer || '').replace(/<\/?think>/g, '').trim();
  return {
    mainContent: cleanedMain,
    thinkingContent: (thinkingBuffer || '').trim()
  };
}

// -------------------------------------------------------------------------
// 2. Final user-facing "DeepSeek" content
// -------------------------------------------------------------------------

/**
 * Removes <think> blocks from a final string. (If you want to
 * show your chain-of-thought in the final answer, skip this.)
 *
 * @param {string} content
 * @returns {string}
 */
function processDeepSeekResponse(content) {
  if (!content) return '';
  // Remove <think>...</think> blocks
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Remove any leftover <think> tags
  cleaned = cleaned.replace(/<\/?think>/g, '');
  return cleaned;
}

/**
 * Replaces <think> blocks in the string by removing them, effectively.
 * This is an alias for processDeepSeekResponse, so code referencing
 * deepSeekProcessor.replaceThinkingBlocks won't break.
 */
function replaceThinkingBlocks(content) {
  return processDeepSeekResponse(content);
}

// -------------------------------------------------------------------------
// 3. Rendering / toggling of chain-of-thought blocks in the DOM
// -------------------------------------------------------------------------

/**
 * Minimal markdown -> HTML for chain-of-thought text
 */
function markdownToHtml(text) {
  if (!text) return '';
  return text
    .replace(/### (.*)/g, '<h3>$1</h3>')
    .replace(/## (.*)/g, '<h2>$1</h2>')
    .replace(/# (.*)/g, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/**
 * Creates or updates the chain-of-thought container in the parent node.
 * Replaces the old ensureThinkingContainer usage in streaming_utils.
 *
 * @param {HTMLElement} parentContainer - Typically your .assistant-message container
 * @param {string} thinkingText - The thinking content to render
 * @param {Object} options - Options like createNew to force a new container
 * @returns {HTMLElement | null} The thinking container DOM node
 */
function renderThinkingContainer(parentContainer, thinkingText, options = {}) {
  console.log('[renderThinkingContainer] Called with thinking text length:', 
              thinkingText?.length || 0,
              'text sample:', thinkingText?.substring(0, 30) || '');
              
  if (!parentContainer) {
    console.error('[renderThinkingContainer] No parent container provided');
    return null;
  }

  // CRITICAL FIX: Ensure we have some thinking text
  if (!thinkingText || thinkingText.trim() === '') {
    console.warn('[renderThinkingContainer] Empty thinking text provided');
    thinkingText = '(processing...)'; // Placeholder text
  }

  // Look for existing container only if we're not forcing a new one
  let thinkingContainer = null;
  if (!options.createNew) {
    thinkingContainer = parentContainer.querySelector('.thinking-pre');
    console.log('[renderThinkingContainer] Found existing container:', !!thinkingContainer);
  }

  if (!thinkingContainer || options.createNew) {
    // If not found or createNew is true, create a new container
    console.log('[renderThinkingContainer] Creating new thinking container');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'thinking-safe-wrapper'; // Add a wrapper class

    // CRITICAL FIX: Make sure wrapper is visible
    wrapper.style.display = 'block';
    wrapper.style.visibility = 'visible';
    wrapper.style.marginTop = '10px';

    // Create unique container with timestamp to avoid conflicts
    const uniqueId = 'thinking-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    wrapper.setAttribute('data-id', uniqueId);

    try {
      wrapper.innerHTML = createThinkingBlockHTML(thinkingText);
    } catch (err) {
      console.error('[renderThinkingContainer] Error creating HTML:', err);
      // Fallback to a simpler HTML structure if the fancy one fails
      wrapper.innerHTML = `
        <div class="bg-gray-100 dark:bg-gray-800 p-3 rounded mt-2">
          <div><strong>Chain of Thought:</strong></div>
          <pre class="thinking-pre whitespace-pre-wrap mt-2">${thinkingText}</pre>
        </div>
      `;
    }
    
    // CRITICAL FIX: Add container before appending to ensure it's visible
    console.log('[renderThinkingContainer] Appending to parent container');
    parentContainer.appendChild(wrapper);

    thinkingContainer = wrapper.querySelector('.thinking-pre');
    
    if (!thinkingContainer) {
      console.error('[renderThinkingContainer] Failed to find .thinking-pre in the newly created container!');
      // Create one directly if it doesn't exist
      thinkingContainer = document.createElement('pre');
      thinkingContainer.className = 'thinking-pre whitespace-pre-wrap';
      thinkingContainer.textContent = thinkingText;
      wrapper.appendChild(thinkingContainer);
    }

    // Initialize toggling
    try {
      const thinkingProcess = wrapper.querySelector('.thinking-process');
      if (thinkingProcess) {
        initializeThinkingToggle(thinkingProcess);
      }
    } catch (toggleErr) {
      console.warn('[renderThinkingContainer] Error initializing toggle:', toggleErr);
    }

    // CRITICAL FIX: Set explicit styles on the container to ensure visibility
    if (thinkingContainer) {
      thinkingContainer.style.display = 'block';
      thinkingContainer.style.visibility = 'visible';
      thinkingContainer.style.minHeight = '20px';
      thinkingContainer.style.opacity = '1';
    }

    console.log('[renderThinkingContainer] New container created:', !!thinkingContainer);
    
    // Return the thinking container element
    return thinkingContainer;
  } else {
    // If it exists and we're not creating new, just update the text
    console.log('[renderThinkingContainer] Updating existing container');
    try {
      const sanitizedContent = window.DOMPurify ? 
        window.DOMPurify.sanitize(markdownToHtml(thinkingText)) : 
        markdownToHtml(thinkingText);
        
      // CRITICAL FIX: Set content and make it visible
      thinkingContainer.innerHTML = sanitizedContent || '(processing...)';
      thinkingContainer.style.display = 'block';
      thinkingContainer.style.visibility = 'visible';
      
      // Make sure the parent elements are visible too
      let parent = thinkingContainer.parentElement;
      while (parent && parent !== parentContainer) {
        parent.style.display = 'block';
        parent.style.visibility = 'visible';
        parent = parent.parentElement;
      }
    } catch (updateErr) {
      console.error('[renderThinkingContainer] Error updating container:', updateErr);
      // Fallback to simple text assignment
      thinkingContainer.textContent = thinkingText;
    }
  }
  
  return thinkingContainer;
}

/**
 * Builds the HTML snippet for the chain-of-thought block with a toggle.
 */
function createThinkingBlockHTML(thinkingText) {
  console.log('[createThinkingBlockHTML] Creating HTML for thinking text length:', 
               thinkingText?.length || 0);
               
  // Safe default if no thinking text is provided
  if (!thinkingText) {
    thinkingText = '(processing...)';
  }
  
  let sanitized;
  try {
    // First apply markdown formatting
    const formattedText = markdownToHtml(thinkingText);
    
    // Then sanitize if DOMPurify is available
    sanitized = window.DOMPurify ? 
                window.DOMPurify.sanitize(formattedText, {
                  ALLOWED_TAGS: ['br', 'b', 'i', 'strong', 'em', 'code', 'pre', 'h1', 'h2', 'h3'],
                  KEEP_CONTENT: true
                }) : 
                formattedText;
  } catch (error) {
    console.error('[createThinkingBlockHTML] Error formatting/sanitizing:', error);
    // Fallback to plain text if markdown/sanitizing fails
    sanitized = thinkingText
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/\n/g, '<br>');
  }
  
  // Create the HTML with explicit styles to ensure visibility and NO truncation
  return `
    <div class="thinking-process" role="region" aria-label="Chain of Thought" 
         data-collapsed="false" style="display:block; visibility:visible; margin-top:10px; max-height:none; overflow:visible;">
      <div class="thinking-header thinking-toggle" aria-expanded="true" 
           style="cursor:pointer; padding:6px; background-color:rgba(0,0,0,0.05); 
                  border-radius:4px 4px 0 0; display:flex; align-items:center;">
        <span class="toggle-icon" style="margin-right:4px;">▼</span>
        <span class="font-medium ml-1">Chain of Thought (${sanitized.length} chars)</span>
      </div>
      <div class="thinking-content" style="display:block; visibility:visible; padding:8px; 
                   background-color:rgba(0,0,0,0.03); border-radius:0 0 4px 4px;
                   max-height:none; overflow:visible;">
        <pre class="thinking-pre" style="white-space:pre-wrap; margin:0; padding:0; 
                 font-family:monospace; min-height:20px; display:block; visibility:visible;
                 max-height:none; overflow:visible; text-overflow:clip;">${sanitized}</pre>
        <!-- Removed gradient overlay that might hide content -->
      </div>
    </div>
  `;
}

/**
 * Toggle show/hide logic for chain-of-thought container.
 */
function initializeThinkingToggle(thinkingProcess) {
  if (!thinkingProcess) return;
  const toggleBtn = thinkingProcess.querySelector('.thinking-header');
  const contentDiv = thinkingProcess.querySelector('.thinking-content');
  const toggleIcon = thinkingProcess.querySelector('.toggle-icon');

  if (!toggleBtn || !contentDiv) return;

  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    thinkingProcess.setAttribute('data-collapsed', expanded ? 'true' : 'false');

    if (toggleIcon) {
      toggleIcon.textContent = expanded ? '▶' : '▼';
    }
    contentDiv.style.display = expanded ? 'none' : 'block';
  });
}

/**
 * For code that tries to call deepSeekProcessor.initializeExistingBlocks,
 * we provide this stub so it won't throw an error in init.js
 */
function initializeExistingBlocks() {
  // If you want to re-scan the DOM on page load and attach toggles to .thinking-process elements,
  // implement that logic here. For now, it's a no-op to avoid errors.
}

/* -------------------------------------------------------------------------
 * 4. Export a single object so streaming.js (etc.) can import
 * ------------------------------------------------------------------------- */
export const deepSeekProcessor = {
  processChunkAndUpdateBuffers: processChunkAndUpdateBuffers,  // explicit assignment to existing function
  processStreamingChunk: processStreamingChunk,
  separateContentBuffers: separateContentBuffers,              // correct existing function use
  processDeepSeekResponse: processDeepSeekResponse,
  replaceThinkingBlocks: replaceThinkingBlocks,
  renderThinkingContainer: (parent, thinkingText) => renderThinkingContainer(parent, thinkingText, {createNew: true}),
  createThinkingBlockHTML: createThinkingBlockHTML,
  initializeThinkingToggle: initializeThinkingToggle,
  initializeExistingBlocks: initializeExistingBlocks,
  markdownToHtml: markdownToHtml,
  // Add these functions to the deepSeekProcessor export:
  preprocessChunk: function(data) {
    console.log('[deepSeekProcessor.preprocessChunk] Processing chunk:',
      typeof data === 'object' ?
      (data.choices ? 'choices format' : 'text format') :
      'string format');
    
    // Handle both JSON formats that DeepSeek might return
    if (typeof data === 'object') {
      if (data.choices && data.choices[0] && data.choices[0].delta) {
        // Extract content from delta format
        const deltaContent = data.choices[0].delta.content || '';
        console.log('[preprocessChunk] Found delta content:', deltaContent.length > 0);
        
        // Convert to text format to standardize processing
        return { text: deltaContent };
      }
      else if (data.text !== undefined) {
        // Already in text format, ensure it's a string
        console.log('[preprocessChunk] Found text content:', data.text.length > 0);
        data.text = String(data.text);
        return data;
      }
    }
    
    // If we get here, we couldn't extract content in a standard way
    console.warn('[preprocessChunk] Unexpected data format:', data);
    
    // Try to convert to a standard format as best we can
    if (typeof data === 'string') {
      return { text: data };
    }
    
    // If all else fails, return an empty object to avoid errors
    return { text: '' };
  },
};

// Define a top-level function for token usage display updates
function updateTokenUsageDisplay(usageData) {
  console.log('[updateTokenUsageDisplay] Updating token usage display:', usageData);
  const usageElem = document.getElementById('tokenUsageDisplay');
  if (!usageElem) {
    console.warn('[updateTokenUsageDisplay] No #tokenUsageDisplay element found in the DOM');
    return;
  }
  // Use normal string concatenation to avoid TS parser issues
  usageElem.innerText = "Prompt Tokens: " + (usageData.prompt_tokens || 0)
    + " | Completion Tokens: " + (usageData.completion_tokens || 0)
    + " | Total: " + (usageData.total_tokens || 0);
}

// Add updateTokenUsageDisplay to the exported deepSeekProcessor object
deepSeekProcessor.updateTokenUsageDisplay = updateTokenUsageDisplay;
