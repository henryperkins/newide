// chat.js/ui/displayManager.js full content, with emojis replaced for safer TypeScript parsing

import { safeMarkdownParse, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';
import { copyToClipboard } from '/static/js/utils/helpers.js';
import { sessionId, initializeSession } from '/static/js/session.js';
import fileManager from '/static/js/fileManager.js';

function replaceFileReferences(container) {
  if (!fileManager?.files?.length) return;

  const fileNames = fileManager.files.map(f => f.name);
  const textNodes = [...container.querySelectorAll('*')]
    .flatMap(el => [...el.childNodes])
    .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

  textNodes.forEach(node => {
    let txt = node.textContent;
    fileNames.forEach(fname => {
      if (txt.includes(fname)) {
        const linkHTML = `<a href="#" class="text-blue-500 underline file-ref-link" data-file-name="${fname}">${fname}</a>`;
        txt = txt.replace(fname, linkHTML);
      }
    });
    if (txt !== node.textContent) {
      const temp = document.createElement('span');
      temp.innerHTML = txt;
      node.replaceWith(temp);
    }
  });
}

/**
 *  Stores or retrieves messages from localStorage, plus
 *  responsible for rendering final messages in the chat UI.
 */

export function displayMessage(content, role) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  // Developer/system message rendering:
  if (role === 'developer') {
    const isFormattingMessage = content
      .toLowerCase()
      .includes('formatting re-enabled');

    const messageDiv = createDeveloperMessage(content, isFormattingMessage);
    chatHistory.appendChild(messageDiv);

    // Add accessibility announcement
    const liveRegion = document.getElementById('a11y-announcements');
    if (liveRegion) {
      liveRegion.textContent = `System message: ${content}`;
    }

    // Persist developer messages
    storeMessageInLocalStorage(content, role);
    storeMessageInDB(role, typeof content === 'string' ? content : JSON.stringify(content));
    return;
  }

  // For user or assistant roles:
  const messageDiv = createMessageElement(role);
  const contentDiv = createContentElement(content, role);
  
  // After content is added, set up event listeners for thinking process toggles
  if (role === 'assistant') {
    setupThinkingToggleListeners();
  }

  // We can attach a copy button for convenience
  messageDiv.appendChild(createCopyButton(content));
  messageDiv.appendChild(contentDiv);

  // Insert small timestamp
  const timeStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const timeSpan = document.createElement('span');
  timeSpan.className = 'block text-xs text-gray-400 mt-1';
  timeSpan.textContent = timeStamp;
  messageDiv.appendChild(timeSpan);

  applyEntranceAnimation(messageDiv);
  highlightNewMessage(messageDiv);
  chatHistory.appendChild(messageDiv);
  scheduleScroll(messageDiv);

  // Persist user/assistant messages
  storeMessageInLocalStorage(content, role);
  storeMessageInDB(role, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A helper to process final response data once we've gotten
 * the entire (non-streaming) message from the server.
 */
export async function processServerResponseData(data, modelName = 'unknown') {
  if (data.calculated_timeout) {
    window.serverCalculatedTimeout = data.calculated_timeout;
  }

  // If data.choices[0].message.content exists, use that; else fallback.
  let assistantContent = data?.choices?.[0]?.message?.content || data.response || '';

  // For DeepSeek models, preserve thinking tags and display them nicely
  if (modelName.toLowerCase().includes('deepseek') || modelName.toLowerCase() === 'deepseek-r1') {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    
    // Check if we have thinking tags
    if (assistantContent.match(thinkRegex)) {
      console.log(`DeepSeek thinking tags detected in content for model: ${modelName}`);
      
      // Process and format the thinking content
      let processedContent = assistantContent;
      
      while ((match = thinkRegex.exec(assistantContent)) !== null) {
        const fullMatch = match[0];
        const thinkingContent = match[1];
        const formattedThinking = `<div class="thinking-process">
          <div class="thinking-header">
            <button class="thinking-toggle" aria-expanded="true">
              <span class="toggle-icon">▼</span> Thinking Process
            </button>
          </div>
          <div class="thinking-content">
            <pre class="thinking-pre">${thinkingContent}</pre>
          </div>
        </div>`;
        
        processedContent = processedContent.replace(fullMatch, formattedThinking);
      }
      
      assistantContent = processedContent;
    }
  }

  // Check if the model name is already included in the content to avoid duplication
  const modelNameRegex = new RegExp(`\\(Using model: ${modelName}\\)`, 'i');
  if (!modelNameRegex.test(assistantContent)) {
    // Log the actual model name for debugging
    console.log(`Adding model label: ${modelName}`);
    
    // Append the model name as subtext only if it's not already there
    assistantContent += `\n\n<span class="text-xs text-gray-500 dark:text-gray-400">(Using model: ${modelName})</span>`;
  }

  // Inject global Markdown styles once
  injectMarkdownStyles();

  // Finally display the assistant message
  displayMessage(safeMarkdownParse(assistantContent), 'assistant');

  // If the server returned usage info, you might want to update your usage display
  if (data.usage && typeof updateTokenUsage === 'function') {
    // data.usage might have { prompt_tokens, completion_tokens, total_tokens } etc.
    updateTokenUsage(data.usage);
  }
}

/**
 * Helper function to store messages in localStorage for session persistence.
 */
function storeMessageInLocalStorage(content, role) {
  try {
    const conversation = JSON.parse(localStorage.getItem('conversation')) || [];
    const now = new Date().toISOString();
    conversation.push({ content, role, timestamp: now });
    localStorage.setItem('conversation', JSON.stringify(conversation));
  } catch (error) {
    console.warn('Could not store message in localStorage:', error);
  }
}

/**
 * Reload messages from localStorage on page refresh, etc.
 */
export function loadConversationFromLocalStorage() {
  try {
    const conversation = JSON.parse(localStorage.getItem('conversation')) || [];
    // Show only the last 20 messages by default
    const recentMessages = conversation.slice(-20);

    recentMessages.forEach(msg => {
      displayMessage(msg.content, msg.role);
    });
  } catch (error) {
    console.warn('Could not load conversation from localStorage:', error);
  }
}

export function loadOlderMessages() {
  try {
    const conversation = JSON.parse(localStorage.getItem('conversation')) || [];
    const currentlyDisplayed = document.querySelectorAll('#chat-history > div');
    const alreadyShownCount = currentlyDisplayed.length;
    const olderBatch = conversation.slice(
      Math.max(0, conversation.length - alreadyShownCount - 20),
      Math.max(0, conversation.length - alreadyShownCount)
    );
    // Insert older messages at the *top* so user sees them above the existing ones
    olderBatch.forEach(msg => {
      const div = createMessageElement(msg.role);
      const contentDiv = createContentElement(msg.content, msg.role);
      div.appendChild(contentDiv);
      const chatHistory = document.getElementById('chat-history');
      if (chatHistory) {
        chatHistory.insertBefore(div, chatHistory.firstChild);
      }
    });
    updateLoadOlderButton(alreadyShownCount + olderBatch.length, conversation.length);
  } catch (error) {
    console.warn('[loadOlderMessages] error:', error);
  }
}

function updateLoadOlderButton(displayed, total) {
  const btn = document.getElementById('load-older-btn');
  if (!btn) return;
  if (displayed < total) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

/**
 * Persist conversation in DB (via your server) for multi-session or longer-term storage.
 */
async function storeMessageInDB(role, content) {
  if (!sessionId) {
    console.warn('No sessionId available to store DB conversation, trying to initialize session...');
    await initializeSession();
    if (!sessionId) {
      console.warn('Still no sessionId after initialization, skipping DB store');
      return;
    }
  }
  try {
    const response = await fetch(
      `/api/chat/conversations/store?session_id=${sessionId}&role=${encodeURIComponent(role)}&content=${encodeURIComponent(content)}`,
      {
        method: 'POST',
        credentials: 'include'
      }
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.warn('You must be logged in to store conversation data. Please log in and try again.');
      } else {
        console.error('Failed to store conversation. HTTP ' + response.status);
      }
    }
  } catch (error) {
    console.error('Error storing message in DB:', error);
  }
}

/* ---------- Developer (system) message handling ---------- */
function createDeveloperMessage(content, isFormattingMessage) {
  const messageDiv = document.createElement('div');
  // Updated class names for Tailwind
  messageDiv.className =
    'mx-auto max-w-xl bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 dark:border-yellow-600 p-3 text-yellow-800 dark:text-yellow-200 rounded my-2';
  messageDiv.setAttribute('role', 'alert');
  messageDiv.setAttribute('aria-live', 'assertive');

  if (isFormattingMessage) {
    const noticeDiv = document.createElement('div');
    noticeDiv.className = 'flex items-center';
    noticeDiv.innerHTML = `
      <span aria-hidden="true" class="mr-2">[Gear]</span>
      <div>
        <strong>System:</strong>
        ${safeMarkdownParse(content)}
      </div>
    `;
    messageDiv.appendChild(noticeDiv);
  } else {
    messageDiv.innerHTML = safeMarkdownParse(content);
  }

  return messageDiv;
}

/* ---------- Generic message elements for user/assistant roles ---------- */
function createMessageElement(role) {
  const messageDiv = document.createElement('div');

  if (role === 'user') {
    messageDiv.classList.add('user-message');
  } else if (role === 'assistant') {
    messageDiv.classList.add('assistant-message');
  }

  // Entrance animation (optional)
  messageDiv.style.opacity = '0';
  messageDiv.style.transform = 'translateY(20px)';
  
  return messageDiv;
}

function createContentElement(content, role) {
  const contentDiv = document.createElement('div');
  contentDiv.className = 'prose dark:prose-invert prose-sm max-w-none';
  
  // Add additional classes for better visibility in dark mode
  if (role === 'user') {
    contentDiv.classList.add('text-white', 'dark:text-white');
  } else if (role === 'assistant') {
    contentDiv.classList.add('text-gray-800', 'dark:text-gray-100');
  }

  // Always parse with safeMarkdownParse for security
  const htmlContent =
    typeof content === 'string' ? safeMarkdownParse(content) : safeMarkdownParse(JSON.stringify(content));
  contentDiv.innerHTML = htmlContent;

  // Turn any recognized file references into clickable links
  replaceFileReferences(contentDiv);

  // After injecting, highlight code blocks
  highlightCodeBlocks(contentDiv);

  return contentDiv;
}

/**
 *  Create a copy button with improved mobile support
 */
function createCopyButton(content) {
  const button = document.createElement('button');
  button.className = 'copy-button touch-action-manipulation';
  button.innerHTML = '📋';
  button.title = 'Copy to clipboard';
  
  // Better touch event handling
  button.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    copyToClipboard(typeof content === 'string' ? content : JSON.stringify(content))
      .then(() => {
        // Show success indicator
        button.innerHTML = '✓';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      })
      .catch(err => {
        console.error('Copy failed:', err);
        // Show failure indicator
        button.innerHTML = '❌';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      });
  });
  
  // Also handle regular click for desktop
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    copyToClipboard(typeof content === 'string' ? content : JSON.stringify(content))
      .then(() => {
        // Show success indicator
        button.innerHTML = '✓';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      })
      .catch(err => {
        console.error('Copy failed:', err);
        // Show failure indicator
        button.innerHTML = '❌';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      });
  });
  
  return button;
}

