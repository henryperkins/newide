// Model configuration and management

class ModelManager {
    constructor() {
        this.currentModel = null;
        this.modelConfigs = {
            "DeepSeek-R1": {
                name: "DeepSeek-R1",
                description: "Reasoning-focused model with high performance in math, coding, and science",
                maxTokens: 32000,
                supportsTemperature: false,
                supportsStreaming: true,
                isReasoningModel: true,
                reasoningEfforts: ["low", "medium", "high"],
                defaultReasoningEffort: "medium"
            },
            "o1": {
                name: "o1",
                description: "High-performance model for complex tasks",
                maxTokens: 40000,
                supportsTemperature: false,
                supportsStreaming: false,
                isReasoningModel: false
            }
        };
    }

    async initialize() {
        try {
            // Get available models from server instead of hardcoded defaults
            const response = await fetch('/api/config/models');
            if (response.ok) {
                const serverModels = await response.json();
                this.modelConfigs = serverModels;
            } else {
                console.error('Error fetching model configurations:', await response.text());
            }
        } catch (error) {
            console.error('Error initializing models:', error);
        }

        // Create model selector UI
        this.createModelSelector();
        this.initModelManagement();
        
        // Initialize stats display using dynamic import
        import('./ui/statsDisplay.js').then(({ default: StatsDisplay }) => {
            this.statsDisplay = new StatsDisplay('stats-container');
        }).catch(error => {
            console.error('Error loading stats display:', error);
        });
    }
    
    // Add model management initialization
    initModelManagement() {
        // Set up the models tab UI
        const addModelBtn = document.getElementById('add-model-btn');
        const modelForm = document.getElementById('model-form');
        const cancelBtn = document.getElementById('model-form-cancel');
        
        if (addModelBtn) {
            addModelBtn.addEventListener('click', () => this.showModelForm('add'));
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideModelForm());
        }
        
        if (modelForm) {
            modelForm.addEventListener('submit', (e) => this.handleModelFormSubmit(e));
        }
        
