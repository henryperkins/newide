import { showNotification } from './ui/notificationManager.js';

/**
 * Manages file uploads, file display, and related stats
 */
export class FileManager {
  constructor() {
    this.files = [];
    this.maxFileSize = 536870912; // 512MB
    this.maxFileCount = 10;
    this.allowedFileTypes = [
      'text/plain',
      'text/markdown',
      'application/json',
      'application/javascript',
      'text/html',
      'text/css',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    this.init();
  }
  
  /**
   * Initialize file upload functionality
   */
  init() {
    this.initElements();
    this.attachEventListeners();
    this.updateStats();

    // Mobile-specific init
    this.initMobileFileInput();
    this.initMobileNetworkHandling();
  }
  
  /**
   * Initialize DOM element references
   */
  initElements() {
    // File element references
    this.fileInput = document.getElementById('file-input');
    this.uploadButton = document.querySelector('.upload-button') || document.querySelector('button:has(.folder-icon)');
    this.dropArea = document.querySelector('.file-drop-area');
    this.fileList = document.createElement('div');
    this.fileList.className = 'space-y-2 max-h-96 overflow-y-auto mt-4';
    
    // Add the file list after the drop area
    if (this.dropArea) {
      this.dropArea.insertAdjacentElement('afterend', this.fileList);
    }
    
    // Stats elements
    this.totalFilesElement = document.getElementById('total-files');
    this.totalSizeElement = document.getElementById('total-size');
    this.estimatedTokensElement = document.getElementById('estimated-tokens');
    
    // Azure search toggle
    this.azureSearchToggle = document.getElementById('azure-search');
  }
  
  /**
   * Attach event listeners to file-related elements
   */
  attachEventListeners() {
    if (this.uploadButton) {
      this.uploadButton.addEventListener('click', () => this.fileInput.click());
    }
    
    if (this.fileInput) {
      this.fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
    }
    
    if (this.dropArea) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        this.dropArea.addEventListener(eventName, this.preventDefaults, false);
      });
      
      ['dragenter', 'dragover'].forEach(eventName => {
        this.dropArea.addEventListener(eventName, () => {
          this.dropArea.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20');
        });
      });
      
      ['dragleave', 'drop'].forEach(eventName => {
        this.dropArea.addEventListener(eventName, () => {
          this.dropArea.classList.remove('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20');
        });
      });
      