/**
 * Highlight code blocks for any inserted Markdown code
 */
// Add styles for thinking process
function addThinkingStyles() {
  if (document.getElementById('thinking-styles')) return;
  
  const styleSheet = document.createElement('style');
  styleSheet.id = 'thinking-styles';
  styleSheet.textContent = `
    .thinking-process {
      margin: 1rem 0;
      border-radius: 0.375rem;
      border: 1px solid #e5e7eb;
      overflow: hidden;
    }
    
    .dark .thinking-process {
      border-color: #4b5563;
    }
    
    .thinking-header {
      background-color: #e5edff;
      padding: 0.5rem 1rem;
      border-top-left-radius: 0.375rem;
      border-top-right-radius: 0.375rem;
    }
    
    .dark .thinking-header {
      background-color: #1e3a8a;
    }
    
    .thinking-toggle {
      font-weight: 500;
      color: #3b82f6;
      display: flex;
      align-items: center;
      width: 100%;
      text-align: left;
      cursor: pointer;
    }
    
    .dark .thinking-toggle {
      color: #93c5fd;
    }
    
    .toggle-icon {
      margin-right: 0.5rem;
      display: inline-block;
      transition: transform 0.2s;
    }
    
    .thinking-content {
      background-color: #f1f5ff;
      padding: 1rem;
      overflow-x: auto;
      border-bottom-left-radius: 0.375rem;
      border-bottom-right-radius: 0.375rem;
    }
    
    .dark .thinking-content {
      background-color: #172554;
    }
    
    .thinking-pre {
      margin: 0;
      white-space: pre-wrap;
      font-family: monospace;
      font-size: 0.875rem;
      color: #334155;
    }
    
    .dark .thinking-pre {
      color: #cbd5e1;
    }
  `;
  document.head.appendChild(styleSheet);
}

