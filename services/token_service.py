import tiktoken

class TokenService:
    @staticmethod
    def count_tokens(text: str, model: str = "generic") -> int:
        """
        Unified token counting approach.
        In production, integrate official tokenizers per model.
        """
        # Example fallback with tiktoken if needed:
        try:
            if "o1" in model.lower():
                # treat as cl100k_base or custom
                enc = tiktoken.get_encoding("cl100k_base")
                return len(enc.encode(text))
            elif "deepseek" in model.lower():
                # same approach or a different encoder
                enc = tiktoken.get_encoding("cl100k_base")
                return len(enc.encode(text))
            else:
                enc = tiktoken.get_encoding("cl100k_base")
                return len(enc.encode(text))
        except Exception:
            # fallback approximate
            return len(text.split())
