from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SourceChunk(BaseModel):
    chunk_id: int
    score: float
    text: str
    source_file: str
    page: Optional[int] = None


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=3)
    project_id: str = Field(default="default", min_length=1, max_length=64)
    top_k: int = Field(default=5, ge=1, le=20)
    temperature: float = Field(default=0.7, ge=0.0, le=1.5)
    top_p: float = Field(default=0.9, ge=0.1, le=1.0)
    generation_top_k: int = Field(default=40, ge=1, le=200)
    max_tokens: int = Field(default=700, ge=64, le=2048)
    frequency_penalty: float = Field(default=0.2, ge=0.0, le=2.0)
    presence_penalty: float = Field(default=0.15, ge=0.0, le=2.0)
    query_type: Literal[
        "auto",
        "factual",
        "coding",
        "conversational",
        "analytical",
        "creative",
    ] = "auto"
    output_mode: Literal["auto", "plain_text", "json", "code", "steps", "table"] = "auto"
    stream_chunk_chars: int = Field(default=120, ge=60, le=400)


class QueryResponse(BaseModel):
    answer: str
    sources: List[SourceChunk]


class QueryStartResponse(BaseModel):
    job_id: str
    status: str


class QueryChunkResponse(BaseModel):
    job_id: str
    delta: str
    done: bool
    sources: List[SourceChunk] = []
    error: Optional[str] = None


class UploadResponse(BaseModel):
    filename: str
    chunks_added: int
    message: str


class UploadItemResult(BaseModel):
    filename: str
    chunks_added: int = 0
    status: str
    message: str


class UploadBatchResponse(BaseModel):
    total_files: int
    succeeded: int
    failed: int
    items: List[UploadItemResult]
