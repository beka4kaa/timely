"""
Детерминированная раскладка подписей по спокойным зонам иллюстрации.

Зачем
─────
Раньше координата текста считалась вслепую: `y = y_объекта - 7%`. Текст почти
всегда попадал на саму иллюстрацию, на пёстрые пиксели, и фронтенд был обязан
включать белый ореол из 8 слоёв блюра, чтобы подпись читалась
(см. `contrastStylesFor` в src/lib/illustration-contrast.ts). Ореол выглядит
как мутное пятно поверх картинки.

Здесь подписи объектов/областей ставятся в спокойную область кадра неподалёку
от цели. Подписи векторов и углов остаются локальными: длинная выноска от края
до стрелки силы визуально превращается во вторую «силу» и искажает смысл.

Почему «спокойность», а не «цвет фона»
──────────────────────────────────────
Первая версия искала пиксели цвета рамки кадра. На схемах по белому это
работает, но на полнокадровых 3D-сценах («круговорот воды»: небо, море, горы)
фона в этом смысле нет вовсе — поля получались 0%, и раскладка не срабатывала.
Спокойность (локальное СКО) — общий критерий: ровное небо и гладкое море тоже
спокойные, хотя и не белые. Читаемость по цвету при этом обеспечивает фронтенд:
он подбирает цвет текста по яркости пикселей под подписью.

Никаких обращений к моделям: только OpenCV по уже декодированной картинке.

Контракт координат
──────────────────
`x`/`y` подписи — ПРОЦЕНТЫ от размеров картинки, и это ЦЕНТР текста (фронтенд
ставит его через `translate(-50%, -50%)`). Поэтому у самого края подпись ставить
нельзя: половина текста уедет из кадра. Ширину оцениваем по длине строки.
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Рабочее разрешение анализа: раскладка оперирует областями в единицы процентов,
# поэтому мелкая копия достаточна и считается за доли миллисекунды.
_WORK_LONG_SIDE = 320

# Оценка габаритов подписи в процентах кадра. Должна соответствовать реальному
# кеглю на фронте (text-[11px] md:text-xs в ScientificIllustration): на
# иллюстрации ~900px ширины это ≈0.78% на символ. Если поменяете шрифт там —
# поправьте и здесь, иначе раскладка будет считать боксы не того размера.
# Верхняя граница ширины — из maxWidth:34% самого элемента.
_CHAR_WIDTH_PCT = 0.78
_LABEL_MIN_WIDTH_PCT = 5.0
_LABEL_MAX_WIDTH_PCT = 32.0
_LABEL_HEIGHT_PCT = 6.2

# Полосы-кандидаты у краёв кадра (в процентах). Подписи просили выносить на
# поля, поэтому сначала пробуем края; центр — только если у краёв всё занято.
_EDGE_BANDS = ((5.0, 24.0), (76.0, 95.0))
_CENTER_BAND = (30.0, 70.0)

# Шаг сетки кандидатов.
_X_STEP_PCT = 3.0
_Y_STEP_PCT = 3.5

_SAFE_TOP_PCT = 5.0
_SAFE_BOTTOM_PCT = 95.0

# Веса функции стоимости кандидата.
_W_BUSYNESS = 100.0      # главное: насколько пёстро под текстом
_W_VERTICAL = 0.45       # вертикальный отрыв от объекта (короткая выноска)
_W_CENTER_PENALTY = 6.0  # штраф за уход от края в центр кадра
# Штраф за горизонтальный отрыв. Без него подпись уезжала на противоположный
# край: спокойное небо слева перебивало по стоимости чуть более пёстрое место
# справа, и выноска тянулась через весь кадр (наблюдалось на «Осадках»).
_W_HORIZONTAL = 0.28
_MAX_CONNECTOR_DISTANCE_PCT = 30.0

# СКО (0..1) выше которого место считаем непригодным: текст ляжет на детали.
_BUSYNESS_REJECT = 0.16


def _label_box_pct(text: str) -> tuple[float, float]:
    """Оценка (ширина, высота) подписи в процентах кадра."""
    raw = (text or "").strip()
    width = min(_LABEL_MAX_WIDTH_PCT, max(_LABEL_MIN_WIDTH_PCT, len(raw) * _CHAR_WIDTH_PCT))
    lines = 2 if len(raw) * _CHAR_WIDTH_PCT > _LABEL_MAX_WIDTH_PCT else 1
    return width, _LABEL_HEIGHT_PCT * lines


class _BusynessMap:
    """Локальное СКО яркости по произвольному прямоугольнику за O(1).

    Держим интегральные суммы яркости и её квадрата — тогда среднее и
    дисперсия любого бокса считаются четырьмя обращениями, и перебор десятков
    кандидатов на подпись ничего не стоит.
    """

    def __init__(self, img_bgr: np.ndarray) -> None:
        h, w = img_bgr.shape[:2]
        scale = _WORK_LONG_SIDE / float(max(h, w))
        work = (
            cv2.resize(img_bgr, (max(8, int(w * scale)), max(8, int(h * scale))), interpolation=cv2.INTER_AREA)
            if scale < 1.0
            else img_bgr
        )
        gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY).astype(np.float64) / 255.0
        self.h, self.w = gray.shape[:2]
        self._sum, self._sqsum = cv2.integral2(gray)[:2]

    def std(self, cx: float, cy: float, bw: float, bh: float) -> float:
        """СКО яркости в боксе подписи; координаты и размеры — в процентах."""
        x0 = int(max(0, round((cx - bw / 2) / 100.0 * self.w)))
        x1 = int(min(self.w, round((cx + bw / 2) / 100.0 * self.w)))
        y0 = int(max(0, round((cy - bh / 2) / 100.0 * self.h)))
        y1 = int(min(self.h, round((cy + bh / 2) / 100.0 * self.h)))
        if x1 - x0 < 2 or y1 - y0 < 2:
            return 1.0
        n = float((x1 - x0) * (y1 - y0))
        total = self._sum[y1, x1] - self._sum[y0, x1] - self._sum[y1, x0] + self._sum[y0, x0]
        total_sq = self._sqsum[y1, x1] - self._sqsum[y0, x1] - self._sqsum[y1, x0] + self._sqsum[y0, x0]
        mean = total / n
        variance = max(0.0, total_sq / n - mean * mean)
        return float(np.sqrt(variance))


def _boxes_overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return (
        abs(ax - bx) * 2.0 < (aw + bw)
        and abs(ay - by) * 2.0 < (ah + bh)
    )


def _candidates(bw: float, bh: float) -> list[tuple[float, float]]:
    """Сетка допустимых центров подписи: сначала края, потом центр."""
    half = bw / 2.0
    out: list[tuple[float, float]] = []
    for band in (*_EDGE_BANDS, _CENTER_BAND):
        lo, hi = band
        x = max(lo, half + 1.0)
        limit = min(hi, 100.0 - half - 1.0)
        while x <= limit:
            y = _SAFE_TOP_PCT + bh / 2.0
            while y <= _SAFE_BOTTOM_PCT - bh / 2.0:
                out.append((x, y))
                y += _Y_STEP_PCT
            x += _X_STEP_PCT
    return out


def layout_labels_on_margins(img_bgr: np.ndarray, labels: list[dict]) -> list[dict]:
    """Ставит текст подписей в спокойные зоны у краёв, не меняя `arrow_to`.

    Обрабатываются только object/region-подписи с `arrow_to` (то есть те, для
    которых грунтинг нашёл цель). Vector/angle остаются рядом со стрелкой/дугой:
    их локально раскладывает фронтенд. Остальные возвращаются как есть.

    Возвращает НОВЫЙ список; исходные словари не мутируются.
    """
    if not labels:
        return labels

    try:
        busy = _BusynessMap(img_bgr)
    except Exception as exc:  # noqa: BLE001 — раскладка не должна ронять пайплайн
        logger.warning("[LabelLayout] анализ картинки не удался, координаты как есть: %s", exc)
        return labels

    out: list[dict] = [dict(lb) for lb in labels]

    # Кого вообще раскладываем; порядок — сверху вниз по объекту, чтобы выноски
    # шли параллельно и не перекрещивались.
    todo: list[dict] = []
    for idx, lb in enumerate(out):
        if str(lb.get("target_kind") or "").strip().lower() in {"vector", "angle"}:
            continue
        arrow = lb.get("arrow_to")
        if not isinstance(arrow, dict):
            continue
        try:
            ox, oy = float(arrow.get("x")), float(arrow.get("y"))
        except (TypeError, ValueError):
            continue
        text = str(lb.get("content") or lb.get("text") or "")
        bw, bh = _label_box_pct(text)
        todo.append({"idx": idx, "ox": ox, "oy": oy, "bw": bw, "bh": bh})
    if not todo:
        return out

    todo.sort(key=lambda it: it["oy"])

    taken: list[tuple[float, float, float, float]] = []
    placed = 0
    for it in todo:
        bw, bh, ox, oy = it["bw"], it["bh"], it["ox"], it["oy"]
        best: tuple[float, tuple[float, float]] | None = None

        for cx, cy in _candidates(bw, bh):
            if np.hypot(cx - ox, cy - oy) > _MAX_CONNECTOR_DISTANCE_PCT:
                continue
            box = (cx, cy, bw, bh)
            if any(_boxes_overlap(box, t) for t in taken):
                continue
            # Подпись не должна лежать на самом объекте — иначе выноска нулевая
            # и текст закрывает то, что подписывает.
            if _boxes_overlap(box, (ox, oy, bw * 0.6, bh * 0.6)):
                continue

            std = busy.std(cx, cy, bw, bh)
            if std > _BUSYNESS_REJECT:
                continue

            # Штраф за центр: чем дальше от ближайшего края, тем хуже.
            edge_distance = min(cx, 100.0 - cx) / 50.0
            cost = (
                _W_BUSYNESS * std
                + _W_VERTICAL * abs(cy - oy)
                + _W_HORIZONTAL * abs(cx - ox)
                + _W_CENTER_PENALTY * edge_distance
            )
            # Дополнительно не любим переход через середину кадра: выноска,
            # пересекающая всю иллюстрацию, читается хуже даже при чистом фоне.
            if (ox < 50.0) != (cx < 50.0):
                cost += 8.0

            if best is None or cost < best[0]:
                best = (cost, (cx, cy))

        if best is None:
            continue

        cx, cy = best[1]
        taken.append((cx, cy, bw, bh))
        lb = out[it["idx"]]
        lb["x"] = round(cx, 1)
        lb["y"] = round(cy, 1)
        placed += 1

    logger.info("[LabelLayout] размещено %d/%d подписей по спокойным зонам", placed, len(todo))
    return out
