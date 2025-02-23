Below is a reference-style note describing how to authenticate and call Azure OpenAI **o1-series** (including *o1* and *o1-preview*) models. It also illustrates how to enable or disable Azure AI Search integration (sometimes referred to as “chat extensions”). These notes combine key points from Azure OpenAI documentation specifically for o1-series models.

---

## 1. **Authentication**

### 1.1. Key-based Authentication

All Azure OpenAI endpoints can be accessed using an API key:

1. In the [Azure Portal](https://portal.azure.com/), navigate to your Azure OpenAI resource.
2. Under *Keys and Endpoint*, copy the `api-key`.
3. Include this key as the `api-key` header in each request.

#### REST Example

```bash
curl https://<your-resource-name>.openai.azure.com/openai/deployments/<your-o1-deployment>/chat/completions?api-version=2024-12-01-preview \
  -H "Content-Type: application/json" \
  -H "api-key: <YOUR_API_KEY>" \
  -d '{
    "messages": [{"role": "user", "content": "Your prompt"}],
    "max_completion_tokens": 1000
  }'
```

### 1.2. Microsoft Entra ID (Azure AD) Authentication

You can also use [Microsoft Entra ID](https://azure.microsoft.com/products/active-directory/) tokens for secure access:

1. Set up a managed identity or service principal with permissions to call the Azure OpenAI resource.
2. Obtain an access token (scoped to `https://cognitiveservices.azure.com/.default`).
3. Send the `Authorization: Bearer <token>` header along with each request.

#### Python Example

```python
import os
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

# Acquire a token provider
azure_credential = DefaultAzureCredential()
token_provider = get_bearer_token_provider(
  azure_credential, "https://cognitiveservices.azure.com/.default"
)

# Initialize AzureOpenAI with AD-based auth
client = AzureOpenAI(
  azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),  # e.g. "https://<resource-name>.openai.azure.com/"
  azure_ad_token_provider=token_provider,
  api_version="2024-12-01-preview"  # Use the correct preview version for o1
)
```

---

## 2. **No Azure AI Search Integration**
This scenario uses only the raw chat completion API with an o1-series model (e.g., *o1*, *o1-preview*, *o1-mini*, etc.), focusing on the unique requirements:
  - **No system role** (instead use `developer` role if needed).
  - **No streaming** (o1-series models do not support streaming).
  - **Use `max_completion_tokens`** instead of `max_tokens`.
  - **Set `temperature` to 1 if it’s `o1-preview`** (or whatever the model docs require).

### 2.1. REST Example (Key-based Auth)

```bash
curl https://<your-resource-name>.openai.azure.com/openai/deployments/<o1-deployment>/chat/completions?api-version=2024-12-01-preview \
  -H "api-key: <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "developer",
        "content": "Formatting re-enabled. You are a helpful reasoning assistant."
      },
      {
        "role": "user",
        "content": "Explain how to implement a binary search in Python."
      }
    ],
    "max_completion_tokens": 800,
    "temperature": 1
  }'
```

### 2.2. Python Example (Microsoft Entra ID)

```python
from openai import AzureOpenAI

# Assume you've set up the client with AD-based auth:
# client = AzureOpenAI(...)

response = client.chat.completions.create(
    model="<o1-deployment-name>",
    messages=[
        {"role": "developer", "content": "Formatting re-enabled. You are a helpful reasoning assistant."},
        {"role": "user", "content": "Explain how to implement a binary search in Python."},
    ],
    max_completion_tokens=800,
    temperature=1  # Must be 1 for o1-preview
)

print(response.model_dump_json(indent=2))
```

---

## 3. **With Azure AI Search Integration**
o1-series models can index external data for retrieval if your Azure OpenAI resource is configured to support [Chat Extensions / Tools](https://learn.microsoft.com/azure/ai-services/openai/how-to/chats).
- You supply a *data_sources* array or *tools* array referencing `"type": "azure_search"`.
- However, remember that the o1-series models do not support parallel tool calls or streaming.

### 3.1. REST Example (Key-based Auth) with Azure Search

```bash
curl https://<your-resource-name>.openai.azure.com/openai/deployments/<o1-deployment>/chat/completions?api-version=2024-12-01-preview \
  -H "api-key: <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "developer",
        "content": "You are an expert financial analyst. Use the Azure Search extension if relevant."
      },
      {
        "role": "user",
        "content": "Given the documents in the index, how many company shares were outstanding last quarter?"
      }
    ],
    "max_completion_tokens": 1000,
    "data_sources": [
      {
        "type": "azure_search",
        "parameters": {
          "endpoint": "https://<my-search-resource>.search.windows.net",
          "index_name": "financial-index",
          "authentication": {
            "apiKey": "<MY_AZURE_SEARCH_KEY>"
          },
          "top_n_documents": 3
        }
      }
    ]
  }'
```

### 3.2. Python Example with Azure Search Integration

```python
from openai import AzureOpenAI

# Assume you've set up the client with your desired auth method
client = AzureOpenAI(
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"), 
  api_key=os.getenv("AZURE_OPENAI_API_KEY"),
  api_version="2024-12-01-preview"
)

response = client.chat.completions.create(
    model="<o1-deployment>",
    messages=[
        {"role": "developer", "content": "You are an expert financial analyst. Use Azure Search if relevant."},
        {"role": "user", "content": "How many shares were outstanding last quarter according to the documents?"}
    ],
    data_sources=[
      {
        "type": "azure_search",
        "parameters": {
          "endpoint": "https://<my-search-resource>.search.windows.net",
          "index_name": "financial-index",
          "authentication": {
            "apiKey": os.getenv("AZURE_SEARCH_API_KEY")  # or define inline
          },
          "top_n_documents": 3
        }
      }
    ],
    max_completion_tokens=1000,
    temperature=1  # If it's specifically o1-preview
)

print(response["choices"][0])
```

---

## 4. **Important Notes for o1-series**

1. **No System Role Messages**:
   - Use `{"role": "developer", "content": "..."}` for high-level instructions.
   - The model typically ignores `role: "system"` in o1-series.

2. **No Streaming**:
   - These models do not support SSE token streaming. Always call the synchronous (non-streaming) completion endpoint (e.g. `chat.completions.create` in the Python library).

3. **Must Use `max_completion_tokens`**
   - `max_tokens` is not recognized by o1-series. If you specify `max_tokens`, you’ll get an error or unexpected results.
   - Instead, pass `max_completion_tokens`.

4. **`temperature = 1` for o1-preview**
   - The `o1-preview` model requires `temperature=1`.

5. **Developer Messages**
   - If you want to encourage markdown or code blocks, you can prepend the text `"Formatting re-enabled"` to the developer message. This is not guaranteed but often improves the model’s use of markdown.

6. **Comprehensive Error Handling**
   - Because these features are in preview, be sure to implement robust error handling to account for partial or unsupported capabilities. For instance, if you try to do parallel tool calls or streaming, you may receive errors.

---

### Summary

When using **o1-series** (reasoning) models with or without Azure AI Search:

   - **Authenticate** using either key-based or Microsoft Entra ID auth.
   - **Use non-streaming** chat completion calls.
   - **Replace `max_tokens`** with `max_completion_tokens`.
   - **Use `temperature=1`** if it’s specifically an `o1-preview` deployment.
   - **Optionally** attach an `azure_search` data source to augment the model’s results from an external content index.

This ensures you meet the unique constraints of the o1-series models while benefiting from advanced reasoning or search-based retrieval.