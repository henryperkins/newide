import { showNotification, showConfirmDialog } from './ui/notificationManager.js';
import { fetchWithErrorHandling, createCache, eventBus } from './utils/helpers.js';
import { getModelAPIConfig, updateConfig } from './config.js';
import { getSessionId } from './session.js';
import { generateDefaultModelConfig, KNOWN_MODELS } from './utils/modelUtils.js';


class ModelManager {
    constructor() {
        this.currentModel = null;
        this.modelConfigs = {};
        this.isInitialized = false;
        this.pendingModelActions = {};
        this.modelConfigCache = createCache(5 * 60 * 1000);
    }

    async initialize() {
        try {
            // First ensure we have the basic known models loaded
            console.log("Pre-loading known models before server request");
            this.ensureLocalModelConfigs();
            
            // Update the UI with what we have so far
            this.updateModelsList();
            
            // Then try to fetch from server (will add any additional models)
            await this.refreshModelsList();
            
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
            
            const currentModel = await this.getCurrentModelFromServer() || Object.keys(this.modelConfigs)[0];
            if (currentModel) {
                this.currentModel = currentModel;
                await this.updateModelSpecificUI(currentModel);
                eventBus.publish('modelInitialized', { currentModel, models: Object.keys(this.modelConfigs) });
            }
            return true;
        } catch (error) {
            console.error('Error initializing ModelManager:', error);
            
            // Make sure we at least have the known models
            this.ensureLocalModelConfigs();
            this.updateModelsList();
            
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
            
            eventBus.publish('modelInitError', { error });
            return false;
        }
    }

    async refreshModelsList() {
        try {
            this.setModelsListLoadingState(true);
            const response = await fetch(`${window.location.origin}/api/config/models`);
            if (!response.ok) throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
            let models = await response.json();
            if (models.models) models = models.models;
            this.modelConfigs = models;
            this.updateModelsList();
            return models;
        } catch (error) {
            console.error('Error loading models:', error);
            
            // Create known models from local defaults
            console.log("Creating known models from local defaults");
            this.ensureLocalModelConfigs();
            
            // Now update the models list using the local configs
            this.updateModelsList();
            return this.modelConfigs;
        } finally {
            this.setModelsListLoadingState(false);
        }
    }

    setModelsListLoadingState(isLoading) {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;
        if (isLoading) {
            listContainer.innerHTML = `
                <div class="flex items-center justify-center p-4 text-dark-500 dark:text-dark-400 text-sm">
                    <svg class="animate-spin h-5 w-5 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading models...
                </div>
            `;
        }
    }

    showModelsListError(error) {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;
        listContainer.innerHTML = `
            <div class="text-red-500 dark:text-red-400 text-sm p-4 text-center">
                Failed to load models: ${error.message}
                <button id="retry-models-btn" class="btn btn-primary mx-auto block mt-2 text-sm">
                    Retry
                </button>
            </div>
        `;
        document.getElementById('retry-models-btn')?.addEventListener('click', () => this.refreshModelsList());
    }

