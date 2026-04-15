from __future__ import annotations

import json
from pathlib import Path
from threading import Thread
from typing import List

import torch


class LLMService:
    def __init__(self, model_path: str = "models/llm/TinyLlama-1.1B-Chat-v1.0") -> None:
        self.model_path = model_path
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32
        self._tokenizer = None
        self._model = None

    def _ensure_model_loaded(self) -> bool:
        if self._model is not None and self._tokenizer is not None:
            return True

        local_path = Path(self.model_path)
        if not local_path.exists():
            return False

        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self._tokenizer = AutoTokenizer.from_pretrained(str(local_path), local_files_only=True)
            if self._tokenizer.pad_token is None:
                self._tokenizer.pad_token = self._tokenizer.eos_token

            self._model = AutoModelForCausalLM.from_pretrained(
                str(local_path),
                local_files_only=True,
                low_cpu_mem_usage=True,
                torch_dtype=self.torch_dtype,
                device_map="auto" if self.device == "cuda" else None,
            )
            self._model.eval()
            return True
        except Exception:
            self._tokenizer = None
            self._model = None
            return False

    def _infer_query_type(self, query: str) -> str:
        lower_q = (query or "").lower()
        if any(token in lower_q for token in ["code", "python", "bug", "error", "api", "function"]):
            return "coding"
        if any(token in lower_q for token in ["compare", "analyze", "trade-off", "evaluate", "why"]):
            return "analytical"
        if any(token in lower_q for token in ["write", "story", "creative", "poem", "brainstorm"]):
            return "creative"
        if any(token in lower_q for token in ["hello", "hi", "thanks", "how are you"]):
            return "conversational"
        return "factual"

    def _resolve_output_mode(self, query: str, output_mode: str) -> str:
        if output_mode != "auto":
            return output_mode
        lower_q = (query or "").lower()
        if "json" in lower_q:
            return "json"
        if any(token in lower_q for token in ["table", "tabular"]):
            return "table"
        if any(token in lower_q for token in ["step", "steps", "how to"]):
            return "steps"
        if any(token in lower_q for token in ["code", "python", "script", "function"]):
            return "code"
        return "plain_text"

    def _response_format_block(self, output_mode: str) -> str:
        if output_mode == "json":
            return (
                "Respond with valid JSON only using this schema:\n"
                "{\n"
                '  "answer": "string",\n'
                '  "confidence": "high|medium|low",\n'
                '  "follow_up": "string"\n'
                "}\n"
                "Do not include markdown fences."
            )
        if output_mode == "code":
            return "Prefer concise explanation followed by executable code blocks."
        if output_mode == "steps":
            return "Return a numbered, step-by-step answer."
        if output_mode == "table":
            return "Return a markdown table where practical, then short notes below it."
        return "Return clear plain text with short sections when needed."

    def _build_prompt(self, query: str, contexts: List[str], query_type: str, output_mode: str) -> str:
        context_block = "\n\n".join(contexts[:8])
        style_rule = {
            "factual": "Focus on factual precision and explicit uncertainty handling.",
            "coding": "Be implementation-focused and include practical snippets when useful.",
            "conversational": "Keep the tone friendly but still grounded in provided context.",
            "analytical": "Compare alternatives, list trade-offs, and justify conclusions.",
            "creative": "Be creative but do not invent unsupported factual claims.",
        }.get(query_type, "Stay accurate, clear, and context-grounded.")
        return (
            "SYSTEM ROLE:\n"
            "You are a helpful, safe, and highly intelligent local assistant.\n\n"
            "BEHAVIOR RULES:\n"
            "- Be accurate and concise unless detail is requested.\n"
            "- Use only the provided context and say when evidence is insufficient.\n"
            "- Avoid fabricated facts.\n"
            f"- {style_rule}\n\n"
            "RESPONSE FORMAT:\n"
            f"{self._response_format_block(output_mode)}\n\n"
            "CONTEXT:\n"
            f"{context_block}\n\n"
            "USER INPUT:\n"
            f"{query}\n\n"
            "ASSISTANT RESPONSE:"
        )

    def _build_generate_kwargs(
        self,
        max_tokens: int,
        temperature: float,
        top_p: float,
        generation_top_k: int,
        frequency_penalty: float,
        presence_penalty: float,
    ) -> dict:
        repetition_penalty = 1.0 + min(0.6, (frequency_penalty * 0.12) + (presence_penalty * 0.08))
        do_sample = temperature > 0.05
        return {
            "max_new_tokens": max_tokens,
            "min_new_tokens": 0,
            "do_sample": do_sample,
            "temperature": max(0.01, temperature),
            "top_p": top_p,
            "top_k": generation_top_k,
            "repetition_penalty": repetition_penalty,
            "no_repeat_ngram_size": 3,
            "eos_token_id": self._tokenizer.eos_token_id,
            "pad_token_id": self._tokenizer.pad_token_id,
        }

    def generate_answer(
        self,
        query: str,
        contexts: List[str],
        temperature: float = 0.7,
        top_p: float = 0.9,
        generation_top_k: int = 40,
        max_tokens: int = 700,
        frequency_penalty: float = 0.2,
        presence_penalty: float = 0.15,
        query_type: str = "auto",
        output_mode: str = "auto",
    ) -> str:
        if not contexts:
            return "No indexed context was found. Upload documents first."

        if not self._ensure_model_loaded():
            preview = "\n\n".join(contexts[:2])
            return (
                "Local LLM is not loaded yet. Download a model into models/llm and retry.\n\n"
                f"Question: {query}\n\n"
                f"Context preview:\n{preview[:1200]}"
            )

        resolved_query_type = query_type if query_type != "auto" else self._infer_query_type(query)
        resolved_output_mode = self._resolve_output_mode(query=query, output_mode=output_mode)
        prompt = self._build_prompt(
            query=query,
            contexts=contexts,
            query_type=resolved_query_type,
            output_mode=resolved_output_mode,
        )
        inputs = self._tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)

        if self.device == "cuda":
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
        elif hasattr(self._model, "device"):
            inputs = {k: v.to(self._model.device) for k, v in inputs.items()}

        generate_kwargs = self._build_generate_kwargs(
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            generation_top_k=generation_top_k,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
        )

        with torch.inference_mode():
            if self.device == "cuda":
                with torch.autocast(device_type="cuda", dtype=self.torch_dtype):
                    output = self._model.generate(**inputs, **generate_kwargs)
            else:
                output = self._model.generate(**inputs, **generate_kwargs)

        decoded = self._tokenizer.decode(output[0], skip_special_tokens=True)
        if resolved_output_mode == "json":
            candidate = decoded.split("ASSISTANT RESPONSE:", 1)[-1].strip()
            try:
                parsed = json.loads(candidate)
                return json.dumps(parsed, indent=2)
            except Exception:
                pass
        if "Answer:" in decoded:
            return decoded.split("Answer:", 1)[-1].strip()
        if "ASSISTANT RESPONSE:" in decoded:
            return decoded.split("ASSISTANT RESPONSE:", 1)[-1].strip()
        return decoded.strip()

    def stream_answer_chunks(
        self,
        query: str,
        contexts: List[str],
        chunk_chars: int = 120,
        temperature: float = 0.7,
        top_p: float = 0.9,
        generation_top_k: int = 40,
        max_tokens: int = 700,
        frequency_penalty: float = 0.2,
        presence_penalty: float = 0.15,
        query_type: str = "auto",
        output_mode: str = "auto",
    ):
        if not contexts:
            yield "No indexed context was found. Upload documents first."
            return

        if not self._ensure_model_loaded():
            preview = "\n\n".join(contexts[:2])
            yield (
                "Local LLM is not loaded yet. Download a model into models/llm and retry.\n\n"
                f"Question: {query}\n\n"
                f"Context preview:\n{preview[:1200]}"
            )
            return

        from transformers import TextIteratorStreamer

        resolved_query_type = query_type if query_type != "auto" else self._infer_query_type(query)
        resolved_output_mode = self._resolve_output_mode(query=query, output_mode=output_mode)
        prompt = self._build_prompt(
            query=query,
            contexts=contexts,
            query_type=resolved_query_type,
            output_mode=resolved_output_mode,
        )
        inputs = self._tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)

        if self.device == "cuda":
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
        elif hasattr(self._model, "device"):
            inputs = {k: v.to(self._model.device) for k, v in inputs.items()}

        streamer = TextIteratorStreamer(
            self._tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
            timeout=120.0,
        )

        generate_kwargs = self._build_generate_kwargs(
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            generation_top_k=generation_top_k,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
        )
        generate_kwargs["streamer"] = streamer

        def _generate() -> None:
            with torch.inference_mode():
                if self.device == "cuda":
                    with torch.autocast(device_type="cuda", dtype=self.torch_dtype):
                        self._model.generate(**inputs, **generate_kwargs)
                else:
                    self._model.generate(**inputs, **generate_kwargs)

        Thread(target=_generate, daemon=True).start()

        buffer = ""
        for piece in streamer:
            buffer += piece
            if len(buffer) >= chunk_chars or "\n\n" in buffer:
                yield buffer
                buffer = ""

        if buffer:
            yield buffer