        // Initialize models list
        this.refreshModelsList();
    }
    
    // Add method to show the model form
    showModelForm(mode, modelId = null) {
        const formContainer = document.getElementById('model-form-container');
        const formTitle = document.getElementById('model-form-title');
        const formMode = document.getElementById('model-form-mode');
        const formIdField = document.getElementById('model-form-id');
        
        if (!formContainer || !formTitle || !formMode || !formIdField) return;
        
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
        }
        
        // Show form
        formContainer.classList.remove('hidden');
    }
    
    // Add method to hide the model form
    hideModelForm() {
        const formContainer = document.getElementById('model-form-container');
        if (formContainer) {
            formContainer.classList.add('hidden');
        }
    }
    
    // Add method to handle form submission
    async handleModelFormSubmit(e) {
        e.preventDefault();
        
        const formMode = document.getElementById('model-form-mode').value;
        const formIdField = document.getElementById('model-form-id');
        const modelId = formMode === 'add' 
            ? document.getElementById('model-name').value
            : formIdField.value;
            
        // Collect form data
        const modelData = {
            name: modelId,
            description: document.getElementById('model-description').value,
            azure_endpoint: document.getElementById('model-endpoint').value,
            api_version: document.getElementById('model-api-version').value,
            max_tokens: parseInt(document.getElementById('model-max-tokens').value, 10),
            supports_temperature: document.getElementById('model-supports-temperature').checked,
            supports_streaming: document.getElementById('model-supports-streaming').checked,
            // Default values
            base_timeout: 120.0,
            max_timeout: 300.0,
            token_factor: 0.05
        };
        
        try {
            // API endpoint changes based on add vs. edit
            const url = `/api/config/models/${modelId}`;
            const method = formMode === 'add' ? 'POST' : 'PUT';
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`Model ${formMode === 'add' ? 'created' : 'updated'}:`, result);
                
                // Refresh models and hide form
                await this.refreshModelsList();
                this.hideModelForm();
                
                // Show success message
                alert(`Model ${modelId} ${formMode === 'add' ? 'created' : 'updated'} successfully.`);
            } else {
                const error = await response.json();
                alert(`Error: ${error.detail || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Error submitting model form:', error);
            alert('An error occurred. Please check console for details.');
        }
    }
    
    // Add method to refresh models list
    async refreshModelsList() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;
        
        // Show loading state
        listContainer.innerHTML = '<div class="text-gray-500 dark:text-gray-400 text-sm">Loading models...</div>';
        
        try {
            // Fetch latest models
            const response = await fetch('/api/config/models');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Log the response for debugging
            const response_data = await response.json();
            console.log("API response:", response_data);
            
            // Handle both possible response formats
            let models;
            if (response_data.models) {
                // The API returned {models: {o1hp: {...}}} format
                console.log("Converting API format to internal format");
                models = {};
                // Convert the API format to our internal format
                for (const [id, apiModel] of Object.entries(response_data.models)) {
                    models[id] = {
                        name: id,
                        description: `Model configuration for ${id}`,
                        max_tokens: 40000,
                        supports_streaming: false,
                        supports_temperature: false,
                        api_version: apiModel.api_version,
                        azure_endpoint: apiModel.endpoint,
                        base_timeout: 120.0,
                        max_timeout: 300.0,
                        token_factor: 0.05
                    };
                }
            } else {
                // Assume direct model format: {o1hp: {name: "o1hp", ...}}
                models = response_data;
            }
            
            console.log("Using models:", models);
            this.modelConfigs = models; // Update local cache
            
            // Clear container
            listContainer.innerHTML = '';
            
            // Create card for each model
            if (Object.keys(models).length === 0) {
                listContainer.innerHTML = '<div class="text-gray-500 dark:text-gray-400 text-sm">No models configured.</div>';
                return;
            }
            
            for (const [id, config] of Object.entries(models)) {
                const card = document.createElement('div');
                card.className = 'border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-white dark:bg-gray-700';
                
                // Check if this is the default model
                const isDefault = id === 'o1hp'; // This should match the default from config.py
                
                card.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div>
                            <h3 class="font-medium">
                                ${id}
                                ${isDefault ? '<span class="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">Default</span>' : ''}
                            </h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400">${config.description || 'No description'}</p>
                        </div>
                        <div class="flex space-x-1">
                            <button class="edit-model-btn p-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300" data-model-id="${id}">
                                <span aria-hidden="true">✏️</span>
                                <span class="sr-only">Edit</span>
                            </button>
                            ${!isDefault ? `
                                <button class="delete-model-btn p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300" data-model-id="${id}">
                                    <span aria-hidden="true">🗑️</span>
                                    <span class="sr-only">Delete</span>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span class="text-gray-500 dark:text-gray-400">Max Tokens:</span>
                            <span>${config.max_tokens}</span>
                        </div>
                        <div>
                            <span class="text-gray-500 dark:text-gray-400">API Version:</span>
                            <span>${config.api_version}</span>
                        </div>
                        <div>
                            <span class="text-gray-500 dark:text-gray-400">Streaming:</span>
                            <span>${config.supports_streaming ? 'Yes' : 'No'}</span>
                        </div>
                        <div>
                            <span class="text-gray-500 dark:text-gray-400">Temperature:</span>
                            <span>${config.supports_temperature ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                `;
                
                listContainer.appendChild(card);
            }
            
            // Add event listeners to edit/delete buttons
            listContainer.querySelectorAll('.edit-model-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const modelId = btn.getAttribute('data-model-id');
                    this.showModelForm('edit', modelId);
                });
            });
            
            listContainer.querySelectorAll('.delete-model-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const modelId = btn.getAttribute('data-model-id');
                    
                    if (confirm(`Are you sure you want to delete the model "${modelId}"?`)) {
                        await this.deleteModel(modelId);
                    }
                });
            });
        } catch (error) {
            console.error('Error refreshing models list:', error);
            listContainer.innerHTML = '<div class="text-red-500 dark:text-red-400">Error loading models. See console for details.</div>';
        }
    }
    
    // Add method to delete a model
    async deleteModel(modelId) {
        try {
            const response = await fetch(`/api/config/models/${modelId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                await this.refreshModelsList();
                alert(`Model ${modelId} deleted successfully.`);
            } else {
                const error = await response.json();
                alert(`Error: ${error.detail || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Error deleting model:', error);
            alert('An error occurred while deleting the model.');
        }
    }

    createModelSelector() {
        const configSection = document.getElementById('config-content');
        if (!configSection) return;

        const modelSection = document.createElement('div');
        modelSection.className = 'config-section model-selection';
        modelSection.innerHTML = `
            <h3>Model Selection</h3>
            <div class="model-selector">
                <select id="model-select">
                    ${Object.entries(this.modelConfigs)
                        .map(([id, config]) => `
                            <option value="${id}">${config.name}</option>
                        `).join('')}
                </select>
            </div>
            <div class="model-info">
                <div class="model-description"></div>
                <div class="model-capabilities"></div>
            </div>
            <div id="reasoning-controls" style="display: none;">
                <h4>Reasoning Effort</h4>
                <select id="reasoning-effort" class="reasoning-effort-select">
                    <option value="low">Low</option>
                    <option value="medium" selected>Medium</option>
                    <option value="high">High</option>
                </select>
                <div class="effort-description">
                    Adjust the model's reasoning depth and thoroughness.
                </div>
            </div>
        `;

        configSection.appendChild(modelSection);

        // Set up event listeners
        const modelSelect = document.getElementById('model-select');
        const reasoningControls = document.getElementById('reasoning-controls');

        if (modelSelect) {
            modelSelect.addEventListener('change', (e) => {
                const modelId = e.target.value;
                this.setModel(modelId);
                
                // Update reasoning controls visibility
                const modelConfig = this.modelConfigs[modelId];
                if (modelConfig.isReasoningModel) {
                    reasoningControls.style.display = 'block';
                } else {
                    reasoningControls.style.display = 'none';
                }

                // Update model info display
                this.updateModelInfo(modelId);
                
                // Dispatch model change event
                window.dispatchEvent(new CustomEvent('modelChanged', {
                    detail: { model: modelId }
                }));
            });

            // Set initial model
            const initialModel = modelSelect.value;
            this.setModel(initialModel);
            this.updateModelInfo(initialModel);
        }
    }

    updateModelInfo(modelId) {
        const modelConfig = this.modelConfigs[modelId];
        const descriptionEl = document.querySelector('.model-description');
        const capabilitiesEl = document.querySelector('.model-capabilities');

        if (descriptionEl && modelConfig) {
            descriptionEl.textContent = modelConfig.description;
        }

        if (capabilitiesEl && modelConfig) {
            capabilitiesEl.innerHTML = `
                <ul>
                    <li>Max Tokens: ${modelConfig.maxTokens.toLocaleString()}</li>
                    <li>Temperature: ${modelConfig.supportsTemperature ? 'Supported' : 'Not supported'}</li>
                    <li>Streaming: ${modelConfig.supportsStreaming ? 'Supported' : 'Not supported'}</li>
                    ${modelConfig.isReasoningModel ? '<li>Reasoning Model: Enhanced problem-solving capabilities</li>' : ''}
                </ul>
            `;
        }
    }

    setModel(modelId) {
        this.currentModel = modelId;
        const modelConfig = this.modelConfigs[modelId];
        
        // Update chat interface based on model capabilities
        const reasoningControls = document.getElementById('reasoning-controls');
        if (modelConfig.isReasoningModel) {
            if (reasoningControls) reasoningControls.style.display = 'block';
        } else {
            if (reasoningControls) reasoningControls.style.display = 'none';
        }
    }

    getCurrentModel() {
        return this.currentModel;
    }

    getModelConfig(modelId = null) {
        const id = modelId || this.currentModel;
        return this.modelConfigs[id];
    }

    getReasoningEffort() {
        const reasoningSelect = document.getElementById('reasoning-effort');
        if (reasoningSelect && this.getModelConfig()?.isReasoningModel) {
            return reasoningSelect.value;
        }
        return null;
    }

    prepareModelParams() {
        const modelConfig = this.getModelConfig();
        const params = {
            model: this.currentModel
        };

        if (modelConfig.isReasoningModel) {
            params.reasoning_effort = this.getReasoningEffort();
        }

        if (modelConfig.supportsTemperature) {
            params.temperature = 0.7; // Default temperature
        }

        return params;
    }
}

// Export singleton instance
export const modelManager = new ModelManager();
