import { showNotification, showConfirmDialog } from './ui/notificationManager.js';
import { fetchWithErrorHandling, createCache, eventBus } from './utils/helpers.js';
import { getModelAPIConfig, updateConfig } from './config.js';
import { getSessionId } from './session.js';
import { generateDefaultModelConfig, KNOWN_MODELS } from './utils/modelUtils.js';
import { globalStore } from './store.js';

class ModelManager {
    constructor() {
        if (!globalStore.currentModel) {
            globalStore.currentModel = 'DeepSeek-R1';
        }
        if (!globalStore.modelConfigs) {
            globalStore.modelConfigs = {};
        }
        this.isInitialized = false;
        this.pendingModelActions = {};
        this.modelConfigCache = createCache(5 * 60 * 1000);
    }

    get modelConfigs() {
        return globalStore.modelConfigs;
    }

    async initialize() {
        try {
            this.ensureLocalModelConfigs();
            this.updateModelsList();
            await this.refreshModelsList();
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
            const currentModel = await this.getCurrentModelFromServer() || Object.keys(globalStore.modelConfigs)[0];
            if (currentModel) {
                globalStore.currentModel = currentModel;
                await this.updateModelSpecificUI(currentModel);
                eventBus.publish('modelInitialized', { currentModel, models: Object.keys(globalStore.modelConfigs) });
            }
            return true;
        } catch (error) {
            console.error('Error initializing ModelManager:', error);
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
            globalStore.modelConfigs = models;
            this.updateModelsList();
            return models;
        } catch (error) {
            console.error('Error loading models:', error);
            this.ensureLocalModelConfigs();
            this.updateModelsList();
            return globalStore.modelConfigs;
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
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading models...
                </div>
            `;
        } else {
            listContainer.innerHTML = '';
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
        if (Object.keys(globalStore.modelConfigs).length === 0) {
            listContainer.innerHTML = `
                <div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">
                    No models configured.
                </div>
            `;
            return;
        }
        for (const [id, modelConfig] of Object.entries(globalStore.modelConfigs)) {
            const card = document.createElement('div');
            card.className = `card p-3 mb-3 transition hover:border-primary-200 dark:hover:border-primary-700 ${globalStore.currentModel === id ? 'border-l-4 border-l-primary-500' : ''}`;
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
                <button class="delete-model-btn btn btn-icon btn-danger" data-model-id="${id}" aria-label="Delete ${id} model" ${globalStore.currentModel === id ? 'disabled' : ''}>
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

            if (globalStore.currentModel === id) {
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
                if (globalStore.currentModel === modelId) {
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
                        if (globalStore.currentModel !== modelId) {
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
        if (globalStore.currentModel === modelId) {
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
                if (globalStore.modelConfigs[modelId]) delete globalStore.modelConfigs[modelId];
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
        if (mode === 'edit' && modelId && globalStore.modelConfigs[modelId]) {
            const config = globalStore.modelConfigs[modelId];
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
            document.getElementById('model-endpoint').value = 'https://o1s.openai.azure.com';
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
            supports_streaming: document.getElementById('model-supports-streaming').checked,
            supports_temperature: document.getElementById('model-supports-temperature').checked,
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
                body: JSON.stringify(modelData),
                cache: 'no-cache'
            });
            delete this.pendingModelActions[modelId];
            if (response.ok) {
                globalStore.modelConfigs[modelId] = modelData;
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
        if (globalStore.currentModel === modelId) return true;
        if (window.currentController) {
            window.currentController.abort();
            window.currentController = null;
            showNotification('Stopped the current model inference; switching now...', 'info');
        }
        if (!globalStore.modelConfigs[modelId]) {
            const knownModel = KNOWN_MODELS.find(m => m.id.toLowerCase() === modelId.toLowerCase());
            if (knownModel) {
                const newConfig = generateDefaultModelConfig(modelId, knownModel.modelApiConfig);
                globalStore.modelConfigs[modelId] = newConfig;
                try {
                    await this.createModelOnServer(modelId, newConfig);
                } catch (err) { }
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
            if (!sessionId) throw new Error('No valid session ID available');
            const modelConfig = globalStore.modelConfigs[modelId];
            const modelType = modelConfig.model_type || 'standard';
            const { switchSessionModel } = await import('./session.js');
            const success = await switchSessionModel(sessionId, modelId);
            delete this.pendingModelActions[modelId];
            if (!success) throw new Error(`Failed to update session model to ${modelId}`);
            try {
                await fetch(`${window.location.origin}/api/config/models/switch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model_id: modelId, session_id: sessionId })
                });
            } catch { }
            globalStore.currentModel = modelId;
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
        const o1Model = KNOWN_MODELS.find(m => m.id.toLowerCase() === 'o1');
        let newConfig;
        if (o1Model && !globalStore.modelConfigs['o1']) {
            newConfig = generateDefaultModelConfig('o1', o1Model.modelApiConfig);
            globalStore.modelConfigs['o1'] = newConfig;
            if (!this.pendingModelActions['o1'] && newConfig) {
                this.createModelOnServer('o1', newConfig).catch(() => { });
            }
        }
        for (const { id, modelApiConfig } of KNOWN_MODELS) {
            if (globalStore.modelConfigs[id]) continue;
            if (id.toLowerCase() === 'o1') continue;
            const existingModel = Object.keys(globalStore.modelConfigs).find(k => k.toLowerCase() === id.toLowerCase());
            if (!existingModel) {
                const newConfig = generateDefaultModelConfig(id, modelApiConfig);
                globalStore.modelConfigs[id] = newConfig;
                if (!this.pendingModelActions[id] && newConfig) {
                    this.createModelOnServer(id, newConfig).catch(() => { });
                }
            } else if (existingModel !== id) {
                globalStore.modelConfigs[id] = globalStore.modelConfigs[existingModel];
                delete globalStore.modelConfigs[existingModel];
            }
        }
        const hasDeepSeek = Object.keys(globalStore.modelConfigs).some(k => k.toLowerCase().includes('deepseek'));
        if (!hasDeepSeek) {
            const deepseekConfig = generateDefaultModelConfig('DeepSeek-R1', KNOWN_MODELS[1].modelApiConfig);
            if (deepseekConfig) {
                globalStore.modelConfigs['DeepSeek-R1'] = deepseekConfig;
            }
        }
        if (!globalStore.modelConfigs['o1']) {
            const o1Default = {
                endpoint: "https://o1s.openai.azure.com",
                apiVersion: "2025-01-01-preview",
                maxTokens: 64000,
                supportsTemperature: false,
                supportsStreaming: false,
                requiresReasoningEffort: true
            };
            const newConfig = generateDefaultModelConfig('o1', o1Default);
            if (newConfig) {
                globalStore.modelConfigs['o1'] = newConfig;
            }
        }
        return globalStore.modelConfigs;
    }

    async getModelConfig(modelId) {
        modelId = modelId.trim();
        const cachedConfig = this.modelConfigCache.get(modelId);
        if (cachedConfig) return cachedConfig;
        if (globalStore.modelConfigs[modelId]) {
            this.modelConfigCache.set(modelId, globalStore.modelConfigs[modelId]);
            return globalStore.modelConfigs[modelId];
        }
        try {
            const response = await fetch(`${window.location.origin}/api/config/models/${encodeURIComponent(modelId)}`);
            if (response.ok) {
                const config = await response.json();
                globalStore.modelConfigs[modelId] = config;
                this.modelConfigCache.set(modelId, config);
                return config;
            }
        } catch { }
        const defaultConfig = await this.createDefaultModelConfig(modelId);
        if (defaultConfig) {
            globalStore.modelConfigs[modelId] = defaultConfig;
            this.modelConfigCache.set(modelId, defaultConfig);
        }
        return defaultConfig;
    }

    async createDefaultModelConfig(modelId) {
        const modelApiConfig = await getModelAPIConfig(modelId);
        return generateDefaultModelConfig(modelId, modelApiConfig);
    }

    getModelIds() {
        return Object.keys(globalStore.modelConfigs);
    }

    isStreamingSupported(modelId) {
        const model = globalStore.modelConfigs[modelId];
        return model ? !!model.supports_streaming : false;
    }

    requiresReasoningEffort(modelId) {
        const model = globalStore.modelConfigs[modelId];
        return model ? !!model.requires_reasoning_effort : false;
    }

    getCurrentModelId() {
        return globalStore.currentModel;
    }

    initModelManagement() {
        const addModelBtn = document.getElementById('add-model-btn');
        const modelFormClose = document.getElementById('model-form-close');
        const modelFormCancel = document.getElementById('model-form-cancel');
        const modelForm = document.getElementById('model-form');
        if (addModelBtn) {
            const newAddModelBtn = addModelBtn.cloneNode(true);
            addModelBtn.parentNode.replaceChild(newAddModelBtn, addModelBtn);
            newAddModelBtn.addEventListener('click', () => {
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
            const newModelForm = modelForm.cloneNode(true);
            modelForm.parentNode.replaceChild(newModelForm, modelForm);
            newModelForm.addEventListener('submit', (e) => {
                this.handleModelFormSubmit(e);
            });
        }
        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            modelSelect.addEventListener('change', async (e) => {
                const newModelId = e.target.value;
                if (newModelId && newModelId !== globalStore.currentModel) {
                    await this.switchModel(newModelId);
                }
            });
        }
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
                if (data.currentModel && data.currentModel.toLowerCase() === 'o1model') {
                    data.currentModel = 'o1';
                }
                return data.currentModel || null;
            } else if (response.status === 404) {
                return Object.keys(globalStore.modelConfigs)[0] || null;
            } else {
                return Object.keys(globalStore.modelConfigs)[0] || null;
            }
        } catch {
            return Object.keys(globalStore.modelConfigs)[0] || null;
        }
    }

    async createModelOnServer(modelId, modelConfig) {
        if (this.pendingModelActions[modelId]) return;
        this.pendingModelActions[modelId] = 'create';
        try {
            const response = await fetch(`${window.location.origin}/api/config/models/${encodeURIComponent(modelId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelConfig)
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to create model ${modelId} on server: ${errorText}`);
            }
            const data = await response.json().catch(() => ({}));
            globalStore.modelConfigs[modelId] = modelConfig;
            this.modelConfigCache.clear();
            return data;
        } catch (error) {
            console.error(`[createModelOnServer] Error creating ${modelId}:`, error);
            throw error;
        } finally {
            delete this.pendingModelActions[modelId];
        }
    }
}

export const modelManager = new ModelManager();