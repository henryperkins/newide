# [[DeepSeek-R1 on Azure AI - Chat Completions]]

This note explains how to use the DeepSeek-R1 model with the Azure AI Model Inference API for chat completions.  It covers setup, usage in Python and JavaScript, handling chain-of-thought reasoning, and provides detailed API reference information.

> [!info] This note focuses on the *chat completions* functionality of the Azure AI Model Inference API as used with DeepSeek-R1.  For a broader overview of the API, see [[Azure AI Inference API Overview]].

---

# 1. Getting Started

DeepSeek-R1 is a language model that excels at conversational tasks and supports chain-of-thought reasoning.  You can deploy it to a serverless API endpoint in Azure AI.

## 1.1. Prerequisites

*   An active Azure subscription.
*   DeepSeek-R1 deployed to a serverless API endpoint in Azure AI.
*   The endpoint URL and API key for your deployment.  You can find these in the Azure portal.

---
# 2. Using DeepSeek-R1 with Python

## 2.1. Installation

```bash
pip install azure-ai-inference
```

## 2.2. Basic Chat Completion

```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

# Use environment variables for security.  Do NOT hardcode your key!
client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"])
)

response = client.complete(
    model="DeepSeek-R1",  #  Specify the model name.
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "How many languages are in the world?"},
    ],
    temperature=0.7,  #  Adjust for creativity.
    max_tokens=256,   #  Limit response length.
)

print("Response:", response.choices[0].message.content)
```

> [!tip]
> *   **`temperature`**: Controls the randomness of the output.  Lower values (e.g., 0.2) are more deterministic; higher values (e.g., 0.9) are more creative.
> *   **`max_tokens`**:  Limits the length of the generated response.  The total tokens (prompt + completion) are limited by the model's context length.

## 2.3. Handling Chain-of-Thought Reasoning

DeepSeek-R1 can include its reasoning process within `<think>` and `</think>` tags.  You can extract this for display or debugging.

```python
import re

content = response.choices[0].message.content
match = re.match(r"<think>(.*?)</think>(.*)", content, re.DOTALL)

if match:
    reasoning = match.group(1)
    answer = match.group(2)
    print("Thinking:\n", reasoning)
    print("Answer:\n", answer)
else:
    print("Answer:\n", content)
```

> [!info] Displaying the chain-of-thought reasoning can be helpful for understanding the model's decision-making process, but you may choose to hide it in a user-facing application.

## 2.4. Error Handling (Python)

It's important to handle potential errors, such as exceeding rate limits or triggering content filters.

```python
from azure.core.exceptions import HttpResponseError
import json

try:
    # ... (your client.complete() call here) ...
    response = client.complete(
        messages=[
            SystemMessage(content="You are an AI assistant that helps people find information."),
            UserMessage(content="Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."),
        ]
    )
except HttpResponseError as ex:
    if ex.status_code == 400:  # Content filter triggered
        response = json.loads(ex.response._content.decode('utf-8'))
        print(f"Content Filter Error: {response['error']['message']}")
    elif ex.status_code == 422: #Unprocessable content
        response = json.loads(ex.response._content.decode('utf-8'))
        if isinstance(response, dict) and "detail" in response:
            for offending in response["detail"]:
                param = ".".join(offending["loc"])
                value = offending["input"]
                print(
                    f"Looks like the model doesn't support the parameter '{param}' with value '{value}'"
                )
    elif ex.status_code == 429:  # Rate limit exceeded
        print(f"Rate Limit Exceeded.  Error code: {ex.status_code}")
    else:
        print(f"An unexpected error occurred: {ex}")

```

> [!warning] Always handle potential `HttpResponseError` exceptions when interacting with the API. Common error codes include 400 (Bad Request - often content filtering), 422 (Unprocessable Entity - parameter not supported), and 429 (Too Many Requests - rate limiting).

---
# 3. Using DeepSeek-R1 with JavaScript

## 3.1. Installation

```bash
npm install @azure-rest/ai-inference
```

## 3.2. Basic Chat Completion

