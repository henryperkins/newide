# Comprehensive Reference Guide for Azure OpenAI o-series Models (o1, o3-mini)

This guide provides everything you need to effectively use Azure OpenAI "o-series" reasoning models, such as `o1`, `o1-mini`, and `o3-mini`. It consolidates best practices, code examples, and response structure details, ensuring you're prepared to integrate these models into your applications using the latest `api-version` (e.g., `2025-02-01-preview`).

---

## 1. Key Features and Best Practices

### 1.1 Model Deployment and Integration
- **Deployment ID:** Each o-series model (e.g., `o1`) must be deployed with a chosen deployment name (e.g., `my-o1-deployment`). When making API calls, reference this deployment name, not the literal `o1` string.  
- **API Versions:** Always specify a supported `api-version` when making requests. Examples:  
  - `2024-12-01-preview`  
  - `2025-02-01-preview`  

### 1.2 Required Parameters
- **`max_completion_tokens`:**  
  This parameter is **required** for all o-series (reasoning) models. It sets the upper bound for both visible output tokens and the internal “reasoning tokens.”  
- **`reasoning_effort`:**  
  - Valid values: `low`, `medium` (default), `high`  
  - Higher values often provide more accurate or thoughtful responses but consume more tokens (including internal reasoning tokens).

### 1.3 Role Usage
- **`developer` Role:** Use the `developer` role (instead of `system`) when providing high-level context and instructions for `o1` and `o3-mini`.  
  - While `system` is still recognized, `developer` is the recommended best practice.  
  - **Do not use both roles** in the same conversation.  
  ```json
  {
    "role": "developer",
    "content": "Formatting re-enabled - You are a helpful assistant."
  }
  ```

### 1.4 Unsupported Parameters
The following parameters are not supported by o-series models, so including them will cause errors:
```
temperature, top_p, presence_penalty, frequency_penalty, logprobs, top_logprobs, logit_bias, max_tokens
```

### 1.5 Markdown Formatting
- By default, `o1` and `o3-mini` are less likely to return Markdown-formatted text.  
- To encourage Markdown output (especially for code blocks), prepend the `developer` role instructions with something like `"Formatting re-enabled"`.  
  ```json
  {
    "role": "developer",
    "content": "Formatting re-enabled - Provide all answers with Markdown code blocks."
  }
  ```

### 1.6 Usage Object Details
- Responses include `usage`, which details token counts. For o-series models, note especially:  
  - **`reasoning_tokens`** within `completion_tokens_details`: the number of tokens used for the model’s internal reasoning.  
  - `prompt_tokens`, `completion_tokens`, and `total_tokens` reflect overall usage impacting billing and context limits.

### 1.7 Context Window Limits
- **Input tokens (prompt context)** and **output tokens (generated response)** have model-specific maxima.  
- `max_completion_tokens` sets an upper bound for visible output plus reasoning tokens. Always plan your prompts to stay within the model’s limits.

---

## 2. Endpoint Construction and Configuration

### 2.1 Endpoint Construction
Your Azure OpenAI endpoint typically looks like this:
```
https://<your-resource-name>.openai.azure.com
```
The full URL for chat completions is:
```
<endpoint>/openai/deployments/<deployment_id>/chat/completions?api-version=<api_version>
```
For example:
```
https://your-resource.openai.azure.com/openai/deployments/my-o1-deployment/chat/completions?api-version=2025-02-01-preview
```

### 2.2 Environment Variables
Store these sensitive values in environment variables (recommended for security):
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_DEPLOYMENT` (your deployment ID)

---

## 3. Python Implementation Guide

Below is a full reference implementation that showcases:
- Environment-based configuration
- Non-streaming and streaming requests
- Token counting with the `tiktoken` library
- Interactive chat usage

### 3.1 Configuration and Setup
```python
import os
import requests
import json
from openai import AzureOpenAI
import tiktoken  # For token counting

