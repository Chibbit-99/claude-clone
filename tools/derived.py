"""Derive the missing state utilities for the reconstruction.

The SingleFile captures are incomplete in one specific way: utilities that are
only used in *states* the capture never rendered (menu row highlighted, trigger
button open, ...) are absent from the saved bundle.  claude.ai resolves them to
the very same design tokens as their siblings, so we can rebuild them
mechanically from rules that *are* in the captures:

  * declarations are copied from another rule for the same utility core
    (e.g. `.group-hover\\:bg-fill-ghost-hover` gives
    `background-color: var(--cds-fill-ghost-hover)`), or from the arbitrary
    value in the class name itself (`max-w-[var(--available-width)]`),
  * the selector is taken from an existing rule with the same variant chain
    (only the class token is swapped) or translated from the variant grammar,
  * the at-rule context (usually `@media`) of a variant is learned from every
    captured rule that uses that variant, so e.g. `touch:` lands in
    `@media (pointer:coarse),(hover:none)` exactly like the real sheet.

Nothing is invented: every declaration value and every at-rule comes out of a
capture.  Classes whose declarations cannot be traced to a capture rule are
skipped instead of guessed.
"""
from __future__ import annotations

import re
from collections import Counter

import cssmerge as M

# utility prefix -> css property, learned from `x-[value]` rules in the captures
PROPERTY_HINTS = {
    "max-w": "max-width",
    "min-w": "min-width",
    "max-h": "max-height",
    "min-h": "min-height",
    "w": "width",
    "h": "height",
    "p": "padding",
    "px": "padding-inline",
    "py": "padding-block",
    "ps": "padding-inline-start",
    "pe": "padding-inline-end",
    "pt": "padding-block-start",
    "pb": "padding-block-end",
    "m": "margin",
    "mx": "margin-inline",
    "my": "margin-block",
    "ms": "margin-inline-start",
    "me": "margin-inline-end",
    "mt": "margin-block-start",
    "mb": "margin-block-end",
    "gap": "gap",
    "gap-x": "column-gap",
    "gap-y": "row-gap",
    "bg": "background-color",
    "text": "color",
    "border": "border-color",
    "rounded": "border-radius",
    "opacity": "opacity",
    "shadow": "box-shadow",
    "scale": "scale",
    "top": "top",
    "bottom": "bottom",
    "start": "inset-inline-start",
    "end": "inset-inline-end",
    "inset": "inset",
    "inset-x": "inset-inline",
    "inset-y": "inset-block",
    "z": "z-index",
    "delay": "transition-delay",
    "duration": "transition-duration",
    "translate-x": "translate",
    "translate-y": "translate",
    "leading": "line-height",
    "tracking": "letter-spacing",
    "blur": "filter",
    "backdrop-blur": "backdrop-filter",
    "aspect": "aspect-ratio",
    "basis": "flex-basis",
    "border-b": "border-block-end-width",
    "border-t": "border-block-start-width",
    "border-s": "border-inline-start-width",
    "border-e": "border-inline-end-width",
    "border-spacing": "border-spacing",
    "outline-offset": "outline-offset",
    "outline": "outline",
    "ring": "box-shadow",
    "list-style-type": "list-style-type",
    "underline-offset": "text-underline-offset",
}

PSEUDO = {
    "before": ":before",
    "after": ":after",
    "first": ":first-child",
    "last": ":last-child",
    "odd": ":nth-child(odd)",
    "even": ":nth-child(even)",
    "hover": ":hover",
    "active": ":active",
    "focus": ":focus",
    "focus-visible": ":focus-visible",
    "focus-within": ":focus-within",
    "disabled": ":disabled",
    "checked": ":checked",
}

# every `before:`/`after:` rule in the captures starts with this (Tailwind)
CONTENT_PREFIX = "content:var(--tw-content);"


def _esc(cls: str) -> str:
    return "".join(ch if (ch.isalnum() or ch in "-_") else "\\" + ch for ch in cls)


def _unescape(text: str) -> str:
    return re.sub(r"\\(.)", r"\1", text)


def split_class(cls: str) -> tuple[list[str], str]:
    """`a:b-[c:d]` -> (['a', 'b-[c:d]'], 'last') respecting brackets."""
    parts, cur, depth = [], [], 0
    i = 0
    while i < len(cls):
        ch = cls[i]
        if ch == "\\":
            cur.append(cls[i:i + 2])
            i += 2
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        elif ch == ":" and depth == 0:
            parts.append("".join(cur))
            cur = []
            i += 1
            continue
        cur.append(ch)
        i += 1
    parts.append("".join(cur))
    return parts[:-1], parts[-1]


def _selector_state(variant: str) -> str:
    """Translate a variant into the suffix Tailwind would build."""
    if variant in PSEUDO:
        return PSEUDO[variant]
    if variant.startswith("aria-"):
        return f"[aria-{variant[len('aria-'):]}=true]"
    if variant.startswith("data-["):
        return "[data-" + variant[6:-1].replace("_", " ") + "]"
    if variant.startswith("has-["):
        inner = variant[5:-1].replace("_", " ")
        if inner[:1] in ("~", "+", ">"):
            inner = inner[0] + " " + inner[1:].lstrip()
        return ":has(" + inner + ")"
    if variant.startswith("[&"):
        inner = variant[1:-1].replace("_", " ")
        if inner.startswith("&") and "&" not in inner[1:]:
            return inner[1:]
        return ""
    if variant.startswith("["):
        # `[[aria-haspopup][aria-expanded=true]]` and friends: raw selectors
        inner = variant[1:-1].replace("_", " ")
        if inner.startswith("[") and "&" not in inner:
            return inner
        return ""
    return ""


