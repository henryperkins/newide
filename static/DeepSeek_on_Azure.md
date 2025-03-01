# DeepSeek-R1 on Azure AI

This document explains how to use DeepSeek-R1 with Azure AI Services, highlighting the special features of the model and its integration with Azure's API infrastructure.

## Overview

DeepSeek-R1 is a powerful large language model with specialized chain-of-thought reasoning capabilities through `<think>` tags. When deployed on Azure, you can access it through the Azure AI Inference API, which shares many similarities with the Azure OpenAI API, but with some DeepSeek-specific features.

## Key Features

- **Chain-of-Thought Reasoning**: Get access to the model's reasoning process with `<think>` tags
- **Streaming Support**: Stream responses for improved user experience
- **Azure Integration**: Works with Azure AI Inference API
- **Compatibility**: Similar API structure to Azure OpenAI models

## Quick Start

### Python

```python
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint="https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"])
)

response = client.complete(
    model="DeepSeek-R1",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "How many languages are in the world?"},
    ],
    temperature=0.7,
    max_tokens=4096,
)

print(response.choices[0].message.content)
```

### JavaScript

```javascript
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = new ModelClient(
  "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
  new AzureKeyCredential(process.env.AZURE_INFERENCE_CREDENTIAL)
);

const response = await client.path("/chat/completions").post({
    body: {
        model: "DeepSeek-R1",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "How many languages are in the world?" }
        ],
        temperature: 0.7,
        max_tokens: 4096
    }
});

console.log(response.body.choices[0].message.content);
```

## REST API Endpoint

```http
POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2024-05-01-preview
```

### Required Headers

- `api-key`: Your Azure DeepSeek R1 API key
- `Content-Type`: application/json

### Request Body

```json
{
  "model": "DeepSeek-R1",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "How many languages are in the world?"}
  ],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true
}
```

## Configuration

DeepSeek-R1 is configured with the following default settings in this environment:

```json
{
  "name": "DeepSeek-R1",
  "max_tokens": 32000,
  "api_version": "2024-05-01-preview",
  "description": "Model that supports chain-of-thought reasoning with <think> tags",
  "max_timeout": 300.0,
  "base_timeout": 120.0,
  "token_factor": 0.05,
  "azure_endpoint": "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
  "supports_streaming": true,
  "supports_temperature": true
}
```

## Understanding `<think>` Tags

DeepSeek-R1's unique feature is its ability to expose its reasoning process using `<think>` tags. This allows you to see the model's step-by-step thought process before reaching a conclusion.

### Structure

When the model processes a request that requires reasoning, it may include its thought process within `<think>` tags:

```
<think>
Let me reason through this step by step...
1. First, I'll consider...
2. Then, I need to analyze...
3. Based on this, I can conclude...
</think>

Here's my final answer based on the reasoning above...
```

### Extracting Reasoning

To extract and use the thinking process:

```javascript
// JavaScript extraction example
function extractThinking(content) {
  const match = content.match(/<think>([\s\S]*?)<\/think>/);
  if (match) {
    const thinking = match[1].trim();
    const answer = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return { thinking, answer };
  }
  return { thinking: '', answer: content };
}

// Python extraction example
import re
def extract_thinking(content):
    match = re.search(r'<think>(.*?)</think>', content, re.DOTALL)
    if match:
        thinking = match.group(1).strip()
        answer = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
        return {"thinking": thinking, "answer": answer}
    return {"thinking": "", "answer": content}
```

## Streaming with `<think>` Tags

When streaming responses with DeepSeek-R1, you need to handle the continuous processing of `<think>` tags:

```javascript
let mainBuffer = '';
let thinkingBuffer = '';
let isThinking = false;

// Process each incoming chunk
function processStreamChunk(chunk) {
  // Check for opening thinking tag
  const openTagIndex = chunk.indexOf('<think>');
  if (openTagIndex >= 0) {
    isThinking = true;
    // Add content before the tag to main buffer
    if (openTagIndex > 0) {
      mainBuffer += chunk.substring(0, openTagIndex);
    }
    // Start collecting thinking content
    thinkingBuffer += chunk.substring(openTagIndex + 7); // 7 is length of <think>
    return;
  }
  
  // Check for closing thinking tag
  if (isThinking) {
    const closeTagIndex = chunk.indexOf('</think>');
    if (closeTagIndex >= 0) {
      // Finish collecting thinking content
      thinkingBuffer += chunk.substring(0, closeTagIndex);
      isThinking = false;
      
      // Process content after the closing tag
      mainBuffer += chunk.substring(closeTagIndex + 8); // 8 is length of </think>
      
      // Do something with the complete thinking content
      displayThinkingContent(thinkingBuffer);
      thinkingBuffer = '';
    } else {
      // Still collecting thinking content
      thinkingBuffer += chunk;
    }
  } else {
    // Regular content
    mainBuffer += chunk;
  }
}
```

