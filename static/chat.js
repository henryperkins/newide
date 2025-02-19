/* eslint-disable */
/* @ts-nocheck */
// Global state
let sessionId = null;
let lastUserMessage = null;

// Initialize session when the page loads
async function initializeSession() {
    try {
        const response = await fetch('/new_session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.session_id) {
            throw new Error("Invalid session ID received");
        }
        
        sessionId = data.session_id;
        console.log("Session initialized with ID:", sessionId);
        return true;
    } catch (error) {
        console.error('Error initializing session:', error);
        showNotification('Failed to initialize session: ' + error.message, 'error');
        return false;
    }
}

// Send Message
async function sendMessage() {
    console.log("sendMessage function called");
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (!message) {
        console.log("No message to send");
        return;
    }

    // Ensure session is initialized
    if (!sessionId) {
        showNotification("Session not initialized. Initializing...", "warning");
        const initialized = await initializeSession();
        if (!initialized) {
            showNotification("Failed to initialize session. Please refresh the page.", "error");
            return;
        }
    }

    try {
        userInput.disabled = true;  // Disable input while processing
        lastUserMessage = message;
        displayMessage(message, 'user');
        userInput.value = '';
        showTypingIndicator();

        const developerConfig = document.getElementById('developer-config').value.trim();
        const effortMap = ['low', 'medium', 'high'];
        const reasoningEffort = effortMap[document.getElementById('reasoning-effort-slider').value];

        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                session_id: sessionId,
                developer_config: developerConfig || undefined,
                reasoning_effort: reasoningEffort || undefined
            })
        });

        if (response.status === 400) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Invalid request');
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.response) {
            throw new Error('No response received from server');
        }

        displayMessage(data.response, 'assistant');
        
        // Display enhanced token metrics
        const usageHtml = `
            <div class="metric-display bg-blue-50 p-3 rounded-lg mt-4">
                <h4 class="font-semibold text-blue-800 mb-2">Azure OpenAI Token Usage</h4>
                <div class="grid grid-cols-3 gap-4 text-sm">
                    <div class="metric-item">
                        <span class="font-medium">Total:</span>
                        <span class="text-blue-600">${data.usage.total_tokens}</span>
                    </div>
                    <div class="metric-item">
                        <span class="font-medium">Prompt:</span>
                        <span class="text-blue-600">${data.usage.prompt_tokens}</span>
                    </div>
                    <div class="metric-item">
                        <span class="font-medium">Completion:</span>
                        <span class="text-blue-600">${data.usage.completion_tokens}</span>
                    </div>
                </div>
                ${data.using_file_context ?
                    `<div class="mt-3 text-xs text-blue-700">
                        Includes token context from uploaded files
                    </div>` : ''}
            </div>
        `;
        document.querySelector('.message.assistant-message:last-child .message-content').insertAdjacentHTML('beforeend', usageHtml);

        if (data.usage) {
            updateTokenUsage(data.usage);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        displayMessage('Error: Could not send message. Please try again.', 'error');
        showNotification(error.message, 'error');
    } finally {
        removeTypingIndicator();
        userInput.disabled = false; // Re-enable input
    }
}

// Regenerate response using the last user message
async function regenerateResponse() {
    if (lastUserMessage) {
        const userInput = document.getElementById('user-input');
        userInput.value = lastUserMessage;
        await sendMessage();
    }
}

// Initialize markdown parser
let mdParser = null;
if (typeof markdownit !== 'undefined') {
  mdParser = markdownit({
    highlight: function (str, lang) {
      // Switch to using highlight.js instead of Prism for consistency
      if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
        return hljs.highlight(str, { language: lang }).value;
      } else if (typeof hljs !== "undefined") {
        return hljs.highlightAuto(str).value;
      }
      return str;
    }
  });
}

// Helper function for safe markdown parsing
function safeMarkdownParse(text) {
    if (!mdParser) {
        // Fallback if markdownit is not defined
        return text;
    }
    try {
        return mdParser.render(text);
    } catch (e) {
        console.error('Markdown parsing error:', e);
        return text; // Fallback to raw text
    }
}

// Configures the marked library to use Prism for syntax highlighting
// Requires both marked and Prism libraries to be loaded
function configureMarkdownWithPrism() {
    if (typeof marked === 'undefined') {
        console.error('marked is not available. Please ensure marked.min.js is loaded.');
        return false;
    }
    if (typeof Prism === 'undefined') {
        console.error('Prism is not available. Please ensure prism.js is loaded.');
        return false;
    }

    marked.setOptions({
        highlight: (code, lang) => {
            // Attempt to use specified language, fall back to auto-detection if not available
            return Prism.highlight(code, Prism.languages[lang] || Prism.languages.auto, lang);
        }
    });
    return true;
}

// Show typing indicator
function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    
    // Create dots with staggered animation
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.style.animationDelay = `${i * 0.15}s`;
        typingDiv.appendChild(dot);
    }

    document.getElementById('chat-history').appendChild(typingDiv);
    typingDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Remove typing indicator
function removeTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

