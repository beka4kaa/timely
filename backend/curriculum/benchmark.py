"""Harness для честного сравнения моделей-планировщиков на одной книге.

Что здесь важнее самой метрики — это условия сравнения:

* один и тот же вход для всех кандидатов, доказанный совпадением `input_hash`;
* РОВНО один основной запрос на модель (никаких self-consistency и swarm для
  одного кандидата, если остальные получают один вызов — иначе сравнение
  бессмысленно);
* потолок стоимости, проверяемый ДО первого платного запроса;
* победитель не выбирается автоматически по LLM-судье.

Реальный прогон выключен по умолчанию и требует ОДНОВРЕМЕННО четырёх условий
(см. `guard_real_run`). Отсутствие любого — тест пропускается, а не падает.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field

from .model_registry import evaluation_candidates
from .planning.contracts import CoursePlanningRequest, CoursePlanningResult
from .planning.validation import ValidationReport, validate_plan
from .retrieval import RetrievalBundle

# Грубые верхние оценки, только для расчёта потолка ДО запуска. Реальная
# стоимость берётся из `AIUsageEvent` после прогона: эти числа существуют
# исключительно чтобы не отправить запрос, который окажется дороже бюджета.
FALLBACK_PRICE_PER_1K_INPUT_USD = 0.003
FALLBACK_PRICE_PER_1K_OUTPUT_USD = 0.015


class BenchmarkDisabled(RuntimeError):
    """Условия для платного прогона не выполнены."""


class BenchmarkBudgetExceeded(RuntimeError):
    """Оценка стоимости выше разрешённого потолка."""


@dataclass
class GuardStatus:
    enabled: bool
    reasons: list[str] = field(default_factory=list)
    max_total_usd: float = 0.0
    book_id: str = ""
    candidates: list[str] = field(default_factory=list)


def guard_real_run() -> GuardStatus:
    """Проверяет все условия платного прогона, ничего не запуская.

    Возвращает статус, а не бросает исключение: вызывающий тест обязан уметь
    вежливо пропуститься и напечатать, чего именно не хватает.
    """
    reasons: list[str] = []

    if os.getenv("RUN_REAL_COURSE_MODEL_EVAL", "") != "1":
        reasons.append("RUN_REAL_COURSE_MODEL_EVAL != 1")

    raw_budget = (os.getenv("COURSE_EVAL_MAX_TOTAL_USD", "") or "").strip()
    budget = 0.0
    if not raw_budget:
        reasons.append("COURSE_EVAL_MAX_TOTAL_USD не задан")
    else:
        try:
            budget = float(raw_budget)
            if budget <= 0:
                reasons.append("COURSE_EVAL_MAX_TOTAL_USD должен быть больше нуля")
        except ValueError:
            reasons.append("COURSE_EVAL_MAX_TOTAL_USD не число")

    if not (os.getenv("OPENROUTER_API_KEY", "") or os.getenv("TEXT_LLM_API_KEY", "")):
        reasons.append("OPENROUTER_API_KEY не настроен")

    book_id = (os.getenv("COURSE_EVAL_BOOK_ID", "") or "").strip()
    if not book_id:
        reasons.append("COURSE_EVAL_BOOK_ID не указан")

    candidates = evaluation_candidates()
    if not candidates:
        reasons.append("COURSE_EVAL_MODELS пуст")

    return GuardStatus(
        enabled=not reasons,
        reasons=reasons,
        max_total_usd=budget,
        book_id=book_id,
        candidates=candidates,
    )


@dataclass
class CostEstimate:
    model: str
    input_tokens: int
    output_tokens: int
    usd: float


def estimate_cost(
    request: CoursePlanningRequest,
    *,
    candidates: list[str],
    expected_output_tokens: int = 4000,
) -> tuple[list[CostEstimate], float]:
    """Верхняя оценка стоимости прогона до первого запроса."""
    from .chunking import estimate_tokens

    payload = json.dumps(asdict(request), ensure_ascii=False)
    input_tokens = estimate_tokens(payload)

    rows = [
        CostEstimate(
            model=model,
            input_tokens=input_tokens,
            output_tokens=expected_output_tokens,
            usd=(
                input_tokens / 1000 * FALLBACK_PRICE_PER_1K_INPUT_USD
                + expected_output_tokens / 1000 * FALLBACK_PRICE_PER_1K_OUTPUT_USD
            ),
        )
        for model in candidates
    ]
    return rows, round(sum(r.usd for r in rows), 4)


@dataclass
class CandidateResult:
    """Итог одного кандидата. `calls` обязан быть равен 1."""

    model: str
    succeeded: bool
    calls: int = 0
    latency_ms: int = 0
    error: str = ""
    input_hash: str = ""
    json_repair_required: bool = False
    unknown_field_count: int = 0
    report: ValidationReport | None = None
    plan: CoursePlanningResult | None = None

    def deterministic_metrics(self) -> dict[str, float | int | bool]:
        """Только автоматически проверяемое. Экспертные оценки — отдельно."""
        if not self.report:
            return {"succeeded": False}
        report = self.report
        return {
            "succeeded": self.succeeded,
            "schema_valid": report.is_valid,
            "unknown_field_count": self.unknown_field_count,
            "hallucinated_source_count": report.hallucinated_source_count,
            "prerequisite_cycle_count": report.prerequisite_cycle_count,
            "duplicate_topic_count": report.duplicate_topic_count,
            "missing_objective_count": report.missing_objective_count,
            "unsourced_topic_count": report.unsourced_topic_count,
            "coverage_ratio": round(report.coverage_ratio, 4),
            "topic_count": report.topic_count,
            "module_count": report.module_count,
            "total_minutes": report.total_minutes,
            "blocker_count": len(report.blockers),
            "json_repair_required": self.json_repair_required,
            "latency_ms": self.latency_ms,
        }


@dataclass
class BenchmarkRun:
    input_hash: str
    prompt_version: str
    schema_version: str
    book_id: str
    results: list[CandidateResult] = field(default_factory=list)
    estimated_usd: float = 0.0

    def inputs_identical(self) -> bool:
        """Все кандидаты получили один и тот же вход."""
        hashes = {r.input_hash for r in self.results if r.input_hash}
        return len(hashes) <= 1

    def one_call_each(self) -> bool:
        return all(r.calls == 1 for r in self.results)

    def report_rows(self) -> list[dict]:
        rows = []
        for result in self.results:
            row: dict = {"model": result.model}
            row.update(result.deterministic_metrics())
            rows.append(row)
        return rows

    def render_report(self) -> str:
        """Текстовый отчёт. Победителя НЕ назначает."""
        lines = [
            "Сравнение моделей планирования курса",
            f"  книга:        {self.book_id}",
            f"  input_hash:   {self.input_hash[:16]}…",
            f"  prompt:       {self.prompt_version}",
            f"  вход одинаков: {'да' if self.inputs_identical() else 'НЕТ'}",
            f"  один вызов на модель: {'да' if self.one_call_each() else 'НЕТ'}",
            "",
        ]
        for row in self.report_rows():
            lines.append(f"  {row['model']}")
            if not row.get("succeeded"):
                lines.append("    ошибка — результата нет")
                continue
            lines.append(
                f"    валидность: {'ok' if row['schema_valid'] else 'ошибки'}"
                f" | блокеров: {row['blocker_count']}"
                f" | выдуманных источников: {row['hallucinated_source_count']}"
            )
            lines.append(
                f"    покрытие: {row['coverage_ratio']:.0%}"
                f" | тем: {row['topic_count']}"
                f" | циклов: {row['prerequisite_cycle_count']}"
                f" | latency: {row['latency_ms']} мс"
            )
        lines.append("")
        lines.append(
            "  Победитель НЕ выбирается автоматически: нужны слепая экспертная"
        )
        lines.append(
            "  оценка, фактическая стоимость из AIUsageEvent и проверка стабильности."
        )
        return "\n".join(lines)


def run_benchmark(
    *,
    request: CoursePlanningRequest,
    context: RetrievalBundle,
    provider_factory,
    candidates: list[str] | None = None,
    book_id: str = "fixture",
    enforce_guard: bool = True,
    max_total_usd: float | None = None,
) -> BenchmarkRun:
    """Прогоняет один и тот же запрос через список моделей.

    Args:
        provider_factory: `(model_id) -> CoursePlanningProvider`. Инъекция, а не
            жёсткая привязка: в тестах сюда приходит fake, в реальном прогоне —
            OpenRouter-адаптер.
        enforce_guard: `False` допустим ТОЛЬКО когда `provider_factory` не ходит
            в сеть. Тесты обязаны это обеспечивать сами.
    """
    models = candidates if candidates is not None else evaluation_candidates()
    if not models:
        raise BenchmarkDisabled("Список кандидатов пуст (COURSE_EVAL_MODELS).")

    if enforce_guard:
        status = guard_real_run()
        if not status.enabled:
            raise BenchmarkDisabled("; ".join(status.reasons))
        budget = max_total_usd if max_total_usd is not None else status.max_total_usd
        _, estimated = estimate_cost(request, candidates=models)
        if estimated > budget:
            raise BenchmarkBudgetExceeded(
                f"Оценка ${estimated:.2f} выше лимита ${budget:.2f}. "
                f"Модели: {', '.join(models)}."
            )
    else:
        _, estimated = estimate_cost(request, candidates=models)

    run = BenchmarkRun(
        input_hash=request.input_hash(),
        prompt_version=request.prompt_version,
        schema_version=request.schema_version,
        book_id=book_id,
        estimated_usd=estimated,
    )

    for model in models:
        started = time.monotonic()
        result = CandidateResult(model=model, succeeded=False)
        try:
            provider = provider_factory(model)
            # РОВНО один вызов. Никаких повторов при неудаче: повтор у одного
            # кандидата и его отсутствие у другого — уже нечестное сравнение.
            plan = provider.generate_plan(request, context)
            result.calls = 1
            result.plan = plan
            result.input_hash = request.input_hash()
            result.unknown_field_count = len(plan.unknown_fields)
            result.json_repair_required = bool(
                plan.raw_json and not plan.raw_json.lstrip().startswith("{")
            )
            result.report = validate_plan(plan, request)
            result.succeeded = True
        except Exception as exc:  # noqa: BLE001 — падение кандидата не рушит прогон
            result.calls = 1
            result.error = f"{type(exc).__name__}: {exc}"[:300]
        finally:
            result.latency_ms = int((time.monotonic() - started) * 1000)
        run.results.append(result)

    return run
