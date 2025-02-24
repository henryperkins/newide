// displayManager.js

import { safeMarkdownParse, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';
import { copyToClipboard } from '/static/js/utils/helpers.js';
import { sessionId } from '/static/js/session.js';

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

  // We can attach a copy button for convenience
  messageDiv.appendChild(createCopyButton(content));
  messageDiv.appendChild(contentDiv);

  applyEntranceAnimation(messageDiv);
  chatHistory.appendChild(messageDiv);
  scheduleScroll(messageDiv);

  // Persist user/assistant messages
  storeMessageInLocalStorage(content, role);
  storeMessageInDB(role, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A helper to process final response data once we've gotten
 * the entire (non-streaming) message from the server.
 * 
 * If you are not using streaming for some models, you can call
 * this at the end of your request logic to display the final text.
 */
export async function processServerResponseData(data, modelName = 'unknown') {
  if (data.calculated_timeout) {
    window.serverCalculatedTimeout = data.calculated_timeout;
  }

  // If data.choices[0].message.content exists, use that; else fallback.
  let assistantContent = data?.choices?.[0]?.message?.content || data.response || '';

  // Example: If modelName includes 'deepseek-r1', remove chain-of-thought
  // from final content but optionally store or show it.
  if (modelName.toLowerCase().includes('deepseek-r1')) {
    const thinkRegex = /<think>[\s\S]*?<\/think>/g;
    if (assistantContent.match(thinkRegex)) {
      // Optionally capture or log the chain-of-thought here if desired
      assistantContent = assistantContent.replace(thinkRegex, '');
    }
  }

  // Optionally append the model name as subtext:
  assistantContent += `\n\n<span class="model-subtext" style="font-size: 0.85em; color: #777;">(Using model: ${modelName})</span>`;

  // Inject global Markdown styles once
  injectMarkdownStyles();

  // Finally display the assistant message
  displayMessage(safeMarkdownParse(assistantContent), 'assistant');

  // If the server returned usage info, you might want to update your usage display
  if (data.usage && typeof updateTokenUsage === 'function') {
    // data.usage might have {prompt_tokens, completion_tokens, total_tokens} etc.
    updateTokenUsage(data.usage);
  }
}

/**
 * Helper function to store messages in localStorage for session persistence.
 */
function storeMessageInLocalStorage(content, role) {
  try {
    const conversation = JSON.parse(localStorage.getItem('conversation')) || [];
    conversation.push({ content, role });
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
    conversation.forEach(msg => {
      displayMessage(msg.content, msg.role);
    });
  } catch (error) {
    console.warn('Could not load conversation from localStorage:', error);
  }
}

/**
 * Persist conversation in DB (via your server) for multi-session or longer-term storage.
 */
async function storeMessageInDB(role, content) {
  if (!sessionId) {
    console.warn('No sessionId available to store DB conversation.');
    return;
  }
  try {
    await fetch('/api/conversations/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, role, content })
    });
  } catch (error) {
    console.error('Failed to store conversation in DB:', error);
  }
}

/* ---------- Developer (system) message handling ---------- */
function createDeveloperMessage(content, isFormattingMessage) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message developer-message markdown-content';
  messageDiv.setAttribute('role', 'alert');
  messageDiv.setAttribute('aria-live', 'assertive');

  if (isFormattingMessage) {
    const noticeDiv = document.createElement('div');
    noticeDiv.className = 'formatting-notice';
    noticeDiv.innerHTML = `
      <span aria-hidden="true">⚙️</span>
      <strong>System:</strong>
      ${safeMarkdownParse(content)}
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
  messageDiv.className = `message ${role}-message markdown-content`;

  // Start hidden for entrance animation
  messageDiv.style.opacity = '0';
  messageDiv.style.transform = 'translateY(20px)';

  return messageDiv;
}

function createContentElement(content, role) {
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  // Always parse with safeMarkdownParse for security
  const htmlContent = safeMarkdownParse(
    typeof content === 'string' ? content : JSON.stringify(content)
  );
  contentDiv.innerHTML = htmlContent;

  // After injecting, highlight code blocks
  highlightCodeBlocks(contentDiv);

  return contentDiv;
}

/**
 * Generate a button that copies the underlying content to the clipboard.
 */
function createCopyButton(content) {
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.innerHTML = '📋';
  button.title = 'Copy to clipboard';
  button.onclick = () =>
    copyToClipboard(typeof content === 'string' ? content : JSON.stringify(content));
  return button;
}

/**
 * Highlight code blocks for any inserted Markdown code
 * (using Prism or a similar syntax highlighter).
 */
export function highlightCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach(block => {
    block.style.opacity = '0';
    // Optionally detect language from the text or a class
    if (!block.className && block.parentElement.firstChild?.textContent) {
      const lang = block.parentElement.firstChild.textContent.trim();
      if (lang && typeof Prism !== 'undefined' && Prism.languages[lang]) {
        block.className = `language-${lang}`;
      }
    }
    if (typeof Prism !== 'undefined') {
      Prism.highlightElement(block);
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

function scheduleScroll(element) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const scrollOptions = {
    behavior: 'smooth',
    block: isMobile ? 'nearest' : 'end',
    inline: 'nearest'
  };

  const scrollThreshold = isMobile ? 100 : 300;
  const fromBottom =
    chatHistory.scrollHeight - (chatHistory.scrollTop + chatHistory.clientHeight);

  if (fromBottom <= scrollThreshold) {
    setTimeout(() => {
      element.scrollIntoView(scrollOptions);
    }, isMobile ? 50 : 100);
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
  return `
    <div class="file-citation" 
         role="region" 
         aria-label="Document reference ${index}"
         tabindex="0">
      <div class="citation-header" id="citation-heading-${index}">
        <span class="citation-number" aria-label="Reference number">[${index}]</span>
        <span class="citation-file" aria-label="Source document">
          ${citation.file_name}
        </span>
      </div>
      <div class="citation-quote" aria-label="Relevant excerpt">
        ${citation.quote}
      </div>
    </div>
  `;
}

/**
 * Add custom styles for citations block, if needed.
 */
function addCitationStyles() {
  if (document.getElementById('citation-styles')) return;

  const style = document.createElement('style');
  style.id = 'citation-styles';
  style.textContent = `
    .citations-container {
      margin-top: 1.5em;
      padding-top: 1em;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
    }
    .citations-header {
      display: flex;
      align-items: center;
      gap: 0.5em;
      font-weight: 600;
      color: #4b5563;
      margin-bottom: 1em;
    }
    .file-citation {
      margin: 1em 0;
      padding: 1em;
      background: rgba(59, 130, 246, 0.05);
      border-radius: 8px;
      border-left: 3px solid #3b82f6;
    }
    .citation-number {
      color: #3b82f6;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .citation-file {
      color: #6b7280;
      font-size: 0.9em;
    }
    .citation-quote {
      color: #1f2937;
      font-style: italic;
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);
}

/**
 * If you want to reuse the UI token usage display in this same file, you can define it here.
 * Otherwise, you might already have a function in /static/js/utils/helpers.js or somewhere else.
 */
export function updateTokenUsage(usage) {
  const tokenDisplay = document.getElementById('token-usage');
  if (tokenDisplay) {
    tokenDisplay.innerHTML = `
      Prompt: ${usage.prompt_tokens} tokens<br>
      Completion: ${usage.completion_tokens} tokens<br>
      Total: ${usage.total_tokens} tokens
    `;
  }
}
