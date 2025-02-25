Below are various examples and use cases demonstrating how to interact with the DeepSeek-R1 model via the Azure OpenAI-like API surfaces. They highlight the most common usage patterns of DeepSeek-R1 (especially its reasoning capabilities) using HTTP REST calls and Python or JavaScript code.

---

## 1. Chat Completions with Reasoning

**Key Endpoint**
```
POST /chat/completions?api-version=2025-01-01-preview
```

### Example 1: Simple cURL Request

Use cURL to send a chat completions request to DeepSeek-R1 and observe how it might include reasoning between `<think>` and `</think>` tags:
```bash
curl -X POST \
     -H "Content-Type: application/json" \
     -H "api-key: YOUR_API_KEY" \
     "https://YOUR_ENDPOINT_NAME.openai.azure.com/openai/deployments/DEPLOYMENT_ID/chat/completions?api-version=2025-01-01-preview" \
     -d '{
       "messages": [
         {
           "role": "system",
           "content": "You are a helpful reasoning assistant."
         },
         {
           "role": "user",
           "content": "How many planets are in the solar system?"
         }
       ],
       "model": "DeepSeek-R1",
       "max_tokens": 128,
       "temperature": 0.7,
       "stream": false
     }'
```

**Response Example** (simplified):
```json
{
  "id": "chatcmpl-abc123",
  "model": "DeepSeek-R1",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "<think>We might recall that, after reclassification of Pluto, there are 8 planets. Let me confirm…</think>\nThere are 8 recognized planets in the solar system."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": { 
    "prompt_tokens": 19, 
    "completion_tokens": 40, 
    "total_tokens": 59 
  }
}
```

Here, the `<think>...</think>` portion indicates internal reasoning. You can choose to display or suppress it in your application.

### Example 2: Python Usage

Below is a sample Python snippet using a hypothetical `azure-ai-inference` style package to call DeepSeek-R1. It extracts the “thinking” text to show how the model reasoned:

```python
import os
import re
import json
from azure.core.credentials import AzureKeyCredential
from azure.ai.inference import ChatCompletionsClient

ENDPOINT = os.getenv("AZURE_INFERENCE_ENDPOINT")
API_KEY = os.getenv("AZURE_INFERENCE_API_KEY")

client = ChatCompletionsClient(endpoint=ENDPOINT, credential=AzureKeyCredential(API_KEY))

messages = [
    {"role": "system", "content": "You are a helpful reasoning assistant."},
    {"role": "user", "content": "Explain the Riemann Hypothesis in simple terms."}
]

response = client.complete(messages=messages, model="DeepSeek-R1", temperature=0.7)

# The full content, which may occasionally include <think> ... </think>
content = response.choices[0].message.content

think_match = re.match(r"<think>(.*?)</think>(.*)", content, re.DOTALL)
if think_match:
    reason_text = think_match.group(1)
    answer_text = think_match.group(2)
    print("Model reasoned:\n", reason_text, "\n")
    print("Answer:\n", answer_text)
else:
    print("Complete answer:\n", content)
```
**Use Case**: This snippet is helpful if you want to debug or “peek” into step-by-step reasoning. In production, you might omit `<think>...</think>` from user-facing UIs.

### Example 3: JavaScript Usage

```js
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const ENDPOINT = process.env["AZURE_INFERENCE_ENDPOINT"];
const KEY = process.env["AZURE_INFERENCE_API_KEY"];

const client = new ModelClient(ENDPOINT, new AzureKeyCredential(KEY));

async function runChat() {
  const messages = [
    { role: "system", content: "You are a helpful reasoning assistant." },
    { role: "user", content: "What is the capital city of Australia?" }
  ];

  const response = await client
    .path("/chat/completions")
    .post({
      body: {
        model: "DeepSeek-R1",
        messages: messages,
        temperature: 0.1
      }
    });

  console.log("DeepSeek Response:", response.body);
}

runChat().catch(console.error);
```
This request obtains a standard JSON response. If `<think>` text is present, parse it similarly with a regex in JS.

---

## 2. Use Case: Reasoning with Tools/Function Calling

