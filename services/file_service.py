import os
import time
import mimetypes
import tempfile
import asyncio
from io import BytesIO
from datetime import datetime
from typing import List, Dict, Any, Optional

import sentry_sdk
from azure.core.exceptions import HttpResponseError
import tiktoken

from logging_config import get_logger
import config
from services.tracing_utils import trace_function, trace_file_operation, trace_block

# Import docx2txt and handle missing dependency
try:
    import docx2txt
    DOCX_SUPPORTED = True
except ImportError as e:
    DOCX_SUPPORTED = False
    docx2txt = None
    get_logger(__name__).error(f"Critical dependency missing: {str(e)}")
    raise RuntimeError(f"Required package not installed: {e.name}") from e

# Import PyPDF2 and handle missing dependency
try:
    import PyPDF2
    PDF_SUPPORTED = True
except ImportError as e:
    PDF_SUPPORTED = False
    PyPDF2 = None
    get_logger(__name__).error(f"Critical dependency missing: {str(e)}")
    raise RuntimeError(f"Required package not installed: {e.name}") from e

# Import LangChain support if installed
try:
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    LANGCHAIN_SUPPORTED = True
except ImportError:
    LANGCHAIN_SUPPORTED = False
    RecursiveCharacterTextSplitter = None
    get_logger(__name__).warning("langchain not installed - advanced text splitting unavailable")

logger = get_logger(__name__)

# Constants
DEFAULT_CHUNK_SIZE = 4000   # Default tokens per chunk
MAX_TOKENS_PER_FILE = 200000  # Maximum tokens for o-series models
OVERLAP_SIZE = 200          # Token overlap between chunks

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    ".txt",
    ".md",
    ".pdf",
    ".docx",
    ".doc",
    ".json",
    ".js",
    ".py",
    ".html",
    ".css",
    ".xml",
    ".csv",
    ".xls",
    ".xlsx",
    ".pptx",
    ".ppt",
}

# Token count cache
_token_count_cache = {}

# -----------------------------------------------------------------------------
# Stubs or references to functions in the same or other modules.
# Ensure you have these (or adapt as needed) in your project:
# -----------------------------------------------------------------------------
def verify_file_signature(file_content: bytes, file_extension: str) -> bool:
    """
    Placeholder for security checks verifying file signature.
    In production, do a real signature check based on known magic bytes, etc.
    """
    # Basic example: always return True. Replace with your own logic as needed.
    return True

def sanitize_content(text: str) -> str:
    """
    Sanitize text by removing or escaping unwanted characters.
    """
    return text.replace("\r", "")

async def fix_mobile_rotation(file_content: bytes) -> bytes:
    """
    Stub function for fixing mobile image rotation. 
    If not applicable, remove or replace with actual logic.
    """
    return file_content

async def downsample_media(file_content: bytes, filename: str) -> bytes:
    """
    Stub function for downsampling media (e.g., images, videos).
    If not applicable, remove or replace with actual logic.
    """
    return file_content

