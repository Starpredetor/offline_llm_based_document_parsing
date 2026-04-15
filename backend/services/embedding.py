from __future__ import annotations

import hashlib
from collections import OrderedDict
from pathlib import Path
from typing import List

import numpy as np
import torch


class EmbeddingService:
    def __init__(self, model_name: str = "models/embeddings/all-MiniLM-L6-v2") -> None:
        self.model_name = model_name
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.batch_size = 128 if self.device == "cuda" else 32
        self._model = None
        self._query_cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._query_cache_max = 256

    def _load_model(self) -> None:
        if self._model is not None:
            return

        try:
            from sentence_transformers import SentenceTransformer

            model_ref = self.model_name
            local_path = Path(model_ref)

            if local_path.exists():
                self._model = SentenceTransformer(str(local_path), local_files_only=True, device=self.device)
                if self.device == "cuda":
                    self._model.half()
            else:
                # Runtime should remain offline; fallback embedding is used if model is missing.
                self._model = None
        except Exception:
            self._model = None

    def _hash_fallback(self, text: str, dim: int = 384) -> np.ndarray:
        seed = int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        vector = rng.standard_normal(dim).astype(np.float32)
        norm = np.linalg.norm(vector)
        return vector / norm if norm > 0 else vector

    def embed_documents(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 384), dtype=np.float32)

        self._load_model()

        if self._model is None:
            return np.vstack([self._hash_fallback(t) for t in texts]).astype(np.float32)

        vectors = self._model.encode(
            texts,
            normalize_embeddings=True,
            batch_size=self.batch_size,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        key = (text or "").strip()
        if key in self._query_cache:
            self._query_cache.move_to_end(key)
            return self._query_cache[key]

        vector = self.embed_documents([key])[0]
        self._query_cache[key] = vector
        if len(self._query_cache) > self._query_cache_max:
            self._query_cache.popitem(last=False)
        return vector
