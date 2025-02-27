// Enhanced models.js with improved UI, error handling, and touch interaction

import { showNotification, showConfirmDialog } from './ui/notificationManager.js';

class ModelManager {
    constructor() {
        this.currentModel = null;
        this.modelConfigs = {};
        this.isInitialized = false;
        this.pendingModelActions = {}; // Track pending API calls
    }

    /**
     * One-time initialization flow with improved error handling:
     * 1. Attempt to fetch existing models.
     * 2. If no models, create defaults (o1hp, DeepSeek-R1).
     * 3. Build the UI if not already done.
     */
    async initialize() {
        try {
            console.log('Initializing ModelManager...');
            
            // First refresh models list
            await this.refreshModelsList();
            
            // Always ensure local model configs exist
            this.ensureLocalModelConfigs();
            
            // Log model configs for debugging
            console.log('ModelManager initialized with models:', Object.keys(this.modelConfigs));
            
            // Build model management UI
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
            
            // Update UI for current model
            const currentModel = await this.getCurrentModelFromServer() || Object.keys(this.modelConfigs)[0];
            if (currentModel) {
                this.currentModel = currentModel;
                this.updateModelSpecificUI(currentModel);
            }
            
            return true;
        } catch (error) {
            console.error('Error initializing models:', error);
            showNotification('Failed to initialize models. Using default models.', 'warning');
            
            // Always ensure local models exist, even on error
            this.ensureLocalModelConfigs();
            
            // Initialize UI even on error
            if (!this.isInitialized) {
                this.initModelManagement();
                this.isInitialized = true;
            }
            
            return false;
        }
    }

    /**
     * Fetch all models from the server with improved error handling
     */
    async refreshModelsList() {
        const listContainer = document.getElementById('models-list');
        if (listContainer) {
            // Show loading state
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

        try {
            const response = await fetch('/api/config/models');
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
            }

            let models = await response.json();

            // Handle both formats: direct models object or models wrapped in a "models" property
            if (models.models) {
                models = models.models;
            }

            // Update local store
            this.modelConfigs = models;
            
            // Check if required models exist
            this.ensureLocalModelConfigs();

            // Update the UI
            this.updateModelsList();
            
            return models;
        } catch (error) {
            console.error('Error loading models:', error);
            
            // Show error in UI if container exists
            if (listContainer) {
                listContainer.innerHTML = `
                    <div class="text-red-500 dark:text-red-400 text-sm p-4 text-center">
                        Failed to load models: ${error.message}
                        <button id="retry-models-btn" class="btn btn-primary mx-auto block mt-2 text-sm">
                            Retry
                        </button>
                    </div>
                `;

                // Add a retry button
                document.getElementById('retry-models-btn')?.addEventListener('click', () => {
                    this.refreshModelsList();
                });
            }
            
            // Use local fallback models
            this.ensureLocalModelConfigs();
            
            return this.modelConfigs;
        }
    }

    /**
     * Update the UI list of models
     */
    updateModelsList() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;

        // Clear container
        listContainer.innerHTML = '';

        // If no models, show a message
        if (Object.keys(this.modelConfigs).length === 0) {
            listContainer.innerHTML = `
                <div class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">
                    No models configured.
                </div>
            `;
            return;
        }

