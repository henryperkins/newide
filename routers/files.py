"""
This module provides file upload, listing, and deletion endpoints using FastAPI.
It also schedules an Azure processing background task if requested. Files may be
split into chunks for large text content, and associated metadata is stored in
the database for retrieval or further processing.
"""

from fastapi import (
    APIRouter,
    Depends,
    UploadFile,
    File,
    Form,
    HTTPException,
    BackgroundTasks
)
from logging_config import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, update
from database import get_db_session, AsyncSessionLocal
from errors import create_error_response
from pydantic_models import FileResponseModel, FileListResponse, DeleteFileResponse
from utils import count_tokens
from models import UploadedFile
from services.azure_file_service import AzureFileService
from services.azure_search_service import AzureSearchService
from clients import get_model_client_dependency
import uuid
import config
import datetime
import json
import os
from typing import List, Dict, Any, Optional

router = APIRouter()


@router.post("/upload", response_model=None)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    session_id: str = Form(...),
    process_with_azure: bool = Form(False),
    db_session: AsyncSession = Depends(get_db_session),
    client_wrapper: dict = Depends(get_model_client_dependency),
):
    """
    Upload a file with optional Azure processing.

    - Reads the file content from `UploadFile`
    - Validates size and file extension
    - Splits content into chunks if needed
    - Schedules an Azure processing task if `process_with_azure=True`
    """
    logger.info(
        f"File upload requested: {file.filename}, session: {session_id}, "
        f"Azure processing: {process_with_azure}"
    )

    try:
        # Read file contents and compute size
        contents = await file.read()
        size = len(contents)

        # Check max allowable size
        if size > config.settings.MAX_FILE_SIZE:
            raise create_error_response(
                status_code=413,
                code="file_too_large",
                message=(
                    f"File exceeds max allowable size "
                    f"({config.settings.MAX_FILE_SIZE_HUMAN})."
                ),
                param="file",
                error_type="validation_error"
            )

        # Issue a warning if above a certain threshold
        if size > config.settings.WARNING_FILE_SIZE:
            logger.warning(
                f"Large file uploaded: {size} bytes, filename: {file.filename}"
            )

        # Validate extension
        filename = file.filename or "unnamed_file.txt"
        file_extension = os.path.splitext(filename)[1].lower()
        supported_extensions = [
            '.txt', '.md', '.pdf', '.docx', '.doc',
            '.json', '.js', '.py', '.html', '.css'
        ]
        if file_extension not in supported_extensions:
            raise create_error_response(
                status_code=400,
                code="unsupported_file_type",
                message=(
                    f"Unsupported file type: {file_extension}. "
                    f"Supported types: {', '.join(supported_extensions)}"
                ),
                error_type="validation_error",
                param="file"
            )

        # Client from wrapper (Azure OpenAI, etc.)
        azure_client = client_wrapper.get("client") if client_wrapper else None
        model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

        # Process the file into chunks, token counts, etc.
        from services.file_service import process_uploaded_file
        processed_data = await process_uploaded_file(contents, filename, model_name)

        file_id = uuid.uuid4()

        # Prepare parent file metadata
        metadata = {
            "filename": filename,
            "original_size": size,
            "azure_enabled": process_with_azure,
            "processed_time": datetime.datetime.now().isoformat(),
            "token_count": processed_data["token_count"],
            "chunk_count": processed_data["chunk_count"],
            "model": model_name,
            "azure_file_id": None,
            "vector_store_id": None
        }

        # Create parent file entry
        uploaded_file = UploadedFile(
            id=file_id,
            session_id=session_id,
            filename=filename,
            content=processed_data.get("original_text", ""),
            size=size,
            file_type=processed_data.get("file_type", file_extension),
            chunk_count=processed_data["chunk_count"],
            file_metadata=metadata,
            status="ready"
        )

        chunk_ids = []
        # If chunk_count > 1, we create separate rows for each chunk
        if processed_data["chunk_count"] > 1:
            for i, chunk in enumerate(processed_data["text_chunks"]):
                chunk_id = uuid.uuid4()
                chunk_ids.append(str(chunk_id))
                chunk_size = len(chunk.encode('utf-8'))
                chunk_metadata = {
                    "parent_file_id": str(file_id),
                    "chunk_index": i,
                    "total_chunks": processed_data["chunk_count"],
                    "token_count": count_tokens(chunk, model_name)
                }

                chunk_file = UploadedFile(
                    id=chunk_id,
                    session_id=session_id,
                    filename=f"{filename}.chunk{i+1}",
                    content=chunk,
                    size=chunk_size,
                    file_type=processed_data["file_type"],
                    chunk_count=1,  # Each chunk is effectively one chunk
                    file_metadata=chunk_metadata,
                    status="chunk",
                )
                db_session.add(chunk_file)

        db_session.add(uploaded_file)
        await db_session.commit()

        # Schedule Azure processing if requested
        if process_with_azure and azure_client:
            metadata["azure_processing"] = "scheduled"
            background_tasks.add_task(
                process_file_with_azure,
                file_id=str(file_id),
                session_id=session_id,
                chunk_ids=chunk_ids,
                azure_client=azure_client
            )

        return {
            "message": "File uploaded and processed successfully",
            "file_id": str(file_id),
            "metadata": metadata,
            "chunks": processed_data["chunk_count"],
            "azure_processing": process_with_azure
        }

    except Exception as e:
        logger.exception(f"Error uploading file: {e}")
        raise create_error_response(
            status_code=500,
            code="file_processing_error",
            message=str(e),
            error_type="internal_error",
            inner_error={
                "original_error": str(e),
                "max_size": config.settings.MAX_FILE_SIZE_HUMAN
            }
        )


