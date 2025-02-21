from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, BackgroundTasks
from logging_config import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, update
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
import asyncio
import os
from typing import List, Optional, Dict, Any

router = APIRouter(prefix="/files")

@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    session_id: str = Form(...),
    process_with_azure: bool = Form(False),
    db_session: AsyncSession = Depends(get_db_session),
    azure_client: Optional[Any] = Depends(get_azure_client),
):
    """Upload a file with enhanced processing options"""
    logger.info(f"File upload: {file.filename} for session {session_id}, azure processing: {process_with_azure}")

    try:
        contents = await file.read()
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
            "original_size": len(contents),
            "processed_time": datetime.datetime.now().isoformat(),
            "token_count": processed_data["token_count"],
            "chunk_count": processed_data["chunk_count"],
            "model": model_name,
            "azure_file_id": None,
            "vector_store_id": None
        }

        uploaded_file = UploadedFile(
            id=file_id,
            session_id=session_id,
            filename=filename,
            content=processed_data.get("original_text", ""),
            size=len(contents),
            file_type=processed_data.get("file_type", file_extension),
            chunk_count=processed_data["chunk_count"],
            metadata=metadata,
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
                    metadata={
                        "parent_file_id": str(file_id),
                        "chunk_index": i,
                        "total_chunks": processed_data["chunk_count"],
                        "token_count": count_tokens(chunk, model_name)
                    }
                )
                db_session.add(chunk_file)

        db_session.add(uploaded_file)
        await db_session.commit()

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
            message="Error processing file",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )

