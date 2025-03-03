# Guide to Implementing DeepSeek-R1 Reasoning Model with Azure AI Foundry

This guide will walk you through implementing and integrating the DeepSeek-R1 reasoning model using Azure AI Foundry. DeepSeek-R1 is a powerful model known for its exceptional reasoning capabilities in domains like math, coding, science, strategy, and logistics.

## Understanding DeepSeek-R1 and Reasoning Models

Reasoning models like DeepSeek-R1 represent a significant advancement in AI. Unlike traditional models that primarily focus on pattern recognition, reasoning models employ a "chain of thought" process. This means they:

*   **Explore Multiple Paths:**  DeepSeek-R1 explicitly explores various potential solutions and approaches before arriving at an answer.
*   **Self-Verification:** The model verifies its reasoning steps as it generates the output, enhancing accuracy and reliability.
*   **Context Efficiency:**  Due to their robust reasoning capabilities, these models can often achieve effective results with less prompting context compared to other models.

This advanced approach is achieved through increased *inference compute time*, trading latency and cost for enhanced performance, as opposed to scaling through *training compute time*.

DeepSeek-R1 outputs two components:

*   **Reasoning Completions:**  The detailed step-by-step thought process the model undertakes to arrive at the answer.
*   **Output Completions:** The final answer or conclusion derived from the reasoning process.

Both reasoning and output completions contribute to token usage and associated costs. Models like DeepSeek-R1 may output both, while others may only provide the final output.

## Prerequisites

Before you begin, ensure you have the following:

