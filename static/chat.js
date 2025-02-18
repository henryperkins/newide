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
        if (data.usage) {
            updateTokenUsage(data.usage);
        }

        if (data.using_file_context) {
            showNotification('Response includes context from uploaded files', 'info');
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


function configureMarkedWithHighlight() {
    if (typeof marked === 'undefined') {
        console.error('marked is not available. Please ensure marked.min.js is loaded.');
        return false;
    }
    if (typeof hljs === 'undefined') {
        console.error('highlight.js is not available. Please ensure highlight.min.js is loaded.');
        return false;
    }
    marked.setOptions({
        highlight: (code, lang) => {
            if (hljs.getLanguage(lang)) {
                return hljs.highlight(code, {language: lang}).value;
            }
            return hljs.highlightAuto(code).value;
        }
    });
    return true;
}
// Show typing indicator
function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    document.getElementById('chat-history').appendChild(typingDiv);
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

    // Create copy button
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.innerHTML = '<i class="far fa-copy"></i>';
    copyButton.title = "Copy to clipboard";
    copyButton.onclick = () => copyToClipboard(message);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Render content based on role
if (role === 'assistant') {
    contentDiv.innerHTML = safeMarkdownParse(message);
} else {
    // For user messages, use safeMarkdownParse
    contentDiv.innerHTML = safeMarkdownParse(message);
    }
    
    // Apply syntax highlighting to any code blocks
    contentDiv.querySelectorAll('pre code').forEach((block) => {
        Prism.highlightAllUnder(block.parentElement);
    });

    messageDiv.appendChild(copyButton);
    messageDiv.appendChild(contentDiv);
    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
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

    // More robust file type checking
    const isTextFile = file.type === 'text/plain' || 
                      file.name.toLowerCase().endsWith('.txt') ||
                      file.type.startsWith('text/');

    if (!isTextFile) {
        showNotification('Only text files are supported', 'error');
        return;
    }

    if (file.size > 512 * 1024 * 1024) { // 512MB limit
        showNotification('File size must be under 512MB', 'error');
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append('session_id', sessionId);

    // Create upload progress element
    const progressDiv = document.createElement('div');
    progressDiv.className = 'upload-progress';
    progressDiv.innerHTML = `
        <div class="file-info">
            <div class="filename">${file.name}</div>
            <div class="upload-progress-header">
                <span class="upload-progress-percent">0%</span>
            </div>
            <div class="upload-progress-bar">
                <div class="progress progress-0"></div>
            </div>
        </div>
    `;
    document.getElementById('file-list').prepend(progressDiv);

    try {
        const xhr = new XMLHttpRequest();
        
        // Track upload progress
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                progressDiv.querySelector('.progress').style.width = percentComplete + '%';
                progressDiv.querySelector('.upload-progress-percent').textContent = 
                    Math.round(percentComplete) + '%';
            }
        };

        // Handle completion
        xhr.open('POST', '/upload', true);
        
        xhr.onload = async () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                showNotification(`${file.name} uploaded successfully`, 'success');
                await loadFilesList(); // Refresh file list
            } else {
                try {
                    const errorData = JSON.parse(xhr.responseText);
                    throw new Error(`Upload failed: ${errorData.detail || xhr.statusText}`);
                } catch (parseError) {
                    throw new Error(`Upload failed: ${xhr.statusText}`);
                }
            }
            progressDiv.remove();
        };

        // Handle errors
        xhr.onerror = () => {
            progressDiv.remove();
            showNotification(`Failed to upload ${file.name}`, 'error');
        };

        xhr.send(formData);

    } catch (error) {
        progressDiv.remove();
        console.error('Error uploading file:', error);
        showNotification(`Error uploading ${file.name}: ${error.message}`, 'error');
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
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">×</button>
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);  // Auto-dismiss after 5 seconds
}

// Switch tab (token-stats, file-stats)
function switchTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(button => 
        button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => 
        content.classList.remove('active'));
    
    document.querySelector(`button[onclick="switchTab('${tabId}')"]`)
        .classList.add('active');
    document.getElementById(tabId).classList.add('active');
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
                        ~${file.estimated_tokens} tokens
                    </div>
                </div>
                <div class="file-actions">
                    <button class="delete-file" onclick="deleteFile('${file.file_id}')">×</button>
                </div>
            `;
            fileList.appendChild(fileItem);

            totalChars += file.char_count;
            estimatedTokens += file.estimated_tokens;
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
        if (!configureMarkedWithHighlight()) {
            showNotification("Warning: Some formatting features may not work properly", "warning");
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
        await loadFilesList();
        
        console.log("Initialization complete. Session ID:", sessionId);
    } catch (error) {
        console.error('Error during initialization:', error);
        showNotification("Critical error: Failed to initialize application", "error");
    }
});