# -----------------------------------------------------------------------------
# Main file processing function
# -----------------------------------------------------------------------------
@trace_function(op="file.process", name="process_uploaded_file")
async def process_uploaded_file(
    file_content: bytes,
    filename: str,
    model_name: str,
    is_mobile: bool = False
) -> Dict[str, Any]:
    """
    Process an uploaded file based on its type.

    1) If is_mobile is True, perform optional rotation/downsampling for image files.
    2) Check file extension, verify security, and check size.
    3) Extract text from the file using the appropriate function (txt, PDF, docx, etc.).
    4) Count tokens with tiktoken.
    5) If needed, chunk or truncate text to fit model limits.
    6) Return an organized dictionary of information about the file.

    Args:
        file_content (bytes): Raw file content as bytes.
        filename (str): Name of the uploaded file.
        model_name (str): The model to use for token counting.
        is_mobile (bool): If True, handle special mobile media tasks.

    Returns:
        Dict[str, Any]: Processed result including text, chunks, token counts, etc.
    """
    start_time = time.time()
    transaction = sentry_sdk.start_transaction(
        name=f"process_file_{os.path.splitext(filename)[1].lower()[1:]}",
        op="file.process"
    )

    sentry_sdk.set_tag("file.name", filename)
    sentry_sdk.set_tag("model.name", model_name)

    file_extension: Optional[str] = None
    mime_type: Optional[str] = None

    try:
        # Mobile-specific steps
        if is_mobile:
            # Handle mobile image rotation
            if filename.lower().endswith(('.jpg', '.jpeg', '.heic')):
                file_content = await fix_mobile_rotation(file_content)
            
            # Downsample large media
            if len(file_content) > 10 * 1024 * 1024:  # 10MB
                file_content = await downsample_media(file_content, filename)

        # Validate file extension
        file_extension = os.path.splitext(filename)[1].lower()
        if file_extension not in ALLOWED_EXTENSIONS:
            error_msg = f"Unsupported file type: {file_extension}"
            logger.warning(error_msg, extra={"filename": filename})
            sentry_sdk.set_tag("error.type", "unsupported_file_type")
            raise ValueError(error_msg)

        # Verify the file content matches the reported extension
        if not verify_file_signature(file_content, file_extension):
            error_msg = f"File content does not match extension: {file_extension}"
            logger.warning(error_msg, extra={"filename": filename})
            sentry_sdk.set_tag("error.type", "unsupported_file_type")
            raise ValueError(error_msg)

        # Check file size
        file_size = len(file_content)
        max_size = config.settings.MAX_FILE_SIZE
        if file_size > max_size:
            error_msg = f"File too large: {file_size} bytes. Max allowed: {max_size} bytes"
            logger.warning(error_msg, extra={"filename": filename})
            sentry_sdk.set_tag("error.type", "file_too_large")
            raise ValueError(error_msg)

        transaction.set_data("file.size", file_size)
        transaction.set_data("file.type", file_extension)

        # Try to guess mime type
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        transaction.set_data("file.mime_type", mime_type)

        # Extract text
        with trace_block("Text Extraction", op="file.extract_text", file_type=file_extension) as span:
            if file_extension in [".txt", ".md", ".json", ".js", ".py", ".html", ".css"]:
                text_content = sanitize_content(file_content.decode("utf-8", errors="replace"))
                span.set_data("extraction_method", "direct_decode")

            elif file_extension == ".pdf" and PDF_SUPPORTED:
                text_content = await extract_pdf_text(file_content)
                span.set_data("extraction_method", "pdf_parser")

            elif file_extension in [".docx", ".doc"] and DOCX_SUPPORTED:
                text_content = await extract_docx_text(file_content)
                span.set_data("extraction_method", "docx_parser")

            else:
                # Fallback: attempt decode as UTF-8
                try:
                    text_content = file_content.decode("utf-8", errors="replace")
                    span.set_data("extraction_method", "fallback_decode")
                except UnicodeDecodeError:
                    error_msg = f"Unsupported or binary file type: {file_extension}"
                    span.set_data("extraction_success", False)
                    span.set_data("error.type", "binary_file")
                    raise ValueError(error_msg)

            span.set_data("extraction_success", True)
            span.set_data("text_length", len(text_content))

        # Count tokens
        with trace_block("Token Counting", op="nlp.token_count", model=model_name) as span:
            token_count = await count_tokens(text_content, model_name)
            span.set_data("token_count", token_count)
            logger.info(
                f"File {filename} has approximately {token_count} tokens",
                extra={"filename": filename, "token_count": token_count, "model": model_name}
            )

        transaction.set_data("token_count", token_count)

        # Determine max tokens based on model
        is_o_series = (
            any(m in model_name.lower() for m in ["o1-", "o3-"])
            and "preview" not in model_name
        )
        max_tokens = MAX_TOKENS_PER_FILE if is_o_series else 4096
        transaction.set_data("max_tokens", max_tokens)

        chunks = []
        # Chunk or truncate if needed
        with trace_block("Text Processing", op="text.process") as span:
            if token_count > max_tokens and not LANGCHAIN_SUPPORTED:
                # If LangChain isn't available, do a simple truncation
                logger.warning(
                    f"File {filename} exceeds token limit and langchain not available",
                    extra={"filename": filename, "token_count": token_count, "max_tokens": max_tokens}
                )
                with sentry_sdk.start_span(op="text.truncate", description="Text Truncation") as truncate_span:
                    encoding = tiktoken.get_encoding("cl100k_base")
                    tokens = encoding.encode(text_content)
                    safe_token_limit = max_tokens - 100
                    truncated_tokens = tokens[:safe_token_limit]
                    text_content = (
                        encoding.decode(truncated_tokens)
                        + "\n[Content truncated to fit model context window]"
                    )
                    token_count = await count_tokens(text_content, model_name)  # re-count
                    chunks = [text_content]

                    truncate_span.set_data("process_type", "truncation")
                    truncate_span.set_data("original_tokens", len(tokens))
                    truncate_span.set_data("truncated_tokens", len(truncated_tokens))

            elif token_count > DEFAULT_CHUNK_SIZE:
                # Use chunking
                with sentry_sdk.start_span(op="text.chunk", description="Text Chunking") as chunk_span:
                    chunks = await chunk_text(text_content, DEFAULT_CHUNK_SIZE, model_name)
                    chunk_span.set_data("process_type", "chunking")
                    chunk_span.set_data("chunk_count", len(chunks))
                    logger.info(
                        f"Split {filename} into {len(chunks)} chunks",
                        extra={"filename": filename, "chunk_count": len(chunks)}
                    )
            else:
                # Single chunk is enough
                chunks = [text_content]
                span.set_data("process_type", "single_chunk")
                span.set_data("chunk_count", 1)

        result = {
            "original_text": text_content,
            "text_chunks": chunks,
            "token_count": token_count,
            "chunk_count": len(chunks),
            "file_type": file_extension,
            "mime_type": mime_type,
            "metadata": {
                "filename": filename,
                "size": file_size,
                "chunks": len(chunks),
                "processed_time": datetime.now().isoformat(),
                "model": model_name,
                "processing_time_ms": int((time.time() - start_time) * 1000)
            },
        }

        transaction.set_data("success", True)
        transaction.set_data("chunk_count", len(chunks))
        transaction.set_data("processing_time", time.time() - start_time)
        return result

    except Exception as e:
        # Capture and return error
        sentry_sdk.capture_exception(e)
        logger.exception(
            f"Error processing file {filename}: {e}",
            extra={"filename": filename, "error": str(e)}
        )
        transaction.set_data("success", False)
        transaction.set_data("error.type", e.__class__.__name__)
        transaction.set_data("error.message", str(e))

        return {
            "original_text": f"Error processing file: {str(e)}",
            "text_chunks": [f"Error processing file: {str(e)}"],
            "token_count": 0,
            "chunk_count": 1,
            "file_type": file_extension,
            "mime_type": mime_type,
            "error": str(e),
            "metadata": {
                "filename": filename,
                "size": len(file_content),
                "error": str(e),
                "processed_time": datetime.now().isoformat(),
                "processing_time_ms": int((time.time() - start_time) * 1000)
            },
        }
    finally:
        transaction.finish()


