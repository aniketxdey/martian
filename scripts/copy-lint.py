#!/usr/bin/env python3
"""Copy lint: count banned words, phrases, sentence openers and em dashes in user-facing text.

Scans string literals and JSX text in the console (src/), string constants in the backend
(backend/martian, docstrings of chat tools included because the model reads them), and the
README and docs. The banned list is .claude/skills/anti-ai-slop-writing/references/banned-words.md.
Real company taglines (src/data/catalog.ts `tagline:`) are quoted verbatim and skipped.

    python3 scripts/copy-lint.py            # summary
    python3 scripts/copy-lint.py --list     # every hit with file and line
    python3 scripts/copy-lint.py --root DIR # scan another checkout
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from collections import Counter
from pathlib import Path

WORDS = [
    r"delv(?:e|es|ing)", r"tapestry", r"landscape", r"testament", r"vibrant", r"pivotal", r"crucial",
    r"intricate", r"intricacies", r"meticulous(?:ly)?", r"bolster(?:ed|s)?", r"garner(?:ed|s)?",
    r"underscor(?:e|es|ed|ing)", r"interplay", r"multifaceted", r"nuanced", r"foster(?:s|ed|ing)?",
    r"leverag(?:e|es|ed|ing)", r"utiliz(?:e|es|ed|ing)", r"utilis(?:e|es|ed|ing)", r"commenc(?:e|es|ed|ing)",
    r"facilitat(?:e|es|ed|ing)", r"encompass(?:es|ed|ing)?", r"paramount", r"groundbreaking", r"cutting-edge",
    r"game-chang(?:ing|er)", r"transformative", r"revolutioni[sz](?:e|es|ed|ing)", r"seamless(?:ly)?",
    r"robust", r"comprehensive", r"endeavou?r", r"aforementioned", r"harness(?:ing)?", r"spearhead(?:ing)?",
    r"navigating", r"showcas(?:e|es|ing)", r"highlighting", r"emphasi[sz]ing", r"enhanc(?:e|es|ing)",
    r"unprecedented", r"remarkable", r"stunning", r"profound(?:ly)?", r"epic", r"in essence",
    r"thought leader(?:ship)?", r"synerg(?:y|ies)", r"pain points?", r"value add", r"value proposition",
    r"moving forward", r"touch base", r"circle back", r"rest assured", r"it goes without saying",
    r"empower(?:s|ed|ing)?", r"streamlin(?:e|es|ed|ing)", r"supercharg(?:e|es|ed|ing)", r"elevat(?:e|es|ing) your",
    r"unlock the power",
]
PHRASES = [
    r"in today's \w+", r"it's worth noting", r"it is worth noting", r"it's important to note", r"it is important to note",
    r"let's dive", r"let's delve", r"at its core", r"in the realm of", r"when it comes to", r"a testament to",
    r"not just [^.,]{1,40}, but", r"it's not just about", r"this is where [^.]{1,40} comes in",
    r"whether you're an? [^.]{1,40} or", r"at the end of the day", r"the bottom line is", r"here's the thing",
    r"here's the deal", r"without further ado", r"in a nutshell", r"buckle up", r"take it to the next level",
    r"bridge the gap", r"move the needle", r"in conclusion", r"firstly", r"i hope this helps",
    r"hope this (?:email )?finds you well", r"as per my last", r"don't hesitate to reach out",
]
OPENERS = [
    "certainly", "absolutely", "sure", "great question", "that's a great point", "i'd be happy to", "as an ai",
    "as a language model", "however, it's important to", "moreover", "furthermore", "additionally",
    "interestingly", "notably", "importantly", "indeed", "overall",
]
# "From X to Y" used to open a sentence.
FROM_TO = r"(?:^|[.!?]\s+)from [^.,!?]{1,40} to [^.,!?]{1,40}"
EM_DASH = "\u2014"
# From the voice profile: empty intensifiers and corporate verbs.
VOICE = r"\b(?:incredibly|immensely|profoundly|deeply|optimi[sz](?:e|es|ed|ing)|best-in-class|world-class|next-gen)\b"
# Three-beat lists ("A, B and C"); reported for review, since some lists are real.
TRIAD = r"\b[\w'-]+(?: [\w'-]+){0,5}, [\w'-]+(?: [\w'-]+){0,5},? (?:and|or) [\w'-]+"

WORD_RE = re.compile(r"\b(?:" + "|".join(WORDS) + r")\b", re.I)
PHRASE_RE = re.compile("|".join(PHRASES), re.I)
OPENER_RE = re.compile(r"(?:^|[.!?]\s+|\n\s*)(?:" + "|".join(re.escape(o) for o in OPENERS) + r")\b[,!]", re.I)
FROM_TO_RE = re.compile(FROM_TO, re.I)
VOICE_RE = re.compile(VOICE, re.I)
TRIAD_RE = re.compile(TRIAD)

CLASSY = re.compile(
    r"(?:^|\s)(?:flex|grid|text-|bg-|px-|py-|p-\d|m[xytblr]?-|rounded|border|h-|w-|min-|max-|gap-|items-|justify-|font-|"
    r"leading-|tracking-|absolute|relative|hidden|block|inline|sr-only|hover:|focus|group|transition|animate-|"
    r"overflow|truncate|shadow|ring|opacity|z-|top-|left-|right-|bottom-|inset|cursor-|select-|pointer-|lg:|md:|sm:|"
    r"max-sm|dark:|whitespace|tabular|no-underline|self-|flex-|col-|row-|space-|duration-|ease-|scale-|translate-)"
)
SKIP_DIRS = {"node_modules", "dist", "dist-embed", ".git", "__pycache__", ".venv", "public"}


def ts_strings(text: str):
    """String literals and JSX text in a .ts/.tsx file, with line numbers (no comments)."""
    out = []
    i, n, line = 0, len(text), 1
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
            i += 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            line += text.count("\n", i, j)
            i = j
        elif c in "'\"`":
            j, buf, start = i + 1, [], line
            while j < n and text[j] != c:
                if text[j] == "\\":
                    buf.append(text[j : j + 2])
                    j += 2
                    continue
                if text[j] == "\n":
                    line += 1
                buf.append(text[j])
                j += 1
            out.append((start, "".join(buf)))
            i = j + 1
        elif c == ">" and text[i - 1 : i] not in ("=", "-") and text[i + 1 : i + 2] != "=":
            # Possible JSX text: consume it so apostrophes ("can't") aren't read as quotes.
            j = i + 1
            while j < n and text[j] not in "<{}":
                j += 1
            chunk = text[i + 1 : j]
            code_like = re.search(r"[;=()]|\b(?:const|return|if|else)\b", chunk)
            if j < n and text[j] in "<{" and not code_like:
                if re.search(r"[A-Za-z]{2,}", chunk):
                    out.append((line, " ".join(chunk.split())))
                line += chunk.count("\n")
                i = j
            else:
                i += 1
        else:
            i += 1
    return out


def py_strings(path: Path, text: str):
    tree = ast.parse(text)
    docstrings: set[int] = set()
    tools_module = "agents" in path.parts
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant):
                # Tool docstrings in agents/ are read by the model, so they count.
                if not (tools_module and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))):
                    docstrings.add(id(body[0].value))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            out.append((node.lineno, node.value))
    return out


def md_strings(text: str):
    out, in_code = [], False
    for no, ln in enumerate(text.splitlines(), 1):
        if ln.strip().startswith("```"):
            in_code = not in_code
            continue
        if not in_code:
            out.append((no, re.sub(r"`[^`]*`", "", ln)))
    return out


def files(root: Path):
    for p in sorted((root / "src").rglob("*")):
        if p.suffix in {".ts", ".tsx"} and not SKIP_DIRS & set(p.parts):
            yield p, "ts"
    for p in sorted((root / "backend" / "martian").rglob("*.py")):
        if not SKIP_DIRS & set(p.parts):
            yield p, "py"
    for p in [root / "README.md", *sorted((root / "docs").glob("*.md")), *sorted((root / "backend" / "martian").rglob("*.md"))]:
        if p.exists() and p.name != "writing_style.md":  # the skill quotes the banned list on purpose
            yield p, "md"


a_triads = False


def scan(root: Path):
    hits = []
    for p, kind in files(root):
        text = p.read_text(encoding="utf-8", errors="ignore")
        try:
            strings = ts_strings(text) if kind == "ts" else py_strings(p, text) if kind == "py" else md_strings(text)
        except SyntaxError:
            continue
        rel = p.relative_to(root)
        for no, s in strings:
            if kind == "ts" and (CLASSY.search(s) or s.startswith(("./", "../", "/", "@", "http"))):
                continue
            checks = [(WORD_RE, "word"), (PHRASE_RE, "phrase"), (OPENER_RE, "opener"), (FROM_TO_RE, "from-to"), (VOICE_RE, "voice")]
            if a_triads and len(s.split()) > 6:
                checks.append((TRIAD_RE, "triad"))
            for rx, label in checks:
                for m in rx.finditer(s):
                    hits.append((label, m.group(0).strip(" .!?\n").lower(), rel.as_posix(), no, s.strip()[:140]))
            if EM_DASH in s:
                hits.append(("em-dash", EM_DASH, rel.as_posix(), no, s.strip()[:140]))
    return hits


def taglines(root: Path) -> set[str]:
    p = root / "src" / "data" / "catalog.ts"
    return set(re.findall(r"tagline: '([^']*)'", p.read_text())) if p.exists() else set()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--triads", action="store_true", help="also report A, B and C lists for review")
    a = ap.parse_args()
    global a_triads
    a_triads = a.triads
    root = Path(a.root)
    tags = taglines(root)
    hits = [h for h in scan(root) if not any(t and t[:40] in h[4] for t in tags)]
    by_kind = Counter(h[0] for h in hits)
    print(f"total {len(hits)}  " + "  ".join(f"{k} {v}" for k, v in sorted(by_kind.items())))
    hits_for_exit = [h for h in hits if h[0] != "triad"]
    for (term, n) in Counter(h[1] for h in hits).most_common(40):
        print(f"  {n:4d}  {term}")
    if a.list:
        for h in hits:
            print(f"{h[2]}:{h[3]}  [{h[0]}: {h[1]}]  {h[4]}")
    return 1 if hits_for_exit else 0


if __name__ == "__main__":
    sys.exit(main())
