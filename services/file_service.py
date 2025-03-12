"""
Service for processing uploaded files, extracting text, counting tokens, and optionally chunking.
"""

from typing import List, Dict, Any, Optional
import os
import asyncio
import time
from io import BytesIO
from datetime import datetime
import tiktoken
import mimetypes
import config
from azure.core.exceptions import HttpResponseError

from services.tracing_utils import trace_function, trace_file_operation, trace_block
from logging_config import get_logger
import sentry_sdk

logger = get_logger(__name__)

# For file type handling - conditional imports to handle missing dependencies
try:
    import docx2txt
    DOCX_SUPPORTED = True
except ImportError as e:
    DOCX_SUPPORTED = False
    docx2txt = None
    logger.error(f"Critical dependency missing: {str(e)}")
    raise RuntimeError(f"Required package not installed: {e.name}") from e

try:
    import PyPDF2
    PDF_SUPPORTED = True
except ImportError as e:
    PDF_SUPPORTED = False
    PyPDF2 = None
    logger.error(f"Critical dependency missing: {str(e)}")
    raise RuntimeError(f"Required package not installed: {e.name}") from e

try:
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    LANGCHAIN_SUPPORTED = True
except ImportError:
    LANGCHAIN_SUPPORTED = False
    RecursiveCharacterTextSplitter = None
    logger.warning("langchain not installed - advanced text splitting unavailable")

# Constants
DEFAULT_CHUNK_SIZE = 4000   # Default tokens per chunk
MAX_TOKENS_PER_FILE = 200000  # Maximum tokens for o-series models
OVERLAP_SIZE = 200          # Token overlap between chunks

# Allowed file extensions for security
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

# Token count cache to improve performance
_token_count_cache = {}


