"""Повторяемый smoke-benchmark lexical/dense/hybrid retrieval."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Sequence

from .retrieval import (
    DenseRetriever,
    LexicalRetriever,
    RetrievableChunk,
    reciprocal_rank_fusion,
)


@dataclass(frozen=True)
class RetrievalQueryCase:
    query: str
    relevant_section_paths: frozenset[str]


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]


def _score(
    ranked: Sequence[RetrievableChunk], relevant: frozenset[str]
) -> tuple[float, float, int, int]:
    if not relevant:
        return 0.0, 0.0, 1, 0
    paths = [chunk.section_path for chunk in ranked]
    found = relevant & set(paths)
    first = next((i for i, path in enumerate(paths, start=1) if path in relevant), 0)
    leakage = sum(
        1
        for chunk in ranked
        if chunk.chunk_type == "solution" or chunk.solution_visibility == "restricted"
    )
    return len(found) / len(relevant), (1.0 / first if first else 0.0), int(not found), leakage


def run_retrieval_benchmark(
    *,
    cases: Sequence[RetrievalQueryCase],
    candidates: Sequence[RetrievableChunk],
    lexical: LexicalRetriever,
    dense: DenseRetriever,
    limit: int = 10,
) -> dict:
    """Считает Recall/MRR на одном candidate/access set для трёх вариантов.

    Production hybrid retrieval собирает расширенный пул из обеих веток и
    только затем обрезает RRF-выдачу. Benchmark обязан делать то же самое:
    запрос ровно ``limit`` кандидатов у каждой ветки занижает качество hybrid и
    сравнивает уже не тот алгоритм, который обслуживает endpoint.
    """

    accumulators = {
        name: {"recall": 0.0, "mrr": 0.0, "zero_hits": 0, "leakage": 0, "ms": []}
        for name in ("lexical", "dense", "hybrid")
    }
    pool = max(limit * 4, 20)
    for case in cases:
        started = time.perf_counter()
        lexical_pool = lexical.search(case.query, candidates, limit=pool)
        lexical_ms = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        dense_pool = dense.search(case.query, candidates, limit=pool)
        dense_ms = (time.perf_counter() - started) * 1000

        started = time.perf_counter()
        hybrid_hits = [
            row[0]
            for row in reciprocal_rank_fusion(lexical_pool, dense_pool)[:limit]
        ]
        hybrid_ms = lexical_ms + dense_ms + (time.perf_counter() - started) * 1000

        rankings = {
            "lexical": ([row[0] for row in lexical_pool[:limit]], lexical_ms),
            "dense": ([row[0] for row in dense_pool[:limit]], dense_ms),
            "hybrid": (hybrid_hits, hybrid_ms),
        }
        for name, (ranked, elapsed_ms) in rankings.items():
            recall, reciprocal_rank, zero_hit, leakage = _score(
                ranked, case.relevant_section_paths
            )
            acc = accumulators[name]
            acc["recall"] += recall
            acc["mrr"] += reciprocal_rank
            acc["zero_hits"] += zero_hit
            acc["leakage"] += leakage
            acc["ms"].append(elapsed_ms)

    count = len(cases)
    variants = {}
    for name, acc in accumulators.items():
        timings = acc.pop("ms")
        variants[name] = {
            "recall_at_k": round(acc["recall"] / count, 4) if count else 0.0,
            "mrr_at_k": round(acc["mrr"] / count, 4) if count else 0.0,
            "zero_hits": acc["zero_hits"],
            "solution_leakage": acc["leakage"],
            "p50_ms": round(sorted(timings)[len(timings) // 2], 2) if timings else 0.0,
            "p95_ms": round(_p95(timings), 2),
        }
    return {"queries": count, "limit": limit, "variants": variants}
