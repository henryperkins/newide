# Model Configuration Refactoring Plan

I'll implement a comprehensive solution that refactors the model configuration system while meeting all requirements. This includes creating a web UI for model management within the existing chat interface and ensuring all configuration is stored in PostgreSQL.

## 1. Backend Changes

### A. Enhanced ConfigService (services/config_service.py)

```python
# Add to services/config_service.py

async def get_model_configs(self) -> Dict[str, Any]:
    """Get all model configurations"""
    return await self.get_config("model_configs") or {}

async def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
    """Get configuration for a specific model"""
    models = await self.get_model_configs()
    return models.get(model_id)

async def add_model_config(self, model_id: str, config: Dict[str, Any]) -> bool:
    """Add a new model configuration"""
    models = await self.get_model_configs()
    if model_id in models:
        return False
    models[model_id] = config
    return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

async def update_model_config(self, model_id: str, config: Dict[str, Any]) -> bool:
    """Update an existing model configuration"""
    models = await self.get_model_configs()
    if model_id not in models:
        return False
    models[model_id] = config
    return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

async def delete_model_config(self, model_id: str) -> bool:
    """Delete a model configuration"""
    models = await self.get_model_configs()
    if model_id not in models:
        return False
    del models[model_id]
    return await self.set_config("model_configs", models, "Model configurations", is_secret=True)
```

### B. New API Endpoints (routers/config.py)

```python
# Add to routers/config.py

from pydantic import BaseModel
from typing import Dict, Any, List

class ModelConfigModel(BaseModel):
    name: str
    max_tokens: int
    supports_streaming: bool
    supports_temperature: bool
    api_version: str
    azure_endpoint: str
    description: str = ""
    base_timeout: float = 120.0
    max_timeout: float = 300.0
    token_factor: float = 0.05

@router.get("/models", response_model=Dict[str, ModelConfigModel])
async def get_models(config_service=Depends(get_config_service)):
    """Get all model configurations"""
    models = await config_service.get_model_configs()
    return models

@router.get("/models/{model_id}", response_model=ModelConfigModel)
async def get_model(model_id: str, config_service=Depends(get_config_service)):
    """Get a specific model configuration"""
    model = await config_service.get_model_config(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model

@router.post("/models/{model_id}")
async def create_model(
    model_id: str,
    model: ModelConfigModel,
    config_service=Depends(get_config_service)
):
    """Create a new model configuration"""
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

@router.put("/models/{model_id}")
async def update_model(
    model_id: str,
    model: ModelConfigModel,
    config_service=Depends(get_config_service)
):
    """Update an existing model configuration"""
    existing = await config_service.get_model_config(model_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Model not found")
    
    success = await config_service.update_model_config(model_id, model.dict())
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update model")
    
    # Refresh client pool
    from clients import get_client_pool
    pool = await get_client_pool()
    await pool.refresh_client(model_id, config_service)
    
    return {"status": "updated", "model_id": model_id}

@router.delete("/models/{model_id}")
async def delete_model(
    model_id: str,
    config_service=Depends(get_config_service)
):
    """Delete a model configuration"""
    existing = await config_service.get_model_config(model_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Model not found")
    
    # Prevent deleting the default model
    if model_id == config.AZURE_OPENAI_DEPLOYMENT_NAME:
        raise HTTPException(status_code=400, detail="Cannot delete default model")
    
    success = await config_service.delete_model_config(model_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete model")
    
    return {"status": "deleted", "model_id": model_id}
```

### C. Updated ClientPool (clients.py)

```python
# Changes to clients.py

# Update initialize_clients method to properly handle empty configs
async def initialize_clients(self, config_service: ConfigService) -> None:
    """
    Initialize clients based on database configurations
    """
    db_model_configs = await config_service.get_model_configs()
    
    # If no configurations found, create default
    if not db_model_configs:
        default_model = config.AZURE_OPENAI_DEPLOYMENT_NAME
        logger.warning(f"No model configs found. Creating default for {default_model}")
        
        default_config = {
            "name": default_model,
            "max_tokens": 40000,
            "supports_streaming": False,
            "supports_temperature": False,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05,
            "api_version": config.AZURE_OPENAI_API_VERSION,
            "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
            "description": "Default Azure OpenAI model"
        }
        
        await config_service.add_model_config(default_model, default_config)
        db_model_configs = {default_model: default_config}
    
    # Initialize clients from configs
    for model_name, model_config in db_model_configs.items():
        try:
            # Create client with configuration from database
            self._clients[model_name] = self._create_client(model_name, model_config)
            logger.info(f"Initialized client for model: {model_name}")
        except Exception as e:
            logger.error(f"Failed to initialize client for {model_name}: {str(e)}")

# Add helper method for client creation
def _create_client(self, model_name: str, model_config: Dict[str, Any]) -> AzureOpenAI:
    """Create an Azure OpenAI client with the given configuration"""
    is_o_series = model_name.startswith("o") or not model_config.get("supports_temperature", True)
    max_retries = config.O_SERIES_MAX_RETRIES if is_o_series else 3
    
    return AzureOpenAI(
        api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
        api_version=model_config.get("api_version", config.AZURE_OPENAI_API_VERSION),
        azure_endpoint=model_config.get("azure_endpoint", config.AZURE_OPENAI_ENDPOINT),
        azure_deployment=model_name,
        max_retries=max_retries,
        timeout=model_config.get("base_timeout", 60.0)
    )

# Enhance refresh_client to properly handle model updates
async def refresh_client(self, model_name: str, config_service: ConfigService) -> None:
    """Refresh a specific client with latest configuration"""
    async with self._lock:
        try:
            model_config = await config_service.get_model_config(model_name)
            if not model_config:
                logger.warning(f"No configuration found for {model_name}")
                return
                
            # Update or create client
            self._clients[model_name] = self._create_client(model_name, model_config)
            logger.info(f"Refreshed client for model: {model_name}")
        except Exception as e:
            logger.error(f"Failed to refresh client for {model_name}: {str(e)}")
```

