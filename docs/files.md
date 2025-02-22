I've analyzed how files are handled with the Azure Search toggle:

1. File Storage:
   - ALL files are stored in the PostgreSQL database (UploadedFile model)
   - This happens regardless of the Azure Search toggle state
   - Files are stored with their content and metadata

2. When Azure Search is OFF (toggle unchecked):
   - Files are only stored in the database
   - No Azure processing occurs
   - Files can be used via direct content injection into prompts
   - The system reads file content directly from the database

3. When Azure Search is ON (toggle checked):
   - Files are stored in the database first
   - Azure processing is triggered as a background task which:
     * Creates/ensures a search index exists
     * Creates an Azure file
     * Uploads content to the Azure Search index
     * Creates/gets a vector store
     * Adds the file to the vector store
   - Files can then be searched using Azure AI Search's semantic capabilities

This dual-storage approach ensures that files are always available for basic functionality (direct content injection), while Azure Search provides enhanced semantic search capabilities when enabled. The toggle effectively controls whether files get the additional Azure processing layer, but doesn't affect the base storage of files in the database.