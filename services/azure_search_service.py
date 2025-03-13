# services/azure_search_service.py
import aiohttp
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, Union, Sequence
import config

logger = logging.getLogger(__name__)


class AzureSearchService:
    """Service for interacting with Azure AI Search"""

    def __init__(self, azure_client=None, headers=None):
        self.endpoint = config.AZURE_SEARCH_ENDPOINT
        self.api_key = config.AZURE_SEARCH_KEY
        self.api_version = config.MODEL_API_VERSIONS.get(
            "default", "2025-02-01-preview"
        )
        self.azure_client = azure_client
        self.headers = headers or {}

    async def create_search_index(self, session_id: str) -> bool:
        """
        Create a search index for a session

        Args:
            session_id: Session ID to create index for

        Returns:
            Success status
        """
        if not self.endpoint or not self.api_key:
            logger.warning("Azure Search credentials not available")
            return False

        try:
            # Generate index name based on session ID
            index_name = f"index-{session_id}"

            # Get index schema from config
            index_schema = config.get_azure_search_index_schema(index_name)

            # Create index
            url = f"{self.endpoint}/indexes/{index_name}?api-version={self.api_version}"
            headers = {"Content-Type": "application/json", "api-key": self.api_key}
            
            # Merge with custom headers
            headers.update(self.headers)

            async with aiohttp.ClientSession() as session:
                async with session.put(url, headers=headers, json=index_schema) as response:
                    if response.status in (200, 201):
                        logger.info(f"Created Azure Search index: {index_name}")
                        return True
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to create index: {error_text}")
                        return False
        except Exception as e:
            logger.exception(f"Error creating search index: {e}")
            return False

    async def delete_search_index(self, session_id: str) -> bool:
        """
        Delete a search index for a session

        Args:
            session_id: Session ID to delete index for

        Returns:
            Success status
        """
        if not self.endpoint or not self.api_key:
            return False

        try:
            # Generate index name based on session ID
            index_name = f"index-{session_id}"

            # Delete index
            url = f"{self.endpoint}/indexes/{index_name}?api-version={self.api_version}"
            headers = {"api-key": self.api_key}
            
            # Merge with custom headers
            headers.update(self.headers)

            async with aiohttp.ClientSession() as session:
                async with session.delete(url, headers=headers) as response:
                    if response.status in (200, 204, 404):
                        logger.info(f"Deleted Azure Search index: {index_name}")
                        return True
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to delete index: {error_text}")
                        return False
        except Exception as e:
            logger.exception(f"Error deleting search index: {e}")
            return False

    async def upload_file_to_index(
        self,
        session_id: str,
        file_id: str,
        filename: str,
        content: str,
        file_type: str,
        chunks: Optional[List[Dict[str, Any]]] = None,
    ) -> bool:  # noqa: C901
        """
        Upload a file to a search index

        Args:
            session_id: Session ID
            file_id: File ID
            filename: File name
            content: File content
            file_type: File type
            chunks: Optional list of chunks for large files

        Returns:
            Success status
        """
        if not self.endpoint or not self.api_key:
            return False

        if chunks is None:
            chunks = []

        try:
            # Generate index name based on session ID
            index_name = f"index-{session_id}"

            # Get embeddings for content if Azure client is available
            content_vector = None
            if self.azure_client and hasattr(self.azure_client, "embeddings"):
                try:
                    # Generate embedding for file content (limit to ~8K tokens)
                    embedding_response = await self.azure_client.embeddings.create(
                        model=config.AZURE_EMBEDDING_DEPLOYMENT,
                        input=content[:8192],
                    )
                    content_vector = embedding_response.data[0].embedding
                except Exception as e:
                    logger.error(f"Error generating embeddings: {e}")

            # Prepare documents for index
            documents = []

            if chunks and len(chunks) > 0:
                # Add each chunk as a separate document
                for i, chunk in enumerate(chunks):
                    chunk_id = f"{file_id}-chunk-{i}"
                    chunk_content = chunk.get("content", "")

                    # Generate embedding for chunk if needed
                    chunk_vector = None
                    if self.azure_client and hasattr(self.azure_client, "embeddings"):
                        try:
                            chunk_embedding = await self.azure_client.embeddings.create(
                                model=config.AZURE_EMBEDDING_DEPLOYMENT,
                                input=chunk_content,
                            )
                            chunk_vector = chunk_embedding.data[0].embedding
                        except Exception as e:
                            logger.error(f"Error generating chunk embeddings: {e}")

                    # Create document for chunk
                    document = {
                        "id": chunk_id,
                        "filename": f"{filename} (chunk {i+1}/{len(chunks)})",
                        "content": chunk_content,
                        "chunk_content": chunk_content,
                        "filepath": f"/files/{file_id}/chunks/{i}",
                        "file_type": file_type,
                        "session_id": session_id,
                        "chunk_id": i,
                        "chunk_total": len(chunks),
                        "last_updated": datetime.now().isoformat(),
                    }

                    # Add vector if available
                    if chunk_vector:
                        document["content_vector"] = chunk_vector

                    documents.append(document)
            else:
                # Add single document for the whole file
                document = {
                    "id": file_id,
                    "filename": filename,
                    "content": content,
                    "chunk_content": content,
                    "filepath": f"/files/{file_id}",
                    "file_type": file_type,
                    "session_id": session_id,
                    "chunk_id": 0,
                    "chunk_total": 1,
                    "last_updated": datetime.now().isoformat(),
                }
                # Add vector if available
                if content_vector:
                    document["content_vector"] = content_vector

                documents.append(document)

            # Upload documents to index
            url = f"{self.endpoint}/indexes/{index_name}/docs/index?api-version={self.api_version}"
            headers = {"Content-Type": "application/json", "api-key": self.api_key}
            
            # Merge with custom headers
            headers.update(self.headers)

            # Split into batches if many documents
            batch_size = 10
            for i in range(0, len(documents), batch_size):
                batch = documents[i:i + batch_size]
                payload = {"value": batch}

                async with aiohttp.ClientSession() as session:
                    async with session.post(url, headers=headers, json=payload) as response:
                        if response.status != 200:
                            error_text = await response.text()
                            logger.error(f"Failed to upload documents: {error_text}")
                            return False

            logger.info(f"Uploaded {len(documents)} documents to index {index_name}")
            return True
        except Exception as e:
            logger.exception(f"Error uploading to search index: {e}")
            return False

    async def delete_file_from_index(self, session_id: str, file_id: str) -> bool:
        """
        Delete a file from a search index

        Args:
            session_id: Session ID
            file_id: File ID

        Returns:
            Success status
        """
        if not self.endpoint or not self.api_key:
            return False

        try:
            # Generate index name based on session ID
            index_name = f"index-{session_id}"

            # Prepare filter query to find all chunks for this file
            filter_query = f"id eq '{file_id}' or startsWith(id, '{file_id}-chunk-')"

            # Query to find documents to delete
            url = f"{self.endpoint}/indexes/{index_name}/docs/search?api-version={self.api_version}"
            headers = {"Content-Type": "application/json", "api-key": self.api_key}
            
            # Merge with custom headers
            headers.update(self.headers)

            search_payload = {
                "search": "*",
                "filter": filter_query,
                "select": "id",
                "top": 100,
            }

            document_ids = []

            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=search_payload) as response:
                    if response.status == 200:
                        result = await response.json()
                        documents = result.get("value", [])
                        document_ids = [doc["id"] for doc in documents]
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to find documents: {error_text}")
                        return False

            # If no documents found, return success
            if not document_ids:
                return True

            # Delete documents
            delete_url = f"{self.endpoint}/indexes/{index_name}/docs/index?api-version={self.api_version}"
            delete_actions = [{"@search.action": "delete", "id": doc_id} for doc_id in document_ids]
            delete_payload = {"value": delete_actions}

            async with aiohttp.ClientSession() as session:
                async with session.post(delete_url, headers=headers, json=delete_payload) as response:
                    if response.status == 200:
                        logger.info(f"Deleted {len(document_ids)} documents from index {index_name}")
                        return True
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to delete documents: {error_text}")
                        return False
        except Exception as e:
            logger.exception(f"Error deleting from search index: {e}")
            return False

    async def query_index(
        self,
        session_id: str,
        query: str,
        file_ids: Optional[List[str]] = None,
        top: int = 5
    ) -> List[Dict[str, Any]]:  # noqa: C901
        """
        Query a search index

        Args:
            session_id: Session ID
            query: Query text
            file_ids: Optional list of file IDs to filter by
            top: Number of results to return

        Returns:
            List of search results
        """
        if not self.endpoint or not self.api_key:
            return []

        if file_ids is None:
            file_ids = []

        try:
            # Generate index name based on session ID
            index_name = f"index-{session_id}"

            # Create vector search if embeddings are available
            vector_query = None
            if self.azure_client and hasattr(self.azure_client, "embeddings"):
                try:
                    # Generate embedding for query
                    embedding_response = await self.azure_client.embeddings.create(
                        model=config.AZURE_EMBEDDING_DEPLOYMENT,
                        input=query
                    )
                    query_vector = embedding_response.data[0].embedding

                    # Create vector query
                    vector_query = {
                        "fields": "content_vector",
                        "k": top,
                        "vector": query_vector,
                    }
                except Exception as e:
                    logger.error(f"Error generating query embedding: {e}")

            # Prepare filter if file IDs are specified
            filter_expr = None
            if file_ids:
                id_filters = [
                    f"id eq '{file_id}' or startsWith(id, '{file_id}-chunk-')"
                    for file_id in file_ids
                ]
                filter_expr = " or ".join(id_filters)

            # Prepare search query
            search_payload = {
                "search": query,
                "queryType": "semantic",
                "semanticConfiguration": config.AZURE_SEARCH_SEMANTIC_CONFIG,
                "top": top,
                "select": "id,filename,content,filepath,chunk_id,chunk_total",
                "highlight": "content",
                "captions": "extractive|highlight-false",
            }

            # Add filter if specified
            if filter_expr:
                search_payload["filter"] = filter_expr

            # Add vector search if available
            if vector_query and config.AZURE_SEARCH_USE_VECTOR:
                search_payload["vectorQueries"] = [vector_query]

            # Execute search
            url = f"{self.endpoint}/indexes/{index_name}/docs/search?api-version={self.api_version}"
            headers = {"Content-Type": "application/json", "api-key": self.api_key}
            
            # Merge with custom headers
            headers.update(self.headers)

            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=search_payload) as response:
                    if response.status == 200:
                        result = await response.json()

                        # Format results
                        search_results = []
                        for doc in result.get("value", []):
                            # Extract highlighted content or caption if available
                            content = doc.get("content", "")
                            highlights = []

                            if "@search.highlights" in doc:
                                highlights = doc["@search.highlights"].get("content", [])

                            caption = None
                            if "@search.captions" in doc:
                                captions = doc["@search.captions"]
                                if captions and len(captions) > 0:
                                    caption = captions[0].get("text")

                            # Format result
                            search_results.append({
                                "id": doc.get("id"),
                                "filename": doc.get("filename"),
                                "content": content,
                                "filepath": doc.get("filepath"),
                                "chunk_id": doc.get("chunk_id"),
                                "chunk_total": doc.get("chunk_total"),
                                "highlights": highlights,
                                "caption": caption,
                            })

                        return search_results
                    else:
                        error_text = await response.text()
                        logger.error(f"Search query failed: {error_text}")
                        return []
        except Exception as e:
            logger.exception(f"Error querying search index: {e}")
            return []
