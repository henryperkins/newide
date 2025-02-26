Title: [[DeepSeek-R1 Azure AI]]
Path: Enhanced Prompts/DeepSeek-R1 Azure AI.md

[[DeepSeek-R1 Azure AI]]

# Overview
DeepSeek-R1 is a model that can be deployed to a serverless API endpoint in Azure AI Foundry. It supports chain-of-thought reasoning, which you can choose to display or hide. This note provides examples of using DeepSeek-R1 in both Python and JavaScript, along with more detailed information on the API endpoints, request structure, headers, and other advanced configuration options in Azure AI Foundry.

---
# 1. Using DeepSeek-R1 with Python

## 1.1 Install the inference package
```bash
pip install azure-ai-inference
```

## 1.2 Create a client and call the model
```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"], 
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"])
)

response = client.complete(
    model="DeepSeek-R1",
    messages=[
        # Provide a system suggestion
        {"role": "system", "content": "You are a helpful assistant."},
        # User prompt
        {"role": "user", "content": "How many languages are in the world?"},
    ],
    frequency_penalty=0,
    presence_penalty=0,
    max_tokens=256,
    stop="",
    stream=False,
    temperature=0.7,
    top_p=1,
    response_format={ "type": "text" }
)

print("Response:", response.choices[0].message.content)
```

## 1.3 Customize and display reasoning
DeepSeek-R1 may include “thinking” text enclosed between the tags `<think>` and `</think>`. You can capture that part to display or hide separately:

```python
import re

# Grab model content
content = response.choices[0].message.content

# Match between <think>...</think>
match = re.match(r"<think>(.*?)</think>(.*)", content, re.DOTALL)
if match:
    reasoning = match.group(1)  # Text inside <think> ... </think>
    answer = match.group(2)     # The rest of the answer after </think>
    print("Thinking:\n", reasoning)
    print("Answer:\n", answer)
else:
    # If the model didn’t return <think> tags, display the content directly
    print("Answer:\n", content)
```

This approach lets you choose whether to show the internal chains of thought in your UI.

---
# 2. Using DeepSeek-R1 with JavaScript

## 2.1 Install the inference package
```bash
npm install @azure-rest/ai-inference
```

## 2.2 Create a client and call the model
```js
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { isUnexpected } from "@azure-rest/ai-inference";

const client = new ModelClient(
  process.env.AZURE_INFERENCE_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_INFERENCE_CREDENTIAL)
);

const messages = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "How many languages are in the world?" },
];

let response = await client.path("/chat/completions").post({ 
    body: { 
        model: "DeepSeek-R1",
        messages: messages,
        frequency_penalty: 0,
        presence_penalty: 0,
        max_tokens: 256,
        stop: "",
        stream: false,
        temperature: 0.7,
        top_p: 1,
        response_format: { type: "text" }
    } 
});

if (isUnexpected(response)) {
  throw response.body.error;
}

console.log("Response:", response.body.choices[0].message.content);
```

## 2.3 Customize and display reasoning
Similar to Python, you can detect `<think>...</think>` tags:
```js
const content = response.body.choices[0].message.content;
const match = content.match(/<think>(.*?)<\/think>(.*)/s);

if (match) {
  const reasoning = match[1]; // text inside <think> ... </think>
  const answer = match[2];    // the rest of the text
  console.log("Thinking:\n", reasoning);
  console.log("Answer:\n", answer);
} else {
  console.log("Answer:\n", content);
}
```

---
# 3. Summary
1. **Python**  
   - Install the azure-ai-inference package.  
   - Create a ChatCompletionsClient and call `client.complete(...)`.  
   - Optionally parse out `<think>` tags to show or hide the model’s reasoning.

2. **JavaScript**  
   - Install @azure-rest/ai-inference.  
   - Create a ModelClient object and call `client.path("/chat/completions").post(...)`.  
   - Similarly, match `<think>` tags to separate reasoning from the user-facing answer.

Whether or not to display the `<think>` portion is up to you and your application’s requirements.

---
# 4. More Specific API Usage

## 4.1 Endpoint
```
POST /chat/completions?api-version=2024-05-01-preview
```
- **`api-version`** (required): Must be a valid version, such as `2024-05-01-preview`.