@router.get("/{session_id}", response_model=FileListResponse)
async def get_files(session_id: str, db_session: AsyncSession = Depends(get_db_session)):
    """Get all files for a session with enhanced metadata"""
    try:
        session_obj = await db_session.get(Session, session_id)
        if not session_obj:
            raise create_error_response(
                status_code=404,
                code="session_not_found",
                message="Session not found",
                error_type="not_found",
                param="session_id",
            )
            
        result = await db_session.execute(
            text("""
                SELECT id, filename, size, file_type, chunk_count, status, metadata, upload_time
                FROM uploaded_files
                WHERE session_id = :session_id AND (status != 'chunk' OR status IS NULL)
                ORDER BY upload_time DESC
            """), 
            {"session_id": session_id}
        )
        
        files = result.mappings().all()
        files_with_details = []
        
        for file in files:
            file_dict = dict(file)
            
            if file_dict.get("metadata"):
                try:
                    file_dict["metadata"] = json.loads(file_dict["metadata"]) if isinstance(file_dict["metadata"], str) else file_dict["metadata"]
                except:
                    file_dict["metadata"] = {}
            
            if file_dict.get("chunk_count", 0) > 1:
                chunk_result = await db_session.execute(
                    text("""
                        SELECT SUM(LENGTH(content)) as total_chars,
                               jsonb_agg(metadata) as chunks_metadata
                        FROM uploaded_files
                        WHERE session_id = :session_id 
                              AND status = 'chunk'
                              AND metadata->>'parent_file_id' = :parent_id
                    """),
                    {"session_id": session_id, "parent_id": str(file_dict["id"])}
                )
                chunk_data = chunk_result.mappings().first()
                
                if chunk_data:
                    file_dict["char_count"] = chunk_data["total_chars"] or 0
                    chunks_metadata = chunk_data["chunks_metadata"] or []
                    chunks_metadata = [json.loads(m) if isinstance(m, str) else m for m in chunks_metadata]
                    file_dict["token_count"] = sum(m.get("token_count", 0) for m in chunks_metadata)
                else:
                    file_dict["char_count"] = len(file_dict.get("content", ""))
                    file_dict["token_count"] = file_dict.get("size", 0) // 4
            else:
                file_dict["char_count"] = len(file_dict.get("content", ""))
                file_dict["token_count"] = file_dict["metadata"].get("token_count", file_dict.get("size", 0) // 4)
            
            files_with_details.append(file_dict)
        
        total_size = sum(file.get("size", 0) for file in files_with_details)
        
        return FileListResponse(
            files=[
                FileResponseModel(
                    id=str(file["id"]),
                    filename=file["filename"],
                    size=file["size"],
                    upload_time=file["upload_time"].isoformat(),
                    char_count=file.get("char_count", 0),
                    token_count=file.get("token_count", 0),
                    file_type=file.get("file_type", ""),
                    chunk_count=file.get("chunk_count", 1),
                    status=file.get("status", "ready"),
                    metadata=file.get("metadata", {})
                )
                for file in files_with_details
            ],
            total_count=len(files_with_details),
            total_size=total_size,
        )

    except Exception as e:
        logger.exception(f"Error retrieving files: {e}")
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error retrieving files",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )

@router.delete("/{session_id}/{file_id}", response_model=DeleteFileResponse)
async def delete_file(
    session_id: str, 
    file_id: str, 
    db_session: AsyncSession = Depends(get_db_session),
    azure_client: Optional[Any] = Depends(get_azure_client)
):
    """Delete a file and optionally remove it from Azure OpenAI"""
    try:
        file_result = await db_session.execute(
            text("""
                SELECT id, filename, metadata FROM uploaded_files 
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
        
        metadata = file_data.get("metadata", {})
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except:
                metadata = {}
                
        azure_file_id = metadata.get("azure_file_id")
        vector_store_id = metadata.get("vector_store_id")
        
        if azure_file_id and vector_store_id and azure_client:
            try:
                file_service = AzureFileService(azure_client)
                await file_service.delete_file_from_vector_store(vector_store_id, azure_file_id)
                logger.info(f"Removed file {azure_file_id} from vector store {vector_store_id}")
            except Exception as e:
                logger.error(f"Error removing file from Azure: {e}")
        
        if metadata.get("chunk_count", 0) > 1:
            await db_session.execute(
                text("""
                    DELETE FROM uploaded_files 
                    WHERE session_id = :session_id 
                    AND status = 'chunk' 
                    AND metadata->>'parent_file_id' = :parent_id
                """), 
                {"session_id": session_id, "parent_id": file_id}
            )
        
        result = await db_session.execute(
            text("""
                DELETE FROM uploaded_files 
                WHERE session_id = :session_id AND id = :file_id::uuid
                RETURNING id
            """), 
            {"session_id": session_id, "file_id": file_id}
        )
        
        deleted = result.first()
        if not deleted:
            raise create_error_response(
                status_code=404,
                code="file_not_found",
                message="File not found",
                error_type="not_found",
                param="file_id",
            )
            
        await db_session.commit()
        
        return DeleteFileResponse(
            id=str(deleted[0]),
            message="File deleted successfully",
            deleted_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
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
    """Process a file with Azure OpenAI in the background"""
    async def update_file_status(file_id: str, status: str, metadata_update: Dict[str, Any]) -> None:
        async with AsyncSessionLocal() as db_session:
            try:
                result = await db_session.execute(
                    text("SELECT metadata FROM uploaded_files WHERE id = :file_id::uuid"),
                    {"file_id": file_id}
                )
                file_data = result.first()
                
                if not file_data:
                    return
                
                current_metadata = file_data[0] or {}
                if isinstance(current_metadata, str):
                    try:
                        current_metadata = json.loads(current_metadata)
                    except:
                        current_metadata = {}
                
                updated_metadata = {**current_metadata, **metadata_update}
                
                await db_session.execute(
                    text("""
                        UPDATE uploaded_files 
                        SET status = :status, metadata = :metadata::jsonb
                        WHERE id = :file_id::uuid
                    """),
                    {
                        "file_id": file_id, 
                        "status": status, 
                        "metadata": json.dumps(updated_metadata)
                    }
                )
                await db_session.commit()
            except Exception as e:
                await db_session.rollback()

    try:
        file_service = AzureFileService(azure_client)
        await update_file_status(
            file_id, 
            "processing", 
            {"azure_processing": "started", "process_start_time": datetime.datetime.now().isoformat()}
        )
        
        vector_store = await file_service.get_vector_store_for_session(session_id)
        vector_store_id = vector_store["id"]
        
        if chunk_ids:
            azure_file_ids = []
            for chunk_id in chunk_ids:
                async with AsyncSessionLocal() as db_session:
                    result = await db_session.execute(
                        text("SELECT content, filename FROM uploaded_files WHERE id = :id::uuid"),
                        {"id": chunk_id}
                    )
                    chunk_data = result.first()
                    
                    if chunk_data:
                        chunk_content, chunk_filename = chunk_data
                        azure_file_id = await file_service.create_azure_file(chunk_content, chunk_filename)
                        azure_file_ids.append(azure_file_id)
                        
                        await db_session.execute(
                            text("""
                                UPDATE uploaded_files 
                                SET metadata = jsonb_set(metadata, '{azure_file_id}', :azure_file_id::jsonb)
                                WHERE id = :id::uuid
                            """),
                            {"id": chunk_id, "azure_file_id": f'"{azure_file_id}"'}
                        )
                        await db_session.commit()
            
            if azure_file_ids:
                batch_id = await file_service.create_file_batch(vector_store_id, azure_file_ids)
                processing_success = await file_service.wait_for_file_processing(vector_store_id, azure_file_ids[0])
                
                await update_file_status(
                    file_id,
                    "ready" if processing_success else "processing_error",
                    {
                        "azure_processing": "completed" if processing_success else "failed",
                        "vector_store_id": vector_store_id,
                        "azure_file_ids": azure_file_ids,
                        "azure_batch_id": batch_id,
                        "process_complete_time": datetime.datetime.now().isoformat()
                    }
                )
        else:
            async with AsyncSessionLocal() as db_session:
                result = await db_session.execute(
                    text("SELECT content, filename FROM uploaded_files WHERE id = :id::uuid"),
                    {"id": file_id}
                )
                file_data = result.first()
                
                if file_data:
                    content, filename = file_data
                    azure_file_id = await file_service.create_azure_file(content, filename)
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
