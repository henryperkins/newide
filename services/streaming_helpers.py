def process_stream_chunk(chunk, full_content, is_o_series):
    """
    Process a single streaming chunk, updating the full content and handling vision or chain-of-thought logic.
    """
    if is_o_series and hasattr(chunk, "vision_metadata"):
        full_content += f"\n\n[Image Analysis]\n{chunk.vision_metadata}"

    if hasattr(chunk, "choices") and chunk.choices:
        for choice in chunk.choices:
            content = getattr(choice.delta, "content", "") or ""
            full_content += content

    return full_content