# Environment Variables: recommended for security
endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")  # e.g., "https://your-resource.openai.azure.com"
api_key = os.environ.get("AZURE_OPENAI_KEY")
deployment_id = os.environ.get("AZURE_OPENAI_DEPLOYMENT")  # e.g., "my-o1-deployment"
api_version = "2025-02-01-preview"  # Use a supported preview version
```

### 3.2 AzureOpenAI Client Initialization

#### API Key Example
```python
client = AzureOpenAI(
    azure_endpoint=endpoint,
    api_key=api_key,
    api_version=api_version,
)
```

#### Azure AD Authentication Example (Optional)
```python
# from azure.identity import DefaultAzureCredential, get_bearer_token_provider
# token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")
# client = AzureOpenAI(
#     azure_endpoint=endpoint,
#     azure_ad_token_provider=token_provider,
#     api_version=api_version,
# )
```

### 3.3 Non-Streaming Chat Completion

```python
def chat_completion(messages, max_completion_tokens=500, reasoning_effort="medium"):
    """
    Performs a non-streaming chat completion.

    Args:
        messages: A list of message objects (developer/user input).
        max_completion_tokens: Required for o-series models.
        reasoning_effort: "low", "medium" (default), or "high".

    Returns:
        The response object from the API.
    """
    try:
        response = client.chat.completions.create(
            model=deployment_id,
            messages=messages,
            max_completion_tokens=max_completion_tokens,
            reasoning_effort=reasoning_effort,
        )
        return response
    except Exception as e:
        print(f"Error: {e}")
        return None


# Example usage:
messages = [
    {"role": "developer", "content": "Formatting re-enabled - Provide concise answers."},
    {"role": "user", "content": "What's the highest mountain in the world?"}
]

response = chat_completion(messages)
if response:
    print("--- Non-Streaming Response ---")
    print(response.choices[0].message.content)
    print("\n--- Usage ---")
    print(json.dumps(response.usage, indent=2))
```

### 3.4 Streaming Chat Completion

```python
def chat_completion_stream(messages, max_completion_tokens=500, reasoning_effort="medium"):
    """
    Performs a streaming chat completion.

    Args:
        messages: A list of message objects.
        max_completion_tokens: Required for o-series models.
        reasoning_effort: "low", "medium" (default), or "high".

    Returns:
        A generator that yields streamed response chunks.
    """
    try:
        stream = client.chat.completions.create(
            model=deployment_id,
            messages=messages,
            max_completion_tokens=max_completion_tokens,
            reasoning_effort=reasoning_effort,
            stream=True,
        )
        return stream
    except Exception as e:
        print(f"Error: {e}")
        return None


# Example usage (streaming):
messages = [
    {"role": "developer", "content": "Formatting re-enabled - Provide code examples in Markdown."},
    {"role": "user", "content": "Tell me a short story about a cat."}
]

stream = chat_completion_stream(messages)
if stream:
    print("--- Streaming Response ---")
    for chunk in stream:
        if chunk.choices:
            delta = chunk.choices[0].delta
            if delta.content:
                print(delta.content, end="", flush=True)
    print()  # Newline after streaming finishes
```

### 3.5 Token Counting with tiktoken

```python
def count_tokens(messages, model_name="gpt-4"):
    """
    Counts the number of tokens for a list of messages using tiktoken.

    Args:
        messages: List of message objects (developer/user).
        model_name: The model name recognized by tiktoken (e.g., "gpt-4", "gpt-3.5-turbo").

    Returns:
        The total number of tokens.
    """
    try:
        encoding = tiktoken.encoding_for_model(model_name)
    except KeyError:
        print("Warning: Model not recognized, defaulting to cl100k_base.")
        encoding = tiktoken.get_encoding("cl100k_base")

    total_tokens = 0
    for msg in messages:
        total_tokens += 3  # overhead for each message
        total_tokens += len(encoding.encode(msg.get("content", "")))
    # Additional overhead for the reply
    total_tokens += 3
    return total_tokens


