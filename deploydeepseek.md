In this article, you learn about DeepSeek-R1 and how to use them.
DeepSeek-R1 excels at reasoning tasks using a step-by-step training process, such as language, scientific reasoning, and coding tasks. It features 671B total parameters with 37B active parameters, and 128k context length.


## DeepSeek-R1

DeepSeek-R1 builds on the progress of earlier reasoning-focused models that improved performance by extending Chain-of-Thought (CoT) reasoning. DeepSeek-R1 takes things further by combining reinforcement learning (RL) with fine-tuning on carefully chosen datasets. It evolved from an earlier version, DeepSeek-R1-Zero, which relied solely on RL and showed strong reasoning skills but had issues like hard-to-read outputs and language inconsistencies. To address these limitations, DeepSeek-R1 incorporates a small amount of cold-start data and follows a refined training pipeline that blends reasoning-oriented RL with supervised fine-tuning on curated datasets, resulting in a model that achieves state-of-the-art performance on reasoning benchmarks.


You can learn more about the models in their respective model card:

* [DeepSeek-R1](https://aka.ms/azureai/landing/DeepSeek-R1)

## Prerequisites

To use DeepSeek-R1 with Azure AI Foundry, you need the following prerequisites:

### A model deployment

**Deployment to serverless APIs**

DeepSeek-R1 can be deployed to serverless API endpoints with pay-as-you-go billing. This kind of deployment provides a way to consume models as an API without hosting them on your subscription, while keeping the enterprise security and compliance that organizations need. 

Deployment to a serverless API endpoint doesn't require quota from your subscription. If your model isn't deployed already, use the Azure AI Studio, Azure Machine Learning SDK for Python, the Azure CLI, or ARM templates to [deploy the model as a serverless API](deploy-models-serverless.md).

> [!div class="nextstepaction"]
> [Deploy the model to serverless API endpoints](deploy-models-serverless.md)

### The inference package installed

You can consume predictions from this model by using the `azure-ai-inference` package with Python. To install this package, you need the following prerequisites:

* Python 3.8 or later installed, including pip.
* The endpoint URL. To construct the client library, you need to pass in the endpoint URL. The endpoint URL has the form `https://your-host-name.your-azure-region.inference.ai.azure.com`, where `your-host-name` is your unique model deployment host name and `your-azure-region` is the Azure region where the model is deployed (for example, eastus2).
* Depending on your model deployment and authentication preference, you need either a key to authenticate against the service, or Microsoft Entra ID credentials. The key is a 32-character string.
  
Once you have these prerequisites, install the Azure AI inference package with the following command:

```bash
pip install azure-ai-inference azure-core azure-identity openai
```

Read more about the [Azure AI inference package and reference](https://aka.ms/azsdk/azure-ai-inference/python/reference).

## Work with chat completions

In this section, you use the [Azure AI model inference API](https://aka.ms/azureai/modelinference) with a chat completions model for chat.

> [!TIP]
> The [Azure AI model inference API](https://aka.ms/azureai/modelinference) allows you to talk with most models deployed in Azure AI Foundry with the same code and structure, including DeepSeek-R1.

### Create a client to consume the model

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.


```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"]),
)
```

### Get the model's capabilities

The `/info` route returns information about the model that is deployed to the endpoint. Return the model's information by calling the following method:


```python
model_info = client.get_model_info()
```

The response is as follows:


```python
print("Model name:", model_info.model_name)
print("Model type:", model_info.model_type)
print("Model provider name:", model_info.model_provider_name)
```

```console
Model name: DeepSeek-R1
Model type: chat-completions
Model provider name: DeepSeek
```

### Create a chat completion request

The following example shows how you can create a basic chat completions request to the model.

```python
from azure.ai.inference.models import SystemMessage, UserMessage

response = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
)
```

The response is as follows, where you can see the model's usage statistics:


```python
print("Response:", response.choices[0].message.content)
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
```

```console
Response: As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 19
  Total tokens: 91
  Completion tokens: 72
```

Inspect the `usage` section in the response to see the number of tokens used for the prompt, the total number of tokens generated, and the number of tokens used for the completion.

#### Understanding reasoning

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. For example:


```python
response = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
)
```

You can extract the reasoning content from the response to understand the model's thought process as follows:


```python
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

```console
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

#### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.


```python
result = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
    temperature=0,
    top_p=1,
    max_tokens=2048,
    stream=True,
)
```

To stream completions, set `stream=True` when you call the model.

To visualize the output, define a helper function to print the stream.

```python
def print_stream(result):
    """
    Prints the chat completion with streaming.
    """
    for update in result:
        if update.choices:
            print(update.choices[0].delta.content, end="")
```

You can visualize how streaming generates content:


```python
print_stream(result)
```

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering (preview) system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.


```python
from azure.ai.inference.models import AssistantMessage, UserMessage, SystemMessage

try:
    response = client.complete(
        messages=[
            SystemMessage(content="You are an AI assistant that helps people find information."),
            UserMessage(content="Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."),
        ]
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

## DeepSeek-R1

DeepSeek-R1 builds on the progress of earlier reasoning-focused models that improved performance by extending Chain-of-Thought (CoT) reasoning. DeepSeek-R1 takes things further by combining reinforcement learning (RL) with fine-tuning on carefully chosen datasets. It evolved from an earlier version, DeepSeek-R1-Zero, which relied solely on RL and showed strong reasoning skills but had issues like hard-to-read outputs and language inconsistencies. To address these limitations, DeepSeek-R1 incorporates a small amount of cold-start data and follows a refined training pipeline that blends reasoning-oriented RL with supervised fine-tuning on curated datasets, resulting in a model that achieves state-of-the-art performance on reasoning benchmarks.


You can learn more about the models in their respective model card:

* [DeepSeek-R1](https://aka.ms/azureai/landing/DeepSeek-R1)


## Prerequisites

To use DeepSeek-R1 with Azure AI Foundry, you need the following prerequisites:

### A model deployment

**Deployment to serverless APIs**

DeepSeek-R1 can be deployed to serverless API endpoints with pay-as-you-go billing. This kind of deployment provides a way to consume models as an API without hosting them on your subscription, while keeping the enterprise security and compliance that organizations need. 

Deployment to a serverless API endpoint doesn't require quota from your subscription. If your model isn't deployed already, use the Azure AI Studio, Azure Machine Learning SDK for Python, the Azure CLI, or ARM templates to [deploy the model as a serverless API](deploy-models-serverless.md).

> [!div class="nextstepaction"]
> [Deploy the model to serverless API endpoints](deploy-models-serverless.md)

### The inference package installed

You can consume predictions from this model by using the `@azure-rest/ai-inference` package from `npm`. To install this package, you need the following prerequisites:

* LTS versions of `Node.js` with `npm`.
* The endpoint URL. To construct the client library, you need to pass in the endpoint URL. The endpoint URL has the form `https://your-host-name.your-azure-region.inference.ai.azure.com`, where `your-host-name` is your unique model deployment host name and `your-azure-region` is the Azure region where the model is deployed (for example, eastus2).
* Depending on your model deployment and authentication preference, you need either a key to authenticate against the service, or Microsoft Entra ID credentials. The key is a 32-character string.

Once you have these prerequisites, install the Azure Inference library for JavaScript with the following command:

```bash
npm install @azure-rest/ai-inference
```

## Work with chat completions

In this section, you use the [Azure AI model inference API](https://aka.ms/azureai/modelinference) with a chat completions model for chat.

> [!TIP]
> The [Azure AI model inference API](https://aka.ms/azureai/modelinference) allows you to talk with most models deployed in Azure AI Foundry with the same code and structure, including DeepSeek-R1.

### Create a client to consume the model

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.


```javascript
import ModelClient from "@azure-rest/ai-inference";
import { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = new ModelClient(
    process.env.AZURE_INFERENCE_ENDPOINT, 
    new AzureKeyCredential(process.env.AZURE_INFERENCE_CREDENTIAL)
);
```

### Get the model's capabilities

The `/info` route returns information about the model that is deployed to the endpoint. Return the model's information by calling the following method:


```javascript
var model_info = await client.path("/info").get()
```

The response is as follows:


```javascript
console.log("Model name: ", model_info.body.model_name)
console.log("Model type: ", model_info.body.model_type)
console.log("Model provider name: ", model_info.body.model_provider_name)
```

```console
Model name: DeepSeek-R1
Model type: chat-completions
Model provider name: DeepSeek
```

### Create a chat completion request

The following example shows how you can create a basic chat completions request to the model.

```javascript
var messages = [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "How many languages are in the world?" },
];

var response = await client.path("/chat/completions").post({
    body: {
        messages: messages,
    }
});
```

The response is as follows, where you can see the model's usage statistics:


```javascript
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

```console
Response: As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 19
  Total tokens: 91
  Completion tokens: 72
```

Inspect the `usage` section in the response to see the number of tokens used for the prompt, the total number of tokens generated, and the number of tokens used for the completion.

#### Understanding reasoning

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. For example:


```javascript
var messages = [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "How many languages are in the world?" },
];

var response = await client.path("/chat/completions").post({
    body: {
        messages: messages,
    }
});
```

You can extract the reasoning content from the response to understand the model's thought process as follows:


```javascript
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

```console
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

#### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.


```javascript
var messages = [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "How many languages are in the world?" },
];

var response = await client.path("/chat/completions").post({
    body: {
        messages: messages,
    }
}).asNodeStream();
```

To stream completions, use `.asNodeStream()` when you call the model.

You can visualize how streaming generates content:


```javascript
var stream = response.body;
if (!stream) {
    stream.destroy();
    throw new Error(`Failed to get chat completions with status: ${response.status}`);
}

if (response.status !== "200") {
    throw new Error(`Failed to get chat completions: ${response.body.error}`);
}

var sses = createSseStream(stream);

for await (const event of sses) {
    if (event.data === "[DONE]") {
        return;
    }
    for (const choice of (JSON.parse(event.data)).choices) {
        console.log(choice.delta?.content ?? "");
    }
}
```

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering (preview) system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.


```javascript
try {
    var messages = [
        { role: "system", content: "You are an AI assistant that helps people find information." },
        { role: "user", content: "Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills." },
    ];

    var response = await client.path("/chat/completions").post({
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

## DeepSeek-R1

DeepSeek-R1 builds on the progress of earlier reasoning-focused models that improved performance by extending Chain-of-Thought (CoT) reasoning. DeepSeek-R1 takes things further by combining reinforcement learning (RL) with fine-tuning on carefully chosen datasets. It evolved from an earlier version, DeepSeek-R1-Zero, which relied solely on RL and showed strong reasoning skills but had issues like hard-to-read outputs and language inconsistencies. To address these limitations, DeepSeek-R1 incorporates a small amount of cold-start data and follows a refined training pipeline that blends reasoning-oriented RL with supervised fine-tuning on curated datasets, resulting in a model that achieves state-of-the-art performance on reasoning benchmarks.


You can learn more about the models in their respective model card:

* [DeepSeek-R1](https://aka.ms/azureai/landing/DeepSeek-R1)


## Prerequisites

To use DeepSeek-R1 with Azure AI Foundry, you need the following prerequisites:

### A model deployment

**Deployment to serverless APIs**

DeepSeek-R1 can be deployed to serverless API endpoints with pay-as-you-go billing. This kind of deployment provides a way to consume models as an API without hosting them on your subscription, while keeping the enterprise security and compliance that organizations need. 

Deployment to a serverless API endpoint doesn't require quota from your subscription. If your model isn't deployed already, use the Azure AI Studio, Azure Machine Learning SDK for Python, the Azure CLI, or ARM templates to [deploy the model as a serverless API](deploy-models-serverless.md).

> [!div class="nextstepaction"]
> [Deploy the model to serverless API endpoints](deploy-models-serverless.md)

### The inference package installed

You can consume predictions from this model by using the `Azure.AI.Inference` package from [NuGet](https://www.nuget.org/). To install this package, you need the following prerequisites:

* The endpoint URL. To construct the client library, you need to pass in the endpoint URL. The endpoint URL has the form `https://your-host-name.your-azure-region.inference.ai.azure.com`, where `your-host-name` is your unique model deployment host name and `your-azure-region` is the Azure region where the model is deployed (for example, eastus2).
* Depending on your model deployment and authentication preference, you need either a key to authenticate against the service, or Microsoft Entra ID credentials. The key is a 32-character string.

Once you have these prerequisites, install the Azure AI inference library with the following command:

```dotnetcli
dotnet add package Azure.AI.Inference --prerelease
```

You can also authenticate with Microsoft Entra ID (formerly Azure Active Directory). To use credential providers provided with the Azure SDK, install the `Azure.Identity` package:

```dotnetcli
dotnet add package Azure.Identity
```

Import the following namespaces:


```csharp
using Azure;
using Azure.Identity;
using Azure.AI.Inference;
```

This example also uses the following namespaces but you may not always need them:


```csharp
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Reflection;
```

## Work with chat completions

In this section, you use the [Azure AI model inference API](https://aka.ms/azureai/modelinference) with a chat completions model for chat.

> [!TIP]
> The [Azure AI model inference API](https://aka.ms/azureai/modelinference) allows you to talk with most models deployed in Azure AI Foundry with the same code and structure, including DeepSeek-R1.

### Create a client to consume the model

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.


```csharp
ChatCompletionsClient client = new ChatCompletionsClient(
    new Uri(Environment.GetEnvironmentVariable("AZURE_INFERENCE_ENDPOINT")),
    new AzureKeyCredential(Environment.GetEnvironmentVariable("AZURE_INFERENCE_CREDENTIAL")),
    "DeepSeek-R1"
);
```

### Get the model's capabilities

The `/info` route returns information about the model that is deployed to the endpoint. Return the model's information by calling the following method:


```csharp
Response<ModelInfo> modelInfo = client.GetModelInfo();
```

The response is as follows:


```csharp
Console.WriteLine($"Model name: {modelInfo.Value.ModelName}");
Console.WriteLine($"Model type: {modelInfo.Value.ModelType}");
Console.WriteLine($"Model provider name: {modelInfo.Value.ModelProviderName}");
```

```console
Model name: DeepSeek-R1
Model type: chat-completions
Model provider name: DeepSeek
```

### Create a chat completion request

The following example shows how you can create a basic chat completions request to the model.

```csharp
ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
{
    Messages = {
        new ChatRequestSystemMessage("You are a helpful assistant."),
        new ChatRequestUserMessage("How many languages are in the world?")
    },
};

Response<ChatCompletions> response = client.Complete(requestOptions);
```

The response is as follows, where you can see the model's usage statistics:


```csharp
Console.WriteLine($"Response: {response.Value.Content}");
Console.WriteLine($"Model: {response.Value.Model}");
Console.WriteLine("Usage:");
Console.WriteLine($"\tPrompt tokens: {response.Value.Usage.PromptTokens}");
Console.WriteLine($"\tTotal tokens: {response.Value.Usage.TotalTokens}");
Console.WriteLine($"\tCompletion tokens: {response.Value.Usage.CompletionTokens}");
```

```console
Response: As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 19
  Total tokens: 91
  Completion tokens: 72
```

Inspect the `usage` section in the response to see the number of tokens used for the prompt, the total number of tokens generated, and the number of tokens used for the completion.

#### Understanding reasoning

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. For example:


```csharp
ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
{
    Messages = {
        new ChatRequestSystemMessage("You are a helpful assistant."),
        new ChatRequestUserMessage("How many languages are in the world?")
    },
};

Response<ChatCompletions> response = client.Complete(requestOptions);
```

You can extract the reasoning content from the response to understand the model's thought process as follows:


```csharp
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

```console
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

#### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.


```csharp
static async Task StreamMessageAsync(ChatCompletionsClient client)
{
    ChatCompletionsOptions requestOptions = new ChatCompletionsOptions()
    {
        Messages = {
            new ChatRequestSystemMessage("You are a helpful assistant."),
            new ChatRequestUserMessage("How many languages are in the world? Write an essay about it.")
        },
        MaxTokens=4096
    };

    StreamingResponse<StreamingChatCompletionsUpdate> streamResponse = await client.CompleteStreamingAsync(requestOptions);

    await PrintStream(streamResponse);
}
```

To stream completions, use `CompleteStreamingAsync` method when you call the model. Notice that in this example we the call is wrapped in an asynchronous method.

To visualize the output, define an asynchronous method to print the stream in the console.

```csharp
static async Task PrintStream(StreamingResponse<StreamingChatCompletionsUpdate> response)
{
    await foreach (StreamingChatCompletionsUpdate chatUpdate in response)
    {
        if (chatUpdate.Role.HasValue)
        {
            Console.Write($"{chatUpdate.Role.Value.ToString().ToUpperInvariant()}: ");
        }
        if (!string.IsNullOrEmpty(chatUpdate.ContentUpdate))
        {
            Console.Write(chatUpdate.ContentUpdate);
        }
    }
}
```

You can visualize how streaming generates content:


```csharp
StreamMessageAsync(client).GetAwaiter().GetResult();
```

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering (preview) system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.


```csharp
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


## DeepSeek-R1

DeepSeek-R1 builds on the progress of earlier reasoning-focused models that improved performance by extending Chain-of-Thought (CoT) reasoning. DeepSeek-R1 takes things further by combining reinforcement learning (RL) with fine-tuning on carefully chosen datasets. It evolved from an earlier version, DeepSeek-R1-Zero, which relied solely on RL and showed strong reasoning skills but had issues like hard-to-read outputs and language inconsistencies. To address these limitations, DeepSeek-R1 incorporates a small amount of cold-start data and follows a refined training pipeline that blends reasoning-oriented RL with supervised fine-tuning on curated datasets, resulting in a model that achieves state-of-the-art performance on reasoning benchmarks.


You can learn more about the models in their respective model card:

* [DeepSeek-R1](https://aka.ms/azureai/landing/DeepSeek-R1)


## Prerequisites

To use DeepSeek-R1 with Azure AI Foundry, you need the following prerequisites:

### A model deployment

**Deployment to serverless APIs**

DeepSeek-R1 can be deployed to serverless API endpoints with pay-as-you-go billing. This kind of deployment provides a way to consume models as an API without hosting them on your subscription, while keeping the enterprise security and compliance that organizations need. 

Deployment to a serverless API endpoint doesn't require quota from your subscription. If your model isn't deployed already, use the Azure AI Studio, Azure Machine Learning SDK for Python, the Azure CLI, or ARM templates to [deploy the model as a serverless API](deploy-models-serverless.md).

> [!div class="nextstepaction"]
> [Deploy the model to serverless API endpoints](deploy-models-serverless.md)

### A REST client

Models deployed with the [Azure AI model inference API](https://aka.ms/azureai/modelinference) can be consumed using any REST client. To use the REST client, you need the following prerequisites:

* To construct the requests, you need to pass in the endpoint URL. The endpoint URL has the form `https://your-host-name.your-azure-region.inference.ai.azure.com`, where `your-host-name`` is your unique model deployment host name and `your-azure-region`` is the Azure region where the model is deployed (for example, eastus2).
* Depending on your model deployment and authentication preference, you need either a key to authenticate against the service, or Microsoft Entra ID credentials. The key is a 32-character string.

## Work with chat completions

In this section, you use the [Azure AI model inference API](https://aka.ms/azureai/modelinference) with a chat completions model for chat.

> [!TIP]
> The [Azure AI model inference API](https://aka.ms/azureai/modelinference) allows you to talk with most models deployed in Azure AI Foundry with the same code and structure, including DeepSeek-R1.

### Create a client to consume the model

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

### Get the model's capabilities

The `/info` route returns information about the model that is deployed to the endpoint. Return the model's information by calling the following method:

```http
GET /info HTTP/1.1
Host: <ENDPOINT_URI>
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

The response is as follows:


```json
{
    "model_name": "DeepSeek-R1",
    "model_type": "chat-completions",
    "model_provider_name": "DeepSeek"
}
```

### Create a chat completion request

The following example shows how you can create a basic chat completions request to the model.

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
    ]
}
```

The response is as follows, where you can see the model's usage statistics:


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
                "content": "As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.",
                "tool_calls": null
            },
            "finish_reason": "stop",
            "logprobs": null
        }
    ],
    "usage": {
        "prompt_tokens": 19,
        "total_tokens": 91,
        "completion_tokens": 72
    }
}
```

Inspect the `usage` section in the response to see the number of tokens used for the prompt, the total number of tokens generated, and the number of tokens used for the completion.

#### Understanding reasoning

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. For example:


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
    ]
}
```

You can extract the reasoning content from the response to understand the model's thought process as follows:


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

#### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.


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
    "temperature": 0,
    "top_p": 1,
    "max_tokens": 2048
}
```

You can visualize how streaming generates content:


```json
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


```json
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
        "prompt_tokens": 19,
        "total_tokens": 91,
        "completion_tokens": 72
    }
}
```

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering (preview) system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.


```json
{
    "model": "DeepSeek-R1",
    "messages": [
        {
            "role": "system",
            "content": "You are an AI assistant that helps people find information."
        },
                {
            "role": "user",
            "content": "Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."
        }
    ]
}
```


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

## More inference examples

For more examples of how to use DeepSeek models, see the following examples and tutorials:

| Description                               | Language          | Sample                                                          |
|-------------------------------------------|-------------------|-----------------------------------------------------------------|
| Azure AI Inference package for Python     | Python            | [Link](https://aka.ms/azsdk/azure-ai-inference/python/samples)  |
| Azure AI Inference package for JavaScript | JavaScript        | [Link](https://aka.ms/azsdk/azure-ai-inference/javascript/samples)  |
| Azure AI Inference package for C#         | C#                | [Link](https://aka.ms/azsdk/azure-ai-inference/csharp/samples)  |
| Azure AI Inference package for Java       | Java              | [Link](https://github.com/Azure/azure-sdk-for-java/tree/main/sdk/ai/azure-ai-inference/src/samples)  |

## Cost and quota considerations for DeepSeek models deployed as serverless API endpoints

Quota is managed per deployment. Each deployment has a rate limit of 200,000 tokens per minute and 1,000 API requests per minute. However, we currently limit one deployment per model per project. Contact Microsoft Azure Support if the current rate limits aren't sufficient for your scenarios.

## Related content

* [Explore DeepSeek-related Azure samples in various languages](https://github.com/azure-samples/deepseek)
* [Azure AI Model Inference API](../reference/reference-model-inference-api.md)
* [Deploy models as serverless APIs](deploy-models-serverless.md)
* [Consume serverless API endpoints from a different Azure AI Studio project or hub](deploy-models-serverless-connect.md)
* [Region availability for models in serverless API endpoints](deploy-models-serverless-availability.md)
* [Plan and manage costs (marketplace)](costs-plan-manage.md#monitor-costs-for-models-offered-through-the-azure-marketplace)


---

## Prerequisites - How to Use Chat Completions with Azure AI Model Inference API


* A chat completions model deployment. If you don't have one read [Add and configure models to Azure AI services](../../how-to/create-model-deployments.md) to add a chat completions model to your resource.

* Install the [Azure AI inference package for Python](https://aka.ms/azsdk/azure-ai-inference/python/reference) with the following command:

  ```bash
  pip install -U azure-ai-inference
  ```
  
## Use chat completions

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.


```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"]),
    model="mistral-large-2407"
)
```

If you have configured the resource to with **Microsoft Entra ID** support, you can use the following code snippet to create a client.


```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.identity import DefaultAzureCredential

client = ChatCompletionsClient(
    endpoint=os.environ["AZURE_INFERENCE_ENDPOINT"],
    credential=DefaultAzureCredential(),
    model="mistral-large-2407"
)
```

### Create a chat completion request

The following example shows how you can create a basic chat completions request to the model.

```python
from azure.ai.inference.models import SystemMessage, UserMessage

response = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
)
```

> [!NOTE]
> Some models don't support system messages (`role="system"`). When you use the Azure AI model inference API, system messages are translated to user messages, which is the closest capability available. This translation is offered for convenience, but it's important for you to verify that the model is following the instructions in the system message with the right level of confidence.

The response is as follows, where you can see the model's usage statistics:


```python
print("Response:", response.choices[0].message.content)
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
```

```console
Response: As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: mistral-large-2407
Usage: 
  Prompt tokens: 19
  Total tokens: 91
  Completion tokens: 72
```

Inspect the `usage` section in the response to see the number of tokens used for the prompt, the total number of tokens generated, and the number of tokens used for the completion.

#### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

To stream completions, set `stream=True` when you call the model.


```python
result = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
    temperature=0,
    top_p=1,
    max_tokens=2048,
    stream=True,
)
```

To visualize the output, define a helper function to print the stream.

```python
def print_stream(result):
    """
    Prints the chat completion with streaming.
    """
    import time
    for update in result:
        if update.choices:
            print(update.choices[0].delta.content, end="")
```

You can visualize how streaming generates content:


```python
print_stream(result)
```

#### Explore more parameters supported by the inference client

Explore other parameters that you can specify in the inference client. For a full list of all the supported parameters and their corresponding documentation, see [Azure AI Model Inference API reference](https://aka.ms/azureai/modelinference).

```python
from azure.ai.inference.models import ChatCompletionsResponseFormatText

response = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
    presence_penalty=0.1,
    frequency_penalty=0.8,
    max_tokens=2048,
    temperature=0,
    top_p=1,
    response_format={ "type": ChatCompletionsResponseFormatText() },
)
```

Some models don't support JSON output formatting. You can always prompt the model to generate JSON outputs. However, such outputs are not guaranteed to be valid JSON.

If you want to pass a parameter that isn't in the list of supported parameters, you can pass it to the underlying model using *extra parameters*. See [Pass extra parameters to the model](#pass-extra-parameters-to-the-model).

#### Create JSON outputs

Some models can create JSON outputs. Set `response_format` to `json_object` to enable JSON mode and guarantee that the message the model generates is valid JSON. You must also instruct the model to produce JSON yourself via a system or user message. Also, the message content might be partially cut off if `finish_reason="length"`, which indicates that the generation exceeded `max_tokens` or that the conversation exceeded the max context length.


```python
from azure.ai.inference.models import ChatCompletionsResponseFormatJSON

response = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant that always generate responses in JSON format, using."
                      " the following format: { ""answer"": ""response"" }."),
        UserMessage(content="How many languages are in the world?"),
    ],
    response_format={ "type": ChatCompletionsResponseFormatJSON() }
)
```

### Pass extra parameters to the model

The Azure AI Model Inference API allows you to pass extra parameters to the model. The following code example shows how to pass the extra parameter `logprobs` to the model. 


```python
response = client.complete(
    messages=[
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="How many languages are in the world?"),
    ],
    model_extras={
        "logprobs": True
    }
)
```

Before you pass extra parameters to the Azure AI model inference API, make sure your model supports those extra parameters. When the request is made to the underlying model, the header `extra-parameters` is passed to the model with the value `pass-through`. This value tells the endpoint to pass the extra parameters to the model. Use of extra parameters with the model doesn't guarantee that the model can actually handle them. Read the model's documentation to understand which extra parameters are supported.

### Use tools

Some models support the use of tools, which can be an extraordinary resource when you need to offload specific tasks from the language model and instead rely on a more deterministic system or even a different language model. The Azure AI Model Inference API allows you to define tools in the following way.

The following code example creates a tool definition that is able to look from flight information from two different cities.


```python
from azure.ai.inference.models import FunctionDefinition, ChatCompletionsFunctionToolDefinition

flight_info = ChatCompletionsFunctionToolDefinition(
    function=FunctionDefinition(
        name="get_flight_info",
        description="Returns information about the next flight between two cities. This includes the name of the airline, flight number and the date and time of the next flight",
        parameters={
            "type": "object",
            "properties": {
                "origin_city": {
                    "type": "string",
                    "description": "The name of the city where the flight originates",
                },
                "destination_city": {
                    "type": "string",
                    "description": "The flight destination city",
                },
            },
            "required": ["origin_city", "destination_city"],
        },
    )
)

tools = [flight_info]
```

In this example, the function's output is that there are no flights available for the selected route, but the user should consider taking a train.


```python
def get_flight_info(loc_origin: str, loc_destination: str):
    return { 
        "info": f"There are no flights available from {loc_origin} to {loc_destination}. You should take a train, specially if it helps to reduce CO2 emissions."
    }
```

> [!NOTE]
> Cohere models require a tool's responses to be a valid JSON content formatted as a string. When constructing messages of type *Tool*, ensure the response is a valid JSON string.

Prompt the model to book flights with the help of this function:


```python
messages = [
    SystemMessage(
        content="You are a helpful assistant that help users to find information about traveling, how to get"
                " to places and the different transportations options. You care about the environment and you"
                " always have that in mind when answering inqueries.",
    ),
    UserMessage(
        content="When is the next flight from Miami to Seattle?",
    ),
]

response = client.complete(
    messages=messages, tools=tools, tool_choice="auto"
)
```

You can inspect the response to find out if a tool needs to be called. Inspect the finish reason to determine if the tool should be called. Remember that multiple tool types can be indicated. This example demonstrates a tool of type `function`.


```python
response_message = response.choices[0].message
tool_calls = response_message.tool_calls

print("Finish reason:", response.choices[0].finish_reason)
print("Tool call:", tool_calls)
```

To continue, append this message to the chat history:


```python
messages.append(
    response_message
)
```

Now, it's time to call the appropriate function to handle the tool call. The following code snippet iterates over all the tool calls indicated in the response and calls the corresponding function with the appropriate parameters. The response is also appended to the chat history.


```python
import json
from azure.ai.inference.models import ToolMessage

for tool_call in tool_calls:

    # Get the tool details:

    function_name = tool_call.function.name
    function_args = json.loads(tool_call.function.arguments.replace("\'", "\""))
    tool_call_id = tool_call.id

    print(f"Calling function `{function_name}` with arguments {function_args}")

    # Call the function defined above using `locals()`, which returns the list of all functions 
    # available in the scope as a dictionary. Notice that this is just done as a simple way to get
    # the function callable from its string name. Then we can call it with the corresponding
    # arguments.

    callable_func = locals()[function_name]
    function_response = callable_func(**function_args)

    print("->", function_response)

    # Once we have a response from the function and its arguments, we can append a new message to the chat 
    # history. Notice how we are telling to the model that this chat message came from a tool:

    messages.append(
        ToolMessage(
            tool_call_id=tool_call_id,
            content=json.dumps(function_response)
        )
    )
```

View the response from the model:


```python
response = client.complete(
    messages=messages,
    tools=tools,
)
```

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.


```python
from azure.ai.inference.models import AssistantMessage, UserMessage, SystemMessage

try:
    response = client.complete(
        messages=[
            SystemMessage(content="You are an AI assistant that helps people find information."),
            UserMessage(content="Chopping tomatoes and cutting them into cubes or wedges are great ways to practice your knife skills."),
        ]
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

> [!TIP]
> To learn more about how you can configure and control Azure AI content safety settings, check the [Azure AI content safety documentation](https://aka.ms/azureaicontentsafety).

## Use chat completions with images

Some models can reason across text and images and generate text completions based on both kinds of input. In this section, you explore the capabilities of Some models for vision in a chat fashion:

> [!IMPORTANT]
> Some models support only one image for each turn in the chat conversation and only the last image is retained in context. If you add multiple images, it results in an error.

To see this capability, download an image and encode the information as `base64` string. The resulting data should be inside of a [data URL](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs):


```python
from urllib.request import urlopen, Request
import base64

image_url = "https://news.microsoft.com/source/wp-content/uploads/2024/04/The-Phi-3-small-language-models-with-big-potential-1-1900x1069.jpg"
image_format = "jpeg"

request = Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
image_data = base64.b64encode(urlopen(request).read()).decode("utf-8")
data_url = f"data:image/{image_format};base64,{image_data}"
```

Visualize the image:


```python
import requests
import IPython.display as Disp

Disp.Image(requests.get(image_url).content)
```



Now, create a chat completion request with the image:


```python
from azure.ai.inference.models import TextContentItem, ImageContentItem, ImageUrl
response = client.complete(
    messages=[
        SystemMessage("You are a helpful assistant that can generate responses based on images."),
        UserMessage(content=[
            TextContentItem(text="Which conclusion can be extracted from the following chart?"),
            ImageContentItem(image=ImageUrl(url=data_url))
        ]),
    ],
    temperature=0,
    top_p=1,
    max_tokens=2048,
)
```

The response is as follows, where you can see the model's usage statistics:


```python
print(f"{response.choices[0].message.role}:\n\t{response.choices[0].message.content}\n")
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
```

```console
ASSISTANT: The chart illustrates that larger models tend to perform better in quality, as indicated by their size in billions of parameters. However, there are exceptions to this trend, such as Phi-3-medium and Phi-3-small, which outperform smaller models in quality. This suggests that while larger models generally have an advantage, there might be other factors at play that influence a model's performance.
Model: mistral-large-2407
Usage: 
  Prompt tokens: 2380
  Completion tokens: 126
  Total tokens: 2506
```

---


* A model with reasoning capabilities model deployment. If you don't have one read [Add and configure models to Azure AI services](../../how-to/create-model-deployments.md) to add a reasoning model. 

  * This examples use `DeepSeek-R1`.

* Install the [Azure AI inference package](https://aka.ms/azsdk/azure-ai-inference/python/reference) with the following command:

  ```bash
  pip install -U azure-ai-inference
  ```
  
## Use reasoning capabilities with chat

First, create the client to consume the model. The following code uses an endpoint URL and key that are stored in environment variables.

```python
import os
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint="https://<resource>.services.ai.azure.com/models",
    credential=AzureKeyCredential(os.environ["AZURE_INFERENCE_CREDENTIAL"]),
    model="deepseek-r1"
)
```

> [!TIP]
> Verify that you have deployed the model to Azure AI Services resource with the Azure AI model inference API. `Deepseek-R1` is also available as Serverless API Endpoints. However, those endpoints don't take the parameter `model` as explained in this tutorial. You can verify that by going to [Azure AI Foundry portal]() > Models + endpoints, and verify that the model is listed under the section **Azure AI Services**.

If you have configured the resource to with **Microsoft Entra ID** support, you can use the following code snippet to create a client.

```python
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

### Create a chat completion request

The following example shows how you can create a basic chat request to the model.

```python
from azure.ai.inference.models import SystemMessage, UserMessage

response = client.complete(
    messages=[
        UserMessage(content="How many languages are in the world?"),
    ],
)
```

The response is as follows, where you can see the model's usage statistics:

```python
print("Response:", response.choices[0].message.content)
print("Model:", response.model)
print("Usage:")
print("\tPrompt tokens:", response.usage.prompt_tokens)
print("\tTotal tokens:", response.usage.total_tokens)
print("\tCompletion tokens:", response.usage.completion_tokens)
```

```console
Response: <think>Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer...</think>As of now, it's estimated that there are about 7,000 languages spoken around the world. However, this number can vary as some languages become extinct and new ones develop. It's also important to note that the number of speakers can greatly vary between languages, with some having millions of speakers and others only a few hundred.
Model: deepseek-r1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```


### Reasoning content

Some reasoning models, like DeepSeek-R1, generate completions and include the reasoning behind it. The reasoning associated with the completion is included in the response's content within the tags `<think>` and `</think>`. The model may select on which scenarios to generate reasoning content. You can extract the reasoning content from the response to understand the model's thought process as follows:

```python
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

```console
Thinking: Okay, the user is asking how many languages exist in the world. I need to provide a clear and accurate answer. Let's start by recalling the general consensus from linguistic sources. I remember that the number often cited is around 7,000, but maybe I should check some reputable organizations.\n\nEthnologue is a well-known resource for language data, and I think they list about 7,000 languages. But wait, do they update their numbers? It might be around 7,100 or so. Also, the exact count can vary because some sources might categorize dialects differently or have more recent data. \n\nAnother thing to consider is language endangerment. Many languages are endangered, with some having only a few speakers left. Organizations like UNESCO track endangered languages, so mentioning that adds context. Also, the distribution isn't even. Some countries have hundreds of languages, like Papua New Guinea with over 800, while others have just a few. \n\nA user might also wonder why the exact number is hard to pin down. It's because the distinction between a language and a dialect can be political or cultural. For example, Mandarin and Cantonese are considered dialects of Chinese by some, but they're mutually unintelligible, so others classify them as separate languages. Also, some regions are under-researched, making it hard to document all languages. \n\nI should also touch on language families. The 7,000 languages are grouped into families like Indo-European, Sino-Tibetan, Niger-Congo, etc. Maybe mention a few of the largest families. But wait, the question is just about the count, not the families. Still, it's good to provide a bit more context. \n\nI need to make sure the information is up-to-date. Let me think – recent estimates still hover around 7,000. However, languages are dying out rapidly, so the number decreases over time. Including that note about endangerment and language extinction rates could be helpful. For instance, it's often stated that a language dies every few weeks. \n\nAnother point is sign languages. Does the count include them? Ethnologue includes some, but not all sources might. If the user is including sign languages, that adds more to the count, but I think the 7,000 figure typically refers to spoken languages. For thoroughness, maybe mention that there are also over 300 sign languages. \n\nSummarizing, the answer should state around 7,000, mention Ethnologue's figure, explain why the exact number varies, touch on endangerment, and possibly note sign languages as a separate category. Also, a brief mention of Papua New Guinea as the most linguistically diverse country. \n\nWait, let me verify Ethnologue's current number. As of their latest edition (25th, 2022), they list 7,168 living languages. But I should check if that's the case. Some sources might round to 7,000. Also, SIL International publishes Ethnologue, so citing them as reference makes sense. \n\nOther sources, like Glottolog, might have a different count because they use different criteria. Glottolog might list around 7,000 as well, but exact numbers vary. It's important to highlight that the count isn't exact because of differing definitions and ongoing research. \n\nIn conclusion, the approximate number is 7,000, with Ethnologue being a key source, considerations of endangerment, and the challenges in counting due to dialect vs. language distinctions. I should make sure the answer is clear, acknowledges the variability, and provides key points succinctly.

Answer: The exact number of languages in the world is challenging to determine due to differences in definitions (e.g., distinguishing languages from dialects) and ongoing documentation efforts. However, widely cited estimates suggest there are approximately **7,000 languages** globally.
Model: DeepSeek-R1
Usage: 
  Prompt tokens: 11
  Total tokens: 897
  Completion tokens: 886
```

When making multi-turn conversations, it's useful to avoid sending the reasoning content in the chat history as reasoning tends to generate long explanations.

### Stream content

By default, the completions API returns the entire generated content in a single response. If you're generating long completions, waiting for the response can take many seconds.

You can _stream_ the content to get it as it's being generated. Streaming content allows you to start processing the completion as content becomes available. This mode returns an object that streams back the response as [data-only server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events). Extract chunks from the delta field, rather than the message field.

To stream completions, set `stream=True` when you call the model.


```python
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

```python
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


```python
print_stream(result)
```

### Parameters

In general, reasoning models don't support the following parameters you can find in chat completion models:

* Temperature
* Presence penalty
* Repetition penalty
* Parameter `top_p`

Some models support the use of tools or structured outputs (including JSON-schemas). Read the [Models](../../concepts/models.md) details page to understand each model's support.

### Apply content safety

The Azure AI model inference API supports [Azure AI content safety](https://aka.ms/azureaicontentsafety). When you use deployments with Azure AI content safety turned on, inputs and outputs pass through an ensemble of classification models aimed at detecting and preventing the output of harmful content. The content filtering system detects and takes action on specific categories of potentially harmful content in both input prompts and output completions.

The following example shows how to handle events when the model detects harmful content in the input prompt and content safety is enabled.


```python
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