// Display messages in the chat history
function displayMessage(message, role) {
    const chatHistory = document.getElementById('chat-history');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;
    
    // Add entrance animation
    messageDiv.style.opacity = '0';
    messageDiv.style.transform = 'translateY(20px)';

    // Create copy button with improved UI
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.innerHTML = '<i class="far fa-copy"></i>';
    copyButton.title = "Copy to clipboard";
    copyButton.onclick = () => copyToClipboard(message);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Render content with improved markdown parsing
    if (role === 'assistant') {
        contentDiv.innerHTML = safeMarkdownParse(message);
        
        // Add syntax highlighting with animation
        contentDiv.querySelectorAll('pre code').forEach((block) => {
            block.style.opacity = '0';
            Prism.highlightElement(block);
            setTimeout(() => {
                block.style.opacity = '1';
                block.style.transition = 'opacity 0.3s ease';
            }, 100);
        });
    } else {
        contentDiv.innerHTML = safeMarkdownParse(message);
    }

    messageDiv.appendChild(copyButton);
    messageDiv.appendChild(contentDiv);
    chatHistory.appendChild(messageDiv);

    // Animate message entrance
    requestAnimationFrame(() => {
        messageDiv.style.transition = 'all 0.3s ease';
        messageDiv.style.opacity = '1';
        messageDiv.style.transform = 'translateY(0)';
    });

    // Smooth scroll to new message
    setTimeout(() => {
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
}

// Copy text to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Text copied to clipboard', 'success');
    }).catch(err => {
        console.error('Failed to copy text:', err);
        showNotification('Failed to copy text to clipboard', 'error');
    });
}

// File upload handler
async function handleFileUpload(file) {
    if (!sessionId) {
        showNotification("Session not initialized. Initializing...", "warning");
        const initialized = await initializeSession();
        if (!initialized) {
            showNotification("Failed to initialize session. Please refresh.", "error");
            return;
        }
    }

    // More comprehensive file type checking
    const acceptedTypes = [
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'text/javascript',
        'text/html',
        'text/css'
    ];

    const isAcceptedType = acceptedTypes.includes(file.type) ||
                          /\.(txt|md|csv|json|js|html|css)$/i.test(file.name);

    if (!isAcceptedType) {
        showNotification('Unsupported file type. Please upload a text-based file.', 'error');
        return;
    }

    if (file.size > 512 * 1024 * 1024) {
        showNotification('File size must be under 512MB', 'error');
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append('session_id', sessionId);

    // Create enhanced upload progress element
    const progressDiv = document.createElement('div');
    progressDiv.className = 'upload-progress';
    progressDiv.innerHTML = `
        <div class="file-info">
            <div class="filename">${file.name}</div>
            <div class="upload-progress-header">
                <span class="upload-progress-percent">0%</span>
                <span class="file-size">${formatFileSize(file.size)}</span>
            </div>
            <div class="upload-progress-bar">
                <div class="progress progress-0"></div>
            </div>
        </div>
    `;
    document.getElementById('file-list').prepend(progressDiv);

    try {
        const xhr = new XMLHttpRequest();
        
        // Enhanced upload progress tracking
        const startTime = Date.now();
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                const progress = progressDiv.querySelector('.progress');
                const percent = progressDiv.querySelector('.upload-progress-percent');
                
                // Smooth progress bar animation
                progress.style.transition = 'width 0.3s ease';
                progress.style.width = percentComplete + '%';
                percent.textContent = Math.round(percentComplete) + '%';
                
                // Add upload speed and time remaining
                const speed = event.loaded / ((Date.now() - startTime) / 1000);
                const remaining = (event.total - event.loaded) / speed;
                const speedText = formatFileSize(speed) + '/s';
                const timeText = remaining > 1 ?
                    `${Math.ceil(remaining)}s remaining` :
                    'Almost done...';
                
                progressDiv.querySelector('.file-size').textContent =
                    `${speedText} - ${timeText}`;
            }
        };

        // Handle completion
        xhr.onload = async () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                showNotification(`${file.name} uploaded successfully`, 'success');
                await loadFilesList();
                
                // Animate progress bar completion
                const progress = progressDiv.querySelector('.progress');
                progress.style.backgroundColor = '#22c55e';
                setTimeout(() => progressDiv.remove(), 1000);
            } else {
                throw new Error(JSON.parse(xhr.responseText).detail || xhr.statusText);
            }
        };

        xhr.onerror = () => {
            progressDiv.remove();
            showNotification(`Failed to upload ${file.name}`, 'error');
        };

        xhr.open('POST', '/upload', true);
        xhr.send(formData);

    } catch (error) {
        progressDiv.remove();
        console.error('Error uploading file:', error);
        showNotification(
            `Error uploading ${file.name}: ${error.message}`,
            'error'
        );
    }
}

// Update token usage
function updateTokenUsage(usage) {
    if (usage) {
        document.getElementById('prompt-tokens').textContent = usage.prompt_tokens || 0;
        document.getElementById('completion-tokens').textContent = usage.completion_tokens || 0;
        document.getElementById('total-tokens').textContent = usage.total_tokens || 0;
    }
}