## 4.2 Request Headers
| Header Name                  | Required? | Description                                                                                                                                                                                                                                                                                                        |
|-----------------------------|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Authorization**           | Yes      | Include a valid token with the `Bearer` prefix, e.g. `Bearer abcde12345`.                                                                                                                                                                                                                                          |
| **extra-parameters**        | No       | Behavior for additional parameters not recognized by this API, such as: <br>• `pass-through`: pass them to the model. <br>• `drop`: ignore them. <br>• `error`: reject the request if extra parameters are provided. |
| **azureml-model-deployment**| No       | Name of the deployment to route the request to, if your endpoint supports multiple deployments. |

## 4.3 Request Body
| Field                | Required?                  | Type                                         | Description                                                                                                                                                                                                                                                                                  |
|----------------------|----------------------------|----------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **model**            | No (required if multiple models) | string                                       | The model name, e.g. `"DeepSeek-R1"`. If your endpoint only serves a single model, this can be omitted.                                                                                                                                                                                     |
| **messages**         | **Yes**                    | [ChatCompletionRequestMessage](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionrequestmessage)| A list of messages (system, user, or assistant).                                                                                                                                                                                                                                             |
| **frequency_penalty**| No                         | number                                       | Reduces exact word repetition (higher = stronger penalty).                                                                                                                                                                                                                                   |
| **presence_penalty** | No                         | number                                       | Reduces repetition of the same **topics**.                                                                                                                                                                                                                                                 |
| **max_tokens**       | No                         | integer                                      | Limits the number of tokens in the model’s response.                                                                                                                                                                                                                                         |
| **stop**             | No                         | string[] or string                           | Sequences where the API should stop generating more text.                                                                                                                                                                                                                                   |
| **stream**           | No (default=`false`)       | boolean                                      | If `true`, partial tokens stream back as generated (Server-Sent Events).                                                                                                                                                                                                                    |
| **temperature**      | No (default=`1`)           | number                                       | Higher values → more varied completions; lower values → more controlled.                                                                                                                                                                                                                     |
| **top_p**            | No (default=`1`)           | number                                       | Alternative to `temperature` for sampling (nucleus sampling).                                                                                                                                                                                                                                |
| **tool_choice**      | No                         | [ChatCompletionToolChoiceOption](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletiontoolchoiceoption)| Controls which (if any) function is called by the model.`none`means the model will not call a function and instead generates a message.`auto`means the model can pick between generating a message or calling a function. Specifying a particular function via`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that function.`none`is the default when no functions are present.`auto`is the default if functions are present. Returns a 422 error if the tool is not supported by the model.|
| **tools**            | No                         | [ChatCompletionTool](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletiontool)[] | A list of tools the model may call. Currently, only functions are supported as a tool. Use this to provide a list of functions the model may generate JSON inputs for. Returns a 422 error if the tool is not supported by the model.                                     |
| **response_format**  | No (default=`text`)        | [ChatCompletionResponseFormat](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionresponseformat) | Controls whether the response is plain text (`"text"`) or JSON (`"json_object"`).                                                                                                                                                                                                           |
| **seed**             | No                         | integer                                      | Attempts to make sampling deterministic for debugging (not guaranteed).                                                                                                                                                                                                                      |

#### Example Request Body
```json
{
  "model": "DeepSeek-R1",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant" },
    { "role": "user", "content": "Explain Riemann's conjecture" }
  ],
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "max_tokens": 256,
  "stop": "",
  "stream": false,
  "temperature": 0.7,
  "top_p": 1,
  "response_format": { "type": "text" }
}
```

## 4.4 Responses
- **200 OK**: Returns a [CreateChatCompletionResponse](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#createchatcompletionresponse) object, typically with:
  - `choices`: usually an array of length 1 containing the generated response.
  - `usage`: token metrics (`prompt_tokens`, `completion_tokens`, `total_tokens`).
- **401 Unauthorized**: Missing or invalid token.
- **404 Not Found**: Model or endpoint route not supported.
- **422 Unprocessable Entity**: Malformed request or parameters not supported by the model.
- **429 Too Many Requests**: Rate limit reached.
- **ContentFilterError**: Content violates content policy.

## 4.5 Security
Include an **Authorization** header with a `Bearer` token:
```
Authorization: Bearer <YOUR_TOKEN>
```
- If using Azure Active Directory (AAD), follow the OAuth2 client credential flow to get your token from:
  ```
  https://login.microsoftonline.com/common/oauth2/v2.0/token
  ```
  
## 4.6 Example Request and Response

### Request
```http
POST /chat/completions?api-version=2024-05-01-preview
Authorization: Bearer <YOUR_TOKEN>
Content-Type: application/json