DeepSeek-R1 can optionally call custom “functions” or “tools.” For example, you might define a function named “calc_sum” that takes an array of numbers as input. DeepSeek-R1 can decide to ask that function:

```json
{
  "model": "DeepSeek-R1",
  "messages": [
    { "role": "system", "content": "You are a math-savvy assistant." },
    { "role": "user", "content": "Find the sum of 23, 42, and 1000." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "calc_sum",
        "description": "Calculate the sum of an array of numbers.",
        "parameters": {
          "type": "object",
          "properties": {
            "numbers": {
              "type": "array",
              "items": { "type": "number" },
              "description": "The numbers to sum."
            }
          },
          "required": ["numbers"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Response** might look like:
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "",
        "tool_calls": [
          {
            "id": "tool_call_001",
            "type": "function",
            "function": {
              "name": "calc_sum",
              "arguments": "{\"numbers\":[23,42,1000]}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```
This indicates the model decided to call the function with the arguments `[23, 42, 1000]`. Your application can compute that sum externally (1065), then send it back with a request to continue the conversation. This is how chain-of-thought with tool use can be dynamically handled.

---

## 3. Use Case: Step-by-Step Reasoning across Multiple Turns

DeepSeek-R1 also integrates well with multi-turn conversation scenarios. For instance, you might:

1. Create a **thread** via `POST /threads`, optionally providing an initial user message.
2. Repeatedly call:
   - `POST /threads/{thread_id}/messages` to add user or assistant messages,
   - `POST /threads/{thread_id}/runs` to “execute” the conversation using DeepSeek-R1,
   - The model can add new messages or call functions in each run.

**High-Level Flow**:
1. `POST /threads` => get a new thread ID.
2. `POST /threads/{thread_id}/messages` => user asks a question.
3. `POST /threads/{thread_id}/runs` => model attempts to answer or call a function.
4. If the model calls a function (requires action), provide function outputs via:
   ```
   POST /threads/{thread_id}/runs/{run_id}/submit_tool_outputs
   ```
5. Finally, the assistant message is completed and appended to the thread.

This multi-step approach allows for advanced, multi-turn “chain-of-thought” interactions.

---

## 4. Use Case: Streaming Partial Responses

When generating a large response, set `"stream": true` in your request to read partial tokens as they arrive. In cURL, you might specify:

```bash
curl -N \
  -H "Content-Type: application/json" \
  -H "api-key: YOUR_API_KEY" \
  "https://YOUR_ENDPOINT_NAME.openai.azure.com/openai/deployments/DEPLOYMENT_ID/chat/completions?api-version=2025-01-01-preview" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a verbose, step-by-step reasoning assistant."},
      {"role": "user", "content": "Write a short story about a space explorer."}
    ],
    "model": "DeepSeek-R1",
    "stream": true
  }'
```
You’ll receive a [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events/Using_server-sent_events) stream. Keep reading until you see `data: [DONE]`.

---

## 5. Use Case: Hiding or Displaying the `<think>` Section

DeepSeek-R1 optionally includes internal reasoning. Some applications want full transparency, others prefer to hide the chain-of-thought from end-users. You can:

- **Pass** the entire response verbatim (with `<think>`).
- **Strip** the `<think>` tag contents for user-facing text.

Below is a simple function in Python to remove `<think>`-tagged content:

```python
import re

def remove_thought(content: str) -> str:
    return re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
```
Call `remove_thought` before displaying the answer.

---

## Conclusion

DeepSeek-R1 excels at multi-step, chain-of-thought reasoning. You can:

- **Return** the entire chain of reasoning (with `<think>`).
- **Hide** it from the final user but keep it for logging or debugging.
- **Use** function calling (tools) for more advanced tasks like code execution, knowledge retrieval, or custom logic.

These code samples showcase typical interactions. For additional details—like streaming partial tokens, multi-turn thread usage, or integrating with advanced features such as content filtering—refer to the official Azure OpenAI (or your private deployment) documentation on the [data plane inference API](#).

Use these patterns to incorporate DeepSeek-R1 into your own application’s chat, Q&A, or complex reasoning workflows. 