1.  **Azure Subscription:** If you don't have one, you can [create an Azure subscription](https://azure.microsoft.com/free/). If you are upgrading from GitHub Models, follow the guide on [upgrading to Azure AI model inference](app://obsidian.md/quickstart-github-models).
2.  **Azure AI Services Resource:** You need an Azure AI Services resource. If you don't have one, follow the steps to [create an Azure AI Services resource](app://obsidian.md/quickstart-create-resources).
3.  **Endpoint URL and Key/Credentials:**  Obtain the endpoint URL and authentication key or set up Microsoft Entra ID authentication for your Azure AI Services resource.
4.  **DeepSeek-R1 Model Deployment:** You must have a DeepSeek-R1 model deployment within your Azure AI Services resource. If not, follow the instructions to [add and configure models to Azure AI services](app://obsidian.md/create-model-deployments). Verify the deployment in the Azure AI Foundry portal under **Models + endpoints** in the **Azure AI Services** section.
5.  **Azure AI Inference Package:** Install the Azure AI Inference Python package:

    ```bash
    pip install -U azure-ai-inference
    ```

## Using DeepSeek-R1 for Chat Completions with Python SDK

Here’s how to interact with DeepSeek-R1 using the Azure AI Inference Python SDK for chat completions:

### 1. Create the Chat Completions Client

First, instantiate the `ChatCompletionsClient`. This example uses API key authentication and assumes your endpoint and key are stored in environment variables.

```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"], # e.g., "https://<resource>.services.ai.azure.com/models"
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"]),
    model="DeepSeek-R1" # Specify the model name if needed, especially if the endpoint serves multiple models
)
```

For Microsoft Entra ID authentication, use `DefaultAzureCredential`:

```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.identity import DefaultAzureCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"], # e.g., "https://<resource>.services.ai.azure.com/models"
    credential=DefaultAzureCredential(),
    credential_scopes=["https://cognitiveservices.azure.com/.default"],
    model="DeepSeek-R1"
)
```

### 2. Make a Basic Chat Request

Send a user message to the model.

```python
from azure.ai.inference.models import UserMessage

response = client.complete(
    messages=[
        UserMessage(content="How many languages are in the world?"),
    ],
)
```

**Prompt Engineering for Reasoning Models**:

*   **Keep Instructions Simple:** Avoid complex prompts or explicit chain-of-thought prompting techniques. DeepSeek-R1's built-in reasoning makes simple prompts effective.
*   **Relevant Context in RAG:** When using Retrieval-Augmented Generation (RAG), provide only the most relevant context to prevent the model from getting sidetracked by unnecessary information.
*   **System Messages:** System messages can be used, but reasoning models might not adhere to them as strictly as non-reasoning models.
*   **Multi-turn Conversations:** In multi-turn applications, consider only including the final answer in the conversation history, omitting the detailed reasoning to keep the context concise.

### 3. Inspect the Response

Print the model's response and usage statistics.

```python
print("Response:", response.choices[0].message.content)
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
```

You'll see output similar to this:

```text
Response: <think>Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer...</think>As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: DeepSeek-R1
Usage:
	Prompt tokens: 11
	Total tokens: 897
	Completion tokens: 886
```

### 4. Extract Reasoning Content

DeepSeek-R1 often includes its reasoning within `<think>` and `</think>` tags. You can extract this to understand the model's thought process:

```python
import re

match = re.match(r"<think>(.*?)</think>(.*)", response.choices[0].message.content, re.DOTALL)

print("Response:")
if match:
    print("\tThinking:", match.group(1))
    print("\tAnswer:", match.group(2))
else:
    print("\tAnswer:", response.choices[0].message.content)
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
```

This will parse and print the thinking and the final answer separately.

```text
Response:
	Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.

    ... (rest of the reasoning) ...

    In conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.
	Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage:
	Prompt tokens: 11
	Total tokens: 897
	Completion tokens: 886
```

### 5. Stream Content

For long responses, streaming can improve perceived latency. Enable streaming by setting `stream=True`:

```python
result = client.complete(
    model="DeepSeek-R1",
    messages=[
        UserMessage(content="How many languages are in the world?"),
    ],
    max_tokens=2048,
    stream=True,
)
```

Use a helper function to process and print the streamed output:

```python
def print_stream(result):
    """Prints the chat completion with streaming, routing answer without reasoning."""
    is_thinking = False
    for event in result:
        if event.choices:
            content = event.choices[0].delta.content
            if content == "<think>":
                is_thinking = True
                print("🧠 Thinking...", end="", flush=True)
            elif content == "</think>":
                is_thinking = False
                print("🛑\n\n")
            elif content:
                print(content, end="", flush=True)

print_stream(result)
```

### 6. Parameter Limitations

Reasoning models like DeepSeek-R1 generally **do not support** parameters like:

*   `temperature`
*   `presence_penalty`
*   `repetition_penalty`
*   `top_p`

Refer to the [Models](app://obsidian.md/concepts/models) details page for specific model parameter support.

### 7. Apply Content Safety

Azure AI model inference API integrates with Azure AI Content Safety. To handle potential content safety flags, use a `try-except` block:

```python
from azure.ai.inference.models import UserMessage
from azure.core.exceptions import HttpResponseError

try:
    response = client.complete(
        model="DeepSeek-R1",
        messages=[
            UserMessage(content="Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."),
        ],
    )
    print(response.choices[0].message.content)

except HttpResponseError as ex:
    if ex.status_code == 400:
        response = ex.response.json()
        if isinstance(response, dict) and "error" in response:
            print(f"Your request triggered an {response['error']['code']} error:\n\t {response['error']['message']}")
        else:
            raise
    raise
```

## Using DeepSeek-R1 for Chat Completions with REST API

You can also interact with DeepSeek-R1 using REST API calls. Here are examples mirroring the Python SDK functionality:

### 1. Create Chat Completion Request (REST)

Send a POST request to the chat completions endpoint.

```http
POST https://<resource>.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview
Content-Type: application/json
api-key: <key>  # Or use Authorization: Bearer <token> for Entra ID
```

**Request Body:**

```json
{
    "model": "DeepSeek-R1",
    "messages": [
        {
            "role": "user",
            "content": "How many languages are in the world?"
        }
    ]
}
```

### 2. Inspect the REST Response

The response will be a JSON object containing the completion and usage information.

```json
{
    "id": "0a1234b5de6789f01gh2i345j6789klm",
    "object": "chat.completion",
    "created": 1718726686,
    "model": "DeepSeek-R1",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "<think>\nOkay, the user is asking how many languages exist in the world. ... </think>\n\nThe exact number of languages in the world is challenging ... **7,000 languages** globally.",
                "tool_calls": null
            },
            "finish_reason": "stop"
        }
    ],
    "usage": {
        "prompt_tokens": 11,
        "total_tokens": 897,
        "completion_tokens": 886
    }
}
```

### 3. Streaming REST Request

To stream the response, set `"stream": true` in the request body.

```http
POST https://<resource>.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview
Content-Type: application/json
api-key: <key> # Or use Authorization: Bearer <token> for Entra ID
```

**Request Body:**

```json
{
    "model": "DeepSeek-R1",
    "messages": [
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        {
            "role": "user",
            "content": "How many languages are in the world?"
        }
    ],
    "stream": true,
    "max_tokens": 2048
}
```

The streaming response will be in `data-only server-sent events` format. Each chunk will be a JSON object, and the final message will have `"finish_reason": "stop"`.

### 4. Content Safety (REST)

If content safety is triggered, you'll receive a 400 error with a JSON response detailing the content filter issue.

**Request Body (Example triggering content safety):**

```json
{
    "model": "DeepSeek-R1",
    "messages": [
        {
            "role": "user",
            "content": "Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."
        }
    ]
}
```

**Error Response (Example):**

```json
{
    "error": {
        "message": "The response was filtered due to the prompt triggering Microsoft's content management policy. Please modify your prompt and retry.",
        "type": null,
        "param": "prompt",
        "code": "content_filter",
        "status": 400
    }
}
```

## Integrating DeepSeek-R1 into Applications

DeepSeek-R1's reasoning capabilities make it ideal for applications requiring complex problem-solving, logical deduction, and step-by-step analysis. Consider integrating it into:

*   **Intelligent Virtual Assistants:** For tasks requiring more than simple information retrieval, such as planning, strategizing, or troubleshooting.
*   **Educational Tools:** To provide detailed explanations and step-by-step solutions in subjects like math, science, and coding.
*   **Code Generation and Debugging:** For applications that require logical code generation, error analysis, and algorithmic problem-solving.
*   **Complex Data Analysis:** To assist in interpreting data, drawing conclusions, and providing reasoned insights.

When integrating DeepSeek-R1:

*   **Leverage Reasoning Output:**  If your application benefits from transparency in the AI's decision-making, expose the reasoning content (`<think>` section) to users.
*   **Optimize for Latency vs. Performance:** Understand that reasoning models may have higher latency. Design your application to handle this, potentially using streaming for better user experience.
*   **Monitor Token Usage:** Be mindful of token consumption, as both reasoning and output completions contribute to costs.

## Cost and Quota Considerations

DeepSeek-R1 deployed as a serverless API endpoint is billed on a pay-as-you-go basis. Quota is managed per deployment, with default rate limits of 200,000 tokens per minute and 1,000 API requests per minute. If you anticipate needing higher limits, contact Microsoft Azure Support.  Refer to [Plan and manage costs (marketplace)](app://obsidian.md/costs-plan-manage#monitor-costs-for-models-offered-through-the-azure-marketplace) for more details on cost management.

## Related Resources

*   **Azure AI Model Inference API Reference:** [Azure AI Model Inference API](app://obsidian.md/reference/reference-model-inference-api)
*   **Azure AI Inference Python SDK Reference:** [Azure AI inference package](https://aka.ms/azsdk/azure-ai-inference/python/reference)
*   **DeepSeek Models on Azure AI Samples (GitHub):** [Explore DeepSeek-related Azure samples](https://github.com/azure-samples/deepseek)
*   **Deploy models as serverless APIs:** [Deploy models as serverless APIs](app://obsidian.md/deploy-models-serverless)
*   **Region availability for serverless API endpoints:** [Region availability for models in serverless API endpoints](app://obsidian.md/deploy-models-serverless-availability)
*   **Use embeddings models:** [Use embeddings models](app://obsidian.md/use-embeddings)
*   **Use image embeddings models:** [Use image embeddings models](app://obsidian.md/use-image-embeddings)

---

## Model Name vs Deployment Name

**1. Within the `azure-ai-inference` Python Library:**

   *   **`model` parameter in the client constructor:**  The most crucial place is when you create the `ChatCompletionsClient` (or `EmbeddingsClient`). You *must* provide the `model` parameter, and this parameter specifies the *model name*.  This tells the client which model you intend to use.  The client uses the *endpoint URL* to determine *where* to send the request (i.e., to which Azure AI services resource), but the `model` parameter tells it *which* model within that resource to use.

       ```python
       from azure.ai.inference import ChatCompletionsClient
       from azure.core.credentials import AzureKeyCredential

       client = ChatCompletionsClient(
           endpoint="https://your-resource.services.ai.azure.com/models",  # Endpoint (resource)
           credential=AzureKeyCredential("your-api-key"),
           model="DeepSeek-R1"  # MODEL NAME (e.g., DeepSeek-R1, llama2-70b-chat)
       )
       ```

   *   **`get_model_info()` (optional):** The `get_model_info()` method returns a `ModelInfo` object.  This object has a `model_name` attribute, which confirms the *model name* being used by the client.  It does *not* provide the deployment name.  This method is primarily used for introspection.

       ```python
       model_info = client.get_model_info()
       print(model_info.model_name)  # Output: DeepSeek-R1 (or whatever model you specified)
       ```

   *   **Response Object:**  The `response` object returned by `client.complete()` (or `client.embed()`) also includes a `model` attribute. This attribute *again* refers to the *model name*, *not* the deployment name.

       ```python
       response = client.complete(...)
       print(response.model)  # Output: DeepSeek-R1 (the model name)
       ```
   *   **Deployment Name is Implicit:** With the `azure-ai-inference` library and serverless API endpoints, you typically don't *directly* specify the deployment name in your code.  The Azure AI services resource and the model name together uniquely identify the deployment. The resource is encoded in the `endpoint`, and the `model` argument determines the model.

**2. Within the REST API:**

   *   **`model` field in the request body:**  Similar to the Python library, you *must* include the `model` field in the JSON request body.  This field specifies the *model name*.

       ```json
       {
         "model": "DeepSeek-R1",  // MODEL NAME
         "messages": [ ... ]
       }
       ```

   *   **`azureml-model-deployment` header (for Managed Online Endpoints, *not* Serverless):**  If you are using *Managed Online Endpoints* (not serverless), and your endpoint has *multiple deployments* of the *same* model, then you *can* use the `azureml-model-deployment` header to specify the *deployment name*.  This header is *not* relevant for serverless endpoints.  It's an *optional* header even for Managed Online Endpoints, used only when you need to disambiguate between multiple deployments of the *same* model under a single endpoint.
        With Serverless API Endpoints, each deployment is tied to one model.

       ```
       POST /chat/completions?api-version=2024-05-01-preview
       Content-Type: application/json
       Authorization: Bearer <your-token>
       azureml-model-deployment: my-DeepSeek-R1-deployment-v2  // DEPLOYMENT NAME (optional, Managed Online Endpoints only)
       ```

   *   **Endpoint URL (Resource, not Deployment):** The endpoint URL itself identifies the Azure AI *resource*, but *not* a specific deployment within that resource.  The `model` field in the request body (or the `model` parameter in the Python client) is what specifies the model, and in the case of serverless deployments, that implicitly determines the deployment.
   * **GET /info (REST API)**: This request does *not* return the deployment name. It returns the *model name*, model type and provider name.

**3. Key Distinctions and Summary:**

*   **Model Name:**  The identifier for the *type* of model (e.g., `DeepSeek-R1`, `llama2-70b-chat`, `mistral-large`).  This is *always* required, either in the `model` parameter of the Python client or the `model` field in the REST API request body.

*   **Deployment Name:** A user-defined name for a *specific instance* of a model deployed within an Azure AI services resource.  You *don't* typically interact with the deployment name directly when using *serverless API endpoints*.  The combination of the resource (endpoint URL) and the model name implicitly identifies the deployment. You *might* use the deployment name with *Managed Online Endpoints* if you have multiple deployments of the *same* model under a single endpoint, using the `azureml-model-deployment` header.

*   **Endpoint URL:**  Identifies the Azure AI *resource*.  It's part of the connection information, but it doesn't specify the model or deployment directly.

* **Serverless vs. Managed Endpoints:** The main difference in how you handle deployment names comes down to the type of endpoint. Serverless endpoints simplify things by tying a single model to each deployment, making the `azureml-model-deployment` header unnecessary.

In essence: Focus on providing the correct *model name* in your requests.  With serverless API endpoints, that's all you need.  With Managed Online Endpoints, you *might* need the `azureml-model-deployment` header in specific multi-deployment scenarios. The endpoint URL identifies the *resource*, not the specific deployment.