// Call this function on page load
addThinkingStyles();

// Set up event listeners for thinking process toggles
export function setupThinkingToggleListeners() {
  setTimeout(() => {
    document.querySelectorAll('.thinking-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const container = button.closest('.thinking-process');
        const content = container.querySelector('.thinking-content');
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        
        if (isExpanded) {
          content.style.display = 'none';
          button.setAttribute('aria-expanded', 'false');
          button.querySelector('.toggle-icon').textContent = '►';
        } else {
          content.style.display = 'block';
          button.setAttribute('aria-expanded', 'true');
          button.querySelector('.toggle-icon').textContent = '▼';
        }
      });
    });
  }, 100);
}

export function highlightCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach(block => {
    block.style.opacity = '0';
    // Apply Tailwind classes to code blocks
    block.classList.add(
      'block',
      'p-4',
      'overflow-x-auto',
      'rounded',
      'bg-gray-100',
      'dark:bg-gray-800',
      'text-sm',
      'font-mono'
    );

    // Optional detection of language from text or class
    if (!block.className && block.parentElement.firstChild?.textContent) {
      const lang = block.parentElement.firstChild.textContent.trim();
      if (lang && typeof Prism !== 'undefined' && Prism.languages[lang]) {
        block.className = `language-${lang}`;
      }
    }
    if (typeof Prism !== 'undefined') {
      Prism.highlightElement(block);
    }
    
    // Add copy button to code blocks
    const copyButton = document.createElement('button');
    copyButton.className = 'absolute top-2 right-2 bg-gray-700 text-white dark:bg-gray-600 px-2 py-1 rounded text-xs opacity-70 hover:opacity-100';
    copyButton.textContent = 'Copy';
    copyButton.style.zIndex = '10';
    
    copyButton.addEventListener('click', () => {
      const code = block.textContent;
      copyToClipboard(code)
        .then(() => {
          copyButton.textContent = 'Copied!';
          setTimeout(() => {
            copyButton.textContent = 'Copy';
          }, 2000);
        })
        .catch(() => {
          copyButton.textContent = 'Failed';
          setTimeout(() => {
            copyButton.textContent = 'Copy';
          }, 2000);
        });
    });
    
    // Make sure pre has position relative for absolute positioning of button
    if (block.parentElement) {
      block.parentElement.style.position = 'relative';
      block.parentElement.appendChild(copyButton);
    }
    
    setTimeout(() => {
      block.style.opacity = '1';
      block.style.transition = 'opacity 0.3s ease';
    }, 100);
  });
}

