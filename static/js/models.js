// Model configuration and management

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
                azure_endpoint: config.AZURE_OPENAI_ENDPOINT || "https://aoai-east-2272068338224.cognitiveservices.azure.com",
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