```javascript
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { isUnexpected } from "@azure-rest/ai-inference";

const client = new ModelClient(
  process.env.AZURE_INFERENCE_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_INFERENCE_CREDENTIAL)
);

const messages = [
  { role: "system", "content": "You are a helpful assistant." },
  { role: "user", "content": "How many languages are in the world?" },
];

let response = await client.path("/chat/completions").post({
    body: {
        model: "DeepSeek-R1",
        messages: messages,
        temperature: 0.7,
        max_tokens: 256,
    }
});

if (isUnexpected(response)) {
  throw response.body.error;
}

console.log("Response:", response.body.choices[0].message.content);
```

## 3.3. Chain-of-Thought Extraction (JavaScript)

```javascript
const content = response.body.choices[0].message.content;
const match = content.match(/<think>(.*?)<\/think>(.*)/s);

if (match) {
  const reasoning = match[1];
  const answer = match[2];
  console.log("Thinking:\n", reasoning);
  console.log("Answer:\n", answer);
} else {
  console.log("Answer:\n", content);
}
```
## 3.4. Error Handling (JavaScript)

```js
try {
    // ... (your client.path(...).post(...) call here) ...
        var messages = [
        { role: "system", content: "You are an AI assistant that helps people find information." },
        { role: "user", content: "Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills." },
    ]

    var response = await client.path("/chat/completions").post({
        body: {
            messages: messages,
        }
    });
} catch (error) {
 if (error.status_code == 400) {
        var response = JSON.parse(error.response._content)
        if (response.error) {
            console.log(`Your request triggered an ${response.error.code} error:\n\t ${response.error.message}`)
        }
        else
        {
            throw error
        }
    }
    else if (error.status_code == 422) {
        var response = JSON.parse(error.response._content)
        if (response.detail) {
            for (const offending of response.detail) {
                var param = offending.loc.join(".")
                var value = offending.input
                console.log(`Looks like the model doesn't support the parameter '${param}' with value '${value}'`)
            }
        }
    }
    else if (error.status_code === 429) {
        console.log(`Rate Limit Exceeded.  Error code: ${error.status_code}`);
    } else {
        console.log(`An unexpected error occurred: ${error}`);
    }
}
```

---

# 4. API Reference (Chat Completions)

This section provides a detailed reference for the `/chat/completions` endpoint.

## 4.1. Endpoint

```http
POST /chat/completions?api-version=2024-05-01-preview
```

## 4.2. Request Headers

| Header                  | Required | Description                                                                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `Authorization`         | Yes      | `Bearer <your_api_key>`                                                                                              |
| `extra-parameters`      | No       | `pass-through`, `drop`, or `error` (See [[#4.4. Advanced Options]]).  Defaults to `error`.                       |
| `azureml-model-deployment` | No       |  Required *only* if your endpoint has multiple deployments.                                                   |

## 4.3. Request Body Parameters

The request body is a JSON object with the following parameters:

| Parameter           | Required | Type                                                                                                    | Description                                                                                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`             | See Note | string                                                                                                  | The name of the model to use (e.g., "DeepSeek-R1").  Required unless your endpoint serves only a single model.                                       |
| `messages`          | Yes      | [[#ChatCompletionRequestMessage]]`[]`                                                                   | An array of message objects representing the conversation history.                                                                                       |
| `frequency_penalty` | No       | number (0 to 2.0)                                                                                         |  Reduces the likelihood of repeating the *exact same words*. Higher values = stronger penalty.                                                        |
| `presence_penalty`  | No       | number (0 to 2.0)                                                                                         | Reduces the likelihood of repeating *topics*.  Higher values = stronger penalty.                                                                        |
| `max_tokens`        | No       | integer                                                                                                 | The maximum number of tokens to generate in the response.                                                                                                |
| `stop`              | No       | string or string[]                                                                                       |  A string or array of strings that, if encountered, will cause the model to stop generating text.                                                      |
| `stream`            | No       | boolean                                                                                                 | If `true`, the response will be streamed back as Server-Sent Events (SSE).  Default is `false`.                                                      |
| `temperature`       | No       | number (0.0 to 2.0)                                                                                       | Controls the randomness of the generated text.  Higher values are more random.  Default is 1.0.                                                        |
| `top_p`             | No       | number (0.0 to 1.0)                                                                                       |  An alternative to `temperature` that uses nucleus sampling.  Default is 1.0.  Generally, modify only one of `temperature` or `top_p`.                 |
| `response_format`   | No     | [[#ChatCompletionResponseFormat]]                      | Specifies the format of the response. Can be  `{ "type": "text" }` (default) or `{ "type": "json_object" }`.        |
|`tool_choice`      | No                         | [[#ChatCompletionToolChoiceOption]]| Controls which (if any) function is called by the model.`none`means the model will not call a function and instead generates a message.`auto`means the model can pick between generating a message or calling a function. Specifying a particular function via`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that function.`none`is the default when no functions are present.`auto`is the default if functions are present. Returns a 422 error if the tool is not supported by the model.|
|`tools`            | No                         | [[#ChatCompletionTool]] | A list of tools the model may call. Currently, only functions are supported as a tool. Use this to provide a list of functions the model may generate JSON inputs for. Returns a 422 error if the tool is not supported by the model.                                     |
| `seed`              | No       | integer                                                                                                 |  If specified, the model will attempt to generate deterministic output.  *Not guaranteed.*                                                              |

> [!NOTE]
> The `model` parameter is required *unless* your endpoint is configured to serve only a *single* model.  If your endpoint serves only DeepSeek-R1, you can omit the `model` parameter.

## 4.4. Advanced Options

*   **`extra-parameters` Header:** This header controls how the API handles parameters that it doesn't recognize.
    *   `pass-through`:  Passes unrecognized parameters directly to the underlying model.  Useful for model-specific features.
    *   `drop`:  Silently ignores unrecognized parameters.
    *   `error`:  (Default) Returns a 400 error if unrecognized parameters are present.

## 4.5. Response (200 OK)

A successful response is a JSON object conforming to the [[#CreateChatCompletionResponse]] structure.  It includes:

*   `id`: A unique identifier for the chat completion.
*   `model`: The model used for the completion.
*   `choices`: An array of completion choices (usually just one, unless you requested multiple completions with the `n` parameter, which is not supported by this API).
    *   `index`: The index of the choice within the `choices` array.
    *   `finish_reason`:  The reason the model stopped generating text. See [[#ChatCompletionFinishReason]].
    *   `message`:  A [[#ChatCompletionResponseMessage]] object containing the generated text.
*   `created`:  A Unix timestamp (seconds since epoch) indicating when the completion was created.
*   `object`:  Always "chat.completion".
*   `usage`:  Token usage statistics.  See [[#CompletionUsage]].
*    `system_fingerprint`: This fingerprint represents the backend configuration that the model runs with.Can be used in conjunction with the`seed`request parameter to understand when backend changes have been made that might impact determinism.

---
# 5. Definitions

This section defines the key data structures used by the API.

## 5.1. `ChatCompletionRequestMessage`

Represents a single message within a chat conversation.

| Field       | Type                                          | Description                                                                  |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `role`      | [[#ChatMessageRole]]                          | The role of the message sender (system, user, assistant, tool).                |
| `content`   | string                                        | The content of the message.                                                  |
| `tool_calls`| [[#ChatCompletionMessageToolCall]] |The tool calls generated by the model, such as function calls.|

## 5.2. `ChatMessageRole`

An enum representing the role of a message sender:

*   `system`:  Sets the behavior of the assistant.
*   `user`:   Represents a user prompt or query.
*   `assistant`: Represents a response from the model.
*   `tool`: Represents the result of tool or function call.

## 5.3. `ChatCompletionResponseMessage`

Represents a message generated by the model.

| Field       | Type                                          | Description                                                                  |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `role`      | [[#ChatMessageRole]]                         | Always "assistant".                                                           |
| `content`   | string                                        | The generated text.                                                           |
| `tool_calls`| [[#ChatCompletionMessageToolCall]] |The tool calls generated by the model, such as function calls.|

## 5.4. `ChatCompletionFinishReason`

An enum representing the reason the model stopped generating text:

*   `stop`:  The model reached a natural stopping point or encountered a specified stop sequence.
*   `length`: The maximum number of tokens (`max_tokens`) was reached.
*   `content_filter`:  The generated content triggered a content filter.
*    `tool_calls`: The model is calling a tool.

## 5.5. `CompletionUsage`

| Field              | Type    | Description                                                                |
| ------------------ | ------- | -------------------------------------------------------------------------- |
| `completion_tokens` | integer | The number of tokens in the generated completion.                         |
| `prompt_tokens`     | integer | The number of tokens in the prompt (all messages combined).                |
| `total_tokens`      | integer | The sum of `completion_tokens` and `prompt_tokens`.                       |

## 5.6. `ChatCompletionResponseFormat`

| Field       | Type                                          | Description                                                                  |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `type`      | [[#ChatCompletionResponseFormatType]]                         |  `text` or `json_object`.                                                          |

## 5.7 `ChatCompletionResponseFormatType`
An enum representing the response format.
- `text`: Plain text format.
- `json_object`: JSON object format.

## 5.8 `ChatCompletionToolChoiceOption`
- `none`: The model will not call a function and instead generates a message.
- `auto`: The model can pick between generating a message or calling a function.
- `required`: The model must call one or more tools.
- Specifying a particular tool via`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that tool.

## 5.9 `ChatCompletionTool`
|Name|Type|Description|
|---|---|---|
|function|[#FunctionObject]|The function that the model called.|
|type|[#ToolType]|The type of the tool. Currently, only`function`is supported.|

## 5.10 `ChatCompletionMessageToolCall`
|Name|Type|Description|
|---|---|---|
|function|[#Function]|The function that the model called.|
|ID|string|The ID of the tool call.|
|type|[#ToolType]|The type of the tool. Currently, only`function`is supported.|

## 5.11 `Function`

The function that the model called.

|Name|Type|Description|
|---|---|---|
|arguments|string|The arguments to call the function with, as generated by the model in JSON format. Note that the model does not always generate valid JSON, and may generate incorrect parameters not defined by your function schema. Validate the arguments in your code before calling your function.|
|name|string|The name of the function to call.|

## 5.12 `FunctionObject`

Definition of a function the model has access to.

|Name|Type|Description|
|---|---|---|
|description|string|A description of what the function does, used by the model to choose when and how to call the function.|
|name|string|The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.|
|parameters|object|The parameters the functions accepts, described as a JSON Schema object. Omitting`parameters`defines a function with an empty parameter list.|

## 5.13 `ToolType`
The type of the tool. Currently, only`function`is supported.

## 5.14. `CreateChatCompletionResponse`
Represents a chat completion response returned by model, based on the provided input.

|Name|Type|Description|
|---|---|---|
|choices|[[#Choices]]|A list of chat completion choices. Can be more than one if`n`is greater than 1.|
|created|integer|The Unix timestamp (in seconds) of when the chat completion was created.|
|ID|string|A unique identifier for the chat completion.|
|model|string|The model used for the chat completion.|
|object|string|The object type, which is always`chat.completion`.|
|system_fingerprint|string|This fingerprint represents the backend configuration that the model runs with.Can be used in conjunction with the`seed`request parameter to understand when backend changes have been made that might impact determinism.|
|usage|[[#CompletionUsage]]|Usage statistics for the completion request.|

## 5.15 `Choices`

A list of chat completion choices. Can be more than one if`n`is greater than 1.

|Name|Type|Description|
|---|---|---|
|finish_reason|[[#ChatCompletionFinishReason]]|The reason the model stopped generating tokens. This will be`stop`if the model hit a natural stop point or a provided stop sequence,`length`if the maximum number of tokens specified in the request was reached,`content_filter`if content was omitted due to a flag from our content filters,`tool_calls`if the model called a tool.|
|index|integer|The index of the choice in the list of choices.|
|message|[[#ChatCompletionResponseMessage]]|A chat completion message generated by the model.|

---

# 6. Additional Resources

*   [Azure AI Model Inference Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/)
*   [Azure AI Content Safety](https://learn.microsoft.com/en-us/azure/ai-studio/concepts/content-filtering)