        // Build a card for each model
        for (const [id, modelConfig] of Object.entries(this.modelConfigs)) {
            const card = document.createElement('div');
            card.className = `
                card p-3 mb-3 transition hover:border-primary-200 dark:hover:border-primary-700
                ${this.currentModel === id ? 'border-l-4 border-l-primary-500' : ''}
            `;
            card.dataset.modelId = id;
            
            // Card header
            const cardHeader = document.createElement('div');
            cardHeader.className = 'flex flex-col sm:flex-row justify-between sm:items-center';
            
            // Model info
            const modelInfo = document.createElement('div');
            modelInfo.className = 'mb-2 sm:mb-0';
            modelInfo.innerHTML = `
                <h3 class="font-medium text-base">${id}</h3>
                <p class="text-sm text-dark-500 dark:text-dark-400">
                    ${modelConfig.description || 'No description'}
                </p>
            `;
            
            // Action buttons
            const actionButtons = document.createElement('div');
            actionButtons.className = 'flex space-x-2';
            actionButtons.innerHTML = `
                <button class="edit-model-btn btn btn-icon btn-secondary" 
                        data-model-id="${id}" aria-label="Edit ${id} model">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                </button>
                <button class="delete-model-btn btn btn-icon btn-danger" 
                        data-model-id="${id}" aria-label="Delete ${id} model">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            `;
            
            // Append header elements
            cardHeader.appendChild(modelInfo);
            cardHeader.appendChild(actionButtons);
            card.appendChild(cardHeader);
            
            // Model specs grid
            const specsGrid = document.createElement('div');
            specsGrid.className = 'grid grid-cols-2 gap-2 mt-2 text-xs sm:text-sm text-dark-600 dark:text-dark-300';
            
            // Add model specs
            const specs = [
                { label: 'Tokens', value: modelConfig.max_tokens?.toLocaleString() || 'Default' },
                { label: 'Streaming', value: modelConfig.supports_streaming ? 'Yes' : 'No' },
                { label: 'Temperature', value: modelConfig.supports_temperature ? 'Yes' : 'No' },
                { label: 'API Version', value: modelConfig.api_version || '2025-01-01-preview' }
            ];
            
            specs.forEach(spec => {
                const specItem = document.createElement('div');
                specItem.innerHTML = `
                    <span class="font-medium">${spec.label}:</span>
                    ${spec.value}
                `;
                specsGrid.appendChild(specItem);
            });
            
            card.appendChild(specsGrid);
            
            // If this is the current model, add a "Current" badge
            if (this.currentModel === id) {
                const currentBadge = document.createElement('div');
                currentBadge.className = 'mt-2 inline-flex items-center bg-primary-100 dark:bg-primary-900/20 px-2 py-0.5 text-xs font-medium text-primary-800 dark:text-primary-300 rounded-full';
                currentBadge.textContent = 'Current';
                card.appendChild(currentBadge);
            } else {
                // Add a "Use Model" button for non-current models
                const useModelBtn = document.createElement('button');
                useModelBtn.className = 'mt-2 btn btn-secondary text-xs';
                useModelBtn.textContent = 'Use Model';
                useModelBtn.setAttribute('data-model-id', id);
                useModelBtn.classList.add('use-model-btn');
                card.appendChild(useModelBtn);
            }
            
            listContainer.appendChild(card);
        }

