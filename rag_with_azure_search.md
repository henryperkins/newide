https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/search/search-get-started-rag.md

---
# Quickstart: Generative search (RAG) with grounding data from Azure AI Search

This quickstart shows you how to send queries to a chat completion model for a conversational search experience over your indexed content on Azure AI Search. You use the Azure portal to set up the resources, and then run Python code to call the APIs. 

## Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/download) with the [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) and the [Jupyter package](https://pypi.org/project/jupyter/). For more information, see [Python in Visual Studio Code](https://code.visualstudio.com/docs/languages/python).

- An Azure subscription with permissions to assign roles. [Create one for free](https://azure.microsoft.com/free/).

- [Azure OpenAI](/azure/ai-services/openai/how-to/create-resource)

  - [Choose a region](/azure/ai-services/openai/concepts/models?tabs=global-standard%2Cstandard-chat-completions#global-standard-model-availability) that supports the chat completion model you want to use (gpt-4o, gpt-4o-mini, or equivalent model). 
  - [Deploy the chat completion model](/azure/ai-studio/how-to/deploy-models-openai) in Azure AI Foundry or [use another approach](/azure/ai-services/openai/how-to/working-with-models).

- [Azure AI Search](search-create-service-portal.md)

  - Same region as Azure OpenAI.
  - Basic tier or higher is recommended.
  - [Enable semantic ranking](semantic-how-to-enable-disable.md).
  - [Enable role-based access control (see below)](#configure-access).

To meet the same-region requirement, start by reviewing the [regions for the chat model](/azure/ai-services/openai/concepts/models#model-summary-table-and-region-availability) you want to use. Once you identify a region, confirm that Azure AI Search is available in the [same region](search-region-support.md#azure-public-regions).

Make sure you know the name of the deployed model, and have the endpoints for both Azure resources at hand. You'll provide this information in the steps that follow.

## Download file

[Download a Jupyter notebook](https://github.com/Azure-Samples/azure-search-python-samples/tree/main/Quickstart-RAG) from GitHub to send the requests in this quickstart. For more information, see [Downloading files from GitHub](https://docs.github.com/get-started/start-your-journey/downloading-files-from-github).

You can also start a new file on your local system and create requests manually by using the instructions in this article. 

## Configure access

Requests to the search endpoint must be authenticated and authorized. You can use API keys or roles for this task. Keys are easier to start with, but roles are more secure. This quickstart assumes roles.

You're setting up two clients, so you need permissions on both resources.

Azure AI Search is receiving the query request from your local system. Assign yourself the **Search Index Data Reader** role assignment if the hotels sample index already exists. If it doesn't exist, assign yourself **Search Service Contributor** and **Search Index Data Contributor** roles so that you can create and query the index.

Azure OpenAI is receiving the query and the search results from your local system. Assign yourself the **Cognitive Services OpenAI User** role on Azure OpenAI.

1. Sign in to the [Azure portal](https://portal.azure.com).

2. Configure Azure AI Search for role-based access:

    1. In the Azure portal, find your Azure AI Search service.

    2. On the left menu, select **Settings** > **Keys**, and then select either **Role-based access control** or **Both**.

3. Assign roles:

    3. On the left menu, select **Access control (IAM)**.

    4. On Azure AI Search, select these roles to create, load, and query a search index, and then assign them to your Microsoft Entra ID user identity:

       - **Search Index Data Contributor**
       - **Search Service Contributor**

    5. On Azure OpenAI, select **Access control (IAM)** to assign this role to yourself on Azure OpenAI:

       - **Cognitive Services OpenAI User**

It can take several minutes for permissions to take effect.

## Create an index

A search index provides grounding data for the chat model. We recommend the hotels-sample-index, which can be created in minutes and runs on any search service tier. This index is created using built-in sample data.

4. In the Azure portal, [find your search service](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Search%2FsearchServices).

5. On the **Overview** home page, select [**Import data**](search-get-started-portal.md) to start the wizard.

6. On the **Connect to your data** page, select **Samples** from the dropdown list.

7. Choose the **hotels-sample**.

8. Select **Next** through the remaining pages, accepting the default values.

9. Once the index is created, select **Search management** > **Indexes** from the left menu to open the index.

10. Select **Edit JSON**. 

11. Scroll to the end of the index, where you can find placeholders for constructs that can be added to an index.

   ```json
   "analyzers": [],
   "tokenizers": [],
   "tokenFilters": [],
   "charFilters": [],
   "normalizers": [],
   ```

12. On a new line after "normalizers", paste in the following semantic configuration. This example specifies a `"defaultConfiguration"`, which is important to the running of this quickstart.

    ```json
    "semantic":{
       "defaultConfiguration":"semantic-config",
       "configurations":[
          {
             "name":"semantic-config",
             "prioritizedFields":{
                "titleField":{
                   "fieldName":"HotelName"
                },
                "prioritizedContentFields":[
                   {
                      "fieldName":"Description"
                   }
                ],
                "prioritizedKeywordsFields":[
                   {
                      "fieldName":"Category"
                   },
                   {
                      "fieldName":"Tags"
                   }
                ]
             }
          }
       ]
    },
    ```

13. **Save** your changes.

14. Run the following query in [Search Explorer](search-explorer.md) to test your index: `complimentary breakfast`.

   Output should look similar to the following example. Results that are returned directly from the search engine consist of fields and their verbatim values, along with metadata like a search score and a semantic ranking score and caption if you use semantic ranker. We used a [select statement](search-query-odata-select.md) to return just the HotelName, Description, and Tags fields.

   ```
   {
   "@odata.count": 18,
   "@search.answers": [],
   "value": [
      {
         "@search.score": 2.2896252,
         "@search.rerankerScore": 2.506816864013672,
         "@search.captions": [
         {
            "text": "Head Wind Resort. Suite. coffee in lobby\r\nfree wifi\r\nview. The best of old town hospitality combined with views of the river and cool breezes off the prairie. Our penthouse suites offer views for miles and the rooftop plaza is open to all guests from sunset to 10 p.m. Enjoy a **complimentary continental breakfast** in the lobby, and free Wi-Fi throughout the hotel..",
            "highlights": ""
         }
         ],
         "HotelName": "Head Wind Resort",
         "Description": "The best of old town hospitality combined with views of the river and cool breezes off the prairie. Our penthouse suites offer views for miles and the rooftop plaza is open to all guests from sunset to 10 p.m. Enjoy a complimentary continental breakfast in the lobby, and free Wi-Fi throughout the hotel.",
         "Tags": [
         "coffee in lobby",
         "free wifi",
         "view"
         ]
      },
      {
         "@search.score": 2.2158256,
         "@search.rerankerScore": 2.288334846496582,
         "@search.captions": [
         {
            "text": "Swan Bird Lake Inn. Budget. continental breakfast\r\nfree wifi\r\n24-hour front desk service. We serve a continental-style breakfast each morning, featuring a variety of food and drinks. Our locally made, oh-so-soft, caramel cinnamon rolls are a favorite with our guests. Other breakfast items include coffee, orange juice, milk, cereal, instant oatmeal, bagels, and muffins..",
            "highlights": ""
         }
         ],
         "HotelName": "Swan Bird Lake Inn",
         "Description": "We serve a continental-style breakfast each morning, featuring a variety of food and drinks. Our locally made, oh-so-soft, caramel cinnamon rolls are a favorite with our guests. Other breakfast items include coffee, orange juice, milk, cereal, instant oatmeal, bagels, and muffins.",
         "Tags": [
         "continental breakfast",
         "free wifi",
         "24-hour front desk service"
         ]
      },
      {
         "@search.score": 0.92481667,
         "@search.rerankerScore": 2.221315860748291,
         "@search.captions": [
         {
            "text": "White Mountain Lodge & Suites. Resort and Spa. continental breakfast\r\npool\r\nrestaurant. Live amongst the trees in the heart of the forest. Hike along our extensive trail system. Visit the Natural Hot Springs, or enjoy our signature hot stone massage in the Cathedral of Firs. Relax in the meditation gardens, or join new friends around the communal firepit. Weekend evening entertainment on the patio features special guest musicians or poetry readings..",
            "highlights": ""
         }
         ],
         "HotelName": "White Mountain Lodge & Suites",
         "Description": "Live amongst the trees in the heart of the forest. Hike along our extensive trail system. Visit the Natural Hot Springs, or enjoy our signature hot stone massage in the Cathedral of Firs. Relax in the meditation gardens, or join new friends around the communal firepit. Weekend evening entertainment on the patio features special guest musicians or poetry readings.",
         "Tags": [
         "continental breakfast",
         "pool",
         "restaurant"
         ]
      },
      . . .
   ]}
   ```

## Get service endpoints

In the remaining sections, you set up API calls to Azure OpenAI and Azure AI Search. Get the service endpoints so that you can provide them as variables in your code.

15. Sign in to the [Azure portal](https://portal.azure.com).

16. [Find your search service](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Search%2FsearchServices).

17. On the **Overview** home page, copy the URL. An example endpoint might look like `https://example.search.windows.net`. 

18. [Find your Azure OpenAI service](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.CognitiveServices%2Faccounts).

19. On the **Overview** home page, select the link to view the endpoints. Copy the URL. An example endpoint might look like `https://example.openai.azure.com/`.

## Create a virtual environment

In this step, switch back to your local system and Visual Studio Code. We recommend that you create a virtual environment so that you can install the dependencies in isolation.

20. In Visual Studio Code, open the folder containing Quickstart-RAG.ipynb.

21. Press Ctrl-shift-P to open the command palette, search for "Python: Create Environment", and then select `Venv` to create a virtual environment in the current workspace.

22. Select Quickstart-RAG\requirements.txt for the dependencies.

It takes several minutes to create the environment. When the environment is ready, continue to the next step.

## Sign in to Azure

You're using Microsoft Entra ID and role assignments for the connection. Make sure you're logged in to the same tenant and subscription as Azure AI Search and Azure OpenAI. You can use the Azure CLI on the command line to show current properties, change properties, and to sign in. For more information, see [Connect without keys](search-get-started-rbac.md). 

Run each of the following commands in sequence.

```azure-cli
az account show

az account set --subscription <PUT YOUR SUBSCRIPTION ID HERE>

az login --tenant <PUT YOUR TENANT ID HERE>
```

You should now be logged in to Azure from your local device.

## Set up the query and chat thread

This section uses Visual Studio Code and Python to call the chat completion APIs on Azure OpenAI.

23. Start Visual Studio Code and [open the .ipynb file](https://github.com/Azure-Samples/azure-search-python-samples/tree/main/Quickstart-RAG) or create a new Python file.

24. Install the following Python packages.

   ```python
   ! pip install azure-search-documents==11.6.0b5 --quiet
   ! pip install azure-identity==1.16.1 --quiet
   ! pip install openai --quiet
   ! pip install aiohttp --quiet
   ! pip install ipykernel --quiet
   ```

25. Set the following variables, substituting placeholders with the endpoints you collected in the previous step. 

   ```python
    AZURE_SEARCH_SERVICE: str = "PUT YOUR SEARCH SERVICE ENDPOINT HERE"
    AZURE_OPENAI_ACCOUNT: str = "PUT YOUR AZURE OPENAI ENDPOINT HERE"
    AZURE_DEPLOYMENT_MODEL: str = "gpt-4o"
   ```

26. Set up clients, the prompt, query, and response.

   For the Azure Government cloud, modify the API endpoint on the token provider to `"https://cognitiveservices.azure.us/.default"`.

   ```python
   # Set up the query for generating responses
    from azure.identity import DefaultAzureCredential
    from azure.identity import get_bearer_token_provider
    from azure.search.documents import SearchClient
    from openai import AzureOpenAI
    
    credential = DefaultAzureCredential()
    token_provider = get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default")
    openai_client = AzureOpenAI(
        api_version="2024-06-01",
        azure_endpoint=AZURE_OPENAI_ACCOUNT,
        azure_ad_token_provider=token_provider
    )
    
    search_client = SearchClient(
        endpoint=AZURE_SEARCH_SERVICE,
        index_name="hotels-sample-index",
        credential=credential
    )
    
    # This prompt provides instructions to the model
    GROUNDED_PROMPT="""
    You are a friendly assistant that recommends hotels based on activities and amenities.
    Answer the query using only the sources provided below in a friendly and concise bulleted manner.
    Answer ONLY with the facts listed in the list of sources below.
    If there isn't enough information below, say you don't know.
    Do not generate answers that don't use the sources below.
    Query: {query}
    Sources:\n{sources}
    """
    
    # Query is the question being asked. It's sent to the search engine and the chat model
    query="Can you recommend a few hotels with complimentary breakfast?"
    
    # Search results are created by the search client
    # Search results are composed of the top 5 results and the fields selected from the search index
    # Search results include the top 5 matches to your query
    search_results = search_client.search(
        search_text=query,
        top=5,
        select="Description,HotelName,Tags"
    )
    sources_formatted = "\n".join([f'{document["HotelName"]}:{document["Description"]}:{document["Tags"]}' for document in search_results])
    
    # Send the search results and the query to the LLM to generate a response based on the prompt.
    response = openai_client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": GROUNDED_PROMPT.format(query=query, sources=sources_formatted)
            }
        ],
        model=AZURE_DEPLOYMENT_MODEL
    )
    
    # Here is the response from the chat model.
    print(response.choices[0].message.content)
    ```

    Output is from Azure OpenAI, and it consists of recommendations for several hotels. Here's an example of what the output might look like:

    ```
   Sure! Here are a few hotels that offer complimentary breakfast:
   
   - **Head Wind Resort**
   - Complimentary continental breakfast in the lobby
   - Free Wi-Fi throughout the hotel
   
   - **Double Sanctuary Resort**
   - Continental breakfast included
   
   - **White Mountain Lodge & Suites**
   - Continental breakfast available
   
   - **Swan Bird Lake Inn**
   - Continental-style breakfast each morning with a variety of food and drinks 
     such as caramel cinnamon rolls, coffee, orange juice, milk, cereal, 
     instant oatmeal, bagels, and muffins
    ```

    If you get a **Forbidden** error message, check Azure AI Search configuration to make sure role-based access is enabled.

    If you get an **Authorization failed** error message, wait a few minutes and try again. It can take several minutes for role assignments to become operational.

    If you get a **Resource not found** error message, check the resource URIs and make sure the API version on the chat model is valid.

    Otherwise, to experiment further, change the query and rerun the last step to better understand how the model works with the grounding data.

    You can also modify the prompt to change the tone or structure of the output.

    You might also try the query without semantic ranking by setting `use_semantic_reranker=False` in the query parameters step. Semantic ranking can noticably improve the relevance of query results and the ability of the LLM to return useful information. Experimentation can help you decide whether it makes a difference for your content.

## Send a complex RAG query

Azure AI Search supports [complex types](search-howto-complex-data-types.md) for nested JSON structures. In the hotels-sample-index, `Address` is an example of a complex type, consisting of `Address.StreetAddress`, `Address.City`, `Address.StateProvince`, `Address.PostalCode`, and `Address.Country`. The index also has complex collection of `Rooms` for each hotel.

If your index has complex types, your query can provide those fields if you first convert the search results output to JSON, and then pass the JSON to the chat model. The following example adds complex types to the request. The formatting instructions include a JSON specification.

```python
import json

# Query is the question being asked. It's sent to the search engine and the LLM.
query="Can you recommend a few hotels that offer complimentary breakfast? 
Tell me their description, address, tags, and the rate for one room that sleeps 4 people."

# Set up the search results and the chat thread.
# Retrieve the selected fields from the search index related to the question.
selected_fields = ["HotelName","Description","Address","Rooms","Tags"]
search_results = search_client.search(
    search_text=query,
    top=5,
    select=selected_fields,
    query_type="semantic"
)
sources_filtered = [{field: result[field] for field in selected_fields} for result in search_results]
sources_formatted = "\n".join([json.dumps(source) for source in sources_filtered])

response = openai_client.chat.completions.create(
    messages=[
        {
            "role": "user",
            "content": GROUNDED_PROMPT.format(query=query, sources=sources_formatted)
        }
    ],
    model=AZURE_DEPLOYMENT_MODEL
)

print(response.choices[0].message.content)
```

Output is from Azure OpenAI, and it adds content from complex types.

```
Here are a few hotels that offer complimentary breakfast and have rooms that sleep 4 people:

27. **Head Wind Resort**
   - **Description:** The best of old town hospitality combined with views of the river and 
   cool breezes off the prairie. Enjoy a complimentary continental breakfast in the lobby, 
   and free Wi-Fi throughout the hotel.
   - **Address:** 7633 E 63rd Pl, Tulsa, OK 74133, USA
   - **Tags:** Coffee in lobby, free Wi-Fi, view
   - **Room for 4:** Suite, 2 Queen Beds (Amenities) - $254.99

28. **Double Sanctuary Resort**
   - **Description:** 5-star Luxury Hotel - Biggest Rooms in the city. #1 Hotel in the area 
   listed by Traveler magazine. Free WiFi, Flexible check in/out, Fitness Center & espresso 
   in room. Offers continental breakfast.
   - **Address:** 2211 Elliott Ave, Seattle, WA 98121, USA
   - **Tags:** View, pool, restaurant, bar, continental breakfast
   - **Room for 4:** Suite, 2 Queen Beds (Amenities) - $254.99

29. **Swan Bird Lake Inn**
   - **Description:** Continental-style breakfast featuring a variety of food and drinks. 
   Locally made caramel cinnamon rolls are a favorite.
   - **Address:** 1 Memorial Dr, Cambridge, MA 02142, USA
   - **Tags:** Continental breakfast, free Wi-Fi, 24-hour front desk service
   - **Room for 4:** Budget Room, 2 Queen Beds (City View) - $85.99

30. **Gastronomic Landscape Hotel**
   - **Description:** Known for its culinary excellence under the management of William Dough, 
   offers continental breakfast.
   - **Address:** 3393 Peachtree Rd, Atlanta, GA 30326, USA
   - **Tags:** Restaurant, bar, continental breakfast
   - **Room for 4:** Budget Room, 2 Queen Beds (Amenities) - $66.99
...
   - **Tags:** Pool, continental breakfast, free parking
   - **Room for 4:** Budget Room, 2 Queen Beds (Amenities) - $60.99

Enjoy your stay! Let me know if you need any more information.
```

## Troubleshooting errors

To debug authentication errors, insert the following code before the step that calls the search engine and the LLM.

```python
import sys
import logging # Set the logging level for all azure-storage-* libraries
logger = logging.getLogger('azure.identity') 
logger.setLevel(logging.DEBUG)

handler = logging.StreamHandler(stream=sys.stdout)
formatter = logging.Formatter('[%(levelname)s %(name)s] %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)
```

Rerun the query script. You should now get INFO and DEBUG statements in the output that provide more detail about the issue.

If you see output messages related to ManagedIdentityCredential and token acquisition failures, it could be that you have multiple tenants, and your Azure sign-in is using a tenant that doesn't have your search service. To get your tenant ID, search the Azure portal for "tenant properties" or run `az login tenant list`.

Once you have your tenant ID, run `az login --tenant <YOUR-TENANT-ID>` at a command prompt, and then rerun the script.

## Clean up

When you're working in your own subscription, it's a good idea at the end of a project to identify whether you still need the resources you created. Resources left running can cost you money. You can delete resources individually or delete the resource group to delete the entire set of resources.

You can find and manage resources in the Azure portal by using the **All resources** or **Resource groups** link in the leftmost pane.

## See also

- [Tutorial: How to build a RAG solution in Azure AI Search](tutorial-rag-build-solution.md)

---

https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/search/search-get-started-skillset.md

---
title: "Quickstart: Create a skillset in the Azure portal"
titleSuffix: Azure AI Search
description: Learn how to use the Import Data wizard to generate searchable text from images and unstructured documents. Skills in this quickstart include OCR, image analysis, and natural language processing.

manager: nitinme
author: HeidiSteen
ms.author: heidist
ms.service: azure-ai-search
ms.custom:
  - ignite-2023
ms.topic: quickstart
ms.date: 11/20/2024
---

# Quickstart: Create a skillset in the Azure portal

In this quickstart, you learn how a skillset in Azure AI Search adds optical character recognition (OCR), image analysis, language detection, text translation, and entity recognition to generate text-searchable content in a search index.

You can run the **Import data** wizard in the Azure portal to apply skills that create and transform textual content during indexing. Input is your raw data, usually blobs in Azure Storage. Output is a searchable index containing AI-generated image text, captions, and entities. Generated content is queryable in the Azure portal using [**Search explorer**](search-explorer.md).

To prepare, you create a few resources and upload sample files before running the wizard.

## Prerequisites

+ An Azure account with an active subscription. [Create an account for free](https://azure.microsoft.com/free/).

+ Create an [Azure AI Search service](search-create-service-portal.md) or [find an existing service](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Search%2FsearchServices). You can use a free service for this quickstart. 

+ An Azure Storage account with Azure Blob Storage.

> [!NOTE]
> This quickstart uses [Azure AI services](https://azure.microsoft.com/services/cognitive-services/) for the AI transformations. Because the workload is so small, Azure AI services is tapped behind the scenes for free processing for up to 20 transactions. You can complete this exercise without having to create an Azure AI multi-service resource.

## Set up your data

In the following steps, set up a blob container in Azure Storage to store heterogeneous content files.

1. [Download sample data](https://github.com/Azure-Samples/azure-search-sample-data/tree/main/ai-enrichment-mixed-media) consisting of a small file set of different types. 

2. Sign in to the [Azure portal](https://portal.azure.com/) with your Azure account.

3. [Create an Azure Storage account](/azure/storage/common/storage-account-create?tabs=azure-portal) or [find an existing account](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Storage%2storageAccounts/). 

   + Choose the same region as Azure AI Search to avoid bandwidth charges. 

   + Choose the StorageV2 (general purpose V2).

4. In Azure portal, open your Azure Storage page and create a container. You can use the default access level. 

5. In Container, select **Upload** to upload the sample files. Notice that you have a wide range of content types, including images and application files that aren't full text searchable in their native formats.

   ==:image type="content" source="media/search-get-started-skillset/sample-data.png" alt-text="Screenshot of source files in Azure Blob Storage." border="false"==:

You're now ready to move on the Import data wizard.

## Run the Import data wizard

6. Sign in to the [Azure portal](https://portal.azure.com/) with your Azure account.

7. [Find your search service](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Search%2FsearchServices). On the Overview page, select **Import data** on the command bar to create searchable content in four steps.

   ==:image type="content" source="media/search-import-data-portal/import-data-cmd.png" alt-text="Screenshot of the Import data command." border="true"==:

### Step 1: Create a data source

8. In **Connect to your data**, choose **Azure Blob Storage**.

9. Choose an existing connection to the storage account and select the container you created. Give the data source a name, and use default values for the rest. 

   ==:image type="content" source="media/search-get-started-skillset/blob-datasource.png" alt-text="Screenshot of the data source definition page." border="true"==:

    Continue to the next page.

If you get *Error detecting index schema from data source*, the indexer that powers the wizard can't connect to your data source. Most likely, the data source has security protections. Try the following solutions and then rerun the wizard.

| Security feature | Solution |
|--------------------|----------|
| Resource requires Azure roles, or its access keys are disabled | [Connect as a trusted service](search-indexer-howto-access-trusted-service-exception.md) or [connect using a managed identity](search-howto-managed-identities-data-sources.md) |
| Resource is behind an IP firewall | [Create an inbound rule for Search and for the Azure portal](search-indexer-howto-access-ip-restricted.md) |
| Resource requires a private endpoint connection | [Connect over a private endpoint](search-indexer-howto-access-private.md) |

### Step 2: Add cognitive skills

Next, configure AI enrichment to invoke OCR, image analysis, and natural language processing. 

OCR and image analysis are available for blobs in Azure Blob Storage and Azure Data Lake Storage (ADLS) Gen2, and for image content in OneLake. Images can be standalone files or embedded images in a PDF or other files.

10. For this quickstart, we're using the **Free** Azure AI services resource. The sample data consists of 14 files, so the free allotment of 20 transactions on Azure AI services is sufficient for this quickstart. 

   ==:image type="content" source="media/search-get-started-skillset/cog-search-attach.png" alt-text="Screenshot of the Attach Azure AI services tab." border="true"==:

11. Expand **Add enrichments** and make six selections. 

   Enable OCR to add image analysis skills to wizard page.

   Choose entity recognition (people, organizations, locations) and image analysis skills (tags, captions).

   ==:image type="content" source="media/search-get-started-skillset/skillset.png" alt-text="Screenshot of the skillset definition page." border="true"==:

   Continue to the next page.

### Step 3: Configure the index

An index contains your searchable content and the **Import data** wizard can usually create the schema by sampling the data source. In this step, review the generated schema and potentially revise any settings. 

For this quickstart, the wizard does a good job setting reasonable defaults:  

+ Default fields are based on metadata properties of existing blobs, plus the new fields for the enrichment output (for example, `people`, `organizations`, `locations`). Data types are inferred from metadata and by data sampling.

+ Default document key is *metadata_storage_path* (selected because the field contains unique values).

+ Default attributes are **Retrievable** and **Searchable**. **Searchable** allows full text search a field. **Retrievable** means field values can be returned in results. The wizard assumes you want these fields to be retrievable and searchable because you created them via a skillset. Select **Filterable** if you want to use fields in a filter expression.

  ==:image type="content" source="media/search-get-started-skillset/index-fields.png" alt-text="Screenshot of the index definition page." border="true"==:

Marking a field as **Retrievable** doesn't mean that the field *must* be present in the search results. You can control search results composition by using the **select** query parameter to specify which fields to include.
  
Continue to the next page.

### Step 4: Configure the indexer

The indexer drives the indexing process. It specifies the data source name, a target index, and frequency of execution. The **Import data** wizard creates several objects, including an indexer that you can reset and run repeatedly.

12. In the **Indexer** page, accept the default name and select **Once**. 

   ==:image type="content" source="media/search-get-started-skillset/indexer-def.png" alt-text="Screenshot of the indexer definition page." border="true"==:

13. Select **Submit** to create and simultaneously run the indexer.

## Monitor status

Select **Indexers** from the left navigation pane to monitor status, and then select the indexer. Skills-based indexing takes longer than text-based indexing, especially OCR and image analysis.

  ==:image type="content" source="media/search-get-started-skillset/indexer-notification.png" alt-text="Screenshot of the indexer status page." border="true"==:

To view details about execution status, select **Success** (or **Failed**) to view execution details.

In this demo, there are a few warnings: *"Could not execute skill because one or more skill input was invalid."* It tells you that a PNG file in the data source doesn't provide a text input to Entity Recognition. This warning occurs because the upstream OCR skill didn't recognize any text in the image, and thus couldn't provide a text input to the downstream Entity Recognition skill.

Warnings are common in skillset execution. As you become familiar with how skills iterate over your data, you might begin to notice patterns and learn which warnings are safe to ignore.

## Query in Search explorer

After an index is created, use **Search explorer** to return results.

14. On the left, select **Indexes** and then select the index. **Search explorer** is on the first tab.

15. Enter a search string to query the index, such as `satya nadella`. The search bar accepts keywords, quote-enclosed phrases, and operators: `"Satya Nadella" +"Bill Gates" +"Steve Ballmer"`

Results are returned as verbose JSON, which can be hard to read, especially in large documents. Some tips for searching in this tool include the following techniques:

+ Switch to JSON view to specify parameters that shape results.
+ Add `select` to limit the fields in results.
+ Add `count` to show the number of matches.
+ Use CTRL-F to search within the JSON for specific properties or terms.

  ==:image type="content" source="media/search-get-started-skillset/search-explorer.png" alt-text="Screenshot of the Search explorer page." border="true"==:

Here's some JSON you can paste into the view:

  ```json
  {
  "search": "\"Satya Nadella\" +\"Bill Gates\" +\"Steve Ballmer\"",
  "count": true,
  "select": "content, people"
  }
  ```

> [!TIP]
> Query strings are case-sensitive so if you get an "unknown field" message, check **Fields** or **Index Definition (JSON)** to verify name and case.

## Takeaways

You've now created your first skillset and learned the basic steps of skills-based indexing.

Some key concepts that we hope you picked up include the dependencies. A skillset is bound to an indexer, and indexers are Azure and source-specific. Although this quickstart uses Azure Blob Storage, other Azure data sources are possible. For more information, see [Indexers in Azure AI Search](search-indexer-overview.md). 

Another important concept is that skills operate over content types, and when working with heterogeneous content, some inputs are skipped. Also, large files or fields might exceed the indexer limits of your service tier. It's normal to see warnings when these events occur. 

Output is routed to a search index, and there's a mapping between name-value pairs created during indexing and individual fields in your index. Internally, the wizard sets up [an enrichment tree](cognitive-search-concept-annotations-syntax.md) and defines a [skillset](cognitive-search-defining-skillset.md), establishing the order of operations and general flow. These steps are hidden in the wizard, but when you start writing code, these concepts become important.

Finally, you learned that you can verify content by querying the index. In the end, what Azure AI Search provides is a searchable index, which you can query using either the [simple](/rest/api/searchservice/simple-query-syntax-in-azure-search) or [fully extended query syntax](/rest/api/searchservice/lucene-query-syntax-in-azure-search). An index containing enriched fields is like any other. You can incorporate standard or [custom analyzers](search-analyzers.md), [scoring profiles](/rest/api/searchservice/add-scoring-profiles-to-a-search-index), [synonyms](search-synonyms.md), [faceted navigation](search-faceted-navigation.md), geo-search, or any other Azure AI Search feature.

## Clean up resources

When you're working in your own subscription, it's a good idea at the end of a project to identify whether you still need the resources you created. Resources left running can cost you money. You can delete resources individually or delete the resource group to delete the entire set of resources.

You can find and manage resources in the Azure portal, using the **All resources** or **Resource groups** link in the left-navigation pane.

If you used a free service, remember that you're limited to three indexes, indexers, and data sources. You can delete individual items in the Azure portal to stay under the limit. 

## Next step

You can create skillsets using the Azure portal, .NET SDK, or REST API. To further your knowledge, try the REST API by using a REST client and more sample data.

> [!div class="nextstepaction"]
> [Tutorial: Use skillsets to generate searchable content in Azure AI Search](cognitive-search-tutorial-blob.md)


---

https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/search/search-how-to-create-indexers.md

---
title: Create an indexer
titleSuffix: Azure AI Search
description: Configure an indexer to automate data import and indexing from Azure data sources into a search index in Azure AI Search.

manager: nitinme
author: HeidiSteen
ms.author: heidist

ms.service: azure-ai-search
ms.custom:
  - ignite-2023
ms.topic: how-to
ms.date: 12/17/2024
---

# Create an indexer in Azure AI Search

This article focuses on the basic steps of creating an indexer. Depending on the data source and your workflow, more configuration might be necessary.

You can use an indexer to automate data import and indexing in Azure AI Search. An indexer is a named object on a search service that connects to an external Azure data source, reads data, and passes it to a search engine for indexing. Using indexers significantly reduces the quantity and complexity of the code you need to write if you're using a supported data source.

Indexers support two workflows:

+ **Raw content indexing (plain text or vectors)**: Extract strings and metadata from textual content for full text search scenarios. Extracts raw vector content for vector search (for example, vectors in an Azure SQL database or Azure Cosmos DB collection). In this workflow, indexing occurs only over existing content that you provide.

+ **Skills-based indexing**: Extends indexing through built-in or custom skills that create or generate new searchable content. For example, you can add integrated machine learning for analysis over images and unstructured text, extracting or inferring text and structure. Or, use skills to chunk and vectorize content from text and images. Skills-based indexing creates or generates new content that doesn't exist in your external data source. New content becomes part of your index when you add fields to the index schema that accepts the incoming data. To learn more, see [AI enrichment in Azure AI Search](cognitive-search-concept-intro.md).

## Prerequisites

+ A [supported data source](search-indexer-overview.md#supported-data-sources) that contains the content you want to ingest.

+ An [indexer data source](#prepare-a-data-source) that sets up a connection to external data.

+ A [search index](search-how-to-create-search-index.md) that can accept incoming data.

+ Be under the [maximum limits](search-limits-quotas-capacity.md#indexer-limits) for your service tier. The Free tier allows three objects of each type and 1-3 minutes of indexer processing, or 3-10 minutes if there's a skillset.

## Indexer patterns

When you create an indexer, the definition is one of two patterns: *content-based indexing* or *skills-based indexing*. The patterns are the same, except that skills-based indexing has more definitions.

### Indexer example for content-based indexing

Content-based indexing for full text or vector search is the primary use case for indexers. For this workflow, an indexer looks like this example.

```json
{
  "name": (required) String that uniquely identifies the indexer,
  "description": (optional),
  "dataSourceName": (required) String indicating which existing data source to use,
  "targetIndexName": (required) String indicating which existing index to use,
  "parameters": {
    "batchSize": null,
    "maxFailedItems": 0,
    "maxFailedItemsPerBatch": 0,
    "base64EncodeKeys": false,
    "configuration": {}
  },
  "fieldMappings": (optional) unless field discrepancies need resolution,
  "disabled": null,
  "schedule": null,
  "encryptionKey": null
}
```

Indexers have the following requirements:

+ A `name` property that uniquely identifies the indexer in the indexer collection
+ A `dataSourceName` property that points to a data source object. It specifies a connection to external data
+ A `targetIndexName` property that points to the destination search index

Other parameters are optional and modify run time behaviors, such as how many errors to accept before failing the entire job. Required parameters are specified in all indexers and are documented in the [REST API reference](/rest/api/searchservice/indexers/create#request-body). 

Data source-specific indexers for blobs, SQL, and Azure Cosmos DB provide extra `configuration` parameters for source-specific behaviors. For example, if the source is Blob Storage, you can set a parameter that filters on file extensions, such as:

```json
"parameters" : { "configuration" : { "indexedFileNameExtensions" : ".pdf,.docx" } }
```

If the source is Azure SQL, you can set a query time out parameter.

[Field mappings](search-indexer-field-mappings.md) are used to explicitly map source-to-destination fields if there are discrepancies by name or type between a field in the data source and a field in the search index.

By default, an indexer runs immediately when you create it on the search service. If you don't want indexer execution, set `disabled` to *true* when creating the indexer.

You can also [specify a schedule](search-howto-schedule-indexers.md) or set an [encryption key](search-security-manage-encryption-keys.md) for supplemental encryption of the indexer definition.

### Indexer example for skills-based indexing

Skills-based indexing uses [AI enrichment](cognitive-search-concept-intro.md) to process content that isn't searchable in its raw form. All of the above properties and parameters apply, but the following extra properties are specific to AI enrichment: `skillSetName`, `cache`, `outputFieldMappings`.

```json
{
  "name": (required) String that uniquely identifies the indexer,
  "dataSourceName": (required) String, provides raw content that will be enriched,
  "targetIndexName": (required) String, name of an existing index,
  "skillsetName" : (required for AI enrichment) String, name of an existing skillset,
  "cache":  {
    "storageConnectionString" : (required if you enable the cache) Connection string to a blob container,
    "enableReprocessing": true
    },
  "parameters": { },
  "fieldMappings": (optional) Maps fields in the underlying data source to fields in an index,
  "outputFieldMappings" : (required) Maps skill outputs to fields in an index,
}
```

AI enrichment is its own subject area and is out of scope for this article. For more information, start with [AI enrichment](cognitive-search-concept-intro.md), [Skillsets in Azure AI Search](cognitive-search-working-with-skillsets.md), [Create a skillset](cognitive-search-defining-skillset.md), [Map enriched output fields](cognitive-search-output-field-mapping.md), and [Enable caching for AI enrichment](search-howto-incremental-index.md).

## Prepare external data

Indexers work with data sets. When you run an indexer, it connects to your data source, retrieves the data from the container or folder, optionally serializes it into JSON before passing it to the search engine for indexing. This section describes the requirements of incoming data for text-based indexing.

| Source data | Tasks |
|-------------|-------|
| JSON documents | JSON documents can contain text, numbers, and vectors. Make sure the structure or shape of incoming data corresponds to the schema of your search index. Most search indexes are fairly flat, where the fields collection consists of fields at the same level. However, hierarchical or nested structures are possible through [complex fields and collections](search-howto-complex-data-types.md). |
| Relational | Provide data as a flattened row set, where each row becomes a full or partial search document in the index. <br><br> To flatten relational data into a row set, you should create a SQL view, or build a query that returns parent and child records in the same row. For example, the built-in hotels sample dataset is an SQL database that has 50 records (one for each hotel), linked to room records in a related table. The query that flattens the collective data into a row set embeds all of the room information in JSON documents in each hotel record. The embedded room information is a generated by a query that uses a **FOR JSON AUTO** clause. <br><br> You can learn more about this technique in [define a query that returns embedded JSON](index-sql-relational-data.md#define-a-query-that-returns-embedded-json). This is just one example; you can find other approaches that produce the same result. |
| Files | An indexer generally creates one search document for each file, where the search document consists of fields for content and metadata. Depending on the file type, the indexer can sometimes [parse one file into multiple search documents](search-howto-index-one-to-many-blobs.md). For example, in a CSV file, each row can become a standalone search document. |

Remember that you only need to pull in searchable and filterable data:

+ Searchable data is text or vectors
+ Filterable data is text and numbers (non-vector fields)

Azure AI Search can't do a full-text search over binary data in any format, although it can extract and infer text descriptions of image files (see [AI enrichment](cognitive-search-concept-intro.md)) to create searchable content. Likewise, large text can be broken down and analyzed by natural language models to find structure or relevant information, generating new content that you can add to a search document. It can also do vector search over embeddings, including quantized embeddings in a binary format.

Given that indexers don't fix data problems, other forms of data cleansing or manipulation might be needed. For more information, you should refer to the product documentation of your [Azure database product](/azure/?product=databases).

## Prepare a data source

Indexers require a data source that specifies the type, container, and connection.

1. Make sure you're using a [supported data source type](search-indexer-overview.md#supported-data-sources).

2. [Create a data source](/rest/api/searchservice/data-sources/create) definition. The following data sources are a few of the more frequently used sources:

   + [Azure Blob Storage](search-howto-indexing-azure-blob-storage.md)
   + [Azure Cosmos DB](search-howto-index-cosmosdb.md)
   + [Azure SQL Database](search-how-to-index-sql-database.md)

3. If the data source is a database, such as Azure SQL or Cosmos DB, enable change tracking. Azure Storage has built-in change tracking through the `LastModified` property on every blob, file, and table. The links for the various data sources explain which change tracking methods are supported by indexers.

## Prepare an index

Indexers also require a search index. Recall that indexers pass data off to the search engine for indexing. Just as indexers have properties that determine execution behavior, an index schema has properties that profoundly affect how strings are indexed (only strings are analyzed and tokenized). 

4. Start with [Create a search index](search-how-to-create-search-index.md).

5. Set up the fields collection and field attributes. 

   Fields are the only receptors of external content. Depending on how the fields are attributed in the schema, the values for each field are analyzed, tokenized, or stored as verbatim strings for filters, fuzzy search, and typeahead queries.

   Indexers can automatically map source fields to target index fields when the names and types are equivalent. If a field can't be implicitly mapped, remember that you can [define an explicit field mapping](search-indexer-field-mappings.md) that tells the indexer how to route the content.

6. Review the analyzer assignments on each field. Analyzers can transform strings. As such, indexed strings might be different from what you passed in. You can evaluate the effects of analyzers using [Analyze Text (REST)](/rest/api/searchservice/indexes/analyze). For more information about analyzers, see [Analyzers for text processing](search-analyzers.md).

During indexing, an indexer only checks field names and types. There's no validation step that ensures incoming content is correct for the corresponding search field in the index.

## Create an indexer

When you're ready to create an indexer on a remote search service, you need a search client. A search client can be the Azure portal, a REST client, or code that instantiates an indexer client. We recommend the Azure portal or REST APIs for early development and proof-of-concept testing.

### [**Azure portal**](#tab/portal)

7. Sign in to the [Azure portal](https://portal.azure.com), then find your search service.

8. On the search service **Overview** page, choose from two options:

   + [**Import data** wizard](search-import-data-portal.md): The wizard is unique in that it creates all of the required elements. Other approaches require a predefined data source and index.

       ==:image type="content" source="media/search-how-to-create-indexers/portal-indexer-client.png" alt-text="Screenshot that shows the Import data wizard." border="true"==:

   + **Add indexer**: A visual editor for specifying an indexer definition.

       ==:image type="content" source="media/search-how-to-create-indexers/portal-indexer-client-2.png" alt-text="Screenshot that shows the Add indexer button." border="true"==:

### [**REST**](#tab/indexer-rest)

Visual Studio Code with a REST client can send indexer requests. Using the app, you can connect to your search service and send [Create indexer (REST)](/rest/api/searchservice/indexers/create) or [Create or Update indexer](/rest/api/searchservice/indexers/create-or-update) requests. 

```http
POST /indexers?api-version=[api-version]
{
  "name": (required) String that uniquely identifies the indexer,
  "dataSourceName": (required) String indicated which existing data source to use,
  "targetIndexName": (required) String,
  "parameters": {
    "batchSize": null,
    "maxFailedItems": null,
    "maxFailedItemsPerBatch": null,
    "configuration": {
        "executionEnvironment": "standard"
    }
  },
  "fieldMappings": [ optional unless there are field discrepancies that need resolution]
}
```

Parameters are used to set the batch size and how to handle processing failures. The [execution environment](search-howto-run-reset-indexers.md#indexer-execution-environment) determines whether indexer and skillset processing can use the multitenant capabilities provided by Microsoft or the private processing nodes allocated exclusively to your search service. If your search service is Standard2 or higher, you can set `executionEnvironment` to private to pin all indexer processing to just your search service clusters.

There are numerous tutorials and examples that demonstrate REST clients for creating objects. [Quickstart: Text search using REST](search-get-started-rest.md) can get you started.

### [**.NET SDK**](#tab/indexer-csharp)

For Azure AI Search, the Azure SDKs implement generally available features. As such, you can use any of the SDKs to create indexer-related objects. All of them provide a `SearchIndexerClient` that has methods for creating indexers and related objects, including skillsets.

| Azure SDK | Client | Examples |
|-----------|--------|----------|
| .NET | [SearchIndexerClient](/dotnet/api/azure.search.documents.indexes.searchindexerclient) | [DotNetHowToIndexers](https://github.com/Azure-Samples/search-dotnet-getting-started/tree/master/DotNetHowToIndexers) |
| Java | [SearchIndexerClient](/java/api/com.azure.search.documents.indexes.searchindexerclient) | [CreateIndexerExample.java](https://github.com/Azure/azure-sdk-for-java/blob/main/sdk/search/azure-search-documents/src/samples/java/com/azure/search/documents/indexes/CreateIndexerExample.java) |
| JavaScript | [SearchIndexerClient](/javascript/api/@azure/search-documents/searchindexerclient) | [Indexers](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/search/search-documents/samples/v11/javascript) |
| Python | [SearchIndexerClient](/python/api/azure-search-documents/azure.search.documents.indexes.searchindexerclient) | [sample_indexers_operations.py](https://github.com/Azure/azure-sdk-for-python/blob/master/sdk/search/azure-search-documents/samples/sample_indexers_operations.py) |

---

## Run the indexer

By default, an indexer runs immediately when you create it on the search service. You can override this behavior by setting `disabled` to *true* in the indexer definition. Indexer execution is the moment of truth where you find out if there are problems with connections, field mappings, or skillset construction. 

There are several ways to run an indexer:

+ Run on indexer creation or update (default).

+ Run on demand when there are no changes to the definition, or precede with reset for full indexing. For more information, see [Run or reset indexers](search-howto-run-reset-indexers.md).

+ [Schedule indexer processing](search-howto-schedule-indexers.md) to invoke execution at regular intervals. 

Scheduled execution is usually implemented when you have a need for incremental indexing so that you can pick up the latest changes. As such, scheduling has a dependency on change detection.

Indexers are one of the few subsystems that make overt outbound calls to other Azure resources. In terms of Azure roles, indexers don't have separate identities; a connection from the search engine to another Azure resource is made using the [system or user-assigned managed identity](search-howto-managed-identities-data-sources.md) of a search service. If the indexer connects to an Azure resource on a virtual network, you should create a [shared private link](search-indexer-howto-access-private.md) for that connection. For more information about secure connections, see [Security in Azure AI Search](search-security-overview.md).

## Check results

[Monitor indexer status](search-howto-monitor-indexers.md) to check for status. Successful execution can still include warning and notifications. Be sure to check both successful and failed status notifications for details about the job.

For content verification, [run queries](search-query-create.md) on the populated index that return entire documents or selected fields.

## Change detection and internal state

If your data source supports change detection, an indexer can detect underlying changes in the data and process just the new or updated documents on each indexer run, leaving unchanged content as-is. If indexer execution history says that a run was successful with *0/0* documents processed, it means that the indexer didn't find any new or changed rows or blobs in the underlying data source.

Change detection logic is built into the data platforms. How an indexer supports change detection varies by data source:

+ Azure Storage has built-in change detection, which means an indexer can recognize new and updated documents automatically. Blob Storage, Azure Table Storage, and Azure Data Lake Storage Gen2 stamp each blob or row update with a date and time. An indexer automatically uses this information to determine which documents to update in the index. For more information about deletion detection, see [Change and delete detection using indexers for Azure Storage](search-howto-index-changed-deleted-blobs.md).

+ Cloud database technologies provide optional change detection features in their platforms. For these data sources, change detection isn't automatic. You need to specify in the data source definition which policy is used:

  + [Azure SQL (change detection)](search-how-to-index-sql-database.md#indexing-new-changed-and-deleted-rows)
  + [Azure DB for MySQL (change detection)](search-howto-index-mysql.md#indexing-new-and-changed-rows)
  + [Azure Cosmos DB for NoSQL (change detection)](search-howto-index-cosmosdb.md#indexing-new-and-changed-documents)
  + [Azure Cosmos DB for MongoDB (change detection)](search-howto-index-cosmosdb-mongodb.md#indexing-new-and-changed-documents)
  + [Azure Cosmos DB for Apache Gremlin (change detection)](search-howto-index-cosmosdb-gremlin.md#indexing-new-and-changed-documents)

Indexers keep track of the last document it processed from the data source through an internal *high water mark*. The marker is never exposed in the API, but internally the indexer keeps track of where it stopped. When indexing resumes, either through a scheduled run or an on-demand invocation, the indexer references the high water mark so that it can pick up where it left off.

If you need to clear the high water mark to reindex in full, you can use [Reset Indexer](/rest/api/searchservice/indexers/reset). For more selective reindexing, use [Reset Skills](/rest/api/searchservice/skillsets/reset-skills?view=rest-searchservice-2024-05-01-preview&preserve-view=true) or [Reset Documents](/rest/api/searchservice/indexers/reset-docs?view=rest-searchservice-2024-05-01-preview&preserve-view=true). Through the reset APIs, you can clear internal state, and also flush the cache if you enabled [incremental enrichment](search-howto-incremental-index.md). For more background and comparison of each reset option, see [Run or reset indexers, skills, and documents](search-howto-run-reset-indexers.md).

## Related content

+ [Index data from Azure Blob Storage](search-howto-indexing-azure-blob-storage.md)
+ [Index data from Azure SQL database](search-how-to-index-sql-database.md)
+ [Index data from Azure Data Lake Storage Gen2](search-howto-index-azure-data-lake-storage.md)
+ [Index data from Azure Table Storage](search-howto-indexing-azure-tables.md)
+ [Index data from Azure Cosmos DB](search-howto-index-cosmosdb.md)

---

https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/search/search-how-to-create-search-index.md
# Create an index in Azure AI Search

In this article, learn the steps for defining a schema for a [**search index**](search-what-is-an-index.md) and pushing it to a search service. Creating an index establishes the physical data structures on your search service. Once the index exists, [**load the index**](search-what-is-data-import.md) as a separate task. 

## Prerequisites

+ Write permissions as a [**Search Service Contributor**](search-security-rbac.md) or an [admin API key](search-security-api-keys.md) for key-based authentication.

+ An understanding of the data you want to index. A search index is based on external content that you want to make searchable. Searchable content is stored as fields in an index. You should have a clear idea of which source fields you want to make searchable, retrievable, filterable, facetable, and sortable on Azure AI Search. See the [schema checklist](#schema-checklist) for guidance.

+ You must also have a unique field in source data that can be used as the [document key (or ID)](#document-keys) in the index.

+ A stable index location. Moving an existing index to a different search service isn't supported out-of-the-box. Revisit application requirements and make sure that your existing search service (capacity and region), are sufficient for your needs. If you're taking a dependency on Azure AI services or Azure OpenAI, [choose a region](search-create-service-portal.md#checklist-for-choosing-a-region) that provides all of the necessary resources.

+ Finally, all service tiers have [index limits](search-limits-quotas-capacity.md#index-limits) on the number of objects that you can create. For example, if you're experimenting on the Free tier, you can only have three indexes at any given time. Within the index itself, there are [limits on vectors](search-limits-quotas-capacity.md#vector-index-size-limits) and [index limits](search-limits-quotas-capacity.md#index-limits) on the number of simple and complex fields.

## Document keys

Search index creation has two requirements: an index must have a unique name on the search service, and it must have a document key. The boolean `key` attribute on a field can be set to true to indicate which field provides the document key. 

A document key is the unique identifier of a search document, and a search document is a collection of fields that completely describes something. For example, if you're indexing a [movies data set](https://www.kaggle.com/datasets/harshitshankhdhar/imdb-dataset-of-top-1000-movies-and-tv-shows), a search document contains the title, genre, and duration of a single movie. Movie names are unique in this dataset, so you might use the movie name as the document key.

In Azure AI Search, a document key is a string, and it must originate from unique values in the data source that's providing the content to be indexed. As a general rule, a search service doesn't generate key values, but in some scenarios (such as the [Azure table indexer](search-howto-indexing-azure-tables.md)) it synthesizes existing values to create a unique key for the documents being indexed. Another scenario is one-to-many indexing for chunked or partitioned data, in which case document keys are generated for each chunk.

During incremental indexing, where new and updated content is indexed, incoming documents with new keys are added, while incoming documents with existing keys are either merged or overwritten, depending on whether index fields are null or populated.

Important points about document keys include:

+ The maximum length of values in a key field is 1,024 characters.
+ Exactly one top-level field in each index must be chosen as the key field and it must be of type `Edm.String`.
+ The default of the `key` attribute is false for simple fields and null for complex fields.

Key fields can be used to look up documents directly and update or delete specific documents. The values of key fields are handled in a case-sensitive manner when looking up or indexing documents. See [GET Document (REST)](/rest/api/searchservice/documents/get) and [Index Documents (REST)](/rest/api/searchservice/documents) for details.

## Schema checklist

Use this checklist to assist the design decisions for your search index.

1. Review [naming conventions](/rest/api/searchservice/naming-rules) so that index and field names conform to the naming rules.

2. Review [supported data types](/rest/api/searchservice/supported-data-types). The data type affects how the field is used. For example, numeric content is filterable but not full text searchable. The most common data type is `Edm.String` for searchable text, which is tokenized and queried using the full text search engine. The most common data type for a vector field is `Edm.Single` but you can use other types as well.

3. Identify a [document key](#document-keys). A document key is an index requirement. It's a single string field populated from a source data field that contains unique values. For example, if you're indexing from Blob Storage, the metadata storage path is often used as the document key because it uniquely identifies each blob in the container.

4. Identify the fields in your data source that contribute searchable content in the index.

   Searchable nonvector content includes short or long strings that are queried using the full text search engine. If the content is verbose (small phrases or bigger chunks), experiment with different analyzers to see how the text is tokenized. 

   Searchable vector content can be images or text (in any language) that exists as a mathematical representation. You can use narrow data types or vector compression to make vector fields smaller.

   [Attributes set on fields](search-what-is-an-index.md#index-attributes), such as `retrievable` or `filterable`, determine both search behaviors and the physical representation of your index on the search service. Determining how fields should be attributed is an iterative process for many developers. To speed up iterations, start with sample data so that you can drop and rebuild easily.

5. Identify which source fields can be used as filters. Numeric content and short text fields, particularly those with repeating values, are good choices. When working with filters, remember:

   + Filters can be used in vector and nonvector queries, but the filter itself is applied to human-readable (nonvector) fields in your index.

   + Filterable fields can optionally be used in faceted navigation.

   + Filterable fields are returned in arbitrary order and don't undergo relevance scoring, so consider making them sortable as well.

6. For vector fields, specify a vector search configuration and the algorithms used for creating navigation paths and filling the embedding space. For more information, see [Add vector fields](vector-search-how-to-create-index.md).

   Vector fields have extra properties that nonvector fields don't have, such as which algorithms to use and vector compression.

   Vector fields omit attributes that aren't useful on vector data, such as sorting, filtering, and faceting. 

7. For nonvector fields, determine whether to use the default analyzer (`"analyzer": null`) or a different analyzer. [Analyzers](search-analyzers.md) are used to tokenize text fields during indexing and query execution. 

   For multi-lingual strings, consider a [language analyzer](index-add-language-analyzers.md).

   For hyphenated strings or special characters, consider [specialized analyzers](index-add-custom-analyzers.md#built-in-analyzers). One example is [keyword](https://lucene.apache.org/core/6_6_1/analyzers-common/org/apache/lucene/analysis/core/KeywordAnalyzer.html) that treats the entire contents of a field as a single token. This behavior is useful for data like zip codes, IDs, and some product names. For more information, see [Partial term search and patterns with special characters](search-query-partial-matching.md).

> [!NOTE]
> Full text search is conducted over terms that are tokenized during indexing. If your queries fail to return the results you expect, [test for tokenization](/rest/api/searchservice/indexes/analyze) to verify the string you're searching for actually exists. You can try different analyzers on strings to see how tokens are produced for various analyzers.

## Configure field definitions

The fields collection defines the structure of a search document. All fields have a name, data type, and attributes.

Setting a field as searchable, filterable, sortable, or facetable has an effect on index size and query performance. Don't set those attributes on fields that aren't meant to be referenced in query expressions.

If a field isn't set to be searchable, filterable, sortable, or facetable, the field can't be referenced in any query expression. This is desirable for fields that aren't used in queries, but are needed in search results.

The REST APIs have default attribution based on [data types](/rest/api/searchservice/supported-data-types), which is also used by the [Import wizards](search-import-data-portal.md) in the Azure portal. The Azure SDKs don't have defaults, but they have field subclasses that incorporate properties and behaviors, such as [SearchableField](/dotnet/api/azure.search.documents.indexes.models.searchablefield) for strings and [SimpleField](/dotnet/api/azure.search.documents.indexes.models.simplefield) for primitives.

Default field attributions for the REST APIs are summarized in the following table.

| Data type | Searchable | Retrievable | Filterable | Facetable | Sortable | Stored |
|-----------|-------------|------------|------------|-----------|----------|--------|
| `Edm.String` | ✅ | ✅ | ✅ | ✅| ✅ | ✅ |
| `Collection(Edm.String)` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `Edm.Boolean` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `Edm.Int32`, `Edm.Int64`, `Edm.Double` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `Edm.DateTimeOffset` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `Edm.GeographyPoint` | ✅| ✅ | ✅ | ❌ | ✅ | ✅ |
| `Edm.ComplexType` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `Collection(Edm.Single)` and all other vector field types | ✅ | ✅ or ❌ | ❌ | ❌ | ❌ | ✅ |

String fields can also be optionally associated with [analyzers](search-analyzers.md) and [synonym maps](search-synonyms.md). Fields of type `Edm.String` that are filterable, sortable, or facetable can be at most 32 kilobytes in length. This is because values of such fields are treated as a single search term, and the maximum length of a term in Azure AI Search is 32 kilobytes. If you need to store more text than this in a single string field, you should explicitly set filterable, sortable, and facetable to `false` in your index definition.

Vector fields must be associated with [dimensions and vector profiles](vector-search-how-to-create-index.md). Retrievable default is true if you add the vector field using the [Import and vectorize wizard](search-get-started-portal-import-vectors.md) in the Azure portal, otherwise it's false if you use the REST API.

Field attributes are described in the following table.

|Attribute|Description|  
|---------------|-----------------|  
|name|Required. Sets the name of the field, which must be unique within the fields collection of the index or parent field.|  
|type|Required. Sets the data type for the field. Fields can be simple or complex. Simple fields are of primitive types, like `Edm.String` for text or `Edm.Int32` for integers. [Complex fields](search-howto-complex-data-types.md) can have sub-fields that are themselves either simple or complex. This allows you to model objects and arrays of objects, which in turn enables you to upload most JSON object structures to your index. See [Supported data types](/rest/api/searchservice/supported-data-types) for the complete list of supported types.|  
|key|Required. Set this attribute to true to designate that a field's values uniquely identify documents in the index. See [Document keys](#document-keys) in this article for details.|  
|retrievable| Indicates whether the field can be returned in a search result. Set this attribute to `false` if you want to use a field as a filter, sorting, or scoring mechanism but don't want the field to be visible to the end user. This attribute must be `true` for key fields, and it must be `null` for complex fields. This attribute can be changed on existing fields. Setting retrievable to `true` doesn't cause any increase in index storage requirements. Default is `true` for simple fields and `null` for complex fields.|  
|searchable| Indicates whether the field is full-text searchable and can be referenced in search queries. This means it undergoes [lexical analysis](search-analyzers.md) such as word-breaking during indexing. If you set a searchable field to a value like "Sunny day", internally it's normalized into the individual tokens \"sunny\" and \"day\". This enables full-text searches for these terms. Fields of type `Edm.String` or `Collection(Edm.String)` are searchable by default. This attribute must be `false` for simple fields of other nonstring data types, and it must be `null` for complex fields. </br></br>A searchable field consumes extra space in your index since Azure AI Search processes the contents of those fields and organize them in auxiliary data structures for performant searching. If you want to save space in your index and you don't need a field to be included in searches, set searchable to `false`. See [How full-text search works in Azure AI Search](search-lucene-query-architecture.md) for details. |  
|filterable| Indicates whether to enable the field to be referenced in `$filter` queries. Filterable differs from searchable in how strings are handled. Fields of type `Edm.String` or `Collection(Edm.String)` that are filterable don't undergo lexical analysis, so comparisons are for exact matches only. For example, if you set such a field `f` to "Sunny day", `$filter=f eq 'sunny'` finds no matches, but `$filter=f eq 'Sunny day'` will. This attribute must be `null` for complex fields. Default is `true` for simple fields and `null` for complex fields. To reduce index size, set this attribute to `false` on fields that you won't be filtering on.|  
|sortable| Indicates whether to enable the field to be referenced in `$orderby` expressions. By default Azure AI Search sorts results by score, but in many experiences users want to sort by fields in the documents. A simple field can be sortable only if it's single-valued (it has a single value in the scope of the parent document). </br></br>Simple collection fields can't be sortable, since they're multi-valued. Simple subfields of complex collections are also multi-valued, and therefore can't be sortable. This is true whether it's an immediate parent field, or an ancestor field, that's the complex collection. Complex fields can't be sortable and the sortable attribute must be `null` for such fields. The default for sortable is `true` for single-valued simple fields, `false` for multi-valued simple fields, and `null` for complex fields.|  
|facetable| Indicates whether to enable the field to be referenced in facet queries. Typically used in a presentation of search results that includes hit count by category (for example, search for digital cameras and see hits by brand, by megapixels, by price, and so on). This attribute must be `null` for complex fields. Fields of type `Edm.GeographyPoint` or `Collection(Edm.GeographyPoint)` can't be facetable. Default is `true` for all other simple fields. To reduce index size, set this attribute to `false` on fields that you won't be faceting on. |
|analyzer|Sets the lexical analyzer for tokenizing strings during indexing and query operations. Valid values for this property include [language analyzers](index-add-language-analyzers.md), [built-in analyzers](index-add-custom-analyzers.md#built-in-analyzers), and [custom analyzers](index-add-custom-analyzers.md). The default is `standard.lucene`. This attribute can only be used with searchable string fields, and it can't be set together with either searchAnalyzer or indexAnalyzer. Once the analyzer is chosen and the field is created in the index, it can't be changed for the field. Must be `null` for [complex fields](search-howto-complex-data-types.md). |  
|searchAnalyzer|Set this property together with indexAnalyzer to specify different lexical analyzers for indexing and queries. If you use this property, set analyzer to `null` and make sure indexAnalyzer is set to an allowed value. Valid values for this property include built-in analyzers and custom analyzers. This attribute can be used only with searchable fields. The search analyzer can be updated on an existing field since it's only used at query-time. Must be `null` for complex fields].|
|indexAnalyzer|Set this property together with searchAnalyzer to specify different lexical analyzers for indexing and queries.  If you use this property, set analyzer to `null` and make sure searchAnalyzer is set to an allowed value. Valid values for this property include built-in analyzers and custom analyzers. This attribute can be used only with searchable fields. Once the index analyzer is chosen, it can't be changed for the field. Must be `null` for complex fields.|
|synonymMaps|A list of the names of synonym maps to associate with this field. This attribute can be used only with searchable fields. Currently only one synonym map per field is supported. Assigning a synonym map to a field ensures that query terms targeting that field are expanded at query-time using the rules in the synonym map. This attribute can be changed on existing fields. Must be `null` or an empty collection for complex fields.|
|fields|A list of subfields if this is a field of type `Edm.ComplexType` or `Collection(Edm.ComplexType)`. Must be `null` or empty for simple fields. See [How to model complex data types in Azure AI Search](search-howto-complex-data-types.md) for more information on how and when to use subfields.|

## Create an index

When you're ready to create the index, use a search client that can send the request. You can use the Azure portal or REST APIs for early development and proof-of-concept testing, otherwise it's common to use the Azure SDKs.

During development, plan on frequent rebuilds. Because physical structures are created in the service, [dropping and re-creating indexes](search-howto-reindex.md) is necessary for many modifications. You might consider working with a subset of your data to make rebuilds go faster.

### [**Azure portal**](#tab/portal)

Index design through the Azure portal enforces requirements and schema rules for specific data types, such as disallowing full text search capabilities on numeric fields. 

8. Sign in to the [Azure portal](https://portal.azure.com).

9. Check for space. Search services are subject to [maximum number of indexes](search-limits-quotas-capacity.md), varying by service tier. Make sure you have room for a second index.

10. In the search service **Overview** page, choose either option for creating a search index: 

   + **Add index**, an embedded editor for specifying an index schema
   + [**Import wizards**](search-import-data-portal.md)

   The wizard is an end-to-end workflow that creates an indexer, a data source, and a finished index. It also loads the data. If this is more than what you want, use **Add index** instead.

The following screenshot highlights where **Add index**, **Import data**, and **Import and vectorize data** appear on the command bar. 

==:image type="content" source="media/search-what-is-an-index/add-index.png" alt-text="Screenshot of the options to add an index." border="true"==:

After an index is created, you can find it again on the **Indexes** page from the left navigation pane.

> [!TIP]
> After creating an index in the Azure portal, you can copy the JSON representation and add it to your application code.

### [**REST**](#tab/index-rest)

[**Create Index (REST API)**](/rest/api/searchservice/indexes/create) is used to create an index. You need a REST client to connect to your search service and send requests. See [Quickstart: Full text search using REST](search-get-started-rest.md) or [Quickstart: Vector search using REST](search-get-started-vector.md) to get started.

The REST API provides defaults for field attribution. For example, all `Edm.String` fields are searchable by default. Attributes are shown in full below for illustrative purposes, but you can omit attribution in cases where the default values apply.

```json
POST https://[servicename].search.windows.net/indexes?api-version=[api-version] 
{
  "name": "hotels",
  "fields": [
    { "name": "HotelId", "type": "Edm.String", "key": true, "retrievable": true, "searchable": true, "filterable": true },
    { "name": "HotelName", "type": "Edm.String", "retrievable": true, "searchable": true, "filterable": false, "sortable": true, "facetable": false },
    { "name": "Description", "type": "Edm.String", "retrievable": true, "searchable": true, "filterable": false, "sortable": false, "facetable": false, "analyzer": "en.microsoft" },
    { "name": "Description_fr", "type": "Edm.String", "retrievable": true, "searchable": true, "filterable": false, "sortable": false, "facetable": false, "analyzer": "fr.microsoft" },
    { "name": "Address", "type": "Edm.ComplexType", 
      "fields": [
          { "name": "StreetAddress", "type": "Edm.String", "retrievable": true, "filterable": false, "sortable": false, "facetable": false, "searchable": true },
          { "name": "City", "type": "Edm.String", "retrievable": true, "searchable": true, "filterable": true, "sortable": true, "facetable": true },
          { "name": "StateProvince", "type": "Edm.String", "retrievable": true, "searchable": true, "filterable": true, "sortable": true, "facetable": true }
        ]
    }
  ],
  "suggesters": [ ],
  "scoringProfiles": [ ],
  "analyzers":(optional)[ ... ]
}
```

### [**.NET SDK**](#tab/index-csharp)

The Azure SDK for .NET has [**SearchIndexClient**](/dotnet/api/azure.search.documents.indexes.searchindexclient) with methods for creating and updating indexes.

```csharp
// Create the index
string indexName = "hotels";
SearchIndex index = new SearchIndex(indexName)
{
    Fields =
    {
        new SimpleField("hotelId", SearchFieldDataType.String) { IsKey = true, IsFilterable = true, IsSortable = true },
        new SearchableField("hotelName") { IsFilterable = true, IsSortable = true },
        new SearchableField("description") { AnalyzerName = LexicalAnalyzerName.EnLucene },
        new SearchableField("descriptionFr") { AnalyzerName = LexicalAnalyzerName.FrLucene }
        new ComplexField("address")
        {
            Fields =
            {
                new SearchableField("streetAddress"),
                new SearchableField("city") { IsFilterable = true, IsSortable = true, IsFacetable = true },
                new SearchableField("stateProvince") { IsFilterable = true, IsSortable = true, IsFacetable = true },
                new SearchableField("country") { SynonymMapNames = new[] { synonymMapName }, IsFilterable = true, IsSortable = true, IsFacetable = true },
                new SearchableField("postalCode") { IsFilterable = true, IsSortable = true, IsFacetable = true }
            }
        }
    }
};

await indexClient.CreateIndexAsync(index);
```

For more examples, see [azure-search-dotnet-samples/quickstart/v11/](https://github.com/Azure-Samples/azure-search-dotnet-samples/tree/main/quickstart/v11).

### [**Other SDKs**](#tab/index-other-sdks)

For Azure AI Search, the Azure SDKs implement generally available features. As such, you can use any of the SDKs to create a search index. All of them provide a **SearchIndexClient** that has methods for creating and updating indexes.

| Azure SDK | Client | Examples |
|-----------|--------|----------|
| Java | [SearchIndexClient](/java/api/com.azure.search.documents.indexes.searchindexclient) | [CreateIndexExample.java](https://github.com/Azure/azure-sdk-for-java/blob/azure-search-documents_11.1.3/sdk/search/azure-search-documents/src/samples/java/com/azure/search/documents/indexes/CreateIndexExample.java) |
| JavaScript | [SearchIndexClient](/javascript/api/@azure/search-documents/searchindexclient) | [Indexes](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/search/search-documents/samples/v11/javascript) |
| Python | [SearchIndexClient](/python/api/azure-search-documents/azure.search.documents.indexes.searchindexclient) | [sample_index_crud_operations.py](https://github.com/Azure/azure-sdk-for-python/blob/7cd31ac01fed9c790cec71de438af9c45cb45821/sdk/search/azure-search-documents/samples/sample_index_crud_operations.py) |

---

<a name="corsoptions"></a>

## Set `corsOptions` for cross-origin queries

Index schemas include a section for setting `corsOptions`. By default, client-side JavaScript can't call any APIs because browsers prevent all cross-origin requests. To allow cross-origin queries through to your index, enable CORS (Cross-Origin Resource Sharing) by setting the **corsOptions** attribute. For security reasons, only [query APIs](search-query-create.md#choose-query-methods) support CORS.

```json
"corsOptions": {
  "allowedOrigins": [
    "*"
  ],
  "maxAgeInSeconds": 300
```

The following properties can be set for CORS:

+ **allowedOrigins** (required): This is a list of origins that are allowed access to your index. JavaScript code served from these origins is allowed to query your index (assuming the caller provides a valid key or has permissions). Each origin is typically of the form `protocol://<fully-qualified-domain-name>:<port>` although `<port>` is often omitted. For more information, see [Cross-origin resource sharing (Wikipedia)](https://en.wikipedia.org/wiki/Cross-origin_resource_sharing).

  If you want to allow access to all origins, include `*` as a single item in the **allowedOrigins** array. *This isn't a recommended practice for production search services* but it's often useful for development and debugging.

+ **maxAgeInSeconds** (optional): Browsers use this value to determine the duration (in seconds) to cache CORS preflight responses. This must be a non-negative integer. A longer cache period delivers better performance, but it extends the amount of time a CORS policy needs to take effect. If this value isn't set, a default duration of five minutes is used.

## Allowed updates on existing indexes

[**Create Index**](/rest/api/searchservice/indexes/create) creates the physical data structures (files and inverted indexes) on your search service. Once the index is created, your ability to effect changes using [**Create or Update Index**](/rest/api/searchservice/indexes/create-or-update) is contingent upon whether your modifications invalidate those physical structures. Most field attributes can't be changed once the field is created in your index.

To minimize churn in application code, you can [create an index alias](search-how-to-alias.md) that serves as a stable reference to the search index. Instead of updating your code with index names, you can update an index alias to point to newer index versions.

To minimize churn in the design process, the following table describes which elements are fixed and flexible in the schema. Changing a fixed element requires an index rebuild, whereas flexible elements can be changed at any time without impacting the physical implementation. For more information, see [Update or rebuild an index](search-howto-reindex.md).

| Element | Can be updated? |
|---------|-----------------|
| Name | No |
| Key | No |
| Field names and types | No |
| Field attributes (searchable, filterable, facetable, sortable) | No |
| Field attribute (retrievable) | Yes |
| Stored (applies to vectors) | No |
| [Analyzer](search-analyzers.md) | You can add and modify custom analyzers in the index. Regarding analyzer assignments on string fields, you can only modify `searchAnalyzer`. All other assignments and modifications require a rebuild. |
| [Scoring profiles](index-add-scoring-profiles.md) | Yes |
| [Suggesters](index-add-suggesters.md) | No |
| [cross-origin resource sharing (CORS)](#corsoptions) | Yes |
| [Encryption](search-security-manage-encryption-keys.md) | Yes |
| [Synonym maps](search-synonyms.md) | Yes |
| [Semantic configuration](semantic-how-to-configure.md) | Yes |

## Next steps

Use the following links to learn about specialized features that can be added to an index:

+ [Add vector fields and vector profiles](vector-search-how-to-create-index.md)
+ [Add scoring profiles](index-add-scoring-profiles.md)
+ [Add semantic ranking](semantic-how-to-configure.md)
+ [Add suggesters](index-add-suggesters.md)
+ [Add synonym maps](search-synonyms.md)
+ [Add analyzers](search-analyzers.md)
+ [Add encryption](search-security-manage-encryption-keys.md)

Use these links for loading or updating an index:

+ [Data import overview](search-what-is-data-import.md)
+ [Load documents](search-how-to-load-search-index.md)
+ [Update or rebuild an index](search-howto-reindex.md)