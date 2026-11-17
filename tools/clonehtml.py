"""Helpers for slicing fragments out of SingleFile extractions in /clones.

The extracted pages are huge (250-500 KB) so we never re-author markup by hand:
we slice balanced element ranges straight out of the original bytes.
"""
from __future__ import annotations

import re
from pathlib import Path

CLONES = Path(__file__).resolve().parent.parent / "clones" / "new"

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}

TAG_RE = re.compile(r"<(/?)([a-zA-Z][\w:-]*)((?:\"[^\"]*\"|'[^']*'|[^>\"'])*?)(/?)>")


def page(name: str) -> str:
    return (CLONES / name / "index.html").read_text()


def attrs(raw: str) -> dict[str, str]:
    """Parse the attribute blob of an opening tag into a dict.

    Values may be quoted or bare (SingleFile strips quotes aggressively).
    """
    out: dict[str, str] = {}
    for m in re.finditer(
        r"""([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?""", raw
    ):
        k = m.group(1)
        v = m.group(2)
        if v is None:
            v = ""
        elif len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out.setdefault(k, v)
    return out


def find_tags(html: str, tag: str):
    """Yield (start, attrs, self_closing) for every opening <tag>."""
    pat = re.compile(r"<" + tag + r"((?:\"[^\"]*\"|'[^']*'|[^>\"'])*?)(/?)>", re.I)
    for m in pat.finditer(html):
        yield m.start(), attrs(m.group(1)), bool(m.group(2))


def match_end(html: str, start: int) -> int:
    """Given the offset of an opening tag, return offset just past its close tag."""
    m = TAG_RE.match(html, start)
    if not m:
        raise ValueError(f"no tag at {start}: {html[start:start+60]!r}")
    name = m.group(2).lower()
    if m.group(4) == "/" or name in VOID:
        return m.end()
    depth = 1
    for t in TAG_RE.finditer(html, m.end()):
        if t.group(2).lower() != name:
            continue
        if t.group(1):  # closing
            depth -= 1
            if depth == 0:
                return t.end()
        elif t.group(4) == "/" or name in VOID:
            continue
        else:
            depth += 1
    raise ValueError(f"unbalanced <{name}> starting at {start}")


def outer(html: str, start: int) -> str:
    return html[start:match_end(html, start)]


def select(html: str, tag: str, pred, root: int = 0, end: int | None = None):
    """Return list of outerHTML strings for <tag> elements matching pred(attrs)."""
    end = len(html) if end is None else end
    out = []
    for start, a, _self in find_tags(html, tag):
        if start < root:
            continue
        if start >= end:
            break
        if pred(a):
            out.append(outer(html, start))
    return out


def first(html: str, tag: str, pred, root: int = 0, end: int | None = None):
    got = select(html, tag, pred, root, end)
    if not got:
        raise LookupError(f"no <{tag}> matched")
    return got[0]


def portal(name: str) -> tuple[str, int]:
    """Return (outerHTML, offset) of #portal-root in a given extraction."""
    html = page(name)
    for start, a, _ in find_tags(html, "div"):
        if a.get("id") == "portal-root":
            return outer(html, start), start
    raise LookupError(f"no #portal-root in {name}")


def trim_classes(fragment: str, keep: int = 60) -> str:
    """Debug helper: shorten long class attributes so fragments are readable."""
    def repl(m):
        v = m.group(2)
        return f'{m.group(1)}="{v[:keep]}\u2026"'
    return re.sub(r'(\b[\w:-]+)="([^"]*)"', repl, fragment)


def outline(fragment: str) -> str:
    """Debug helper: one tag per line, classes trimmed."""
    frag = trim_classes(fragment)
    frag = re.sub(r"<(script|style)\b.*?</\1>", r"<\1/>", frag, flags=re.S)
    return re.sub(r"><", ">\n<", frag)