{
  "model": "DeepSeek-R1",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant" },
    { "role": "user", "content": "Explain Riemann's conjecture" }
  ],
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "max_tokens": 256,
  "stop": "",
  "stream": false,
  "temperature": 0.7,
  "top_p": 1,
  "response_format": { "type": "text" }
}
```

### Response (200 OK)
```json
{
  "id": "1234567890",
  "model": "DeepSeek-R1",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "The Riemann Conjecture is a deep mathematical conjecture around prime numbers and how they can be predicted. It was first published in Riemann's groundbreaking 1859 paper. The conjecture states that the Riemann zeta function has its zeros only at the negative even integers and complex numbers with real part 1/2. Many consider it to be the most important unsolved problem in pure mathematics."
      }
    }
  ],
  "created": 1672531200,
  "object": "chat.completion",
  "usage": {
    "prompt_tokens": 205,
    "completion_tokens": 50,
    "total_tokens": 255
  }
}
```

## 4.7 Tips for DeepSeek-R1
1. **Chain-of-Thought Reasoning**: Look for `<think>...</think>` if you want insights into the model’s internal reasoning.  
2. **Streaming**: Enable `"stream": true` to receive partial tokens as they are generated (SSE).  
3. **Tool Usage**: If you define `tools` (functions), set `"tool_choice"` to `"auto"` or specify a function name.  
4. **Rate Limits**: Watch for `429` errors and the corresponding `x-ms-error-code` if you exceed your usage limits.

---
# 5. Additional Azure OpenAI Inference API Overview

Below is a general high-level summary of additional Azure OpenAI Inference API endpoints (codenamed “2025-01-01-preview”). While these may be separate from DeepSeek-R1 usage, they provide context for a broader set of functionalities.

## 5.1 Completions
- **Route**: `POST /completions`  
- **Usage**: Submit a prompt, get text completions from a GPT-based model.  
- **Key Parameters**: `prompt`, `max_tokens`, `temperature`, `top_p`, `n`, `stop`.  
- **Response**: Returns text completions.

## 5.2 Chat Completions
- **Route**: `POST /chat/completions`  
- **Usage**: Chat interface with messages (system/user/assistant).  
- **Key Parameters**: `messages`, `max_tokens`, `temperature`, `top_p`, `stream`.  
- **Response**: Structured chat completion (can be streamed).

## 5.3 Embeddings
- **Route**: `POST /embeddings`  
- **Usage**: Generates embeddings for input text (for similarity searches, etc.).  
- **Key Parameters**: `input` (single string or array).  
- **Response**: Vectors representing the input text.

## 5.4 Audio (Speech, Transcription, Translation)
- **Speech** (`POST /audio/speech`): Text-to-speech.  
- **Transcriptions** (`POST /audio/transcriptions`): Convert speech to text in the input language.  
- **Translations** (`POST /audio/translations`): Convert speech to English text.

## 5.5 Image Generations
- **Route**: `POST /images/generations`  
- **Usage**: Create images from text prompts (e.g., DALL·E).  
- **Key Parameters**: `prompt`, `n`, `size`, `style`, `quality`.  
- **Response**: URLs or base64-encoded images.

## 5.6 Assistants
- Wrap a model and system instructions, possibly with tools (e.g., code interpreter).  
- **Endpoints**:
  - `GET /assistants`  
  - `POST /assistants`  
  - `GET /assistants/{assistant_id}`  
  - `POST /assistants/{assistant_id}`  
  - `DELETE /assistants/{assistant_id}`  

## 5.7 Threads & Messages
Organize multi-turn conversations.  
- **Threads**  
  - `POST /threads` (create), `GET /threads/{thread_id}`, etc.  
- **Messages** in a thread  
  - `POST /threads/{thread_id}/messages` (create), `GET /threads/{thread_id}/messages`, etc.

## 5.8 Runs
Execute steps in a conversation.  
- `POST /threads/{thread_id}/runs` (create a run on a thread)  
- `GET /threads/{thread_id}/runs/{run_id}` (retrieve info about a run)

## 5.9 Vector Stores
Manage large sets of documents as embeddings. Useful for retrieval-augmented generation.  
- `GET /vector_stores`, `POST /vector_stores`, etc.

## 5.10 Common Request Headers & Auth
- **`api-key`** (required)  
- **`Authorization: Bearer <token>`** (optional for Microsoft Entra ID auth)  
- **`api-version`** (query param, e.g. `2025-01-01-preview`)

## 5.11 Key Usage Notes
1. **Deployment**: Models generally need a deployment name or an assistant wrapping them.  
2. **Streaming Responses**: SSE for partial tokens is supported on many endpoints.  
3. **Function Calling (Tools)**: Provide tool definitions for the model to call.  
4. **Threads & Runs**: Manage multi-turn state.  
5. **Vector Stores**: For advanced retrieval scenarios.  
6. **Audio & Image**: Transcription, translation, TTS, and generative images.

---
# 6. Definitions

- **ChatCompletionRequestMessage**: A message in the conversation (system, user, assistant).
- **ChatCompletionResponseMessage**: A chat completion message generated by the model.
- **ChatMessageRole**: The role of the author (system, user, assistant).
- **ChatCompletionFinishReason**: Reason for stopping token generation (e.g., `stop`, `length`, `content_filter`, `tool_calls`).
- **ChatCompletionToolChoiceOption**: Controls which (if any) tool the model can call.
- **ChatCompletionResponseFormatType**: Response format type (`text`, `json_object`).

## 6.1 Example Using DeepSeek-R1 with Chain-of-Thought Reasoning
### Request
```http
POST /chat/completions?api-version=2024-05-01-preview
Authorization: Bearer <YOUR_TOKEN>
Content-Type: application/json