# -----------------------------------------------------------------------------
# PDF extraction
# -----------------------------------------------------------------------------
@trace_file_operation("pdf_read")
async def extract_pdf_text(file_content: bytes) -> str:
    """
    Extract text from a PDF using PyPDF2, page by page.
    """
    if not PDF_SUPPORTED:
        logger.warning("PDF extraction requested but PyPDF2 not installed")
        sentry_sdk.add_breadcrumb(
            category="file",
            message="PDF extraction not available - missing PyPDF2",
            level="warning"
        )
        return "[PDF extraction not available - install PyPDF2]"

    with sentry_sdk.start_span(op="file.extract_pdf", description="PDF Text Extraction") as span:
        start_time = time.time()
        span.set_data("file_size", len(file_content))

        def _extract() -> str:
            if not PyPDF2:
                return "[PDF extraction not available - install PyPDF2]"
            try:
                pdf_file = BytesIO(file_content)
                reader = PyPDF2.PdfReader(pdf_file)
                text = []
                # Attempt to record some metadata
                try:
                    metadata = reader.metadata
                    if metadata:
                        span.set_data("pdf.title", metadata.get("/Title", ""))
                        span.set_data("pdf.author", metadata.get("/Author", ""))
                        span.set_data("pdf.creator", metadata.get("/Creator", ""))
                except Exception:
                    pass  # ignore metadata errors

                page_count = len(reader.pages)
                span.set_data("pdf.page_count", page_count)

                empty_pages = 0
                for i, page in enumerate(reader.pages):
                    with sentry_sdk.start_span(op="pdf.extract_page", description=f"Extract Page {i + 1}") as page_span:
                        page_start = time.time()
                        page_text = page.extract_text() or ""
                        if page_text.strip():
                            text.append(f"--- Page {i + 1} ---\n{page_text}")
                            page_span.set_data("page.text_length", len(page_text))
                            page_span.set_data("page.empty", False)
                        else:
                            empty_pages += 1
                            page_span.set_data("page.empty", True)
                        
                        page_span.set_data("duration_seconds", time.time() - page_start)

                span.set_data("pdf.empty_pages", empty_pages)
                result = "\n\n".join(text)
                span.set_data("total_text_length", len(result))
                return result

            except Exception as e:
                error_msg = f"PDF extraction error: {str(e)}"
                logger.exception(error_msg)
                sentry_sdk.capture_exception(e)
                span.set_data("success", False)
                span.set_data("error.type", e.__class__.__name__)
                span.set_data("error.message", str(e))
                return f"[PDF extraction error: {str(e)}]"

        loop = asyncio.get_event_loop()
        with sentry_sdk.start_span(op="file.extract_pdf", description="Extract PDF Content") as extract_span:
            extracted_text = await loop.run_in_executor(None, _extract)

        extract_span.set_data("duration_seconds", time.time() - start_time)
        extract_span.set_data("success", True)
        return extracted_text