## 2. Frontend Changes

### A. Add Model Management UI to index.html

```html
<!-- Add to sidebar in static/index.html, after the existing tabs -->
<button 
    class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    id="models-tab"
    data-target-tab="models-content"
    role="tab"
    aria-selected="false"
    aria-controls="models-content">
    Models
</button>

<!-- Add model management panel after other content panels -->
<div id="models-content" class="h-full overflow-y-auto p-4 hidden" role="tabpanel" aria-hidden="true">
    <div class="space-y-6">
        <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">Model Management</h2>
            <button id="add-model-btn" class="btn-primary text-sm px-3 py-1">
                Add Model
            </button>
        </div>
        
        <div id="models-list" class="space-y-2">
            <!-- Model cards will be populated here -->
            <div class="text-gray-500 dark:text-gray-400 text-sm">Loading models...</div>
        </div>
        
        <!-- Add/Edit Model Form (initially hidden) -->
        <div id="model-form-container" class="hidden border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-gray-50 dark:bg-gray-800">
            <h3 class="text-md font-medium mb-3" id="model-form-title">Add New Model</h3>
            <form id="model-form" class="space-y-3">
                <input type="hidden" id="model-form-mode" value="add">
                <input type="hidden" id="model-form-id" value="">
                
                <div>
                    <label for="model-name" class="block text-sm font-medium">Model ID/Name</label>
                    <input type="text" id="model-name" class="form-input mt-1" required>
                    <p class="text-xs text-gray-500 mt-1">Used for deployment name (e.g., "gpt-4" or "o1hp")</p>
                </div>
                
                <div>
                    <label for="model-description" class="block text-sm font-medium">Description</label>
                    <input type="text" id="model-description" class="form-input mt-1">
                </div>
                
                <div>
                    <label for="model-endpoint" class="block text-sm font-medium">Azure Endpoint</label>
                    <input type="url" id="model-endpoint" class="form-input mt-1" required>
                </div>
                
                <div>
                    <label for="model-api-version" class="block text-sm font-medium">API Version</label>
                    <input type="text" id="model-api-version" class="form-input mt-1" value="2025-01-01-preview" required>
                </div>
                
                <div>
                    <label for="model-max-tokens" class="block text-sm font-medium">Max Tokens</label>
                    <input type="number" id="model-max-tokens" class="form-input mt-1" min="1024" max="128000" value="4096" required>
                </div>
                
                <div class="flex space-x-4">
                    <div class="flex items-center">
                        <input type="checkbox" id="model-supports-temperature" class="form-checkbox">
                        <label for="model-supports-temperature" class="ml-2 text-sm">Supports Temperature</label>
                    </div>
                    <div class="flex items-center">
                        <input type="checkbox" id="model-supports-streaming" class="form-checkbox">
                        <label for="model-supports-streaming" class="ml-2 text-sm">Supports Streaming</label>
                    </div>
                </div>
                
                <div class="pt-2 flex justify-end space-x-2">
                    <button type="button" id="model-form-cancel" class="btn-secondary text-sm px-3 py-1">Cancel</button>
                    <button type="submit" class="btn-primary text-sm px-3 py-1">Save</button>
                </div>
            </form>
        </div>
    </div>
</div>
```

### B. Add Model Management JavaScript (static/js/models.js)

```javascript
// Enhance existing ModelManager in static/js/models.js

// Add methods to ModelManager class
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
    
    // Set up refresh button
    const refreshBtn = document.getElementById('refresh-models-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => this.refreshModelsList());
    }
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
        
        const models = await response.json();
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
```

### C. Update Tab Manager (static/js/ui/tabManager.js)

```javascript
// No code changes needed - the tab system already dynamically handles tabs
// The HTML changes will automatically register the new Models tab
```

### D. Modify Config Handler (static/js/config.js)

```javascript
// Add to static/js/config.js

// Add method to get all model configurations
export async function getModelConfigurations() {
  try {
    const response = await fetch('/api/config/models');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching model configurations:', error);
    return {};
  }
}

// Add method to get a specific model configuration
export async function getModelConfiguration(modelId) {
  try {
    const response = await fetch(`/api/config/models/${modelId}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching configuration for model ${modelId}:`, error);
    return null;
  }
}
```

## 3. Implementation Plan

1. **Database Schema**: Already has appropriate tables for configuration storage.
2. **Backend Implementation**:
   - Enhance ConfigService with model-specific methods
   - Add API endpoints for model CRUD operations
   - Update ClientPool with proper database-driven initialization
3. **Frontend Implementation**:
   - Add Models tab to the existing sidebar
   - Implement model list and form UI
   - Add JavaScript for model management
4. **Testing**:
   - Verify database storage of model configurations
   - Test model CRUD operations via UI
   - Ensure client pool refreshes when models change

This implementation doesn't introduce any new modules while providing a complete model management solution. All model configurations will be stored in the PostgreSQL database and accessible through a web UI within the existing chat interface.