# Example usage:
messages = [
    {"role": "developer", "content": "Formatting re-enabled - You are a helpful assistant."},
    {"role": "user", "content": "How many tokens does this consume?"}
]

token_count = count_tokens(messages, model_name="gpt-4")
print(f"Total tokens: {token_count}")
```

### 3.6 Interactive Chat Example

```python
print("--- Interactive Chat --- Type 'exit' to quit.")
messages = [
    {"role": "developer", "content": "Formatting re-enabled - You are a helpful assistant."}
]

while True:
    user_input = input("You: ")
    if user_input.lower() == "exit":
        break

    messages.append({"role": "user", "content": user_input})
    response = chat_completion(messages)
    if response:
        assistant_response = response.choices[0].message.content
        print(f"Assistant: {assistant_response}")
        messages.append({"role": "assistant", "content": assistant_response})
        print(f"Tokens used so far: {response.usage.total_tokens}")
```

---

## 4. Response Structure Details

Below is additional detail on how o-series models (e.g., `o1`) structure their responses, whether non-streaming or streaming.

### 4.1 Non-Streaming Response
When `stream=False` (the default), you get a single JSON object containing the entire completion, plus metadata:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1678882457,
  "model": "your-o1-deployment",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris.",
        "refusal": null,
        "function_call": null,
        "tool_calls": null
      },
      "finish_reason": "stop",
      "content_filter_results": {
        "...": "..."
      },
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 1843,
    "total_tokens": 1863,
    "prompt_tokens_details": {
      "audio_tokens": null,
      "cached_tokens": 0
    },
    "completion_tokens_details": {
      "accepted_prediction_tokens": null,
      "audio_tokens": null,
      "reasoning_tokens": 448,
      "rejected_prediction_tokens": null
    }
  },
  "prompt_filter_results": [
    {
      "prompt_index": 0,
      "content_filter_results": {
        "...": "..."
      }
    }
  ],
  "system_fingerprint": "fp_..."
}
```

#### Non-Streaming Highlights
- **`choices[0].message.content`:** The returned text from the assistant.  
- **`reasoning_tokens`:** Within `completion_tokens_details`, indicating how many tokens were spent on reasoning.  
- **Unsupported fields:** `logprobs`, `temperature`, etc., are `null` or absent.

### 4.2 Streaming Response
When you set `stream=True`, the API returns a series of server-sent events (SSE). Each event represents a “chunk” of the completion. You’ll need to read these events incrementally and piece them together:

Example SSE sequence (simplified):
```
data: {"id": "chatcmpl-...", "object": "chat.completion.chunk", "model": "...",
 "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": null}]}

data: {"id": "chatcmpl-...", "object": "chat.completion.chunk", "model": "...",
 "choices": [{"index": 0, "delta": {"content": "The"}, "finish_reason": null}]}

data: {"id": "chatcmpl-...", "object": "chat.completion.chunk", "model": "...",
 "choices": [{"index": 0, "delta": {"content": " capital"}, "finish_reason": null}]}

...

data: {"id": "chatcmpl-...", "object": "chat.completion.chunk", "model": "...",
 "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}

data: [DONE]  <- signifies end of stream
```

#### Streaming Highlights
- **`delta`:** Contains partial response data.  
  - First chunk usually sets `"role": "assistant"`.  
  - Subsequent chunks supply incremental `"content"`.  
- **Concatenate `delta.content`:** to build the final response string.  
- **Usage info** typically appears in a final chunk before `[DONE]` with the detailed token usage, including `reasoning_tokens`.

---

## 5. Summary and Next Steps

By combining the required parameters (`max_completion_tokens`, `reasoning_effort`), using the `developer` role, and monitoring `reasoning_tokens` in the `usage` details, you can take full advantage of Azure OpenAI’s o-series models for advanced reasoning tasks. Control your prompts, watch your token usage, and use the streaming or non-streaming API calls as needed.

For more in-depth discussions or troubleshooting, consult the official Azure OpenAI documentation or your Azure portal logs to review model deployments, token usage, and operational status. If you have any further questions, feel free to ask!