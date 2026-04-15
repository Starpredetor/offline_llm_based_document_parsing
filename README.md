# Offline Multimodal RAG for Local Document Intelligence

Research-report style technical documentation for an offline, local-first multimodal Retrieval-Augmented Generation (RAG) pipeline.

## Abstract

This project implements a fully local multimodal RAG stack for document question answering across PDFs, DOCX files, and images. The system combines OCR, image captioning, sentence-level embeddings, FAISS similarity search, and local causal language model generation. It is designed for privacy-preserving inference (no remote model calls during runtime), practical latency, and reproducibility. The pipeline includes request-level controls for decoding behavior, retrieval depth, and output format, together with cache-aware metrics logging suitable for research-style evaluation.

## Problem Statement

Given a query q and a local corpus D (heterogeneous text and image-origin content), the goal is to produce an answer a that is:

1. Context-grounded in retrieved document chunks.
2. Computationally efficient for commodity hardware.
3. Operable fully offline after model download.

## System Contributions

1. Local multimodal ingestion pipeline with OCR and vision caption fallback.
2. Embedding-based dense retrieval using normalized vectors and inner-product FAISS search.
3. Controllable text generation interface (temperature, top-p, top-k, penalties, mode routing).
4. Streaming and non-streaming query APIs with response caching and workspace metrics.
5. Reproducible storage of chunks, metadata, and vector index artifacts.

## Architecture Overview

End-to-end flow:

1. Upload documents through API or Streamlit UI.
2. Extract text:
	 - PDF: direct text extraction; if empty page text then OCR on rendered page image.
	 - DOCX: paragraph extraction.
	 - Image: OCR + BLIP caption concatenation.
3. Normalize and chunk text with overlap.
4. Encode chunks into dense vectors.
5. Add vectors to FAISS IndexFlatIP and persist metadata.
6. On query, embed query, retrieve top-k chunks, build instruction/context prompt, generate answer.
7. Return answer with source chunks (synchronous or streaming).

## Mathematical Formulation

### 1) Chunking

Let input text length be L characters, chunk size C, overlap O, and step S = C - O.

Chunk start positions:

$$
i_n = nS, \quad n = 0,1,2,\dots
$$

Chunk n:

$$
x_n = T[i_n : i_n + C]
$$

Approximate number of chunks:

$$
N \approx \left\lceil \frac{L}{S} \right\rceil
$$

Current defaults:

- C = 800
- O = 120
- S = 680

### 2) Embedding and Similarity

Each chunk x is mapped to a dense vector e(x) in R^384.

Vectors are normalized by the embedding model:

$$
\hat{e}(x) = \frac{e(x)}{\|e(x)\|_2}
$$

For normalized vectors, inner product equals cosine similarity:

$$
\text{sim}(q, x) = \hat{e}(q)^\top \hat{e}(x) = \cos(\theta)
$$

Top-k retrieval:

$$
R_k(q) = \operatorname*{arg\,topk}_{x \in D} \text{sim}(q, x)
$$

Implementation uses FAISS IndexFlatIP, which performs exact maximum inner-product search.

### 3) Fallback Embedding (Model Missing)

If embedding model is unavailable, a deterministic MD5-seeded Gaussian vector is generated and normalized:

$$
v \sim \mathcal{N}(0, I_{384}), \quad \hat{v} = \frac{v}{\|v\|_2}
$$

This preserves shape and deterministic behavior but does not preserve semantic geometry; it is useful only for continuity testing.

### 4) Generation Controls

The decoding configuration includes temperature T, nucleus threshold p, token top-k, and repetition penalties.

Effective repetition penalty in code:

$$
r = 1 + \min\left(0.6, 0.12f + 0.08p_r\right)
$$

where:

- f = frequency_penalty
- p_r = presence_penalty

Sampling is disabled for very low temperature:

$$
\text{do_sample} = (T > 0.05)
$$

### 5) Operational Metrics

Workspace metrics are aggregated as:

$$
\text{avg_latency_ms} = \frac{\sum_i \text{latency}_i}{Q}
$$

$$
\text{cache_hit_rate}(\%) = 100 \cdot \frac{H}{Q}
$$

where Q is total queries and H is cache-hit queries.

## Model and Runtime Configuration

Default local model directories:

- Embedding model: models/embeddings/all-MiniLM-L6-v2
- LLM model: models/llm/TinyLlama-1.1B-Chat-v1.0
- Vision caption model: models/vision/blip-image-captioning-base

Device policy:

- CUDA available: GPU path with float16 for embedding/vision/LLM where configured.
- Otherwise: CPU path with float32.

Startup warmup:

- Environment variable WARMUP_MODELS_ON_STARTUP=1 triggers asynchronous model preloading.

## Hyperparameters and Controls

### Query API Parameters

The QueryRequest schema supports the following fields:

| Parameter | Type | Default | Range / Choices | Purpose |
|---|---|---:|---|---|
| query | string | required | min length 3 | User question |
| project_id | string | default | 1-64 chars | Workspace partition key |
| top_k | int | 5 | [1, 20] | Retrieved chunk count |
| temperature | float | 0.7 | [0.0, 1.5] | Sampling randomness |
| top_p | float | 0.9 | [0.1, 1.0] | Nucleus sampling threshold |
| generation_top_k | int | 40 | [1, 200] | Candidate token cap |
| max_tokens | int | 700 | [64, 2048] | Max generated new tokens |
| frequency_penalty | float | 0.2 | [0.0, 2.0] | Repetition control (frequency) |
| presence_penalty | float | 0.15 | [0.0, 2.0] | Repetition control (presence) |
| query_type | enum | auto | auto, factual, coding, conversational, analytical, creative | Prompt style routing |
| output_mode | enum | auto | auto, plain_text, json, code, steps, table | Output formatting policy |
| stream_chunk_chars | int | 120 | [60, 400] | Streaming chunk size |

