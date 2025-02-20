# routers/files.py
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_db_session, UploadedFile, Session
from errors import create_error_response
from models import FileResponseModel, FileListResponse, DeleteFileResponse
from utils import count_tokens
import uuid
import config
import datetime
import tiktoken

router = APIRouter(prefix="/files")

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    db_session: AsyncSession = Depends(get_db_session)
):
    logger.info(f"File upload request received: {file.filename} for session {session_id}")
    if not session_id:
        raise create_error_response(
            status_code=400,
            code="missing_session_id",
            message="Session ID is required",
            param="session_id",
        )

    session_obj = await db_session.get(Session, session_id)
    if not session_obj:
        raise create_error_response(
            status_code=400,
            code="invalid_session_id",
            message="Invalid session ID",
            param="session_id",
        )

    try:
        contents = await file.read()
        try:
            file_text = contents.decode("utf-8")
            model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
            is_o_series = (any(m in model_name for m in ["o1-", "o3-"]) and "preview" not in model_name)
            token_count = count_tokens(file_text, config.AZURE_OPENAI_DEPLOYMENT_NAME)
            max_tokens = 200000 if is_o_series else 4096
            truncated = False
            if token_count > max_tokens:
                encoding = tiktoken.get_encoding("cl100k_base")
                tokens = encoding.encode(file_text)
                safe_token_limit = max_tokens - 100  # Reserve room for truncation message
                truncated_tokens = tokens[:safe_token_limit]
                file_text = encoding.decode(truncated_tokens) + "\n[Content truncated to fit model context window]"
                token_count = count_tokens(file_text, config.AZURE_OPENAI_DEPLOYMENT_NAME)
                truncated = True
                logger.info(f"File truncated from {len(tokens)} to {token_count} tokens")
            file_id = uuid.uuid4()
            uploaded_file = UploadedFile(
                id=file_id,
                session_id=session_id,
                filename=file.filename or "unnamed_file.txt",
                content=file_text,
                size=len(contents),
            )
            db_session.add(uploaded_file)
            await db_session.commit()
            metadata = {
                "filename": file.filename,
                "size": len(contents),
                "upload_time": uploaded_file.upload_time.isoformat(),
                "char_count": len(file_text),
                "token_count": token_count,
                "model_info": {
                    "name": config.AZURE_OPENAI_DEPLOYMENT_NAME,
                    "type": "o-series" if is_o_series else "standard",
                    "max_context_tokens": max_tokens,
                    "encoding": "cl100k_base",
                },
                "truncated": truncated,
            }
            logger.info(f"File uploaded successfully: {file.filename} ({metadata['size']} bytes, ~{metadata['token_count']} tokens)")
            return {
                "message": "File uploaded successfully",
                "file_id": str(file_id),
                "metadata": metadata,
            }
        except UnicodeDecodeError:
            raise create_error_response(
                status_code=400,
                code="invalid_encoding",
                message="File must be valid UTF-8 text",
                error_type="validation_error",
                param="file",
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="file_processing_error",
            message="Error processing file",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )

@router.get("/{session_id}", response_model=FileListResponse)
async def get_files(session_id: str, db_session: AsyncSession = Depends(get_db_session)):
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
        result = await db_session.execute(text("""
            SELECT id, filename, size, upload_time, LENGTH(content) AS char_count, LENGTH(content) / 3 AS token_count
            FROM uploaded_files
            WHERE session_id = :session_id
            ORDER BY upload_time DESC
        """), {"session_id": session_id})
        files = result.mappings().all()
        total_size = sum(file["size"] for file in files)
        return FileListResponse(
            files=[
                FileResponseModel(
                    id=str(file["id"]),
                    filename=file["filename"],
                    size=file["size"],
                    upload_time=file["upload_time"].isoformat(),
                    char_count=file["char_count"],
                    token_count=file["token_count"],
                )
                for file in files
            ],
            total_count=len(files),
            total_size=total_size,
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error retrieving files",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )

@router.delete("/{session_id}/{file_id}", response_model=DeleteFileResponse)
async def delete_file(session_id: str, file_id: str, db_session: AsyncSession = Depends(get_db_session)):
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
        result = await db_session.execute(text("""
            DELETE FROM uploaded_files
            WHERE session_id = :session_id AND id = :file_id
            RETURNING id
        """), {"session_id": session_id, "file_id": file_id})
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
        if isinstance(e, HTTPException):
            raise e
        raise create_error_response(
            status_code=500,
            code="database_error",
            message="Error deleting file",
            error_type="internal_error",
            inner_error={"original_error": str(e)},
        )