class Knowledge:
    """Everything the captures can teach us about the utility grammar."""

    def __init__(self) -> None:
        self.bodies: dict[str, Counter] = {}
        self.templates: dict[tuple[tuple[str, ...], str], tuple[str, str]] = {}
        self.any_template: dict[tuple[str, ...], tuple[str, str]] = {}
        self.contexts: dict[str, Counter] = {}
        self.selectors: set[str] = set()

    # -- learning -------------------------------------------------------- #
    def learn(self, css: str) -> None:
        for path, rule in M.leaves(css):
            if "{" not in rule or rule.endswith(";"):
                continue
            head, body = rule.split("{", 1)
            body = body[: body.rfind("}")] if body.endswith("}") else body
            if head.lstrip().startswith("@"):
                continue
            context = tuple(p for p in path if not p.startswith("@layer"))
            for sel in M.split_selectors(head):
                # a class token is not always at the start: `:where(.space-y-1\\.5)>…`
                for m in re.finditer(r"\.(?:\\.|[^\s:>~+,\[])+", sel):
                    token = m.group(0)[1:]
                    cls = _unescape(token)
                    variants, core = split_class(cls)
                    if not core or core in ("group", "peer", "dark"):
                        continue
                    self.bodies.setdefault(core, Counter())[body] += 1
                    chain = tuple(variants)
                    family = re.split(r"-", core, 1)[0]
                    self.templates.setdefault((chain, family), (token, sel))
                    self.any_template.setdefault(chain, (token, sel))
                    for variant in variants:
                        self.contexts.setdefault(variant, Counter())[context] += 1
                self.selectors.add(sel)

    # -- querying -------------------------------------------------------- #
    def declarations(self, core: str) -> str | None:
        found = self.bodies.get(core)
        if found:
            return found.most_common(1)[0][0]
        # `[prop:value]`
        m = re.match(r"^\[([a-z-]+):(.*)\]$", core)
        if m:
            return f"{m.group(1)}:{m.group(2).replace('_', ' ')}"
        # arbitrary value: `prop-[value]` -> `prop: value`
        m = re.match(r"^([a-z-]+)-\[(.*)\]$", core)
        if m:
            prefix, value = m.group(1), m.group(2).replace("_", " ")
            prop = PROPERTY_HINTS.get(prefix)
            if prop and ":" not in value:
                return f"{prop}:{value}"
        return None

    def context(self, variant: str) -> tuple[str, ...]:
        """The at-rule context a variant lives in, as recorded from the captures."""
        paths = self.contexts.get(variant)
        if not paths:
            return ()
        return paths.most_common(1)[0][0]

    def selector(self, cls: str) -> tuple[str, tuple[str, ...]] | None:
        variants, core = split_class(cls)
        chain = tuple(variants)
        escaped = _esc(cls)

        # 1. reuse a selector with the exact same variant chain
        plain = not any(v == "stacks" or v.startswith("group-") for v in variants)
        family = re.split(r"-", core, 1)[0]
        candidates = [self.templates.get((chain, family))]
        if plain:
            candidates.append(self.any_template.get(chain))
        for candidate in candidates:
            if not candidate:
                continue
            token, sel = candidate
            if sel.startswith("." + token) and ":where(" + token not in sel:
                return sel.replace(token, escaped), ()

        # 2. translate the variant grammar
        suffix = ""
        context: list[str] = []
        for variant in variants:
            if variant == "stacks":
                guard = self.stacks_guard()
                if not guard:
                    return None
                suffix += guard
                continue
            if variant.startswith("group-"):
                base, name = (variant.rsplit("/", 1) if "/" in variant else (variant, ""))
                state = _selector_state(base[len("group-"):])
                if not state:
                    return None
                group_sel = ".group" + ("\\/" + name if name else "")
                suffix += f":is(:where({group_sel}){state} *)"
                continue
            state = _selector_state(variant)
            if state:
                suffix += state
            learned = self.context(variant)
            if variant not in PSEUDO and not state and not learned:
                return None
            for at_rule in learned:
                if at_rule not in context:
                    context.append(at_rule)
        selector = "." + escaped + suffix
        if re.search(r"(?<!\\)&", selector):
            return None
        return selector, tuple(context)

    def stacks_guard(self) -> str:
        """The `stacks:` variant guard, copied from a captured `stacks:` rule."""
        for sel in self.selectors:
            if not sel.startswith(".stacks\\:"):
                continue
            m = re.search(r"(?<![\w\\]):where\(\[data-cds-fizzy-lake.*?\*\)\)\)", sel)
            if m:
                return m.group(0)
        return ""


def synthesize(classes: list[str], knowledge: Knowledge) -> tuple[str, list[str]]:
    """Build a utilities block for the classes we can reconstruct."""
    made: list[str] = []
    skipped: list[str] = []
    for cls in classes:
        resolved = knowledge.selector(cls)
        if not resolved:
            skipped.append(cls)
            continue
        selector, context = resolved
        variants, core = split_class(cls)
        body = knowledge.declarations(core)
        if not body:
            skipped.append(cls)
            continue
        if "before" in variants or "after" in variants:
            if not body.startswith(CONTENT_PREFIX):
                body = CONTENT_PREFIX + body
        rule = f"{selector}{{{body}}}"
        for at_rule in reversed(context):
            rule = f"{at_rule}{{{rule}}}"
        made.append(rule)

    if not made:
        return "", skipped
    header = ("/* Derived from the captures: these utility classes are used by the\n"
              "   markup but were missing from every saved bundle (their states were\n"
              "   never rendered while capturing). Declarations, selectors and the\n"
              "   at-rule contexts are copied/translated from sibling rules in the\n"
              "   captures; classes without a traceable rule are left alone. */\n")
    return header + "@layer utilities{\n" + "\n".join(made) + "\n}\n", skipped
