"""Advisory translation QA. Pure function: no database access.

Placeholder style is detected per string, not per project. ``{{ }}`` (ngx-translate
and i18next), Rails ``%{name}``, and balanced braces that are not ICU are lifted
out before parsing. The ICU parser then sees only real MessageFormat, so its
apostrophe quoting cannot hide a non-ICU placeholder.

ICU syntax comes from ``icu-messageformat-parser==0.1.0`` (FormatJS). That
alpha ships wheels for Linux (manylinux_2_28 x86_64 and aarch64, including
``python:3.14-slim``) and macOS only: there is no Windows wheel and no source
distribution. ``pyicumessageformat`` was not used; its last release was in 2021.

Plural categories come from ``babel`` (CLDR). ``other`` is not one of Babel's
tags; a missing ``other`` branch is reported on its own. Compact ``many``
(multiples of 1000000 and scientific notation) falls back to ``other`` at
runtime and is not required.
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
# A space is not a flag: "50% discount" must not read as %d. A letter after the
# conversion is prose: "50%off" must not read as %o. Length stays in the token
# so %lld and %d are different. @ is the iOS object conversion.
_PRINTF = re.compile(
    r"%%|%(?:(?P<pos>\d+)\$)?[-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?"
    r"(?P<len>hh|ll|h|l|L|z|j|t)?(?P<conv>[sdifouxXeEgGc@])(?![A-Za-z])"
)
_ICU_COLUMN = re.compile(r"line (\d+), column (\d+)")
# Plural/select (and typed number/date/time with a style) so {{ }} inside an
# option is not read as an ngx placeholder. selectordinal is before select.
_COMPLEX_HEAD = re.compile(
    r"\{\s*(?:[A-Za-z_][A-Za-z0-9_]*|\d+)\s*,\s*"
    r"(?P<type>plural|selectordinal|select|number|date|time)\s*,\s*"
)
_ICU_SIMPLE = re.compile(r"\s*(?:[A-Za-z_][A-Za-z0-9_]*|\d+)\s*\Z")
_ICU_TYPED = re.compile(
    r"\{\s*(?:[A-Za-z_][A-Za-z0-9_]*|\d+)\s*,\s*"
    r"(?:plural|selectordinal|select|number|date|time)\b"
)
_I18NEXT_T = re.compile(
    r"\$t\(\s*(?:'(?P<sq>[^']*)'|\"(?P<dq>[^\"]*)\"|(?P<bare>[\w:.-]+))\s*(?:,[^)]*)?\)"
)
_VUE_LINK = re.compile(r"(?<![\w@])@(?P<mod>\.[A-Za-z]+)?:(?P<key>[\w.-]+)")
_SELECTOR = re.compile(r"(?:=\s*-?\d+|[A-Za-z_][A-Za-z0-9_]*)")
_OFFSET = re.compile(r"offset\s*:\s*-?\d+\s*")
_RAILS = re.compile(r"%\{([^{}]*)\}")
# Complete {name} / {name, number} left in the text when the ICU parse fails.
_PLAIN_ARG = re.compile(
    r"\{\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*|\d+)\s*"
    r"(?:\}|,\s*(?P<type>number|date|time)\s*(?:,\s*(?P<style>[^}]*))?\s*\})"
)
# A lone "{" before a word, including non-ASCII ("Nhấn { để").
_FOLLOWING_NAME = re.compile(r"\s*(?:[^\W\d_]|_|\d)")
# Same-length stand-in. Never copied into a token or a user-facing message.
_DOT = "·"

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
    part_at: list[int] = field(default_factory=list)
    attr_at: list[int] = field(default_factory=list)


@dataclass
class _Side:
    markup: _Markup
    icu: _IcuView | None
    syntax: list[str] = field(default_factory=list)
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
    for error in src.syntax:
        issues.append(_syntax("source", error))
    for error in dst.syntax:
        issues.append(_syntax("translation", error))
    src_ok = _structure_ok(src)
    dst_ok = _structure_ok(dst)
    if src.icu is not None and dst.icu is not None:
        issues.extend(_placeholder_issues(src.icu, dst.icu))
        # Blocks only exist after a real parse. A failed parse must not report
        # the plural as a missing variable.
        if src_ok and dst_ok:
            issues.extend(_variable_issues(src.icu, dst.icu))
    if dst_ok and dst.icu is not None:
        issues.extend(_other_issues(dst.icu))
        issues.extend(_plural_issues(dst.icu, locale))
    issues.extend(_html_issues(src.markup, dst.markup))
    length = _length_issue(source, translation)
    if length is not None:
        issues.append(length)
    return issues


def _structure_ok(side: _Side) -> bool:
    return side.icu is not None and (bool(side.icu.blocks) or not side.syntax)


def _examine(text: str) -> _Side:
    # Reject deep or unclosed braces before the shield. The shield's brace
    # matcher is linear, but a nest past MAX_NESTING is not worth scanning.
    if _brace_depth(text) > MAX_NESTING:
        return _Side(_scan_markup(text), None, limited="nesting")
    shielded, specials, syntax = _shield(text)
    markup = _scan_markup(shielded)
    view = _IcuView()
    view.placeholders.update(specials)
    _add_printf(shielded, view.placeholders)
    _add_calls(shielded, view.placeholders)
    try:
        ast = parse(shielded)
    except ValueError as exc:
        message = str(exc)
        if message.startswith(_TAG_ERRORS):
            syntax.extend(_absorb_markup(markup, text, view))
        else:
            if _should_report_icu(shielded, message):
                syntax.append(_restore_snippet(message, text))
            # The walk did not run, so count finished {name} arguments here.
            # Fragments such as "{# mục}" are not arguments.
            _add_plain_arguments(shielded, view.placeholders)
    else:
        _walk(ast, 1, view)
    if view.too_deep:
        return _Side(markup, None, limited="nesting")
    return _Side(markup, view, syntax=syntax)


def _walk(nodes: Iterable[object], depth: int, view: _IcuView) -> None:
    if depth > MAX_NESTING:
        view.too_deep = True
        return
    for node in nodes:
        if view.too_deep or not isinstance(node, dict):
            continue
        kind = node.get("type")
        if kind == _LITERAL:
            # Printf and other literal tokens are collected from the whole string
            # in _examine, so a failed ICU parse cannot skip them.
            continue
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
    if not isinstance(name, str) or not name or _DOT in name:
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
        length = match.group("len") or ""
        placeholders[f"%{pos}${length}{conv}" if pos else f"%{length}{conv}"] += 1


def _add_calls(text: str, placeholders: Counter[str]) -> None:
    for match in _I18NEXT_T.finditer(text):
        key = match.group("sq") or match.group("dq") or match.group("bare") or ""
        if key:
            placeholders[f"$t({key})"] += 1
    for match in _VUE_LINK.finditer(text):
        mod = match.group("mod") or ""
        placeholders[f"@{mod}:{match.group('key')}"] += 1


def _shield(text: str) -> tuple[str, Counter[str], list[str]]:
    """Replace non-ICU placeholders with equal-length dots and count them.

    ``{{name}}`` inside a plural option stays ICU: the option's ``{`` is
    structural, and the inner ``{name}`` is a normal argument. A ``{{`` at
    message level is ngx/i18next. Braces that are not valid ICU (``.NET``
    ``{0:C2}``, Python ``{user.name}``, JSON) are counted here so an
    apostrophe in front of them cannot quote them away.
    """
    tokens: Counter[str] = Counter()
    syntax: list[str] = []
    closes = _brace_closes(text)
    shielded = _shield_span(text, 0, len(text), tokens, syntax, closes)
    return shielded, tokens, syntax


def _brace_closes(text: str) -> list[int]:
    """Match each ``{`` to its ``}`` in one pass. Unmatched opens stay -1."""
    closes = [-1] * len(text)
    stack: list[int] = []
    for index, ch in enumerate(text):
        if ch == "{":
            stack.append(index)
        elif ch == "}" and stack:
            closes[stack.pop()] = index
    return closes


def _close_at(closes: list[int], open_at: int, end: int) -> int | None:
    close = closes[open_at]
    if close < 0 or close >= end:
        return None
    return close


def _shield_span(
    text: str,
    start: int,
    end: int,
    tokens: Counter[str],
    syntax: list[str],
    closes: list[int],
) -> str:
    buf: list[str] = []
    i = start
    while i < end:
        if text.startswith("{{", i):
            kind, stop, token = _read_ngx(text, i, end)
            if kind == "nested":
                inner_kind, inner_stop, inner_token = _read_ngx(text, i + 1, end)
                # {{{ name }}} is one placeholder, not "{" plus a masked name.
                if (
                    inner_kind == "token"
                    and inner_token
                    and inner_stop < end
                    and text[inner_stop] == "}"
                ):
                    tokens["{" + inner_token + "}"] += 1
                    stop = inner_stop + 1
                    buf.append(_DOT * (stop - i))
                    i = stop
                    continue
                buf.append(text[i])
                i += 1
                continue
            if kind == "token" and token:
                tokens[token] += 1
            elif kind == "broken" and not syntax:
                syntax.append(f"UNCLOSED_PLACEHOLDER at line 1, column {i + 1}")
            buf.append(_DOT * (stop - i))
            i = stop
            continue
        if text.startswith("%{", i):
            rails = _read_rails(text, i, end)
            if rails is not None:
                token, stop = rails
                tokens[token] += 1
                buf.append(_DOT * (stop - i))
                i = stop
                continue
        if text[i] == "{":
            taken = _take_complex(text, i, end, tokens, syntax, closes)
            if taken is not None:
                piece, stop = taken
                buf.append(piece)
                i = stop
                continue
            close = _close_at(closes, i, end)
            if close is not None and not _is_icu_brace(text[i + 1 : close]):
                body = _compact_unquoted(text[i + 1 : close])
                # {# mục} is an ICU pound fragment, not a placeholder.
                if body and "#" not in body:
                    tokens["{" + body + "}"] += 1
                buf.append(_DOT * (close + 1 - i))
                i = close + 1
                continue
        buf.append(text[i])
        i += 1
    return "".join(buf)


def _read_ngx(text: str, i: int, end: int) -> tuple[str, int, str | None]:
    """Classify a ``{{`` at ``i``. ``stop`` is exclusive."""
    j = i + 2
    quote: str | None = None
    while j < end:
        ch = text[j]
        if quote:
            if ch == quote:
                quote = None
            j += 1
            continue
        if ch in "'\"":
            quote = ch
            j += 1
            continue
        if ch == "{":
            return "nested", i + 1, None
        if text.startswith("}}", j):
            compact = _compact_unquoted(text[i + 2 : j])
            if not compact:
                return "empty", j + 2, None
            return "token", j + 2, "{{" + compact + "}}"
        if ch == "}":
            return "broken", j + 1, None
        j += 1
    return "broken", end, None


def _read_rails(text: str, i: int, end: int) -> tuple[str, int] | None:
    match = _RAILS.match(text, i)
    if match is None or match.end() > end:
        return None
    body = _compact_unquoted(match.group(1))
    if not body:
        return None
    return "%{" + body + "}", match.end()


def _take_complex(
    text: str,
    i: int,
    end: int,
    tokens: Counter[str],
    syntax: list[str],
    closes: list[int],
) -> tuple[str, int] | None:
    """Shield ngx placeholders inside one plural/select, preserving length."""
    head = _COMPLEX_HEAD.match(text, i)
    if not head or head.end() > end:
        return None
    if head.group("type") in ("number", "date", "time"):
        close = _close_at(closes, i, end)
        if close is None:
            return None
        return text[i : close + 1], close + 1
    buf = [text[i : head.end()]]
    j = head.end()
    offset = _OFFSET.match(text, j)
    if offset and offset.end() <= end:
        buf.append(text[j : offset.end()])
        j = offset.end()
    while j < end:
        nxt = _skip_space(text, j, end)
        if nxt != j:
            buf.append(text[j:nxt])
            j = nxt
        if j >= end:
            return None
        if text[j] == "}":
            buf.append("}")
            return "".join(buf), j + 1
        sel = _SELECTOR.match(text, j)
        if not sel or sel.end() > end:
            return None
        buf.append(text[j : sel.end()])
        j = sel.end()
        nxt = _skip_space(text, j, end)
        if nxt != j:
            buf.append(text[j:nxt])
            j = nxt
        if j >= end or text[j] != "{":
            return None
        close = _close_at(closes, j, end)
        if close is None:
            return None
        buf.append("{")
        buf.append(_shield_span(text, j + 1, close, tokens, syntax, closes))
        buf.append("}")
        j = close + 1
    return None


def _skip_space(text: str, j: int, end: int) -> int:
    while j < end and text[j].isspace():
        j += 1
    return j


def _is_icu_brace(body: str) -> bool:
    if _ICU_SIMPLE.fullmatch(body):
        return True
    return _ICU_TYPED.match("{" + body) is not None


def _compact_unquoted(body: str) -> str:
    """Drop whitespace outside quotes so ``{{ name }}`` matches ``{{name}}``."""
    out: list[str] = []
    quote: str | None = None
    for ch in body:
        if quote:
            out.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
            out.append(ch)
            continue
        if not ch.isspace():
            out.append(ch)
    return "".join(out)


def _should_report_icu(text: str, error: str) -> bool:
    """False for lone braces and balanced non-ICU text such as ``{0:C2}``."""
    if error.startswith(_TAG_ERRORS):
        return False
    if _ICU_TYPED.search(text):
        return True
    if _braces_balanced(text):
        return False
    return _has_unclosed_named_brace(text)


def _braces_balanced(text: str) -> bool:
    depth = 0
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}":
            if depth == 0:
                return False
            depth -= 1
    return depth == 0


def _has_unclosed_named_brace(text: str) -> bool:
    depth = 0
    named = False
    for index, ch in enumerate(text):
        if ch == "{":
            if _FOLLOWING_NAME.match(text, index + 1):
                named = True
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
    return named and depth > 0


def _add_plain_arguments(text: str, placeholders: Counter[str]) -> None:
    """Count finished ICU arguments a failed parse did not get to walk.

    An apostrophe immediately before ``{`` quotes the brace, matching the
    parser. ``{#...}`` is not an argument.
    """
    i = 0
    end = len(text)
    while i < end:
        if text.startswith("''", i):
            i += 2
            continue
        if text[i] == "'" and i + 1 < end and text[i + 1] == "{":
            i = _skip_icu_quote(text, i + 2, end)
            continue
        if text[i] == "{":
            match = _PLAIN_ARG.match(text, i)
            if match and match.end() <= end:
                name = match.group("name")
                type_name = match.group("type")
                if type_name is None:
                    placeholders["{" + name + "}"] += 1
                else:
                    style = (match.group("style") or "").strip()
                    if style:
                        placeholders["{" + f"{name}, {type_name}, {style}" + "}"] += 1
                    else:
                        placeholders["{" + f"{name}, {type_name}" + "}"] += 1
                i = match.end()
                continue
        i += 1


def _skip_icu_quote(text: str, i: int, end: int) -> int:
    while i < end:
        if text.startswith("''", i):
            i += 2
            continue
        if text[i] == "'":
            return i + 1
        i += 1
    return end


def _absorb_markup(markup: _Markup, full: str, view: _IcuView) -> list[str]:
    """Parse text nodes and attributes the ICU tag parser rejected.

    Text nodes are joined first. ``<b class="item">`` splits a plural into
    several nodes, and parsing each one reports a false syntax error and
    drops the plural. Attributes stay separate so an ``href`` error keeps
    its offset in ``full``.
    """
    errors: list[str] = []
    joined, origins = _join_parts(markup)
    if joined and not view.too_deep:
        try:
            _walk(parse(joined), 1, view)
        except ValueError as exc:
            message = str(exc)
            if _should_report_icu(joined, message):
                errors.append(_retarget_joined(message, full, origins))
    for offset, piece in zip(markup.attr_at, markup.attrs, strict=True):
        if not piece or view.too_deep:
            continue
        try:
            _walk(parse(piece), 1, view)
        except ValueError as exc:
            message = str(exc)
            if _should_report_icu(piece, message):
                errors.append(_retarget(message, full, offset))
    return errors


def _join_parts(markup: _Markup) -> tuple[str, list[int]]:
    chars: list[str] = []
    origins: list[int] = []
    for offset, part in zip(markup.part_at, markup.parts, strict=True):
        for index, ch in enumerate(part):
            chars.append(ch)
            origins.append(offset + index)
    return "".join(chars), origins


def _retarget(error: str, full: str, offset: int) -> str:
    code = error.split(" ", 1)[0]
    found = _ICU_COLUMN.search(error)
    if not found or found.group(1) != "1":
        return _restore_snippet(error, full)
    column = offset + int(found.group(2))
    return _syntax_error(code, column, full)


def _retarget_joined(error: str, full: str, origins: list[int]) -> str:
    code = error.split(" ", 1)[0]
    found = _ICU_COLUMN.search(error)
    if not found or found.group(1) != "1":
        return _restore_snippet(error, full)
    local = int(found.group(2))
    if origins and 1 <= local <= len(origins):
        column = origins[local - 1] + 1
    elif origins:
        column = origins[-1] + 2
    else:
        column = local
    return _syntax_error(code, column, full)


def _restore_snippet(error: str, original: str) -> str:
    """Parser errors quote the shielded text. Show the original instead."""
    head, sep, _snippet = error.partition(": ")
    if not sep:
        return error
    shown = original if len(original) <= 180 else original[:180]
    return f"{head}: {shown}"


def _syntax_error(code: str, column: int, full: str) -> str:
    shown = full if len(full) <= 180 else full[:180]
    return f"{code} at line 1, column {column}: {shown}"


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
    tags = set(rule.tags)
    if not ordinal:
        tags -= _compact_many(rule)
    return frozenset(tags)


def _compact_many(rule: object) -> frozenset[str]:
    """Drop CLDR compact ``many``. ICU uses ``other`` when that branch is absent.

    The rule is the Romance one (``e in 0`` and ``i mod 1000000``), shared by
    fr, es, it, pt, and pt-BR. Slavic ``many`` does not match and stays required.
    """
    found = re.search(r"'(.*)'", str(rule))
    if not found:
        return frozenset()
    for clause in re.split(r", (?=[a-z]+:)", found.group(1)):
        name, sep, expr = clause.partition(":")
        if sep and name.strip() == "many" and "mod 1000000" in expr and "e in 0" in expr:
            return frozenset({"many"})
    return frozenset()


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
    if error.startswith("UNCLOSED_PLACEHOLDER"):
        column = found.group(2) if found else "?"
        message = f"{label} has an unclosed {{{{ placeholder at column {column}."
    else:
        message = f"{label} is not valid ICU MessageFormat: {shown}"
    return _issue(
        "icu_syntax",
        "error",
        message,
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
        self.part_at: list[int] = []
        self.attrs: list[str] = []
        self.attr_at: list[int] = []
        self.stack: list[str] = []
        self.broken: str | None = None
        self.scan_at = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, void=tag.lower() in _VOID_TAGS)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, void=True)

    def _open(self, tag: str, attrs: list[tuple[str, str | None]], *, void: bool) -> None:
        name = tag.lower()
        self.tags[name] += 1
        raw = self.get_starttag_text() or ""
        tag_at = self.rawdata.find(raw, self.scan_at) if raw else -1
        if tag_at < 0:
            tag_at = self.scan_at
        cursor = 0
        for _key, value in attrs:
            if not value:
                continue
            found = _attr_value_at(raw, cursor, value)
            if found is None:
                self.attrs.append(value)
                self.attr_at.append(tag_at)
                continue
            value_at, cursor = found
            self.attrs.append(value)
            self.attr_at.append(tag_at + value_at)
        if raw:
            self.scan_at = tag_at + len(raw)
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
        if not data:
            return
        at = self.rawdata.find(data, self.scan_at)
        if at < 0:
            at = self.scan_at
        self.parts.append(data)
        self.part_at.append(at)
        self.scan_at = at + len(data)

    def close(self) -> None:
        if "<" in self.rawdata and self.broken is None:
            self.broken = "Unclosed tag."
        super().close()
        if self.stack and self.broken is None:
            self.broken = f"Unclosed tag <{self.stack[-1]}>."

    def result(self) -> _Markup:
        return _Markup(
            self.tags,
            self.parts,
            self.attrs,
            self.broken,
            self.part_at,
            self.attr_at,
        )


def _attr_value_at(raw: str, cursor: int, value: str) -> tuple[int, int] | None:
    """Index of ``value`` inside the raw tag, and the cursor after that occurrence."""
    for needle in (f'"{value}"', f"'{value}'", value):
        idx = raw.find(needle, cursor)
        if idx < 0:
            continue
        if needle == value:
            return idx, idx + len(value)
        return idx + 1, idx + len(needle)
    return None


def _scan_markup(text: str) -> _Markup:
    scanner = _MarkupScanner()
    try:
        scanner.feed(text)
        scanner.close()
    except Exception:
        scanner.broken = scanner.broken or "Markup could not be parsed."
    return scanner.result()