@router.get("/{session_id}", response_model=FileListResponse)
async def get_files(
    session_id: str,
    db_session: AsyncSession = Depends(get_db_session)
):
    """
    Retrieve the list of parent files in a session (excludes chunks).
    Returns file metadata such as token counts, size, and timestamps.
    """
    logger.info(f"Fetching files for session_id: {session_id}")
    try:
        # Validate that the session exists
        session_result = await db_session.execute(
            text("SELECT id FROM sessions WHERE id = :session_id"),
            {"session_id": session_id}
        )
        if not session_result.scalar_one_or_none():
            logger.warning(f"Session not found: {session_id}")
            return FileListResponse(files=[], total_count=0, total_size=0)

        # Fetch main files (exclude status='chunk')
        files_result = await db_session.execute(
            text("""
                SELECT
                    id,
                    filename,
                    size,
                    file_type,
                    COALESCE(chunk_count, 1) AS chunk_count,
                    COALESCE(status, 'ready') AS status,
                    file_metadata,
                    upload_time
                FROM uploaded_files
                WHERE session_id = :session_id
                  AND (status != 'chunk' OR status IS NULL)
                ORDER BY upload_time DESC
            """),
            {"session_id": session_id}
        )
        files = files_result.mappings().all()

        files_with_details = []
        total_size = 0

        for file in files:
            file_dict = dict(file)

            # Safely parse metadata if it's a string
            if isinstance(file_dict["file_metadata"], str):
                try:
                    file_dict["file_metadata"] = json.loads(file_dict["file_metadata"])
                except (json.JSONDecodeError, TypeError):
                    file_dict["file_metadata"] = {}
            else:
                file_dict["file_metadata"] = file_dict["file_metadata"] or {}

            # Estimate a default token count if none stored
            file_dict["char_count"] = 0
            file_dict["token_count"] = file_dict["file_metadata"].get(
                "token_count",
                file_dict["size"] // 4  # Rough fallback
            )
            total_size += file_dict["size"]
            files_with_details.append(file_dict)

        return FileListResponse(
            files=[
                FileResponseModel(
                    id=str(file["id"]),
                    filename=file["filename"],
                    size=file["size"],
                    upload_time=file["upload_time"].isoformat(),
                    char_count=file["char_count"],
                    token_count=file["token_count"],
                    file_type=file.get("file_type", ""),
                    chunk_count=file["chunk_count"],
                    status=file["status"],
                    file_metadata=file["file_metadata"]
                )
                for file in files_with_details
            ],
            total_count=len(files_with_details),
            total_size=total_size
        )

    except Exception as e:
        logger.exception(f"Error retrieving files for session {session_id}: {e}")
        # Return an empty response instead of throwing
        return FileListResponse(files=[], total_count=0, total_size=0)


