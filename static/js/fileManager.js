// fileManager.js - Enhanced file handling

// Import dependencies
import { getSessionId } from '/static/js/session.js';
import { showNotification } from '/static/js/ui/notificationManager.js';
import { formatFileSize } from '/static/js/utils/helpers.js';

// Initialize file manager state
let uploadedFiles = new Map();
let selectedFiles = new Set();
let useFileSearch = false;

export function initializeFileManager() {
    setupDragAndDrop();
    setupFileSelector();
    loadFilesList();
    setupMobileHandlers();
    
    // Initialize file search toggle
    const fileSearchToggle = document.getElementById('use-file-search');
    if (fileSearchToggle) {
        fileSearchToggle.addEventListener('change', (e) => {
            useFileSearch = e.target.checked;
            showNotification(`File search ${useFileSearch ? 'enabled' : 'disabled'}`, 'info');
        });
    }
}

export async function loadFilesList(retryCount = 0) {
    try {
        const sessionId = getSessionId();
        if (!sessionId) {
            console.warn('No session ID available');
            showNotification('Starting new session...', 'info');
            await initializeSession();
            return loadFilesList();
        }
        
        // Add timeout and retry logic
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`/api/files/${sessionId}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            // Try to get error details from response
            let errorDetails = '';
            try {
                const errorResponse = await response.json();
                errorDetails = errorResponse.detail || errorResponse.message || '';
            } catch (e) {}
            
            throw new Error(`HTTP ${response.status} - Failed to load files. ${errorDetails}`);
        }
        
        const filesData = await response.json();
        
        // Validate response structure
        if (!filesData?.files || !Array.isArray(filesData.files)) {
            throw new Error('Invalid files data format from server');
        }
        updateFileList(filesData.files);
        updateFileStats(filesData.total_count, filesData.total_size);
        
        // Save files to our state
        uploadedFiles.clear();
        filesData.files.forEach(file => {
            uploadedFiles.set(file.id, file);
        });
        
        return filesData;
    } catch (error) {
        console.error('File load error:', {
            error: error.message,
            stack: error.stack,
            retryCount
        });
        
        // Handle specific error cases
        let errorMessage = 'Failed to load files';
        let isRecoverable = true;
        
        if (error.message.includes('401')) {
            errorMessage = 'Session expired - redirecting...';
            isRecoverable = false;
            setTimeout(() => window.location.reload(), 2000);
        } else if (error.message.includes('500')) {
            errorMessage = 'Server error - try again later';
        } else if (error.name === 'AbortError') {
            errorMessage = 'Request timed out - check your connection';
        }
        
        showNotification(`${errorMessage} (${error.message})`, 'error', 
            isRecoverable ? [{
                label: 'Retry',
                action: () => loadFilesList(Math.min(retryCount + 1, 3))
            }] : null
        );

        // Exponential backoff retry for network errors
        if (isRecoverable && retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            return loadFilesList(retryCount + 1);
        }
        
        return { files: [], total_count: 0, total_size: 0 };
    }
}

export function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    
    if (!dropZone || !fileInput) {
        console.warn('File upload elements not found');
        return;
    }

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

const setupFileSelector = () => {
    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.addEventListener('click', (e) => {
            // Handle file selection
            const fileItem = e.target.closest('.file-item');
            if (fileItem && !e.target.closest('.delete-file')) {
                const fileId = fileItem.dataset.fileId;
                if (fileId) {
                    toggleFileSelection(fileId, fileItem);
                }
            }
        });
    }
    
    // Setup select all button
    const selectAllBtn = document.getElementById('select-all-files');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', toggleSelectAllFiles);
    }
};

const toggleFileSelection = (fileId, fileElement) => {
    if (selectedFiles.has(fileId)) {
        selectedFiles.delete(fileId);
        fileElement.classList.remove('selected');
    } else {
        selectedFiles.add(fileId);
        fileElement.classList.add('selected');
    }
    
    // Update UI to show selected files count
    updateSelectionStatus();
};

const toggleSelectAllFiles = () => {
    const fileElements = document.querySelectorAll('.file-item');
    
    // If all are selected, deselect all, otherwise select all
    const allSelected = selectedFiles.size === uploadedFiles.size;
    
    if (allSelected) {
        // Deselect all
        selectedFiles.clear();
        fileElements.forEach(el => el.classList.remove('selected'));
    } else {
        // Select all
        uploadedFiles.forEach((file, id) => {
            selectedFiles.add(id);
        });
        fileElements.forEach(el => el.classList.add('selected'));
    }
    
    updateSelectionStatus();
};

const updateSelectionStatus = () => {
    const statusElement = document.getElementById('file-selection-status');
    if (statusElement) {
        statusElement.textContent = selectedFiles.size > 0 
            ? `${selectedFiles.size} file(s) selected` 
            : 'No files selected';
    }
};

async function handleFiles(fileList) {
    const files = Array.from(fileList);
    
    // Get session ID
    const sessionId = getSessionId();
    if (!sessionId) {
        showNotification('No active session - please reload the page', 'error');
        return;
    }
    
    // Create progress UI
    const fileStatusContainer = document.getElementById('file-upload-status');
    if (fileStatusContainer) {
        fileStatusContainer.innerHTML = '';
        fileStatusContainer.style.display = 'block';
    }
    
    // Validate files
    const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512MB
    const validFiles = files.filter(file => {
        if (file.size > MAX_FILE_SIZE) {
            showNotification(`File ${file.name} is too large (max 512MB)`, 'error');
            return false;
        }
        
        // Get file extension
        const extension = file.name.split('.').pop().toLowerCase();
        const supportedExtensions = ['txt', 'md', 'pdf', 'docx', 'json', 'js', 'py', 'html', 'css'];
        
        if (!supportedExtensions.includes(extension)) {
            showNotification(`Unsupported file type: .${extension}`, 'error');
            return false;
        }
        
        return true;
    });

    if (validFiles.length === 0) return;
    
    // Create progress elements
    const progressElements = {};
    validFiles.forEach(file => {
        if (fileStatusContainer) {
            const fileElement = createFileProgressElement(file.name);
            fileStatusContainer.appendChild(fileElement);
            progressElements[file.name] = {
                container: fileElement,
                progressBar: fileElement.querySelector('.progress-bar-fill'),
                statusText: fileElement.querySelector('.file-status-text')
            };
        }
    });
    
    // Upload files in parallel; errors for individual uploads are caught
    const uploadPromises = validFiles.map(file => 
        uploadFileWithProgress(file, sessionId, progressElements[file.name])
            .catch(error => {
                // Error already notified in uploadFileWithProgress; return error info if needed.
                return { error, fileName: file.name };
            })
    );
    await Promise.all(uploadPromises);
    
    // Refresh file list once after all uploads complete
    await loadFilesList();
}

function createFileProgressElement(filename) {
    const container = document.createElement('div');
    container.className = 'file-upload-progress';
    
    const header = document.createElement('div');
    header.className = 'file-progress-header';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = filename;
    
    const statusText = document.createElement('span');
    statusText.className = 'file-status-text';
    statusText.textContent = 'Pending...';
    
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-bar-fill';
    progressFill.style.width = '0%';
    
    // Assemble the elements
    progressBar.appendChild(progressFill);
    header.appendChild(nameSpan);
    header.appendChild(statusText);
    container.appendChild(header);
    container.appendChild(progressBar);
    
    return container;
}

async function uploadFileWithProgress(file, sessionId, progressUI) {
    try {
        // Create form data
        const formData = new FormData();
        formData.append('file', file);
        formData.append('session_id', sessionId);
        formData.append('process_with_azure', useFileSearch);
        
        // Setup progress tracking with XMLHttpRequest
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && progressUI) {
                const percent = Math.round((event.loaded / event.total) * 100);
                progressUI.progressBar.style.width = `${percent}%`;
                progressUI.statusText.textContent = `Uploading: ${percent}%`;
            }
        };
        
        // Create a promise to handle the result
        const uploadPromise = new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (progressUI) {
                        progressUI.progressBar.style.width = '100%';
                        progressUI.statusText.textContent = 'Processing...';
                    }
                    
                    try {
                        const result = JSON.parse(xhr.responseText);
                        resolve(result);
                    } catch (e) {
                        reject(new Error('Invalid response format'));
                    }
                } else {
                    if (progressUI) {
                        progressUI.progressBar.classList.add('error');
                        progressUI.statusText.textContent = 'Failed';
                    }
                    reject(new Error(`HTTP error ${xhr.status}`));
                }
            };
            
            xhr.onerror = () => {
                if (progressUI) {
                    progressUI.progressBar.classList.add('error');
                    progressUI.statusText.textContent = 'Network error';
                }
                reject(new Error('Network error'));
            };
        });
        
        // Start upload
        xhr.open('POST', '/api/files/upload', true);
        xhr.send(formData);
        
        // Wait for upload to complete
        const result = await uploadPromise;
        
        // Update progress UI with result details
        if (progressUI) {
            if (result.chunks > 1) {
                progressUI.statusText.textContent = `Processed into ${result.chunks} chunks`;
            } else {
                progressUI.statusText.textContent = 'Completed';
            }
            
            if (result.azure_processing) {
                progressUI.container.classList.add('azure-processing');
                const azureIndicator = document.createElement('div');
                azureIndicator.className = 'azure-indicator';
                azureIndicator.innerHTML = '<span class="azure-icon">🔍</span> Azure processing';
                progressUI.container.appendChild(azureIndicator);
            }
        }
        
        showNotification(`Uploaded ${file.name} successfully`, 'success');
        return result;
    } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        showNotification(`Failed to upload ${file.name}: ${error.message}`, 'error');
        
        if (progressUI) {
            progressUI.progressBar.classList.add('error');
            progressUI.statusText.textContent = 'Failed: ' + error.message;
        }
        
        // Rethrow so that individual upload errors can be caught in the parallel batch
        throw error;
    }
}

function updateFileList(files) {
    const fileList = document.getElementById('file-list');
    if (!fileList) return;
    
    // Clear existing list
    fileList.innerHTML = '';
    
    if (files.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-files-message';
        emptyMessage.textContent = 'No files uploaded. Drop files above to add context.';
        fileList.appendChild(emptyMessage);
        return;
    }
    
    // Group files by parent/chunks with safe metadata checks
    const fileGroups = {};
    const standaloneFiles = [];
    
    files.forEach(file => {
        const metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
        if (metadata.parent_file_id) {
            const parentId = metadata.parent_file_id;
            if (!fileGroups[parentId]) {
                fileGroups[parentId] = { chunks: [] };
            }
            fileGroups[parentId].chunks.push(file);
        } else if (file.chunk_count > 1) {
            if (!fileGroups[file.id]) {
                fileGroups[file.id] = { parent: file, chunks: [] };
            } else {
                fileGroups[file.id].parent = file;
            }
        } else {
            standaloneFiles.push(file);
        }
    });
    
    // Add file groups first (files with chunks)
    Object.values(fileGroups).forEach(group => {
        if (group.parent) {
            const fileGroupElement = createFileGroupElement(group.parent, group.chunks);
            fileList.appendChild(fileGroupElement);
        }
    });
    
    // Then add standalone files
    standaloneFiles.forEach(file => {
        const fileElement = createFileElement(file);
        fileList.appendChild(fileElement);
    });
    
    // Update selection highlights
    updateSelectionHighlights();
}

function updateSelectionHighlights() {
    document.querySelectorAll('.file-item').forEach(el => {
        const fileId = el.dataset.fileId;
        if (fileId && selectedFiles.has(fileId)) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });
}

function createFileGroupElement(parentFile, chunks) {
    const container = document.createElement('div');
    container.className = 'file-group';
    
    // Create parent file element
    const parentElement = createFileElement(parentFile, true);
    parentElement.classList.add('file-parent');
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = 'toggle-chunks';
    toggleButton.innerHTML = '▾';
    toggleButton.title = 'Show/hide chunks';
    toggleButton.onclick = (e) => {
        e.stopPropagation();
        const chunksContainer = container.querySelector('.file-chunks');
        chunksContainer.classList.toggle('hidden');
        toggleButton.innerHTML = chunksContainer.classList.contains('hidden') ? '▸' : '▾';
    };
    
    parentElement.appendChild(toggleButton);
    container.appendChild(parentElement);
    
    // Create chunks container
    const chunksContainer = document.createElement('div');
    chunksContainer.className = 'file-chunks hidden';
    
    // Sort and add each chunk
    chunks.sort((a, b) => {
        const aIndex = a.metadata && a.metadata.chunk_index !== undefined ? a.metadata.chunk_index : 0;
        const bIndex = b.metadata && b.metadata.chunk_index !== undefined ? b.metadata.chunk_index : 0;
        return aIndex - bIndex;
    }).forEach(chunk => {
        const chunkElement = createFileElement(chunk, false, true);
        chunksContainer.appendChild(chunkElement);
    });
    
    container.appendChild(chunksContainer);
    return container;
}

function createFileElement(file, isParent = false, isChunk = false) {
    const div = document.createElement('div');
    div.className = `file-item ${isParent ? 'parent-file' : ''} ${isChunk ? 'chunk-file' : ''}`;
    div.dataset.fileId = file.id;
    
    // Add selected class if already selected
    if (selectedFiles.has(file.id)) {
        div.classList.add('selected');
    }
    
    // File type icon based on extension
    const fileIcon = document.createElement('span');
    fileIcon.className = 'file-icon';
    const fileType = file.filename.split('.').pop().toLowerCase();
    let iconText = '📄';
    
    switch (fileType) {
        case 'pdf': iconText = '📕'; break;
        case 'docx': case 'doc': iconText = '📝'; break;
        case 'json': iconText = '🔍'; break;
        case 'md': iconText = '📋'; break;
        case 'js': case 'py': case 'html': case 'css': iconText = '💻'; break;
    }
    fileIcon.textContent = iconText;
    
    // File name with chunk indicator if applicable
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    let displayName = file.filename;
    if (isChunk && file.metadata && file.metadata.chunk_index !== undefined) {
        displayName = `Chunk ${file.metadata.chunk_index + 1}`;
    }
    nameSpan.textContent = displayName;
    
    // File size and token count information
    const infoSpan = document.createElement('span');
    infoSpan.className = 'file-info';
    
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = formatFileSize(file.size);
    
    const tokenSpan = document.createElement('span');
    tokenSpan.className = 'file-tokens';
    tokenSpan.textContent = `~${file.token_count?.toLocaleString() || '0'} tokens`;
    
    infoSpan.appendChild(sizeSpan);
    infoSpan.appendChild(tokenSpan);
    
    // Add badge for multi-chunk files
    if (isParent && file.chunk_count > 1) {
        const chunkBadge = document.createElement('span');
        chunkBadge.className = 'chunk-badge';
        chunkBadge.textContent = `${file.chunk_count} chunks`;
        infoSpan.appendChild(chunkBadge);
    }
    
    // Azure processing badge if applicable
    if (file.metadata && file.metadata.azure_processing) {
        const azureBadge = document.createElement('span');
        azureBadge.className = 'azure-badge';
        
        if (file.metadata.azure_processing === 'completed') {
            azureBadge.textContent = '🔍 Searchable';
            azureBadge.title = 'This file can be searched with Azure OpenAI';
        } else if (file.metadata.azure_processing === 'scheduled' || file.metadata.azure_processing === 'started') {
            azureBadge.textContent = '⏳ Processing';
            azureBadge.title = 'File is being processed for search';
        } else {
            azureBadge.textContent = '❌ Failed';
            azureBadge.title = 'Azure processing failed';
        }
        
        infoSpan.appendChild(azureBadge);
    }
    
    // Delete button (not for chunks)
    if (!isChunk) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-file';
        deleteButton.textContent = '×';
        deleteButton.setAttribute('aria-label', `Delete ${file.filename}`);
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            deleteFile(file.id, file.filename);
        };
        div.appendChild(deleteButton);
    }
    
    // Assemble the file element
    div.appendChild(fileIcon);
    div.appendChild(nameSpan);
    div.appendChild(infoSpan);
    
    return div;
}

async function deleteFile(fileId, filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) {
        return;
    }
    
    try {
        const sessionId = getSessionId();
        const response = await fetch(`/api/files/${sessionId}/${fileId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        showNotification(`Deleted ${filename} successfully`, 'success');
        
        // Remove from selected files
        selectedFiles.delete(fileId);
        
        // Reload file list after deletion
        await loadFilesList();
    } catch (error) {
        console.error('Error deleting file:', error);
        showNotification(`Failed to delete ${filename}`, 'error');
    }
}

function updateFileStats(fileCount, totalSize) {
    // Update file statistics in the UI
    const totalFilesElement = document.getElementById('total-files');
    const totalSizeElement = document.getElementById('total-size');
    
    if (totalFilesElement) {
        totalFilesElement.textContent = fileCount;
    }
    
    if (totalSizeElement) {
        totalSizeElement.textContent = formatFileSize(totalSize);
    }
}

// Export functions and state needed by other modules
export function getSelectedFileIds() {
    return Array.from(selectedFiles);
}

export function getFilesForChat() {
    return {
        include_files: selectedFiles.size > 0,
        file_ids: Array.from(selectedFiles),
        use_file_search: useFileSearch
    };
}

function setupMobileHandlers() {
    document.querySelector('.mobile-tab-toggle')?.addEventListener('click', () => {
        document.querySelector('.sidebar').classList.toggle('active');
    });

    let dragTimeout;
    document.addEventListener('dragover', (e) => {
        if(isMobileDevice()) {
            clearTimeout(dragTimeout);
            const overlay = document.createElement('div');
            overlay.className = 'mobile-drag-overlay';
            overlay.textContent = 'Drop files to upload';
            document.body.appendChild(overlay);
        }
    });

    document.addEventListener('dragleave', (e) => {
        if(isMobileDevice()) {
            dragTimeout = setTimeout(() => {
                document.querySelector('.mobile-drag-overlay')?.remove();
            }, 100);
        }
    });

    document.addEventListener('drop', (e) => {
        if(isMobileDevice()) {
            document.querySelector('.mobile-drag-overlay')?.remove();
        }
    });
}