### Ingestion Parameters

| Stage | Parameter | Default |
|---|---|---:|
| Text chunking | chunk_size | 800 chars |
| Text chunking | overlap | 120 chars |
| PDF OCR render | dpi | 180 |
| Vision caption | max_new_tokens | 64 |
| Vision caption | num_beams | 2 |
| Vision caption | length_penalty | 1.05 |
| Embedding service | batch_size (GPU) | 128 |
| Embedding service | batch_size (CPU) | 32 |

### Cache Parameters

| Cache | Size | Key |
|---|---:|---|
| Query embedding LRU | 256 entries | normalized query text |
| Query answer LRU | 200 entries | query + project + retrieval/generation params + index size |

## Data and Artifact Layout

- data/raw_docs: uploaded raw files.
- data/processed/chunks: JSONL chunk artifacts.
- data/processed/metadata: per-file metadata JSON.
- data/vector_store/index.faiss: dense index.
- data/vector_store/metadata.json: chunk metadata aligned to index rows.
- data/workspace_state.json: projects, chats, and aggregate metrics.

Important runtime behavior:

- Storage is reset on backend startup by design (fresh session semantics).

## API Surface

- POST /upload: batch file ingestion and indexing.
- POST /query: synchronous retrieval + generation.
- POST /query/start: begin streaming generation job.
- GET /query/next/{job_id}: fetch next streamed chunks.
- GET /workspace/dashboard: workspace metrics + projects + recent chats.
- GET /workspace/metrics: aggregate metrics.
- GET /: health check.

## Accuracy and Evaluation for Research Reporting

This repository currently logs operational metrics (latency, cache behavior, query counts) but does not ship a benchmark dataset with ground-truth QA labels. For research-paper style reporting, use the protocol below.

### Recommended Evaluation Dimensions

1. Retrieval quality.
2. Answer faithfulness to retrieved context.
3. Answer correctness versus reference answers.
4. Runtime efficiency (latency, throughput, memory, VRAM).

### Core Retrieval Metrics

For each query with relevant set G and retrieved ranked list R_k:

$$
\text{Recall@k} = \frac{|G \cap R_k|}{|G|}
$$

$$
\text{Precision@k} = \frac{|G \cap R_k|}{k}
$$

$$
\text{MRR} = \frac{1}{|Q|}\sum_{q \in Q}\frac{1}{\operatorname{rank}_q}
$$

where rank_q is the rank position of the first relevant chunk.

### Core Generation Metrics

Given prediction y and reference y*:

- Exact Match (EM):

$$
\text{EM} = \mathbb{1}[\text{normalize}(y) = \text{normalize}(y^*)]
$$

- Token-level F1 (for extractive QA style):

$$
\text{F1} = \frac{2PR}{P + R}
$$

with P and R computed on token overlap.

- Optional semantic metrics:
	- BERTScore
	- BLEURT
	- LLM-as-judge rubric scores (with strict prompt protocol)

### Faithfulness / Groundedness

Use a citation-supported score:

$$
\text{Groundedness} = \frac{\#\text{claims supported by retrieved evidence}}{\#\text{total claims}}
$$

This is especially important for multimodal OCR noise and dense retrieval drift.

### Runtime Metrics

Report at minimum:

1. P50, P95 query latency (ms).
2. Tokens generated per second.
3. Retrieval time vs generation time breakdown.
4. Peak RAM and VRAM usage.
5. Cache hit rate (%).

## Suggested Experiment Matrix

Run ablations over:

1. top_k in {3, 5, 8, 12}
2. chunk_size in {400, 800, 1200}
3. overlap in {80, 120, 200}
4. temperature in {0.2, 0.7, 1.0}
5. with/without OCR fallback
6. with/without vision captions for images

Track quality-performance trade-offs to justify final deployment settings.

## Reproducibility Checklist

1. Fix software environment (requirements.txt and Python version).
2. Use identical local model revisions in models directory.
3. Pin random seeds where evaluation scripts add stochasticity.
4. Record hardware profile (CPU, RAM, GPU, CUDA version).
5. Store query sets, gold labels, and metric scripts in version control.
6. Report confidence intervals for main metrics when possible.

## Installation and Execution

### 1) Create virtual environment

PowerShell:

python -m venv .venv
.\.venv\Scripts\Activate.ps1

### 2) Install dependencies

pip install -r requirements.txt

### 3) Download local models

python scripts/download_models.py

### 4) Install OCR engine (Windows)

Install Tesseract and ensure tesseract.exe is discoverable by PATH.

Optional:

$env:TESSDATA_PREFIX = "C:\Program Files\Tesseract-OCR\tessdata"

### 5) Launch backend

uvicorn backend.main:app --reload --port 8000

### 6) Launch frontend

streamlit run frontend/app.py --server.port 8501

Or run combined startup helper:

run_project.bat

## Limitations

1. No built-in benchmark harness in current repository.
2. Retrieval uses exact dense search without reranking.
3. Storage reset at startup may not match persistent production settings.
4. Hash fallback embeddings are non-semantic and only for graceful degradation.

## Future Work

1. Add reranker (cross-encoder) for post-retrieval precision gains.
2. Add persistent ingestion mode toggle (no startup reset).
3. Add standardized QA benchmark suite and reporting scripts.
4. Add multimodal reasoning model (for richer image-grounded QA).

## Citation Template (Project Report)

Use this project as:

Offline Multimodal RAG for Local Document Intelligence, internal implementation report, 2026.


