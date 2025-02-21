# services/azure_file_service.py
from typing import List, Dict, Any
import aiohttp
import json
import os
import asyncio
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class AzureFileService:
    """Service for interacting with Azure OpenAI file and vector store APIs"""
    
    def __init__(self, client):
        self.client = client
        self.endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
        self.api_version = os.getenv('AZURE_OPENAI_API_VERSION', '2025-01-01-preview')
    
    async def create_azure_file(self, file_content: str, filename: str) -> str:
        """Create a file in Azure OpenAI for use with the API"""
        endpoint = f"{self.endpoint}/openai/files?api-version={self.api_version}"
        
        # Prepare file data
        form_data = aiohttp.FormData()
        form_data.add_field('purpose', 'assistants')
        form_data.add_field('file', file_content, filename=filename)
        
        # Make API call
        async with aiohttp.ClientSession() as session:
            headers = await self._get_auth_headers()
            async with session.post(endpoint, data=form_data, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to create file: {error_text}")
                
                result = await response.json()
                logger.info(f"Created Azure OpenAI file: {result['id']} for {filename}")
                return result["id"]

    async def create_vector_store(self, name: str, description: str = "", metadata: dict = None) -> str:
        """Create a vector store for file search"""
        endpoint = f"{self.endpoint}/openai/vector_stores?api-version={self.api_version}"
        
        # Prepare request
        payload = {
            "name": name,
            "description": description,
            "metadata": metadata or {},
            "index_schema": config.get_azure_search_index_schema(name)
        }
        
        # Make API call
        async with aiohttp.ClientSession() as session:
            headers = await self._get_auth_headers()
            async with session.post(endpoint, json=payload, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to create vector store: {error_text}")
                
                result = await response.json()
                logger.info(f"Created vector store: {result['id']} with name {name}")
                return result["id"]

    async def add_file_to_vector_store(self, vector_store_id: str, file_id: str) -> Dict[str, Any]:
        """Add a file to a vector store"""
        endpoint = f"{self.endpoint}/openai/vector_stores/{vector_store_id}/files?api-version={self.api_version}"
        
        # Prepare request
        payload = {
            "file_id": file_id
        }
        
        # Make API call
        async with aiohttp.ClientSession() as session:
            headers = await self._get_auth_headers()
            async with session.post(endpoint, json=payload, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to add file to vector store: {error_text}")
                
                result = await response.json()
                logger.info(f"Added file {file_id} to vector store {vector_store_id}")
                return result

    async def get_vector_store_file_status(self, vector_store_id: str, file_id: str) -> str:
        """Check the status of a file in a vector store"""
        endpoint = f"{self.endpoint}/openai/vector_stores/{vector_store_id}/files/{file_id}?api-version={self.api_version}"
        
        # Make API call
        async with aiohttp.ClientSession() as session:
            headers = await self._get_auth_headers()
            async with session.get(endpoint, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to get file status: {error_text}")
                
                result = await response.json()
                return result.get("status", "unknown")

    async def wait_for_file_processing(self, vector_store_id: str, file_id: str, timeout: int = 300) -> bool:
        """Wait for a file to be processed and ready in a vector store"""
        start_time = datetime.now()
        timeout_seconds = timeout
        
        while (datetime.now() - start_time).total_seconds() < timeout_seconds:
            try:
                status = await self.get_vector_store_file_status(vector_store_id, file_id)
                if status == "completed":
                    return True
                elif status in ["failed", "cancelled"]:
                    logger.error(f"File processing failed or cancelled: {file_id}")
                    return False
                
                # Wait before checking again
                await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Error checking file status: {e}")
                # Continue trying
                await asyncio.sleep(5)
        
        logger.warning(f"Timeout waiting for file processing: {file_id}")
        return False

    async def create_file_batch(self, vector_store_id: str, file_ids: List[str]) -> str:
        """Create a batch of files to add to a vector store"""
        endpoint = f"{self.endpoint}/openai/vector_stores/{vector_store_id}/file_batches?api-version={self.api_version}"
        
        # Prepare request
        payload = {
            "file_ids": file_ids
        }
        
        # Make API call
        async with aiohttp.ClientSession() as session:
            headers = await self._get_auth_headers()
            async with session.post(endpoint, json=payload, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to create file batch: {error_text}")
                
                result = await response.json()
                logger.info(f"Created file batch with {len(file_ids)} files in vector store {vector_store_id}")
                return result["id"]

    async def get_vector_stores(self) -> List[Dict[str, Any]]:
        """Get all vector stores"""
        endpoint = f"{self.endpoint}/openai/vector_stores?api-version={self.api_version}"
        
        # Make API call
        async with aiohttp.ClientSession() as session:
            headers = await self._get_auth_headers()
            async with session.get(endpoint, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to get vector stores: {error_text}")
                
                result = await response.json()
                return result.get("data", [])

    async def get_vector_store_for_session(self, session_id: str) -> Dict[str, Any]:
        """Get or create a vector store for a session"""
        try:
            # Try to find an existing vector store for this session
            vector_stores = await self.get_vector_stores()
            for store in vector_stores:
                if store.get("name") == f"session-{session_id}":
                    return store
            
            # Create a new vector store if none exists
            vector_store_id = await self.create_vector_store(
                name=f"session-{session_id}",
                description=f"Vector store for session {session_id}"
            )
            
            # Return the newly created store
            return {
                "id": vector_store_id,
                "name": f"session-{session_id}"
            }
        except Exception as e:
            logger.error(f"Error getting/creating vector store for session: {e}")
            raise

    async def _get_auth_headers(self) -> Dict[str, str]:
        """Get authentication headers based on client type"""
        if hasattr(self.client, '_token_provider'):
            # Microsoft Entra ID auth
            token = await self.client._token_provider.get_token()
            return {"Authorization": f"Bearer {token}"}
        else:
            # API key auth
            return {"api-key": self.client.api_key}