/* ---------- Animations and scrolling ---------- */
function applyEntranceAnimation(element) {
  requestAnimationFrame(() => {
    element.style.transition = 'all 0.3s ease';
    element.style.opacity = '1';
    element.style.transform = 'translateY(0)';
  });
}

/**
 * Highlight new message with improved visibility
 */
function highlightNewMessage(element) {
  // More visible highlight on mobile
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  if (isMobile) {
    element.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'transition-colors', 'duration-1000');
    setTimeout(() => {
      element.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
    }, 1500);
  } else {
    element.classList.add('bg-yellow-50', 'dark:bg-blue-900/10', 'transition-colors');
    setTimeout(() => {
      element.classList.remove('bg-yellow-50', 'dark:bg-blue-900/10');
    }, 1200);
  }
}

/**
 * Improved scroll behavior for mobile
 */
function scheduleScroll(element) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const scrollOptions = {
    behavior: 'smooth',
    block: isMobile ? 'end' : 'nearest',
    inline: 'nearest'
  };

  // More generous scroll threshold on mobile
  const scrollThreshold = isMobile ? 200 : 300;
  const fromBottom = chatHistory.scrollHeight - (chatHistory.scrollTop + chatHistory.clientHeight);

  if (fromBottom <= scrollThreshold) {
    setTimeout(() => {
      element.scrollIntoView(scrollOptions);
    }, isMobile ? 100 : 50);
  }
}