## Key Parameters

DeepSeek-R1 supports the following parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| temperature | number | 0.7 | Controls randomness (0-2) |
| max_tokens | integer | 32000 | Maximum tokens in completion |
| stream | boolean | false | Enable streaming response |
| stop | string/array | null | Sequences to stop generation |
| presence_penalty | number | 0 | Penalty for new topics (-2 to 2) |
| frequency_penalty | number | 0 | Penalty for repetition (-2 to 2) |
| top_p | number | 1 | Nucleus sampling parameter |

## Handling Errors

Common errors when working with DeepSeek-R1:

### DeploymentNotFound (404)

```
Error code: 404 - {'error': {'code': 'DeploymentNotFound', 'message': 'The API deployment for this resource does not exist.'}}
```

**Solution:**
- Verify the deployment ID is correct
- Check if the deployment is fully provisioned (can take 5-10 minutes)
- Ensure your access credentials are valid for this deployment

### Rate Limit (429)

```
{'error': {'code': 'RateLimitExceeded', 'message': 'Rate limit exceeded...'}}
```

**Solution:**
- Implement retry logic with exponential backoff
- Reduce request frequency
- Consider increasing quota limits

### Timeout Issues

```
ConnectionError: Connection failed
```

**Solution:**
- Increase timeout settings for complex requests
- Reduce prompt size or max_tokens
- Implement client-side timeout handling:

```javascript
// JavaScript timeout example
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Request timeout')), 60000);
});

Promise.race([apiRequest(), timeoutPromise])
  .then(response => handleResponse(response))
  .catch(error => handleError(error));
```

## Frontend Integration

When integrating DeepSeek-R1 with your frontend, you can utilize the thinking process visualization:

```javascript
// Create styled thinking blocks in UI
function createThinkingBlockHTML(thinkingContent) {
  return `
    <div class="thinking-process shadow-sm my-4">
      <div class="thinking-header">
        <button class="thinking-toggle" aria-expanded="true">
          <span class="font-medium">Thinking Process</span>
          <span class="toggle-icon">▼</span>
        </button>
      </div>
      <div class="thinking-content">
        <pre class="thinking-pre">${thinkingContent}</pre>
      </div>
    </div>
  `;
}
```

## Best Practices

1. **Explicit Reasoning Instructions**
   - To get the most value from `<think>` tags, explicitly instruct the model to show its reasoning
   - Example: "Think step by step and show your work inside <think> tags"

2. **Graceful Fallbacks**
   - Always handle cases where thinking tags might be absent
   - Implement fallback logic to other models if DeepSeek-R1 is unavailable

3. **Optimizing Timeouts**
   - DeepSeek-R1 may take longer for complex reasoning
   - Configure timeouts based on expected reasoning complexity:
     ```
     timeout = base_timeout + (token_factor * expected_token_count)
     ```

4. **Stream Processing**
   - Always process streamed responses incrementally
   - Maintain separate buffers for thinking and final content
   - Update UI as soon as meaningful chunks arrive

5. **Error Recovery**
   - Implement retry logic with exponential backoff
   - Cache interim results when processing long responses
   - Provide transparent error feedback to users

## Troubleshooting

If you encounter deployment issues with DeepSeek-R1:

1. Verify the correct endpoint and credential are being used:
   ```
   AZURE_INFERENCE_ENDPOINT=https://DeepSeek-R1D2.eastus2.models.ai.azure.com
   AZURE_INFERENCE_CREDENTIAL=[your-credential-key]
   ```

2. Check if the deployment is complete (can take 5-10 minutes after creation)

3. Ensure API version is correct: `2024-05-01-preview` 

4. Test with a minimal request to isolate the issue:
   ```bash
   curl -X POST \
     "https://DeepSeek-R1D2.eastus2.models.ai.azure.com/openai/deployments/DeepSeek-R1/chat/completions?api-version=2024-05-01-preview" \
     -H "Content-Type: application/json" \
     -H "api-key: $AZURE_INFERENCE_CREDENTIAL" \
     -d '{"messages":[{"role":"user","content":"Hello"}],"model":"DeepSeek-R1"}'
   ```

## Resources

- [Azure AI Model Inference Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/)
- [Azure OpenAI Services](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [DeepSeek R1 Model Information](https://azure.microsoft.com/en-us/products/ai-studio/models/deepseek-r1/)
