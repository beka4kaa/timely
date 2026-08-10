"""Педагогическая роль узла и пригодность для учебной программы.

Роль отвечает на вопрос «что это за кусок книги», а `is_teachable` — на вопрос
«можно ли по нему учить». Это разные вещи: «Ответы к упражнениям» — законная
часть книги, на которую можно сослаться, но программу по ней не строят.

Отдельное поле нужно потому, что раньше такого различения не было вовсе:
teachable считалось всё, что попало в структуру, и список упражнений становился
модулем курса наравне с главой о кинематике.
"""

from __future__ import annotations

import re

from .contracts import NON_TEACHABLE_ROLES, Outline, OutlineNode, Role
from .thresholds import CONFIDENCE_MEDIUM

# Служебные части книги: они идут до или после учебного материала.
#
# Английские правила здесь не для полноты. Без них «About the Author» и «Brief
# Table of Contents (Not Yet Final)» становились модулями программы, а «How to
# Contact Us» и «Acknowledgments» — темами: в англоязычной книге всё это
# закладки того же уровня, что и главы.
#
# «Preface» отнесён к служебному, а русское «Введение» — нет, и это не
# небрежность. В англоязычной традиции preface — это про книгу: как ей
# пользоваться, кого благодарит автор, где брать код. Русское введение обычно
# содержит настоящий материал: у Мякишева под ним три главы с параграфами.
_FRONT_MATTER = re.compile(
    r"^\s*("
    r"удк|ббк|isbn|issn|содержание|оглавление|титул"
    r"|(brief\s+)?(table\s+of\s+)?contents"
    r"|preface|foreword|acknowledg|dedication|colophon|errata"
    r"|about\s+the\s+(author|cover)"
    r"|copyright|how\s+to\s+contact"
    r")",
    re.I,
)
_ANSWERS = re.compile(r"^\s*(ответы|решения\s+задач|answers?\s+to)\b", re.I)
_BIBLIOGRAPHY = re.compile(
    r"^\s*(литератур|библиограф|список\s+литератур|bibliography|further\s+reading)",
    re.I,
)
_INDEX = re.compile(
    r"^\s*((алфавитный|предметный|именной)\s+указатель|index\s*$|glossary)", re.I
)


def infer_role(node: OutlineNode) -> str:
    """Роль по названию, если парсер не определил её раньше."""
    title = node.title
    if _FRONT_MATTER.match(title):
        return Role.FRONT_MATTER
    if _ANSWERS.match(title):
        return Role.ANSWERS
    if _BIBLIOGRAPHY.match(title):
        return Role.BIBLIOGRAPHY
    if _INDEX.match(title):
        return Role.INDEX
    if node.role and node.role != Role.UNKNOWN:
        return node.role
    if node.level <= 1:
        return Role.PART
    if node.level == 2:
        return Role.CHAPTER
    return Role.SECTION


def is_teachable(node: OutlineNode) -> bool:
    """Годится ли раздел в учебную программу.

    Три независимые причины отказа: служебная роль, недоказанная структура и
    отсутствие собственного объёма. Последнее важно для контейнеров-частей:
    «Кинематика» сама по себе ничему не учит, учат её главы.
    """
    if node.role in NON_TEACHABLE_ROLES:
        return False
    # Неподтверждённой структуре нельзя доверять состав программы: именно так
    # в модули попадали строки из списков упражнений.
    if node.confidence < CONFIDENCE_MEDIUM:
        return False
    return True


def apply_roles(outline: Outline) -> Outline:
    for node in outline.nodes:
        node.role = infer_role(node)
        node.is_teachable = is_teachable(node)
    return outline
