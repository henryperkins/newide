## API specs

Managing and interacting with Azure OpenAI models and resources is divided across three primary API surfaces:

- Control plane
- Data plane - authoring
- Data plane - inference

Each API surface/specification encapsulates a different set of Azure OpenAI capabilities. Each API has its own unique set of preview and stable/generally available (GA) API releases. Preview releases currently tend to follow a monthly cadence.

|API|Latest preview release|Latest GA release|Specifications|Description|
|---|---|---|---|---|
|**Control plane**|[2024-06-01-preview](app://obsidian.md/en-us/rest/api/aiservices/accountmanagement/operation-groups?view=rest-aiservices-accountmanagement-2024-06-01-preview&preserve-view=true)|[2024-10-01](app://obsidian.md/en-us/rest/api/aiservices/accountmanagement/deployments/create-or-update?view=rest-aiservices-accountmanagement-2024-10-01&tabs=HTTP&preserve-view=true)|[Spec files](https://github.com/Azure/azure-rest-api-specs/tree/main/specification/cognitiveservices/resource-manager/Microsoft.CognitiveServices)|Azure OpenAI shares a common control plane with all other Azure AI Services. The control plane API is used for things like [creating Azure OpenAI resources](app://obsidian.md/en-us/rest/api/aiservices/accountmanagement/accounts/create?view=rest-aiservices-accountmanagement-2023-05-01&tabs=HTTP&preserve-view=true) , [model deployment](app://obsidian.md/en-us/rest/api/aiservices/accountmanagement/deployments/create-or-update?view=rest-aiservices-accountmanagement-2023-05-01&tabs=HTTP&preserve-view=true), and other higher level resource management tasks. The control plane also governs what is possible to do with capabilities like Azure Resource Manager, Bicep, Terraform, and Azure CLI.|
|**Data plane - authoring**|`2025-02-01-preview`|`2024-10-21`|[Spec files](https://github.com/Azure/azure-rest-api-specs/tree/main/specification/cognitiveservices/data-plane/AzureOpenAI/authoring)|The data plane authoring API controls [fine-tuning](app://obsidian.md/en-us/rest/api/azureopenai/fine-tuning?view=rest-azureopenai-2024-08-01-preview&preserve-view=true) , [file-upload](app://obsidian.md/en-us/rest/api/azureopenai/files/upload?view=rest-azureopenai-2024-08-01-preview&tabs=HTTP&preserve-view=true) , [ingestion jobs](app://obsidian.md/en-us/rest/api/azureopenai/ingestion-jobs/create?view=rest-azureopenai-2024-08-01-preview&tabs=HTTP&preserve-view=true) , [batch](app://obsidian.md/en-us/rest/api/azureopenai/batch?view=rest-azureopenai-2024-08-01-preview&tabs=HTTP&preserve-view=true) and certain [model level queries](app://obsidian.md/en-us/rest/api/azureopenai/models/get?view=rest-azureopenai-2024-08-01-preview&tabs=HTTP&preserve-view=true)|
|**Data plane - inference**|[2025-02-01-preview](app://obsidian.md/en-us/azure/ai-services/openai/reference-preview#data-plane-inference)|[2024-10-21](app://obsidian.md/en-us/azure/ai-services/openai/reference#data-plane-inference)|[Spec files](https://github.com/Azure/azure-rest-api-specs/tree/main/specification/cognitiveservices/data-plane/AzureOpenAI/inference)|The data plane inference API provides the inference capabilities/endpoints for features like completions, chat completions, embeddings, speech/whisper, on your data, Dall-e, assistants, etc.|

## Authentication

Azure OpenAI provides two methods for authentication. You can use  either API Keys or Microsoft Entra ID.

- **API Key authentication**: For this type of authentication, all API requests must include the API Key in the`api-key`HTTP header. The [Quickstart](app://obsidian.md/chatgpt-quickstart)provides guidance for how to make calls with this type of authentication.
- **Microsoft Entra ID authentication**: You can authenticate an API call using a Microsoft Entra token. Authentication tokens are included in a request as the`Authorization`header. The token provided must be preceded by`Bearer`, for example`Bearer YOUR_AUTH_TOKEN`. You can read our how-to guide on [authenticating with Microsoft Entra ID](app://obsidian.md/how-to/managed-identity).

### REST API versioning

The service APIs are versioned using the`api-version`query parameter. All versions follow the YYYY-MM-DD date structure. For example:

```
`POST https://YOUR_RESOURCE_NAME.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT_NAME/chat/completions?api-version=2024-06-01`
```

## Data plane inference

The rest of the article covers the latest preview release of the Azure OpenAI data plane inference specification,`2025-02-01-preview`. This article includes documentation for the latest preview capabilities like assistants, threads, and vector stores.

If you're looking for documentation on the latest GA API release, refer to the [latest GA data plane inference API](app://obsidian.md/reference)

## Completions - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/completions?api-version=2025-02-01-preview`
```

Creates a completion for the provided prompt, parameters and chosen model.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string|Deployment id of the model which was deployed.|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|prompt|string or array|The prompt(s) to generate completions for, encoded as a string, array of strings, array of tokens, or array of token arrays.Note that <\|endoftext\|> is the document separator that the model sees during training, so if a prompt isn't specified the model will generate as if from the beginning of a new document.|Yes||
|best_of|integer|Generates`best_of`completions server-side and returns the "best" (the one with the highest log probability per token). Results can't be streamed.When used with`n`,`best_of`controls the number of candidate completions and`n`specifies how many to return â€“`best_of`must be greater than`n`.

**Note:**Because this parameter generates many completions, it can quickly consume your token quota. Use carefully and ensure that you have reasonable settings for`max_tokens`and`stop`.|No|1|
|echo|boolean|Echo back the prompt in addition to the completion|No|False|
|frequency_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.|No|0|
|logit_bias|object|Modify the likelihood of specified tokens appearing in the completion.Accepts a JSON object that maps tokens (specified by their token ID in the GPT tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.

As an example, you can pass`{"50256": -100}`to prevent the <\|endoftext\|> token from being generated.|No|None|
|logprobs|integer|Include the log probabilities on the`logprobs`most likely output tokens, as well the chosen tokens. For example, if`logprobs`is 5, the API will return a list of the 5 most likely tokens. The API will always return the`logprob`of the sampled token, so there may be up to`logprobs+1`elements in the response.The maximum value for`logprobs`is 5.|No|None|
|max_tokens|integer|The maximum number of tokens that can be generated in the completion.The token count of your prompt plus`max_tokens`can't exceed the model's context length.|No|16|
|n|integer|How many completions to generate for each prompt.**Note:**Because this parameter generates many completions, it can quickly consume your token quota. Use carefully and ensure that you have reasonable settings for`max_tokens`and`stop`.|No|1|
|presence_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.|No|0|
|seed|integer|If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same`seed`and parameters should return the same result.Determinism isn't guaranteed, and you should refer to the`system_fingerprint`response parameter to monitor changes in the backend.|No||
|stop|string or array|Up to four sequences where the API will stop generating further tokens. The returned text won't contain the stop sequence.|No||
|stream|boolean|Whether to stream back partial progress. If set, tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a`data: [DONE]`message.|No|False|
|suffix|string|The suffix that comes after a completion of inserted text.This parameter is only supported for`gpt-3.5-turbo-instruct`.|No|None|
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.We generally recommend altering this or`top_p`but not both.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or`temperature`but not both.|No|1|
|user|string|A unique identifier representing your end-user, which can help to monitor and detect abuse.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[createCompletionResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#createcompletionresponse)|Represents a completion response from the API. Note: both the streamed and non-streamed response objects share the same shape (unlike the chat endpoint).|
||||

**Status Code:**default

**Description**: Service unavailable

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[errorResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#errorresponse)||

### Examples

### Example

Creates a completion for the provided prompt, parameters and chosen model.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/completions?api-version=2025-02-01-preview

{
 "prompt": [
  "tell me a joke about mango"
 ],
 "max_tokens": 32,
 "temperature": 1.0,
 "n": 1
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "cmpl-7QmVI15qgYVllxK0FtxVGG6ywfzaq",
    "created": 1686617332,
    "choices": [
      {
        "text": "es\n\nWhat do you call a mango who's in charge?\n\nThe head mango.",
        "index": 0,
        "finish_reason": "stop",
        "logprobs": null
      }
    ],
    "usage": {
      "completion_tokens": 20,
      "prompt_tokens": 6,
      "total_tokens": 26
    }
  }
}`
```

## Embeddings - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/embeddings?api-version=2025-02-01-preview`
```

Get a vector representation of a given input that can be easily consumed by machine learning models and algorithms.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|input|string or array|Input text to embed, encoded as a string or array of tokens. To embed multiple inputs in a single request, pass an array of strings or array of token arrays. The input must not exceed the max input tokens for the model (8,192 tokens for`text-embedding-ada-002`), can't be an empty string, and any array must be 2,048 dimensions or less.|Yes||
|user|string|A unique identifier representing your end-user, which can help monitoring and detecting abuse.|No||
|input_type|string|input type of embedding search to use|No||
|encoding_format|string|The format to return the embeddings in. Can be either`float`or`base64`. Defaults to`float`.|No||
|dimensions|integer|The number of dimensions the resulting output embeddings should have. Only supported in`text-embedding-3`and later models.|No||

### Responses

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|object|string||Yes||
|model|string||Yes||
|data|array||Yes||
|usage|object||Yes||

### Properties for usage

#### prompt_tokens

|Name|Type|Description|Default|
|---|---|---|---|
|prompt_tokens|integer|||

#### total_tokens

|Name|Type|Description|Default|
|---|---|---|---|
|total_tokens|integer|||

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|object||

### Examples

### Example

Return the embeddings for a given prompt.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/embeddings?api-version=2025-02-01-preview

{
 "input": [
  "this is a test"
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "data": [
      {
        "index": 0,
        "embedding": [
          -0.012838088,
          -0.007421397,
          -0.017617522,
          -0.028278312,
          -0.018666342,
          0.01737855,
          -0.01821495,
          -0.006950092,
          -0.009937238,
          -0.038580645,
          0.010674067,
          0.02412286,
          -0.013647936,
          0.013189907,
          0.0021125758,
          0.012406612,
          0.020790534,
          0.00074595667,
          0.008397198,
          -0.00535031,
          0.008968075,
          0.014351576,
          -0.014086051,
          0.015055214,
          -0.022211088,
          -0.025198232,
          0.0065186154,
          -0.036350243,
          0.009180495,
          -0.009698266,
          0.009446018,
          -0.008463579,
          -0.0040426035,
          -0.03443847,
          -0.00091273896,
          -0.0019217303,
          0.002349888,
          -0.021560553,
          0.016515596,
          -0.015572986,
          0.0038666942
        ]
      }
    ],
    "usage": {
      "prompt_tokens": 4,
      "total_tokens": 4
    }
  }
}`
```

## Chat completions - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview`
```

Creates a completion for the chat message

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string|Deployment id of the model which was deployed.|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.We generally recommend altering this or`top_p`but not both.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or`temperature`but not both.|No|1|
|stream|boolean|If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-onlyserver-sent eventsas they become available, with the stream terminated by a`data: [DONE]`message.|No|False|
|stop|string or array|Up to four sequences where the API will stop generating further tokens.|No||
|max_tokens|integer|The maximum number of tokens that can be generated in the chat completion.The total length of input tokens and generated tokens is limited by the model's context length.|No||
|max_completion_tokens|integer|An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens. This is only supported in o1 series models. Will expand the support to other models in future API release.|No||
|presence_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.|No|0|
|frequency_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.|No|0|
|logit_bias|object|Modify the likelihood of specified tokens appearing in the completion.Accepts a JSON object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.|No|None|
|store|boolean|Whether or not to store the output of this chat completion request for use in our model distillation or evaluation products.|No||
|metadata|object|Developer-defined tags and values used for filtering completions in the stored completions dashboard.|No||
|user|string|A unique identifier representing your end-user, which can help to monitor and detect abuse.|No||
|messages|array|A list of messages comprising the conversation so far.|Yes||
|data_sources|array|The configuration entries for Azure OpenAI chat extensions that use them.
This additional specification is only compatible with Azure OpenAI.|No||
|reasoning_effort|enum|**o1 models only**Constrains effort on reasoning for reasoning models.

Currently supported values are`low`,`medium`, and`high`. Reducing reasoning effort can result in faster responses and fewer tokens used on reasoning in a response.
Possible values: low, medium, high|No||
|logprobs|boolean|Whether to return log probabilities of the output tokens or not. If true, returns the log probabilities of each output token returned in the`content`of`message`.|No|False|
|top_logprobs|integer|An integer between 0 and 20 specifying the number of most likely tokens to return at each token position, each with an associated log probability.`logprobs`must be set to`true`if this parameter is used.|No||
|n|integer|How many chat completion choices to generate for each input message. Note that you will be charged based on the number of generated tokens across all of the choices. Keep`n`as`1`to minimize costs.|No|1|
|parallel_tool_calls|[ParallelToolCalls](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#paralleltoolcalls)|Whether to enable parallel function calling during tool use.|No|True|
|response_format|[ResponseFormatText](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#responseformattext) or [ResponseFormatJsonObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#responseformatjsonobject) or [ResponseFormatJsonSchema](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#responseformatjsonschema)|An object specifying the format that the model must output. Compatible with [GPT-4o](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-4-and-gpt-4-turbo-models) , [GPT-4o mini](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-4-and-gpt-4-turbo-models) , [GPT-4 Turbo](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-4-and-gpt-4-turbo-models) and all [GPT-3.5](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-35) Turbo models newer than`gpt-3.5-turbo-1106`.Setting to`{ "type": "json_schema", "json_schema": {...} }`enables Structured Outputs which guarantees the model will match your supplied JSON schema.

Setting to`{ "type": "json_object" }`enables JSON mode, which guarantees the message the model generates is valid JSON.

**Important:**when using JSON mode, you**must**also instruct the model to produce JSON yourself via a system or user message. Without this, the model may generate an unending stream of whitespace until the generation reaches the token limit, resulting in a long-running and seemingly "stuck" request. Also note that the message content may be partially cut off if`finish_reason="length"`, which indicates the generation exceeded`max_tokens`or the conversation exceeded the max context length.|No||
|seed|integer|This feature is in Beta.
If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same`seed`and parameters should return the same result.
Determinism isn't guaranteed, and you should refer to the`system_fingerprint`response parameter to monitor changes in the backend.|No||
|stream_options|[chatCompletionStreamOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionstreamoptions)|Options for streaming response. Only set this when you set`stream: true`.|No|None|
|tools|array|A list of tools the model may call. Currently, only functions are supported as a tool. Use this to provide a list of functions the model may generate JSON inputs for. A max of 128 functions are supported.|No||
|tool_choice|[chatCompletionToolChoiceOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletiontoolchoiceoption)|Controls which (if any) tool is called by the model.`none`means the model won't call any tool and instead generates a message.`auto`means the model can pick between generating a message or calling one or more tools.`required`means the model must call one or more tools. Specifying a particular tool via`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that tool.`none`is the default when no tools are present.`auto`is the default if tools are present.|No||
|function_call|string or [chatCompletionFunctionCallOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionfunctioncalloption)|Deprecated in favor of`tool_choice`.Controls which (if any) function is called by the model.
`none`means the model won't call a function and instead generates a message.
`auto`means the model can pick between generating a message or calling a function.
Specifying a particular function via`{"name": "my_function"}`forces the model to call that function.

`none`is the default when no functions are present.`auto`is the default if functions are present.|No||
|functions|array|Deprecated in favor of`tools`.A list of functions the model may generate JSON inputs for.|No||
|user_security_context|[userSecurityContext](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#usersecuritycontext)|User security context contains several parameters that describe the AI application itself, and the end user that interacts with the AI application. These fields assist your security operations teams to investigate and mitigate security incidents by providing a comprehensive approach to protecting your AI applications. [Learn more](https://aka.ms/TP4AI/Documentation/EndUserContext)about protecting AI applications using Microsoft Defender for Cloud.|No||
|modalities|[ChatCompletionModalities](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionmodalities)|Output types that you would like the model to generate for this request.
Most models are capable of generating text, which is the default:`["text"]`

The`gpt-4o-audio-preview`model can also be used to generate audio. To
request that this model generate both text and audio responses, you can
use:

`["text", "audio"]`|No||
|prediction|[PredictionContent](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#predictioncontent)|Configuration for a Predicted Output, which can greatly improve response times when large parts of the model response are known ahead of time. This is most common when you are regenerating a file with only minor changes to most of the content.|No||
|audio|object|Parameters for audio output. Required when audio output is requested with
`modalities: ["audio"]`.|No||

### Properties for audio

#### voice

|Name|Type|Description|Default|
|---|---|---|---|
|voice|string|Specifies the voice type. Supported voices are`alloy`,`echo`,
`fable`,`onyx`,`nova`, and`shimmer`.||

#### format

|Name|Type|Description|Default|
|---|---|---|---|
|format|string|Specifies the output audio format. Must be one of`wav`,`mp3`,`flac`,
`opus`, or`pcm16`.||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[createChatCompletionResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#createchatcompletionresponse) or [createChatCompletionStreamResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#createchatcompletionstreamresponse)||

**Status Code:**default

**Description**: Service unavailable

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[errorResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#errorresponse)||

### Examples

### Example

Creates a completion for the provided prompt, parameters and chosen model.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "system",
   "content": "you are a helpful assistant that talks like a pirate"
  },
  {
   "role": "user",
   "content": "can you tell me how to care for a parrot?"
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Ahoy matey! So ye be wantin' to care for a fine squawkin' parrot, eh? Well, shiver me timbers, let ol' Cap'n Assistant share some wisdom with ye! Here be the steps to keepin' yer parrot happy 'n healthy:\n\n1. Secure a sturdy cage: Yer parrot be needin' a comfortable place to lay anchor! Be sure ye get a sturdy cage, at least double the size of the bird's wingspan, with enough space to spread their wings, yarrrr!\n\n2. Perches 'n toys: Aye, parrots need perches of different sizes, shapes, 'n textures to keep their feet healthy. Also, a few toys be helpin' to keep them entertained 'n their minds stimulated, arrrh!\n\n3. Proper grub: Feed yer feathered friend a balanced diet of high-quality pellets, fruits, 'n veggies to keep 'em strong 'n healthy. Give 'em fresh water every day, or ye\u00e2\u20ac\u2122ll have a scurvy bird on yer hands!\n\n4. Cleanliness: Swab their cage deck! Clean their cage on a regular basis: fresh water 'n food daily, the floor every couple of days, 'n a thorough scrubbing ev'ry few weeks, so the bird be livin' in a tidy haven, arrhh!\n\n5. Socialize 'n train: Parrots be a sociable lot, arrr! Exercise 'n interact with 'em daily to create a bond 'n maintain their mental 'n physical health. Train 'em with positive reinforcement, treat 'em kindly, yarrr!\n\n6. Proper rest: Yer parrot be needin' \u00e2\u20ac\u2122bout 10-12 hours o' sleep each night. Cover their cage 'n let them slumber in a dim, quiet quarter for a proper night's rest, ye scallywag!\n\n7. Keep a weather eye open for illness: Birds be hidin' their ailments, arrr! Be watchful for signs of sickness, such as lethargy, loss of appetite, puffin' up, or change in droppings, and make haste to a vet if need be.\n\n8. Provide fresh air 'n avoid toxins: Parrots be sensitive to draft and pollutants. Keep yer quarters well ventilated, but no drafts, arrr! Be mindful of toxins like Teflon fumes, candles, or air fresheners.\n\nSo there ye have it, me hearty! With proper care 'n commitment, yer parrot will be squawkin' \"Yo-ho-ho\" for many years to come! Good luck, sailor, and may the wind be at yer back!"
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion based on Azure Search data and system-assigned managed identity.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a dog?"
  }
 ],
 "data_sources": [
  {
   "type": "azure_search",
   "parameters": {
    "endpoint": "https://your-search-endpoint.search.windows.net/",
    "index_name": "{index name}",
    "authentication": {
     "type": "system_assigned_managed_identity"
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion [doc1].",
          "context": {
            "citations": [
              {
                "content": "Citation content.",
                "title": "Citation Title",
                "filepath": "contoso.txt",
                "url": "https://contoso.blob.windows.net/container/contoso.txt",
                "chunk_id": "0"
              }
            ],
            "intent": "dog care"
          }
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion based on Azure Search image vector data.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a dog?"
  }
 ],
 "data_sources": [
  {
   "type": "azure_search",
   "parameters": {
    "endpoint": "https://your-search-endpoint.search.windows.net/",
    "index_name": "{index name}",
    "query_type": "vector",
    "fields_mapping": {
     "image_vector_fields": [
      "image_vector"
     ]
    },
    "authentication": {
     "type": "api_key",
     "key": "{api key}"
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion."
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion based on Azure Search vector data, previous assistant message and user-assigned managed identity.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a cat?"
  },
  {
   "role": "assistant",
   "content": "Content of the completion [doc1].",
   "context": {
    "intent": "cat care"
   }
  },
  {
   "role": "user",
   "content": "how about dog?"
  }
 ],
 "data_sources": [
  {
   "type": "azure_search",
   "parameters": {
    "endpoint": "https://your-search-endpoint.search.windows.net/",
    "authentication": {
     "type": "user_assigned_managed_identity",
     "managed_identity_resource_id": "/subscriptions/{subscription-id}/resourceGroups/{resource-group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{resource-name}"
    },
    "index_name": "{index name}",
    "query_type": "vector",
    "embedding_dependency": {
     "type": "deployment_name",
     "deployment_name": "{embedding deployment name}"
    },
    "in_scope": true,
    "top_n_documents": 5,
    "strictness": 3,
    "role_information": "You are an AI assistant that helps people find information.",
    "fields_mapping": {
     "content_fields_separator": "\\n",
     "content_fields": [
      "content"
     ],
     "filepath_field": "filepath",
     "title_field": "title",
     "url_field": "url",
     "vector_fields": [
      "contentvector"
     ]
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion [doc1].",
          "context": {
            "citations": [
              {
                "content": "Citation content 2.",
                "title": "Citation Title 2",
                "filepath": "contoso2.txt",
                "url": "https://contoso.blob.windows.net/container/contoso2.txt",
                "chunk_id": "0"
              }
            ],
            "intent": "dog care"
          }
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion for the provided Azure Cosmos DB.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a dog?"
  }
 ],
 "data_sources": [
  {
   "type": "azure_cosmos_db",
   "parameters": {
    "authentication": {
     "type": "connection_string",
     "connection_string": "mongodb+srv://rawantest:{password}$@{cluster-name}.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000"
    },
    "database_name": "vectordb",
    "container_name": "azuredocs",
    "index_name": "azuredocindex",
    "embedding_dependency": {
     "type": "deployment_name",
     "deployment_name": "{embedding deployment name}"
    },
    "fields_mapping": {
     "content_fields": [
      "content"
     ],
     "vector_fields": [
      "contentvector"
     ]
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion [doc1].",
          "context": {
            "citations": [
              {
                "content": "Citation content.",
                "title": "Citation Title",
                "filepath": "contoso.txt",
                "url": "https://contoso.blob.windows.net/container/contoso.txt",
                "chunk_id": "0"
              }
            ],
            "intent": "dog care"
          }
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion for the provided Mongo DB.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a dog?"
  }
 ],
 "data_sources": [
  {
   "type": "mongo_db",
   "parameters": {
    "authentication": {
     "type": "username_and_password",
     "username": "<username>",
     "password": "<password>"
    },
    "endpoint": "<endpoint_name>",
    "app_name": "<application name>",
    "database_name": "sampledb",
    "collection_name": "samplecollection",
    "index_name": "sampleindex",
    "embedding_dependency": {
     "type": "deployment_name",
     "deployment_name": "{embedding deployment name}"
    },
    "fields_mapping": {
     "content_fields": [
      "content"
     ],
     "vector_fields": [
      "contentvector"
     ]
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion [doc1].",
          "context": {
            "citations": [
              {
                "content": "Citation content.",
                "title": "Citation Title",
                "filepath": "contoso.txt",
                "url": "https://contoso.blob.windows.net/container/contoso.txt",
                "chunk_id": "0"
              }
            ],
            "intent": "dog care"
          }
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion for the provided Elasticsearch.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a dog?"
  }
 ],
 "data_sources": [
  {
   "type": "elasticsearch",
   "parameters": {
    "endpoint": "https://your-elasticsearch-endpoint.eastus.azurecontainer.io",
    "index_name": "{index name}",
    "authentication": {
     "type": "key_and_key_id",
     "key": "{key}",
     "key_id": "{key id}"
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion [doc1].",
          "context": {
            "citations": [
              {
                "content": "Citation content.",
                "title": "Citation Title",
                "filepath": "contoso.txt",
                "url": "https://contoso.blob.windows.net/container/contoso.txt",
                "chunk_id": "0"
              }
            ],
            "intent": "dog care"
          }
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

### Example

Creates a completion for the provided Pinecone resource.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/chat/completions?api-version=2025-02-01-preview

{
 "messages": [
  {
   "role": "user",
   "content": "can you tell me how to care for a dog?"
  }
 ],
 "data_sources": [
  {
   "type": "pinecone",
   "parameters": {
    "authentication": {
     "type": "api_key",
     "key": "{api key}"
    },
    "environment": "{environment name}",
    "index_name": "{index name}",
    "embedding_dependency": {
     "type": "deployment_name",
     "deployment_name": "{embedding deployment name}"
    },
    "fields_mapping": {
     "title_field": "title",
     "url_field": "url",
     "filepath_field": "filepath",
     "content_fields": [
      "content"
     ],
     "content_fields_separator": "\n"
    }
   }
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
    "created": 1686676106,
    "choices": [
      {
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "Content of the completion [doc1].",
          "context": {
            "citations": [
              {
                "content": "Citation content.",
                "title": "Citation Title",
                "filepath": "contoso.txt",
                "url": "https://contoso.blob.windows.net/container/contoso.txt",
                "chunk_id": "0"
              }
            ],
            "intent": "dog care"
          }
        }
      }
    ],
    "usage": {
      "completion_tokens": 557,
      "prompt_tokens": 33,
      "total_tokens": 590
    }
  }
}`
```

## Transcriptions - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/transcriptions?api-version=2025-02-01-preview`
```

Transcribes audio into the input language.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string|Deployment id of the whisper model.|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: multipart/form-data

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|file|string|The audio file object to transcribe.|Yes||
|prompt|string|An optional text to guide the model's style or continue a previous audio segment. The prompt should match the audio language.|No||
|response_format|[audioResponseFormat](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#audioresponseformat)|Defines the format of the output.|No||
|temperature|number|The sampling temperature, between 0 and 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. If set to 0, the model will use log probability to automatically increase the temperature until certain thresholds are hit.|No|0|
|language|string|The language of the input audio. Supplying the input language in ISO-639-1 format will improve accuracy and latency.|No||
|timestamp_granularities[]|array|The timestamp granularities to populate for this transcription.`response_format`must be set`verbose_json`to use timestamp granularities. Either or both of these options are supported:`word`, or`segment`. Note: There's no additional latency for segment timestamps, but generating word timestamps incurs additional latency.|No|['segment']|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[audioResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#audioresponse) or [audioVerboseResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#audioverboseresponse)||
|text/plain|string|Transcribed text in the output format (when response_format was one of text, vtt or srt).|

### Examples

### Example

Gets transcribed text and associated metadata from provided spoken audio data.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/transcriptions?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "text": "A structured object when requesting json or verbose_json"
  }
}`
```

### Example

Gets transcribed text and associated metadata from provided spoken audio data.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/transcriptions?api-version=2025-02-01-preview

"---multipart-boundary\nContent-Disposition: form-data; name=\"file\"; filename=\"file.wav\"\nContent-Type: application/octet-stream\n\nRIFF..audio.data.omitted\n---multipart-boundary--"`
```

**Responses**:
Status Code: 200

```
`{
  "type": "string",
  "example": "plain text when requesting text, srt, or vtt"
}`
```

## Translations - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/translations?api-version=2025-02-01-preview`
```

Transcribes and translates input audio into English text.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string|Deployment id of the whisper model which was deployed.|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: multipart/form-data

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|file|string|The audio file to translate.|Yes||
|prompt|string|An optional text to guide the model's style or continue a previous audio segment. The prompt should be in English.|No||
|response_format|audioResponseFormat|Defines the format of the output.|No||
|temperature|number|The sampling temperature, between 0 and 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. If set to 0, the model will use log probability to automatically increase the temperature until certain thresholds are hit.|No|0|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|audioResponseoraudioVerboseResponse||
|text/plain|string|Transcribed text in the output format (when response_format was one of text, vtt or srt).|

### Examples

### Example

Gets English language transcribed text and associated metadata from provided spoken audio data.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/translations?api-version=2025-02-01-preview

"---multipart-boundary\nContent-Disposition: form-data; name=\"file\"; filename=\"file.wav\"\nContent-Type: application/octet-stream\n\nRIFF..audio.data.omitted\n---multipart-boundary--"`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "text": "A structured object when requesting json or verbose_json"
  }
}`
```

### Example

Gets English language transcribed text and associated metadata from provided spoken audio data.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/translations?api-version=2025-02-01-preview

"---multipart-boundary\nContent-Disposition: form-data; name=\"file\"; filename=\"file.wav\"\nContent-Type: application/octet-stream\n\nRIFF..audio.data.omitted\n---multipart-boundary--"`
```

**Responses**:
Status Code: 200

```
`{
  "type": "string",
  "example": "plain text when requesting text, srt, or vtt"
}`
```

## Speech - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/speech?api-version=2025-02-01-preview`
```

Generates audio from the input text.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string|Deployment id of the tts model which was deployed.|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: multipart/form-data

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|input|string|The text to synthesize audio for. The maximum length is 4,096 characters.|Yes||
|voice|enum|The voice to use for speech synthesis.
Possible values: alloy, echo, fable, onyx, nova, shimmer|Yes||
|response_format|enum|The format to synthesize the audio in.
Possible values: mp3, opus, aac, flac, wav, pcm|No||
|speed|number|The speed of the synthesized audio. Select a value from`0.25`to`4.0`.`1.0`is the default.|No|1.0|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/octet-stream|string||

### Examples

### Example

Synthesizes audio from the provided text.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/audio/speech?api-version=2025-02-01-preview

{
 "input": "Hi! What are you going to make?",
 "voice": "fable",
 "response_format": "mp3"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": "101010101"
}`
```

## Image generations - Create

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/images/generations?api-version=2025-02-01-preview`
```

Generates a batch of images from a text caption on a given DALLE model deployment

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|deployment-id|path|Yes|string|Deployment id of the dalle model which was deployed.|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|prompt|string|A text description of the desired image(s). The maximum length is 4,000 characters.|Yes||
|n|integer|The number of images to generate.|No|1|
|size|[imageSize](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#imagesize)|The size of the generated images.|No|1024x1024|
|response_format|[imagesResponseFormat](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#imagesresponseformat)|The format in which the generated images are returned.|No|url|
|user|string|A unique identifier representing your end-user, which can help to monitor and detect abuse.|No||
|quality|[imageQuality](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#imagequality)|The quality of the image that will be generated.|No|standard|
|style|[imageStyle](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#imagestyle)|The style of the generated images.|No|vivid|

### Responses

**Status Code:**200

**Description**: Ok

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[generateImagesResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#generateimagesresponse)||

**Status Code:**default

**Description**: An error occurred.

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[dalleErrorResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#dalleerrorresponse)||

### Examples

### Example

Creates images given a prompt.

```
`POST https://{endpoint}/openai/deployments/{deployment-id}/images/generations?api-version=2025-02-01-preview

{
 "prompt": "In the style of WordArt, Microsoft Clippy wearing a cowboy hat.",
 "n": 1,
 "style": "natural",
 "quality": "standard"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "created": 1698342300,
    "data": [
      {
        "revised_prompt": "A vivid, natural representation of Microsoft Clippy wearing a cowboy hat.",
        "prompt_filter_results": {
          "sexual": {
            "severity": "safe",
            "filtered": false
          },
          "violence": {
            "severity": "safe",
            "filtered": false
          },
          "hate": {
            "severity": "safe",
            "filtered": false
          },
          "self_harm": {
            "severity": "safe",
            "filtered": false
          },
          "profanity": {
            "detected": false,
            "filtered": false
          },
          "custom_blocklists": {
            "filtered": false,
            "details": []
          }
        },
        "url": "https://dalletipusw2.blob.core.windows.net/private/images/e5451cc6-b1ad-4747-bd46-b89a3a3b8bc3/generated_00.png?se=2023-10-27T17%3A45%3A09Z&...",
        "content_filter_results": {
          "sexual": {
            "severity": "safe",
            "filtered": false
          },
          "violence": {
            "severity": "safe",
            "filtered": false
          },
          "hate": {
            "severity": "safe",
            "filtered": false
          },
          "self_harm": {
            "severity": "safe",
            "filtered": false
          }
        }
      }
    ]
  }
}`
```

## List - Assistants

```
`GET https://{endpoint}/openai/assistants?api-version=2025-02-01-preview`
```

Returns a list of assistants.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[listAssistantsResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#listassistantsresponse)||

### Examples

### Example

Returns a list of assistants.

```
`GET https://{endpoint}/openai/assistants?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "asst_abc123",
        "object": "assistant",
        "created_at": 1707257477,
        "name": "Stock Analyst",
        "description": null,
        "model": "gpt-4-1106-preview",
        "instructions": "You are a financial analyst that analyzes stock market prices and other financial data present on user uploaded files or by calling external APIs.",
        "tools": [
          {
            "type": "code_interpreter"
          }
        ],
        "tool_resources": {},
        "metadata": {},
        "top_p": 1.0,
        "temperature": 1.0,
        "response_format": "auto"
      },
      {
        "id": "asst_abc456",
        "object": "assistant",
        "created_at": 1698982718,
        "name": "My Assistant",
        "description": null,
        "model": "gpt-4-turbo",
        "instructions": "You are a helpful assistant designed to make me better at coding!",
        "tools": [],
        "tool_resources": {},
        "metadata": {},
        "top_p": 1.0,
        "temperature": 1.0,
        "response_format": "auto"
      },
      {
        "id": "asst_abc789",
        "object": "assistant",
        "created_at": 1698982643,
        "name": null,
        "description": null,
        "model": "gpt-4-turbo",
        "instructions": null,
        "tools": [],
        "tool_resources": {},
        "metadata": {},
        "top_p": 1.0,
        "temperature": 1.0,
        "response_format": "auto"
      }
    ],
    "first_id": "asst_abc123",
    "last_id": "asst_abc789",
    "has_more": false
  }
}`
```

## Create - Assistant

```
`POST https://{endpoint}/openai/assistants?api-version=2025-02-01-preview`
```

Create an assistant with a model and instructions.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|model|||Yes||
|name|string|The name of the assistant. The maximum length is 256 characters.|No||
|description|string|The description of the assistant. The maximum length is 512 characters.|No||
|instructions|string|The system instructions that the assistant uses. The maximum length is 256,000 characters.|No||
|tools|array|A list of tool enabled on the assistant. There can be a maximum of 128 tools per assistant. Tools can be of types`code_interpreter`,`retrieval`, or`function`.|No|[]|
|tool_resources|object|A set of resources that are used by the assistant's tools. The resources are specific to the type of tool. For example, the`code_interpreter`tool requires a list of file IDs, while the`file_search`tool requires a list of vector store IDs.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or temperature but not both.|No|1|
|response_format|[assistantsApiResponseFormatOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#assistantsapiresponseformatoption)|Specifies the format that the model must output. Compatible with GPT-4o, GPT-4 Turbo, and all GPT-3.5 Turbo models since`gpt-3.5-turbo-1106`.Setting to`{ "type": "json_schema", "json_schema": {...} }`enables Structured Outputs which ensures the model will match your supplied JSON schema. Learn more in the Structured Outputs guide.

Setting to`{ "type": "json_object" }`enables JSON mode, which ensures the message the model generates is valid JSON.

**Important:**when using JSON mode, you**must**also instruct the model to produce JSON yourself via a system or user message. Without this, the model may generate an unending stream of whitespace until the generation reaches the token limit, resulting in a long-running and seemingly "stuck" request. Also note that the message content may be partially cut off if`finish_reason="length"`, which indicates the generation exceeded`max_tokens`or the conversation exceeded the max context length.|No||

### Properties for tool_resources

#### code_interpreter

|Name|Type|Description|Default|
|---|---|---|---|
|file_ids|array|A list of file IDs made available to the`code_interpreter`tool. There can be a maximum of 20 files associated with the tool.|[]|

#### file_search

|Name|Type|Description|Default|
|---|---|---|---|
|vector_store_ids|array|The vector store attached to this assistant. There can be a maximum of one vector store attached to the assistant.||
|vector_stores|array|A helper to create a vector store with file_ids and attach it to this assistant. There can be a maximum of one vector store attached to the assistant.||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[assistantObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#assistantobject)|Represents an`assistant`that can call the model and use tools.|

### Examples

### Example

Create an assistant with a model and instructions.

```
`POST https://{endpoint}/openai/assistants?api-version=2025-02-01-preview

{
 "name": "Math Tutor",
 "instructions": "When a customer asks about a specific math problem, use Python to evaluate their query.",
 "tools": [
  {
   "type": "code_interpreter"
  }
 ],
 "model": "gpt-4-1106-preview"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "asst_4nsG2qgNzimRPE7MazXTXbU7",
    "object": "assistant",
    "created_at": 1707295707,
    "name": "Math Tutor",
    "description": null,
    "model": "gpt-4-1106-preview",
    "instructions": "When a customer asks about a specific math problem, use Python to evaluate their query.",
    "tools": [
      {
        "type": "code_interpreter"
      }
    ],
    "metadata": {},
    "top_p": 1.0,
    "temperature": 1.0,
    "response_format": "auto"
  }
}`
```

## Get - Assistant

```
`GET https://{endpoint}/openai/assistants/{assistant_id}?api-version=2025-02-01-preview`
```

Retrieves an assistant.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|assistant_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|assistantObject|Represents an`assistant`that can call the model and use tools.|

### Examples

### Example

Retrieves an assistant.

```
`GET https://{endpoint}/openai/assistants/{assistant_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "asst_abc123",
    "object": "assistant",
    "created_at": 1699009709,
    "name": "HR Helper",
    "description": null,
    "model": "gpt-4-turbo",
    "instructions": "You are an HR bot, and you have access to files to answer employee questions about company policies.",
    "tools": [
      {
        "type": "file_search"
      }
    ],
    "metadata": {},
    "top_p": 1.0,
    "temperature": 1.0,
    "response_format": "auto"
  }
}`
```

## Modify - Assistant

```
`POST https://{endpoint}/openai/assistants/{assistant_id}?api-version=2025-02-01-preview`
```

Modifies an assistant.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|assistant_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|model|||No||
|name|string|The name of the assistant. The maximum length is 256 characters.|No||
|description|string|The description of the assistant. The maximum length is 512 characters.|No||
|instructions|string|The system instructions that the assistant uses. The maximum length is 32,768 characters.|No||
|tools|array|A list of tool enabled on the assistant. There can be a maximum of 128 tools per assistant. Tools can be of types`code_interpreter`,`retrieval`, or`function`.|No|[]|
|tool_resources|object|A set of resources that are used by the assistant's tools. The resources are specific to the type of tool. For example, the`code_interpreter`tool requires a list of file IDs, while the`file_search`tool requires a list of vector store IDs.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or temperature but not both.|No|1|
|response_format|assistantsApiResponseFormatOption|Specifies the format that the model must output. Compatible with GPT-4o, GPT-4 Turbo, and all GPT-3.5 Turbo models since`gpt-3.5-turbo-1106`.Setting to`{ "type": "json_schema", "json_schema": {...} }`enables Structured Outputs which ensures the model will match your supplied JSON schema. Learn more in the Structured Outputs guide.

Setting to`{ "type": "json_object" }`enables JSON mode, which ensures the message the model generates is valid JSON.

**Important:**when using JSON mode, you**must**also instruct the model to produce JSON yourself via a system or user message. Without this, the model may generate an unending stream of whitespace until the generation reaches the token limit, resulting in a long-running and seemingly "stuck" request. Also note that the message content may be partially cut off if`finish_reason="length"`, which indicates the generation exceeded`max_tokens`or the conversation exceeded the max context length.|No||

### Properties for tool_resources

#### code_interpreter

|Name|Type|Description|Default|
|---|---|---|---|
|file_ids|array|Overrides the list of file IDs made available to the`code_interpreter`tool. There can be a maximum of 20 files associated with the tool.|[]|

#### file_search

|Name|Type|Description|Default|
|---|---|---|---|
|vector_store_ids|array|Overrides the vector store attached to this assistant. There can be a maximum of one vector store attached to the assistant.||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|assistantObject|Represents an`assistant`that can call the model and use tools.|

### Examples

### Example

Modifies an assistant.

```
`POST https://{endpoint}/openai/assistants/{assistant_id}?api-version=2025-02-01-preview

{
 "instructions": "You are an HR bot, and you have access to files to answer employee questions about company policies. Always response with info from either of the files.",
 "tools": [
  {
   "type": "file_search"
  }
 ],
 "model": "gpt-4-turbo"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "asst_123",
    "object": "assistant",
    "created_at": 1699009709,
    "name": "HR Helper",
    "description": null,
    "model": "gpt-4-turbo",
    "instructions": "You are an HR bot, and you have access to files to answer employee questions about company policies. Always response with info from either of the files.",
    "tools": [
      {
        "type": "file_search"
      }
    ],
    "tool_resources": {
      "file_search": {
        "vector_store_ids": []
      }
    },
    "metadata": {},
    "top_p": 1.0,
    "temperature": 1.0,
    "response_format": "auto"
  }
}`
```

## Delete - Assistant

```
`DELETE https://{endpoint}/openai/assistants/{assistant_id}?api-version=2025-02-01-preview`
```

Delete an assistant.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|assistant_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[deleteAssistantResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#deleteassistantresponse)||

### Examples

### Example

Deletes an assistant.

```
`DELETE https://{endpoint}/openai/assistants/{assistant_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "asst_4nsG2qgNzimRPE7MazXTXbU7",
    "object": "assistant.deleted",
    "deleted": true
  }
}`
```

## Create - Thread

```
`POST https://{endpoint}/openai/threads?api-version=2025-02-01-preview`
```

Create a thread.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|messages|array|A list of messages to start the thread with.|No||
|tool_resources|object|A set of resources that are made available to the assistant's tools in this thread. The resources are specific to the type of tool. For example, the`code_interpreter`tool requires a list of file IDs, while the`file_search`tool requires a list of vector store IDs.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Properties for tool_resources

#### code_interpreter

|Name|Type|Description|Default|
|---|---|---|---|
|file_ids|array|A list of file IDs made available to the`code_interpreter`tool. There can be a maximum of 20 files associated with the tool.|[]|

#### file_search

|Name|Type|Description|Default|
|---|---|---|---|
|vector_store_ids|array|The vector store attached to this thread. There can be a maximum of one vector store attached to the thread.||
|vector_stores|array|A helper to create a vector store with file_ids and attach it to this thread. There can be a maximum of one vector store attached to the thread.||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[threadObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#threadobject)|Represents a thread that contains messages.|

### Examples

### Example

Creates a thread.

```
`POST https://{endpoint}/openai/threads?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "thread_v7V4csrNOxtNmgcwGg496Smx",
    "object": "thread",
    "created_at": 1707297136,
    "metadata": {}
  }
}`
```

## Get - Thread

```
`GET https://{endpoint}/openai/threads/{thread_id}?api-version=2025-02-01-preview`
```

Retrieves a thread.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|threadObject|Represents a thread that contains messages.|

### Examples

### Example

Retrieves a thread.

```
`GET https://{endpoint}/openai/threads/{thread_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "thread_v7V4csrNOxtNmgcwGg496Smx",
    "object": "thread",
    "created_at": 1707297136,
    "metadata": {},
    "tool_resources": {
      "code_interpreter": {
        "file_ids": []
      }
    }
  }
}`
```

## Modify - Thread

```
`POST https://{endpoint}/openai/threads/{thread_id}?api-version=2025-02-01-preview`
```

Modifies a thread.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|tool_resources|object|A set of resources that are made available to the assistant's tools in this thread. The resources are specific to the type of tool. For example, the`code_interpreter`tool requires a list of file IDs, while the`file_search`tool requires a list of vector store IDs.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Properties for tool_resources

#### code_interpreter

|Name|Type|Description|Default|
|---|---|---|---|
|file_ids|array|A list of File IDs made available to the`code_interpreter`tool. There can be a maximum of 20 files associated with the tool.|[]|

#### file_search

|Name|Type|Description|Default|
|---|---|---|---|
|vector_store_ids|array|The vector store attached to this thread. There can be a maximum of one vector store attached to the thread.||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|threadObject|Represents a thread that contains messages.|

### Examples

### Example

Modifies a thread.

```
`POST https://{endpoint}/openai/threads/{thread_id}?api-version=2025-02-01-preview

{
 "metadata": {
  "modified": "true",
  "user": "abc123"
 }
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "thread_v7V4csrNOxtNmgcwGg496Smx",
    "object": "thread",
    "created_at": 1707297136,
    "metadata": {
      "modified": "true",
      "user": "abc123"
    },
    "tool_resources": {}
  }
}`
```

## Delete - Thread

```
`DELETE https://{endpoint}/openai/threads/{thread_id}?api-version=2025-02-01-preview`
```

Delete a thread.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[deleteThreadResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#deletethreadresponse)||

### Examples

### Example

Deletes a thread.

```
`DELETE https://{endpoint}/openai/threads/{thread_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "thread_v7V4csrNOxtNmgcwGg496Smx",
    "object": "thread.deleted",
    "deleted": true
  }
}`
```

## List - Messages

```
`GET https://{endpoint}/openai/threads/{thread_id}/messages?api-version=2025-02-01-preview`
```

Returns a list of messages for a given thread.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|run_id|query|No|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[listMessagesResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#listmessagesresponse)||

### Examples

### Example

List Messages

```
`GET https://{endpoint}/openai/threads/{thread_id}/messages?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "msg_abc123",
        "object": "thread.message",
        "created_at": 1699016383,
        "assistant_id": null,
        "thread_id": "thread_abc123",
        "run_id": null,
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": {
              "value": "How does AI work? Explain it in simple terms.",
              "annotations": []
            }
          }
        ],
        "attachments": [],
        "metadata": {}
      },
      {
        "id": "msg_abc456",
        "object": "thread.message",
        "created_at": 1699016383,
        "assistant_id": null,
        "thread_id": "thread_abc123",
        "run_id": null,
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": {
              "value": "Hello, what is AI?",
              "annotations": []
            }
          }
        ],
        "attachments": [],
        "metadata": {}
      }
    ],
    "first_id": "msg_abc123",
    "last_id": "msg_abc456",
    "has_more": false
  }
}`
```

## Create - Message

```
`POST https://{endpoint}/openai/threads/{thread_id}/messages?api-version=2025-02-01-preview`
```

Create a message.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|role|string|The role of the entity that is creating the message. Allowed values include:
-`user`: Indicates the message is sent by an actual user and should be used in most cases to represent user-generated messages.
-`assistant`: Indicates the message is generated by the assistant. Use this value to insert messages from the assistant into the conversation.|Yes||
|content|string|The content of the message.|Yes||
|attachments|array|A list of files attached to the message, and the tools they should be added to.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[messageObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#messageobject)|Represents a message within a thread.|

### Examples

### Example

Create a message.

```
`POST https://{endpoint}/openai/threads/{thread_id}/messages?api-version=2025-02-01-preview

{
 "role": "user",
 "content": "What is the cube root of the sum of 12, 14, 1234, 4321, 90000, 123213541223, 443123123124, 5423324234, 234324324234, 653434534545, 200000000, 98237432984, 99999999, 99999999999, 220000000000, 3309587702? Give me the answer rounded to the nearest integer without commas or spaces."
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "msg_as3XIk1tpVP3hdHjWBGg3uG4",
    "object": "thread.message",
    "created_at": 1707298421,
    "assistant_id": null,
    "thread_id": "thread_v7V4csrNOxtNmgcwGg496Smx",
    "run_id": null,
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": {
          "value": "What is the cube root of the sum of 12, 14, 1234, 4321, 90000, 123213541223, 443123123124, 5423324234, 234324324234, 653434534545, 200000000, 98237432984, 99999999, 99999999999, 220000000000, 3309587702? Give me the answer rounded to the nearest integer without commas or spaces.",
          "annotations": []
        }
      }
    ],
    "attachments": [],
    "metadata": {}
  }
}`
```

## Get - Message

```
`GET https://{endpoint}/openai/threads/{thread_id}/messages/{message_id}?api-version=2025-02-01-preview`
```

Retrieve a message.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|message_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|messageObject|Represents a message within a thread.|

### Examples

### Example

Retrieve a message.

```
`GET https://{endpoint}/openai/threads/{thread_id}/messages/{message_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "msg_as3XIk1tpVP3hdHjWBGg3uG4",
    "object": "thread.message",
    "created_at": 1707298421,
    "thread_id": "thread_v7V4csrNOxtNmgcwGg496Smx",
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": {
          "value": "What is the cube root of the sum of 12, 14, 1234, 4321, 90000, 123213541223, 443123123124, 5423324234, 234324324234, 653434534545, 200000000, 98237432984, 99999999, 99999999999, 220000000000, 3309587702? Give me the answer rounded to the nearest integer without commas or spaces.",
          "annotations": []
        }
      }
    ],
    "file_ids": [],
    "assistant_id": null,
    "run_id": null,
    "metadata": {}
  }
}`
```

## Modify - Message

```
`POST https://{endpoint}/openai/threads/{thread_id}/messages/{message_id}?api-version=2025-02-01-preview`
```

Modifies a message.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|message_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|messageObject|Represents a message within a thread.|

### Examples

### Example

Modify a message.

```
`POST https://{endpoint}/openai/threads/{thread_id}/messages/{message_id}?api-version=2025-02-01-preview

{
 "metadata": {
  "modified": "true",
  "user": "abc123"
 }
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "msg_abc123",
    "object": "thread.message",
    "created_at": 1699017614,
    "assistant_id": null,
    "thread_id": "thread_abc123",
    "run_id": null,
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": {
          "value": "How does AI work? Explain it in simple terms.",
          "annotations": []
        }
      }
    ],
    "file_ids": [],
    "metadata": {
      "modified": "true",
      "user": "abc123"
    }
  }
}`
```

## Create - Thread And Run

```
`POST https://{endpoint}/openai/threads/runs?api-version=2025-02-01-preview`
```

Create a thread and run it in one request.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|assistant_id|string|The ID of the assistant to use to execute this run.|Yes||
|thread|[createThreadRequest](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#createthreadrequest)||No||
|model|string|The ID of the model to be used to execute this run. If a value is provided here, it will override the model associated with the assistant. If not, the model associated with the assistant will be used.|No||
|instructions|string|Override the default system message of the assistant. This is useful for modifying the behavior on a per-run basis.|No||
|tools|array|Override the tools the assistant can use for this run. This is useful for modifying the behavior on a per-run basis.|No||
|tool_resources|object|A set of resources that are used by the assistant's tools. The resources are specific to the type of tool. For example, the`code_interpreter`tool requires a list of file IDs, while the`file_search`tool requires a list of vector store IDs.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or temperature but not both.|No|1|
|stream|boolean|If`true`, returns a stream of events that happen during the Run as server-sent events, terminating when the Run enters a terminal state with a`data: [DONE]`message.|No||
|stream_options|[chatCompletionStreamOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionstreamoptions)|Options for streaming response. Only set this when you set`stream: true`.|No|None|
|max_prompt_tokens|integer|The maximum number of prompt tokens that may be used over the course of the run. The run will make a best effort to use only the number of prompt tokens specified, across multiple turns of the run. If the run exceeds the number of prompt tokens specified, the run will end with status`incomplete`. See`incomplete_details`for more info.|No||
|max_completion_tokens|integer|The maximum number of completion tokens that may be used over the course of the run. The run will make a best effort to use only the number of completion tokens specified, across multiple turns of the run. If the run exceeds the number of completion tokens specified, the run will end with status`incomplete`. See`incomplete_details`for more info.|No||
|truncation_strategy|[truncationObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#truncationobject)|Controls for how a thread will be truncated prior to the run. Use this to control the initial context window of the run.|No||
|tool_choice|[assistantsApiToolChoiceOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#assistantsapitoolchoiceoption)|Controls which (if any) tool is called by the model.
`none`means the model won't call any tools and instead generates a message.
`auto`is the default value and means the model can pick between generating a message or calling a tool.
Specifying a particular tool like`{"type": "file_search"}`or`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that tool.|No||
|parallel_tool_calls|[ParallelToolCalls](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#paralleltoolcalls)|Whether to enable parallel function calling during tool use.|No|True|
|response_format|[assistantsApiResponseFormatOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#assistantsapiresponseformatoption)|Specifies the format that the model must output. Compatible with GPT-4o, GPT-4 Turbo, and all GPT-3.5 Turbo models since`gpt-3.5-turbo-1106`.Setting to`{ "type": "json_schema", "json_schema": {...} }`enables Structured Outputs which ensures the model will match your supplied JSON schema. Learn more in the Structured Outputs guide.

Setting to`{ "type": "json_object" }`enables JSON mode, which ensures the message the model generates is valid JSON.

**Important:**when using JSON mode, you**must**also instruct the model to produce JSON yourself via a system or user message. Without this, the model may generate an unending stream of whitespace until the generation reaches the token limit, resulting in a long-running and seemingly "stuck" request. Also note that the message content may be partially cut off if`finish_reason="length"`, which indicates the generation exceeded`max_tokens`or the conversation exceeded the max context length.|No||

### Properties for tool_resources

#### code_interpreter

|Name|Type|Description|Default|
|---|---|---|---|
|file_ids|array|A list of file IDs made available to the`code_interpreter`tool. There can be a maximum of 20 files associated with the tool.|[]|

#### file_search

|Name|Type|Description|Default|
|---|---|---|---|
|vector_store_ids|array|The ID of the vector store attached to this assistant. There can be a maximum of one vector store attached to the assistant.||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[runObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#runobject)|Represents an execution run on a thread.|

### Examples

### Example

Create a thread and run it in one request.

```
`POST https://{endpoint}/openai/threads/runs?api-version=2025-02-01-preview

{
 "assistant_id": "asst_abc123",
 "thread": {
  "messages": [
   {
    "role": "user",
    "content": "Explain deep learning to a 5 year old."
   }
  ]
 }
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "run_abc123",
    "object": "thread.run",
    "created_at": 1699076792,
    "assistant_id": "asst_abc123",
    "thread_id": "thread_abc123",
    "status": "queued",
    "started_at": null,
    "expires_at": 1699077392,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": null,
    "required_action": null,
    "last_error": null,
    "model": "gpt-4-turbo",
    "instructions": "You are a helpful assistant.",
    "tools": [],
    "tool_resources": {},
    "metadata": {},
    "temperature": 1.0,
    "top_p": 1.0,
    "max_completion_tokens": null,
    "max_prompt_tokens": null,
    "truncation_strategy": {
      "type": "auto",
      "last_messages": null
    },
    "incomplete_details": null,
    "usage": null,
    "response_format": "auto",
    "tool_choice": "auto"
  }
}`
```

## List - Runs

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs?api-version=2025-02-01-preview`
```

Returns a list of runs belonging to a thread.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[listRunsResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#listrunsresponse)||

### Examples

### Example

Returns a list of runs belonging to a thread.

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "run_abc123",
        "object": "thread.run",
        "created_at": 1699075072,
        "assistant_id": "asst_abc123",
        "thread_id": "thread_abc123",
        "status": "completed",
        "started_at": 1699075072,
        "expires_at": null,
        "cancelled_at": null,
        "failed_at": null,
        "completed_at": 1699075073,
        "last_error": null,
        "model": "gpt-4-turbo",
        "instructions": null,
        "incomplete_details": null,
        "tools": [
          {
            "type": "code_interpreter"
          }
        ],
        "tool_resources": {
          "code_interpreter": {
            "file_ids": [
              "file-abc123",
              "file-abc456"
            ]
          }
        },
        "metadata": {},
        "usage": {
          "prompt_tokens": 123,
          "completion_tokens": 456,
          "total_tokens": 579
        },
        "temperature": 1.0,
        "top_p": 1.0,
        "max_prompt_tokens": 1000,
        "max_completion_tokens": 1000,
        "truncation_strategy": {
          "type": "auto",
          "last_messages": null
        },
        "response_format": "auto",
        "tool_choice": "auto"
      },
      {
        "id": "run_abc456",
        "object": "thread.run",
        "created_at": 1699063290,
        "assistant_id": "asst_abc123",
        "thread_id": "thread_abc123",
        "status": "completed",
        "started_at": 1699063290,
        "expires_at": null,
        "cancelled_at": null,
        "failed_at": null,
        "completed_at": 1699063291,
        "last_error": null,
        "model": "gpt-4-turbo",
        "instructions": null,
        "incomplete_details": null,
        "tools": [
          {
            "type": "code_interpreter"
          }
        ],
        "tool_resources": {
          "code_interpreter": {
            "file_ids": [
              "file-abc123",
              "file-abc456"
            ]
          }
        },
        "metadata": {},
        "usage": {
          "prompt_tokens": 123,
          "completion_tokens": 456,
          "total_tokens": 579
        },
        "temperature": 1.0,
        "top_p": 1.0,
        "max_prompt_tokens": 1000,
        "max_completion_tokens": 1000,
        "truncation_strategy": {
          "type": "auto",
          "last_messages": null
        },
        "response_format": "auto",
        "tool_choice": "auto"
      }
    ],
    "first_id": "run_abc123",
    "last_id": "run_abc456",
    "has_more": false
  }
}`
```

## Create - Run

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs?api-version=2025-02-01-preview`
```

Create a run.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|include[]|query|No|array||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|assistant_id|string|The ID of the assistant to use to execute this run.|Yes||
|model|string|The ID of the Model to be used to execute this run. If a value is provided here, it will override the model associated with the assistant. If not, the model associated with the assistant will be used.|No||
|instructions|string|Override the default system message of the assistant. This is useful for modifying the behavior on a per-run basis.|No||
|additional_instructions|string|Appends additional instructions at the end of the instructions for the run. This is useful for modifying the behavior on a per-run basis without overriding other instructions.|No||
|additional_messages|array|Adds additional messages to the thread before creating the run.|No||
|tools|array|Override the tools the assistant can use for this run. This is useful for modifying the behavior on a per-run basis.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or temperature but not both.|No|1|
|stream|boolean|If`true`, returns a stream of events that happen during the Run as server-sent events, terminating when the Run enters a terminal state with a`data: [DONE]`message.|No||
|max_prompt_tokens|integer|The maximum number of prompt tokens that may be used over the course of the run. The run will make a best effort to use only the number of prompt tokens specified, across multiple turns of the run. If the run exceeds the number of prompt tokens specified, the run will end with status`incomplete`. See`incomplete_details`for more info.|No||
|max_completion_tokens|integer|The maximum number of completion tokens that may be used over the course of the run. The run will make a best effort to use only the number of completion tokens specified, across multiple turns of the run. If the run exceeds the number of completion tokens specified, the run will end with status`incomplete`. See`incomplete_details`for more info.|No||
|truncation_strategy|truncationObject|Controls for how a thread will be truncated prior to the run. Use this to control the initial context window of the run.|No||
|tool_choice|assistantsApiToolChoiceOption|Controls which (if any) tool is called by the model.
`none`means the model won't call any tools and instead generates a message.
`auto`is the default value and means the model can pick between generating a message or calling a tool.
Specifying a particular tool like`{"type": "file_search"}`or`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that tool.|No||
|parallel_tool_calls|ParallelToolCalls|Whether to enable parallel function calling during tool use.|No|True|
|response_format|assistantsApiResponseFormatOption|Specifies the format that the model must output. Compatible with GPT-4o, GPT-4 Turbo, and all GPT-3.5 Turbo models since`gpt-3.5-turbo-1106`.Setting to`{ "type": "json_schema", "json_schema": {...} }`enables Structured Outputs which ensures the model will match your supplied JSON schema. Learn more in the Structured Outputs guide.

Setting to`{ "type": "json_object" }`enables JSON mode, which ensures the message the model generates is valid JSON.

**Important:**when using JSON mode, you**must**also instruct the model to produce JSON yourself via a system or user message. Without this, the model may generate an unending stream of whitespace until the generation reaches the token limit, resulting in a long-running and seemingly "stuck" request. Also note that the message content may be partially cut off if`finish_reason="length"`, which indicates the generation exceeded`max_tokens`or the conversation exceeded the max context length.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|runObject|Represents an execution run on a thread.|

### Examples

### Example

Create a run.

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs?api-version=2025-02-01-preview

{
 "assistant_id": "asst_abc123"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "run_abc123",
    "object": "thread.run",
    "created_at": 1699063290,
    "assistant_id": "asst_abc123",
    "thread_id": "thread_abc123",
    "status": "queued",
    "started_at": 1699063290,
    "expires_at": null,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": 1699063291,
    "last_error": null,
    "model": "gpt-4-turbo",
    "instructions": null,
    "incomplete_details": null,
    "tools": [
      {
        "type": "code_interpreter"
      }
    ],
    "metadata": {},
    "usage": null,
    "temperature": 1.0,
    "top_p": 1.0,
    "max_prompt_tokens": 1000,
    "max_completion_tokens": 1000,
    "truncation_strategy": {
      "type": "auto",
      "last_messages": null
    },
    "response_format": "auto",
    "tool_choice": "auto"
  }
}`
```

## Get - Run

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}?api-version=2025-02-01-preview`
```

Retrieves a run.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|run_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|runObject|Represents an execution run on a thread.|

### Examples

### Example

Gets a run.

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "run_HsO8tYM4K5AAMAHgK0J3om8Q",
    "object": "thread.run",
    "created_at": 1707303196,
    "assistant_id": "asst_JtTwHk28cIocgFXZPCBxhOzl",
    "thread_id": "thread_eRNwflE3ncDYak1np6MdMHJh",
    "status": "completed",
    "started_at": 1707303197,
    "expires_at": null,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": 1707303201,
    "last_error": null,
    "model": "gpt-4-1106-preview",
    "instructions": "You are an AI model that empowers every person and every organization on the planet to achieve more.",
    "tools": [],
    "file_ids": [],
    "metadata": {}
  }
}`
```

## Modify - Run

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}?api-version=2025-02-01-preview`
```

Modifies a run.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|run_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|runObject|Represents an execution run on a thread.|

### Examples

### Example

Modifies a run.

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}?api-version=2025-02-01-preview

{
 "metadata": {
  "user_id": "user_abc123"
 }
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "run_abc123",
    "object": "thread.run",
    "created_at": 1699075072,
    "assistant_id": "asst_abc123",
    "thread_id": "thread_abc123",
    "status": "completed",
    "started_at": 1699075072,
    "expires_at": null,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": 1699075073,
    "last_error": null,
    "model": "gpt-4-turbo",
    "instructions": null,
    "incomplete_details": null,
    "tools": [
      {
        "type": "code_interpreter"
      }
    ],
    "tool_resources": {
      "code_interpreter": {
        "file_ids": [
          "file-abc123",
          "file-abc456"
        ]
      }
    },
    "metadata": {
      "user_id": "user_abc123"
    },
    "usage": {
      "prompt_tokens": 123,
      "completion_tokens": 456,
      "total_tokens": 579
    },
    "temperature": 1.0,
    "top_p": 1.0,
    "max_prompt_tokens": 1000,
    "max_completion_tokens": 1000,
    "truncation_strategy": {
      "type": "auto",
      "last_messages": null
    },
    "response_format": "auto",
    "tool_choice": "auto"
  }
}`
```

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/submit_tool_outputs?api-version=2025-02-01-preview`
```

When a run has the`status: "requires_action"`and`required_action.type`is`submit_tool_outputs`, this endpoint can be used to submit the outputs from the tool calls once they're all completed. All outputs must be submitted in a single request.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|run_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|tool_outputs|array|A list of tools for which the outputs are being submitted.|Yes||
|stream|boolean|If`true`, returns a stream of events that happen during the Run as server-sent events, terminating when the Run enters a terminal state with a`data: [DONE]`message.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|runObject|Represents an execution run on a thread.|

### Examples

### Example

When a run has the`status: "requires_action"`and`required_action.type`is`submit_tool_outputs`, this endpoint can be used to submit the outputs from the tool calls once they're all completed. All outputs must be submitted in a single request.

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/submit_tool_outputs?api-version=2025-02-01-preview

{
 "tool_outputs": [
  {
   "tool_call_id": "call_001",
   "output": "70 degrees and sunny."
  }
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "run_123",
    "object": "thread.run",
    "created_at": 1699075592,
    "assistant_id": "asst_123",
    "thread_id": "thread_123",
    "status": "queued",
    "started_at": 1699075592,
    "expires_at": 1699076192,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": null,
    "last_error": null,
    "model": "gpt-4-turbo",
    "instructions": null,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_current_weather",
          "description": "Get the current weather in a given location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and state, e.g. San Francisco, CA"
              },
              "unit": {
                "type": "string",
                "enum": [
                  "celsius",
                  "fahrenheit"
                ]
              }
            },
            "required": [
              "location"
            ]
          }
        }
      }
    ],
    "metadata": {},
    "usage": null,
    "temperature": 1.0,
    "top_p": 1.0,
    "max_prompt_tokens": 1000,
    "max_completion_tokens": 1000,
    "truncation_strategy": {
      "type": "auto",
      "last_messages": null
    },
    "response_format": "auto",
    "tool_choice": "auto"
  }
}`
```

## Cancel - Run

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/cancel?api-version=2025-02-01-preview`
```

Cancels a run that is`in_progress`.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|run_id|path|Yes|string||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|runObject|Represents an execution run on a thread.|

### Examples

### Example

Cancels a run that is`in_progress`.

```
`POST https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/cancel?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "run_abc123",
    "object": "thread.run",
    "created_at": 1699076126,
    "assistant_id": "asst_abc123",
    "thread_id": "thread_abc123",
    "status": "cancelling",
    "started_at": 1699076126,
    "expires_at": 1699076726,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": null,
    "last_error": null,
    "model": "gpt-4-turbo",
    "instructions": "You summarize books.",
    "tools": [
      {
        "type": "file_search"
      }
    ],
    "tool_resources": {
      "file_search": {
        "vector_store_ids": [
          "vs_123"
        ]
      }
    },
    "metadata": {},
    "usage": null,
    "temperature": 1.0,
    "top_p": 1.0,
    "response_format": "auto"
  }
}`
```

## List - Run Steps

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/steps?api-version=2025-02-01-preview`
```

Returns a list of run steps belonging to a run.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|run_id|path|Yes|string||
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|api-version|query|Yes|string|API version|
|include[]|query|No|array||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[listRunStepsResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#listrunstepsresponse)||

### Examples

### Example

Returns a list of run steps belonging to a run.

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/steps?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "step_abc123",
        "object": "thread.run.step",
        "created_at": 1699063291,
        "run_id": "run_abc123",
        "assistant_id": "asst_abc123",
        "thread_id": "thread_abc123",
        "type": "message_creation",
        "status": "completed",
        "cancelled_at": null,
        "completed_at": 1699063291,
        "expired_at": null,
        "failed_at": null,
        "last_error": null,
        "step_details": {
          "type": "message_creation",
          "message_creation": {
            "message_id": "msg_abc123"
          }
        },
        "usage": {
          "prompt_tokens": 123,
          "completion_tokens": 456,
          "total_tokens": 579
        }
      }
    ],
    "first_id": "step_abc123",
    "last_id": "step_abc456",
    "has_more": false
  }
}`
```

## Get - Run Step

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/steps/{step_id}?api-version=2025-02-01-preview`
```

Retrieves a run step.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|thread_id|path|Yes|string||
|run_id|path|Yes|string||
|step_id|path|Yes|string||
|include[]|query|No|array||
|api-version|query|Yes|string|API version|

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[runStepObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#runstepobject)|Represents a step in execution of a run.|
||||

### Examples

### Example

Retrieves a run step.

```
`GET https://{endpoint}/openai/threads/{thread_id}/runs/{run_id}/steps/{step_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "step_abc123",
    "object": "thread.run.step",
    "created_at": 1699063291,
    "run_id": "run_abc123",
    "assistant_id": "asst_abc123",
    "thread_id": "thread_abc123",
    "type": "message_creation",
    "status": "completed",
    "cancelled_at": null,
    "completed_at": 1699063291,
    "expired_at": null,
    "failed_at": null,
    "last_error": null,
    "step_details": {
      "type": "message_creation",
      "message_creation": {
        "message_id": "msg_abc123"
      }
    },
    "usage": {
      "prompt_tokens": 123,
      "completion_tokens": 456,
      "total_tokens": 579
    }
  }
}`
```

## List - Vector Stores

```
`GET https://{endpoint}/openai/vector_stores?api-version=2025-02-01-preview`
```

Returns a list of vector stores.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[listVectorStoresResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#listvectorstoresresponse)||

### Examples

### Example

Returns a list of vector stores.

```
`GET https://{endpoint}/openai/vector_stores?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "vs_abc123",
        "object": "vector_store",
        "created_at": 1699061776,
        "name": "Support FAQ",
        "bytes": 139920,
        "file_counts": {
          "in_progress": 0,
          "completed": 3,
          "failed": 0,
          "cancelled": 0,
          "total": 3
        }
      },
      {
        "id": "vs_abc456",
        "object": "vector_store",
        "created_at": 1699061776,
        "name": "Support FAQ v2",
        "bytes": 139920,
        "file_counts": {
          "in_progress": 0,
          "completed": 3,
          "failed": 0,
          "cancelled": 0,
          "total": 3
        }
      }
    ],
    "first_id": "vs_abc123",
    "last_id": "vs_abc456",
    "has_more": false
  }
}`
```

## Create - Vector Store

```
`POST https://{endpoint}/openai/vector_stores?api-version=2025-02-01-preview`
```

Create a vector store.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|file_ids|array|A list of file IDs that the vector store should use. Useful for tools like`file_search`that can access files.|No||
|name|string|The name of the vector store.|No||
|expires_after|[vectorStoreExpirationAfter](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#vectorstoreexpirationafter)|The expiration policy for a vector store.|No||
|chunking_strategy|[autoChunkingStrategyRequestParam](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#autochunkingstrategyrequestparam) or [staticChunkingStrategyRequestParam](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#staticchunkingstrategyrequestparam)|The chunking strategy used to chunk the file(s). If not set, will use the`auto`strategy. Only applicable if`file_ids`is nonempty.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[vectorStoreObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#vectorstoreobject)|A vector store is a collection of processed files can be used by the`file_search`tool.|

### Examples

### Example

Creates a vector store.

```
`POST https://{endpoint}/openai/vector_stores?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "vs_abc123",
    "object": "vector_store",
    "created_at": 1699061776,
    "name": "Support FAQ",
    "bytes": 139920,
    "file_counts": {
      "in_progress": 0,
      "completed": 3,
      "failed": 0,
      "cancelled": 0,
      "total": 3
    }
  }
}`
```

## Get - Vector Store

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}?api-version=2025-02-01-preview`
```

Retrieves a vector store.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|vectorStoreObject|A vector store is a collection of processed files can be used by the`file_search`tool.|

### Examples

### Example

Retrieves a vector store.

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "vs_abc123",
    "object": "vector_store",
    "created_at": 1699061776
  }
}`
```

## Modify - Vector Store

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}?api-version=2025-02-01-preview`
```

Modifies a vector store.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|name|string|The name of the vector store.|No||
|expires_after|vectorStoreExpirationAfter|The expiration policy for a vector store.|No||
|metadata|object|Set of 16 key-value pairs that can be attached to an object. This can be useful for storing additional information about the object in a structured format. Keys can be a maximum of 64 characters long and values can be a maximum of 512 characters long.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|vectorStoreObject|A vector store is a collection of processed files can be used by the`file_search`tool.|

### Examples

### Example

Modifies a vector store.

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}?api-version=2025-02-01-preview

{
 "name": "Support FAQ"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "vs_abc123",
    "object": "vector_store",
    "created_at": 1699061776,
    "name": "Support FAQ",
    "bytes": 139920,
    "file_counts": {
      "in_progress": 0,
      "completed": 3,
      "failed": 0,
      "cancelled": 0,
      "total": 3
    }
  }
}`
```

## Delete - Vector Store

```
`DELETE https://{endpoint}/openai/vector_stores/{vector_store_id}?api-version=2025-02-01-preview`
```

Delete a vector store.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[deleteVectorStoreResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#deletevectorstoreresponse)||

### Examples

### Example

Deletes a vector store.

```
`DELETE https://{endpoint}/openai/vector_stores/{vector_store_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "vs_abc123",
    "object": "vector_store.deleted",
    "deleted": true
  }
}`
```

## List - Vector Store Files

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/files?api-version=2025-02-01-preview`
```

Returns a list of vector store files.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|filter|query|No|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[listVectorStoreFilesResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#listvectorstorefilesresponse)||

### Examples

### Example

Returns a list of vector store files.

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/files?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "file-abc123",
        "object": "vector_store.file",
        "created_at": 1699061776,
        "vector_store_id": "vs_abc123"
      },
      {
        "id": "file-abc456",
        "object": "vector_store.file",
        "created_at": 1699061776,
        "vector_store_id": "vs_abc123"
      }
    ],
    "first_id": "file-abc123",
    "last_id": "file-abc456",
    "has_more": false
  }
}`
```

## Create - Vector Store File

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}/files?api-version=2025-02-01-preview`
```

Create a vector store file by attaching a File to a vector store.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|file_id|string|A File ID that the vector store should use. Useful for tools like`file_search`that can access files.|Yes||
|chunking_strategy|[chunkingStrategyRequestParam](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chunkingstrategyrequestparam)|The chunking strategy used to chunk the file(s). If not set, will use the`auto`strategy.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[vectorStoreFileObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#vectorstorefileobject)|A list of files attached to a vector store.|

### Examples

### Example

Create a vector store file by attaching a File to a vector store.

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}/files?api-version=2025-02-01-preview

{
 "file_id": "file-abc123"
}`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "file-abc123",
    "object": "vector_store.file",
    "created_at": 1699061776,
    "usage_bytes": 1234,
    "vector_store_id": "vs_abcd",
    "status": "completed",
    "last_error": null
  }
}`
```

## Get - Vector Store File

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/files/{file_id}?api-version=2025-02-01-preview`
```

Retrieves a vector store file.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|file_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|vectorStoreFileObject|A list of files attached to a vector store.|

### Examples

### Example

Retrieves a vector store file.

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/files/{file_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "file-abc123",
    "object": "vector_store.file",
    "created_at": 1699061776,
    "vector_store_id": "vs_abcd",
    "status": "completed",
    "last_error": null
  }
}`
```

## Delete - Vector Store File

```
`DELETE https://{endpoint}/openai/vector_stores/{vector_store_id}/files/{file_id}?api-version=2025-02-01-preview`
```

Delete a vector store file. This will remove the file from the vector store but the file itself won't be deleted. To delete the file, use the delete file endpoint.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|file_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[deleteVectorStoreFileResponse](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#deletevectorstorefileresponse)||

### Examples

### Example

Delete a vector store file. This will remove the file from the vector store but the file itself won't be deleted. To delete the file, use the delete file endpoint.

```
`DELETE https://{endpoint}/openai/vector_stores/{vector_store_id}/files/{file_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "file_abc123",
    "object": "vector_store.file.deleted",
    "deleted": true
  }
}`
```

## Create - Vector Store File Batch

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches?api-version=2025-02-01-preview`
```

Create a vector store file batch.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Request Body

**Content-Type**: application/json

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|file_ids|array|A list of File IDs that the vector store should use. Useful for tools like`file_search`that can access files.|Yes||
|chunking_strategy|chunkingStrategyRequestParam|The chunking strategy used to chunk the file(s). If not set, will use the`auto`strategy.|No||

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|[vectorStoreFileBatchObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#vectorstorefilebatchobject)|A batch of files attached to a vector store.|

### Examples

### Example

Create a vector store file batch.

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches?api-version=2025-02-01-preview

{
 "file_ids": [
  "file-abc123",
  "file-abc456"
 ]
}`
```

**Responses**:
Status Code: 200

```
`{
  "id": "vsfb_abc123",
  "object": "vector_store.file_batch",
  "created_at": 1699061776,
  "vector_store_id": "vs_abc123",
  "status": "in_progress",
  "file_counts": {
    "in_progress": 1,
    "completed": 1,
    "failed": 0,
    "cancelled": 0,
    "total": 0
  }
}`
```

## Get - Vector Store File Batch

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches/{batch_id}?api-version=2025-02-01-preview`
```

Retrieves a vector store file batch.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|batch_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|vectorStoreFileBatchObject|A batch of files attached to a vector store.|

### Examples

### Example

Retrieves a vector store file batch.

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches/{batch_id}?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "vsfb_abc123",
    "object": "vector_store.file_batch",
    "created_at": 1699061776,
    "vector_store_id": "vs_abc123",
    "status": "in_progress",
    "file_counts": {
      "in_progress": 1,
      "completed": 1,
      "failed": 0,
      "cancelled": 0,
      "total": 0
    }
  }
}`
```

## Cancel - Vector Store File Batch

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel?api-version=2025-02-01-preview`
```

Cancel a vector store file batch. This attempts to cancel the processing of files in this batch as soon as possible.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|batch_id|path|Yes|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|vectorStoreFileBatchObject|A batch of files attached to a vector store.|

### Examples

### Example

Cancel a vector store file batch. This attempts to cancel the processing of files in this batch as soon as possible.

```
`POST https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "id": "vsfb_abc123",
    "object": "vector_store.file_batch",
    "created_at": 1699061776,
    "vector_store_id": "vs_abc123",
    "status": "cancelling",
    "file_counts": {
      "in_progress": 12,
      "completed": 3,
      "failed": 0,
      "cancelled": 0,
      "total": 15
    }
  }
}`
```

## List - Vector Store File Batch Files

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches/{batch_id}/files?api-version=2025-02-01-preview`
```

Returns a list of vector store files in a batch.

### URI Parameters

|Name|In|Required|Type|Description|
|---|---|---|---|---|
|endpoint|path|Yes|string
url|Supported Azure OpenAI endpoints (protocol and hostname, for example:`https://aoairesource.openai.azure.com`. Replace "aoairesource" with your Azure OpenAI resource name). https://{your-resource-name}.openai.azure.com|
|vector_store_id|path|Yes|string||
|batch_id|path|Yes|string||
|limit|query|No|integer||
|order|query|No|string||
|after|query|No|string||
|before|query|No|string||
|filter|query|No|string||
|api-version|query|Yes|string||

### Request Header

|Name|Required|Type|Description|
|---|---|---|---|
|api-key|True|string|Provide Azure OpenAI API key here|

### Responses

**Status Code:**200

**Description**: OK

|**Content-Type**|**Type**|**Description**|
|---|---|---|
|application/json|listVectorStoreFilesResponse||

### Examples

### Example

Returns a list of vector store files.

```
`GET https://{endpoint}/openai/vector_stores/{vector_store_id}/file_batches/{batch_id}/files?api-version=2025-02-01-preview`
```

**Responses**:
Status Code: 200

```
`{
  "body": {
    "object": "list",
    "data": [
      {
        "id": "file-abc123",
        "object": "vector_store.file",
        "created_at": 1699061776,
        "vector_store_id": "vs_abc123"
      },
      {
        "id": "file-abc456",
        "object": "vector_store.file",
        "created_at": 1699061776,
        "vector_store_id": "vs_abc123"
      }
    ],
    "first_id": "file-abc123",
    "last_id": "file-abc456",
    "has_more": false
  }
}`
```

## Components

### errorResponse

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|error|[error](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#error)||No||

### errorBase

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|code|string||No||
|message|string||No||

### error

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|param|string||No||
|type|string||No||
|inner_error|[innerError](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#innererror)|Inner error with additional details.|No||

### innerError

Inner error with additional details.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|code|[innerErrorCode](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#innererrorcode)|Error codes for the inner error object.|No||
|content_filter_results|[contentFilterPromptResults](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#contentfilterpromptresults)|Information about the content filtering category (hate, sexual, violence, self_harm), if it has been detected, as well as the severity level (very_low, low, medium, high-scale that determines the intensity and risk level of harmful content) and if it has been filtered or not. Information about jailbreak content and profanity, if it has been detected, and if it has been filtered or not. And information about customer blocklist, if it has been filtered and its id.|No||

### innerErrorCode

Error codes for the inner error object.

**Description**: Error codes for the inner error object.

**Type**: string

**Default**:

**Enum Name**: InnerErrorCode

**Enum Values**:

|Value|Description|
|---|---|
|ResponsibleAIPolicyViolation|The prompt violated one of more content filter rules.|

### chatCompletionsRequestCommon

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.
We generally recommend altering this or`top_p`but not both.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.
We generally recommend altering this or`temperature`but not both.|No|1|
|stream|boolean|If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only server-sent events as they become available, with the stream terminated by a`data: [DONE]`message.|No|False|
|stop|string or array|Up to four sequences where the API will stop generating further tokens.|No||
|max_tokens|integer|The maximum number of tokens allowed for the generated answer. By default, the number of tokens the model can return will be (4,096 - prompt tokens). This isn't compatible with o1 series models.|No|4,096|
|max_completion_tokens|integer|An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens. This is only supported in o1 series models. Will expand the support to other models in future API release.|No||
|presence_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.|No|0|
|frequency_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.|No|0|
|logit_bias|object|Modify the likelihood of specified tokens appearing in the completion. Accepts a json object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.|No||
|store|boolean|Whether or not to store the output of this chat completion request for use in our model distillation or evaluation products.|No||
|metadata|object|Developer-defined tags and values used for filtering completions in the stored completions dashboard.|No||
|user|string|A unique identifier representing your end-user, which can help Azure OpenAI to monitor and detect abuse.|No||

### createCompletionRequest

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|prompt|string or array|The prompt(s) to generate completions for, encoded as a string, array of strings, array of tokens, or array of token arrays.Note that <\|endoftext\|> is the document separator that the model sees during training, so if a prompt isn't specified the model will generate as if from the beginning of a new document.|Yes||
|best_of|integer|Generates`best_of`completions server-side and returns the "best" (the one with the highest log probability per token). Results can't be streamed.When used with`n`,`best_of`controls the number of candidate completions and`n`specifies how many to return â€“`best_of`must be greater than`n`.

**Note:**Because this parameter generates many completions, it can quickly consume your token quota. Use carefully and ensure that you have reasonable settings for`max_tokens`and`stop`.|No|1|
|echo|boolean|Echo back the prompt in addition to the completion|No|False|
|frequency_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.|No|0|
|logit_bias|object|Modify the likelihood of specified tokens appearing in the completion.Accepts a JSON object that maps tokens (specified by their token ID in the GPT tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.

As an example, you can pass`{"50256": -100}`to prevent the <\|endoftext\|> token from being generated.|No|None|
|logprobs|integer|Include the log probabilities on the`logprobs`most likely output tokens, as well the chosen tokens. For example, if`logprobs`is 5, the API will return a list of the 5 most likely tokens. The API will always return the`logprob`of the sampled token, so there may be up to`logprobs+1`elements in the response.The maximum value for`logprobs`is 5.|No|None|
|max_tokens|integer|The maximum number of tokens that can be generated in the completion.The token count of your prompt plus`max_tokens`can't exceed the model's context length.|No|16|
|n|integer|How many completions to generate for each prompt.**Note:**Because this parameter generates many completions, it can quickly consume your token quota. Use carefully and ensure that you have reasonable settings for`max_tokens`and`stop`.|No|1|
|presence_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.|No|0|
|seed|integer|If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same`seed`and parameters should return the same result.Determinism isn't guaranteed, and you should refer to the`system_fingerprint`response parameter to monitor changes in the backend.|No||
|stop|string or array|Up to four sequences where the API will stop generating further tokens. The returned text won't contain the stop sequence.|No||
|stream|boolean|Whether to stream back partial progress. If set, tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a`data: [DONE]`message.|No|False|
|suffix|string|The suffix that comes after a completion of inserted text.This parameter is only supported for`gpt-3.5-turbo-instruct`.|No|None|
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.We generally recommend altering this or`top_p`but not both.|No|1|
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or`temperature`but not both.|No|1|
|user|string|A unique identifier representing your end-user, which can help to monitor and detect abuse.|No||

### createCompletionResponse

Represents a completion response from the API. Note: both the streamed and non-streamed response objects share the same shape (unlike the chat endpoint).

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|id|string|A unique identifier for the completion.|Yes||
|choices|array|The list of completion choices the model generated for the input prompt.|Yes||
|created|integer|The Unix timestamp (in seconds) of when the completion was created.|Yes||
|model|string|The model used for completion.|Yes||
|prompt_filter_results|[promptFilterResults](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#promptfilterresults)|Content filtering results for zero or more prompts in the request. In a streaming request, results for different prompts may arrive at different times or in different orders.|No||
|system_fingerprint|string|This fingerprint represents the backend configuration that the model runs with.Can be used in conjunction with the`seed`request parameter to understand when backend changes have been made that might impact determinism.|No||
|object|enum|The object type, which is always "text_completion"
Possible values: text_completion|Yes||
|usage|[completionUsage](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#completionusage)|Usage statistics for the completion request.|No||

### createChatCompletionRequest

|Name|Type|Description|Required|Default||||
|---|---|---|---|---|---|---|---|
|temperature|number|What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.We generally recommend altering this or`top_p`but not both.|No|1||||
|top_p|number|An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.We generally recommend altering this or`temperature`but not both.|No|1||||
|stream|boolean|If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-onlyserver-sent eventsas they become available, with the stream terminated by a`data: [DONE]`message.|No|False||||
|stop|string or array|Up to four sequences where the API will stop generating further tokens.|No|||||
|max_tokens|integer|The maximum number of tokens that can be generated in the chat completion.The total length of input tokens and generated tokens is limited by the model's context length.|No|||||
|max_completion_tokens|integer|An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens. This is only supported in o1 series models. Will expand the support to other models in future API release.|No|||||
|presence_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.|No|0||||
|frequency_penalty|number|Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.|No|0||||
|logit_bias|object|Modify the likelihood of specified tokens appearing in the completion.Accepts a JSON object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100. Mathematically, the bias is added to the logits generated by the model prior to sampling. The exact effect will vary per model, but values between -1 and 1 should decrease or increase likelihood of selection; values like -100 or 100 should result in a ban or exclusive selection of the relevant token.|No|None||||
|store|boolean|Whether or not to store the output of this chat completion request for use in our model distillation or evaluation products.|No|||||
|metadata|object|Developer-defined tags and values used for filtering completions in the stored completions dashboard.|No|||||
|user|string|A unique identifier representing your end-user, which can help to monitor and detect abuse.|No|||||
|messages|array|A list of messages comprising the conversation so far.|Yes|||||
|data_sources|array|The configuration entries for Azure OpenAI chat extensions that use them.
This additional specification is only compatible with Azure OpenAI.|No|||||
|reasoning_effort|enum|**o1 models only**Constrains effort on reasoning for
reasoning models.

Currently supported values are`low`,`medium`, and`high`. Reducing reasoning effort can result in faster responses and fewer tokens used on reasoning in a response.
Possible values: low, medium, high|No|||||
|logprobs|boolean|Whether to return log probabilities of the output tokens or not. If true, returns the log probabilities of each output token returned in the`content`of`message`.|No|False||||
|top_logprobs|integer|An integer between 0 and 20 specifying the number of most likely tokens to return at each token position, each with an associated log probability.`logprobs`must be set to`true`if this parameter is used.|No|||||
|n|integer|How many chat completion choices to generate for each input message. Note that you will be charged based on the number of generated tokens across all of the choices. Keep`n`as`1`to minimize costs.|No|1||||
|parallel_tool_calls|[ParallelToolCalls](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#paralleltoolcalls)|Whether to enable parallel function calling during tool use.|No|True||||
|response_format|[ResponseFormatText](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#responseformattext) or [ResponseFormatJsonObject](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#responseformatjsonobject) or [ResponseFormatJsonSchema](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#responseformatjsonschema)|An object specifying the format that the model must output. Compatible with [GPT-4o](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-4-and-gpt-4-turbo-models) , [GPT-4o mini](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-4-and-gpt-4-turbo-models) , [GPT-4 Turbo](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-4-and-gpt-4-turbo-models) and all [GPT-3.5](app://obsidian.md/en-us/azure/ai-services/openai/concepts/models#gpt-35) Turbo models newer than`gpt-3.5-turbo-1106`.Setting to`{ "type": "json_schema", "json_schema": {...} }`enables Structured Outputs which guarantees the model will match your supplied JSON schema.

Setting to`{ "type": "json_object" }`enables JSON mode, which guarantees the message the model generates is valid JSON.

**Important:**when using JSON mode, you**must**also instruct the model to produce JSON yourself via a system or user message. Without this, the model may generate an unending stream of whitespace until the generation reaches the token limit, resulting in a long-running and seemingly "stuck" request. Also note that the message content may be partially cut off if`finish_reason="length"`, which indicates the generation exceeded`max_tokens`or the conversation exceeded the max context length.|No|||||
|seed|integer|This feature is in Beta.
If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same`seed`and parameters should return the same result.
Determinism isn't guaranteed, and you should refer to the`system_fingerprint`response parameter to monitor changes in the backend.|No|||||
|stream_options|[chatCompletionStreamOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionstreamoptions)|Options for streaming response. Only set this when you set`stream: true`.|No|None||||
|tools|array|A list of tools the model may call. Currently, only functions are supported as a tool. Use this to provide a list of functions the model may generate JSON inputs for. A max of 128 functions are supported.|No|||||
|tool_choice|[chatCompletionToolChoiceOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletiontoolchoiceoption)|Controls which (if any) tool is called by the model.`none`means the model won't call any tool and instead generates a message.`auto`means the model can pick between generating a message or calling one or more tools.`required`means the model must call one or more tools. Specifying a particular tool via`{"type": "function", "function": {"name": "my_function"}}`forces the model to call that tool.`none`is the default when no tools are present.`auto`is the default if tools are present.|No|||||
|function_call|string or [chatCompletionFunctionCallOption](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionfunctioncalloption)|Deprecated in favor of`tool_choice`.Controls which (if any) function is called by the model.
`none`means the model won't call a function and instead generates a message.
`auto`means the model can pick between generating a message or calling a function.
Specifying a particular function via`{"name": "my_function"}`forces the model to call that function.

`none`is the default when no functions are present.`auto`is the default if functions are present.|No|||||
|functions|array|Deprecated in favor of`tools`.A list of functions the model may generate JSON inputs for.|No|||||
|user_security_context|[userSecurityContext](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#usersecuritycontext)|User security context contains several parameters that describe the AI application itself, and the end user that interacts with the AI application. These fields assist your security operations teams to investigate and mitigate security incidents by providing a comprehensive approach to protecting your AI applications. [Learn more](https://aka.ms/TP4AI/Documentation/EndUserContext)about protecting AI applications using Microsoft Defender for Cloud.|No||and detect abuse.|No||
|modalities|[ChatCompletionModalities](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionmodalities)|Output types that you would like the model to generate for this request.
Most models are capable of generating text, which is the default:`["text"]`

The`gpt-4o-audio-preview`model can also be used to [generate audio](app://obsidian.md/en-us/docs/guides/audio). To
request that this model generate both text and audio responses, you can
use:

`["text", "audio"]`|No|||||
|prediction|[PredictionContent](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#predictioncontent)|Configuration for a [Predicted Output](app://obsidian.md/en-us/docs/guides/predicted-outputs), which can greatly improve response times when large parts of the model response are known ahead of time. This is most common when you are regenerating a file with only minor changes to most of the content.|No|||||
|audio|object|Parameters for audio output. Required when audio output is requested with
`modalities: ["audio"]`. [Learn more](app://obsidian.md/en-us/docs/guides/audio).|No|||||

### Properties for audio

#### voice

|Name|Type|Description|Default|
|---|---|---|---|
|voice|string|Specifies the voice type. Supported voices are`alloy`,`echo`,
`fable`,`onyx`,`nova`, and`shimmer`.||

#### format

|Name|Type|Description|Default|
|---|---|---|---|
|format|string|Specifies the output audio format. Must be one of`wav`,`mp3`,`flac`,
`opus`, or`pcm16`.||

### userSecurityContext

User security context contains several parameters that describe the AI application itself, and the end user that interacts with the AI application. These fields assist your security operations teams to investigate and mitigate security incidents by providing a comprehensive approach to protecting your AI applications.Learn moreabout protecting AI applications using Microsoft Defender for Cloud.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|application_name|string|The name of the application. Sensitive personal information should not be included in this field.|No||
|end_user_id|string|This identifier is the Microsoft Entra ID (formerly Azure Active Directory) user object ID used to authenticate end-users within the generative AI application. Sensitive personal information should not be included in this field.|No||
|end_user_tenant_id|string|The Microsoft 365 tenant ID the end user belongs to. It's required when the generative AI application is multi tenant.|No||
|source_ip|string|Captures the original client's IP address, accepting both IPv4 and IPv6 formats.|No||

### chatCompletionFunctions

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|description|string|A description of what the function does, used by the model to choose when and how to call the function.|No||
|name|string|The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.|Yes||
|parameters|[FunctionParameters](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#functionparameters)|The parameters the functions accepts, described as a JSON Schema object. [See the guide](app://obsidian.md/en-us/azure/ai-services/openai/how-to/function-calling) for examples, and the [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for documentation about the format.Omitting`parameters`defines a function with an empty parameter list.|No||

### chatCompletionFunctionCallOption

Specifying a particular function via`{"name": "my_function"}`forces the model to call that function.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|name|string|The name of the function to call.|Yes||

### chatCompletionFunctionParameters

The parameters the functions accepts, described as a JSON Schema object. See the [guide/](app://obsidian.md/en-us/azure/ai-services/openai/how-to/function-calling) for examples, and theJSON Schema referencefor documentation about the format.

No properties defined for this component.

### chatCompletionRequestMessage

This component can be one of the following:

### ChatCompletionRequestDeveloperMessage

Developer-provided instructions that the model should follow, regardless of messages sent by the user.
With o1 models and newer,`developer`messages replace the previous`system`messages.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|content|string or array|The contents of the developer message.|Yes||
|role|enum|The role of the messages author, in this case`developer`.
Possible values: developer|Yes||
|name|string|An optional name for the participant. Provides the model information to differentiate between participants of the same role.|No||

### chatCompletionRequestSystemMessage

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|content|string or array|The contents of the system message.|Yes||
|role|enum|The role of the messages author, in this case`system`.
Possible values: system|Yes||
|name|string|An optional name for the participant. Provides the model information to differentiate between participants of the same role.|No||

### chatCompletionRequestUserMessage

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|content|string or array|The contents of the user message.|Yes||
|role|enum|The role of the messages author, in this case`user`.
Possible values: user|Yes||
|name|string|An optional name for the participant. Provides the model information to differentiate between participants of the same role.|No||

### chatCompletionRequestAssistantMessage

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|content|string or array|The contents of the assistant message. Required unless`tool_calls`or`function_call`is specified.|No||
|refusal|string|The refusal message by the assistant.|No||
|role|enum|The role of the messages author, in this case`assistant`.
Possible values: assistant|Yes||
|name|string|An optional name for the participant. Provides the model information to differentiate between participants of the same role.|No||
|tool_calls|[chatCompletionMessageToolCalls](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#chatcompletionmessagetoolcalls)|The tool calls generated by the model, such as function calls.|No||
|function_call|object|Deprecated and replaced by`tool_calls`. The name and arguments of a function that should be called, as generated by the model.|No||

### Properties for function_call

#### arguments

|Name|Type|Description|Default|
|---|---|---|---|
|arguments|string|The arguments to call the function with, as generated by the model in JSON format. Note that the model does not always generate valid JSON, and may generate parameters not defined by your function schema. Validate the arguments in your code before calling your function.||

#### name

|Name|Type|Description|Default|
|---|---|---|---|
|name|string|The name of the function to call.||

### chatCompletionRequestToolMessage

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|role|enum|The role of the messages author, in this case`tool`.
Possible values: tool|Yes||
|content|string or array|The contents of the tool message.|Yes||
|tool_call_id|string|Tool call that this message is responding to.|Yes||

### chatCompletionRequestFunctionMessage

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|role|enum|The role of the messages author, in this case`function`.
Possible values: function|Yes||
|content|string|The contents of the function message.|Yes||
|name|string|The name of the function to call.|Yes||

### chatCompletionRequestDeveloperMessageContentPart

This component can be one of the following:

### chatCompletionRequestSystemMessageContentPart

This component can be one of the following:

### chatCompletionRequestUserMessageContentPart

This component can be one of the following:

### chatCompletionRequestAssistantMessageContentPart

This component can be one of the following:

### chatCompletionRequestToolMessageContentPart

This component can be one of the following:

### chatCompletionRequestMessageContentPartText

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|enum|The type of the content part.
Possible values: text|Yes||
|text|string|The text content.|Yes||

### chatCompletionRequestMessageContentPartAudio

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|enum|The type of the content part. Always`input_audio`.
Possible values: input_audio|Yes||
|input_audio|object||Yes||

### Properties for input_audio

#### data

|Name|Type|Description|Default|
|---|---|---|---|
|data|string|Base64 encoded audio data.||

#### format

|Name|Type|Description|Default|
|---|---|---|---|
|format|string|The format of the encoded audio data. Currently supports "wav" and "mp3".||

### chatCompletionRequestMessageContentPartImage

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|enum|The type of the content part.
Possible values: image_url|Yes||
|image_url|object||Yes||

### Properties for image_url

#### url

|Name|Type|Description|Default|
|---|---|---|---|
|url|string|Either a URL of the image or the base64 encoded image data.||

#### detail

|Name|Type|Description|Default|
|---|---|---|---|
|detail|string|Specifies the detail level of the image. Learn more in the [Vision guide](app://obsidian.md/en-us/azure/ai-services/openai/how-to/gpt-with-vision?tabs=rest,system-assigned,resource#detail-parameter-settings-in-image-processing-low-high-auto).|auto|

### chatCompletionRequestMessageContentPartRefusal

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|enum|The type of the content part.
Possible values: refusal|Yes||
|refusal|string|The refusal message generated by the model.|Yes||

### azureChatExtensionConfiguration

A representation of configuration data for a single Azure OpenAI chat extension. This will be used by a chat
completions request that should use Azure OpenAI chat extensions to augment the response behavior.
The use of this configuration is compatible only with Azure OpenAI.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|[azureChatExtensionType](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azurechatextensiontype)|A representation of configuration data for a single Azure OpenAI chat extension. This will be used by a chat
completions request that should use Azure OpenAI chat extensions to augment the response behavior.
The use of this configuration is compatible only with Azure OpenAI.|Yes||

### azureChatExtensionType

A representation of configuration data for a single Azure OpenAI chat extension. This will be used by a chat
completions request that should use Azure OpenAI chat extensions to augment the response behavior.
The use of this configuration is compatible only with Azure OpenAI.

**Description**:   A representation of configuration data for a single Azure OpenAI chat extension. This will be used by a chat
completions request that should use Azure OpenAI chat extensions to augment the response behavior.
The use of this configuration is compatible only with Azure OpenAI.

**Type**: string

**Default**:

**Enum Name**: AzureChatExtensionType

**Enum Values**:

|Value|Description|
|---|---|
|azure_search|Represents the use of Azure Search as an Azure OpenAI chat extension.|
|azure_cosmos_db|Represents the use of Azure Cosmos DB as an Azure OpenAI chat extension.|
|elasticsearch|Represents the use of Elasticsearch® index as an Azure OpenAI chat extension.|
|mongo_db|Represents the use of Mongo DB as an Azure OpenAI chat extension.|
|pinecone|Represents the use of Pinecone index as an Azure OpenAI chat extension.|

### azureSearchChatExtensionConfiguration

A specific representation of configurable options for Azure Search when using it as an Azure OpenAI chat
extension.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|azureChatExtensionType|A representation of configuration data for a single Azure OpenAI chat extension. This will be used by a chat
completions request that should use Azure OpenAI chat extensions to augment the response behavior.
The use of this configuration is compatible only with Azure OpenAI.|Yes||
|parameters|[azureSearchChatExtensionParameters](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azuresearchchatextensionparameters)|Parameters for Azure Search when used as an Azure OpenAI chat extension.|No||

### azureSearchChatExtensionParameters

Parameters for Azure Search when used as an Azure OpenAI chat extension.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|authentication|[onYourDataApiKeyAuthenticationOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdataapikeyauthenticationoptions) or [onYourDataSystemAssignedManagedIdentityAuthenticationOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdatasystemassignedmanagedidentityauthenticationoptions) or [onYourDataUserAssignedManagedIdentityAuthenticationOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdatauserassignedmanagedidentityauthenticationoptions) or [onYourDataAccessTokenAuthenticationOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdataaccesstokenauthenticationoptions)||Yes||
|top_n_documents|integer|The configured top number of documents to feature for the configured query.|No||
|max_search_queries|integer|The max number of rewritten queries that should be sent to search provider for one user message. If not specified, the system will decide the number of queries to send.|No||
|allow_partial_result|boolean|If specified as true, the system will allow partial search results to be used and the request fails if all the queries fail. If not specified, or specified as false, the request will fail if any search query fails.|No|False|
|in_scope|boolean|Whether queries should be restricted to use of indexed data.|No||
|strictness|integer|The configured strictness of the search relevance filtering. The higher of strictness, the higher of the precision but lower recall of the answer.|No||
|endpoint|string|The absolute endpoint path for the Azure Search resource to use.|Yes||
|index_name|string|The name of the index to use as available in the referenced Azure Search resource.|Yes||
|fields_mapping|[azureSearchIndexFieldMappingOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azuresearchindexfieldmappingoptions)|Optional settings to control how fields are processed when using a configured Azure Search resource.|No||
|query_type|[azureSearchQueryType](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azuresearchquerytype)|The type of Azure Search retrieval query that should be executed when using it as an Azure OpenAI chat extension.|No||
|semantic_configuration|string|The additional semantic configuration for the query.|No||
|filter|string|Search filter.|No||
|embedding_dependency|[onYourDataEndpointVectorizationSource](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdataendpointvectorizationsource) or [onYourDataDeploymentNameVectorizationSource](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdatadeploymentnamevectorizationsource) or [onYourDataIntegratedVectorizationSource](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdataintegratedvectorizationsource)||No||
|include_contexts|array|The included properties of the output context. If not specified, the default value is`citations`and`intent`.|No||

### azureSearchIndexFieldMappingOptions

Optional settings to control how fields are processed when using a configured Azure Search resource.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|title_field|string|The name of the index field to use as a title.|No||
|url_field|string|The name of the index field to use as a URL.|No||
|filepath_field|string|The name of the index field to use as a filepath.|No||
|content_fields|array|The names of index fields that should be treated as content.|No||
|content_fields_separator|string|The separator pattern that content fields should use.|No||
|vector_fields|array|The names of fields that represent vector data.|No||
|image_vector_fields|array|The names of fields that represent image vector data.|No||

### azureSearchQueryType

The type of Azure Search retrieval query that should be executed when using it as an Azure OpenAI chat extension.

**Description**: The type of Azure Search retrieval query that should be executed when using it as an Azure OpenAI chat extension.

**Type**: string

**Default**:

**Enum Name**: AzureSearchQueryType

**Enum Values**:

|Value|Description|
|---|---|
|simple|Represents the default, simple query parser.|
|semantic|Represents the semantic query parser for advanced semantic modeling.|
|vector|Represents vector search over computed data.|
|vector_simple_hybrid|Represents a combination of the simple query strategy with vector data.|
|vector_semantic_hybrid|Represents a combination of semantic search and vector data querying.|

### azureCosmosDBChatExtensionConfiguration

A specific representation of configurable options for Azure Cosmos DB when using it as an Azure OpenAI chat
extension.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|type|[azureChatExtensionType](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azurechatextensiontype)|A representation of configuration data for a single Azure OpenAI chat extension. This will be used by a chat
completions request that should use Azure OpenAI chat extensions to augment the response behavior.
The use of this configuration is compatible only with Azure OpenAI.|Yes||
|parameters|[azureCosmosDBChatExtensionParameters](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azurecosmosdbchatextensionparameters)|Parameters to use when configuring Azure OpenAI On Your Data chat extensions when using Azure Cosmos DB for
MongoDB vCore.|No||

### azureCosmosDBChatExtensionParameters

Parameters to use when configuring Azure OpenAI On Your Data chat extensions when using Azure Cosmos DB for
MongoDB vCore.

|Name|Type|Description|Required|Default|
|---|---|---|---|---|
|authentication|[onYourDataConnectionStringAuthenticationOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#onyourdataconnectionstringauthenticationoptions)|The authentication options for Azure OpenAI On Your Data when using a connection string.|Yes||
|top_n_documents|integer|The configured top number of documents to feature for the configured query.|No||
|max_search_queries|integer|The max number of rewritten queries should be send to search provider for one user message. If not specified, the system will decide the number of queries to send.|No||
|allow_partial_result|boolean|If specified as true, the system will allow partial search results to be used and the request fails if all the queries fail. If not specified, or specified as false, the request will fail if any search query fails.|No|False|
|in_scope|boolean|Whether queries should be restricted to use of indexed data.|No||
|strictness|integer|The configured strictness of the search relevance filtering. The higher of strictness, the higher of the precision but lower recall of the answer.|No||
|database_name|string|The MongoDB vCore database name to use with Azure Cosmos DB.|Yes||
|container_name|string|The name of the Azure Cosmos DB resource container.|Yes||
|index_name|string|The MongoDB vCore index name to use with Azure Cosmos DB.|Yes||
|fields_mapping|[azureCosmosDBFieldMappingOptions](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference-preview#azurecosmosdbfieldmappingoptions)|Optional settings to control how fields are processed when using a configured Azure Cosmos DB resource.|Yes||
|embedding_dependency|onYourDataEndpointVectorizationSourceoronYourDataDeploymentNameVectorizationSource||Yes||
|include_contexts|array|The included properties of the output context. If not specified, the default value is`citations`and`intent`.|No||
