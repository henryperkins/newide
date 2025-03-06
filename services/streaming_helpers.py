def process_stream_chunk(chunk, full_content, is_deepseek):
    """
    Process a single streaming chunk, updating the full content and handling DeepSeek-specific logic.
    Handles thinking blocks and HTML formatting.
    """
    if hasattr(chunk, "choices") and chunk.choices:
        for choice in chunk.choices:
            content = getattr(choice.delta, "content", "") or ""
            
            if is_deepseek:
                # Handle thinking blocks by removing markers
                content = content.replace('', '')
                
                # Basic HTML sanitization
                content = content.replace('<', '&lt;').replace('>', '&gt;')
                
            full_content += content
            
    return full_content