@router.delete("/{session_id}/{file_id}", response_model=None)
async def delete_file(
    session_id: str,
    file_id: str,
    db_session: AsyncSession = Depends(get_db_session),
    client_wrapper: dict = Depends(get_model_client_dependency),
):
    """
    Delete a file by ID, along with its associated chunks if applicable.
    """
    azure_client = client_wrapper.get("client") if client_wrapper else None
    try:
        file_result = await db_session.execute(
            text("""
                SELECT id, filename, file_metadata, status
                FROM uploaded_files
                WHERE session_id = :session_id
                  AND id = :file_id::uuid
            """),
            {"session_id": session_id, "file_id": file_id}
        )
        file_data = file_result.mappings().first()

        if not file_data:
            raise create_error_response(
                status_code=404,
                code="file_not_found",
                message="File not found",
                error_type="not_found",
                param="file_id",
            )

        metadata = file_data.get("file_metadata", {})
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = {}

        # Delete associated chunks if the file has chunk_count > 1
        chunk_count = metadata.get("chunk_count", 1)
        if chunk_count > 1:
            await db_session.execute(
                text("""
                    DELETE FROM uploaded_files
                    WHERE session_id = :session_id
                      AND file_metadata->>'parent_file_id' = :file_id
                """),
                {"session_id": session_id, "file_id": file_id}
            )

        # Delete the parent file
        await db_session.execute(
            text("""
                DELETE FROM uploaded_files
                WHERE session_id = :session_id
                  AND id = :file_id::uuid
            """),
            {"session_id": session_id, "file_id": file_id}
        )
        await db_session.commit()

        return DeleteFileResponse(
            id=file_id,
            message="File deleted successfully",
            deleted_at=datetime.datetime.now().isoformat()
        )

    except Exception as e:
        logger.exception(f"Error deleting file: {e}")
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error deleting file",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )


async def process_file_with_azure(
    file_id: str,
    session_id: str,
    chunk_ids: List[str],
    azure_client: Any
):
    """
    Background task to process a file (or its chunks) in Azure.

    Steps:
    - Create or ensure an Azure search index exists
    - Upload each file/chunk for vector indexing
    - Update the record with relevant Azure metadata
    """
    try:
        file_service = AzureFileService(azure_client)
        search_service = AzureSearchService(azure_client)

        # Create/ensure search index for this session
        await search_service.create_search_index(session_id)

        async def process_single_file(local_file_id: str):
            async with AsyncSessionLocal() as db_session:
                file_data = await db_session.get(UploadedFile, local_file_id)
                if file_data:
                    azure_file_id = await file_service.create_azure_file(
                        str(file_data.content or ""),
                        str(file_data.filename or "")
                    )
                    # Create chunks from the file content
                    chunks = [{"content": file_data.content}]  # Adjust according to your needs
                    # Upload content to the Azure Search index
                    search_success = await search_service.upload_file_to_index(
                        session_id=session_id,
                        file_id=str(file_data.id),
                        filename=str(file_data.filename),
                        content=str(file_data.content),
                        file_type=str(file_data.file_type),
                        chunks=chunks  # Add the required chunks parameter
                    )
                    # Get or create vector store
                    vector_store = await file_service.get_vector_store_for_session(
                        session_id
                    )
                    vector_store_id = vector_store["id"]

                    # Add file to the vector store
                    await file_service.add_file_to_vector_store(
                        vector_store_id, azure_file_id
                    )
                    vector_success = await file_service.wait_for_file_processing(
                        vector_store_id, azure_file_id
                    )

                    # Update status based on success
                    processing_success = search_success and vector_success
                    await update_file_status(
                        local_file_id,
                        "ready" if processing_success else "processing_error",
                        {
                            "azure_processing": (
                                "completed" if processing_success else "failed"
                            ),
                            "vector_store_id": vector_store_id,
                            "azure_file_id": azure_file_id,
                            "search_index": f"index-{session_id}",
                            "process_complete_time": datetime.datetime.now().isoformat()
                        }
                    )

        # If there are chunks, process them individually
        if chunk_ids:
            for cid in chunk_ids:
                await process_single_file(cid)
        else:
            await process_single_file(file_id)

    except Exception as e:
        logger.exception(f"Error processing file with Azure: {e}")
        await update_file_status(
            file_id,
            "processing_error",
            {
                "azure_processing": "failed",
                "error": str(e),
                "process_error_time": datetime.datetime.now().isoformat()
            }
        )


async def update_file_status(
    file_id: str,
    status: str,
    metadata_updates: Dict[str, Any]
):
    """
    Utility function to update the status and metadata of a file.

    - `file_id`: The UUID of the file to update
    - `status`: The new status string
    - `metadata_updates`: Dict of additional metadata to merge with existing
    """
    async with AsyncSessionLocal() as db_session:
        await db_session.execute(
            update(UploadedFile)
            .where(UploadedFile.id == file_id)
            .values(
                status=status,
                # Use JSONB concatenation for metadata in Postgres
                file_metadata=UploadedFile.file_metadata.op("||")(metadata_updates)
            )
        )
        await db_session.commit()
