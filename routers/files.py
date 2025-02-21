from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, BackgroundTasks
from logging_config import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, update
from database import get_db_session, UploadedFile, Session, AsyncSessionLocal
from errors import create_error_response
from models import FileResponseModel, FileListResponse, DeleteFileResponse
from utils import count_tokens
from services.azure_file_service import AzureFileService
from clients import get_azure_client
import uuid
import config
import datetime
import json
import os
from typing import List, Optional, Dict, Any

router = APIRouter()

# File upload endpoint
@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    session_id: str = Form(...),
    process_with_azure: bool = Form(False),
    db_session: AsyncSession = Depends(get_db_session),
    azure_client: Optional[Any] = Depends(get_azure_client),
):
    """Upload a file with enhanced processing options.

    Args:
        background_tasks: BackgroundTasks for scheduling Azure processing.
        file: The uploaded file.
        session_id: The session ID associated with the upload.
        process_with_azure: Boolean to determine if Azure processing is required.
        db_session: Database session dependency.
        azure_client: Azure client dependency.

    Returns:
        dict: Response containing file details and processing status.
    """
    logger.info(f"File upload: {file.filename} for session {session_id}, azure processing: {process_with_azure}")

    try:
        # Read file contents and validate size
        contents = await file.read()
        size = len(contents)
        
        # Use the new config settings
        if size > config.settings.MAX_FILE_SIZE:
            raise create_error_response(
                status_code=413,
                code="file_too_large", 
                message=f"File exceeds size limit ({config.settings.MAX_FILE_SIZE_HUMAN})",
                param="file",
                error_type="validation_error"
            )
            
        if size > config.settings.WARNING_FILE_SIZE:
            logger.warning(f"Large file uploaded: {size} bytes, filename: {file.filename}")

        filename = file.filename or "unnamed_file.txt"
        file_extension = os.path.splitext(filename)[1].lower()
        supported_extensions = ['.txt', '.md', '.pdf', '.docx', '.doc', '.json', '.js', '.py', '.html', '.css']

        if file_extension not in supported_extensions:
            raise create_error_response(
                status_code=400,
                code="unsupported_file_type",
                message=f"Unsupported file type: {file_extension}. Supported types: {', '.join(supported_extensions)}",
                error_type="validation_error",
                param="file"
            )

        model_name = config.AZURE_OPENAI_DEPLOYMENT_NAME
        from services.file_service import process_uploaded_file
        processed_data = await process_uploaded_file(contents, filename, model_name)

        file_id = uuid.uuid4()
        metadata = {
            "filename": filename,
            "original_size": size,
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
        if processed_data["chunk_count"] > 1:
            for i, chunk in enumerate(processed_data["text_chunks"]):
                chunk_id = uuid.uuid4()
                chunk_ids.append(str(chunk_id))
                chunk_file = UploadedFile(
                    id=chunk_id,
                    session_id=session_id,
                    filename=f"{filename}.chunk{i+1}",
                    content=chunk,
                    size=len(chunk.encode('utf-8')),
                    file_type=processed_data["file_type"],
                    status="chunk",
                    file_metadata={
                        "parent_file_id": str(file_id),
                        "chunk_index": i,
                        "total_chunks": processed_data["chunk_count"],
                        "token_count": count_tokens(chunk, model_name)
                    }
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
async def get_files(session_id: str, db_session: AsyncSession = Depends(get_db_session)):
    """Get all files for a session with enhanced metadata."""
    logger.info(f"Fetching files for session_id: {session_id}")
    try:
        # Validate session existence
        result = await db_session.execute(
            text("SELECT id FROM sessions WHERE id = :session_id"),
            {"session_id": session_id}
        )
        if not result.scalar_one_or_none():
            logger.warning(f"Session not found: {session_id}")
            return FileListResponse(files=[], total_count=0, total_size=0)

        # Fetch files with simplified query
        result = await db_session.execute(
            text("""
                SELECT 
                    id, 
                    filename, 
                    size, 
                    file_type,
                    COALESCE(chunk_count, 1) as chunk_count,
                    COALESCE(status, 'ready') as status,
                    file_metadata,
                    upload_time
                FROM uploaded_files
                WHERE session_id = :session_id 
                AND (status != 'chunk' OR status IS NULL)
                ORDER BY upload_time DESC
            """),
            {"session_id": session_id}
        )
        files = result.mappings().all()

        files_with_details = []
        total_size = 0

        for file in files:
            file_dict = dict(file)
            
            # Handle metadata safely
            try:
                file_dict["file_metadata"] = (
                    json.loads(file_dict["file_metadata"])
                    if isinstance(file_dict["file_metadata"], str)
                    else file_dict["file_metadata"] or {}
                )
            except (json.JSONDecodeError, TypeError):
                file_dict["file_metadata"] = {}

            # Set default values
            file_dict["char_count"] = 0
            file_dict["token_count"] = file_dict["file_metadata"].get("token_count", file_dict["size"] // 4)
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
        # Return empty response instead of throwing error
        return FileListResponse(files=[], total_count=0, total_size=0)

# Delete file endpoint
@router.delete("/{session_id}/{file_id}", response_model=DeleteFileResponse)
async def delete_file(
    session_id: str,
    file_id: str,
    db_session: AsyncSession = Depends(get_db_session),
    azure_client: Optional[Any] = Depends(get_azure_client)
):
    """Delete a file and its associated chunks if applicable.

    Args:
        session_id: The session ID of the file.
        file_id: The ID of the file to delete.
        db_session: Database session dependency.
        azure_client: Azure client dependency.

    Returns:
        DeleteFileResponse: Confirmation of deletion.
    """
    try:
        file_result = await db_session.execute(
            text("""
                SELECT id, filename, file_metadata, status FROM uploaded_files 
                WHERE session_id = :session_id AND id = :file_id::uuid
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
            except:
                metadata = {}

        # Delete associated chunks if the file is a parent with chunks
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
                WHERE session_id = :session_id AND id = :file_id::uuid
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

# Background task for Azure processing
async def process_file_with_azure(
    file_id: str,
    session_id: str,
    chunk_ids: List[str],
    azure_client: Any
):
    """Process file with Azure OpenAI and update status.

    Args:
        file_id: The ID of the parent file.
        session_id: The session ID.
        chunk_ids: List of chunk IDs if applicable.
        azure_client: Azure client instance.
    """
    try:
        file_service = AzureFileService(azure_client)
        if chunk_ids:
            for chunk_id in chunk_ids:
                async with AsyncSessionLocal() as db_session:
                    chunk_data = await db_session.get(UploadedFile, chunk_id)
                    if chunk_data:
                        vector_store_id = chunk_data.file_metadata.get("vector_store_id")
                        azure_file_id = chunk_data.file_metadata.get("azure_file_id")
                        await file_service.add_file_to_vector_store(vector_store_id, azure_file_id)
                        processing_success = await file_service.wait_for_file_processing(vector_store_id, azure_file_id)
                        await update_file_status(
                            chunk_id,
                            "ready" if processing_success else "processing_error",
                            {
                                "azure_processing": "completed" if processing_success else "failed",
                                "vector_store_id": vector_store_id,
                                "azure_file_id": azure_file_id,
                                "process_complete_time": datetime.datetime.now().isoformat()
                            }
                        )
        else:
            async with AsyncSessionLocal() as db_session:
                file_data = await db_session.get(UploadedFile, file_id)
                if file_data:
                    vector_store_id = file_data.file_metadata.get("vector_store_id")
                    azure_file_id = file_data.file_metadata.get("azure_file_id")
                    await file_service.add_file_to_vector_store(vector_store_id, azure_file_id)
                    processing_success = await file_service.wait_for_file_processing(vector_store_id, azure_file_id)
                    await update_file_status(
                        file_id,
                        "ready" if processing_success else "processing_error",
                        {
                            "azure_processing": "completed" if processing_success else "failed",
                            "vector_store_id": vector_store_id,
                            "azure_file_id": azure_file_id,
                            "process_complete_time": datetime.datetime.now().isoformat()
                        }
                    )

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

# Utility function to update file status
async def update_file_status(file_id: str, status: str, metadata_updates: Dict[str, Any]):
    """Update the status and metadata of a file.

    Args:
        file_id: The ID of the file to update.
        status: New status for the file.
        metadata_updates: Dictionary of metadata updates.
    """
    async with AsyncSessionLocal() as db_session:
        await db_session.execute(
            update(UploadedFile)
            .where(UploadedFile.id == file_id)
            .values(
                status=status,
                file_metadata=UploadedFile.file_metadata.op('||')(metadata_updates)
            )
        )
        await db_session.commit()