    updateModelsList() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;
        listContainer.innerHTML = '';
        if (Object.keys(this.modelConfigs).length === 0) {
            listContainer.innerHTML = `
                <div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">
                    No models configured.
                </div>
            `;
            return;
        }
        for (const [id, modelConfig] of Object.entries(this.modelConfigs)) {
            const card = document.createElement('div');
            card.className = `card p-3 mb-3 transition hover:border-primary-200 dark:hover:border-primary-700 ${this.currentModel === id ? 'border-l-4 border-l-primary-500' : ''}`;
            card.dataset.modelId = id;

            const cardHeader = document.createElement('div');
            cardHeader.className = 'flex flex-col sm:flex-row justify-between sm:items-center';

            const modelInfo = document.createElement('div');
            modelInfo.className = 'mb-2 sm:mb-0';
            modelInfo.innerHTML = `
                <h3 class="font-medium text-base">${id}</h3>
                <p class="text-sm text-dark-500 dark:text-dark-400">${modelConfig.description || 'No description'}</p>
            `;

            const actionButtons = document.createElement('div');
            actionButtons.className = 'flex space-x-2';
            actionButtons.innerHTML = `
                <button class="edit-model-btn btn btn-icon btn-secondary" data-model-id="${id}" aria-label="Edit ${id} model">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                </button>
                <button class="delete-model-btn btn btn-icon btn-danger" data-model-id="${id}" aria-label="Delete ${id} model" ${this.currentModel === id ? 'disabled' : ''}>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            `;

            cardHeader.appendChild(modelInfo);
            cardHeader.appendChild(actionButtons);
            card.appendChild(cardHeader);

            const specsGrid = document.createElement('div');
            specsGrid.className = 'grid grid-cols-2 gap-2 mt-2 text-xs sm:text-sm text-dark-600 dark:text-dark-300';
            const specs = [
                { label: 'Tokens', value: modelConfig.max_tokens?.toLocaleString() || 'Default' },
                { label: 'Streaming', value: modelConfig.supports_streaming ? 'Yes' : 'No' },
                { label: 'Vision', value: modelConfig.supports_vision ? 'Yes' : 'No' },
                { label: 'API Version', value: modelConfig.api_version || '2025-01-01-preview' }
            ];
            specs.forEach(spec => {
                const specItem = document.createElement('div');
                specItem.innerHTML = `<span class="font-medium">${spec.label}:</span> ${spec.value}`;
                specsGrid.appendChild(specItem);
            });
            card.appendChild(specsGrid);

            if (this.currentModel === id) {
                const currentBadge = document.createElement('div');
                currentBadge.className = 'mt-2 inline-flex items-center bg-primary-100 dark:bg-primary-900/20 px-2 py-0.5 text-xs font-medium text-primary-800 dark:text-primary-300 rounded-full';
                currentBadge.textContent = 'Current';
                card.appendChild(currentBadge);
            } else {
                const useModelBtn = document.createElement('button');
                useModelBtn.className = 'mt-2 btn btn-secondary text-xs use-model-btn';
                useModelBtn.textContent = 'Use Model';
                useModelBtn.setAttribute('data-model-id', id);
                card.appendChild(useModelBtn);
            }

            listContainer.appendChild(card);
        }
        this.attachModelActionListeners();
    }

    attachModelActionListeners() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;

        listContainer.querySelectorAll('.edit-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                btn.classList.add('transform', 'scale-95');
                setTimeout(() => btn.classList.remove('transform', 'scale-95'), 150);
                const modelId = btn.getAttribute('data-model-id');
                this.showModelForm('edit', modelId);
            });
        });

        listContainer.querySelectorAll('.delete-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                btn.classList.add('transform', 'scale-95');
                setTimeout(() => btn.classList.remove('transform', 'scale-95'), 150);
                const modelId = btn.getAttribute('data-model-id');
                if (this.currentModel === modelId) {
                    showNotification('Cannot delete the currently active model', 'warning');
                    return;
                }
                showConfirmDialog(
                    'Delete Model',
                    `Are you sure you want to delete the model "${modelId}"? This action cannot be undone.`,
                    async () => await this.deleteModel(modelId)
                );
            });
        });

        listContainer.querySelectorAll('.use-model-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const modelId = btn.getAttribute('data-model-id');
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Switching...';
                try {
                    await this.switchModel(modelId);
                    this.updateModelsList();
                } catch (error) {
                    console.error('Error switching model:', error);
                    showNotification(`Failed to switch to model ${modelId}`, 'error');
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });
        });

        listContainer.querySelectorAll('.card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    const modelId = card.dataset.modelId;
                    if (modelId) {
                        if (this.currentModel !== modelId) {
                            this.switchModel(modelId);
                        } else {
                            this.showModelForm('edit', modelId);
                        }
                    }
                }
            });
        });
    }

    async deleteModel(modelId) {
        if (this.currentModel === modelId) {
            showNotification('Cannot delete the currently active model', 'warning');
            return false;
        }
        try {
            this.pendingModelActions[modelId] = 'delete';
            const modelCard = document.querySelector(`.card[data-model-id="${modelId}"]`);
            if (modelCard) modelCard.classList.add('opacity-50', 'pointer-events-none');
            const response = await fetch(`${window.location.origin}/api/config/models/${modelId}`, { method: 'DELETE' });
            delete this.pendingModelActions[modelId];
            if (modelCard) modelCard.classList.remove('opacity-50', 'pointer-events-none');

            if (response.ok) {
                if (this.modelConfigs[modelId]) delete this.modelConfigs[modelId];
                this.modelConfigCache.clear();
                showNotification(`Model ${modelId} deleted successfully`, 'success');
                this.updateModelsList();
                eventBus.publish('modelDeleted', { modelId });
                return true;
            } else {
                const errorText = await response.text();
                console.error('Delete error:', errorText);
                showNotification(`Error: ${errorText}`, 'error');
                return false;
            }
        } catch (error) {
            console.error('Error deleting model:', error);
            showNotification('An error occurred while deleting the model', 'error');
            delete this.pendingModelActions[modelId];
            return false;
        }
    }

    showModelForm(mode, modelId = null) {
        const formContainer = document.getElementById('model-form-container');
        const formTitle = document.getElementById('model-form-title');
        const formMode = document.getElementById('model-form-mode');
        const formIdField = document.getElementById('model-form-id');
        const form = document.getElementById('model-form');
        if (!formContainer || !formTitle || !formMode || !formIdField || !form) return;

        form.reset();
        form.querySelectorAll('.form-error').forEach(el => el.remove());
        form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

        formMode.value = mode;
        formTitle.textContent = (mode === 'add') ? 'Add New Model' : 'Edit Model';

        if (mode === 'edit' && modelId && this.modelConfigs[modelId]) {
            const config = this.modelConfigs[modelId];
            formIdField.value = modelId;
            document.getElementById('model-name').value = modelId;
            document.getElementById('model-name').disabled = true;
            document.getElementById('model-description').value = config.description || '';
            document.getElementById('model-endpoint').value = config.azure_endpoint || '';
            document.getElementById('model-api-version').value = config.api_version || '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = config.max_tokens || 4096;
            document.getElementById('model-supports-temperature').checked = config.supports_temperature || false;
            document.getElementById('model-supports-streaming').checked = config.supports_streaming || false;
            document.getElementById('model-supports-vision').checked = config.supports_vision || false;
        } else {
            formIdField.value = '';
            document.getElementById('model-name').disabled = false;
            document.getElementById('model-endpoint').value = 'https://o1models.openai.azure.com';
            document.getElementById('model-api-version').value = '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = '4096';
        }

        formContainer.classList.remove('hidden');
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (mode === 'add') document.getElementById('model-name').focus();
                else document.getElementById('model-description').focus();
            }, 100);
        });
    }

    async handleModelFormSubmit(e) {
        e.preventDefault();
        const formModeVal = document.getElementById('model-form-mode').value;
        const formIdField = document.getElementById('model-form-id');
        const modelId = (formModeVal === 'add') ? document.getElementById('model-name').value.trim() : formIdField.value;
        if (!modelId) {
            this.showFormError('model-name', 'Model name is required');
            return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
            this.showFormError('model-name', 'Model name can only contain letters, numbers, underscores, and hyphens');
            return;
        }
        const endpoint = document.getElementById('model-endpoint').value.trim();
        if (!endpoint) {
            this.showFormError('model-endpoint', 'Azure endpoint is required');
            return;
        }
        try {
            new URL(endpoint);
        } catch (error) {
            this.showFormError('model-endpoint', 'Invalid URL format');
            return;
        }
        const modelData = {
            name: modelId,
            description: document.getElementById('model-description').value.trim(),
            azure_endpoint: endpoint,
            api_version: document.getElementById('model-api-version').value.trim() || '2025-01-01-preview',
            max_tokens: parseInt(document.getElementById('model-max-tokens').value, 10) || 4096,
            supports_temperature: document.getElementById('model-supports-temperature').checked,
            supports_streaming: document.getElementById('model-supports-streaming').checked,
            supports_vision: document.getElementById('model-supports-vision').checked,
            base_timeout: 120.0,
            max_timeout: 300.0,
            token_factor: 0.05
        };
        const form = document.getElementById('model-form');
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalBtnContent = submitBtn.innerHTML;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Saving...';
        }
        try {
            this.pendingModelActions[modelId] = formModeVal;
            const response = await fetch(`${window.location.origin}/api/config/models/${modelId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });
            delete this.pendingModelActions[modelId];
            if (response.ok) {
                this.modelConfigs[modelId] = modelData;
                this.modelConfigCache.clear();
                showNotification(`Model ${modelId} saved successfully`, 'success');
                this.updateModelsList();
                eventBus.publish('modelUpdated', { modelId, config: modelData, action: formModeVal });
                this.hideModelForm();
                return true;
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.detail || errorData.message || `Error: ${response.status} ${response.statusText}`;
                this.showFormError(null, errorMessage);
                return false;
            }
        } catch (error) {
            console.error('Error submitting model form:', error);
            this.showFormError(null, 'An error occurred. Please try again.');
            delete this.pendingModelActions[modelId];
            return false;
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnContent;
            }
        }
    }

    showFormError(fieldId, message) {
        const errorEl = document.createElement('div');
        errorEl.className = 'form-error text-red-500 text-sm mt-1';
        errorEl.textContent = message;
        if (fieldId) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.classList.add('input-error', 'border-red-500');
                field.parentNode.appendChild(errorEl);
                field.focus();
                field.addEventListener('input', () => {
                    field.classList.remove('input-error', 'border-red-500');
                    const existingErr = field.parentNode.querySelector('.form-error');
                    if (existingErr) existingErr.remove();
                }, { once: true });
            }
        } else {
            const form = document.getElementById('model-form');
            if (form) {
                form.prepend(errorEl);
                setTimeout(() => errorEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        }
        return errorEl;
    }

    hideModelForm() {
        const formContainer = document.getElementById('model-form-container');
        if (formContainer) formContainer.classList.add('hidden');
    }

  async switchModel(modelId) {
    if (this.currentModel === modelId) return true;

    // Abort current streaming/inference if it's in progress
    if (window.currentController) {
      console.log("[switchModel] Aborting current streaming inference...");
      window.currentController.abort();
      window.currentController = null;
      // Provide a small user-facing confirmation
      showNotification('Stopped the current model inference; switching now...', 'info');
    }
    console.log('[switchModel] Initiating switchModel for:', modelId, 'currentModel:', this.currentModel);

    // Check if model exists in configurations, create if it doesn't
    if (!this.modelConfigs[modelId]) {
      console.log(`Model ${modelId} not found in configurations, attempting to create it...`);
      
      // Check if it's a known model
      const knownModel = KNOWN_MODELS.find(m => m.id.toLowerCase() === modelId.toLowerCase());
      
      if (knownModel) {
        // Create the model config
        const newConfig = generateDefaultModelConfig(modelId, knownModel.modelApiConfig);
        this.modelConfigs[modelId] = newConfig;
        
        try {
          // Try to save to server
          const result = await this.createModelOnServer(modelId, newConfig);
          console.log(`Created model ${modelId} on server:`, result);
        } catch (err) {
          console.warn(`Failed to create ${modelId} on server: ${err.message}`);
          // We still continue with the local config
        }
      } else {
        console.error(`Model ${modelId} is not a known model and not in configurations`);
        showNotification(`Model ${modelId} not available`, 'error');
        return false;
      }
    }

        try {
            showNotification(`Switching to ${modelId}...`, 'info');
            this.pendingModelActions[modelId] = 'switch';
            const sessionId = await getSessionId();
            const modelConfig = this.modelConfigs[modelId];
            const modelType = modelConfig.model_type || 'standard';

            const requestBody = {
                model_id: modelId,
                session_id: sessionId
            };

            // Include any relevant model-specific settings
            if (modelType === 'o-series') {
                requestBody.reasoning_effort = modelConfig.reasoning_effort || 'medium';
            } else if (modelType === 'deepseek') {
                requestBody.enable_thinking = modelConfig.enable_thinking !== false;
            }

            const response = await fetch(`${window.location.origin}/api/config/models/switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            delete this.pendingModelActions[modelId];

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.detail || await response.text();
                throw new Error(`Failed to switch model: ${errorMessage}`);
            }

            await response.json();

            // Update UI or config as needed
            this.currentModel = modelId;
            updateConfig({
                selectedModel: modelId,
                modelType: modelType,
                apiVersion: modelConfig.api_version
            });

            showNotification(`Now using model: ${modelId}`, 'success');
            return true;
        } catch (error) {
            console.error('Error switching model:', error);
            showNotification('Failed to switch model. Please try again.', 'error');
            delete this.pendingModelActions[modelId];
            return false;
        }
    }

    ensureLocalModelConfigs() {
        console.log("Beginning ensureLocalModelConfigs...");
        console.log("KNOWN_MODELS:", KNOWN_MODELS);
        console.log("Current modelConfigs:", Object.keys(this.modelConfigs));
        
        // Make sure o1 model is always created first and consistently
        const o1Model = KNOWN_MODELS.find(m => m.id.toLowerCase() === 'o1');
        if (o1Model) {
            console.log("Found o1 model in KNOWN_MODELS:", o1Model);
            // Force create/update o1 config
            const newConfig = generateDefaultModelConfig('o1', o1Model.modelApiConfig);
            this.modelConfigs['o1'] = newConfig;
            console.log("Explicitly added o1 model to modelConfigs");
            
            // Skip server creation if it would fail or block
            if (!this.pendingModelActions['o1']) {
                this.createModelOnServer('o1', newConfig).catch(err =>
                    console.warn(`Failed to create o1 on server: ${err.message}`)
                );
            }
        } else {
            console.warn("O1 model not found in KNOWN_MODELS, this is unexpected");
        }
        
        // Process remaining known models
        for (const { id, modelApiConfig } of KNOWN_MODELS) {
            // Skip o1 as we already explicitly handled it above
            if (id.toLowerCase() === 'o1') continue;
            
            console.log(`Processing known model: ${id}`);
            const existingModel = Object.keys(this.modelConfigs).find(
                k => k.toLowerCase() === id.toLowerCase()
            );

            if (!existingModel) {
                console.log(`Model ${id} not found in configs, creating it...`);
                const newConfig = generateDefaultModelConfig(id, modelApiConfig);
                this.modelConfigs[id] = newConfig;
                
                if (!this.pendingModelActions[id]) {
                    this.createModelOnServer(id, newConfig).catch(err =>
                        console.warn(`Failed to create ${id} on server: ${err.message}`)
                    );
                }
            } else if (existingModel !== id) {
                console.log(`Found model with different case: ${existingModel} vs ${id}`);
                this.modelConfigs[id] = this.modelConfigs[existingModel];
                delete this.modelConfigs[existingModel];
            }
        }
        
        // Final verification
        console.log("After ensuring configs - models available:", Object.keys(this.modelConfigs));
        
        if (!this.modelConfigs['o1']) {
            console.warn("O1 STILL MISSING - forcing creation with default config");
            const o1Default = {
                endpoint: "https://o1models.openai.azure.com",
                apiVersion: "2025-01-01-preview",
                maxTokens: 64000,
                supportsTemperature: false,
                supportsStreaming: false,
                requiresReasoningEffort: true
            };
            this.modelConfigs['o1'] = generateDefaultModelConfig('o1', o1Default);
        }
        
        return this.modelConfigs;
    }

    async createModelOnServer(modelId, modelConfig) {
        if (this.pendingModelActions[modelId]) {
            console.log('[createModelOnServer] Already pending creation for:', modelId, 'pendingAction:', this.pendingModelActions[modelId]);
            console.warn(`Creation of ${modelId} already in progress`);
            return { status: "pending" };
        }
        try {
            this.pendingModelActions[modelId] = 'create';
            // If modelConfig is incomplete, fill in missing values with defaults
            const defaultConfig = generateDefaultModelConfig(modelId, {
                endpoint: modelConfig.azure_endpoint,
                apiVersion: modelConfig.api_version,
                maxTokens: modelConfig.max_tokens,
                supportsStreaming: modelConfig.supports_streaming,
                supportsTemperature: modelConfig.supports_temperature,
                supportsVision: modelConfig.supports_vision
            });
            
            const completeConfig = {
                ...defaultConfig,
                ...modelConfig,
                name: modelConfig.name || modelId,
                max_tokens: Number(modelConfig.max_tokens || defaultConfig.max_tokens),
                supports_streaming: Boolean(modelConfig.supports_streaming !== undefined ? modelConfig.supports_streaming : defaultConfig.supports_streaming),
                supports_temperature: Boolean(modelConfig.supports_temperature !== undefined ? modelConfig.supports_temperature : defaultConfig.supports_temperature),
                supports_vision: Boolean(modelConfig.supports_vision !== undefined ? modelConfig.supports_vision : defaultConfig.supports_vision),
                base_timeout: Number(modelConfig.base_timeout || defaultConfig.base_timeout),
                max_timeout: Number(modelConfig.max_timeout || defaultConfig.max_timeout),
                token_factor: Number(modelConfig.token_factor || defaultConfig.token_factor)
            };
            const response = await fetch(`${window.location.origin}/api/config/models/${modelId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(completeConfig),
                cache: 'no-cache'
            });
            delete this.pendingModelActions[modelId];
            if (response.ok) {
                this.modelConfigCache.set(modelId, completeConfig);
                return await response.json();
            } else {
                const status = response.status;
                if (status === 409) return { status: "exists", code: status };
                const errorText = await response.text();
                console.warn(`Server returned ${status} when creating model ${modelId}: ${errorText}`);
                return { status: "error", code: status, message: errorText };
            }
        } catch (error) {
            console.warn(`Network error creating model ${modelId}: ${error.message}`);
            delete this.pendingModelActions[modelId];
            return { status: "error", message: error.message };
        }
    }

    async getModelConfig(modelId) {
        modelId = modelId.trim();
        const cachedConfig = this.modelConfigCache.get(modelId);
        if (cachedConfig) return cachedConfig;
        if (this.modelConfigs[modelId]) {
            this.modelConfigCache.set(modelId, this.modelConfigs[modelId]);
            return this.modelConfigs[modelId];
        }
        try {
            const response = await fetch(`${window.location.origin}/api/config/models/${encodeURIComponent(modelId)}`);
            if (response.ok) {
                const config = await response.json();
                this.modelConfigs[modelId] = config;
                this.modelConfigCache.set(modelId, config);
                return config;
            }
        } catch (error) {
            console.warn(`Failed to fetch model config for ${modelId}:`, error);
        }
        const defaultConfig = await this.createDefaultModelConfig(modelId);
        if (defaultConfig) {
            this.modelConfigs[modelId] = defaultConfig;
            this.modelConfigCache.set(modelId, defaultConfig);
        }
        return defaultConfig;
    }

    async createDefaultModelConfig(modelId) {
        const modelApiConfig = await getModelAPIConfig(modelId);
        return generateDefaultModelConfig(modelId, modelApiConfig);
    }

    getModelIds() {
        return Object.keys(this.modelConfigs);
    }

    isStreamingSupported(modelId) {
        const model = this.modelConfigs[modelId];
        return model ? !!model.supports_streaming : false;
    }

    requiresReasoningEffort(modelId) {
        const model = this.modelConfigs[modelId];
        return model ? !!model.requires_reasoning_effort : false;
    }

    getCurrentModelId() {
        return this.currentModel;
    }

    initModelManagement() {
        const addModelBtn = document.getElementById('add-model-btn');
        const modelFormClose = document.getElementById('model-form-close');
        const modelFormCancel = document.getElementById('model-form-cancel');
        const modelForm = document.getElementById('model-form');

        // Ensure the add model button works
        if (addModelBtn) {
            // Remove any existing event listeners to prevent duplicates
            const newAddModelBtn = addModelBtn.cloneNode(true);
            addModelBtn.parentNode.replaceChild(newAddModelBtn, addModelBtn);
            
            // Add the event listener to show model form
            newAddModelBtn.addEventListener('click', () => {
                console.log('Add Model button clicked');
                this.showModelForm('add');
            });
        }

        if (modelFormClose) {
            modelFormClose.addEventListener('click', () => this.hideModelForm());
        }

        if (modelFormCancel) {
            modelFormCancel.addEventListener('click', (e) => {
                e.preventDefault();
                this.hideModelForm();
            });
        }

        if (modelForm) {
            // Ensure we don't have duplicate listeners
            const newModelForm = modelForm.cloneNode(true);
            modelForm.parentNode.replaceChild(newModelForm, modelForm);
            
            newModelForm.addEventListener('submit', (e) => {
                console.log('Model form submitted');
                this.handleModelFormSubmit(e);
            });
        }

        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            modelSelect.addEventListener('change', async (e) => {
                const newModelId = e.target.value;
                if (newModelId && newModelId !== this.currentModel) {
                    await this.switchModel(newModelId);
                }
            });
        }
        
        console.log('Model management UI initialized');
    }

    async updateModelSpecificUI(modelName) {
        try {
            const configModule = await import('./config.js');
            configModule.updateModelSpecificUI(modelName);
        } catch (error) {
            console.error('Error importing updateModelSpecificUI from config.js:', error);
        }
    }

    async getCurrentModelFromServer() {
        try {
            const response = await fetch(`${window.location.origin}/api/config/current-model`);
            if (response.ok) {
                const data = await response.json();
                return data.currentModel || null;
            } else if (response.status === 404) {
                console.info('Server returned 404 when getting current model - using first available model instead');
                return Object.keys(this.modelConfigs)[0] || null;
            } else {
                console.warn(`Server returned ${response.status} when getting current model - using first available model instead`);
                return Object.keys(this.modelConfigs)[0] || null;
            }
        } catch (error) {
            console.warn('Failed to get current model from server:', error);
            return Object.keys(this.modelConfigs)[0] || null;
        }
    }
}

export const modelManager = new ModelManager();
