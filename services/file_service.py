# services/file_service.py
from typing import List, Dict, Any, Optional
import os
import asyncio
import logging
import json
from io import BytesIO
from datetime import datetime
import tiktoken
import base64
import mimetypes
import config
from azure.core.exceptions import HttpResponseError

# Import error handling
from errors import create_error_response

# Setup logging
logger = logging.getLogger(__name__)

# For file type handling - conditional imports to handle missing dependencies
try:
    import docx2txt

    DOCX_SUPPORTED = True
except ImportError:
    DOCX_SUPPORTED = False
    logger.warning("docx2txt not installed - DOCX files won't be fully supported")

try:
    import PyPDF2

    PDF_SUPPORTED = True
except ImportError:
    PDF_SUPPORTED = False
    logger.warning("PyPDF2 not installed - PDF files won't be fully supported")

try:
    from langchain.text_splitter import RecursiveCharacterTextSplitter

    LANGCHAIN_SUPPORTED = True
except ImportError:
    LANGCHAIN_SUPPORTED = False
    logger.warning("langchain not installed - advanced text splitting unavailable")

# Constants
DEFAULT_CHUNK_SIZE = 4000  # Default tokens per chunk
MAX_TOKENS_PER_FILE = 200000  # Maximum tokens for o-series models
OVERLAP_SIZE = 200  # Token overlap between chunks

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


async def process_uploaded_file(
    file_content: bytes, filename: str, model_name: str
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
    # Validate file extension
    file_extension = os.path.splitext(filename)[1].lower()
    if file_extension not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {file_extension}")

    # Check file size
    max_size = config.settings.MAX_FILE_SIZE
    if len(file_content) > max_size:
        raise ValueError(
            f"File too large: {len(file_content)} bytes. Maximum allowed: {max_size} bytes"
        )

    # Determine file type and extract text
    file_size = len(file_content)
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    try:
        # Extract text based on file type
        if file_extension in [".txt", ".md", ".json", ".js", ".py", ".html", ".css"]:
            text_content = file_content.decode("utf-8", errors="replace")
        elif file_extension == ".pdf" and PDF_SUPPORTED:
            text_content = await extract_pdf_text(file_content)
        elif file_extension in [".docx", ".doc"] and DOCX_SUPPORTED:
            text_content = await extract_docx_text(file_content)
        else:
            # Fallback for unsupported types - try basic text extraction
            try:
                text_content = file_content.decode("utf-8", errors="replace")
            except UnicodeDecodeError:
                raise ValueError(f"Unsupported or binary file type: {file_extension}")

        # Count tokens in the extracted text
        token_count = await count_tokens(text_content, model_name)
        logger.info(f"File {filename} contains approximately {token_count} tokens")

        # Determine if chunking is needed
        is_o_series = (
            any(m in model_name.lower() for m in ["o1-", "o3-"])
            and "preview" not in model_name
        )
        max_tokens = MAX_TOKENS_PER_FILE if is_o_series else 4096

        # Initialize chunks list
        chunks = []

        # Truncate if too large and no chunking capability
        if token_count > max_tokens and not LANGCHAIN_SUPPORTED:
            logger.warning(
                f"File {filename} exceeds token limit and langchain not available"
            )
            # Truncate text (simple approach)
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

        elif token_count > DEFAULT_CHUNK_SIZE:
            # Split into chunks for better context management
            chunks = await chunk_text(text_content, DEFAULT_CHUNK_SIZE, model_name)
            logger.info(f"Split {filename} into {len(chunks)} chunks")

        else:
            # File fits in one chunk
            chunks = [text_content]

        # Prepare response
        return {
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
            },
        }

    except Exception as e:
        logger.exception(f"Error processing file {filename}: {e}")
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
                "size": file_size,
                "error": str(e),
                "processed_time": datetime.now().isoformat(),
            },
        }


async def extract_pdf_text(file_content: bytes) -> str:
    """
    Extract text from PDF file using PyPDF2.

    Args:
        file_content (bytes): Raw PDF file bytes.

    Returns:
        str: Extracted text from the PDF, page by page.
    """
    if not PDF_SUPPORTED:
        return "[PDF extraction not available - install PyPDF2]"

    def _extract() -> str:
        try:
            pdf_file = BytesIO(file_content)
            reader = PyPDF2.PdfReader(pdf_file)
            text = []

            # Extract text from each page with page numbers
            for i, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                if page_text.strip():  # Only add non-empty pages
                    text.append(f"--- Page {i+1} ---\n{page_text}")
            return "\n\n".join(text)

        except Exception as e:
            logger.exception(f"PDF extraction error: {e}")
            return f"[PDF extraction error: {e}]"

    loop = asyncio.get_event_loop()
    extracted_text = await loop.run_in_executor(None, _extract)
    return extracted_text


async def extract_docx_text(file_content: bytes) -> str:
    """
    Extract text from DOCX file using docx2txt.

    Args:
        file_content (bytes): Raw DOCX file bytes.

    Returns:
        str: Extracted text from the DOCX.
    """
    if not DOCX_SUPPORTED:
        return "[DOCX extraction not available - install docx2txt]"

    def _extract() -> str:
        try:
            docx_file = BytesIO(file_content)
            text = docx2txt.process(docx_file)
            return text or "[Empty document or extraction failed]"
        except Exception as e:
            logger.exception(f"DOCX extraction error: {e}")
            return f"[DOCX extraction error: {e}]"

    loop = asyncio.get_event_loop()
    extracted_text = await loop.run_in_executor(None, _extract)
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
    is_o_series = model_name and any(m in model_name.lower() for m in ["o1-", "o3-"])

    if is_o_series:
        # Use larger chunks with semantic boundaries for o-series
        max_tokens_per_chunk = 8000
        chunk_separators = ["\n\n## ", "\n\n", "\n", ". "]
    else:
        # Use smaller chunks with syntax boundaries for other models
        chunk_separators = ["\n\n", "\n", "; ", "} ", "{ ", "// "]

    if not text:
        return [""]

    # Use LangChain for better splitting if available
    if LANGCHAIN_SUPPORTED:
        # Calculate chars per token (approximate)
        chars_per_token = len(text) / max(1, await count_tokens(text, model_name))
        chars_per_chunk = int(max_tokens_per_chunk * chars_per_token)
        overlap_chars = int(OVERLAP_SIZE * chars_per_token)

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
        # Fallback to simple splitting if LangChain not available
        encoding = tiktoken.get_encoding("cl100k_base")
        tokens = encoding.encode(text)
        total_tokens = len(tokens)
        chunks = []

        for i in range(0, total_tokens, max_tokens_per_chunk):
            end = min(i + max_tokens_per_chunk, total_tokens)
            chunk_tokens = tokens[i:end]
            chunk_text = encoding.decode(chunk_tokens)
            chunks.append(chunk_text)

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
        # Check if we're using an o-series model
        is_o_series = model and any(m in model.lower() for m in ["o1-", "o3-"])
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
