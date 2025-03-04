def process_stream_chunk(chunk, full_content, is_deepseek):
    """
    Process a single streaming chunk, updating the full content and handling DeepSeek-specific logic.
    """
    if hasattr(chunk, "choices") and chunk.choices:
        for choice in chunk.choices:
            content = getattr(choice.delta, "content", "") or ""
            full_content += content
    return full_content
