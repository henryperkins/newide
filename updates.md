# Fixed Model Configuration Tab with Mobile Support

I'll provide a comprehensive solution to fix the Models tab functionality while ensuring proper mobile device support. This combined approach addresses both the functionality issues and mobile usability concerns.

## 1. Enhanced ModelManager Implementation

```javascript
// Modified static/js/models.js with mobile enhancements

class ModelManager {
    constructor() {
        this.currentModel = null;
        this.modelConfigs = {};
        this.isInitialized = false;
    }

    async initialize() {
        try {
            console.log('Initializing ModelManager');
            // Try to fetch models from server
            await this.refreshModelsList();
            
            // Create model selector UI if needed
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
        } catch (error) {
            console.error('Error initializing models:', error);
            // Try to create default models if none exist
            await this.ensureDefaultModels();
        }
    }
    
    /**
     * Ensure there are default models available if none exist
     */
    async ensureDefaultModels() {
        console.log('Checking for default models...');
        
        if (Object.keys(this.modelConfigs).length > 0) {
            console.log('Models already exist, no defaults needed');
            return;
        }
        
        console.log('No models found, creating defaults');
        
        try {
            // Create default DeepSeek-R1 model
            const deepseekModel = {
                name: "DeepSeek-R1",
                description: "Reasoning-focused model with high performance in math, coding, and science",
                azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                api_version: "2025-01-01-preview",
                max_tokens: 32000,
                supports_temperature: false,
                supports_streaming: true,
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            };
            
            // Create default o1 model
            const o1Model = {
                name: "o1hp",
                description: "Advanced reasoning model for complex tasks",
                azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                api_version: "2025-01-01-preview",
                max_tokens: 40000,
                supports_temperature: false,
                supports_streaming: false,
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            };
            
            // Create the models via API
            await this.createModel("DeepSeek-R1", deepseekModel);
            await this.createModel("o1hp", o1Model);
            
            // Refresh the list after creating defaults
            await this.refreshModelsList();
            console.log('Default models created');
            
        } catch (error) {
            console.error('Error creating default models:', error);
            // Show error in UI
            const listContainer = document.getElementById('models-list');
            if (listContainer) {
                listContainer.innerHTML = '<div class="text-red-500 dark:text-red-400 p-4 text-center">Failed to create default models.<br>Please check console for details.</div>';
            }
        }
    }
    
    /**
     * Create a new model using the API
     */
    async createModel(modelId, modelData) {
        const response = await fetch(`/api/config/models/${modelId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(modelData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create model ${modelId}: ${errorText}`);
        }
        
        return await response.json();
    }

    async refreshModelsList() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) {
            console.error('Models list container not found in DOM');
            return;
        }
        
        // Show loading state with better mobile padding
        listContainer.innerHTML = '<div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">Loading models...</div>';
        
        try {
            console.log('Fetching models from API...');
            const response = await fetch('/api/config/models');
            console.log('API response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
            }
            
            const models = await response.json();
            console.log('Models received:', models);
            this.modelConfigs = models; // Update local cache
            
            // Clear container
            listContainer.innerHTML = '';
            
            // Create card for each model
            if (Object.keys(models).length === 0) {
                console.log('No models found in response');
                listContainer.innerHTML = '<div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">No models configured.</div>';
                return;
            }
            
            // Build UI for each model with mobile-friendly design
            for (const [id, config] of Object.entries(models)) {
                const card = document.createElement('div');
                card.className = 'border border-gray-200 dark:border-gray-700 rounded-md p-3 mb-3 bg-white dark:bg-gray-700 transition hover:border-blue-200 dark:hover:border-blue-700';
                
                // Add ripple effect for touch feedback
                card.dataset.modelId = id;
                
                // Enhanced mobile-friendly card layout
                card.innerHTML = `
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center">
                        <div class="mb-2 sm:mb-0">
                            <h3 class="font-medium text-base">${id}</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400">${config.description || 'No description'}</p>
                        </div>
                        <div class="flex space-x-2">
                            <button class="edit-model-btn p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full touch-target" data-model-id="${id}" aria-label="Edit ${id} model">
                                <span aria-hidden="true">✏️</span>
                            </button>
                            <button class="delete-model-btn p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full touch-target" data-model-id="${id}" aria-label="Delete ${id} model">
                                <span aria-hidden="true">🗑️</span>
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                        <div>
                            <span class="font-medium">Tokens:</span> ${config.max_tokens?.toLocaleString() || 'Default'}
                        </div>
                        <div>
                            <span class="font-medium">Streaming:</span> ${config.supports_streaming ? 'Yes' : 'No'}
                        </div>
                    </div>
                `;
                
                listContainer.appendChild(card);
            }
            
            // Add event listeners to edit/delete buttons
            this.attachModelActionListeners();
            
        } catch (error) {
            console.error('Error refreshing models list:', error);
            listContainer.innerHTML = `
                <div class="text-red-500 dark:text-red-400 p-4 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-center">
                    <p class="font-medium mb-1">Error loading models</p>
                    <p class="text-sm">${error.message || 'Unknown error'}</p>
                    <button id="retry-models-btn" class="mt-2 px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700">
                        Retry
                    </button>
                </div>
            `;
            
            // Add retry button functionality
            const retryBtn = document.getElementById('retry-models-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.refreshModelsList());
            }
        }
    }

    attachModelActionListeners() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;
        
        // Add event listeners to edit buttons with enhanced touch feedback
        listContainer.querySelectorAll('.edit-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling
                
                // Add visual feedback for touch
                btn.classList.add('bg-blue-100', 'dark:bg-blue-800');
                setTimeout(() => {
                    btn.classList.remove('bg-blue-100', 'dark:bg-blue-800');
                }, 200);
                
                const modelId = btn.getAttribute('data-model-id');
                this.showModelForm('edit', modelId);
            });
        });
        
        // Add event listeners to delete buttons with enhanced touch feedback
        listContainer.querySelectorAll('.delete-model-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent event bubbling
                
                // Add visual feedback for touch
                btn.classList.add('bg-red-100', 'dark:bg-red-800');
                setTimeout(() => {
                    btn.classList.remove('bg-red-100', 'dark:bg-red-800');
                }, 200);
                
                const modelId = btn.getAttribute('data-model-id');
                
                // Mobile-friendly confirmation using confirm API
                if (confirm(`Are you sure you want to delete the model "${modelId}"?`)) {
                    await this.deleteModel(modelId);
                }
            });
        });
        
        // Optional: Make entire card clickable for edit (good for touch)
        listContainer.querySelectorAll('.border').forEach(card => {
            card.addEventListener('click', () => {
                const modelId = card.dataset.modelId;
                if (modelId) {
                    this.showModelForm('edit', modelId);
                }
            });
        });
    }

    async deleteModel(modelId) {
        try {
            // Show loading indicator
            const listContainer = document.getElementById('models-list');
            if (listContainer) {
                listContainer.classList.add('opacity-50', 'pointer-events-none');
            }
            
            const response = await fetch(`/api/config/models/${modelId}`, {
                method: 'DELETE'
            });
            
            // Remove loading indicator
            if (listContainer) {
                listContainer.classList.remove('opacity-50', 'pointer-events-none');
            }
            
            if (response.ok) {
                // Show success notification
                this.showToast(`Model ${modelId} deleted successfully`);
                
                // Refresh the list
                await this.refreshModelsList();
            } else {
                const errorText = await response.text();
                console.error('Delete error:', errorText);
                
                // Show error notification
                this.showToast(`Error: ${errorText}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting model:', error);
            this.showToast('An error occurred while deleting the model', 'error');
        }
    }

    showModelForm(mode, modelId = null) {
        console.log(`Showing model form: mode=${mode}, modelId=${modelId}`);
        const formContainer = document.getElementById('model-form-container');
        const formTitle = document.getElementById('model-form-title');
        const formMode = document.getElementById('model-form-mode');
        const formIdField = document.getElementById('model-form-id');
        
        if (!formContainer || !formTitle || !formMode || !formIdField) {
            console.error('Model form elements not found in DOM');
            return;
        }
        
        // Reset form
        document.getElementById('model-form').reset();
        
        // Set form mode and title
        formMode.value = mode;
        formTitle.textContent = mode === 'add' ? 'Add New Model' : 'Edit Model';
        
        // If editing, populate form with existing data
        if (mode === 'edit' && modelId && this.modelConfigs[modelId]) {
            const config = this.modelConfigs[modelId];
            formIdField.value = modelId;
            
            // Populate form fields
            document.getElementById('model-name').value = modelId;
            document.getElementById('model-name').disabled = true; // Can't change ID when editing
            document.getElementById('model-description').value = config.description || '';
            document.getElementById('model-endpoint').value = config.azure_endpoint || '';
            document.getElementById('model-api-version').value = config.api_version || '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = config.max_tokens || 4096;
            document.getElementById('model-supports-temperature').checked = config.supports_temperature || false;
            document.getElementById('model-supports-streaming').checked = config.supports_streaming || false;
        } else {
            // Clear ID field for new model
            formIdField.value = '';
            document.getElementById('model-name').disabled = false;
            
            // Set default values for new model
            document.getElementById('model-endpoint').value = 'https://aoai-east-2272068338224.cognitiveservices.azure.com';
            document.getElementById('model-api-version').value = '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = '4096';
        }
        
        // Show form with animation
        formContainer.classList.remove('hidden');
        
        // Mobile: Scroll form into view
        if (window.innerWidth < 768) {
            setTimeout(() => {
                formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    hideModelForm() {
        const formContainer = document.getElementById('model-form-container');
        if (formContainer) {
            // Fade out and hide
            formContainer.classList.add('hidden');
        }
    }

    async handleModelFormSubmit(e) {
        e.preventDefault();
        console.log('Model form submitted');
        
        const formMode = document.getElementById('model-form-mode').value;
        const formIdField = document.getElementById('model-form-id');
        const modelId = formMode === 'add' 
            ? document.getElementById('model-name').value
            : formIdField.value;
            
        console.log(`Form mode: ${formMode}, Model ID: ${modelId}`);
        
        // Validate form (mobile-friendly validation)
        if (!modelId) {
            this.showFormError('model-name', 'Model name is required');
            return;
        }
        
        // Collect form data
        const modelData = {
            name: modelId,
            description: document.getElementById('model-description').value,
            azure_endpoint: document.getElementById('model-endpoint').value,
            api_version: document.getElementById('model-api-version').value || '2025-01-01-preview',
            max_tokens: parseInt(document.getElementById('model-max-tokens').value, 10) || 4096,
            supports_temperature: document.getElementById('model-supports-temperature').checked,
            supports_streaming: document.getElementById('model-supports-streaming').checked,
            // Default values
            base_timeout: 120.0,
            max_timeout: 300.0,
            token_factor: 0.05
        };
        
        console.log('Model data to submit:', modelData);
        
        // Show loading state on form
        const form = document.getElementById('model-form');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="inline-block animate-spin mr-2">↻</span> Saving...';
        }
        
        try {
            // API endpoint changes based on add vs. edit
            const url = `/api/config/models/${modelId}`;
            const method = formMode === 'add' ? 'POST' : 'PUT';
            
            console.log(`Submitting to ${method} ${url}`);
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });
            
            console.log('API response status:', response.status);
            
            if (response.ok) {
                const result = await response.json();
                console.log(`Model ${formMode === 'add' ? 'created' : 'updated'}:`, result);
                
                // Refresh models and hide form
                await this.refreshModelsList();
                this.hideModelForm();
                
                // Show success message - mobile-friendly toast notification
                this.showToast(`Model ${modelId} ${formMode === 'add' ? 'created' : 'updated'} successfully`);
            } else {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                
                // Show error in form
                this.showFormError(null, errorText);
            }
        } catch (error) {
            console.error('Error submitting model form:', error);
            this.showFormError(null, 'An error occurred. Please check console for details.');
        } finally {
            // Restore button state
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Save';
            }
        }
    }
    
    /**
     * Show a form field error with mobile-friendly styling
     */
    showFormError(fieldId, message) {
        // Clear existing errors
        document.querySelectorAll('.error-message').forEach(el => el.remove());
        
        // Create error message
        const errorEl = document.createElement('div');
        errorEl.className = 'error-message text-red-500 text-sm mt-1 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded';
        errorEl.textContent = message;
        
        if (fieldId) {
            // Field-specific error
            const field = document.getElementById(fieldId);
            if (field) {
                field.classList.add('border-red-500');
                field.parentNode.appendChild(errorEl);
                
                // Focus the field (good for mobile)
                field.focus();
                
                // Remove error styling when field is changed
                field.addEventListener('input', () => {
                    field.classList.remove('border-red-500');
                    const errorMsg = field.parentNode.querySelector('.error-message');
                    if (errorMsg) errorMsg.remove();
                }, { once: true });
            }
        } else {
            // General form error
            const form = document.getElementById('model-form');
            if (form) {
                form.prepend(errorEl);
                
                // Make sure it's visible on mobile
                setTimeout(() => {
                    errorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
    }
    
    /**
     * Show a toast notification - mobile-friendly
     */
    showToast(message, type = 'success') {
        // Remove any existing toasts
        document.querySelectorAll('.toast-notification').forEach(el => el.remove());
        
        // Create toast
        const toast = document.createElement('div');
        toast.className = `toast-notification fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-md shadow-lg text-white text-sm ${
            type === 'error' ? 'bg-red-600' : 'bg-green-600'
        } animate-fade-in`;
        toast.textContent = message;
        
        // Add to body
        document.body.appendChild(toast);
        
        // Remove after delay
        setTimeout(() => {
            toast.classList.remove('animate-fade-in');
            toast.classList.add('animate-fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    initModelManagement() {
        console.log('Initializing model management UI');
        // Set up the models tab UI
        const addModelBtn = document.getElementById('add-model-btn');
        const modelForm = document.getElementById('model-form');
        const cancelBtn = document.getElementById('model-form-cancel');
        
        if (addModelBtn) {
            console.log('Add Model button found, attaching event listener');
            
            // Add touch-friendly styling for mobile
            addModelBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md shadow-sm flex items-center justify-center space-x-2 touch-action-manipulation';
            
            // Enhance for mobile
            addModelBtn.innerHTML = `
                <span>Add Model</span>
                <span aria-hidden="true">+</span>
            `;
            
            addModelBtn.addEventListener('click', () => {
                console.log('Add Model button clicked');
                this.showModelForm('add');
            });
            
            // Add touch feedback
            addModelBtn.addEventListener('touchstart', () => {
                addModelBtn.classList.add('bg-blue-700');
            }, { passive: true });
            
            addModelBtn.addEventListener('touchend', () => {
                addModelBtn.classList.remove('bg-blue-700');
            }, { passive: true });
        } else {
            console.error('Add Model button not found');
        }
        
        if (cancelBtn) {
            // Enhance cancel button for mobile
            cancelBtn.className = 'btn-secondary text-sm px-4 py-2 rounded-md touch-action-manipulation';
            
            cancelBtn.addEventListener('click', () => this.hideModelForm());
        }
        
        if (modelForm) {
            modelForm.addEventListener('submit', (e) => this.handleModelFormSubmit(e));
            
            // Enhance form controls for mobile
            const formControls = modelForm.querySelectorAll('input, select, textarea');
            formControls.forEach(control => {
                // Make form controls more touch-friendly
                if (control.type === 'text' || control.type === 'number' || control.type === 'url' || control.tagName === 'SELECT') {
                    control.className = 'form-input w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none';
                }
            });
            
            // Enhance submit button for mobile
            const submitBtn = modelForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.className = 'btn-primary text-sm px-4 py-2 rounded-md touch-action-manipulation';
            }
        }
        
        // Initialize models list
        this.refreshModelsList();
    }
}

// Export singleton instance
export const modelManager = new ModelManager();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Document loaded, initializing ModelManager');
    modelManager.initialize().catch(err => {
        console.error('Error initializing ModelManager on page load:', err);
    });
    
    // Add CSS for mobile enhancements
    addMobileStyles();
});

/**
 * Add mobile-specific styles
 */
function addMobileStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Mobile touch enhancements */
        .touch-target {
            min-height: 44px;
            min-width: 44px;
        }
        
        .touch-action-manipulation {
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }
        
        /* Toast animations */
        @keyframes fadeIn {
            from { opacity: 0; transform: translate(-50%, -20px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        
        @keyframes fadeOut {
            from { opacity: 1; transform: translate(-50%, 0); }
            to { opacity: 0; transform: translate(-50%, -20px); }
        }
        
        .animate-fade-in {
            animation: fadeIn 0.3s ease forwards;
        }
        
        .animate-fade-out {
            animation: fadeOut 0.3s ease forwards;
        }
        
        /* Mobile form enhancements */
        @media (max-width: 640px) {
            #model-form input,
            #model-form select {
                font-size: 16px; /* Prevents iOS zoom */
                padding: 0.75rem;
                margin-bottom: 0.75rem;
            }
            
            #model-form label {
                display: block;
                margin-bottom: 0.5rem;
                font-weight: 500;
            }
            
            #model-form .error-message {
                padding: 0.75rem;
                margin-bottom: 1rem;
            }
            
            /* Larger checkboxes */
            #model-form input[type="checkbox"] {
                width: 20px;
                height: 20px;
            }
        }
    `;
    document.head.appendChild(style);
}
```

## 2. Enhanced Model Form in index.html

```html
<!-- Updated model form to be mobile-friendly - for static/index.html -->
<div id="model-form-container" class="hidden border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-gray-50 dark:bg-gray-800 shadow-md">
    <h3 class="text-md font-medium mb-3" id="model-form-title">Add New Model</h3>
    <form id="model-form" class="space-y-3">
        <input type="hidden" id="model-form-mode" value="add">
        <input type="hidden" id="model-form-id" value="">
        
        <div>
            <label for="model-name" class="block text-sm font-medium">Model ID/Name</label>
            <input type="text" id="model-name" class="form-input w-full p-2 md:p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none" required>
            <p class="text-xs text-gray-500 mt-1">Used for deployment name (e.g., "gpt-4" or "o1hp")</p>
        </div>
        
        <div>
            <label for="model-description" class="block text-sm font-medium">Description</label>
            <input type="text" id="model-description" class="form-input w-full p-2 md:p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none">
        </div>
        
        <div>
            <label for="model-endpoint" class="block text-sm font-medium">Azure Endpoint</label>
            <input type="url" id="model-endpoint" class="form-input w-full p-2 md:p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none" required>
        </div>
        
        <div>
            <label for="model-api-version" class="block text-sm font-medium">API Version</label>
            <input type="text" id="model-api-version" class="form-input w-full p-2 md:p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none" value="2025-01-01-preview" required>
        </div>
        
        <div>
            <label for="model-max-tokens" class="block text-sm font-medium">Max Tokens</label>
            <input type="number" id="model-max-tokens" class="form-input w-full p-2 md:p-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none" min="1024" max="128000" value="4096" required>
        </div>
        
        <div class="flex flex-col sm:flex-row sm:space-x-8 space-y-3 sm:space-y-0">
            <div class="flex items-center">
                <input type="checkbox" id="model-supports-temperature" class="h-5 w-5 md:h-4 md:w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <label for="model-supports-temperature" class="ml-2 text-sm">Supports Temperature</label>
            </div>
            <div class="flex items-center">
                <input type="checkbox" id="model-supports-streaming" class="h-5 w-5 md:h-4 md:w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <label for="model-supports-streaming" class="ml-2 text-sm">Supports Streaming</label>
            </div>
        </div>
        
        <div class="pt-2 flex justify-end space-x-2">
            <button type="button" id="model-form-cancel" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500">Cancel</button>
            <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Save</button>
        </div>
    </form>
</div>
```

## 3. Enhanced Models Tab in index.html

```html
<!-- Updated Models tab content in static/index.html -->
<div id="models-content" class="h-full overflow-y-auto p-4 hidden" role="tabpanel" aria-hidden="true">
    <div class="space-y-4">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold">Model Management</h2>
            <button id="add-model-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md shadow-sm touch-action-manipulation">
                <span>Add Model</span>
            </button>
        </div>
        
        <!-- Models list - Content will be populated by JavaScript -->
        <div id="models-list" class="space-y-2">
            <div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">Loading models...</div>
        </div>
        
        <!-- Model form container - Initially hidden -->
        <div id="model-form-container" class="hidden border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-gray-50 dark:bg-gray-800 shadow-md">
            <!-- Form content will be placed here from the HTML above -->
        </div>
    </div>
</div>
```

## 4. Enhanced Debugging Helpers

```javascript
// Add to init.js or a separate debugging.js file
function addDebugConsole() {
  // Create debug console element
  const debugConsole = document.createElement('div');
  debugConsole.className = 'fixed bottom-0 left-0 right-0 bg-black/90 text-green-400 font-mono text-xs p-2 z-50 h-48 overflow-auto hidden';
  debugConsole.id = 'debug-console';
  document.body.appendChild(debugConsole);
  
  // Override console.log
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.log = function(...args) {
    originalLog.apply(console, args);
    appendToDebugConsole('log', args);
  };
  
  console.error = function(...args) {
    originalError.apply(console, args);
    appendToDebugConsole('error', args);
  };
  
  console.warn = function(...args) {
    originalWarn.apply(console, args);
    appendToDebugConsole('warn', args);
  };
  
  // Function to append to debug console
  function appendToDebugConsole(type, args) {
    const debugConsole = document.getElementById('debug-console');
    if (!debugConsole) return;
    
    const line = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    switch (type) {
      case 'error':
        line.className = 'text-red-400';
        break;
      case 'warn':
        line.className = 'text-yellow-400';
        break;
      default:
        line.className = 'text-green-400';
    }
    
    line.textContent = `[${timestamp}] [${type}] ${args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')}`;
    
    debugConsole.appendChild(line);
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }
  
  // Toggle debug console with Shift+D (desktop) or four-finger tap (mobile)
  document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'D') {
      const debugConsole = document.getElementById('debug-console');
      if (debugConsole) {
        debugConsole.classList.toggle('hidden');
      }
    }
  });
  
  // Mobile debug trigger with quadruple tap
  let tapCount = 0;
  let lastTap = 0;
  
  document.addEventListener('touchend', () => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    
    if (tapLength < 500) {
      tapCount++;
    } else {
      tapCount = 1;
    }
    
    lastTap = currentTime;
    
    if (tapCount >= 4) {
      const debugConsole = document.getElementById('debug-console');
      if (debugConsole) {
        debugConsole.classList.toggle('hidden');
      }
      tapCount = 0;
    }
  }, { passive: true });
}

