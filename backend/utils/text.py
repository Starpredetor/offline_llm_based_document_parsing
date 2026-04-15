from __future__ import annotations

import re
from typing import List


def normalize_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    return cleaned


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> List[str]:
    if not text:
        return []

    step = max(1, chunk_size - overlap)
    chunks: List[str] = []

    for start in range(0, len(text), step):
        part = text[start : start + chunk_size].strip()
        if part:
            chunks.append(part)

    return chunks
