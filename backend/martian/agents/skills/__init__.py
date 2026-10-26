"""Skills: short Markdown instruction files the chat agent always follows.

Each `*.md` file in this folder is one skill. An optional front-matter block sets its
`name`, a one-line `description` and `always` (default true). Skills marked `always` are
appended to the system prompt on every turn, so house rules such as the writing style
apply to every answer without the model having to look them up.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

SKILLS_DIR = Path(__file__).parent


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    always: bool = True


def _parse(path: Path) -> Skill:
    text = path.read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    body = text
    if text.startswith("---\n"):
        head, _, body = text[4:].partition("\n---\n")
        for line in head.splitlines():
            key, sep, value = line.partition(":")
            if sep:
                meta[key.strip()] = value.strip().strip('"')
    return Skill(
        name=meta.get("name", path.stem),
        description=meta.get("description", ""),
        body=body.strip(),
        always=meta.get("always", "true").lower() != "false",
    )


@lru_cache
def load_skills() -> tuple[Skill, ...]:
    return tuple(_parse(p) for p in sorted(SKILLS_DIR.glob("*.md")))


def skills_prompt() -> str:
    """The text appended to the system prompt: every always-on skill, in file order."""
    parts = [f"## Skill: {s.name}\n\n{s.body}" for s in load_skills() if s.always]
    return "\n\n".join(parts)