// Call this early in initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addDebugConsole);
} else {
  addDebugConsole();
}
```

## 5. Backend Verification for API

Ensure the backend is properly handling the model configuration API:

```python
# Add debugging in routers/config.py
@router.get("/models", response_model=Dict[str, ModelConfigModel])
async def get_models(config_service=Depends(get_config_service)):
    """Get all model configurations"""
    try:
        models = await config_service.get_model_configs()
        print(f"Retrieved models: {models}")
        return models
    except Exception as e:
        print(f"Error retrieving models: {str(e)}")
        # Return empty dict instead of raising error to avoid UI disruption
        return {}

@router.post("/models/{model_id}")
async def create_model(
    model_id: str,
    model: ModelConfigModel,
    config_service=Depends(get_config_service)
):
    """Create a new model configuration"""
    try:
        print(f"Creating model {model_id} with config: {model.dict()}")
        existing = await config_service.get_model_config(model_id)
        if existing:
            raise HTTPException(status_code=400, detail="Model already exists")
        
        success = await config_service.add_model_config(model_id, model.dict())
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create model")
        
        # Refresh client pool
        from clients import get_client_pool
        pool = await get_client_pool()
        await pool.refresh_client(model_id, config_service)
        
        return {"status": "created", "model_id": model_id}
    except Exception as e:
        print(f"Error creating model {model_id}: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(e))
```

## Implementation Strategy

1. **First Step**: Add the debugging console to help diagnose issues
   - This will help you identify exactly where the problems are occurring

2. **Second Step**: Update the ModelManager implementation
   - Replaces the existing static/js/models.js file completely
   - Includes mobile-friendly enhancements and error handling

3. **Third Step**: Update the HTML for the Models tab
   - Makes the UI elements more touch-friendly
   - Improves layout for mobile screens

4. **Fourth Step**: Add the enhanced model form
   - Includes larger input areas for touch
   - Better visual feedback for mobile interactions

5. **Fifth Step**: Verify the backend API endpoints
   - Add more detailed logging to identify issues
   - Ensure error handling is mobile-friendly

These comprehensive changes will not only fix the functionality issues with the Models tab but also ensure an excellent experience for mobile users with touch-friendly controls, appropriate font sizes, and visual feedback for actions.