      this.dropArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        this.processFiles(files);
      });
    }
    
    if (this.azureSearchToggle) {
      this.azureSearchToggle.addEventListener('change', () => {
        if (this.azureSearchToggle.checked) {
          if (this.fileList) this.fileList.classList.add('opacity-50', 'pointer-events-none');
          showNotification('Azure Search enabled. File context will be handled by the search service.', 'info');
        } else {
          if (this.fileList) this.fileList.classList.remove('opacity-50', 'pointer-events-none');
        }
      });
    }
    
    // Global event for removing files
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-remove-btn')) {
        const fileId = e.target.dataset.fileId;
        if (fileId) {
          this.removeFile(fileId);
        }
      }
    });
  }
  
  /**
   * Prevent default behavior for drag and drop events
   * @param {Event} e The event object
   */
  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  /**
   * Handle file selection from file input
   * @param {Event} e The change event
   */
  handleFileSelection(e) {
    const files = e.target.files;
    this.processFiles(files);
    // Reset file input to allow re-selection of the same file
    e.target.value = '';
  }
  
  /**
   * Process selected files
   * @param {FileList} fileList The list of selected files
   */
  processFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    
    const formData = new FormData();
    if (window.globalStore && window.globalStore.sessionId) {
      formData.append('session_id', window.globalStore.sessionId);
    }

    // Check if adding these files would exceed the maximum
    if (this.files.length + fileList.length > this.maxFileCount) {
      showNotification(`You can only upload up to ${this.maxFileCount} files.`, 'warning');
      return;
    }
    
    // Show processing indicator
    const dropArea = this.dropArea;
    if (!dropArea) {
        console.warn("No file-drop-area element found. Creating fallback container...");
        const fallbackContainer = document.createElement('div');
        fallbackContainer.className = 'file-drop-area fallback-container border border-gray-300 dark:border-gray-700 p-4 mt-2 rounded';
        fallbackContainer.innerHTML = '<p class="text-sm text-gray-600 dark:text-gray-300">Drop files here or click the upload button.</p>';
        document.body.appendChild(fallbackContainer);
        this.dropArea = fallbackContainer;
    }
    const originalContent = this.dropArea.innerHTML;
    if (fileList.length > 3 || Array.from(fileList).some(f => f.size > 5 * 1024 * 1024)) {
      dropArea.innerHTML = `
        <div class="flex items-center justify-center">
          <svg class="animate-spin h-5 w-5 mr-3 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25 stroke-current" cx="12" cy="12" r="10" stroke-width="4"></circle>
            <path class="opacity-75 fill-current" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Processing ${fileList.length} file(s)...</span>
        </div>
      `;
    }
    
    // Process files with a small delay to allow UI update
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    
    setTimeout(() => {
      Array.from(fileList).forEach(file => {
        if (abortController.signal.aborted) return;
        const progress = this.showMobileProgress(file);
        if (file.type.startsWith('image/')) {
          this.compressImage(file, {
            quality: 0.8,
            maxWidth: 1080,
            maxHeight: 1080
          }).then(compressed => {
            this.uploadFile(compressed, progress);
          });
        } else {
          this.uploadFile(file, progress);
        }
      });
      
      this.updateStats();
      this.renderFileList();
      this.updateDropAreaMessage();
    }, 50);
  }
  
  /**
   * Validate and add a file to the managed files
   * @param {File} file The file to validate and add
   */
  validateAndAddFile(file) {
    // Check file size
    if (file.size > this.maxFileSize) {
      showNotification(`File ${file.name} exceeds the 20MB limit.`, 'error');
      return;
    }
    
    // Check file type
    const isAllowed = this.allowedFileTypes.includes(file.type) ||
                     file.name.endsWith('.py') || // Special handling for Python files
                     file.name.endsWith('.txt') ||
                     file.name.endsWith('.md') ||
                     file.name.endsWith('.json') ||
                     file.name.endsWith('.js') ||
                     file.name.endsWith('.html') ||
                     file.name.endsWith('.css');
    
    if (!isAllowed) {
      showNotification(`File type not supported: ${file.type || file.name.split('.').pop()}`, 'warning');
      return;
    }
    
    // Add the file with a unique ID
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    this.files.push({
      id: fileId,
      file: file,
      name: file.name,
      size: file.size,
      type: file.type,
      uploaded: new Date(),
      estimatedTokens: this.estimateTokens(file)
    });
  }

  /* Mobile-friendly upload using XHR */
  uploadFile(file, progress) {
    const controller = new AbortController();
    const xhr = new XMLHttpRequest();
    
    // Mobile-friendly timeout
    const effectiveType = navigator.connection?.effectiveType || 'wifi';
    const timeout = effectiveType === 'cellular' ? 30000 : 15000;
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        const bar = progress.querySelector('.bg-blue-500');
        if (bar) bar.style.width = `${percent}%`;
        const label = progress.querySelector('.text-gray-500');
        if (label) label.textContent = `${percent}%`;
      }
    });
    
    xhr.open('POST', '/api/files/upload', true);
    
    xhr.setRequestHeader('X-Mobile-Network', effectiveType);
    xhr.setRequestHeader('X-Connection-Save', 'true');
    
    xhr.timeout = timeout;
    
    xhr.addEventListener('error', () => {
      if (navigator.onLine) {
        this.retryUpload(file);
      } else {
        this.queueUpload(file);
      }
    });
    
    xhr.ontimeout = () => {
      this.queueUpload(file);
    };

    const formData = new FormData();
    if (window.globalStore && window.globalStore.sessionId) {
      formData.append('session_id', window.globalStore.sessionId);
    }
    formData.append('file', file);
    
    xhr.send(formData);
  }

  /**
   * Estimate the number of tokens a file might contain
   * @param {File} file The file to estimate tokens for
   * @returns {number} Estimated token count
   */
  estimateTokens(file) {
    // Very rough estimation: ~1 token per 4 characters for text files
    // PDF and DOCX would need more sophisticated estimation
    const isPDF = file.type === 'application/pdf';
    const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                  file.type === 'application/msword';
    
    if (isPDF) {
      // Rough estimation for PDF: ~100 tokens per KB
      return Math.round(file.size / 1024 * 100);
    } else if (isDocx) {
      // Rough estimation for DOCX: ~200 tokens per KB (less efficient than plain text)
      return Math.round(file.size / 1024 * 200);
    } else {
      // Text-based files
      return Math.round(file.size / 4);
    }
  }
  
  /**
   * Remove a file from the managed files
   * @param {string} fileId The ID of the file to remove
   */
  removeFile(fileId) {
    const fileIndex = this.files.findIndex(f => f.id === fileId);
    if (fileIndex !== -1) {
      this.files.splice(fileIndex, 1);
      this.updateStats();
      this.renderFileList();
      this.updateDropAreaMessage();
    }
  }
  
  /**
   * Update the file statistics display
   */
  updateStats() {
    if (this.totalFilesElement) {
      this.totalFilesElement.textContent = this.files.length;
    }
    
    if (this.totalSizeElement) {
      this.totalSizeElement.textContent = this.formatFileSize(
        this.files.reduce((total, file) => total + file.size, 0)
      );
    }
    
    if (this.estimatedTokensElement) {
      const totalTokens = this.files.reduce((total, file) => total + (file.estimatedTokens || 0), 0);
      this.estimatedTokensElement.textContent = totalTokens.toLocaleString();
    }
  }
  
  /**
   * Format file size in human-readable format
   * @param {number} bytes The file size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Render the list of uploaded files
   */
  renderFileList() {
    if (!this.fileList) return;
    
    this.fileList.innerHTML = '';
    
    if (this.files.length === 0) return;
    
    this.files.forEach(file => {
      const fileItem = document.createElement('div');
      fileItem.className = 'flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded';
      fileItem.setAttribute('aria-label', `File: ${file.name}`);
      
      const fileTypeIcon = this.getFileTypeIcon(file.type, file.name);
      
      fileItem.innerHTML = `
        <div class="flex items-center space-x-2 overflow-hidden">
          <span class="text-gray-500 dark:text-gray-400">${fileTypeIcon}</span>
          <span class="text-sm text-gray-800 dark:text-gray-200 truncate" title="${file.name}">${file.name}</span>
        </div>
        <div class="flex items-center space-x-2">
          <span class="text-xs text-gray-500 dark:text-gray-400">${this.formatFileSize(file.size)}</span>
          <button 
            class="file-remove-btn text-red-500 hover:text-red-700 dark:hover:text-red-400 focus:outline-none" 
            data-file-id="${file.id}"
            aria-label="Remove file ${file.name}">
            ×
          </button>
        </div>
      `;
      
      this.fileList.appendChild(fileItem);
    });
  }
  
  /**
   * Update the drop area message based on file count
   */
  updateDropAreaMessage() {
    if (!this.dropArea) return;
    
    const messageContainer = this.dropArea.querySelector('.drop-message') || this.dropArea.querySelector('p:first-child');
    const hintContainer = this.dropArea.querySelector('.drop-hint') || this.dropArea.querySelector('p:last-child');
    
    if (messageContainer) {
      if (this.files.length > 0) {
        messageContainer.textContent = `${this.files.length} file(s) uploaded.`;
        if (hintContainer) {
          hintContainer.textContent = 'Drop more files here or click to add more.';
        }
      } else {
        messageContainer.textContent = 'No files uploaded.';
        if (hintContainer) {
          hintContainer.textContent = 'Drop files here to add context.';
        }
      }
    }
  }
  
  /**
   * Get an appropriate icon for a file type
   * @param {string} fileType The MIME type of the file
   * @param {string} fileName The name of the file (used for fallback detection)
   * @returns {string} Icon HTML
   */
  getFileTypeIcon(fileType, fileName) {
    // Extract extension from the file name
    const extension = fileName.split('.').pop().toLowerCase();
    
    // Determine icon based on file type or extension
    if (fileType === 'application/pdf' || extension === 'pdf') {
      return '📄';
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
               fileType === 'application/msword' ||
               extension === 'doc' || 
               extension === 'docx') {
      return '📝';
    } else if (fileType === 'text/csv' || extension === 'csv') {
      return '📊';
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
               extension === 'xlsx' || 
               extension === 'xls') {
      return '📊';
    } else if (fileType === 'application/json' || extension === 'json') {
      return '{ }';
    } else if (fileType === 'text/javascript' || extension === 'js') {
      return '📜';
    } else if (fileType === 'text/html' || extension === 'html') {
      return '🌐';
    } else if (fileType === 'text/css' || extension === 'css') {
      return '🎨';
    } else if (extension === 'py') {
      return '🐍';
    } else if (fileType === 'text/markdown' || extension === 'md') {
      return '📑';
    } else {
      return '📄';
    }
  }
  
  /**
   * Get the current files for context processing
   * @returns {File[]} Array of File objects
   */
  getFiles() {
    return this.files.map(f => f.file);
  }
  
  /**
   * Get IDs of currently uploaded files for sending to the API
   * @returns {string[]} Array of file IDs
   */
  getFileIds() {
    return this.files.map(f => f.id);
  }
  
  /**
   * Check if Azure Search is enabled
   * @returns {boolean} True if Azure Search is enabled
   */
  isAzureSearchEnabled() {
    return this.azureSearchToggle && this.azureSearchToggle.checked;
  }
  
  /**
   * Clear all uploaded files
   */
  clearFiles() {
    this.files = [];
    this.updateStats();
    this.renderFileList();
    this.updateDropAreaMessage();
  }
  
  /**
   * Check if any files are uploaded
   * @returns {boolean} True if there are uploaded files
   */
  hasFiles() {
    return this.files.length > 0;
  }
  
  /**
   * Get the total token estimation for all files
   * @returns {number} Total estimated tokens
   */
  getTotalTokenEstimation() {
    return this.files.reduce((total, file) => total + (file.estimatedTokens || 0), 0);
  }

  // Mobile-specific file input handling
  initMobileFileInput() {
    const mobileInput = document.createElement('input');
    mobileInput.type = 'file';
    mobileInput.id = 'mobile-file-input';
    mobileInput.accept = '.txt,.pdf,.docx,image/*,video/*,audio/*';
    mobileInput.multiple = true;
    mobileInput.capture = 'environment'; // For camera access
    mobileInput.style.display = 'none';
    
    // Mobile-specific attributes
    mobileInput.setAttribute('webkitdirectory', '');
    mobileInput.setAttribute('allowdirs', '');
    
    document.body.appendChild(mobileInput);
    
    // Enhanced mobile click handler
    if (this.uploadButton) {
      this.uploadButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.showMobileSourceSelector();
      }, { passive: true });
    }
  }

  showMobileSourceSelector() {
    const sources = {
      '📁 Files': () => document.getElementById('mobile-file-input').click(),
      '📸 Camera': () => document.getElementById('mobile-file-input').capture = 'environment',
      '☁️ Cloud': () => this.handleCloudStorage()
    };
    
    // Create mobile-first action sheet
    const sheet = document.createElement('div');
    sheet.className = 'mobile-source-sheet fixed bottom-0 w-full bg-white dark:bg-gray-800 shadow-lg';
    
    sheet.innerHTML = `
      <div class="p-4 space-y-2">
        ${Object.entries(sources).map(([label, action]) => `
          <button class="mobile-source-btn w-full p-3 text-left rounded-lg bg-gray-100 dark:bg-gray-700">
            ${label}
          </button>
        `).join('')}
        <button class="cancel-btn w-full p-3 text-center text-red-500">Cancel</button>
      </div>
    `;

    // Add handlers
    sheet.querySelectorAll('.mobile-source-btn').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const action = Object.values(sources)[index];
        sheet.remove();
        action();
      });
    });

    sheet.querySelector('.cancel-btn').addEventListener('click', () => {
      sheet.remove();
    });

    document.body.appendChild(sheet);
  }

  showMobileProgress(file) {
    const progress = document.createElement('div');
    progress.className = 'mobile-upload-progress fixed bottom-20 left-4 right-4 bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg';
    
    progress.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <div class="text-sm font-medium">${file.name}</div>
          <div class="h-1 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
            <div class="h-full bg-blue-500 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
        </div>
        <div class="text-xs text-gray-500">0%</</div>
      </div>
    `;

    document.body.appendChild(progress);
    return progress;
  }

  initMobileNetworkHandling() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.pauseUploads();
      } else {
        this.resumeUploads();
      }
    });
    
    window.addEventListener('online', () => {
      this.retryFailedUploads();
    });
  }

  pauseUploads() {
    // Stub for demonstration
    console.log('Uploads paused (app background/hidden).');
  }

  resumeUploads() {
    // Stub for demonstration
    console.log('Uploads resumed (app foreground/visible).');
  }

  retryFailedUploads() {
    // Stub for demonstration
    console.log('Retrying failed uploads...');
  }

  handleCloudStorage() {
    // Stub for cloud storage integration
    console.log('Opening cloud storage...');
  }

  compressImage(file, options) {
    // Stub for demonstration
    console.log('Compressing image:', file.name, options);
    return Promise.resolve(file);
  }
}

// Create and export a singleton instance
const fileManager = new FileManager();
export default fileManager;