        // Hook up edit/delete event listeners
        this.attachModelActionListeners();
    }

    /**
     * Attach event listeners to model cards and buttons
     */
    attachModelActionListeners() {
        const listContainer = document.getElementById('models-list');
        if (!listContainer) return;

        // Edit button
        listContainer.querySelectorAll('.edit-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Tactile feedback
                btn.classList.add('transform', 'scale-95');
                setTimeout(() => {
                    btn.classList.remove('transform', 'scale-95');
                }, 150);

                const modelId = btn.getAttribute('data-model-id');
                this.showModelForm('edit', modelId);
            });
        });

        // Delete button - use confirm dialog
        listContainer.querySelectorAll('.delete-model-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Tactile feedback
                btn.classList.add('transform', 'scale-95');
                setTimeout(() => {
                    btn.classList.remove('transform', 'scale-95');
                }, 150);

                const modelId = btn.getAttribute('data-model-id');
                
                // Use confirm dialog instead of native confirm
                showConfirmDialog(
                    'Delete Model',
                    `Are you sure you want to delete the model "${modelId}"? This action cannot be undone.`,
                    async () => {
                        await this.deleteModel(modelId);
                    }
                );
            });
        });
        
        // Use Model button
        listContainer.querySelectorAll('.use-model-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const modelId = btn.getAttribute('data-model-id');
                
                // Show loading state
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Switching...';
                
                // Switch model
                try {
                    await this.switchModel(modelId);
                    // Update after success
                    this.updateModelsList();
                } catch (error) {
                    console.error('Error switching model:', error);
                    showNotification(`Failed to switch to model ${modelId}`, 'error');
                } finally {
                    // Reset button state
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });
        });

        // Make cards clickable (but not when clicking buttons)
        listContainer.querySelectorAll('.card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Only handle clicks directly on the card (not on buttons)
                if (!e.target.closest('button')) {
                    const modelId = card.dataset.modelId;
                    if (modelId) {
                        if (this.currentModel !== modelId) {
                            // If not current model, switch to it
                            this.switchModel(modelId);
                        } else {
                            // If already current model, edit it
                            this.showModelForm('edit', modelId);
                        }
                    }
                }
            });
        });
    }

    /**
     * Delete a model with visual feedback during API call
     */
    async deleteModel(modelId) {
        try {
            // Track this API call
            this.pendingModelActions[modelId] = 'delete';
            
            // Show "loading" styling on the model card
            const modelCard = document.querySelector(`.card[data-model-id="${modelId}"]`);
            if (modelCard) {
                modelCard.classList.add('opacity-50', 'pointer-events-none');
            }

            // Make API call
            const response = await fetch(`/api/config/models/${modelId}`, { method: 'DELETE' });

            // Remove from pending actions
            delete this.pendingModelActions[modelId];
            
            // Remove "loading" styling
            if (modelCard) {
                modelCard.classList.remove('opacity-50', 'pointer-events-none');
            }

            if (response.ok) {
                // Remove from local configs
                if (this.modelConfigs[modelId]) {
                    delete this.modelConfigs[modelId];
                }
                
                showNotification(`Model ${modelId} deleted successfully`, 'success');
                this.updateModelsList();
                
                // If we deleted the current model, switch to another one
                if (this.currentModel === modelId) {
                    const nextModel = Object.keys(this.modelConfigs)[0];
                    if (nextModel) {
                        await this.switchModel(nextModel);
                    }
                }
            } else {
                const errorText = await response.text();
                console.error('Delete error:', errorText);
                showNotification(`Error: ${errorText}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting model:', error);
            showNotification('An error occurred while deleting the model', 'error');
            
            // Remove from pending actions on error
            delete this.pendingModelActions[modelId];
        }
    }

    /**
     * Display the model form for adding or editing a model
     */
    showModelForm(mode, modelId = null) {
        const formContainer = document.getElementById('model-form-container');
        const formTitle = document.getElementById('model-form-title');
        const formMode = document.getElementById('model-form-mode');
        const formIdField = document.getElementById('model-form-id');
        const form = document.getElementById('model-form');

        if (!formContainer || !formTitle || !formMode || !formIdField || !form) {
            console.error('Model form elements not found in DOM');
            return;
        }

        // Reset form and clear previous errors
        form.reset();
        form.querySelectorAll('.form-error').forEach(el => el.remove());
        form.querySelectorAll('.input-error').forEach(el => {
            el.classList.remove('input-error');
        });

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
            document.getElementById('model-endpoint').value = 'https://aoai-east-2272068338224.cognitiveservices.azure.com';
            document.getElementById('model-api-version').value = '2025-01-01-preview';
            document.getElementById('model-max-tokens').value = '4096';
        }

        // Show the form container with animation
        formContainer.classList.remove('hidden');
        
        // Animate in
        requestAnimationFrame(() => {
            // Focus first field
            setTimeout(() => {
                if (mode === 'add') {
                    document.getElementById('model-name').focus();
                } else {
                    document.getElementById('model-description').focus();
                }
            }, 100);
        });
    }

    /**
     * Hide the model form
     */
    hideModelForm() {
        const formContainer = document.getElementById('model-form-container');
        if (formContainer) {
            // Add fade-out animation
            formContainer.classList.add('hidden');
        }
    }

    /**
     * Form validation with improved error display
     */
    showFormError(fieldId, message) {
        // Create error message element
        const errorEl = document.createElement('div');
        errorEl.className = 'form-error';
        errorEl.textContent = message;

        if (fieldId) {
            // Field-specific error
            const field = document.getElementById(fieldId);
            if (field) {
                // Add error styling
                field.classList.add('input-error');
                
                // Add error message after field
                field.parentNode.appendChild(errorEl);
                
                // Focus field
                field.focus();

                // Remove error styling after user changes the field
                field.addEventListener('input', () => {
                    field.classList.remove('input-error');
                    const existingErr = field.parentNode.querySelector('.form-error');
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
        
        return errorEl;
    }

    /**
     * Handle form submission with improved validation and feedback
     */
    async handleModelFormSubmit(e) {
        e.preventDefault();

        const formMode = document.getElementById('model-form-mode').value;
        const formIdField = document.getElementById('model-form-id');

        // If adding, modelId is from the 'name' field; if editing, from hidden input
        const modelId = (formMode === 'add')
            ? document.getElementById('model-name').value.trim()
            : formIdField.value;

        // Validation
        if (!modelId) {
            this.showFormError('model-name', 'Model name is required');
            return;
        }
        
        // Check for special characters in model name
        if (!/^[a-zA-Z0-9_-]+$/.test(modelId)) {
            this.showFormError('model-name', 'Model name can only contain letters, numbers, underscores, and hyphens');
            return;
        }

        // Validate endpoint URL
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

        // Collect data
        const modelData = {
            name: modelId,
            description: document.getElementById('model-description').value.trim(),
            azure_endpoint: endpoint,
            api_version: document.getElementById('model-api-version').value.trim() || '2025-01-01-preview',
            max_tokens: parseInt(document.getElementById('model-max-tokens').value, 10) || 4096,
            supports_temperature: document.getElementById('model-supports-temperature').checked,
            supports_streaming: document.getElementById('model-supports-streaming').checked,
            base_timeout: 120.0,
            max_timeout: 300.0,
            token_factor: 0.05
        };

        // Show loading state on the submit button
        const form = document.getElementById('model-form');
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalBtnContent = submitBtn.innerHTML;
        
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Saving...';
        }

        try {
            // Track this API call
            this.pendingModelActions[modelId] = formMode;
            
            // Make API call
            const response = await fetch(`/api/config/models/${modelId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });

            // Remove from pending actions
            delete this.pendingModelActions[modelId];

            if (response.ok) {
                // Update local model config
                this.modelConfigs[modelId] = modelData;
                
                // Success notification
                showNotification(`Model ${modelId} saved successfully`, 'success');
                
                // Refresh the model list
                this.updateModelsList();
                
                // Hide the form
                this.hideModelForm();
            } else {
                // Show error based on response
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.detail || errorData.message || `Error: ${response.status} ${response.statusText}`;
                this.showFormError(null, errorMessage);
            }
        } catch (error) {
            console.error('Error submitting model form:', error);
            this.showFormError(null, 'An error occurred. Please try again.');
            
            // Remove from pending actions on error
            delete this.pendingModelActions[modelId];
        } finally {
            // Reset submit button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnContent;
            }
        }
    }

    /**
     * Switch to a different model with improved error handling and feedback
     */
    async switchModel(modelId) {
        if (this.currentModel === modelId) {
            // Already using this model
            return true;
        }
        
        console.log(`Switching to model: ${modelId}`);

        // Validate existence
        if (!this.modelConfigs[modelId]) {
            console.error(`Model ${modelId} not found in configurations`);
            showNotification(`Model ${modelId} not available`, 'error');
            return false;
        }

        try {
            // Show notification
            showNotification(`Switching to ${modelId}...`, 'info');

            // Track this API call
            this.pendingModelActions[modelId] = 'switch';
            
            // Get session ID
            const sessionId = await this.getSessionId();

            // Switch model using simplified endpoint
            const response = await fetch(`/api/config/models/switch_model/${modelId}${
                sessionId ? `?session_id=${sessionId}` : ''
            }`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            // Remove from pending actions
            delete this.pendingModelActions[modelId];

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to switch model: ${errorText}`);
            }

            // Update dropdown if it exists
            const modelSelect = document.getElementById('model-select');
            if (modelSelect) {
                modelSelect.value = modelId;
            }
            
            // Update model badge
            const modelBadge = document.getElementById('model-badge');
            if (modelBadge) {
                modelBadge.textContent = modelId;
            }

            // Update UI based on model capabilities
            this.updateModelSpecificUI(modelId);
            
            // Update local state
            this.currentModel = modelId;
            
            // Update model list to highlight current model
            this.updateModelsList();
            
            showNotification(`Now using model: ${modelId}`, 'success');
            return true;
        } catch (error) {
            console.error('Error switching model:', error);
            showNotification('Failed to switch model. Please try again.', 'error');
            
            // Remove from pending actions on error
            delete this.pendingModelActions[modelId];
            return false;
        }
    }

    /**
     * Get the current session ID from various sources
     */
    async getSessionId() {
        // Try to get from URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const paramSessionId = urlParams.get('session_id');
        if (paramSessionId) return paramSessionId;
        
        // Try to get from localStorage
        const storageSessionId = localStorage.getItem('current_session_id');
        if (storageSessionId) return storageSessionId;
        
        // Try to get from API
        try {
            const response = await fetch('/api/session');
            if (response.ok) {
                const data = await response.json();
                if (data && data.id) return data.id;
            }
        } catch (error) {
            console.warn('Could not fetch session ID from API:', error);
        }
        
        return null;
    }

    /**
     * Update UI elements based on model capabilities
     */
    updateModelSpecificUI(modelId) {
        const config = this.modelConfigs[modelId];
        if (!config) return;

        // Show/hide reasoning controls for "o" series
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
            const supportsStreaming = config.supports_streaming || false;
            streamingToggle.disabled = !supportsStreaming;
            
            // Update label to indicate if streaming is available
            const streamingLabel = streamingToggle.parentElement.querySelector('label');
            if (streamingLabel) {
                streamingLabel.classList.toggle('text-dark-400', !supportsStreaming);
            }
            
            // Add a note about streaming availability
            const streamingNote = streamingToggle.parentElement.nextElementSibling;
            if (streamingNote) {
                if (!supportsStreaming) {
                    streamingNote.textContent = 'Streaming is not available for this model';
                    streamingToggle.checked = false; // Force off
                } else {
                    streamingNote.textContent = 'See responses as they\'re generated';
                }
            }
        }

        // Update "Model Info" text
        const modelInfo = document.querySelector('.model-info');
        if (modelInfo) {
            modelInfo.innerHTML = `
                <p><strong>Model:</strong> ${modelId} ${config.supports_streaming ? 
                    '<span class="text-success-500 dark:text-success-400">(supports streaming)</span>' : 
                    '<span class="text-dark-500 dark:text-dark-400">(no streaming)</span>'}
                </p>
            `;
        }
        
        // Update temperature control visibility if present
        const temperatureControl = document.getElementById('temperature-control');
        if (temperatureControl) {
            if (config.supports_temperature) {
                temperatureControl.classList.remove('hidden');
            } else {
                temperatureControl.classList.add('hidden');
            }
        }
    }

    /**
     * Initialize UI components for model management
     */
    initModelManagement() {
        // Hook up "Add Model" button
        const addModelBtn = document.getElementById('add-model-btn');
        if (addModelBtn) {
            addModelBtn.addEventListener('click', () => {
                this.showModelForm('add');
            });
        }

        // Hook up "Cancel" and "Close" buttons in form
        const cancelBtn = document.getElementById('model-form-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideModelForm());
        }

        const closeBtn = document.getElementById('model-form-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModelForm());
        }

        // Close form when clicking outside
        const formContainer = document.getElementById('model-form-container');
        if (formContainer) {
            formContainer.addEventListener('click', (e) => {
                if (e.target === formContainer) {
                    this.hideModelForm();
                }
            });
        }

        // Hook up form submission
        const modelForm = document.getElementById('model-form');
        if (modelForm) {
            modelForm.addEventListener('submit', (e) => this.handleModelFormSubmit(e));
        }

        // Initialize model-select dropdown if it exists
        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            // Clear existing options
            modelSelect.innerHTML = '';

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
        }
    }

    /**
     * Get the current model from the server
     */
    async getCurrentModelFromServer() {
        try {
            const response = await fetch('/api/session');
            if (!response.ok) return null;

            const session = await response.json();
            if (session && session.last_model) {
                return session.last_model;
            }
            
            // Select first available model from config
            return Object.keys(this.modelConfigs)[0] || 'DeepSeek-R1';
        } catch (error) {
            console.error('Error getting current model:', error);
            return null;
        }
    }

    /**
     * Ensure local model configurations exist
     */
    ensureLocalModelConfigs() {
        // Always make sure these models exist in the local config
        const requiredModels = {
            "o1hp": {
                name: "o1hp",
                description: "Azure OpenAI o1 high performance model",
                max_tokens: 200000,
                supports_streaming: false,
                supports_temperature: false,
                requires_reasoning_effort: true,
                reasoning_effort: "medium",
                api_version: "2025-01-01-preview",
                azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            },
            "DeepSeek-R1": {
                name: "DeepSeek-R1",
                description: "Model that supports chain-of-thought reasoning with <think> tags",
                max_tokens: 32000,
                supports_streaming: true,  // Explicitly enable streaming for DeepSeek-R1
                supports_temperature: true,
                api_version: "2024-05-01-preview",
                azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
                base_timeout: 120.0,
                max_timeout: 300.0,
                token_factor: 0.05
            }
        };

        // Add missing required models to modelConfigs
        for (const [modelId, config] of Object.entries(requiredModels)) {
            if (!this.modelConfigs[modelId]) {
                console.log(`Adding missing model ${modelId} to local configs`);
                this.modelConfigs[modelId] = config;

                // Try to create the model on the server asynchronously
                if (!this.pendingModelActions[modelId]) {
                    this.createModelOnServer(modelId, config).catch(err => {
                        console.warn(`Failed to create ${modelId} on server: ${err.message}`);
                    });
                }
            }
        }
        
        // Make sure we return any mutated object
        return this.modelConfigs;
    }
    
    /**
     * Create model on server with error handling
     */
    async createModelOnServer(modelId, modelConfig) {
        // Don't try to recreate models that are being processed
        if (this.pendingModelActions[modelId]) {
            return { status: "pending" };
        }
        
        try {
            // Track this API call
            this.pendingModelActions[modelId] = 'create';
            
            // Ensure all required fields are present
            const completeConfig = {
                ...modelConfig,
                // Add missing required fields with defaults if not present
                base_timeout: modelConfig.base_timeout || 120.0,
                max_timeout: modelConfig.max_timeout || 300.0,
                token_factor: modelConfig.token_factor || 0.05,
                // Ensure these are present
                name: modelConfig.name || modelId,
                max_tokens: modelConfig.max_tokens || (modelId.toLowerCase() === "deepseek-r1" ? 32000 : 40000),
                supports_streaming: modelConfig.supports_streaming !== undefined ? modelConfig.supports_streaming : 
                                   (modelId.toLowerCase() === "deepseek-r1"),
                supports_temperature: modelConfig.supports_temperature !== undefined ? modelConfig.supports_temperature : 
                                     (modelId.toLowerCase() === "deepseek-r1")
            };
            
            // Use relative URL to ensure we're connecting to the current server
            const response = await fetch(`/api/config/models/${modelId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(completeConfig),
                // Ensure we're not using cached responses
                cache: 'no-cache'
            });
            
            // Remove from pending actions
            delete this.pendingModelActions[modelId];
            
            if (response.ok) {
                return await response.json();
            } else {
                console.warn(`Server returned ${response.status} when creating model ${modelId}`);
                return { status: "error", code: response.status };
            }
        } catch (error) {
            console.warn(`Network error creating model ${modelId}: ${error.message}`);
            
            // Remove from pending actions on error
            delete this.pendingModelActions[modelId];
            
            return { status: "error", message: error.message };
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
        showNotification('There was an error loading model configurations. Default models will be used.', 'warning');
    });
});
