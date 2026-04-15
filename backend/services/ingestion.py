from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import fitz
from docx import Document
from PIL import Image
import pytesseract

from backend.services.vision import VisionService
from backend.utils.text import chunk_text, normalize_text


class IngestionService:
    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".bmp"}

    def __init__(self, vision_service: VisionService) -> None:
        self.vision_service = vision_service

    def ingest_file(self, file_path: Path) -> Tuple[List[str], List[Dict]]:
        suffix = file_path.suffix.lower()
        if suffix not in self.SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {suffix}")

        if suffix == ".pdf":
            text, pages = self._extract_pdf(file_path)
            base_meta = [{"source_file": file_path.name, "page": page} for page in pages]
        elif suffix == ".docx":
            text = self._extract_docx(file_path)
            base_meta = [{"source_file": file_path.name, "page": None}]
        else:
            text = self._extract_image_text_and_caption(file_path)
            base_meta = [{"source_file": file_path.name, "page": None}]

        normalized = normalize_text(text)
        chunks = chunk_text(normalized)

        metadata: List[Dict] = []
        for idx, chunk in enumerate(chunks):
            meta = dict(base_meta[min(idx, len(base_meta) - 1)])
            meta["text"] = chunk
            metadata.append(meta)

        return chunks, metadata

    def _extract_pdf(self, file_path: Path) -> Tuple[str, List[int]]:
        all_text: List[str] = []
        page_ids: List[int] = []

        with fitz.open(file_path) as doc:
            for page_num, page in enumerate(doc, start=1):
                text = page.get_text("text").strip()
                if not text:
                    pix = page.get_pixmap(dpi=180)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    try:
                        text = pytesseract.image_to_string(img).strip()
                    except Exception:
                        text = ""

                if text:
                    all_text.append(text)
                    page_ids.append(page_num)

        return "\n".join(all_text), page_ids or [1]

    def _extract_docx(self, file_path: Path) -> str:
        doc = Document(file_path)
        lines = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(lines)

    def _extract_image_text_and_caption(self, file_path: Path) -> str:
        with Image.open(file_path) as image:
            try:
                ocr_text = pytesseract.image_to_string(image).strip()
            except Exception:
                ocr_text = ""
        caption = self.vision_service.caption_image(file_path)
        return f"{caption}\n\nOCR text:\n{ocr_text}"
