"""Advisory structural checks for MessageFormat 1, printf and rich-text fragments.

No model calls or stored state: results always describe the supplied working copy.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from html import unescape

from icu_messageformat_parser import parse

from app.limits import TEXT_MAX_LENGTH
from app.schemas import TranslationQAIssue, TranslationQAResult

MAX_DEPTH = 64
MAX_ISSUES = 50
MAX_PATHS = 128
MAX_PARSE_BRACES = 256
# Keep substitutions nonempty for markup attributes, then omit them from visible length.
SUBSTITUTION = "\0"
type BranchContext = tuple[tuple[str, str], ...]
PRINTF = re.compile(
    r"%(?:(?P<position>\d++)\$|\((?P<name>[^()%]++)\))?"
    # Possessive repetitions prevent flags/width backtracking on malformed tokens.
    # Space flags are excluded so ordinary percentage prose stays literal.
    r"[-+#0']*+\d*+(?:\.\d++)?(?:hh|ll|[hlLjzt])?(?P<type>[diuoxXfFeEgGaAcsp])"
)
TAG = re.compile(
    r"""<(?P<close>/)?(?P<name>[A-Za-z][\w:.-]*|\d+)(?=[\s/>])(?P<attrs>(?:[^<>"']|"[^"]*"|'[^']*')*)>"""
)
TAG_START = re.compile(r"</?[A-Za-z][\w:.-]*(?=[\s/>]|$)")
ATTRIBUTE = re.compile(r"""\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'"=<>`]+))?""")
VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
HTML = VOID | frozenset(
    "a abbr address article aside audio b bdi bdo blockquote body button canvas caption cite "
    "code colgroup data datalist dd del details dfn dialog div dl dt em fieldset figcaption "
    "figure footer form h1 h2 h3 h4 h5 h6 head header hgroup html i iframe ins kbd label "
    "legend li main map mark menu meter nav noscript object ol optgroup option output p "
    "picture pre progress q rp rt ruby s samp script search section select slot small span "
    "strong style sub summary sup table tbody td template textarea tfoot th thead time title "
    "tr u ul var video".split()
)


class ParseProblem(ValueError):
    def __init__(self, message: str, *, incomplete: bool = False):
        super().__init__(message)
        self.incomplete = incomplete


@dataclass
class Argument:
    name: str
    kind: str = "simple"
    branches: dict[str, list[str | Argument]] = field(default_factory=dict)
    offset: int = 0
    context: BranchContext = ()


def message_nodes(text: str) -> tuple[list[str | Argument], list[Argument]]:
    # Bound native recursion before parsing; quoted braces also consume this budget.
    if text.count("{") > MAX_PARSE_BRACES:
        raise ParseProblem("QA message complexity limit exceeded", incomplete=True)
    try:
        ast = parse(text, ignore_tag=True, requires_other_clause=True)
    except ValueError as exc:
        detail = str(exc).split(": ", 1)[0]
        raise ParseProblem(
            f"Invalid ICU syntax: {detail}", incomplete=detail.startswith("INVALID_ARGUMENT_TYPE")
        ) from None
    arguments: list[Argument] = []
    kinds = {1: "simple", 2: "number", 3: "date", 4: "time", 5: "select", 6: "plural"}

    def convert(nodes: list[dict], context: BranchContext = (), depth: int = 0):
        if depth > MAX_DEPTH:
            raise ParseProblem("QA nesting limit exceeded", incomplete=True)
        converted: list[str | Argument] = []
        for node in nodes:
            kind = node["type"]
            if kind == 0:  # FormatJS literal
                converted.append(node["value"])
                continue
            if kind == 7:  # FormatJS pound substitution
                converted.append(SUBSTITUTION)
                continue
            if kind not in kinds:
                raise ParseProblem("Unsupported ICU node type", incomplete=True)
            arg = Argument(node["value"], kinds[kind], context=context)
            if node.get("pluralType") == "ordinal":
                arg.kind = "selectordinal"
            arg.offset = node.get("offset", 0)
            if arg.offset < 0:
                raise ParseProblem(f"Invalid plural offset for {arg.name}")
            arguments.append(arg)
            for selector, option in node.get("options", {}).items():
                if (
                    arg.kind != "select"
                    and not selector.startswith("=")
                    and selector not in {"zero", "one", "two", "few", "many", "other"}
                ):
                    raise ParseProblem(f"Invalid plural selector {selector!r} for {arg.name}")
                arg.branches[selector] = convert(
                    option["value"], context + ((arg.name, selector),), depth + 1
                )
            converted.append(arg)
        return converted

    return convert(ast), arguments


@dataclass
class Path:
    text: str = ""
    branches: tuple[tuple[BranchContext, str, str], ...] = ()


def expand(nodes: list[str | Argument]) -> list[Path]:
    paths = [Path()]
    for node in nodes:
        if isinstance(node, str):
            for path in paths:
                path.text += node
        elif node.branches:
            alternatives = [
                Path(child.text, ((node.context, node.name, selector),) + child.branches)
                for selector, body in node.branches.items()
                for child in expand(body)
            ]
            if len(paths) * len(alternatives) > MAX_PATHS:
                raise ParseProblem("QA branch-path limit exceeded", incomplete=True)
            paths = [
                Path(path.text + child.text, path.branches + child.branches)
                for path in paths
                for child in alternatives
            ]
        else:
            for path in paths:
                path.text += SUBSTITUTION
    return paths


def printf_tokens(text: str) -> tuple[Counter, str]:
    tokens: Counter = Counter()
    implicit_position = 0
    visible: list[str] = []
    pos = 0
    while pos < len(text):
        if text.startswith("%%", pos):
            visible.append("%")
            pos += 2
            continue
        match = PRINTF.match(text, pos)
        if match:
            kind = match["type"]
            identity = match["name"] or match["position"]
            if identity is None:
                implicit_position += 1
                identity = "position:" + str(implicit_position)
            else:
                identity = ("named:" if match["name"] else "position:") + identity
            tokens[("%" + identity, kind)] += 1
            pos = match.end()
        else:
            visible.append(text[pos])
            pos += 1
    return tokens, "".join(visible)


@dataclass
class Markup:
    tags: Counter
    visible: str
    errors: list[str]


def markup(text: str) -> Markup:
    tags: Counter = Counter()
    stack: list[str] = []
    errors: list[str] = []
    visible: list[str] = []
    pos = 0
    # Comments are not rendered and their apparent tags do not affect structure.
    text = re.sub(r"<!--[\s\S]*?-->", "", text)
    for match in TAG.finditer(text):
        prefix = text[pos : match.start()]
        if TAG_START.search(prefix):
            errors.append("Malformed or unfinished markup tag")
        visible.append(prefix)
        name = match["name"]
        if name.lower() in HTML and (name.islower() or name.isupper()):
            name = name.lower()
        attrs = match["attrs"]
        self_closing = attrs.rstrip().endswith("/")
        if self_closing:
            attrs = attrs.rstrip()[:-1]
        if match["close"]:
            if attrs.strip() or self_closing:
                errors.append(f"Malformed closing tag </{name}>")
            if not stack:
                errors.append(f"Unexpected closing tag </{name}>")
            elif stack[-1] != name:
                errors.append(f"Closing tag </{name}> does not match <{stack[-1]}>")
                stack.pop()
            else:
                stack.pop()
        else:
            attr_pos = 0
            while attr_pos < len(attrs) and attrs[attr_pos:].strip():
                attr = ATTRIBUTE.match(attrs, attr_pos)
                if attr is None:
                    errors.append(f"Malformed attributes on <{name}>")
                    break
                attr_pos = attr.end()
            tags[name] += 1
            if not self_closing and name not in VOID:
                stack.append(name)
                if len(stack) > MAX_DEPTH:
                    raise ParseProblem("QA markup nesting limit exceeded", incomplete=True)
        pos = match.end()
    suffix = text[pos:]
    if TAG_START.search(suffix):
        errors.append("Malformed or unfinished markup tag")
    visible.append(suffix)
    if stack:
        errors.append(f"Unclosed tag <{stack[-1]}>")
    return Markup(tags, unescape("".join(visible)).replace(SUBSTITUTION, "").strip(), errors)


@dataclass
class Analysis:
    arguments: list[Argument] = field(default_factory=list)
    paths: list[Path] = field(default_factory=list)
    markup: list[Markup] = field(default_factory=list)
    placeholders: Counter = field(default_factory=Counter)
    printf_arguments: list[Counter] = field(default_factory=list)
    issues: list[tuple[str, str, str]] = field(default_factory=list)
    complete: bool = True
    syntax_valid: bool = True


def analyze(text: str) -> Analysis:
    result = Analysis()
    if len(text) > TEXT_MAX_LENGTH:
        # Historical stored values can predate the request-size cap.
        return Analysis(
            complete=False,
            syntax_valid=False,
            issues=[("qa_incomplete", "warning", "Text exceeds the QA character limit")],
        )
    try:
        nodes, result.arguments = message_nodes(text)
        result.paths = expand(nodes)
    except ParseProblem as exc:
        result.syntax_valid = False
        result.complete = not exc.incomplete
        result.issues.append(
            (
                "qa_incomplete" if exc.incomplete else "icu_syntax",
                "warning" if exc.incomplete else "error",
                str(exc),
            )
        )
        # Independent HTML/printf checks still run on malformed ICU text.
        result.paths = [Path(text)]
    for arg in result.arguments:
        result.placeholders[("{" + arg.name + "}", arg.kind)] += 1
    # Keep alternative branches separate: category count differs between locales.
    for path in result.paths:
        tokens, visible = printf_tokens(path.text)
        result.printf_arguments.append(tokens)
        for token, count in tokens.items():
            result.placeholders[token] = max(result.placeholders[token], count)
        try:
            fragment = markup(visible)
            result.markup.append(fragment)
            result.issues.extend(("markup_syntax", "error", error) for error in fragment.errors)
        except ParseProblem as exc:
            result.complete = False
            result.issues.append(("qa_incomplete", "warning", str(exc)))
            result.markup.append(Markup(Counter(), "", [str(exc)]))
    return result


def compare(source: Analysis, target: Analysis) -> TranslationQAResult:
    issues = [
        TranslationQAIssue(code=code, severity=severity, side=side, message=message)
        for side, analysis in (("source", source), ("translation", target))
        for code, severity, message in analysis.issues
    ]

    def add(code: str, message: str, severity: str = "error") -> None:
        issues.append(
            TranslationQAIssue(code=code, severity=severity, side="translation", message=message)
        )

    # A target-only plural category is checked against the source's other branch.
    source_branches: dict[tuple[BranchContext, str], set[str]] = {}
    for arg in source.arguments:
        source_branches.setdefault((arg.context, arg.name), set()).update(arg.branches)

    def normalize_context(context: BranchContext) -> BranchContext:
        normalized_context: BranchContext = ()
        for parent_name, parent_key in context:
            selectors = source_branches.get((normalized_context, parent_name), set())
            normalized_context += (
                (parent_name, parent_key if parent_key in selectors else "other"),
            )
        return normalized_context

    def normalize_branch(context: BranchContext, name: str, key: str):
        context = normalize_context(context)
        selectors = source_branches.get((context, name), set())
        return context, name, key if key in selectors else "other"

    if source.syntax_valid and target.syntax_valid:
        source_names = {name for name, _ in source.placeholders}
        target_names = {name for name, _ in target.placeholders}
        for name in sorted(source_names - target_names):
            add("placeholder_missing", f"Missing placeholder {name}")
        for name in sorted(target_names - source_names):
            add("placeholder_extra", f"Unexpected placeholder {name}")
        complex_message = any(arg.branches for arg in source.arguments + target.arguments)
        for name in sorted(source_names & target_names):
            expected = {kind for token, kind in source.placeholders if token == name}
            actual = {kind for token, kind in target.placeholders if token == name}
            if expected != actual:
                add("placeholder_type", f"Placeholder {name} has an incompatible argument type")
            elif not complex_message and any(
                source.placeholders[(name, kind)] != target.placeholders[(name, kind)]
                for kind in expected
            ):
                add("placeholder_count", f"Placeholder {name} has a different occurrence count")
        for arg in target.arguments:
            candidates = [
                item
                for item in source.arguments
                if item.name == arg.name and item.context == normalize_context(arg.context)
            ]
            if candidates and not any(item.kind == arg.kind for item in candidates):
                add(
                    "placeholder_type",
                    f"Placeholder {{{arg.name}}} has an incompatible argument type",
                )
            candidates = [item for item in candidates if item.kind == arg.kind]
            if not candidates or not arg.branches:
                continue
            keys = set(arg.branches)
            if not any(
                item.offset == arg.offset
                and (
                    set(item.branches) == keys
                    if arg.kind == "select"
                    else {key for key in item.branches if key.startswith("=")}
                    == {key for key in keys if key.startswith("=")}
                )
                for item in candidates
            ):
                add("icu_structure", f"ICU argument {arg.name} changed selectors or plural offset")

    if source.syntax_valid and target.syntax_valid:
        for index, path in enumerate(target.paths):
            normalized = sorted(
                normalize_branch(context, name, key) for context, name, key in path.branches
            )
            candidates = [
                i for i, item in enumerate(source.paths) if sorted(item.branches) == normalized
            ]
            if not candidates and len(source.paths) == 1:
                candidates = [0]
            if not candidates:
                continue
            actual = target.markup[index]
            if actual.errors:
                continue
            valid = [i for i in candidates if not source.markup[i].errors]
            if valid and not any(source.markup[i].tags == actual.tags for i in valid):
                add(
                    "markup_mismatch",
                    "HTML or rich-text tag names or counts differ from the source",
                )
            if valid and not any(
                source.printf_arguments[i] == target.printf_arguments[index] for i in valid
            ):
                # Identity/type checks already explain a missing or changed token.
                if source.placeholders == target.placeholders:
                    add(
                        "placeholder_order",
                        "Printf argument positions or types changed in an ICU branch",
                    )

    if source.syntax_valid and target.syntax_valid and source.complete and target.complete:
        source_length = max((len(item.visible) for item in source.markup), default=0)
        target_length = max((len(item.visible) for item in target.markup), default=0)
        if source_length >= 20 and target_length < source_length / 2:
            add(
                "length_short",
                "Translation is less than half the source's visible length",
                "warning",
            )
        elif source_length >= 20 and target_length > source_length * 2:
            add(
                "length_long",
                "Translation is more than twice the source's visible length",
                "warning",
            )

    unique = list({(issue.side, issue.code, issue.message): issue for issue in issues}.values())
    complete = source.complete and target.complete
    if len(unique) > MAX_ISSUES:
        complete = False
        unique = unique[: MAX_ISSUES - 1] + [
            TranslationQAIssue(
                code="qa_incomplete",
                severity="warning",
                side="translation",
                message="QA issue limit exceeded",
            )
        ]
    return TranslationQAResult(issues=unique, complete=complete)


def check_translations(
    source_text: str, translations: dict[str, str]
) -> dict[str, TranslationQAResult]:
    if not source_text.strip():
        return {}
    populated = {locale: value for locale, value in translations.items() if value.strip()}
    if not populated:
        return {}
    source = analyze(source_text)
    return {locale: compare(source, analyze(value)) for locale, value in populated.items()}


def check_translation(source_text: str, translation: str) -> TranslationQAResult | None:
    return check_translations(source_text, {"target": translation}).get("target")
