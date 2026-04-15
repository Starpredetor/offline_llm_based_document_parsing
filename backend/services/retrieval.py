from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

import faiss
import numpy as np


class RetrievalService:
    def __init__(self, vector_dir: Path, embedding_dim: int = 384) -> None:
        self.vector_dir = vector_dir
        self.vector_dir.mkdir(parents=True, exist_ok=True)
 
        self.index_path = self.vector_dir / "index.faiss"
        self.meta_path = self.vector_dir / "metadata.json"
        self.embedding_dim = embedding_dim

        self.index = self._load_or_create_index()
        self.metadata = self._load_metadata()

    def _load_or_create_index(self) -> faiss.IndexFlatIP:
        if self.index_path.exists():
            return faiss.read_index(str(self.index_path))
        return faiss.IndexFlatIP(self.embedding_dim)

    def _load_metadata(self) -> List[Dict]:
        if self.meta_path.exists():
            return json.loads(self.meta_path.read_text(encoding="utf-8"))
        return []

    def _persist(self) -> None:
        faiss.write_index(self.index, str(self.index_path))
        self.meta_path.write_text(json.dumps(self.metadata, indent=2), encoding="utf-8")

    def add_chunks(self, vectors: np.ndarray, chunk_metadata: List[Dict]) -> None:
        if vectors.size == 0:
            return

        self.index.add(vectors)
        self.metadata.extend(chunk_metadata)
        self._persist()

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> List[Dict]:
        if self.index.ntotal == 0:
            return []

        query = np.expand_dims(query_vector, axis=0).astype(np.float32)
        scores, indices = self.index.search(query, top_k)

        results: List[Dict] = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue

            item = dict(self.metadata[idx])
            item["score"] = float(score)
            item["chunk_id"] = int(idx)
            results.append(item)

        return results
