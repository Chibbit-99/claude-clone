"""Rule-level CSS merging for the extracted stylesheets.

Every SingleFile extraction ships the app's whole stylesheet, but the bundles
are not identical: each one also contains the utility classes that were only
needed by the DOM state it captured (popovers, dialogs, hover menus...).

The reconstruction keeps the *base* page bundle untouched (so the page itself
renders exactly like the capture) and appends only the rules that the other
extractions bring in, so the runtime-injected fragments are styled too.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# at-rules whose body is not a list of rules
LEAF_AT = (
    "@keyframes",
    "@-webkit-keyframes",
    "@font-face",
    "@property",
    "@counter-style",
    "@font-feature-values",
    "@page",
    "@color-profile",
    "@view-transition",
    "@position-try",
)

# at-rules whose body is a list of rules; kept as a context path
NESTED_AT = (
    "@media",
    "@supports",
    "@layer",
    "@container",
    "@scope",
    "@starting-style",
    "@document",
)


def _skip_string(css: str, i: int) -> int:
    quote = css[i]
    i += 1
    while i < len(css):
        ch = css[i]
        if ch == "\\":
            i += 2
            continue
        if ch == quote:
            return i + 1
        i += 1
    return i


def _skip_comment(css: str, i: int) -> int:
    end = css.find("*/", i + 2)
    return len(css) if end == -1 else end + 2


def _match_brace(css: str, i: int) -> int:
    """i points at '{'; return index of the matching '}'."""
    depth = 0
    while i < len(css):
        ch = css[i]
        if ch == "\\":          # escaped char, e.g. \' in a selector
            i += 2
            continue
        if ch in "\"'":
            i = _skip_string(css, i)
            continue
        if ch == "/" and css.startswith("/*", i):
            i = _skip_comment(css, i)
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(css) - 1


@dataclass
class Chunk:
    kind: str            # "stmt" | "block"
    head: str            # prelude / selector text (normalised)
    body: str = ""       # raw body for blocks


def chunks(css: str):
    """Split a stylesheet into top level statements and blocks."""
    css = _strip_comments(css)
    i, n = 0, len(css)
    while i < n:
        while i < n and css[i].isspace():
            i += 1
        if i >= n:
            break
        start = i
        j = i
        while j < n:
            ch = css[j]
            if ch == "\\":
                j += 2
                continue
            if ch in "\"'":
                j = _skip_string(css, j)
                continue
            if ch == "{":
                end = _match_brace(css, j)
                yield Chunk("block", " ".join(css[start:j].split()), css[j + 1:end])
                i = end + 1
                break
            if ch == ";":
                yield Chunk("stmt", " ".join(css[start:j + 1].split()))
                i = j + 1
                break
            j += 1
        else:
            rest = " ".join(css[start:].split())
            if rest:
                yield Chunk("stmt", rest)
            break


def _strip_comments(css: str) -> str:
    out = []
    i = 0
    while i < len(css):
        if css.startswith("/*", i):
            i = _skip_comment(css, i)
            continue
        if css[i] == "\\":
            out.append(css[i:i + 2])
            i += 2
            continue
        if css[i] in "\"'":
            end = _skip_string(css, i)
            out.append(css[i:end])
            i = end
            continue
        out.append(css[i])
        i += 1
    return "".join(out)


def leaves(css: str, path: tuple[str, ...] = ()):
    """Flatten a stylesheet into (context path, rule text) pairs."""
    for chunk in chunks(css):
        if chunk.kind == "stmt":
            yield path, chunk.head
            continue
        low = chunk.head.lower()
        if low.startswith(LEAF_AT):
            yield path, f"{chunk.head}{{{chunk.body}}}"
        elif low.startswith(NESTED_AT):
            yield from leaves(chunk.body, path + (chunk.head,))
        else:
            yield path, f"{chunk.head}{{{chunk.body}}}"


def delta(base_css: str, other_css: str, seen: set | None = None) -> list[tuple[tuple[str, ...], list[str]]]:
    """Rules present in other_css but not in base_css, grouped by context."""
    known = seen if seen is not None else set()
    known |= set(leaves(base_css))

    groups: list[tuple[tuple[str, ...], list[str]]] = []
    index: dict[tuple[str, ...], list[str]] = {}
    for path, rule in leaves(other_css):
        key = (path, rule)
        if key in known:
            continue
        known.add(key)
        if path not in index:
            index[path] = []
            groups.append((path, index[path]))
        index[path].append(rule)
    return groups


def render(groups) -> str:
    out = []
    for path, rules in groups:
        if not rules:
            continue
        opening = "".join(f"{prelude}{{" for prelude in path)
        out.append(opening + "\n".join(rules) + "}" * len(path))
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# selector level merge
# --------------------------------------------------------------------------- #

def split_selectors(selector_list: str) -> list[str]:
    parts: list[str] = []
    cur = []
    depth = 0
    i = 0
    while i < len(selector_list):
        ch = selector_list[i]
        if ch == "\\":
            cur.append(selector_list[i:i + 2])
            i += 2
            continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
            i += 1
            continue
        cur.append(ch)
        i += 1
    tail = "".join(cur).strip()
    if tail:
        parts.append(tail)
    return [p for p in parts if p]


def declarations(body: str) -> tuple[str, ...]:
    """Order insensitive fingerprint of a declaration block."""
    decls: list[str] = []
    cur: list[str] = []
    depth = 0
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\":
            cur.append(body[i:i + 2])
            i += 2
            continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == ";" and depth == 0:
            decl = " ".join("".join(cur).split())
            if decl:
                decls.append(decl)
            cur = []
            i += 1
            continue
        cur.append(ch)
        i += 1
    decl = " ".join("".join(cur).split())
    if decl:
        decls.append(decl)
    return tuple(sorted(decls))


def properties(body: str) -> list[tuple[str, str]]:
    """Split a declaration block into (property, declaration) pairs."""
    pairs: list[tuple[str, str]] = []
    for decl in declarations(body):
        name = decl.split(":", 1)[0].strip()
        if name and not name.startswith("/*"):
            pairs.append((name, decl))
    return pairs


def _is_at_leaf(head: str) -> bool:
    low = head.lower()
    return low.startswith(LEAF_AT) or low.startswith("@")


class Merger:
    """Collects the rules of many bundles that the base bundle does not have."""

    def __init__(self, base_css: str):
        self.index: dict[tuple[tuple[str, ...], str], tuple[str, ...]] = {}
        # selector -> properties it already sets (used for partial rules)
        self.props: dict[tuple[tuple[str, ...], str], set[str]] = {}
        self.statements: set[tuple[tuple[str, ...], str]] = set()
        self.groups: list[tuple[tuple[str, ...], list[str]]] = []
        self._by_path: dict[tuple[str, ...], list[str]] = {}
        for path, rule in leaves(base_css):
            self._absorb(path, rule, emit=False)

    def _absorb(self, path, rule: str, emit: bool) -> None:
        if rule.endswith(";") or ("{" not in rule and not rule.endswith("}")):
            key = (path, rule)
            if key in self.statements:
                return
            self.statements.add(key)
            if emit:
                self._push(path, rule)
            return

        head, body = rule.split("{", 1)
        body = body[: body.rfind("}")] if body.endswith("}") else body
        if _is_at_leaf(head):
            key = (path, rule)
            if key in self.statements:
                return
            self.statements.add(key)
            if emit:
                self._push(path, rule)
            return

        selector_list = split_selectors(head)
        pairs = properties(body)
        fresh = [s for s in selector_list if (path, s) not in self.index]
        # A rule whose selector is already in the base bundle still teaches us
        # things the base page's own bundle left out: the theme variables that
        # only the popover captures define, for instance.  Add the properties
        # the base does not set for that selector (never override an existing
        # one: the base page must keep rendering exactly like its capture).
        partial: list[str] = []
        for selector in selector_list:
            known = self.props.setdefault((path, selector), set())
            if (path, selector) not in self.index:
                known.update(name for name, _ in pairs)
                continue
            extra = [decl for name, decl in pairs if name not in known]
            if extra:
                partial.append((selector, extra)) if isinstance(extra, list) else None
                known.update(name for name, _ in pairs)
        for selector in selector_list:
            self.index.setdefault((path, selector), declarations(body))
        if emit:
            if fresh:
                self._push(path, f"{','.join(fresh)}{{{body}}}")
            for selector, extra in partial:
                self._push(path, f"{selector}{{ {';'.join(extra)} }}".replace("{ ", "{").replace(" }", "}"))

    def _push(self, path: tuple[str, ...], rule: str) -> None:
        if path not in self._by_path:
            self._by_path[path] = []
            self.groups.append((path, self._by_path[path]))
        self._by_path[path].append(rule)

    def add(self, css: str) -> None:
        for path, rule in leaves(css):
            self._absorb(path, rule, emit=True)

    def render(self) -> str:
        return render(self.groups)


def merge(base_css: str, others: list[str]) -> str:
    merger = Merger(base_css)
    for css in others:
        merger.add(css)
    return merger.render()
