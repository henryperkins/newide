This article contains all the monitoring reference information for this service.

See [Monitor Azure OpenAI](app://obsidian.md/how-to/monitor-openai)for details on the data you can collect for Azure OpenAI Service and how to use it.

## Metrics

This section lists all the automatically collected platform metrics for this service. These metrics are also part of the global list of [all platform metrics supported in Azure Monitor](app://obsidian.md/en-us/azure/azure-monitor/reference/supported-metrics/metrics-index#supported-metrics-per-resource-type).

For information on metric retention, see [Azure Monitor Metrics overview](app://obsidian.md/en-us/azure/azure-monitor/essentials/data-platform-metrics#retention-of-metrics).

### Supported metrics for Microsoft.CognitiveServices/accounts

Here are the most important metrics we think you should monitor for Azure OpenAI. Later in this article is a longer list of all available Azure AI services metrics which contains more details on metrics in this shorter list.*Please see below list for most up to date information. We're working on refreshing the tables in the following sections.*

- Azure OpenAI Requests
- Active Tokens
- Generated Completion Tokens
- Processed FineTuned Training Hours
- Processed Inference Tokens
- Processed Prompt Tokens
- Provisioned-managed Utilization V2
- Prompt Token Cache Match Rate
- Time to Response
- Time Between Tokens
- Time to Last Byte
- Normalized Time to First Byte
- Tokens per Second

You can also monitor Content Safety metrics that are used by other Azure AI services.

- Blocked Volume
- Harmful Volume Detected
- Potential Abusive User Count
- Safety System Event
- Total Volume Sent for Safety Check

Note

The**Provisioned-managed Utilization**metric is now deprecated and is no longer recommended. This metric has been replaced by the**Provisioned-managed Utilization V2**metric.
Tokens per Second, Time to Response, Time Between Tokens are currently not available for pay-as-you-go (Standard) deployments.

Cognitive Services metrics have the category**Cognitive Services - HTTP Requests**in the following table. These metrics are legacy metrics that are common to all Azure AI Services resources. Microsoft no longer recommends that you use these metrics with Azure OpenAI.

The following table lists the metrics available for the Microsoft.CognitiveServices/accounts resource type.

- All columns might not be present in every table.
- Some columns might be beyond the viewing area of the page. Select**Expand table**to view all available columns.

**Table headings**

- **Category**- The metrics group or classification.
- **Metric**- The metric display name as it appears in the Azure portal.
- **Name in REST API**- The metric name as referred to in the [REST API](app://obsidian.md/en-us/azure/azure-monitor/essentials/rest-api-walkthrough).
- **Unit**- Unit of measure.
- **Aggregation**- The default [aggregation](app://obsidian.md/en-us/azure/azure-monitor/essentials/metrics-aggregation-explained)type. Valid values: Average (Avg), Minimum (Min), Maximum (Max), Total (Sum), Count.
- **Dimensions**- [Dimensions](app://obsidian.md/en-us/azure/azure-monitor/essentials/metrics-aggregation-explained#dimensions-splitting-and-filtering)available for the metric.
- **Time Grains**- [Intervals](app://obsidian.md/en-us/azure/azure-monitor/essentials/metrics-aggregation-explained#granularity) at which the metric is sampled. For example,`PT1M`indicates that the metric is sampled every minute,`PT30M`every 30 minutes,`PT1H`every hour, and so on.
- **DS Export**- Whether the metric is exportable to Azure Monitor Logs via diagnostic settings. For information on exporting metrics, see [Create diagnostic settings in Azure Monitor](app://obsidian.md/en-us/azure/azure-monitor/essentials/create-diagnostic-settings?tabs=portal).

### Category: Actions

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Action Occurences**Number of times each action appears.|`ActionIdOccurrences`|Count|Total (Sum)|`ActionId`,`Mode`,`RunId`|PT1M|Yes|
|**Actions Per Event**Number of actions per event.|`ActionsPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|

### Category: Azure OpenAI - HTTP Requests

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Prompt Token Cache Match Rate**Percentage of the prompt tokens hit the cache, avaiable for PTU-managed.|`AzureOpenAIContextTokensCacheMatchRate`|Percent|Minimum, Maximum, Average|`Region`,`ModelDeploymentName`,`ModelName`,`ModelVersion`|PT1M|No|
|**Azure OpenAI Requests**Number of calls made to the Azure OpenAI API over a period of time. Applies to PTU, PTU-Managed and Pay-as-you-go deployments. To breakdown API requests, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName, ModelVersion, StatusCode (successful, clienterrors, server errors), StreamType (Streaming vs non-streaming requests) and operation.|`AzureOpenAIRequests`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`StreamType`,`ModelDeploymentName`,`ModelName`,`ModelVersion`,`StatusCode`|PT1M|Yes|
|**Time to Response**Recommended latency (responsiveness) measure for streaming requests. Applies to PTU and PTU-managed deployments. Calculated as time taken for the first response to appear after a user sends a prompt, as measured by the API gateway. This number increases as the prompt size increases and/or cache hit size reduces. To breakdown time to response metric, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName, and ModelVersion.

Note: this metric is an approximation as measured latency is heavily dependent on multiple factors, including concurrent calls and overall workload pattern. In addition, it does not account for any client-side latency that may exist between your client and the API endpoint. Please refer to your own logging for optimal latency tracking.|`AzureOpenAITimeToResponse`|MilliSeconds|Minimum, Maximum, Average|`ApiName`,`OperationName`,`Region`,`StreamType`,`ModelDeploymentName`,`ModelName`,`ModelVersion`,`StatusCode`|PT1M|Yes|

### Category: Azure OpenAI - Usage

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Active Tokens**Total tokens minus cached tokens over a period of time. Applies to PTU and PTU-managed deployments. Use this metric to understand your TPS or TPM based utilization for PTUs and compare to your benchmarks for target TPS or TPM for your scenarios. To breakdown API requests, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName, and ModelVersion.|`ActiveTokens`|Count|Minimum, Maximum, Average, Total (Sum)|`Region`,`ModelDeploymentName`,`ModelName`,`ModelVersion`|PT1M|Yes|
|**Provisioned-managed Utilization**Utilization % for a provisoned-managed deployment, calculated as (PTUs consumed / PTUs deployed) x 100. When utilization is greater than or equal to 100%, calls are throttled and error code 429 returned. To breakdown this metric, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName, ModelVersion and StreamType (Streaming vs non-streaming requests)|`AzureOpenAIProvisionedManagedUtilization`|Percent|Minimum, Maximum, Average|`Region`,`StreamType`,`ModelDeploymentName`,`ModelName`,`ModelVersion`|PT1M|No|
|**Provisioned-managed Utilization V2**Utilization % for a provisoned-managed deployment, calculated as (PTUs consumed / PTUs deployed) x 100. When utilization is greater than or equal to 100%, calls are throttled and error code 429 returned. To breakdown this metric, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName, ModelVersion and StreamType (Streaming vs non-streaming requests)|`AzureOpenAIProvisionedManagedUtilizationV2`|Percent|Minimum, Maximum, Average|`Region`,`StreamType`,`ModelDeploymentName`,`ModelName`,`ModelVersion`|PT1M|No|
|**Processed FineTuned Training Hours**Number of Training Hours Processed on an OpenAI FineTuned Model|`FineTunedTrainingHours`|Count|Total (Sum)|`ApiName`,`ModelDeploymentName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Generated Completion Tokens**Number of tokens generated (output) from an OpenAI model. Applies to PTU, PTU-Managed and Pay-as-you-go deployments. To breakdown this metric, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName and ModelName.|`GeneratedTokens`|Count|Total (Sum)|`ApiName`,`ModelDeploymentName`,`FeatureName`,`UsageChannel`,`Region`,`ModelVersion`|PT1M|Yes|
|**Processed Prompt Tokens**Number of prompt tokens processed (input) on an OpenAI model. Applies to PTU, PTU-Managed and Pay-as-you-go deployments. To breakdown this metric, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName and ModelName.|`ProcessedPromptTokens`|Count|Total (Sum)|`ApiName`,`ModelDeploymentName`,`FeatureName`,`UsageChannel`,`Region`,`ModelVersion`|PT1M|Yes|
|**Processed Inference Tokens**Number of inference tokens processed on an OpenAI model. Calculated as prompt tokens (input) plus generated tokens (output). Applies to PTU, PTU-Managed and Pay-as-you-go deployments. To breakdown this metric, you can add a filter or apply splitting by the following dimensions: ModelDeploymentName and ModelName.|`TokenTransaction`|Count|Total (Sum)|`ApiName`,`ModelDeploymentName`,`FeatureName`,`UsageChannel`,`Region`,`ModelVersion`|PT1M|Yes|

### Category: Cognitive Services - HTTP Requests

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Blocked Calls**Number of calls that exceeded rate or quota limit. Do not use for Azure OpenAI service.|`BlockedCalls`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Client Errors**Number of calls with client side error (HTTP response code 4xx). Do not use for Azure OpenAI service.|`ClientErrors`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Data In**Size of incoming data in bytes. Do not use for Azure OpenAI service.|`DataIn`|Bytes|Total (Sum)|`ApiName`,`OperationName`,`Region`|PT1M|Yes|
|**Data Out**Size of outgoing data in bytes. Do not use for Azure OpenAI service.|`DataOut`|Bytes|Total (Sum)|`ApiName`,`OperationName`,`Region`|PT1M|Yes|
|**Latency**Latency in milliseconds. Do not use for Azure OpenAI service.|`Latency`|MilliSeconds|Average|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Ratelimit**The current ratelimit of the ratelimit key. Do not use for Azure OpenAI service.|`Ratelimit`|Count|Total (Sum)|`Region`,`RatelimitKey`|PT1M|Yes|
|**Server Errors**Number of calls with service internal error (HTTP response code 5xx). Do not use for Azure OpenAI service.|`ServerErrors`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Successful Calls**Number of successful calls. Do not use for Azure OpenAI service.|`SuccessfulCalls`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Total Calls**Total number of calls. Do not use for Azure OpenAI service.|`TotalCalls`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Total Errors**Total number of calls with error response (HTTP response code 4xx or 5xx). Do not use for Azure OpenAI service.|`TotalErrors`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|Yes|
|**Total Token Calls**Total number of token calls.|`TotalTokenCalls`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`|PT1M|Yes|

### Category: Cognitive Services - SLI

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**AvailabilityRate**Availability percentage with the following calculation: (Total Calls - Server Errors)/Total Calls. Server Errors include any HTTP responses >=500. Do not use for Azure OpenAI service.|`SuccessRate`|Percent|Minimum, Maximum, Average|`ApiName`,`OperationName`,`Region`,`RatelimitKey`|PT1M|No|

### Category: ContentSafety - Risks&Safety

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Potentially Abusive User Count**Number of potentially abusive user that detected over a period of time. You can add a filter or apply splitting by the following dimension: ModelDeploymentName.|`RAIAbusiveUsersCount`|Count|Total (Sum)|`Region`,`ModelDeploymentName`|PT1M|Yes|
|**Harmful Volume Detected**Number of calls made to Azure OpenAI API and detected as harmful(both block model and annotate mode) by content filter applied over a period of time. You can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName and TextType.|`RAIHarmfulRequests`|Count|Total (Sum)|`Region`,`ModelDeploymentName`,`ModelName`,`ModelVersion`,`ApiName`,`TextType`,`Category`,`Severity`|PT1M|Yes|
|**Blocked Volume**Number of calls made to Azure OpenAI API and rejected by content filter applied over a period of time. You can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName and TextType.|`RAIRejectedRequests`|Count|Total (Sum)|`Region`,`ModelDeploymentName`,`ModelName`,`ModelVersion`,`ApiName`,`TextType`,`Category`|PT1M|Yes|
|**Safety System Event**System event for risks & safety monitoring. You can add a filter or apply splitting by the following dimension: EventType.|`RAISystemEvent`|Count|Average|`Region`,`EventType`|PT1M|Yes|
|**Total Volume Sent For Safety Check**Number of calls made to Azure OpenAI API and detected by content filter applied over a period of time. You can add a filter or apply splitting by the following dimensions: ModelDeploymentName, ModelName.|`RAITotalRequests`|Count|Total (Sum)|`Region`,`ModelDeploymentName`,`ModelName`,`ModelVersion`,`ApiName`|PT1M|Yes|

### Category: ContentSafety - Usage

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Call Count for Image Moderation**Number of calls for image moderation.|`ContentSafetyImageAnalyzeRequestCount`|Count|Total (Sum)|`ApiVersion`|PT1M|Yes|
|**Call Count for Text Moderation**Number of calls for text moderation.|`ContentSafetyTextAnalyzeRequestCount`|Count|Total (Sum)|`ApiVersion`|PT1M|Yes|

### Category: Estimations

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Baseline Random Event count**Estimation for baseline random event count.|`BaselineRandomEventCount`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Baseline Random Reward**Estimation for baseline random reward.|`BaselineRandomReward`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Online Event Count**Estimation for online event count.|`OnlineEventCount`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Online Reward**Estimation for online reward.|`OnlineReward`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**User Baseline Event Count**Estimation for user defined baseline event count.|`UserBaselineEventCount`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**User Baseline Reward**Estimation for user defined baseline reward.|`UserBaselineReward`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|

### Category: Feature Occurences

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Action Feature Occurrences**Number of times each action feature appears.|`ActionFeatureIdOccurrences`|Count|Total (Sum)|`FeatureId`,`Mode`,`RunId`|PT1M|Yes|
|**Context Feature Occurrences**Number of times each context feature appears.|`ContextFeatureIdOccurrences`|Count|Total (Sum)|`FeatureId`,`Mode`,`RunId`|PT1M|Yes|
|**Slot Feature Occurrences**Number of times each slot feature appears.|`SlotFeatureIdOccurrences`|Count|Total (Sum)|`FeatureId`,`Mode`,`RunId`|PT1M|Yes|

### Category: FeatureCardinality

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Feature Cardinality by Action**Feature Cardinality based on Action.|`FeatureCardinality_Action`|Count|Average|`FeatureId`,`Mode`,`RunId`|PT1M|Yes|
|**Feature Cardinality by Context**Feature Cardinality based on Context.|`FeatureCardinality_Context`|Count|Average|`FeatureId`,`Mode`,`RunId`|PT1M|Yes|
|**Feature Cardinality by Slot**Feature Cardinality based on Slot.|`FeatureCardinality_Slot`|Count|Average|`FeatureId`,`Mode`,`RunId`|PT1M|Yes|

### Category: Features Per Event

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Action Features Per Event**Average number of action features per event.|`ActionFeaturesPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Context Features Per Event**Number of context features per event.|`ContextFeaturesPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Slot Features Per Event**Average number of slot features per event.|`SlotFeaturesPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|

### Category: Namespaces Per Event

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Action Namespaces Per Event**Average number of action namespaces per event.|`ActionNamespacesPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Context Namespaces Per Event**Number of context namespaces per event.|`ContextNamespacesPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Slot Namespaces Per Event**Average number of slot namespaces per event.|`SlotNamespacesPerEvent`|Count|Average|`Mode`,`RunId`|PT1M|Yes|

### Category: Rewards

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Average Reward Per Event**Average reward per event.|`Reward`|Count|Average|`BaselineAction`,`ChosenActionId`,`MatchesBaseline`,`NonDefaultReward`,`Mode`,`RunId`|PT1M|Yes|
|**Slot Reward**Reward per slot.|`SlotReward`|Count|Average|`BaselineActionId`,`ChosenActionId`,`MatchesBaseline`,`NonDefaultReward`,`SlotId`,`SlotIndex`,`Mode`,`RunId`|PT1M|Yes|

### Category: Slots

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Baseline Estimator Overall Reward**Baseline Estimator Overall Reward.|`BaselineEstimatorOverallReward`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Baseline Estimator Slot Reward**Baseline Estimator Reward by slot.|`BaselineEstimatorSlotReward`|Count|Average|`SlotId`,`SlotIndex`,`Mode`,`RunId`|PT1M|Yes|
|**Baseline Random Estimator Overall Reward**Baseline Random Estimator Overall Reward.|`BaselineRandomEstimatorOverallReward`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Baseline Random Estimator Slot Reward**Baseline Random Estimator Reward by slot.|`BaselineRandomEstimatorSlotReward`|Count|Average|`SlotId`,`SlotIndex`,`Mode`,`RunId`|PT1M|Yes|
|**Slots**Number of slots per event.|`NumberOfSlots`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Online Estimator Overall Reward**Online Estimator Overall Reward.|`OnlineEstimatorOverallReward`|Count|Average|`Mode`,`RunId`|PT1M|Yes|
|**Online Estimator Slot Reward**Online Estimator Reward by slot.|`OnlineEstimatorSlotReward`|Count|Average|`SlotId`,`SlotIndex`,`Mode`,`RunId`|PT1M|Yes|
|**Slot Occurrences**Number of times each slot appears.|`SlotIdOccurrences`|Count|Total (Sum)|`SlotId`,`SlotIndex`,`Mode`,`RunId`|PT1M|Yes|

### Category: SpeechServices - Usage

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Audio Seconds Transcribed**Number of seconds transcribed|`AudioSecondsTranscribed`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Audio Seconds Translated**Number of seconds translated|`AudioSecondsTranslated`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Avatar Model Hosting Seconds**Number of Seconds.|`AvatarModelHostingSeconds`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Number of Speaker Profiles**Number of speaker profiles enrolled. Prorated hourly.|`NumberofSpeakerProfiles`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Speaker Recognition Transactions**Number of speaker recognition transactions|`SpeakerRecognitionTransactions`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Speech Model Hosting Hours**Number of speech model hosting hours|`SpeechModelHostingHours`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Synthesized Characters**Number of Characters.|`SynthesizedCharacters`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Video Seconds Synthesized**Number of seconds synthesized|`VideoSecondsSynthesized`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Voice Model Hosting Hours**Number of Hours.|`VoiceModelHostingHours`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Voice Model Training Minutes**Number of Minutes.|`VoiceModelTrainingMinutes`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|

### Category: Usage

|Metric|Name in REST API|Unit|Aggregation|Dimensions|Time Grains|DS Export|
|---|---|---|---|---|---|---|
|**Inference Count**Inference Count of Carnegie Frontdoor Service|`CarnegieInferenceCount`|Count|Total (Sum)|`Region`,`Modality`,`Category`,`Language`,`SeverityLevel`,`UseCustomList`|PT1M|Yes|
|**Characters Trained (Deprecated)**Total number of characters trained.|`CharactersTrained`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`|PT1M|Yes|
|**Characters Translated (Deprecated)**Total number of characters in incoming text request.|`CharactersTranslated`|Count|Total (Sum)|`ApiName`,`OperationName`,`Region`|PT1M|Yes|
|**Computer Vision Transactions**Number of Computer Vision Transactions|`ComputerVisionTransactions`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Custom Vision Training Time**Custom Vision training time|`CustomVisionTrainingTime`|Seconds|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Custom Vision Transactions**Number of Custom Vision prediction transactions|`CustomVisionTransactions`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Document Characters Translated**Number of characters in document translation request.|`DocumentCharactersTranslated`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Document Custom Characters Translated**Number of characters in custom document translation request.|`DocumentCustomCharactersTranslated`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Face Images Trained**Number of images trained. 1,000 images trained per transaction.|`FaceImagesTrained`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Faces Stored**Number of faces stored, prorated daily. The number of faces stored is reported daily.|`FacesStored`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Face Transactions**Number of API calls made to Face service|`FaceTransactions`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Images Stored**Number of Custom Vision images stored.|`ImagesStored`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Learned Events**Number of Learned Events.|`LearnedEvents`|Count|Total (Sum)|`IsMatchBaseline`,`Mode`,`RunId`|PT1M|Yes|
|**LUIS Speech Requests**Number of LUIS speech to intent understanding requests|`LUISSpeechRequests`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**LUIS Text Requests**Number of LUIS text requests|`LUISTextRequests`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Matched Rewards**Number of Matched Rewards.|`MatchedRewards`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Non Activated Events**Number of skipped events.|`NonActivatedEvents`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Observed Rewards**Number of Observed Rewards.|`ObservedRewards`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Document Sync Characters Translated**Number of characters in document translation (synchronous) request.|`OneDocumentCharactersTranslated`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Processed Characters**Number of Characters processed by Immersive Reader.|`ProcessedCharacters`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Processed Health Text Records**Number of health text records processed|`ProcessedHealthTextRecords`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Processed Images**Number of images processed|`ProcessedImages`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Processed Pages**Number of pages processed|`ProcessedPages`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Processed Text Records**Count of Text Records.|`ProcessedTextRecords`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**QA Text Records**Number of text records processed|`QuestionAnsweringTextRecords`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Speech Session Duration (Deprecated)**Total duration of speech session in seconds.|`SpeechSessionDuration`|Seconds|Total (Sum)|`ApiName`,`OperationName`,`Region`|PT1M|Yes|
|**Text Characters Translated**Number of characters in incoming text translation request.|`TextCharactersTranslated`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Text Custom Characters Translated**Number of characters in incoming custom text translation request.|`TextCustomCharactersTranslated`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Text Trained Characters**Number of characters trained using text translation.|`TextTrainedCharacters`|Count|Total (Sum)|`ApiName`,`FeatureName`,`UsageChannel`,`Region`|PT1M|Yes|
|**Total Events**Number of events.|`TotalEvents`|Count|Total (Sum)|`Mode`,`RunId`|PT1M|Yes|
|**Total Transactions (Deprecated)**Total number of transactions.|`TotalTransactions`|Count|Total (Sum)|<none>|PT1M|Yes|

## Metric dimensions

For information about what metric dimensions are, see [Multi-dimensional metrics](app://obsidian.md/en-us/azure/azure-monitor/platform/data-platform-metrics#multi-dimensional-metrics).

This service has the following dimensions associated with its metrics.

- ApiName
- FeatureName
- ModelDeploymentName
- ModelName
- ModelVersion
- OperationName
- Region
- StatusCode
- StreamType
- UsageChannel

## Resource logs

This section lists the types of resource logs you can collect for this service. The section pulls from the list of [all resource logs category types supported in Azure Monitor](app://obsidian.md/en-us/azure/azure-monitor/platform/resource-logs-schema).

### Supported resource logs for Microsoft.CognitiveServices/accounts

|Category|Category display name|Log table|[Supports basic log plan](app://obsidian.md/en-us/azure/azure-monitor/logs/basic-logs-configure?tabs=portal-1#compare-the-basic-and-analytics-log-data-plans)|[Supports ingestion-time transformation](app://obsidian.md/en-us/azure/azure-monitor/essentials/data-collection-transformations)|Example queries|Costs to export|
|---|---|---|---|---|---|---|
|`Audit`|Audit Logs|[AzureDiagnostics](app://obsidian.md/en-us/azure/azure-monitor/reference/tables/azurediagnostics)Logs from multiple Azure resources.|No|No||No|
|`RequestResponse`|Request and Response Logs|AzureDiagnosticsLogs from multiple Azure resources.|No|No||No|
|`Trace`|Trace Logs|AzureDiagnosticsLogs from multiple Azure resources.|No|No||No|

## Azure Monitor Logs tables

This section lists the Azure Monitor Logs tables relevant to this service, which are available for query by Log Analytics using Kusto queries. The tables contain resource log data and possibly more depending on what is collected and routed to them.

### Azure OpenAI microsoft.cognitiveservices/accounts

- [AzureActivity](app://obsidian.md/en-us/azure/azure-monitor/reference/tables/azureactivity#columns)
- [AzureMetrics](app://obsidian.md/en-us/azure/azure-monitor/reference/tables/azuremetrics#columns)
- [AzureDiagnostics](app://obsidian.md/en-us/azure/azure-monitor/reference/tables/azurediagnostics#columns)

## Activity log

The linked table lists the operations that can be recorded in the activity log for this service. These operations are a subset of [all the possible resource provider operations in the activity log](app://obsidian.md/en-us/azure/role-based-access-control/resource-provider-operations).

For more information on the schema of activity log entries, see [Activity Log schema](app://obsidian.md/en-us/azure/azure-monitor/essentials/activity-log-schema).

- [AI + machine learning resource provider operations](app://obsidian.md/en-us/azure/role-based-access-control/resource-provider-operations#microsoftsearch)

## Related content

- See [Monitor Azure OpenAI](app://obsidian.md/how-to/monitor-openai)for a description of monitoring Azure OpenAI.
- See [Monitor Azure resources with Azure Monitor](app://obsidian.md/en-us/azure/azure-monitor/essentials/monitor-azure-resource)for details on monitoring Azure resources.

---

## Feedback

## Additional resources

### In this article