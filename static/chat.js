// chat.js

let sessionId = null;
let lastUserMessage = null;

// Initialize session when the page loads
async function initializeSession() {
    try {
        const response = await fetch('http://localhost:8000/new_session', {
            method: 'POST'
        });
        const data = await response.json();
        sessionId = data.session_id;
        console.log("Session initialized with ID:", sessionId);
        if (!sessionId) {
            throw new Error("Failed to get session ID from server");
        }
    } catch (error) {
        console.error('Error initializing session:', error);
    }
}

// Send Message
async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (!message) return;

    lastUserMessage = message;
    displayMessage(message, 'user');
    userInput.value = '';
    userInput.disabled = true;  // Disable input while processing

    showTypingIndicator();
    const developerConfig = document.getElementById('developer-config').value.trim();
    const effortMap = ['low', 'medium', 'high'];
    const reasoningEffort = effortMap[document.getElementById('reasoning-effort-slider').value];
    

    try {
        const response = await fetch('http://localhost:8000/chat', {
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

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        displayMessage(data.response, 'assistant');
        updateTokenUsage(data.usage);

        // Show notification if the backend indicates file context usage
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

// Helper function for safe markdown parsing
function safeMarkdownParse(text) {
    try {
        return marked.parse(text);
    } catch (e) {
        console.error('Markdown parsing error:', e);
        return text; // Fallback to raw text
    }
}

// Configure marked.js with highlight.js
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(code, { language: lang }).value;
            } catch (err) {
                console.error('Error highlighting code:', err);
            }
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

// Show typing indicator
function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    document.getElementById('chat-history').appendChild(typingDiv);
}

// Remove typing indicator
function removeTypingIndicator() {
    document.querySelector('.typing-indicator')?.remove();
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
        // For assistant messages, use safe markdown parsing
        marked.setOptions({ sanitize: true });
        contentDiv.innerHTML = safeMarkdownParse(message);
    } else {
        // For user messages, sanitize HTML but still render markdown
        marked.setOptions({ sanitize: true });
        contentDiv.innerHTML = marked.parse(message);
    }
    
    // Apply syntax highlighting to any code blocks
    contentDiv.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    messageDiv.appendChild(copyButton);
    messageDiv.appendChild(contentDiv);
    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Copy text to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Could add a notification here
    }).catch(err => {
        console.error('Failed to copy text:', err);
    });
}

// More advanced file upload handler using XHR and progress tracking
async function handleFileUpload(file) {
    // Ensure sessionId is available
    if (!sessionId) {
        showNotification("Session not initialized. Attempting to reinitialize...", "warning");
        await initializeSession();
        if (!sessionId) {
            showNotification("Failed to initialize session. Please refresh.", "error");
            return;
        }
    }

    // Validate file type and size
    if (file.type !== 'text/plain') {
        showNotification('Only .txt files are supported', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
        showNotification('File size must be under 10MB', 'error');
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append('session_id', sessionId);

    // Create upload progress element
    const progressDiv = document.createElement('div');
    progressDiv.className = 'upload-progress';
    progressDiv.innerHTML = `
        <div class="upload-progress-header">
            <span>${file.name}</span>
            <span class="upload-progress-percent">0%</span>
        </div>
        <div class="upload-progress">
            <div class="upload-progress-bar" style="width: 0%"></div>
        </div>
    `;
    document.getElementById('file-list').prepend(progressDiv);

    try {
        const xhr = new XMLHttpRequest();
        
        // Track upload progress
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                progressDiv.querySelector('.upload-progress-bar').style.width = percentComplete + '%';
                progressDiv.querySelector('.upload-progress-percent').textContent = Math.round(percentComplete) + '%';
            }
        };

        // Handle completion
        xhr.open('POST', 'http://localhost:8000/upload', true);
        
        xhr.onload = async () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                showNotification(`${file.name} uploaded successfully`, 'success');
                await loadFilesList(); // Refresh file list
            } else {
                // Attempt to parse server's error message for more detail
                try {
                    const errorData = JSON.parse(xhr.responseText);
                    showNotification(errorData.detail, 'error');
                    throw new Error(`Upload failed: ${xhr.statusText} - ${errorData.detail}`);
                } catch (parseError) {
                    console.error('Error parsing server error response:', parseError);
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


        // Send the request with FormData
        xhr.send(formData);

    } catch (error) {
        progressDiv.remove();
        console.error('Error uploading file:', error);
        showNotification(`Error uploading ${file.name}: ${error.message}`, 'error');
    }
}

// Update token usage
function updateTokenUsage(usage) {
    document.getElementById('prompt-tokens').textContent = usage.prompt_tokens;
    document.getElementById('completion-tokens').textContent = usage.completion_tokens;
    document.getElementById('total-tokens').textContent = usage.total_tokens;
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
    // Remove active class from all tabs and contents
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to selected tab and content
    document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

// Load files list from the backend
async function loadFilesList() {
    try {
        const response = await fetch(`http://localhost:8000/files/${sessionId}`);
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
                        ${formatFileSize(file.size)} | ${file.char_count} chars | ~${file.estimated_tokens} tokens
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
    }
}

// Delete a file from the backend
async function deleteFile(fileId) {
    try {
        const response = await fetch(`http://localhost:8000/files/${sessionId}/${fileId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadFilesList();
        } else {
            console.error('Error deleting file');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
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

    // Open file dialog when clicking the drop zone
    dropZone.addEventListener('click', () => fileInput.click());

    // Handle drag events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        for (const file of files) {
            if (file.type === 'text/plain') {
                await handleFileUpload(file);
            }
        }
    });

    // Handle regular file input
    fileInput.addEventListener('change', async () => {
        for (const file of fileInput.files) {
            await handleFileUpload(file);
        }
        fileInput.value = ''; // Reset input
    });
}

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Initializing session, loading files list...");
    await initializeSession();
    setupDragAndDrop();
    await loadFilesList();
    console.log("Initialization complete. Session ID:", sessionId);
});
