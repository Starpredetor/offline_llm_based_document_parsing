from __future__ import annotations

import os
from multiprocessing import cpu_count


def configure_runtime() -> None:
    """Tune CPU and GPU settings for maximum local inference throughput."""
    cores = max(1, cpu_count() or 1)

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "true")
    os.environ.setdefault("OMP_NUM_THREADS", str(cores))
    os.environ.setdefault("MKL_NUM_THREADS", str(cores))
    os.environ.setdefault("OPENBLAS_NUM_THREADS", str(cores))
    os.environ.setdefault("NUMEXPR_NUM_THREADS", str(cores))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    try:
        import torch

        torch.set_num_threads(cores)
        torch.set_num_interop_threads(max(1, min(4, cores)))

        if torch.cuda.is_available():
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
            if hasattr(torch, "set_float32_matmul_precision"):
                torch.set_float32_matmul_precision("high")
    except Exception:
        # Runtime tuning should never block app startup.
        pass
