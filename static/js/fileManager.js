import { showNotification } from '/static/js/ui/notificationManager.js';
import { formatFileSize } from './utils/helpers.js';

// File size limit in bytes (512MB)
const MAX_FILE_SIZE = 512 * 1024 * 1024;

// Initialize file list state
let uploadedFiles = new Map();

export async function loadFilesList() {
    try {
        const response = await fetch('/api/files/list');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const files = await response.json();
        updateFileList(files);
    } catch (error) {
        console.error('Error loading files:', error);
        showNotification('Failed to load files list', 'error');
    }
}

export function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // Handle file selection via input
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Handle drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    // Handle click to select files
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
}

async function handleFiles(fileList) {
    const files = Array.from(fileList);
    
    // Validate files
    const validFiles = files.filter(file => {
        if (file.size > MAX_FILE_SIZE) {
            showNotification(`File ${file.name} is too large (max 512MB)`, 'error');
            return false;
        }
        return true;
    });

    if (validFiles.length === 0) return;

    // Upload each valid file
    for (const file of validFiles) {
        await uploadFile(file);
    }
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        showNotification(`Uploaded ${file.name} successfully`, 'success');
        
        // Refresh file list
        await loadFilesList();

    } catch (error) {
        console.error('Error uploading file:', error);
        showNotification(`Failed to upload ${file.name}`, 'error');
    }
}

function updateFileList(files) {
    const fileList = document.getElementById('file-list');
    const totalFilesElement = document.getElementById('total-files');
    const totalCharsElement = document.getElementById('total-chars');
    const estimatedTokensElement = document.getElementById('estimated-tokens');

    // Clear existing list
    fileList.innerHTML = '';
    
    // Update stats
    let totalChars = 0;
    files.forEach(file => {
        totalChars += file.char_count || 0;
        
        const fileElement = createFileElement(file);
        fileList.appendChild(fileElement);
    });

    // Update statistics
    totalFilesElement.textContent = files.length;
    totalCharsElement.textContent = formatFileSize(totalChars);
    estimatedTokensElement.textContent = Math.ceil(totalChars / 4); // Rough estimate
}

function createFileElement(file) {
    const div = document.createElement('div');
    div.className = 'file-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = file.filename;
    
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = formatFileSize(file.size);
    
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-file';
    deleteButton.textContent = '×';
    deleteButton.setAttribute('aria-label', `Delete ${file.filename}`);
    deleteButton.onclick = () => deleteFile(file.filename);
    
    div.appendChild(nameSpan);
    div.appendChild(sizeSpan);
    div.appendChild(deleteButton);
    
    return div;
}

async function deleteFile(filename) {
    try {
        const response = await fetch(`/api/files/delete/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        showNotification(`Deleted ${filename} successfully`, 'success');
        await loadFilesList();

    } catch (error) {
        console.error('Error deleting file:', error);
        showNotification(`Failed to delete ${filename}`, 'error');
    }
}
