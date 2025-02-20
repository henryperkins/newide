// file.js
import { getSessionId } from './state.js';
import { showNotification } from './ui.js';
import { initializeSession } from './session.js';

export async function handleFileUpload(file) {
    let sessionId = getSessionId();
    if (!sessionId) {
        showNotification("Session not initialized. Initializing...", "warning");
        const initialized = await initializeSession();
        if (!initialized) {
            showNotification("Failed to initialize session. Please refresh.", "error");
            return;
        }
        sessionId = getSessionId();
    }

    if (file.size > 512 * 1024 * 1024) {
        showNotification('File size must be under 512MB', 'error');
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append('session_id', sessionId);
    formData.append('purpose', 'assistants');

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        showNotification(`${file.name} uploaded successfully`, 'success');
        await loadFilesList();
    } catch (error) {
        console.error('Error uploading file:', error);
        showNotification(`Error uploading ${file.name}: ${error.message}`, 'error');
    }
}

export async function loadFilesList() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    try {
        const response = await fetch(`/files/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '';

        data.files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">${file.filename}</div>
                <button class="delete-file" onclick="deleteFile('${file.id}')">×</button>
            `;
            fileList.appendChild(fileItem);
        });
    } catch (error) {
        console.error('Error loading files list:', error);
        showNotification('Error loading files list', 'error');
    }
}

export async function deleteFile(fileId) {
    const sessionId = getSessionId();
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

export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}