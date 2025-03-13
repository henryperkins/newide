def calculate_vision_tokens(detail_level: str, width: int, height: int) -> int:
    """Calculate token cost for images based on Azure's vision token formula"""
    base_tokens = 85
    if detail_level == "low":
        return base_tokens
    
    # High detail calculation
    scaled_width = min(width, 2048)
    scaled_height = min(height, 2048)
    tile_width = scaled_width // 512
    tile_height = scaled_height // 512
    return base_tokens + 170 * (tile_width * tile_height)

import aiohttp

async def get_remote_image_size(url: str) -> int:
    """Get content length from remote URL"""
    async with aiohttp.ClientSession() as session:
        async with session.head(url) as response:
            return int(response.headers.get("Content-Length", 0))