{
  "model": "DeepSeek-R1",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant" },
    { "role": "user", "content": "Explain Riemann's conjecture" }
  ],
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "max_tokens": 256,
  "stop": "",
  "stream": false,
  "temperature": 0.7,
  "top_p": 1,
  "response_format": { "type": "text" }
}
```

### Response (200 OK)
```json
{
  "id": "1234567890",
  "model": "DeepSeek-R1",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "<think>Considering the Riemann Conjecture and its implications...</think>Riemann's Conjecture is a deep mathematical conjecture around prime numbers and how they can be predicted. It was first published in Riemann's groundbreaking 1859 paper. The conjecture states that the Riemann zeta function has its zeros only at the negative even integers and complex numbers with real part 1/2."
      }
    }
  ],
  "created": 1672531200,
  "object": "chat.completion",
  "usage": {
    "prompt_tokens": 205,
    "completion_tokens": 50,
    "total_tokens": 255
  }
}
```

---
# 7. Conclusion
DeepSeek-R1 in Azure AI Foundry can be used via Python or JavaScript, supporting chain-of-thought reasoning, streaming responses, function calling, and more. By combining these features, you can build powerful, modular AI applications on Azure.

### Additional Resources
- [Azure Model Inference Info](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-info)
- [Azure Model Inference Chat Completions](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions)
- [Supplemental Terms of Use for Microsoft Azure Previews](https://azure.microsoft.com/support/legal/preview-supplemental-terms/)

---

### Detailed Definitions

#### ChatCompletionFinishReason
- **`content_filter`**: Content was omitted due to a flag from our content filters.
- **`length`**: The maximum number of tokens specified in the request was reached.
- **`stop`**: The model hit a natural stop point or a provided stop sequence.
- **`tool_calls`**: The model called a tool.

#### ChatCompletionMessageToolCall
|Name|Type|Description|
|---|---|---|
|function|Function|The function that the model called.|
|ID|string|The ID of the tool call.|
|type|ToolType|The type of the tool. Currently, only`function`is supported.|

#### ChatCompletionObject
- **For chat completions**, this is always `"chat.completion"`.

#### ChatCompletionResponseFormat
|Name|Type|Description|
|---|---|---|
|type|[ChatCompletionResponseFormatType](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionresponseformattype)|The response format type.|

#### ChatCompletionResponseFormatType
- **`json_object`**: Enables JSON mode, which guarantees the message the model generates is valid JSON.
- **`text`**: Plain text format.

#### ChatCompletionResponseMessage
|Name|Type|Description|
|---|---|---|
|content|string|The contents of the message.|
|role|[ChatMessageRole](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatmessagerole)|The role of the author of this message.|
|tool_calls|[ChatCompletionMessageToolCall](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionmessagetoolcall)[]|The tool calls generated by the model, such as function calls.|

#### ChatCompletionTool
|Name|Type|Description|
|---|---|---|
|function|[FunctionObject](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#functionobject)|The function that the model called.|
|type|[ToolType](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#tooltype)|The type of the tool. Currently, only`function`is supported.|

#### ChatMessageRole
|Name|Type|Description|
|---|---|---|
|assistant|string|Indicates the assistant's message.|
|system|string|Indicates a system message.|
|tool|string|Indicates a tool or function call.|
|user|string|Indicates a user's message.|

#### Choices
A list of chat completion choices.
- **finish_reason**: Reason the model stopped generating tokens.
- **index**: Index of the choice in the list of choices.
- **message**: [ChatCompletionResponseMessage](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionresponsemessage) generated by the model.

#### CompletionUsage
Usage statistics for the completion request.
- **completion_tokens**: Number of tokens in the generated completion.
- **prompt_tokens**: Number of tokens in the prompt.
- **total_tokens**: Total number of tokens used in the request (prompt + completion).

#### ContentFilterError
The API call fails when the prompt triggers a content filter as configured. Modify the prompt and try again.
- **code**: The error code.
- **error**: The error description.
- **message**: The error message.
- **param**: The parameter that triggered the content filter.
- **status**: The HTTP status code.

#### CreateChatCompletionRequest
|Name|Type|Default Value|Description|
|---|---|---|---|
|frequency_penalty|number|0|Helps prevent word repetitions by reducing the chance of a word being selected if it has already been used. The higher the frequency penalty, the less likely the model is to repeat the same words in its output.|
|max_tokens|integer|null|The maximum number of tokens that can be generated in the chat completion. The total length of input tokens and generated tokens is limited by the model's context length. Passing null causes the model to use its max context length.|
|messages|[ChatCompletionRequestMessage](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionrequestmessage)|A list of messages comprising the conversation so far.|
|presence_penalty|number|0|Helps prevent the same topics from being repeated by penalizing a word if it exists in the completion already, even just once.|
|response_format|[ChatCompletionResponseFormat](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionresponseformat)|Controls whether the response is plain text (`"text"`) or JSON (`"json_object"`).|
|seed|integer|null|If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same`seed`and parameters should return the same result. Determinism is not guaranteed, and you should refer to the`system_fingerprint`response parameter to monitor changes in the backend.|
|stop|||Sequences where the API will stop generating further tokens.|
|stream|boolean|false|If set, partial message deltas will be sent. Tokens will be sent as data-only [server-sent events](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletionresponseformattype) as they become available, with the stream terminated by a`data: [DONE]`message.|
|temperature|number|1|Non-negative number. Return 422 if value is unsupported by model.|
|tool_choice|[ChatCompletionToolChoiceOption](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletiontoolchoiceoption)|Controls which (if any) function is called by the model.`none`means the model will not call a function and instead generates a message.`auto`means the model can pick between generating a message or calling a function. Specifying a particular function via`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that function.`none`is the default when no functions are present.`auto`is the default if functions are present. Returns a 422 error if the tool is not supported by the model.|
|tools|[ChatCompletionTool](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#chatcompletiontool)[]|A list of tools the model may call. Currently, only functions are supported as a tool. Use this to provide a list of functions the model may generate JSON inputs for. Returns a 422 error if the tool is not supported by the model.|
|top_p|number|1|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or`temperature`but not both.|

#### ModelInfo
|Name|Type|Description|
|---|---|---|
|model_name|string|The name of the model.|
|model_provider_name|string|The provider of the model.|
|model_type|[ModelType](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions#modeltype)|The inference task associated with the model.|

#### ModelType
|Name|Type|Description|
|---|---|---|
|audio-generation|string|A text-to-audio generative model.|
|chat-completions|string|A model capable of taking chat-formatted messages and generate responses.|
|embeddings|string|A model capable of generating embeddings from a text.|
|image-embeddings|string|A model capable of generating embeddings from an image and text description.|
|image-generation|string|A model capable of generating images from an image and text description.|
|text-generation|string|A text generation model.|

---
# 8. Feedback

If you encounter any issues or have feedback, you can provide it on the [Azure AI Foundry feedback page](https://azure.microsoft.com/en-us/feedback/).

## Additional Resources

### In this article

- [Azure Model Inference Info](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-info)
- [Azure Model Inference Chat Completions](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions)

---

This comprehensive alignment of [[DeepSeek-R1 Azure AI]] with the Azure AI Inference API docs ensures that the information is consistent and comprehensive, providing clear steps for integrating DeepSeek-R1 into your applications. If you need further customization or have specific questions, feel free to ask!