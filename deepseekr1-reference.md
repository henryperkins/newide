Here's a more concise version that maintains the key API usage examples:

# DeepSeek-R1 on Azure AI - Chat Completions

## Quick Start

### Python
```python
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"])
)

response = client.complete(
    model="DeepSeek-R1",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "How many languages are in the world?"},
    ],
    temperature=0.7,
    max_tokens=256,
)

print(response.choices[0].message.content)
```

### JavaScript
```javascript
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = new ModelClient(
  process.env.AZURE_INFERENCE_ENDPOINT,
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
        max_tokens: 256
    }
});

console.log(response.body.choices[0].message.content);
```

## Key Parameters

- `temperature` (0-2.0): Controls randomness. Lower = more focused
- `max_tokens`: Limits response length
- `messages`: Array of conversation messages
- `frequency_penalty` (0-2.0): Reduces word repetition
- `presence_penalty` (0-2.0): Reduces topic repetition

## Chain-of-Thought Extraction
```python
# Extract reasoning between <think> tags
import re
match = re.match(r"<think>(.*?)</think>(.*)", content, re.DOTALL)
if match:
    reasoning, answer = match.group(1), match.group(2)
```

## Error Handling
```python
try:
    response = client.complete(...)
except HttpResponseError as ex:
    if ex.status_code == 400:  # Content filter
        print(f"Content Filter Error: {ex.message}")
    elif ex.status_code == 429:  # Rate limit
        print("Rate Limit Exceeded")
```

## API Reference

### Endpoint
```http
POST /chat/completions?api-version=2024-05-01-preview
```

### Required Headers
- `Authorization`: Bearer <api_key>
- `Content-Type`: application/json

### Streaming Support
DeepSeek-R1 supports streaming responses. To use streaming:

```json
{
  "stream": true  // In API requests
}
```

In model configuration:
```json
{
  "supports_streaming": true  // Required for UI/routing logic
}
```

### Response Format
```json
{
    "id": "...",
    "choices": [{
        "message": {
            "role": "assistant",
            "content": "..."
        },
        "finish_reason": "stop"
    }],
    "usage": {
        "prompt_tokens": n,
        "completion_tokens": n,
        "total_tokens": n
    }
}
```

For complete documentation, see [Azure AI Model Inference Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/)
