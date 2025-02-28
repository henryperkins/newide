// update_deepseek.js - Script to update DeepSeek-R1 configuration

document.addEventListener('DOMContentLoaded', () => {
  // Wait for the model manager to be initialized
  window.addEventListener('modelInitialized', (event) => {
    console.log('Model manager initialized, updating DeepSeek-R1 configuration...');
    
    // Get the model select element
    const modelSelect = document.getElementById('model-select');
    if (!modelSelect) {
      console.error('Model select element not found');
      return;
    }
    
    // Check if DeepSeek-R1 is already in the list
    let hasDeepSeek = false;
    for (let i = 0; i < modelSelect.options.length; i++) {
      if (modelSelect.options[i].value === 'DeepSeek-R1') {
        hasDeepSeek = true;
        break;
      }
    }
    
    if (!hasDeepSeek) {
      // Add DeepSeek-R1 to the model select dropdown
      const option = document.createElement('option');
      option.value = 'DeepSeek-R1';
      option.textContent = 'DeepSeek-R1 (Model with chain-of-thought reasoning)';
      modelSelect.appendChild(option);
    }
    
    // Access the modelManager from the event or window
    const modelManager = window.modelManager || (event.detail && event.detail.modelManager);
    
    if (!modelManager) {
      console.error('Model manager not found');
      return;
    }
    
    // Update DeepSeek-R1 configuration
    const deepSeekConfig = {
      name: "DeepSeek-R1",
      description: "Model that supports chain-of-thought reasoning with <think> tags",
      azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
      api_version: "2024-05-01-preview",
      max_tokens: 32000,
      max_completion_tokens: 4096,
      supports_temperature: true,
      supports_streaming: true,
      supports_vision: false,
      requires_reasoning_effort: false,
      base_timeout: 120.0,
      max_timeout: 300.0,
      token_factor: 0.05
    };
    
    // Add or update the DeepSeek-R1 model configuration
    if (typeof modelManager.addOrUpdateModel === 'function') {
      modelManager.addOrUpdateModel('DeepSeek-R1', deepSeekConfig)
        .then(() => {
          console.log('DeepSeek-R1 model configuration updated successfully');
        })
        .catch((error) => {
          console.error('Failed to update DeepSeek-R1 configuration:', error);
        });
    } else if (typeof modelManager.handleModelFormSubmit === 'function') {
      // Alternative approach if addOrUpdateModel is not available
      // Simulate form submission
      document.getElementById('model-form-mode').value = 'edit';
      document.getElementById('model-form-id').value = 'DeepSeek-R1';
      document.getElementById('model-name').value = 'DeepSeek-R1';
      document.getElementById('model-name').disabled = true;
      document.getElementById('model-description').value = deepSeekConfig.description;
      document.getElementById('model-endpoint').value = deepSeekConfig.azure_endpoint;
      document.getElementById('model-api-version').value = deepSeekConfig.api_version;
      document.getElementById('model-max-tokens').value = deepSeekConfig.max_tokens;
      document.getElementById('model-supports-temperature').checked = deepSeekConfig.supports_temperature;
      document.getElementById('model-supports-streaming').checked = deepSeekConfig.supports_streaming;
      document.getElementById('model-supports-vision').checked = deepSeekConfig.supports_vision;
      
      // Submit the form
      const event = new Event('submit');
      document.getElementById('model-form').dispatchEvent(event);
      console.log('DeepSeek-R1 model configuration updated via form submission');
    } else {
      console.error('No method available to update model configuration');
    }
  });
  
  // Also listen for config loaded event as an alternative trigger
  window.addEventListener('configLoaded', (event) => {
    console.log('Config loaded, checking DeepSeek-R1 configuration...');
    const config = event.detail && event.detail.config;
    
    if (config && config.selectedModel !== 'DeepSeek-R1') {
      // If DeepSeek-R1 is not the selected model, we'll just make sure it's in the list
      const modelSelect = document.getElementById('model-select');
      if (modelSelect) {
        let hasDeepSeek = false;
        for (let i = 0; i < modelSelect.options.length; i++) {
          if (modelSelect.options[i].value === 'DeepSeek-R1') {
            hasDeepSeek = true;
            break;
          }
        }
        
        if (!hasDeepSeek) {
          const option = document.createElement('option');
          option.value = 'DeepSeek-R1';
          option.textContent = 'DeepSeek-R1 (Model with chain-of-thought reasoning)';
          modelSelect.appendChild(option);
          console.log('Added DeepSeek-R1 to model select dropdown');
        }
      }
    }
  });
});

// Add a function to manually trigger the DeepSeek-R1 configuration update
window.updateDeepSeekConfig = function() {
  console.log('Manually triggering DeepSeek-R1 configuration update...');
  
  // Create and dispatch a custom event to trigger the update
  const event = new CustomEvent('modelInitialized', {
    detail: {
      modelManager: window.modelManager,
      currentModel: 'DeepSeek-R1',
      models: Object.keys(window.modelManager.modelConfigs || {})
    }
  });
  
  window.dispatchEvent(event);
  return 'DeepSeek-R1 configuration update triggered';
};