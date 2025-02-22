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
            // Get available models from server
            const response = await fetch('/api/config/models');
            if (response.ok) {
                const serverModels = await response.json();
                // Merge server configurations with local defaults
                this.modelConfigs = {
                    ...this.modelConfigs,
                    ...serverModels
                };
            }
        } catch (error) {
            console.error('Error fetching model configurations:', error);
        }

        // Create model selector UI
        this.createModelSelector();
        
        // Initialize stats display using dynamic import
        import('./ui/statsDisplay.js').then(({ default: StatsDisplay }) => {
            this.statsDisplay = new StatsDisplay('stats-container');
        }).catch(error => {
            console.error('Error loading stats display:', error);
        });
    }
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
            // Get available models from server
            const response = await fetch('/api/config/models');
            if (response.ok) {
                const serverModels = await response.json();
                // Merge server configurations with local defaults
                this.modelConfigs = {
                    ...this.modelConfigs,
                    ...serverModels
                };
            }
        } catch (error) {
            console.error('Error fetching model configurations:', error);
        }

        // Create model selector UI
        this.createModelSelector();
        
        // Initialize stats display using dynamic import
        import('./ui/statsDisplay.js').then(({ default: StatsDisplay }) => {
            this.statsDisplay = new StatsDisplay('stats-container');
        }).catch(error => {
            console.error('Error loading stats display:', error);
        });
    }

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
            // Get available models from server
            const response = await fetch('/api/config/models');
            if (response.ok) {
                const serverModels = await response.json();
                // Merge server configurations with local defaults
                this.modelConfigs = {
                    ...this.modelConfigs,
                    ...serverModels
                };
            }
        } catch (error) {
            console.error('Error fetching model configurations:', error);
        }

        // Create model selector UI
        this.createModelSelector();
        
        // Initialize stats display after importing
        import('./ui/statsDisplay.js').then(({ default: StatsDisplay }) => {
            this.statsDisplay = new StatsDisplay('stats-container');
        });
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
            // Get available models from server
            const response = await fetch('/api/config/models');
            if (response.ok) {
                const serverModels = await response.json();
                // Merge server configurations with local defaults
                this.modelConfigs = {
                    ...this.modelConfigs,
                    ...serverModels
                };
            }
        } catch (error) {
            console.error('Error fetching model configurations:', error);
        }

        // Create model selector UI
        this.createModelSelector();
        
        // Initialize stats display
        import StatsDisplay from './ui/statsDisplay.js';
        this.statsDisplay = new StatsDisplay('stats-container');
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
        if (modelConfig.isReasoningModel) {
            document.getElementById('reasoning-controls')?.style.display = 'block';
        } else {
            document.getElementById('reasoning-controls')?.style.display = 'none';
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
