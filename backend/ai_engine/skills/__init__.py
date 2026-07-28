"""Скиллы AI-доски: изолированные навыки + роутер на tool-calling."""

from .base import Skill, SkillResult
from .board import BoardSkill
from .chat import ChatSkill
from .clarify import ClarifySkill
from .router import (
    SKILLS,
    build_router_messages,
    route_and_run,
    route_and_run_streaming,
    tools_for_mode,
)

__all__ = [
    "Skill",
    "SkillResult",
    "BoardSkill",
    "ChatSkill",
    "ClarifySkill",
    "SKILLS",
    "build_router_messages",
    "route_and_run",
    "route_and_run_streaming",
    "tools_for_mode",
]
