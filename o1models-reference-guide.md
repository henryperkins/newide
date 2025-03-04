# Azure OpenAI reasoning models

Azure OpenAI `o-series` models are designed to tackle reasoning and problem-solving tasks with increased focus and capability. These models spend more time processing and understanding the user's request, making them exceptionally strong in areas like science, coding, and math compared to previous iterations.

**Key capabilities of the o-series models:**

- Complex Code Generation: Capable of generating algorithms and handling advanced coding tasks to support developers.
- Advanced Problem Solving: Ideal for comprehensive brainstorming sessions and addressing multifaceted challenges.
- Complex Document Comparison: Perfect for analyzing contracts, case files, or legal documents to identify subtle differences.
- Instruction Following and Workflow Management: Particularly effective for managing workflows requiring shorter contexts.

## Availability

 **For access to `o3-mini`, `o1`, and `o1-preview`, registration is required, and access will be granted based on Microsoft's eligibility criteria**.

 Customers who previously applied and received access to `o1` or `o1-preview`, don't need to reapply as they are automatically on the wait-list for the latest model.

Request access: [limited access model application](https://aka.ms/OAI/o1access)

### Region availability

| Model | Region | Limited access |
|---|---|---|
| `o3-mini` | [Model availability](../concepts/models.md#global-standard-model-availability).  | [Limited access model application](https://aka.ms/OAI/o1access) |
|`o1` | [Model availability](../concepts/models.md#global-standard-model-availability).  | [Limited access model application](https://aka.ms/OAI/o1access) |
| `o1-preview` | [Model availability](../concepts/models.md#global-standard-model-availability). |This model is only available for customers who were granted access as part of the original limited access release. We're currently not expanding access to `o1-preview`. |
| `o1-mini` | [Model availability](../concepts/models.md#global-standard-model-availability). | No access request needed for Global Standard deployments.<br><br>Standard (regional) deployments are currently only available to select customers who were previously granted access as part of the `o1-preview` release.|

## API & feature support

| **Feature**     | **o3-mini**, **2025-01-31**  |**o1**, **2024-12-17**   | **o1-preview**, **2024-09-12**   | **o1-mini**, **2024-09-12**   |
|:-------------------|:--------------------------:|:--------------------------:|:-------------------------------:|:---:|
| **API Version**    | `2024-12-01-preview` <br> `2025-01-01-preview`   | `2024-12-01-preview` <br> `2025-01-01-preview` | `2024-09-01-preview`  <br> `2024-10-01-preview` <br> `2024-12-01-preview`    | `2024-09-01-preview`  <br> `2024-10-01-preview` <br> `2024-12-01-preview`    |
| **[Developer Messages](#developer-messages)** | ✅ | ✅ | - | - |
| **[Structured Outputs](./structured-outputs.md)** | ✅ | ✅ | - | - |
| **[Context Window](../concepts/models.md#o-series-models)** | Input: 200,000 <br> Output: 100,000 | Input: 200,000 <br> Output: 100,000 | Input: 128,000  <br> Output: 32,768 | Input: 128,000  <br> Output: 65,536 |
| **[Reasoning effort](#reasoning-effort)** | ✅ | ✅ | - | - |
| **[Vision Support](./gpt-with-vision.md)** | - | ✅ | - | - |
| Functions/Tools | ✅  | ✅  |  - | - |
| `max_completion_tokens`<sup>*</sup> |✅ |✅ |✅ | ✅ |
| System Messages<sup>**</sup> | ✅ | ✅ | - | - |
| Streaming | ✅ | - | - | - |

<sup>*</sup> Reasoning models will only work with the `max_completion_tokens` parameter. <br><br>

<sup>**</sup>The latest o<sup>&#42;</sup> series model support system messages to make migration easier. When you use a system message with `o3-mini` and `o1` it will be treated as a developer message. You should not use both a developer message and a system message in the same API request.



### Not Supported

The following are currently unsupported with reasoning models:

- Parallel tool calling
- `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `logprobs`, `top_logprobs`, `logit_bias`, `max_tokens`

## Usage

These models [don't currently support the same set of parameters](#api--feature-support) as other models that use the chat completions API. 

# [Python (Microsoft Entra ID)](#tab/python-secure)

You'll need to upgrade your OpenAI client library for access to the latest parameters.

```cmd
pip install openai --upgrade
```

If you're new to using Microsoft Entra ID for authentication see [How to configure Azure OpenAI Service with Microsoft Entra ID authentication](../how-to/managed-identity.md).

```python
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"), 
  azure_ad_token_provider=token_provider,
  api_version="2024-12-01-preview"
)

response = client.chat.completions.create(
    model="o1-new", # replace with the model deployment name of your o1-preview, or o1-mini model
    messages=[
        {"role": "user", "content": "What steps should I think about when writing my first Python API?"},
    ],
    max_completion_tokens = 5000

)

print(response.model_dump_json(indent=2))
```

# [Python (key-based auth)](#tab/python)

You might need to upgrade your version of the OpenAI Python library to take advantage of the new parameters like `max_completion_tokens`.

```cmd
pip install openai --upgrade
```

```python

from openai import AzureOpenAI

client = AzureOpenAI(
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"), 
  api_key=os.getenv("AZURE_OPENAI_API_KEY"),  
  api_version="2024-12-01-preview"
)

response = client.chat.completions.create(
    model="o1-new", # replace with the model deployment name of your o1 deployment.
    messages=[
        {"role": "user", "content": "What steps should I think about when writing my first Python API?"},
    ],
    max_completion_tokens = 5000

)

print(response.model_dump_json(indent=2))
```

---

**Output:**

```json
{
  "id": "chatcmpl-AEj7pKFoiTqDPHuxOcirA9KIvf3yz",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "logprobs": null,
      "message": {
        "content": "Writing your first Python API is an exciting step in developing software that can communicate with other applications. An API (Application Programming Interface) allows different software systems to interact with each other, enabling data exchange and functionality sharing. Here are the steps you should consider when creating your first Python API...truncated for brevity.",
        "refusal": null,
        "role": "assistant",
        "function_call": null,
        "tool_calls": null
      },
      "content_filter_results": {
        "hate": {
          "filtered": false,
          "severity": "safe"
        },
        "protected_material_code": {
          "filtered": false,
          "detected": false
        },
        "protected_material_text": {
          "filtered": false,
          "detected": false
        },
        "self_harm": {
          "filtered": false,
          "severity": "safe"
        },
        "sexual": {
          "filtered": false,
          "severity": "safe"
        },
        "violence": {
          "filtered": false,
          "severity": "safe"
        }
      }
    }
  ],
  "created": 1728073417,
  "model": "o1-2024-12-17",
  "object": "chat.completion",
  "service_tier": null,
  "system_fingerprint": "fp_503a95a7d8",
  "usage": {
    "completion_tokens": 1843,
    "prompt_tokens": 20,
    "total_tokens": 1863,
    "completion_tokens_details": {
      "audio_tokens": null,
      "reasoning_tokens": 448
    },
    "prompt_tokens_details": {
      "audio_tokens": null,
      "cached_tokens": 0
    }
  },
  "prompt_filter_results": [
    {
      "prompt_index": 0,
      "content_filter_results": {
        "custom_blocklists": {
          "filtered": false
        },
        "hate": {
          "filtered": false,
          "severity": "safe"
        },
        "jailbreak": {
          "filtered": false,
          "detected": false
        },
        "self_harm": {
          "filtered": false,
          "severity": "safe"
        },
        "sexual": {
          "filtered": false,
          "severity": "safe"
        },
        "violence": {
          "filtered": false,
          "severity": "safe"
        }
      }
    }
  ]
}
```

## Reasoning effort

> [!NOTE]
> Reasoning models have `reasoning_tokens` as part of `completion_tokens_details` in the model response. These are hidden tokens that aren't returned as part of the message response content but are used by the model to help generate a final answer to your request. `2024-12-01-preview` adds an additional new parameter `reasoning_effort` which can be set to `low`, `medium`, or `high` with the latest `o1` model. The higher the effort setting, the longer the model will spend processing the request, which will generally result in a larger number of `reasoning_tokens`.

## Developer messages

Functionally developer messages ` "role": "developer"` are the same as system messages. 

Adding a developer message to the previous code example would look as follows:

# [Python (Microsoft Entra ID)](#tab/python-secure)

You'll need to upgrade your OpenAI client library for access to the latest parameters.

```cmd
pip install openai --upgrade
```

If you're new to using Microsoft Entra ID for authentication see [How to configure Azure OpenAI Service with Microsoft Entra ID authentication](../how-to/managed-identity.md).

```python
from openai import AzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

client = AzureOpenAI(
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"), 
  azure_ad_token_provider=token_provider,
  api_version="2024-12-01-preview"
)

response = client.chat.completions.create(
    model="o1-new", # replace with the model deployment name of your o1-preview, or o1-mini model
    messages=[
        {"role": "developer","content": "You are a helpful assistant."}, # optional equivalent to a system message for reasoning models 
        {"role": "user", "content": "What steps should I think about when writing my first Python API?"},
    ],
    max_completion_tokens = 5000

)

print(response.model_dump_json(indent=2))
```

# [Python (key-based auth)](#tab/python)

You might need to upgrade your version of the OpenAI Python library to take advantage of the new parameters like `max_completion_tokens`.

```cmd
pip install openai --upgrade
```

```python

from openai import AzureOpenAI

client = AzureOpenAI(
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT"), 
  api_key=os.getenv("AZURE_OPENAI_API_KEY"),  
  api_version="2024-12-01-preview"
)

response = client.chat.completions.create(
    model="o1-new", # replace with the model deployment name of your o1 deployment.
    messages=[
        {"role": "developer","content": "You are a helpful assistant."}, # optional equivalent to a system message for reasoning models 
        {"role": "user", "content": "What steps should I think about when writing my first Python API?"},
    ],
    max_completion_tokens = 5000
)

print(response.model_dump_json(indent=2))
```

---

## Markdown output

By default the `o3-mini` and `o1` models will not attempt to produce output that includes markdown formatting. A common use case where this behavior is undesirable is when you want the model to output code contained within a markdown code block. When the model generates output without markdown formatting you lose features like syntax highlighting, and copyable code blocks in interactive playground experiences. To override this new default behavior and encourage markdown inclusion in model responses, add the string `Formatting re-enabled` to the beginning of your developer message.

Adding `Formatting re-enabled` to the beginning of your developer message does not guarantee that the model will include markdown formatting in its response, it only increases the likelihood. We have found from internal testing that `Formatting re-enabled` is less effective by itself with the `o1` model than with `o3-mini`.

To improve the performance of `Formatting re-enabled` you can further augment the beginning of the developer message which will often result in the desired output. Rather than just adding `Formatting re-enabled` to the beginning of your developer message, you can experiment with adding a more descriptive initial instruction like one of the examples below:

- `Formatting re-enabled - please enclose code blocks with appropriate markdown tags.`
- `Formatting re-enabled - code output should be wrapped in markdown.`

Depending on your expected output you may need to customize your initial developer message further to target your specific use case.

---


Okay, let's focus specifically on chat completions using the "o1 reasoning models" within the Azure OpenAI API (2025-02-01-preview). This will highlight the features and parameters that are either unique to or have special considerations for these models.

**Key Distinctions of o1 Reasoning Models:**

The "o1" series models are specifically designed for tasks that require more advanced reasoning capabilities.  This means they are better at:

*   **Complex Problem Solving:** Handling multi-step problems, logical deductions, and scenarios requiring deeper understanding.
*   **Structured Output:**  Generating output that adheres to specific formats or constraints (especially with `response_format: "json_schema"`).
*   **Tool Use:**  More effectively utilizing tools (like function calling) to interact with external systems and data.
* **Developer Messages:** The `developer` role replaces the `system` role.

**Chat Completion Parameters for o1 Models:**

Most of the general chat completion parameters apply to o1 models, but here's how they relate specifically, including unique parameters:

1.  **`messages` (Required):**

    *   **`role`:** The `developer` role is *specifically* highlighted for o1 models.  It replaces the `system` role and provides stronger instructions that the model should follow regardless of user input.  You should use `developer` instead of `system` with o1 models.  The other roles (`user`, `assistant`, `tool`) function the same way.
    *   **`content`:** The content can be text, or an array of content parts. For `developer` messages, only `text` type is supported.

2.  **`reasoning_effort` (o1 Models *Only*):**

    *   **Purpose:** This parameter *exclusively* applies to o1 reasoning models. It allows you to control the amount of computational effort the model spends on reasoning.
    *   **Values:**
        *   `"low"`:  Faster responses, fewer reasoning tokens used, but potentially less thorough reasoning.
        *   `"medium"` (Default): A balance between speed and reasoning depth.
        *   `"high"`:  Slower responses, more reasoning tokens used, potentially more thorough and accurate reasoning.
    *   **Use Case:**  If you need very fast responses and are willing to sacrifice some reasoning depth, use `"low"`. If you need the most accurate and well-reasoned response, and speed is less critical, use `"high"`.

3.  **`max_completion_tokens` (o1 Models *Only*):**

    *   **Purpose:** This parameter is *only supported* in o1 series models in the provided API version. It sets an *upper bound* on the total number of tokens generated for a completion, *including* both visible output tokens and the internal "reasoning" tokens the model uses.
    *   **Contrast with `max_tokens`:** The standard `max_tokens` parameter only limits the number of tokens in the *visible* output (the `content` of the `assistant` message).  `max_completion_tokens` gives you finer-grained control over the *total* token usage, which is important for cost management and preventing excessively long runtimes.
    *   **Use Case:** Use this to strictly limit the total computational resources used by the model, even for internal reasoning steps.

4.  **`response_format` (Strongly Recommended):**

    *   While `response_format` is available for other models, it's *particularly* beneficial with o1 models due to their enhanced reasoning and structured output capabilities.
    *   **`{ "type": "json_schema", "json_schema": { ... } }`:**  This is where o1 models shine.  You can provide a detailed JSON Schema, and the model will make a best effort to generate output that *strictly* conforms to that schema.  This is much more reliable than simply requesting JSON output with `"type": "json_object"`.
    *   **`{ "type": "json_object" }`**: Still supported, but remember to *always* instruct the model to generate JSON in a `developer` or `user` message.

5.  **`tools` and `tool_choice` (Enhanced Capabilities):**

    *   o1 models are generally better at using tools (especially function calling) effectively. Their improved reasoning helps them decide when and how to call functions, and to interpret the results.
    *   The `tool_choice` parameter is fully supported, allowing you to control whether the model uses tools (`auto`), must use tools (`required`), or is forced to use a specific tool.

6.  **`stream`:** Streaming works the same way as with other models, providing partial message deltas.

7.  **`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `logit_bias`:** These parameters all function as expected, allowing you to control the randomness and diversity of the generated text.

8.  **`metadata`:**  Allows you to attach arbitrary key-value pairs to the completion request for tracking or filtering.

9. **`store`**: Allows you to specify whether or not to store the output of the chat completion.

10. **`user`**: Allows you to specify a unique identifier representing your end-user.

**Example (o1 Model with `reasoning_effort` and `json_schema`):**

```json
{
  "deployment-id": "your-o1-deployment",
  "api-version": "2025-02-01-preview",
  "messages": [
    {
      "role": "developer",
      "content": "You are a helpful assistant that always responds in JSON, following the provided schema."
    },
    {
      "role": "user",
      "content": "What is the capital of France?"
    }
  ],
  "reasoning_effort": "high",
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "type": "object",
      "properties": {
        "capital": {
          "type": "string",
          "description": "The capital city."
        }
      },
      "required": ["capital"]
    }
  }
}
```

**Key Takeaways for o1 Reasoning Models:**

*   Use the `developer` role instead of `system`.
*   Leverage `reasoning_effort` to control the trade-off between speed and reasoning depth.
*   Use `max_completion_tokens` to limit total token usage (including reasoning tokens).
*   Strongly consider using `response_format: "json_schema"` for structured output.
*   o1 models are well-suited for complex tasks involving tools and structured data.
*   All other standard chat completion parameters are also applicable.

By understanding these distinctions, you can effectively utilize the enhanced capabilities of o1 reasoning models for your most demanding AI applications.
