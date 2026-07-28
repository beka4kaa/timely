"""Скиллы AI-доски: изолированные навыки + роутер на tool-calling."""

from .base import Skill, SkillResult
from .board import BoardSkill
from .chat import ChatSkill
from .clarify import ClarifySkill
from .router import SKILLS, route_and_run, route_and_run_streaming

__all__ = [
    "Skill",
    "SkillResult",
    "BoardSkill",
    "ChatSkill",
    "ClarifySkill",
    "SKILLS",
    "route_and_run",
    "route_and_run_streaming",
]