# -----------------------------------------------------------------------------
# DOCX extraction
# -----------------------------------------------------------------------------
@trace_file_operation("docx_read")
async def extract_docx_text(file_content: bytes) -> str:
    """
    Extract text from a DOCX file using docx2txt.

    Args:
        file_content (bytes): Raw DOCX file bytes
    Returns:
        str: Extracted text
    """
    if not DOCX_SUPPORTED:
        logger.warning("DOCX extraction requested but docx2txt not installed")
        sentry_sdk.add_breadcrumb(
            category="file",
            message="DOCX extraction not available - missing docx2txt",
            level="warning"
        )
        return "[DOCX extraction not available - install docx2txt]"

    with sentry_sdk.start_span(op="file.extract_docx", description="DOCX Text Extraction") as span:
        start_time = time.time()
        span.set_data("file_size", len(file_content))

        def _extract() -> str:
            if docx2txt is None:
                return "[DOCX extraction not available - install docx2txt]"
            try:
                docx_file = BytesIO(file_content)
                with sentry_sdk.start_span(op="file.process_docx", description="Process DOCX"):
                    try:
                        with tempfile.NamedTemporaryFile(delete=True) as temp_file:
                            temp_file.write(docx_file.read())
                            temp_file.flush()
                            # IMPORTANT: call docx2txt.process(), not docx2txt(...)
                            text = docx2txt.process(temp_file.name)
                    except Exception as e:
                        logger.exception(f"DOCX processing error: {str(e)}")
                        sentry_sdk.capture_exception(e)
                        text = ""

                # Check if the document is empty
                is_empty = not text or not text.strip()
                span.set_data("text_length", len(text) if text else 0)
                span.set_data("is_empty", is_empty)
                if not is_empty:
                    span.set_data("line_count", text.count('\n') + 1)
                    span.set_data("word_count", len(text.split()))
                return text or "[Empty document or extraction failed]"
            except Exception as e:
                error_msg = f"DOCX extraction error: {str(e)}"
                logger.exception(error_msg)
                sentry_sdk.capture_exception(e)
                span.set_data("success", False)
                span.set_data("error.type", e.__class__.__name__)
                span.set_data("error.message", str(e))
                return f"[DOCX extraction error: {str(e)}]"

        loop = asyncio.get_event_loop()
        extracted_text = await loop.run_in_executor(None, _extract)

        span.set_data("duration_seconds", time.time() - start_time)
        span.set_data("success", True)

        sentry_sdk.add_breadcrumb(
            category="file",
            message=f"DOCX extraction completed in {time.time() - start_time:.2f}s",
            level="info",
            data={"text_length": len(extracted_text)}
        )

        return extracted_text


