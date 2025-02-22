## How to use reasoning models with Azure AI model inference

- Article
- 02/05/2025

## In this article

1. [Reasoning models](#reasoning-models)
2. [Prerequisites](#prerequisites)
3. [Use reasoning capabilities with chat](#use-reasoning-capabilities-with-chat)
4. [Related content](#related-content)

Important

Items marked (preview) in this article are currently in public preview. This preview is provided without a service-level agreement, and we don't recommend it for production workloads. Certain features might not be supported or might have constrained capabilities. For more information, see [Supplemental Terms of Use for Microsoft Azure Previews](https://azure.microsoft.com/support/legal/preview-supplemental-terms/).

This article explains how to use the reasoning capabilities of chat completions models deployed to Azure AI model inference in Azure AI services.

[](#reasoning-models)

## Reasoning models

Reasoning models can reach higher levels of performance in domains like math, coding, science, strategy, and logistics. The way these models produces outputs is by explicitly using chain of thought to explore all possible paths before generating an answer. They verify their answers as they produce them which helps them to arrive to better more accurate conclusions. This means that reasoning models may require less context in prompting in order to produce effective results.

Such way of scaling model's performance is referred as _inference compute time_ as it trades performance against higher latency and cost. It contrasts to other approaches that scale through _training compute time_.

Reasoning models then produce two types of outputs:

- Reasoning completions
- Output completions

Both of these completions count towards content generated from the model and hence, towards the token limits and costs associated with the model. Some models may output the reasoning content, like `DeepSeek-R1`. Some others, like `o1`, only outputs the output piece of the completions.

[](#prerequisites)

## Prerequisites

To complete this tutorial, you need:

- An Azure subscription. If you're using [GitHub Models](https://docs.github.com/en/github-models/), you can upgrade your experience and create an Azure subscription in the process. Read [Upgrade from GitHub Models to Azure AI model inference](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-github-models) if that's your case.
    
- An Azure AI services resource. For more information, see [Create an Azure AI Services resource](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-create-resources).
    
- The endpoint URL and key.
    
    [![Screenshot showing how to get the URL and key associated with the resource.](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png)](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png#lightbox)
    

- A model with reasoning capabilities model deployment. If you don't have one read [Add and configure models to Azure AI services](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/create-model-deployments) to add a reasoning model.
    
    - This examples use `DeepSeek-R1`.
- Install the [Azure AI inference package](https://aka.ms/azsdk/azure-ai-inference/python/reference) with the following command:
    
    ```
    pip install -U azure-ai-inference
    ```
    

[](#use-reasoning-capabilities-with-chat)

## Use reasoning capabilities with chat

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

```
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint="https://<resource>.services.ai.azure.com/models",
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"]),
    model="deepseek-r1"
)
```

Tip

Verify that you have deployed the model to Azure AI Services resource with the Azure AI model inference API. `Deepseek-R1` is also available as Serverless API Endpoints. However, those endpoints don't take the parameter `model` as explained in this tutorial. You can verify that by going to Azure AI Foundry portal > Models + endpoints, and verify that the model is listed under the section **Azure AI Services**.

If you have configured the resource to with **Microsoft Entra ID** support, you can use the following code snippet to create a client.

```
import os
from azure.ai.inference import ChatCompletionsClient
from azure.identity import DefaultAzureCredential

client = ChatCompletionsClient(
    endpoint="https://<resource>.services.ai.azure.com/models",
    credential=DefaultAzureCredential(),
    credential_scopes=["https://cognitiveservices.azure.com/.default"],
    model="deepseek-r1"
)
```

[](#create-a-chat-completion-request)

### Create a chat completion request

The following example shows how you can create a basic chat request to the model.

```
from azure.ai.inference.models import SystemMessage, UserMessage

response = client.complete(
    messages=[
        UserMessage(content="How many languages are in the world?"),
    ],
)
```

When building prompts for reasoning models, take the following into consideration:

- Use simple instructions and avoid using chain-of-thought techniques.
- Built-in reasoning capabilities make simple zero-shot prompts as effective as more complex methods.
- When providing additional context or documents, like in RAG scenarios, including only the most relevant information may help preventing the model from over-complicating its response.
- Reasoning models may support the use of system messages. However, they may not follow them as strictly as other non-reasoning models.
- When creating multi-turn applications, consider only appending the final answer from the model, without it's reasoning content as explained at [Reasoning content](#reasoning-content) section.

The response is as follows, where you can see the model's usage statistics:

```
print("Response:", response.choices[0].message.content)
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
```

```
Response: <think>Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer...</think>As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: deepseek-r1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

[](#reasoning-content)

### Reasoning content

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. You can extract the reasoning content from the response to understand the model's thought process as follows:

```
import re

match = re.match(r"<think>(.*?)</think>(.*)", response.choices[0].message.content, re.DOTALL)

print("Response:", )
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

```
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

When making multi-turn conversations, it's useful to avoid sending the reasoning content in the chat history as reasoning tends to generate long explanations.

[](#stream-content)

### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

To stream completions, set `stream=True` when you call the model.

```
result = client.complete(
    model="deepseek-r1",
    messages=[
        UserMessage(content="How many languages are in the world?"),
    ],
    max_tokens=2048,
    stream=True,
)
```

To visualize the output, define a helper function to print the stream. The following example implements a routing that stream only the answer without the reasoning content:

```
def print_stream(result):
    """
    Prints the chat completion with streaming.
    """
    is_thinking = False
    for event in completion:
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
```

You can visualize how streaming generates content:

```
print_stream(result)
```

[](#parameters)

### Parameters

In general, reasoning models don't support the following parameters you can find in chat completion models:

- Temperature
- Presence penalty
- Repetition penalty
- Parameter `top_p`

Some models support the use of tools or structured outputs (including JSON-schemas). Read the [Models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models) details page to understand each model's support.

[](#apply-content-safety)

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.

```
from azure.ai.inference.models import AssistantMessage, UserMessage

try:
    response = client.complete(
        model="deepseek-r1",
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

Important

Items marked (preview) in this article are currently in public preview. This preview is provided without a service-level agreement, and we don't recommend it for production workloads. Certain features might not be supported or might have constrained capabilities. For more information, see [Supplemental Terms of Use for Microsoft Azure Previews](https://azure.microsoft.com/support/legal/preview-supplemental-terms/).

This article explains how to use the reasoning capabilities of chat completions models deployed to Azure AI model inference in Azure AI services.

[](#reasoning-models)

## Reasoning models

Reasoning models can reach higher levels of performance in domains like math, coding, science, strategy, and logistics. The way these models produces outputs is by explicitly using chain of thought to explore all possible paths before generating an answer. They verify their answers as they produce them which helps them to arrive to better more accurate conclusions. This means that reasoning models may require less context in prompting in order to produce effective results.

Such way of scaling model's performance is referred as _inference compute time_ as it trades performance against higher latency and cost. It contrasts to other approaches that scale through _training compute time_.

Reasoning models then produce two types of outputs:

- Reasoning completions
- Output completions

Both of these completions count towards content generated from the model and hence, towards the token limits and costs associated with the model. Some models may output the reasoning content, like `DeepSeek-R1`. Some others, like `o1`, only outputs the output piece of the completions.

[](#prerequisites)

## Prerequisites

To complete this tutorial, you need:

- An Azure subscription. If you're using [GitHub Models](https://docs.github.com/en/github-models/), you can upgrade your experience and create an Azure subscription in the process. Read [Upgrade from GitHub Models to Azure AI model inference](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-github-models) if that's your case.
    
- An Azure AI services resource. For more information, see [Create an Azure AI Services resource](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-create-resources).
    
- The endpoint URL and key.
    
    [![Screenshot showing how to get the URL and key associated with the resource.](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png)](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png#lightbox)
    

- A model with reasoning capabilities model deployment. If you don't have one read [Add and configure models to Azure AI services](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/create-model-deployments) to add a reasoning model.
    
    - This examples use `DeepSeek-R1`.
- Install the [Azure Inference library for JavaScript](https://aka.ms/azsdk/azure-ai-inference/javascript/reference) with the following command:
    
    ```
    npm install @azure-rest/ai-inference
    ```
    

[](#use-reasoning-capabilities-with-chat)

## Use reasoning capabilities with chat

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

```
import ModelClient from "@azure-rest/ai-inference";
import { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = new ModelClient(
    process.env.AZURE_INFERENCE_ENDPOINT, 
    new AzureKeyCredential(process.env.AZURE_INFERENCE_CREDENTIAL)
);
```

Tip

Verify that you have deployed the model to Azure AI Services resource with the Azure AI model inference API. `Deepseek-R1` is also available as Serverless API Endpoints. However, those endpoints don't take the parameter `model` as explained in this tutorial. You can verify that by going to Azure AI Foundry portal > Models + endpoints, and verify that the model is listed under the section **Azure AI Services**.

If you have configured the resource to with **Microsoft Entra ID** support, you can use the following code snippet to create a client.

```
import ModelClient from "@azure-rest/ai-inference";
import { isUnexpected } from "@azure-rest/ai-inference";
import { DefaultAzureCredential } from "@azure/identity";

const clientOptions = { credentials: { "https://cognitiveservices.azure.com" } };

const client = new ModelClient(
    "https://<resource>.services.ai.azure.com/models", 
    new DefaultAzureCredential(),
    clientOptions,
);
```

[](#create-a-chat-completion-request)

### Create a chat completion request

The following example shows how you can create a basic chat request to the model.

```
var messages = [
    { role: "user", content: "How many languages are in the world?" },
];

var response = await client.path("/chat/completions").post({
    body: {
        model: "DeepSeek-R1",
        messages: messages,
    }
});
```

When building prompts for reasoning models, take the following into consideration:

- Use simple instructions and avoid using chain-of-thought techniques.
- Built-in reasoning capabilities make simple zero-shot prompts as effective as more complex methods.
- When providing additional context or documents, like in RAG scenarios, including only the most relevant information may help preventing the model from over-complicating its response.
- Reasoning models may support the use of system messages. However, they may not follow them as strictly as other non-reasoning models.
- When creating multi-turn applications, consider only appending the final answer from the model, without it's reasoning content as explained at [Reasoning content](#reasoning-content) section.

The response is as follows, where you can see the model's usage statistics:

```
if (isUnexpected(response)) {
    throw response.body.error;
}

console.log("Response: ", response.body.choices[0].message.content);
console.log("Model: ", response.body.model);
console.log("Usage:");
console.log("\tPrompt tokens:", response.body.usage.prompt_tokens);
console.log("\tTotal tokens:", response.body.usage.total_tokens);
console.log("\tCompletion tokens:", response.body.usage.completion_tokens);
```

```
Response: <think>Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer...</think>As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: deepseek-r1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

[](#reasoning-content)

### Reasoning content

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. You can extract the reasoning content from the response to understand the model's thought process as follows:

```
var content = response.body.choices[0].message.content
var match = content.match(/<think>(.*?)<\/think>(.*)/s);

console.log("Response:");
if (match) {
    console.log("\tThinking:", match[1]);
    console.log("\Answer:", match[2]);
}
else {
    console.log("Response:", content);
}
console.log("Model: ", response.body.model);
console.log("Usage:");
console.log("\tPrompt tokens:", response.body.usage.prompt_tokens);
console.log("\tTotal tokens:", response.body.usage.total_tokens);
console.log("\tCompletion tokens:", response.body.usage.completion_tokens);
```

```
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

When making multi-turn conversations, it's useful to avoid sending the reasoning content in the chat history as reasoning tends to generate long explanations.

[](#stream-content)

### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

To stream completions, set `stream=True` when you call the model.

```
var messages = [
    { role: "user", content: "How many languages are in the world?" },
];

var response = await client.path("/chat/completions").post({
    body: {
        model: "DeepSeek-R1",
        messages: messages,
    }
}).asNodeStream();
```

To visualize the output, define a helper function to print the stream. The following example implements a routing that stream only the answer without the reasoning content:

```
function printStream(sses) {
    let isThinking = false;
    
    for await (const event of sses) {
        if (event.data === "[DONE]") {
            return;
        }
        for (const choice of (JSON.parse(event.data)).choices) {
            const content = choice.delta?.content ?? "";
            
            if (content === "<think>") {
                isThinking = true;
                process.stdout.write("🧠 Thinking...");
            } else if (content === "</think>") {
                isThinking = false;
                console.log("🛑\n\n");
            } else if (content) {
                process.stdout.write(content);
            }
        }
    }
}
```

You can visualize how streaming generates content:

```
var sses = createSseStream(response.body);
printStream(result)
```

[](#parameters)

### Parameters

In general, reasoning models don't support the following parameters you can find in chat completion models:

- Temperature
- Presence penalty
- Repetition penalty
- Parameter `top_p`

Some models support the use of tools or structured outputs (including JSON-schemas). Read the [Models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models) details page to understand each model's support.

[](#apply-content-safety)

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.

```
try {
    var messages = [
        { role: "system", content: "You are an AI assistant that helps people find information." },
        { role: "user", content: "Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills." },
    ];

    var response = await client.path("/chat/completions").post({
        model: "DeepSeek-R1",
        body: {
            messages: messages,
        }
    });

    console.log(response.body.choices[0].message.content);
}
catch (error) {
    if (error.status_code == 400) {
        var response = JSON.parse(error.response._content);
        if (response.error) {
            console.log(`Your request triggered an ${response.error.code} error:\n\t ${response.error.message}`);
        }
        else
        {
            throw error;
        }
    }
}
```

Important

Items marked (preview) in this article are currently in public preview. This preview is provided without a service-level agreement, and we don't recommend it for production workloads. Certain features might not be supported or might have constrained capabilities. For more information, see [Supplemental Terms of Use for Microsoft Azure Previews](https://azure.microsoft.com/support/legal/preview-supplemental-terms/).

This article explains how to use the reasoning capabilities of chat completions models deployed to Azure AI model inference in Azure AI services.

[](#reasoning-models)

## Reasoning models

Reasoning models can reach higher levels of performance in domains like math, coding, science, strategy, and logistics. The way these models produces outputs is by explicitly using chain of thought to explore all possible paths before generating an answer. They verify their answers as they produce them which helps them to arrive to better more accurate conclusions. This means that reasoning models may require less context in prompting in order to produce effective results.

Such way of scaling model's performance is referred as _inference compute time_ as it trades performance against higher latency and cost. It contrasts to other approaches that scale through _training compute time_.

Reasoning models then produce two types of outputs:

- Reasoning completions
- Output completions

Both of these completions count towards content generated from the model and hence, towards the token limits and costs associated with the model. Some models may output the reasoning content, like `DeepSeek-R1`. Some others, like `o1`, only outputs the output piece of the completions.

[](#prerequisites)

## Prerequisites

To complete this tutorial, you need:

- An Azure subscription. If you're using [GitHub Models](https://docs.github.com/en/github-models/), you can upgrade your experience and create an Azure subscription in the process. Read [Upgrade from GitHub Models to Azure AI model inference](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-github-models) if that's your case.
    
- An Azure AI services resource. For more information, see [Create an Azure AI Services resource](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-create-resources).
    
- The endpoint URL and key.
    
    [![Screenshot showing how to get the URL and key associated with the resource.](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png)](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png#lightbox)
    

- A model with reasoning capabilities model deployment. If you don't have one read [Add and configure models to Azure AI services](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/create-model-deployments) to add a reasoning model.
    
    - This examples use `DeepSeek-R1`.
- Add the [Azure AI inference package](https://aka.ms/azsdk/azure-ai-inference/java/reference) to your project:
    
    ```
    <dependency>
        <groupId>com.azure</groupId>
        <artifactId>azure-ai-inference</artifactId>
        <version>1.0.0-beta.2</version>
    </dependency>
    ```
    
- If you are using Entra ID, you also need the following package:
    
    ```
    <dependency>
        <groupId>com.azure</groupId>
        <artifactId>azure-identity</artifactId>
        <version>1.13.3</version>
    </dependency>
    ```
    
- Import the following namespace:
    
    ```
    package com.azure.ai.inference.usage;
    
    import com.azure.ai.inference.EmbeddingsClient;
    import com.azure.ai.inference.EmbeddingsClientBuilder;
    import com.azure.ai.inference.models.EmbeddingsResult;
    import com.azure.ai.inference.models.EmbeddingItem;
    import com.azure.core.credential.AzureKeyCredential;
    import com.azure.core.util.Configuration;
    
    import java.util.ArrayList;
    import java.util.List;
    ```
    

[](#use-reasoning-capabilities-with-chat)

## Use reasoning capabilities with chat

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

```
ChatCompletionsClient client = new ChatCompletionsClient(
        new URI("https://<resource>.services.ai.azure.com/models"),
        new AzureKeyCredential(System.getProperty("AZURE_INFERENCE_CREDENTIAL")),
```

Tip

Verify that you have deployed the model to Azure AI Services resource with the Azure AI model inference API. `Deepseek-R1` is also available as Serverless API Endpoints. However, those endpoints don't take the parameter `model` as explained in this tutorial. You can verify that by going to Azure AI Foundry portal > Models + endpoints, and verify that the model is listed under the section **Azure AI Services**.

If you have configured the resource to with **Microsoft Entra ID** support, you can use the following code snippet to create a client.

```
client = new ChatCompletionsClient(
        new URI("https://<resource>.services.ai.azure.com/models"),
        new DefaultAzureCredentialBuilder().build()
);
```

[](#create-a-chat-completion-request)

### Create a chat completion request

The following example shows how you can create a basic chat request to the model.

```
ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
        .setModel("DeepSeek-R1")
        .setMessages(Arrays.asList(
                new ChatRequestUserMessage("How many languages are in the world?")
        ));

Response<ChatCompletions> response = client.complete(requestOptions);
```

When building prompts for reasoning models, take the following into consideration:

- Use simple instructions and avoid using chain-of-thought techniques.
- Built-in reasoning capabilities make simple zero-shot prompts as effective as more complex methods.
- When providing additional context or documents, like in RAG scenarios, including only the most relevant information may help preventing the model from over-complicating its response.
- Reasoning models may support the use of system messages. However, they may not follow them as strictly as other non-reasoning models.
- When creating multi-turn applications, consider only appending the final answer from the model, without it's reasoning content as explained at [Reasoning content](#reasoning-content) section.

The response is as follows, where you can see the model's usage statistics:

```
System.out.println("Response: " + response.getValue().getChoices().get(0).getMessage().getContent());
System.out.println("Model: " + response.getValue().getModel());
System.out.println("Usage:");
System.out.println("\tPrompt tokens: " + response.getValue().getUsage().getPromptTokens());
System.out.println("\tTotal tokens: " + response.getValue().getUsage().getTotalTokens());
System.out.println("\tCompletion tokens: " + response.getValue().getUsage().getCompletionTokens());
```

```
Response: <think>Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate...</think>The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: deepseek-r1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

[](#reasoning-content)

### Reasoning content

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. You can extract the reasoning content from the response to understand the model's thought process as follows:

```
String content = response.getValue().getChoices().get(0).getMessage().getContent()
Pattern pattern = Pattern.compile("<think>(.*?)</think>(.*)", Pattern.DOTALL);
Matcher matcher = pattern.matcher(content);

System.out.println("Response:");
if (matcher.find()) {
    System.out.println("\tThinking: " + matcher.group(1));
    System.out.println("\tAnswer: " + matcher.group(2));
}
else {
    System.out.println("Response: " + content);
}
System.out.println("Model: " + response.getValue().getModel());
System.out.println("Usage:");
System.out.println("\tPrompt tokens: " + response.getValue().getUsage().getPromptTokens());
System.out.println("\tTotal tokens: " + response.getValue().getUsage().getTotalTokens());
System.out.println("\tCompletion tokens: " + response.getValue().getUsage().getCompletionTokens());
```

```
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

When making multi-turn conversations, it's useful to avoid sending the reasoning content in the chat history as reasoning tends to generate long explanations.

[](#stream-content)

### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

```
ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
        .setModel("DeepSeek-R1")
        .setMessages(Arrays.asList(
                new ChatRequestUserMessage("How many languages are in the world? Write an essay about it.")
        ))
        .setMaxTokens(4096);

return client.completeStreamingAsync(requestOptions).thenAcceptAsync(response -> {
    try {
        printStream(response);
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
});
```

To visualize the output, define a helper function to print the stream. The following example implements a routing that stream only the answer without the reasoning content:

```
public void printStream(StreamingResponse<StreamingChatCompletionsUpdate> response) throws Exception {
    boolean isThinking = false;

    for (StreamingChatCompletionsUpdate chatUpdate : response) {
       if (chatUpdate.getContentUpdate() != null && !chatUpdate.getContentUpdate().isEmpty()) {
            String content = chatUpdate.getContentUpdate();

            if ("<think>".equals(content)) {
                isThinking = true;
                System.out.print("🧠 Thinking...");
                System.out.flush();
            } else if ("</think>".equals(content)) {
                isThinking = false;
                System.out.println("🛑\n\n");
            } else if (content != null && !content.isEmpty()) {
                System.out.print(content);
                System.out.flush();
            }
        }
    }
}
```

You can visualize how streaming generates content:

```
try {
    streamMessageAsync(client).get();
} catch (Exception e) {
    throw new RuntimeException(e);
}
```

[](#parameters)

### Parameters

In general, reasoning models don't support the following parameters you can find in chat completion models:

- Temperature
- Presence penalty
- Repetition penalty
- Parameter `top_p`

Some models support the use of tools or structured outputs (including JSON-schemas). Read the [Models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models) details page to understand each model's support.

Important

Items marked (preview) in this article are currently in public preview. This preview is provided without a service-level agreement, and we don't recommend it for production workloads. Certain features might not be supported or might have constrained capabilities. For more information, see [Supplemental Terms of Use for Microsoft Azure Previews](https://azure.microsoft.com/support/legal/preview-supplemental-terms/).

This article explains how to use the reasoning capabilities of chat completions models deployed to Azure AI model inference in Azure AI services.

[](#reasoning-models)

## Reasoning models

Reasoning models can reach higher levels of performance in domains like math, coding, science, strategy, and logistics. The way these models produces outputs is by explicitly using chain of thought to explore all possible paths before generating an answer. They verify their answers as they produce them which helps them to arrive to better more accurate conclusions. This means that reasoning models may require less context in prompting in order to produce effective results.

Such way of scaling model's performance is referred as _inference compute time_ as it trades performance against higher latency and cost. It contrasts to other approaches that scale through _training compute time_.

Reasoning models then produce two types of outputs:

- Reasoning completions
- Output completions

Both of these completions count towards content generated from the model and hence, towards the token limits and costs associated with the model. Some models may output the reasoning content, like `DeepSeek-R1`. Some others, like `o1`, only outputs the output piece of the completions.

[](#prerequisites)

## Prerequisites

To complete this tutorial, you need:

- An Azure subscription. If you're using [GitHub Models](https://docs.github.com/en/github-models/), you can upgrade your experience and create an Azure subscription in the process. Read [Upgrade from GitHub Models to Azure AI model inference](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-github-models) if that's your case.
    
- An Azure AI services resource. For more information, see [Create an Azure AI Services resource](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-create-resources).
    
- The endpoint URL and key.
    
    [![Screenshot showing how to get the URL and key associated with the resource.](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png)](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png#lightbox)
    

- A model with reasoning capabilities model deployment. If you don't have one read [Add and configure models to Azure AI services](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/create-model-deployments) to add a reasoning model.
    
    - This example uses `DeepSeek-R1`.
- Install the Azure AI inference package with the following command:
    
    ```
    dotnet add package Azure.AI.Inference --prerelease
    ```
    
- If you are using Entra ID, you also need the following package:
    
    ```
    dotnet add package Azure.Identity
    ```
    

[](#use-reasoning-capabilities-with-chat)

## Use reasoning capabilities with chat

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

```
ChatCompletionsClient client = new ChatCompletionsClient(
    new Uri("https://<resource>.services.ai.azure.com/models"),
    new AzureKeyCredential(Environment.GetEnvironmentVariable("AZURE_INFERENCE_CREDENTIAL"))
);
```

Tip

Verify that you have deployed the model to Azure AI Services resource with the Azure AI model inference API. `Deepseek-R1` is also available as Serverless API Endpoints. However, those endpoints don't take the parameter `model` as explained in this tutorial. You can verify that by going to Azure AI Foundry portal > Models + endpoints, and verify that the model is listed under the section **Azure AI Services**.

If you have configured the resource to with **Microsoft Entra ID** support, you can use the following code snippet to create a client.

```
TokenCredential credential = new DefaultAzureCredential(includeInteractiveCredentials: true);
AzureAIInferenceClientOptions clientOptions = new AzureAIInferenceClientOptions();
BearerTokenAuthenticationPolicy tokenPolicy = new BearerTokenAuthenticationPolicy(credential, new string[] { "https://cognitiveservices.azure.com/.default" });

clientOptions.AddPolicy(tokenPolicy, HttpPipelinePosition.PerRetry);

client = new ChatCompletionsClient(
    new Uri("https://<resource>.services.ai.azure.com/models"),
    credential,
    clientOptions,
);
```

[](#create-a-chat-completion-request)

### Create a chat completion request

The following example shows how you can create a basic chat request to the model.

```
ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
{
    Messages = {
        new ChatRequestUserMessage("How many languages are in the world?")
    },
    Model = "deepseek-r1",
};

Response<ChatCompletions> response = client.Complete(requestOptions);
```

When building prompts for reasoning models, take the following into consideration:

- Use simple instructions and avoid using chain-of-thought techniques.
- Built-in reasoning capabilities make simple zero-shot prompts as effective as more complex methods.
- When providing additional context or documents, like in RAG scenarios, including only the most relevant information may help preventing the model from over-complicating its response.
- Reasoning models may support the use of system messages. However, they may not follow them as strictly as other non-reasoning models.
- When creating multi-turn applications, consider only appending the final answer from the model, without it's reasoning content as explained at [Reasoning content](#reasoning-content) section.

The response is as follows, where you can see the model's usage statistics:

```
Console.WriteLine($"Response: {response.Value.Content}");
Console.WriteLine($"Model: {response.Value.Model}");
Console.WriteLine("Usage:");
Console.WriteLine($"\tPrompt tokens: {response.Value.Usage.PromptTokens}");
Console.WriteLine($"\tTotal tokens: {response.Value.Usage.TotalTokens}");
Console.WriteLine($"\tCompletion tokens: {response.Value.Usage.CompletionTokens}");
```

```
Response: <think>Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate...</think>The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: deepseek-r1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

[](#reasoning-content)

### Reasoning content

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. You can extract the reasoning content from the response to understand the model's thought process as follows:

```
Regex regex = new Regex(pattern, RegexOptions.Singleline);
Match match = regex.Match(response.Value.Content);

Console.WriteLine("Response:");
if (match.Success)
{
    Console.WriteLine($"\tThinking: {match.Groups[1].Value}");
    Console.WriteLine($"\tAnswer: {match.Groups[2].Value}");
else
{
    Console.WriteLine($"Response: {response.Value.Content}");
}
Console.WriteLine($"Model: {response.Value.Model}");
Console.WriteLine("Usage:");
Console.WriteLine($"\tPrompt tokens: {response.Value.Usage.PromptTokens}");
Console.WriteLine($"\tTotal tokens: {response.Value.Usage.TotalTokens}");
Console.WriteLine($"\tCompletion tokens: {response.Value.Usage.CompletionTokens}");
```

```
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

When making multi-turn conversations, it's useful to avoid sending the reasoning content in the chat history as reasoning tends to generate long explanations.

[](#stream-content)

### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

```
static async Task StreamMessageAsync(ChatCompletionsClient client)
{
    ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
    {
        Messages = {
            new ChatRequestUserMessage("How many languages are in the world?")
        },
        MaxTokens=4096,
        Model = "deepseek-r1",
    };

    StreamingResponse<StreamingChatCompletionsUpdate> streamResponse = await client.CompleteStreamingAsync(requestOptions);

    await PrintStream(streamResponse);
}
```

To visualize the output, define a helper function to print the stream. The following example implements a routing that stream only the answer without the reasoning content:

```
static void PrintStream(StreamingResponse<StreamingChatCompletionsUpdate> response)
{
    bool isThinking = false;
    await foreach (StreamingChatCompletionsUpdate chatUpdate in response)
    {
        if (!string.IsNullOrEmpty(chatUpdate.ContentUpdate))
        {
            string content = chatUpdate.ContentUpdate;
            if (content == "<think>")
            {
                isThinking = true;
                Console.Write("🧠 Thinking...");
                Console.Out.Flush();
            }
            else if (content == "</think>")
            {
                isThinking = false;
                Console.WriteLine("🛑\n\n");
            }
            else if (!string.IsNullOrEmpty(content))
            {
                Console.Write(content);
                Console.Out.Flush();
            }
        }
    }
}
```

You can visualize how streaming generates content:

```
StreamMessageAsync(client).GetAwaiter().GetResult();
```

[](#parameters)

### Parameters

In general, reasoning models don't support the following parameters you can find in chat completion models:

- Temperature
- Presence penalty
- Repetition penalty
- Parameter `top_p`

Some models support the use of tools or structured outputs (including JSON-schemas). Read the [Models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models) details page to understand each model's support.

[](#apply-content-safety)

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.

```
try
{
    requestOptions = new ChatCompletionsOptions()
    {
        Messages = {
            new ChatRequestSystemMessage("You are an AI assistant that helps people find information."),
            new ChatRequestUserMessage(
                "Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."
            ),
        },
        Model = "deepseek-r1",
    };

    response = client.Complete(requestOptions);
    Console.WriteLine(response.Value.Content);
}
catch (RequestFailedException ex)
{
    if (ex.ErrorCode == "content_filter")
    {
        Console.WriteLine($"Your query has trigger Azure Content Safety: {ex.Message}");
    }
    else
    {
        throw;
    }
}
```

Important

Items marked (preview) in this article are currently in public preview. This preview is provided without a service-level agreement, and we don't recommend it for production workloads. Certain features might not be supported or might have constrained capabilities. For more information, see [Supplemental Terms of Use for Microsoft Azure Previews](https://azure.microsoft.com/support/legal/preview-supplemental-terms/).

This article explains how to use the reasoning capabilities of chat completions models deployed to Azure AI model inference in Azure AI services.

[](#reasoning-models)

## Reasoning models

Reasoning models can reach higher levels of performance in domains like math, coding, science, strategy, and logistics. The way these models produces outputs is by explicitly using chain of thought to explore all possible paths before generating an answer. They verify their answers as they produce them which helps them to arrive to better more accurate conclusions. This means that reasoning models may require less context in prompting in order to produce effective results.

Such way of scaling model's performance is referred as _inference compute time_ as it trades performance against higher latency and cost. It contrasts to other approaches that scale through _training compute time_.

Reasoning models then produce two types of outputs:

- Reasoning completions
- Output completions

Both of these completions count towards content generated from the model and hence, towards the token limits and costs associated with the model. Some models may output the reasoning content, like `DeepSeek-R1`. Some others, like `o1`, only outputs the output piece of the completions.

[](#prerequisites)

## Prerequisites

To complete this tutorial, you need:

- An Azure subscription. If you're using [GitHub Models](https://docs.github.com/en/github-models/), you can upgrade your experience and create an Azure subscription in the process. Read [Upgrade from GitHub Models to Azure AI model inference](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-github-models) if that's your case.
    
- An Azure AI services resource. For more information, see [Create an Azure AI Services resource](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/quickstart-create-resources).
    
- The endpoint URL and key.
    
    [![Screenshot showing how to get the URL and key associated with the resource.](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png)](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/media/overview/overview-endpoint-and-key.png#lightbox)
    

- A model with reasoning capabilities model deployment. If you don't have one read [Add and configure models to Azure AI services](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/create-model-deployments) to add a reasoning model.
    
    - This examples use `DeepSeek-R1`.

[](#use-reasoning-capabilities-with-chat)

## Use reasoning capabilities with chat

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

```
POST https://<resource>.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview
Content-Type: application/json
api-key: <key>
```

Tip

Verify that you have deployed the model to Azure AI Services resource with the Azure AI model inference API. `Deepseek-R1` is also available as Serverless API Endpoints. However, those endpoints don't take the parameter `model` as explained in this tutorial. You can verify that by going to Azure AI Foundry portal > Models + endpoints, and verify that the model is listed under the section **Azure AI Services**.

If you have configured the resource with **Microsoft Entra ID** support, pass you token in the `Authorization` header:

```
POST https://<resource>.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview
Content-Type: application/json
Authorization: Bearer <token>
```

[](#create-a-chat-completion-request)

### Create a chat completion request

The following example shows how you can create a basic chat request to the model.

```
{
    "model": "deepseek-r1",
    "messages": [
        {
            "role": "user",
            "content": "How many languages are in the world?"
        }
    ]
}
```

When building prompts for reasoning models, take the following into consideration:

- Use simple instructions and avoid using chain-of-thought techniques.
- Built-in reasoning capabilities make simple zero-shot prompts as effective as more complex methods.
- When providing additional context or documents, like in RAG scenarios, including only the most relevant information may help preventing the model from over-complicating its response.
- Reasoning models may support the use of system messages. However, they may not follow them as strictly as other non-reasoning models.
- When creating multi-turn applications, consider only appending the final answer from the model, without it's reasoning content as explained at [Reasoning content](#reasoning-content) section.

The response is as follows, where you can see the model's usage statistics:

```
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
                "content": "<think>\nOkay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.\n</think>\n\nThe exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.",
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

[](#reasoning-content)

### Reasoning content

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content.

When making multi-turn conversations, it's useful to avoid sending the reasoning content in the chat history as reasoning tends to generate long explanations.

[](#stream-content)

### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

To stream completions, set `"stream": true` when you call the model.

```
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

To visualize the output, define a helper function to print the stream. The following example implements a routing that stream only the answer without the reasoning content:

```
{
    "id": "23b54589eba14564ad8a2e6978775a39",
    "object": "chat.completion.chunk",
    "created": 1718726371,
    "model": "DeepSeek-R1",
    "choices": [
        {
            "index": 0,
            "delta": {
                "role": "assistant",
                "content": ""
            },
            "finish_reason": null,
            "logprobs": null
        }
    ]
}
```

The last message in the stream has `finish_reason` set, indicating the reason for the generation process to stop.

```
{
    "id": "23b54589eba14564ad8a2e6978775a39",
    "object": "chat.completion.chunk",
    "created": 1718726371,
    "model": "DeepSeek-R1",
    "choices": [
        {
            "index": 0,
            "delta": {
                "content": ""
            },
            "finish_reason": "stop",
            "logprobs": null
        }
    ],
    "usage": {
        "prompt_tokens": 11,
        "total_tokens": 897,
        "completion_tokens": 886
    }
}
```

[](#parameters)

### Parameters

In general, reasoning models don't support the following parameters you can find in chat completion models:

- Temperature
- Presence penalty
- Repetition penalty
- Parameter `top_p`

Some models support the use of tools or structured outputs (including JSON-schemas). Read the [Models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models) details page to understand each model's support.

[](#apply-content-safety)

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.

```
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

```
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

[](#related-content)

## Related content

- [Use embeddings models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/use-embeddings)
- [Use image embeddings models](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/use-image-embeddings)
- [Azure AI Model Inference API](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-api)

---

## Feedback

## Additional resources

---

Training

---

Documentation

- [Azure AI Model Inference API - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-api?source=recommendations)
    
    Learn about how to use the Azure AI Model Inference API
    
- [What is Azure AI model inference? - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/overview?source=recommendations)
    
    Apply advanced language models to variety of use cases with Azure AI model inference.
    
- [Model inference endpoint in Azure AI services - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/endpoints?source=recommendations)
    
    Learn about the model inference endpoint in Azure AI services
    
- [How to use the Azure AI model inference endpoint to consume models - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/inference?source=recommendations)
    
    Learn how to use the Azure AI model inference endpoint to consume models
    
- [How to use chat completions with Azure AI model inference - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/how-to/use-chat-completions?source=recommendations)
    
    Learn how to generate chat completions with Azure AI model inference
    
- [Azure AI Model Inference Chat Completions - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/reference/reference-model-inference-chat-completions?source=recommendations)
    
    Reference for Azure AI Model Inference Chat Completions API
    
- [How to use DeepSeek-R1 reasoning model with Azure AI Foundry - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-studio/how-to/deploy-models-deepseek?source=recommendations)
    
    Learn how to use DeepSeek-R1 reasoning model with Azure AI Foundry.
    
- [Models available in Azure AI model inference - Azure AI Foundry](https://learn.microsoft.com/en-us/azure/ai-foundry/model-inference/concepts/models?source=recommendations)
    
    Explore the models available via the Azure AI model inference and their capabilities.
    

### In this article