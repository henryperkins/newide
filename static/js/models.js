// models.js

class ModelManager {
    constructor() {
        this.currentModel = null;
        this.modelConfigs = {};
        this.isInitialized = false;
    }

    /**
     * One-time initialization flow:
     *  1. Attempt to fetch existing models.
     *  2. If no models, create defaults (o1hp, DeepSeek-R1).
     *  3. Build the UI if not already done.
     */
    async initialize() {
        try {
            console.log('Initializing ModelManager');
            // First ensure default models exist
            await this.ensureDefaultModels();
            
            // Wait 500ms for backend to process
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Then refresh models list
            await this.refreshModelsList();
            
            // Log model configs for debugging
            console.log('ModelManager fetched model configs:', Object.keys(this.modelConfigs));
            
            // Build model management UI if not already done
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
        } catch (error) {
            console.error('Error initializing models:', error);
            // Attempt to create default models if none exist
            await this.ensureDefaultModels();
        }
    }
    
    // Corrected model configuration to match Azure OpenAI documentation
    async function ensureDefaultModels() {
        console.log('Checking for default models...');
        
        // If we already have at least one model, only ensure "o1hp" is present.
        if (Object.keys(this.modelConfigs).length > 0) {
            console.log('Models already exist, no defaults needed');
            
            // Specifically check for o1hp
            if (!this.modelConfigs["o1hp"]) {
                console.log('o1hp model not found, creating it');
                const o1Model = {
                    name: "o1hp",
                    description: "Advanced reasoning model for complex tasks",
                    azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                    api_version: "2025-01-01-preview",
                    max_tokens: 200000,
                    max_completion_tokens: 5000,
                    supports_temperature: false,
                    supports_streaming: false, // o1 doesn't support streaming
                    supports_vision: true,
                    requires_reasoning_effort: true,
                    reasoning_effort: "medium",
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                try {
                    await this.createModel("o1hp", o1Model);
                    console.log('o1hp model created successfully');
                } catch (error) {
                    console.warn('Failed to create o1hp model:', error);
                    this.modelConfigs["o1hp"] = o1Model; // Add locally even if API call fails
                }
            }
            return;
        }
        
        // If no models exist at all, create defaults
        console.log('No models found, creating defaults');
        try {
            // o1hp (primary default)
            const o1Model = {
                name: "o1hp",
                description: "Advanced reasoning model for complex tasks",
                azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                api_version: "2025-01-01-preview",
                max_tokens: 200000,
                max_completion_tokens: 5000,
                supports_temperature: false,
                supports_streaming: false, // o1 doesn't support streaming
                supports_vision: true,
                requires_reasoning_effort: true,
                reasoning_effort: "medium",
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            };
            try {
                await this.createModel("o1hp", o1Model);
                console.log('o1hp model created successfully');
            } catch (error) {
                console.warn('Failed to create o1hp model via API, adding to local config:', error);
                this.modelConfigs["o1hp"] = o1Model;
            }
            
            // DeepSeek-R1
            const deepseekR1Model = {
                name: "DeepSeek-R1",
                description: "Model that supports chain-of-thought reasoning with <think> tags",
                azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
                api_version: "2024-05-01-preview", // DeepSeek uses different API version
                max_tokens: 32000, // Different max_tokens for DeepSeek
                supports_temperature: true,  // DeepSeek uses temperature parameter
                supports_streaming: true, // DeepSeek supports streaming
                supports_json_response: false, 
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            };
            try {
                await this.createModel("DeepSeek-R1", deepseekR1Model);
                console.log('DeepSeek-R1 model created successfully');
            } catch (error) {
                console.warn('Failed to create DeepSeek-R1 model via API, adding to local config:', error);
                this.modelConfigs["DeepSeek-R1"] = deepseekR1Model;
            }
            
            // Refresh
            await this.refreshModelsList();
            console.log('Default models created');
            
        } catch (error) {
            console.error('Error creating default models:', error);
            const listContainer = document.getElementById('models-list');
            if (listContainer) {
                listContainer.innerHTML = `
                    <div class="text-red-500 dark:text-red-400 p-4 text-center">
                        Failed to create default models.<br>Please check console for details.
                    </div>`;
            }
        }
    }
    
    /**
     * Create a new model (API call).
     * @param {string} modelId 
     * @param {Object} modelData 
     */
    async createModel(modelId, modelData) {
        // Check if model exists first
        const existsResponse = await fetch(`/api/config/models/${modelId}`);
        if (existsResponse.ok) {
            console.log(`Model ${modelId} already exists, skipping creation`);
            return await existsResponse.json();
        }

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

    /**
     * Fetch all models from the server, update the UI.
     */
    async refreshModelsList() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) {
            console.error('Models list container not found');
            return;
        }
        
        listContainer.innerHTML = `
            <div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">
                Loading models...
            </div>`;
        
        try {
            console.log('Fetching models from API...');
            const response = await fetch('/api/config/models');
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
            }
            
            let models = await response.json();
            console.log('Raw models received from API:', models);
            
            // Handle both formats: direct models object or models wrapped in a "models" property
            if (models.models) {
                console.log('Models are wrapped in a "models" property, extracting...');
                models = models.models;
            }
            
            console.log('Processed models:', models);
            
            // Warn if DeepSeek-R1 is missing
            const hasDeepSeekR1 = Object.keys(models).includes("DeepSeek-R1");
            const hasO1hp = Object.keys(models).includes("o1hp");
            
            if (!hasDeepSeekR1) {
                console.warn('DeepSeek-R1 not found in API response. You can create or register it in the Azure deployment settings.');
            }
            
            if (!hasO1hp) {
                console.warn('o1hp not found in API response. You can create or register it in the Azure deployment settings.');
            }
            
            // Update local store - IMPORTANT: This is where the models are stored
            this.modelConfigs = models;
            console.log('Updated modelConfigs:', this.modelConfigs);
            
            // Clear container
            listContainer.innerHTML = '';
            
            // If no models, show a message
            if (Object.keys(models).length === 0) {
                console.log('No models found in response');
                listContainer.innerHTML = `
                    <div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">
                        No models configured.
                    </div>`;
                    
                // Since we have no models, manually create the essential ones
                console.log('Creating default models in local config...');
                this.modelConfigs["o1hp"] = {
                    name: "o1hp",
                    description: "Azure OpenAI o1 high performance model",
                    max_tokens: 40000,
                    supports_streaming: false,
                    supports_temperature: false,
                    api_version: "2025-01-01-preview",
                    azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                this.modelConfigs["DeepSeek-R1"] = {
                    name: "DeepSeek-R1",
                    description: "Model that supports chain-of-thought reasoning with <think> tags",
                    max_tokens: 32000,
                    supports_streaming: true,
                    supports_temperature: true,
                    api_version: "2024-05-01-preview",
                    azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                console.log('Created default models in local config:', this.modelConfigs);
                return;
            }
            
            // Build a card for each model
            for (const [id, modelConfig] of Object.entries(models)) {
                const card = document.createElement('div');
                card.className = `
                    border border-gray-200 dark:border-gray-700
                    rounded-md p-3 mb-3 bg-white dark:bg-gray-700
                    transition hover:border-blue-200 dark:hover:border-blue-700
                `;
                card.dataset.modelId = id;
                card.innerHTML = `
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center">
                        <div class="mb-2 sm:mb-0">
                            <h3 class="font-medium text-base">${id}</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400">
                                ${modelConfig.description || 'No description'}
                            </p>
                        </div>
                        <div class="flex space-x-2">
                            <button class="edit-model-btn p-2 text-blue-600 dark:text-blue-400 
                                    hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full touch-target"
                                    data-model-id="${id}" aria-label="Edit ${id} model">
                                <span aria-hidden="true">✏️</span>
                            </button>
                            <button class="delete-model-btn p-2 text-red-600 dark:text-red-400 
                                    hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full touch-target"
                                    data-model-id="${id}" aria-label="Delete ${id} model">
                                <span aria-hidden="true">🗑️</span>
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                        <div>
                            <span class="font-medium">Tokens:</span> 
                            ${modelConfig.max_tokens?.toLocaleString() || 'Default'}
                        </div>
                        <div>
                            <span class="font-medium">Streaming:</span> 
                            ${modelConfig.supports_streaming ? 'Yes' : 'No'}
                        </div>
                    </div>
                `;
                listContainer.appendChild(card);
            }
            
            // Hook up edit/delete event listeners
            this.attachModelActionListeners();
            
        } catch (error) {
            console.error('Error loading models:', error);
            listContainer.innerHTML = `
                <div class="text-red-500 dark:text-red-400 text-sm p-4 text-center">
                    Failed to load models: ${error.message}
                </div>
                <button id="retry-models-btn" class="btn-primary mx-auto block mt-2 text-sm">
                    Retry
                </button>
            `;
            
            // Add a retry button
            document.getElementById('retry-models-btn')?.addEventListener('click', () => {
                this.refreshModelsList();
            });
            
            // Create default models locally as fallback
            console.log('Creating fallback models in local config due to API error...');
            this.modelConfigs["o1hp"] = {
                name: "o1hp",
                description: "Azure OpenAI o1 high performance model",
                max_tokens: 200000,
                max_completion_tokens: 5000,
                supports_streaming: false,
                supports_temperature: false,
                requires_reasoning_effort: true,
                reasoning_effort: "medium",
                api_version: "2025-01-01-preview", 
                azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            };
            
            this.modelConfigs["DeepSeek-R1"] = {
                name: "DeepSeek-R1",
                description: "Model that supports chain-of-thought reasoning with <think> tags",
                max_tokens: 32000,
                supports_streaming: true,
                supports_temperature: true,
                api_version: "2024-05-01-preview",
                azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            };
            
            console.log('Created fallback models in local config:', this.modelConfigs);
        }
    }

    /**
     * Attach event listeners to Edit/Delete buttons on each model card.
     * Makes the entire card clickable for editing.
     */
    attachModelActionListeners() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;
        
        // Edit button
        listContainer.querySelectorAll('.edit-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Visual feedback on touch
                btn.classList.add('bg-blue-100', 'dark:bg-blue-800');
                setTimeout(() => {
                    btn.classList.remove('bg-blue-100', 'dark:bg-blue-800');
                }, 200);
                
                const modelId = btn.getAttribute('data-model-id');
                this.showModelForm('edit', modelId);
            });
        });
        
        // Delete button
        listContainer.querySelectorAll('.delete-model-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                // Visual feedback on touch
                btn.classList.add('bg-red-100', 'dark:bg-red-800');
                setTimeout(() => {
                    btn.classList.remove('bg-red-100', 'dark:bg-red-800');
                }, 200);
                
                const modelId = btn.getAttribute('data-model-id');
                
                if (confirm(`Are you sure you want to delete the model "${modelId}"?`)) {
                    await this.deleteModel(modelId);
                }
            });
        });
        
        // Make entire card clickable for edit
        listContainer.querySelectorAll('.border').forEach(card => {
            card.addEventListener('click', () => {
                const modelId = card.dataset.modelId;
                if (modelId) {
                    this.showModelForm('edit', modelId);
                }
            });
        });
    }

    /**
     * Delete a model (API call), then refresh UI.
     */
    async deleteModel(modelId) {
        try {
            // Show “loading” styling on the container
            const listContainer = document.getElementById('models-list');
            if (listContainer) {
                listContainer.classList.add('opacity-50', 'pointer-events-none');
            }
            
            const response = await fetch(`/api/config/models/${modelId}`, { method: 'DELETE' });
            
            // Remove “loading” styling
            if (listContainer) {
                listContainer.classList.remove('opacity-50', 'pointer-events-none');
            }
            
            if (response.ok) {
                this.showToast(`Model ${modelId} deleted successfully`);
                await this.refreshModelsList();
            } else {
                const errorText = await response.text();
                console.error('Delete error:', errorText);
                this.showToast(`Error: ${errorText}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting model:', error);
            this.showToast('An error occurred while deleting the model', 'error');
        }
    }

    /**
     * Display the “add or edit model” form.
     * @param {'add'|'edit'} mode
     * @param {string|null} modelId
     */
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
        
        // Reset entire form
        document.getElementById('model-form').reset();
        
        // Set form mode & title
        formMode.value = mode;
        formTitle.textContent = (mode === 'add') ? 'Add New Model' : 'Edit Model';
        
        // Populate if editing an existing model
        if (mode === 'edit' && modelId && this.modelConfigs[modelId]) {
            const config = this.modelConfigs[modelId];
            formIdField.value = modelId;
            
            document.getElementById('model-name').value = modelId;
            document.getElementById('model-name').disabled = true; // ID cannot change
            document.getElementById('model-description').value = config.description || '';
            document.getElementById('model-endpoint').value = config.azure_endpoint || '';
            document.getElementById('model-api-version').value = config.api_version || '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = config.max_tokens || 4096;
            document.getElementById('model-supports-temperature').checked = config.supports_temperature || false;
            document.getElementById('model-supports-streaming').checked = config.supports_streaming || false;
        } else {
            // Clear ID field for a new model
            formIdField.value = '';
            document.getElementById('model-name').disabled = false;
            
            // Reasonable defaults for a new model
            document.getElementById('model-endpoint').value =
                'https://aoai-east-2272068338224.cognitiveservices.azure.com';
            document.getElementById('model-api-version').value = '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = '4096';
        }
        
        // Show the form container
        formContainer.classList.remove('hidden');
        
        // Scroll into view on mobile
        if (window.innerWidth < 768) {
            setTimeout(() => {
                formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    /**
     * Hide the “add or edit model” form.
     */
    hideModelForm() {
        const formContainer = document.getElementById('model-form-container');
        if (formContainer) {
            formContainer.classList.add('hidden');
        }
    }

    /**
     * Handler for the Model Form “Save” button.
     * Sends data to server if valid.
     */
    async handleModelFormSubmit(e) {
        e.preventDefault();
        console.log('Model form submitted');
        
        const formMode = document.getElementById('model-form-mode').value;
        const formIdField = document.getElementById('model-form-id');
        
        // If adding, modelId is from the 'name' field; if editing, from hidden input
        const modelId = (formMode === 'add')
            ? document.getElementById('model-name').value
            : formIdField.value;
        
        console.log(`Form mode: ${formMode}, Model ID: ${modelId}`);
        
        // Very basic form validation
        if (!modelId) {
            this.showFormError('model-name', 'Model name is required');
            return;
        }
        
        // Collect data
        const modelData = {
            name: modelId,
            description: document.getElementById('model-description').value,
            azure_endpoint: document.getElementById('model-endpoint').value,
            api_version: document.getElementById('model-api-version').value || '2025-01-01-preview',
            max_tokens: parseInt(document.getElementById('model-max-tokens').value, 10) || 4096,
            supports_temperature: document.getElementById('model-supports-temperature').checked,
            supports_streaming: document.getElementById('model-supports-streaming').checked,
            // Hard-coded defaults (these might be user-editable in the future)
            base_timeout: 120.0,
            max_timeout: 300.0,
            token_factor: 0.05
        };
        console.log('Model data to submit:', modelData);
        
        // Show loading state on the submit button
        const form = document.getElementById('model-form');
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="inline-block animate-spin mr-2">↻</span> Saving...';
        }
        
        try {
            // We assume your backend can handle POST for both create and update
            const response = await fetch(`/api/config/models/${modelId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });
            
            if (response.ok) {
                // Refresh the model list and hide the form
                this.showToast(`Model ${modelId} saved successfully`);
                await this.refreshModelsList();
                this.hideModelForm();
            } else {
                const errorText = await response.text();
                console.error('API error response:', errorText);
                this.showFormError(null, errorText);
            }
        } catch (error) {
            console.error('Error submitting model form:', error);
            this.showFormError(null, 'An error occurred. Please check console for details.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Save';
            }
        }
    }
    
    /**
     * Show a field-level or global form error with minimal fuss.
     */
    showFormError(fieldId, message) {
        // Remove existing error messages
        document.querySelectorAll('.error-message').forEach(el => el.remove());
        
        const errorEl = document.createElement('div');
        errorEl.className = `
            error-message text-red-500 text-sm mt-1 p-2 bg-red-50 dark:bg-red-900/20 
            border border-red-200 dark:border-red-800 rounded
        `;
        errorEl.textContent = message;
        
        if (fieldId) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.classList.add('border-red-500');
                field.parentNode.appendChild(errorEl);
                field.focus();
                
                // Remove error styling after user changes the field
                field.addEventListener('input', () => {
                    field.classList.remove('border-red-500');
                    const existingErr = field.parentNode.querySelector('.error-message');
                    if (existingErr) existingErr.remove();
                }, { once: true });
            }
        } else {
            // General form error at top
            const form = document.getElementById('model-form');
            if (form) {
                form.prepend(errorEl);
                setTimeout(() => {
                    errorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
    }
    
    /**
     * Simple toast notification (mobile-friendly).
     * @param {string} message 
     * @param {'success'|'error'|'info'} [type='success']
     */
    showToast(message, type = 'success') {
        // Remove any existing toasts
        document.querySelectorAll('.toast-notification').forEach(el => el.remove());
        
        const toast = document.createElement('div');
        toast.className = `
            toast-notification fixed top-4 left-1/2 transform -translate-x-1/2 z-50 
            px-4 py-2 rounded-md shadow-lg text-white text-sm
            ${type === 'error' ? 'bg-red-600' 
             : type === 'info'  ? 'bg-blue-600'
             : 'bg-green-600'} 
            animate-fade-in
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Remove after a short delay
        setTimeout(() => {
            toast.classList.remove('animate-fade-in');
            toast.classList.add('animate-fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Switch active model. Calls a "switch_model" API route.
     * @param {string} modelId 
     * @returns {Promise<boolean>} success
     */
    async switchModel(modelId) {
        console.log(`Attempting to switch to model: ${modelId}`);
        
        // Normalize model ID for case-insensitive comparison
        const normalizedModelId = modelId.toLowerCase();
        
        // Find the model in configurations (case-insensitive)
        const matchingModelId = Object.keys(this.modelConfigs).find(
            id => id.toLowerCase() === normalizedModelId
        );
        
        if (!matchingModelId) {
            console.log(`Model ${modelId} not found in configurations, attempting to create it`);
            
            // Special handling for known models
            if (normalizedModelId === "deepseek-r1") {
                // Create DeepSeek-R1 model if it doesn't exist
                const deepseekR1Model = {
                    name: "DeepSeek-R1",
                    description: "Model that supports chain-of-thought reasoning with <think> tags",
                    azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
                    api_version: "2024-05-01-preview",
                    max_tokens: 32000,
                    supports_temperature: true,
                    supports_streaming: true,
                    supports_json_response: false,
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                try {
                    await this.createModel("DeepSeek-R1", deepseekR1Model);
                    console.log('DeepSeek-R1 model created successfully');
                    // Add to local configs
                    this.modelConfigs["DeepSeek-R1"] = deepseekR1Model;
                } catch (error) {
                    console.warn('Failed to create DeepSeek-R1 model via API, adding to local config:', error);
                    this.modelConfigs["DeepSeek-R1"] = deepseekR1Model;
                }
            } else if (normalizedModelId === "o1hp") {
                // Create o1hp model if it doesn't exist
                const o1Model = {
                    name: "o1hp",
                    description: "Advanced reasoning model for complex tasks",
                    azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                    api_version: "2025-01-01-preview",
                    max_tokens: 200000,
                    max_completion_tokens: 5000,
                    supports_temperature: false,
                    supports_streaming: false,
                    supports_vision: true,
                    requires_reasoning_effort: true,
                    reasoning_effort: "medium",
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                try {
                    await this.createModel("o1hp", o1Model);
                    console.log('o1hp model created successfully');
                    // Add to local configs
                    this.modelConfigs["o1hp"] = o1Model;
                } catch (error) {
                    console.warn('Failed to create o1hp model via API, adding to local config:', error);
                    this.modelConfigs["o1hp"] = o1Model;
                }
            } else {
                this.showToast(`Model ${modelId} not available`, 'error');
                return false;
            }
        }
        
        // Use the matching model ID with correct case
        const actualModelId = matchingModelId || modelId;
        
        try {
            this.showToast(`Switching to ${modelId}...`, 'info');
            
            // Fetch session to get session_id
            const session = await fetch('/api/session').then(r => r.json());
            const sessionId = session?.id;
            
            // Prepare parameters for the request - FIXED: use model_id instead of model
            const params = {
                model_id: modelId, // FIXED: Changed from 'model' to 'model_id'
                session_id: sessionId // Add session_id directly if available
            };
            
            // Model-specific settings will be applied on the server side
            
            // Switch model using the proper API endpoint - FIXED: use /api/config/models/switch
            console.log(`Switching to model: ${modelId} with params:`, params);
            
            const response = await fetch(`/api/config/models/switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to switch model: ${errorText}`);
            }
            
            // Locally record the current model
            this.currentModel = modelId;
            this.showToast(`Now using model: ${modelId}`, 'success');
            
            // Adjust UI for new model
            this.updateModelSpecificUI(modelId);
            return true;
        } catch (error) {
            console.error('Error switching model:', error);
            this.showToast('Failed to switch model', 'error');
            
            // Try the simplified endpoint as fallback for backward compatibility
            try {
                console.log("Attempting fallback to simplified endpoint...");
                const url = `/api/config/models/switch_model/${modelId}${
                    sessionId ? `?session_id=${sessionId}` : ''
                }`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    this.currentModel = modelId;
                    this.showToast(`Now using model: ${modelId}`, 'success');
                    this.updateModelSpecificUI(modelId);
                    return true;
                }
            } catch (fallbackError) {
                console.error('Fallback also failed:', fallbackError);
            }
            
            return false;
        }
    }
    /**
     * Update various UI elements (streaming toggle, reason controls, etc.) 
     * based on the newly selected model’s capabilities.
     */
    updateModelSpecificUI(modelId) {
        const config = this.modelConfigs[modelId];
        if (!config) return;
        
        // Show/hide reasoning controls for “o” series
        const reasoningControls = document.getElementById('reasoning-controls');
        if (reasoningControls) {
            if (modelId.toLowerCase().startsWith('o1') || modelId.toLowerCase().startsWith('o3')) {
                reasoningControls.classList.remove('hidden');
            } else {
                reasoningControls.classList.add('hidden');
            }
        }
        
        // Update streaming toggle if present
        const streamingToggle = document.getElementById('enable-streaming');
        if (streamingToggle) {
            streamingToggle.disabled = !config.supports_streaming;
            if (!config.supports_streaming) {
                streamingToggle.checked = false;
            }
        }
        
        // Update “Model Info” text
        const modelInfo = document.querySelector('.hidden.md\\:block.text-sm p strong');
        if (modelInfo && modelInfo.parentElement) {
            modelInfo.parentElement.innerHTML = `
                <p><strong>Model Info:</strong> 
                    Using ${modelId} model ${config.supports_streaming ? 'with streaming' : '(no streaming)'}
                </p>`;
        }
    }

    /**
     * Initialize UI components for model management (form, list, etc.).
     * (This is the updated method you requested.)
     */
    initModelManagement() {
        console.log('Initializing model management UI');

        // Hook up "Add Model" button
        const addModelBtn = document.getElementById('add-model-btn');
        if (addModelBtn) {
            console.log('Add Model button found, attaching event listener');
            addModelBtn.className = `
                bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md 
                shadow-sm flex items-center justify-center space-x-2 touch-action-manipulation
            `;
            addModelBtn.innerHTML = `<span>Add Model</span><span aria-hidden="true">+</span>`;
            
            addModelBtn.addEventListener('click', () => {
                console.log('Add Model button clicked');
                this.showModelForm('add');
            });
            
            // Touch feedback on mobile
            addModelBtn.addEventListener('touchstart', () => {
                addModelBtn.classList.add('bg-blue-700');
            }, { passive: true });
            addModelBtn.addEventListener('touchend', () => {
                addModelBtn.classList.remove('bg-blue-700');
            }, { passive: true });
        } else {
            console.error('Add Model button not found');
        }
        
        // Hook up "Cancel" button in form
        const cancelBtn = document.getElementById('model-form-cancel');
        if (cancelBtn) {
            cancelBtn.className = 'btn-secondary text-sm px-4 py-2 rounded-md touch-action-manipulation';
            cancelBtn.addEventListener('click', () => this.hideModelForm());
        }
        
        // Hook up form submission
        const modelForm = document.getElementById('model-form');
        if (modelForm) {
            modelForm.addEventListener('submit', (e) => this.handleModelFormSubmit(e));
            
            // Make form controls touch-friendly
            const formControls = modelForm.querySelectorAll('input, select, textarea');
            formControls.forEach(control => {
                if (['text','number','url'].includes(control.type) || control.tagName === 'SELECT') {
                    control.className = `
                        form-input w-full p-2 border border-gray-300 dark:border-gray-600 
                        rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 
                        focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none
                    `;
                }
            });
            
            // Make the submit button touch-friendly
            const submitBtn = modelForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.className = 'btn-primary text-sm px-4 py-2 rounded-md touch-action-manipulation';
            }
        }
        
        // Finally, load the models list
        this.refreshModelsList();

        // Initialize model-select dropdown if it exists
        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            // Clear existing options
            modelSelect.innerHTML = '';
            
            console.log('Available models for dropdown:', Object.keys(this.modelConfigs));
            
            // Ensure we have at least the default models in local config
            if (!this.modelConfigs["o1hp"]) {
                console.log("Adding o1hp to model configs for dropdown");
                this.modelConfigs["o1hp"] = {
                    name: "o1hp",
                    description: "Advanced reasoning model for complex tasks",
                    supports_streaming: false
                };
            }
            
            if (!this.modelConfigs["DeepSeek-R1"]) {
                console.log("Adding DeepSeek-R1 to model configs for dropdown");
                this.modelConfigs["DeepSeek-R1"] = {
                    name: "DeepSeek-R1",
                    description: "Model that supports chain-of-thought reasoning",
                    supports_streaming: true
                };
            }
            
            // Populate with current models
            for (const [id, config] of Object.entries(this.modelConfigs)) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${id}${config.description ? ` (${config.description})` : ''}`;
                modelSelect.appendChild(option);
            }
            
            // Set the dropdown to the server's last-used model
            this.getCurrentModelFromServer().then(currentModel => {
                if (currentModel) {
                    this.currentModel = currentModel;
                    modelSelect.value = currentModel;
                    this.updateModelSpecificUI(currentModel);
                }
            });
            
            // Listen for changes in the model dropdown
            modelSelect.addEventListener('change', async (e) => {
                await this.switchModel(e.target.value);
            });
            console.log('Model select dropdown initialized with options');
        }
    }
    
    /**
     * Get the current model from the server (usually stored in session).
     * @returns {Promise<string|null>}
     */
    async getCurrentModelFromServer() {
        try {
            const response = await fetch('/api/session');
            if (!response.ok) return null;
            
            const session = await response.json();
            if (session && session.last_model) {
                return session.last_model;
            }
            return Object.keys(this.modelConfigs)[0] || 'DeepSeek-R1';
        } catch (error) {
            console.error('Error getting current model:', error);
            return null;
        }
    }
}

// Export a singleton instance
export const modelManager = new ModelManager();

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Document loaded, initializing ModelManager');
    modelManager.initialize().catch(err => {
        console.error('Error initializing ModelManager on page load:', err);
    });
    
    // Inject mobile styling
    addMobileStyles();
});

/**
 * Inject additional mobile-specific styles (touch targets, animations, etc.)
 */
function addMobileStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .touch-target {
            min-height: 44px;
            min-width: 44px;
        }
        
        .touch-action-manipulation {
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translate(-50%, -20px); }
            to   { opacity: 1; transform: translate(-50%, 0); }
        }
        
        @keyframes fadeOut {
            from { opacity: 1; transform: translate(-50%, 0); }
            to   { opacity: 0; transform: translate(-50%, -20px); }
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
    `;
    document.head.appendChild(style);
}