@trace_function(op="file.process", name="process_uploaded_file")
async def process_uploaded_file(  # noqa: C901
    file_content: bytes,
    filename: str,
    model_name: str
) -> Dict[str, Any]:
    """
    Process an uploaded file based on its type.

    Args:
        file_content (bytes): Raw file content as bytes.
        filename (str): Name of the uploaded file.
        model_name (str): The model to use for token counting.

    Returns:
        Dict[str, Any]: Dictionary with processed file data, including text chunks,
        token counts, file metadata, etc.

    Raises:
        ValueError: If the file type is unsupported or the file is too large.
    """
    file_extension: Optional[str] = None
    mime_type: Optional[str] = None
    start_time = time.time()
    
    # Create a transaction for this file processing operation
    transaction = sentry_sdk.start_transaction(
        name=f"process_file_{os.path.splitext(filename)[1].lower()[1:]}",
        op="file.process"
    )
    
    sentry_sdk.set_tag("file.name", filename)
    sentry_sdk.set_tag("model.name", model_name)
    
    try:
        # Validate file extension and content
        file_extension = os.path.splitext(filename)[1].lower()
        if file_extension not in ALLOWED_EXTENSIONS:
            error_msg = f"Unsupported file type: {file_extension}"
        # Verify file content matches extension
        if not verify_file_signature(file_content, file_extension):
            error_msg = f"File content does not match extension: {file_extension}"
            logger.warning(error_msg, extra={"filename": filename, "file_type": file_extension})
            sentry_sdk.set_tag("error.type", "unsupported_file_type")
            raise ValueError(error_msg)

        # Check file size with configurable timeout
        file_size = len(file_content)
        max_size = config.settings.MAX_FILE_SIZE
        max_processing_time = min(max(30, file_size // (1024*1024)), 300)  # 30s-5min based on size
        if file_size > max_size:
            error_msg = (
                f"File too large: {file_size} bytes. Maximum allowed: {max_size} bytes"
            )
            logger.warning(
                error_msg,
                extra={"filename": filename, "file_size": file_size, "max_size": max_size}
            )
            sentry_sdk.set_tag("error.type", "file_too_large")
            raise ValueError(error_msg)

        # Set file metadata in transaction
        transaction.set_data("file.size", file_size)
        transaction.set_data("file.type", file_extension)
        
        # Determine file type and extract text
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        transaction.set_data("file.mime_type", mime_type)

        # Extract text based on file type
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
                # Fallback for unsupported types - try basic text extraction
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

        # Count tokens in the extracted text
        with trace_block("Token Counting", op="nlp.token_count", model=model_name) as span:
            token_count = await count_tokens(text_content, model_name)
            span.set_data("token_count", token_count)
            logger.info(
                f"File {filename} contains approximately {token_count} tokens",
                extra={"filename": filename, "token_count": token_count, "model": model_name}
            )
        
        # Set token count in transaction
        transaction.set_data("token_count", token_count)

        # Determine if chunking is needed
        is_o_series = (
            any(m in model_name.lower() for m in ["o1-", "o3-"])
            and "preview" not in model_name
        )
        max_tokens = MAX_TOKENS_PER_FILE if is_o_series else 4096
        transaction.set_data("max_tokens", max_tokens)

        # Initialize chunks list
        chunks = []

        # Perform chunking or truncation if needed
        with trace_block("Text Processing", op="text.process") as span:
            if token_count > max_tokens and not LANGCHAIN_SUPPORTED:
                logger.warning(
                    f"File {filename} exceeds token limit and langchain not available",
                    extra={"filename": filename, "token_count": token_count, "max_tokens": max_tokens}
                )
                # Truncate text (simple approach)
                with sentry_sdk.start_span(op="text.truncate", description="Text Truncation") as truncate_span:
                    encoding = tiktoken.get_encoding("cl100k_base")
                    tokens = encoding.encode(text_content)

                    # Leave room for truncation message
                    safe_token_limit = max_tokens - 100
                    truncated_tokens = tokens[:safe_token_limit]
                    text_content = (
                        encoding.decode(truncated_tokens)
                        + "\n[Content truncated to fit model context window]"
                    )

                    # Recalculate token count
                    token_count = await count_tokens(text_content, model_name)
                    chunks = [text_content]
                    truncate_span.set_data("process_type", "truncation")
                    truncate_span.set_data("original_tokens", len(tokens))
                    truncate_span.set_data("truncated_tokens", len(truncated_tokens))

            elif token_count > DEFAULT_CHUNK_SIZE:
                # Split into chunks for better context management
                with sentry_sdk.start_span(op="text.chunk", description="Text Chunking") as chunk_span:
                    chunks = await chunk_text(
                        text_content, DEFAULT_CHUNK_SIZE, model_name
                    )
                    chunk_span.set_data("process_type", "chunking")
                    chunk_span.set_data("chunk_count", len(chunks))
                    logger.info(
                        f"Split {filename} into {len(chunks)} chunks",
                        extra={"filename": filename, "chunk_count": len(chunks)}
                    )

            else:
                # File fits in one chunk
                chunks = [text_content]
                span.set_data("process_type", "single_chunk")
                span.set_data("chunk_count", 1)

        # Prepare response
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
        # Capture the exception for Sentry
        sentry_sdk.capture_exception(e)
        
        logger.exception(
            f"Error processing file {filename}: {e}",
            extra={"filename": filename, "error": str(e)}
        )
        
        # Set error information in transaction
        transaction.set_data("success", False)
        transaction.set_data("error.type", e.__class__.__name__)
        transaction.set_data("error.message", str(e))
        
        # Return error information
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
        # Finish the transaction
        transaction.finish()


@trace_file_operation("pdf_read")
async def extract_pdf_text(file_content: bytes) -> str:  # noqa: C901
    """
    Extract text from PDF file using PyPDF2.

    Args:
        file_content (bytes): Raw PDF file bytes.

    Returns:
        str: Extracted text from the PDF, page by page.
    """
    if not PDF_SUPPORTED:
        logger.warning("PDF extraction requested but PyPDF2 not installed")
        sentry_sdk.add_breadcrumb(
            category="file",
            message="PDF extraction not available - missing PyPDF2",
            level="warning"
        )
        return "[PDF extraction not available - install PyPDF2]"

    # Create a span for the PDF extraction process
    with sentry_sdk.start_span(op="file.extract_pdf", description="PDF Text Extraction") as span:
        start_time = time.time()
        span.set_data("file_size", len(file_content))
        
        def _extract() -> str:
            try:
                if not PyPDF2:
                    return "[PDF extraction not available - install PyPDF2]"
                pdf_file = BytesIO(file_content)
                reader = PyPDF2.PdfReader(pdf_file)
                text = []
                
                # Update span with PDF metadata
                try:
                    metadata = reader.metadata
                    if metadata:
                        span.set_data("pdf.title", metadata.get("/Title", ""))
                        span.set_data("pdf.author", metadata.get("/Author", ""))
                        span.set_data("pdf.creator", metadata.get("/Creator", ""))
                except Exception:
                    pass  # Ignore metadata extraction errors
                
                # Set page count in span
                page_count = len(reader.pages)
                span.set_data("pdf.page_count", page_count)
                
                # Track empty pages
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
        
        # Record final stats
        extract_span.set_data("duration_seconds", time.time() - start_time)
        extract_span.set_data("success", True)
        
        return extracted_text


@trace_file_operation("docx_read")
async def extract_docx_text(file_content: bytes) -> str:
    """
    Extract text from DOCX file using docx2txt.

    Args:
        file_content (bytes): Raw DOCX file bytes.

    Returns:
        str: Extracted text from the DOCX.
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
            try:
                if docx2txt is None:
                    return "[DOCX extraction not available - install docx2txt]"
                    
                docx_file = BytesIO(file_content)
                with sentry_sdk.start_span(op="file.process_docx", description="Process DOCX"):
                    try:
                        with tempfile.NamedTemporaryFile(delete=True) as temp_file:
                            temp_file.write(docx_file.read())
                            temp_file.flush()
                            text = docx2txt.process(temp_file.name)
                    except Exception as e:
                        logger.exception(f"DOCX processing error: {str(e)}")
                        sentry_sdk.capture_exception(e)
                        text = ""
                
                # Check for empty document
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
        
        # Record final stats
        span.set_data("duration_seconds", time.time() - start_time)
        span.set_data("success", True)
        
        sentry_sdk.add_breadcrumb(
            category="file",
            message=f"DOCX extraction completed in {time.time() - start_time:.2f}s",
            level="info",
            data={"text_length": len(extracted_text)}
        )
        
        return extracted_text


async def chunk_text(
    text: str,
    max_tokens_per_chunk: int = DEFAULT_CHUNK_SIZE,
    model_name: Optional[str] = None,
) -> List[str]:
    """
    Split text into chunks with intelligent boundaries.

    Args:
        text (str): The text content to split.
        max_tokens_per_chunk (int): Maximum tokens per chunk.
        model_name (str, optional): Model name for token counting.

    Returns:
        List[str]: A list of text chunks.
    """
    if not text:
        return [""]

    # If we have LangChain installed, do a more advanced split
    if LANGCHAIN_SUPPORTED and RecursiveCharacterTextSplitter is not None:
        # Calculate chars per token (approximate)
        total_tokens_in_text = await count_tokens(text, model_name)
        chars_per_token = len(text) / max(1, total_tokens_in_text)
        overlap_chars = int(OVERLAP_SIZE * chars_per_token)
        # If it's an o-series model, increase chunk size
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
        # Fallback to a simple token-based split if LangChain not available
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
    Count tokens in text for a specific model with caching.

    Args:
        text (str): Text to count tokens for.
        model (str, optional): Model name to use for counting.

    Returns:
        int: Number of tokens in the text.
    """
    cache_key = f"{hash(text)}-{model}"
    if cache_key in _token_count_cache:
        return _token_count_cache[cache_key]

    try:
        encoding_name = "cl100k_base"  # Default for most modern models
        encoding = tiktoken.get_encoding(encoding_name)
        token_count = len(encoding.encode(text))
        _token_count_cache[cache_key] = token_count
        return token_count

    except Exception as e:
        logger.warning(f"Token counting error: {str(e)}")
        # Fallback to a simple character-based estimate (~4 chars/token)
        token_count = len(text) // 4
        _token_count_cache[cache_key] = token_count
        return token_count


async def embed_file(file_id: str, text: str, azure_client):
    """
    Create embeddings for a file to enable semantic search.

    Args:
        file_id (str): ID of the file.
        text (str): Text to embed.
        azure_client: Azure OpenAI client.

    Returns:
        Dict[str, Any]: Dictionary with embedding information or an error key if failed.
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


def get_mime_type(filename: str) -> str:
    """
    Get MIME type from filename.

    Args:
        filename (str): Filename to check.

    Returns:
        str: MIME type string, or 'application/octet-stream' if unknown.
    """
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"


def is_binary_content(content: bytes) -> bool:
    """
    Check if content appears to be binary (non-text).

    Args:
        content (bytes): Bytes to check.

    Returns:
        bool: True if content appears to be binary, False otherwise.
    """
    text_chars = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)) - {0x7F})
    sample = content[:4096]
    return bool(sample.translate(None, text_chars))