// Helper function to create a dismissible notification
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    // Add icon based on notification type
    const icon = type === 'success' ? '✓' :
                type === 'error' ? '✕' : 'ℹ';
    
    notification.innerHTML = `
        <span class="notification-icon">${icon}</span>
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;

    // Add to notification container or create one
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }

    container.appendChild(notification);

    // Animate entrance
    requestAnimationFrame(() => {
        notification.style.transform = 'translateX(0)';
        notification.style.opacity = '1';
    });

    // Auto-dismiss with fade out
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

// Switch tab (token-stats, file-stats)
function switchTab(tabId) {
    // Validate input
    if (!tabId) {
        console.error('switchTab: No tabId provided');
        return;
    }

    // Get elements safely
    const buttons = document.querySelectorAll('.tab-button');
    const contents = document.querySelectorAll('.tab-content');
    const targetButton = document.querySelector(`[data-target-tab="${tabId}"]`);
    const targetContent = document.getElementById(tabId);

    // Error checking
    if (!targetButton || !targetContent) {
        console.error(`switchTab: Elements not found for tabId "${tabId}"`);
        return;
    }

    // Update classes
    buttons.forEach(button => button.classList.remove('active'));
    contents.forEach(content => content.classList.remove('active'));
    
    targetButton.classList.add('active');
    targetContent.classList.add('active');

    // Update ARIA attributes for accessibility
    targetButton.setAttribute('aria-selected', 'true');
    targetContent.setAttribute('aria-hidden', 'false');
    
    // Update other buttons/content
    buttons.forEach(button => {
        if (button !== targetButton) {
            button.setAttribute('aria-selected', 'false');
        }
    });
    contents.forEach(content => {
        if (content !== targetContent) {
            content.setAttribute('aria-hidden', 'true');
        }
    });
}

// Load files list from the backend
async function loadFilesList() {
    if (!sessionId) return;

    try {
        const response = await fetch(`/files/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '';

        let totalChars = 0;
        let estimatedTokens = 0;

        data.files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <div>${file.filename}</div>
                    <div class="file-meta">
                        ${formatFileSize(file.size)} | ${file.char_count} chars | 
                        ~${file.token_count} tokens
                    </div>
                </div>
                <div class="file-actions">
                    <button class="delete-file" onclick="deleteFile('${file.file_id}')">×</button>
                </div>
            `;
            fileList.appendChild(fileItem);

            totalChars += file.char_count;
            estimatedTokens += file.token_count;
        });

        // Update statistics
        document.getElementById('total-files').textContent = data.files.length;
        document.getElementById('total-chars').textContent = totalChars;
        document.getElementById('estimated-tokens').textContent = estimatedTokens;

    } catch (error) {
        console.error('Error loading files list:', error);
        showNotification('Error loading files list', 'error');
    }
}

// Delete a file from the backend
async function deleteFile(fileId) {
    if (!sessionId || !fileId) return;

    try {
        const response = await fetch(`/files/${sessionId}/${fileId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        await loadFilesList();
        showNotification('File deleted successfully', 'success');
    } catch (error) {
        console.error('Error deleting file:', error);
        showNotification('Error deleting file', 'error');
    }
}

// Format file size for display
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Set up drag and drop
function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    ['dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            if (eventName === 'dragover') {
                dropZone.classList.add('drag-over');
            } else {
                dropZone.classList.remove('drag-over');
            }
        });
    });

    dropZone.addEventListener('drop', async (e) => {
        const files = e.dataTransfer.files;
        for (const file of files) {
            await handleFileUpload(file);
        }
    });

    fileInput.addEventListener('change', async () => {
        for (const file of fileInput.files) {
            await handleFileUpload(file);
        }
        fileInput.value = ''; // Reset input
    });
}
// Replace the DOMContentLoaded event listener as specified

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Initializing chat application...");
    
    try {
        // Configure markdown and syntax highlighting
        if (!configureMarkdownWithPrism()) {
            showNotification(
                "Warning: Markdown formatting and syntax highlighting may be limited due to missing dependencies",
                "warning"
            );
        }

        // Initialize session first
        const initialized = await initializeSession();
        if (!initialized) {
            showNotification("Failed to initialize application. Please refresh the page.", "error");
            return;
        }
        
        // Set up the send button handler
        const sendButton = document.getElementById('send-button');
        if (sendButton) {
            sendButton.onclick = async (e) => {
                e.preventDefault();
                await sendMessage();
            };
            console.log("Send button handler attached");
        } else {
            console.error("Send button not found in DOM");
        }
        
        // Set up enter key handler
        const userInput = document.getElementById('user-input');
        if (userInput) {
            userInput.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    await sendMessage();
                }
            });
            console.log("Enter key handler attached");
        } else {
            console.error("User input field not found in DOM");
        }
        
        // Initialize other components
        setupDragAndDrop();
        
        // Add tab event listeners
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.dataset.targetTab;
                if (tabId) {
                    switchTab(tabId);
                }
            });
        });
        
        await loadFilesList();
        
        console.log("Initialization complete. Session ID:", sessionId);
    } catch (error) {
        console.error('Error during initialization:', error);
        showNotification("Critical error: Failed to initialize application", "error");
    }
});