# -----------------------------------------------------------------------------
# Chunking and token counting
# -----------------------------------------------------------------------------
async def chunk_text(
    text: str,
    max_tokens_per_chunk: int = DEFAULT_CHUNK_SIZE,
    model_name: Optional[str] = None,
) -> List[str]:
    """
    Split text into chunks with optional advanced splitting (LangChain) or fallback logic.

    Args:
        text (str): The text to split.
        max_tokens_per_chunk (int): Maximum tokens per chunk.
        model_name (str, optional): Model name for token counting.

    Returns:
        List[str]: Chunks of text.
    """
    if not text:
        return [""]

    # If we can use LangChain's RecursiveCharacterTextSplitter, do so
    if LANGCHAIN_SUPPORTED and RecursiveCharacterTextSplitter is not None:
        total_tokens_in_text = await count_tokens(text, model_name)
        chars_per_token = len(text) / max(1, total_tokens_in_text)
        overlap_chars = int(OVERLAP_SIZE * chars_per_token)

        # If o-series, allow a bigger chunk size
        if model_name and any(m in model_name.lower() for m in ["o1-", "o3-"]):
            max_tokens_per_chunk = 8000

        chars_per_chunk = int(max_tokens_per_chunk * chars_per_token)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chars_per_chunk,
            chunk_overlap=overlap_chars,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

        def _split() -> List[str]:
            return splitter.split_text(text)

        loop = asyncio.get_event_loop()
        chunks = await loop.run_in_executor(None, _split)
        return chunks

    else:
        # Fallback: simple token-based splits using tiktoken
        encoding = tiktoken.get_encoding("cl100k_base")
        tokens = encoding.encode(text)
        total_tokens = len(tokens)
        chunks = []

        index = 0
        while index < total_tokens:
            end = min(index + max_tokens_per_chunk, total_tokens)
            chunk_tokens = tokens[index:end]
            chunk_text = encoding.decode(chunk_tokens)
            chunks.append(chunk_text)
            index = end

        return chunks


async def count_tokens(text: str, model: Optional[str] = None) -> int:
    """
    Count tokens in text for a specific model using tiktoken, with caching.

    Args:
        text (str): The text to count.
        model (str, optional): The model to base the encoding on.

    Returns:
        int: Estimated token count.
    """
    cache_key = f"{hash(text)}-{model}"
    if cache_key in _token_count_cache:
        return _token_count_cache[cache_key]

    try:
        # Default encoding name for GPT-3.5+ (cl100k_base)
        encoding_name = "cl100k_base"
        encoding = tiktoken.get_encoding(encoding_name)
        token_count = len(encoding.encode(text))
        _token_count_cache[cache_key] = token_count
        return token_count
    except Exception as e:
        logger.warning(f"Token counting error: {str(e)}")
        # Fallback estimate (4 chars/token)
        token_count = len(text) // 4
        _token_count_cache[cache_key] = token_count
        return token_count


# -----------------------------------------------------------------------------
# Optional embedding function (Azure-based)
# -----------------------------------------------------------------------------
async def embed_file(file_id: str, text: str, azure_client) -> Dict[str, Any]:
    """
    Create embeddings for a file so it can be used in semantic search.

    Args:
        file_id (str): ID of the file in your system.
        text (str): The text to embed.
        azure_client: Azure client that has an embeddings interface.

    Returns:
        Dict[str, Any]: Embedding metadata, or an error if something failed.
    """
    try:
        # Check if embeddings are supported
        if not hasattr(azure_client, "embeddings"):
            logger.warning("Embeddings not supported by client")
            return {"error": "Embeddings not supported by client"}

        response = await azure_client.embeddings.create(
            model="text-embedding-ada-002", input=text
        )
        embedding = response.data[0].embedding
        return {
            "file_id": file_id,
            "embedding_id": response.id,
            "embedding": embedding,
            "dimensions": len(embedding),
            "created_at": datetime.now().isoformat(),
        }
    except HttpResponseError as e:
        logger.exception(f"Azure API Error: {e.status_code} {e.message}")
        if e.status_code == 429:
            return {"error": "Too many requests - please try again later"}
        elif e.status_code == 413:
            return {"error": "File size exceeds 4MB limit"}
        return {"error": f"Azure service error: {e.message}"}


# -----------------------------------------------------------------------------
# Helper functions for MIME and binary checks
# -----------------------------------------------------------------------------
def get_mime_type(filename: str) -> str:
    """
    Get MIME type from filename or default to application/octet-stream.
    """
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"


def is_binary_content(content: bytes) -> bool:
    """
    Check heuristically if content is likely binary (non-text).
    """
    text_chars = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)) - {0x7F})
    sample = content[:4096]
    return bool(sample.translate(None, text_chars))
