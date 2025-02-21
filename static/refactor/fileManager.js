import { sessionId, initializeSession } from '../core/sessionManager.js';
import { showNotification } from '../ui/notificationManager.js';
import { formatFileSize } from '../utils/helpers.js';

// File upload handler with progress tracking
export async function handleFileUpload(file) {
    if (!sessionId) {
        const initialized = await initializeSession();
        if (!initialized) {
            showNotification("Failed to initialize session", "error");
            return;
        }
    }

    // Validate file type and size
    const validTypes = [
        'text/plain', 'text/markdown', 'text/csv', 'application/json',
        'text/javascript', 'text/html', 'text/css', 'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    const fileExt = file.name.split('.').pop().toLowerCase();
    if (!validTypes.includes(file.type) && !['txt', 'md', 'csv', 'json', 'js', 'html', 'css', 'pdf', 'doc', 'docx'].includes(fileExt)) {
        showNotification('Unsupported file type', 'error');
        return;
    }

    if (file.size > 512 * 1024 * 1024) {
        showNotification('File size exceeds 512MB limit', 'error');
        return;
    }

    // Create progress element
    const progressDiv = document.createElement('div');
    progressDiv.className = 'upload-progress';
    progressDiv.innerHTML = `
        <div class="file-info">
            <div class="filename">${file.name}</div>
            <div class="file-meta">${formatFileSize(file.size)}</div>
            <div class="upload-progress-bar">
                <div class="progress"></div>
            </div>
            <div class="upload-status"></div>
        </div>
    `;
    document.getElementById('file-list').prepend(progressDiv);

    try {
        // Prepare form data
        const formData = new FormData();
        formData.append("file", file);
        formData.append("session_id", sessionId);
        formData.append("purpose", "assistants");

        // Configure XHR with progress tracking
        const xhr = new XMLHttpRequest();
        const startTime = Date.now();
        
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = event.loaded / elapsed;
                const remaining = (event.total - event.loaded) / speed;
                
                progressDiv.querySelector('.progress').style.width = `${percent}%`;
                progressDiv.querySelector('.upload-status').textContent = 
                    `${percent.toFixed(1)}% • ${formatFileSize(speed)}/s • ${remaining.toFixed(1)}s remaining`;
            }
        };

        xhr.onload = async () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                await createVectorStore(data.file_id);
                progressDiv.querySelector('.upload-status').textContent = 'Processed successfully';
                progressDiv.querySelector('.progress').style.backgroundColor = '#4CAF50';
                setTimeout(() => progressDiv.remove(), 2000);
                await loadFilesList();
            } else {
                throw new Error(xhr.statusText);
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
        showNotification(`Upload failed: ${error.message}`, 'error');
    }
}

// Create vector store for uploaded file
async function createVectorStore(fileId) {
    try {
        const response = await fetch('/vector_store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                file_id: fileId,
                expires_after: { anchor: "last_active_at", days: 7 }
            })
        });

        if (!response.ok) {
            throw new Error('Failed to create search index');
        }
    } catch (error) {
        console.error('Vector store error:', error);
        showNotification('File uploaded but not searchable', 'warning');
    }
}

// Setup drag and drop functionality
export function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (!dropZone || !fileInput) return;

    const preventDefaults = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        dropZone.addEventListener(event, preventDefaults);
    });

    ['dragenter', 'dragover'].forEach(event => {
        dropZone.addEventListener(event, () => {
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(event => {
        dropZone.addEventListener(event, () => {
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        Array.from(files).forEach(handleFileUpload);
    });

    fileInput.addEventListener('change', (e) => {
        Array.from(e.target.files).forEach(handleFileUpload);
        fileInput.value = '';
    });
}

// Load and display uploaded files
export async function loadFilesList() {
    if (!sessionId) return;

    try {
        const response = await fetch(`/files/${sessionId}`);
        const { files } = await response.json();
        
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '';

        let totalSize = 0;
        files.forEach(file => {
            totalSize += file.size;
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <div class="filename">${file.filename}</div>
                    <div class="file-meta">
                        ${formatFileSize(file.size)} • 
                        ${new Date(file.uploaded_at).toLocaleDateString()}
                    </div>
                </div>
                <button class="delete-btn" onclick="deleteFile('${file.id}')">
                    ×
                </button>
            `;
            fileList.appendChild(fileItem);
        });

        document.getElementById('total-files').textContent = files.length;
        document.getElementById('total-storage').textContent = formatFileSize(totalSize);
    } catch (error) {
        showNotification('Failed to load files', 'error');
    }
}

// Delete a file
export async function deleteFile(fileId) {
    if (!sessionId || !fileId) return;

    try {
        const response = await fetch(`/files/${sessionId}/${fileId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Delete failed');
        
        await loadFilesList();
        showNotification('File deleted successfully', 'success');
    } catch (error) {
        showNotification('Failed to delete file', 'error');
    }
}