/* ---------- Example citation processing if relevant ---------- */
export function processCitations(content) {
  const messageContent = content.content[0].text;
  const annotations = messageContent.annotations;
  let parsedContent = messageContent.value;
  const citations = [];

  annotations.forEach((annotation, index) => {
    if (annotation.file_citation) {
      parsedContent = parsedContent.replace(annotation.text, `[${index + 1}]`);
      citations.push(createCitationHTML(index + 1, annotation.file_citation));
    }
  });

  return { parsedContent, citations };
}

function createCitationHTML(index, citation) {
  // Updated to use Tailwind classes
  return `
    <div class="my-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-md border-l-3 border-blue-500 dark:border-blue-400" 
         role="region" 
         aria-label="Document reference ${index}"
         tabindex="0">
      <div class="flex items-center mb-2" id="citation-heading-${index}">
        <span class="text-blue-600 dark:text-blue-400 font-mono font-bold mr-2" aria-label="Reference number">[${index}]</span>
        <span class="text-gray-600 dark:text-gray-400 text-sm" aria-label="Source document">
          ${citation.file_name}
        </span>
      </div>
      <div class="text-gray-800 dark:text-gray-200 italic" aria-label="Relevant excerpt">
        ${citation.quote}
      </div>
    </div>
  `;
}

/**
 * If you want to reuse the UI token usage display in this same file, you can define it here.
 */
export function updateTokenUsage(usage) {
  // Update the token display with the usage info
  const promptTokens = document.getElementById('prompt-tokens');
  const completionTokens = document.getElementById('completion-tokens');
  const totalTokens = document.getElementById('total-tokens');
  const reasoningTokens = document.getElementById('reasoning-tokens');
  const baseCompletionTokens = document.getElementById('base-completion-tokens');

  if (promptTokens) promptTokens.textContent = usage.prompt_tokens || 0;
  if (completionTokens) completionTokens.textContent = usage.completion_tokens || 0;
  if (totalTokens) totalTokens.textContent = usage.total_tokens || 0;

  // Optional if these are provided
  if (reasoningTokens && usage.reasoning_tokens) {
    reasoningTokens.textContent = usage.reasoning_tokens;
  }
  window.loadOlderMessages = loadOlderMessages;
  if (baseCompletionTokens && usage.base_completion_tokens) {
    baseCompletionTokens.textContent = usage.base_completion_tokens;
  }
}
