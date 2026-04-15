from __future__ import annotations

from pathlib import Path

from PIL import Image
import torch


class VisionService:
    def __init__(self, model_path: str = "models/vision/blip-image-captioning-base") -> None:
        self.model_path = model_path
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32
        self._processor = None
        self._model = None

    def _ensure_model_loaded(self) -> bool:
        if self._processor is not None and self._model is not None:
            return True

        local_path = Path(self.model_path)
        if not local_path.exists():
            return False

        try:
            from transformers import BlipForConditionalGeneration, BlipProcessor

            self._processor = BlipProcessor.from_pretrained(str(local_path), local_files_only=True)
            self._model = BlipForConditionalGeneration.from_pretrained(
                str(local_path),
                local_files_only=True,
                torch_dtype=self.torch_dtype,
            )
            self._model.to(self.device)
            self._model.eval()
            return True
        except Exception:
            self._processor = None
            self._model = None
            return False

    def caption_image(self, image_path: Path) -> str:
        if not self._ensure_model_loaded():
            return f"Image content from {image_path.name} (local caption model unavailable)."

        image = Image.open(image_path).convert("RGB")
        inputs = self._processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with torch.inference_mode():
            if self.device == "cuda":
                with torch.autocast(device_type="cuda", dtype=self.torch_dtype):
                    output = self._model.generate(
                        **inputs,
                        max_new_tokens=64,
                        num_beams=2,
                        length_penalty=1.05,
                    )
            else:
                output = self._model.generate(
                    **inputs,
                    max_new_tokens=64,
                    num_beams=2,
                    length_penalty=1.05,
                )

        text = self._processor.decode(output[0], skip_special_tokens=True).strip()
        return text or f"Image content from {image_path.name}."
