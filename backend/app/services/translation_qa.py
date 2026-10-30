"""Advisory translation QA. Pure function: no database access.

ICU syntax comes from ``icu-messageformat-parser==0.1.0`` (FormatJS). That
alpha ships wheels for Linux (manylinux_2_28 x86_64 and aarch64, including
``python:3.14-slim``) and macOS only: there is no Windows wheel and no source
distribution. ``pyicumessageformat`` was not used; its last release was in 2021.

Plural categories come from ``babel`` (CLDR). ``other`` is not one of Babel's
tags; a missing ``other`` branch is reported on its own.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Literal

from babel.core import Locale, UnknownLocaleError
from icu_messageformat_parser import parse

from app.limits import TEXT_MAX_LENGTH

# FormatJS AST node types.
_LITERAL = 0
_ARGUMENT = 1
_NUMBER = 2
_DATE = 3
_TIME = 4
_SELECT = 5
_PLURAL = 6
_TAG = 8

_TYPED = {_NUMBER: "number", _DATE: "date", _TIME: "time"}
_TAG_ERRORS = ("INVALID_TAG", "UNCLOSED_TAG", "UNMATCHED_CLOSING_TAG")
_VOID_TAGS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
# %% is an escaped percent. Flags and width are ignored so %-10s matches %s.
_PRINTF = re.compile(
    r"%%|%(?:(?P<pos>\d+)\$)?[-+0 #]*(?:\d+|\*)?(?:\.(?:\d+|\*))?"
    r"(?:hh|h|ll|l|L|z|j|t)?(?P<conv>[sdifouxXeEgGc])"
)
_ICU_COLUMN = re.compile(r"line (\d+), column (\d+)")

MAX_NESTING = 20
MAX_ISSUES = 50
# Warn when the translation is longer than both twice the source and source+40.
LENGTH_RATIO = 2
LENGTH_SLACK = 40

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class QaIssue:
    code: str
    severity: Severity
    message: str
    start: int | None = None
    end: int | None = None
    detail: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "start": self.start,
            "end": self.end,
            "detail": self.detail,
        }


@dataclass(frozen=True)
class _Block:
    kind: str
    name: str
    selectors: frozenset[str]


@dataclass
class _IcuView:
    placeholders: Counter[str] = field(default_factory=Counter)
    blocks: list[_Block] = field(default_factory=list)
    too_deep: bool = False


@dataclass
class _Markup:
    tags: Counter[str] = field(default_factory=Counter)
    parts: list[str] = field(default_factory=list)
    attrs: list[str] = field(default_factory=list)
    broken: str | None = None


@dataclass
class _Side:
    markup: _Markup
    icu: _IcuView | None
    syntax: str | None = None
    limited: str | None = None


def check_translation(source: str, translation: str, locale: str) -> list[QaIssue]:
    """Compare one translation to its source. Never raises for bad input."""
    if len(source) > TEXT_MAX_LENGTH or len(translation) > TEXT_MAX_LENGTH:
        return [
            _issue(
                "qa_limit",
                "warning",
                f"QA skipped: source or translation is longer than {TEXT_MAX_LENGTH} characters.",
                detail={"limit": TEXT_MAX_LENGTH},
            )
        ]
    try:
        return _check(source, translation, locale)[:MAX_ISSUES]
    except RecursionError:
        return [
            _issue(
                "qa_limit",
                "warning",
                f"QA skipped ICU checks because nesting is deeper than {MAX_NESTING}.",
                detail={"limit": MAX_NESTING},
            )
        ]


def _check(source: str, translation: str, locale: str) -> list[QaIssue]:
    src = _examine(source)
    dst = _examine(translation)
    issues: list[QaIssue] = []
    if src.limited or dst.limited:
        issues.append(
            _issue(
                "qa_limit",
                "warning",
                f"QA skipped ICU checks because nesting is deeper than {MAX_NESTING}.",
                detail={"limit": MAX_NESTING},
            )
        )
    if src.syntax:
        issues.append(_syntax("source", src.syntax))
    if dst.syntax:
        issues.append(_syntax("translation", dst.syntax))
    if src.icu is not None and dst.icu is not None:
        issues.extend(_placeholder_issues(src.icu, dst.icu))
        issues.extend(_variable_issues(src.icu, dst.icu))
    if dst.icu is not None:
        issues.extend(_other_issues(dst.icu))
        issues.extend(_plural_issues(dst.icu, locale))
    issues.extend(_html_issues(src.markup, dst.markup))
    length = _length_issue(source, translation)
    if length is not None:
        issues.append(length)
    return issues


def _examine(text: str) -> _Side:
    markup = _scan_markup(text)
    if _brace_depth(text) > MAX_NESTING:
        return _Side(markup, None, limited="nesting")
    try:
        view = _view_from_ast(parse(text))
    except ValueError as exc:
        message = str(exc)
        if not message.startswith(_TAG_ERRORS):
            return _Side(markup, None, syntax=message)
        try:
            view = _view_from_ast(parse("".join(markup.parts)))
        except ValueError as inner:
            return _Side(markup, None, syntax=str(inner))
        for attr in markup.attrs:
            if view.too_deep:
                break
            try:
                _walk(parse(attr), 1, view)
            except ValueError as inner:
                return _Side(markup, None, syntax=str(inner))
    if view.too_deep:
        return _Side(markup, None, limited="nesting")
    return _Side(markup, view)


def _view_from_ast(ast: list) -> _IcuView:
    view = _IcuView()
    _walk(ast, 1, view)
    return view


def _walk(nodes: Iterable[object], depth: int, view: _IcuView) -> None:
    if depth > MAX_NESTING:
        view.too_deep = True
        return
    for node in nodes:
        if view.too_deep or not isinstance(node, dict):
            continue
        kind = node.get("type")
        if kind == _LITERAL:
            _add_printf(str(node.get("value") or ""), view.placeholders)
        elif kind in (_ARGUMENT, _NUMBER, _DATE, _TIME):
            token = _placeholder_token(node)
            if token:
                view.placeholders[token] += 1
        elif kind in (_SELECT, _PLURAL):
            options = node.get("options") if isinstance(node.get("options"), dict) else {}
            if kind == _SELECT:
                block_kind = "select"
            else:
                block_kind = "selectordinal" if node.get("pluralType") == "ordinal" else "plural"
            view.blocks.append(
                _Block(block_kind, str(node.get("value") or ""), frozenset(map(str, options)))
            )
            for option in options.values():
                children = option.get("value") if isinstance(option, dict) else None
                if isinstance(children, list):
                    _walk(children, depth + 1, view)
        elif kind == _TAG:
            children = node.get("children")
            if isinstance(children, list):
                _walk(children, depth + 1, view)


def _placeholder_token(node: dict) -> str | None:
    name = node.get("value")
    if not isinstance(name, str) or not name:
        return None
    type_name = _TYPED.get(node.get("type"))
    if type_name is None:
        return "{" + name + "}"
    style = node.get("style")
    if isinstance(style, str) and style:
        return "{" + f"{name}, {type_name}, {style}" + "}"
    return "{" + f"{name}, {type_name}" + "}"


def _add_printf(text: str, placeholders: Counter[str]) -> None:
    for match in _PRINTF.finditer(text):
        conv = match.group("conv")
        if not conv:
            continue
        pos = match.group("pos")
        placeholders[f"%{pos}${conv}" if pos else f"%{conv}"] += 1


def _placeholder_issues(src: _IcuView, dst: _IcuView) -> list[QaIssue]:
    issues: list[QaIssue] = []
    for token in sorted(set(src.placeholders) | set(dst.placeholders)):
        source_count = src.placeholders[token]
        translation_count = dst.placeholders[token]
        if translation_count == source_count:
            continue
        missing = translation_count < source_count
        issues.append(
            _issue(
                "placeholder_missing" if missing else "placeholder_extra",
                "error",
                (
                    f"{'Missing' if missing else 'Extra'} placeholder {token} "
                    f"(source has {source_count}, translation has {translation_count})."
                ),
                detail={
                    "token": token,
                    "source_count": source_count,
                    "translation_count": translation_count,
                },
            )
        )
    return issues


def _variable_issues(src: _IcuView, dst: _IcuView) -> list[QaIssue]:
    source_counts = Counter((block.kind, block.name) for block in src.blocks)
    translation_counts = Counter((block.kind, block.name) for block in dst.blocks)
    issues: list[QaIssue] = []
    for kind, name in sorted(set(source_counts) | set(translation_counts)):
        source_count = source_counts[(kind, name)]
        translation_count = translation_counts[(kind, name)]
        if translation_count == source_count:
            continue
        missing = translation_count < source_count
        label = _kind_label(kind)
        issues.append(
            _issue(
                "icu_variable",
                "error",
                (
                    f"{'Missing' if missing else 'Extra'} {label} variable {{{name}}} "
                    f"(source has {source_count}, translation has {translation_count})."
                ),
                detail={
                    "kind": kind,
                    "name": name,
                    "source_count": source_count,
                    "translation_count": translation_count,
                },
            )
        )
    return issues


def _other_issues(view: _IcuView) -> list[QaIssue]:
    issues: list[QaIssue] = []
    for block in view.blocks:
        if "other" in block.selectors:
            continue
        label = _kind_label(block.kind).capitalize()
        issues.append(
            _issue(
                "icu_other",
                "error",
                f"{label} {{{block.name}}} is missing the required other branch.",
                detail={"kind": block.kind, "name": block.name},
            )
        )
    return issues


def _plural_issues(view: _IcuView, locale: str) -> list[QaIssue]:
    required_cache: dict[bool, frozenset[str] | None] = {}
    issues: list[QaIssue] = []
    for block in view.blocks:
        if block.kind == "select":
            continue
        ordinal = block.kind == "selectordinal"
        if ordinal not in required_cache:
            required_cache[ordinal] = _plural_categories(locale, ordinal=ordinal)
        required = required_cache[ordinal]
        if required is None:
            continue
        present = {selector for selector in block.selectors if not selector.startswith("=")}
        for category in sorted(required - present):
            label = _kind_label(block.kind).capitalize()
            issues.append(
                _issue(
                    "icu_plural",
                    "error",
                    (
                        f"{label} {{{block.name}}} is missing category {category} "
                        f"for locale {locale}."
                    ),
                    detail={"kind": block.kind, "name": block.name, "category": category, "locale": locale},
                )
            )
    return issues


def _plural_categories(locale: str, *, ordinal: bool) -> frozenset[str] | None:
    try:
        parsed = Locale.parse(locale.replace("-", "_"))
    except (UnknownLocaleError, ValueError):
        return None
    rule = parsed.ordinal_form if ordinal else parsed.plural_form
    return frozenset(rule.tags)


def _html_issues(src: _Markup, dst: _Markup) -> list[QaIssue]:
    issues: list[QaIssue] = []
    if dst.broken:
        issues.append(
            _issue(
                "html_broken",
                "error",
                f"Markup is broken: {dst.broken}",
                detail={"reason": dst.broken},
            )
        )
    if src.broken or dst.broken:
        return issues
    for tag in sorted(set(src.tags) | set(dst.tags)):
        source_count = src.tags[tag]
        translation_count = dst.tags[tag]
        if translation_count == source_count:
            continue
        missing = translation_count < source_count
        issues.append(
            _issue(
                "html_mismatch",
                "error",
                (
                    f"{'Missing' if missing else 'Extra'} tag <{tag}> "
                    f"(source has {source_count}, translation has {translation_count})."
                ),
                detail={
                    "tag": tag,
                    "source_count": source_count,
                    "translation_count": translation_count,
                },
            )
        )
    return issues


def _length_issue(source: str, translation: str) -> QaIssue | None:
    limit = max(len(source) * LENGTH_RATIO, len(source) + LENGTH_SLACK)
    if len(translation) <= limit:
        return None
    return _issue(
        "length",
        "warning",
        f"Translation is {len(translation)} characters, past the advisory limit of {limit}.",
        detail={"length": len(translation), "limit": limit},
    )


def _syntax(side: str, error: str) -> QaIssue:
    shown = error if len(error) <= 240 else error[:240] + "…"
    label = "Source" if side == "source" else "Translation"
    start = None
    found = _ICU_COLUMN.search(error)
    if side == "translation" and found and found.group(1) == "1":
        start = max(0, int(found.group(2)) - 1)
    return _issue(
        "icu_syntax",
        "error",
        f"{label} is not valid ICU MessageFormat: {shown}",
        start=start,
        detail={"side": side, "error": shown},
    )


def _issue(
    code: str,
    severity: Severity,
    message: str,
    *,
    start: int | None = None,
    detail: dict[str, Any] | None = None,
) -> QaIssue:
    return QaIssue(code=code, severity=severity, message=message, start=start, detail=detail)


def _kind_label(kind: str) -> str:
    if kind == "selectordinal":
        return "ordinal"
    return kind


def _brace_depth(text: str) -> int:
    # shortcut: counts quoted braces too, raise MAX_NESTING if real copy nests deeper.
    depth = 0
    maximum = 0
    for char in text:
        if char == "{":
            depth += 1
            if depth > maximum:
                maximum = depth
                if maximum > MAX_NESTING:
                    return maximum
        elif char == "}" and depth:
            depth -= 1
    return maximum


class _MarkupScanner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.tags: Counter[str] = Counter()
        self.parts: list[str] = []
        self.attrs: list[str] = []
        self.stack: list[str] = []
        self.broken: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, void=tag.lower() in _VOID_TAGS)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, void=True)

    def _open(self, tag: str, attrs: list[tuple[str, str | None]], *, void: bool) -> None:
        name = tag.lower()
        self.tags[name] += 1
        for _key, value in attrs:
            if value:
                self.attrs.append(value)
        if not void:
            self.stack.append(name)

    def handle_endtag(self, tag: str) -> None:
        name = tag.lower()
        if name in _VOID_TAGS:
            return
        if self.stack and self.stack[-1] == name:
            self.stack.pop()
            return
        if self.broken is None:
            if self.stack:
                self.broken = f"Closing tag </{name}> does not match <{self.stack[-1]}>."
            else:
                self.broken = f"Unexpected closing tag </{name}>."
        if name in self.stack:
            while self.stack and self.stack[-1] != name:
                self.stack.pop()
            if self.stack:
                self.stack.pop()

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def close(self) -> None:
        if "<" in self.rawdata and self.broken is None:
            self.broken = "Unclosed tag."
        super().close()
        if self.stack and self.broken is None:
            self.broken = f"Unclosed tag <{self.stack[-1]}>."

    def result(self) -> _Markup:
        return _Markup(self.tags, self.parts, self.attrs, self.broken)


def _scan_markup(text: str) -> _Markup:
    scanner = _MarkupScanner()
    try:
        scanner.feed(text)
        scanner.close()
    except Exception:
        scanner.broken = scanner.broken or "Markup could not be parsed."
    return scanner.result()
