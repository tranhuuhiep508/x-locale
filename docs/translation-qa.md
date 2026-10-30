# Translation QA

QA compares a translation's working copy with its current source using deterministic
backend checks. It never calls AI, changes translation text, or blocks Save, Apply,
or Publish for ordinary translation writes. Translation Memory Lite requires complete QA
without structural errors before accepting or applying reused text; warnings remain
advisory. See [Translation Memory Lite](translation-memory.md).

Results appear beneath translations in review and the string editor. Catalog cells
show expandable issue counts. Manual edits recheck after 400 ms or on blur. A
pending, failed, or incomplete check is distinct from a completed check without
structural findings. Model confidence is shown separately as an unverified AI
estimate; it is not a QA result or a guarantee of translation quality.

## Parsing

ICU syntax is parsed by the MIT-licensed FormatJS `icu_messageformat_parser`
Python binding (pinned to 0.1.0). It uses a Rust parser and provides Python 3.12+
stable-ABI wheels. The backend requires no Node runtime. The binding is currently
marked alpha; dependency updates must pass the QA compatibility tests. Published
wheels cover macOS and glibc Linux on x86_64/arm64, including our Python slim
container. Native Windows and musl-based Linux builds are not available in this
release.

The local adapter compares source/target arguments and branch structure, enforces
resource limits, and assigns advisory severities. It does not implement ICU grammar.
HTML/rich-text and printf checks remain separate from ICU parsing. Raw HTML tags
are passed through the ICU parser so attribute syntax and numbered component tags
are handled by their existing checks.

Syntax follows FormatJS MessageFormat 1, including treating top-level closing
braces as literal text. Number/date/time styles are not compared for equality.
Negative offsets and unknown plural category keywords remain structural findings.

## Supported rules

- Named/numbered brace arguments (`{name}`, `{0}`): identity, type and ordinary-message
  occurrence counts; arguments can move with translated text.
- Printf substitutions (`%s`, `%d`, `%1$s`, `%(name)s`, fixed flags/width/precision):
  missing/extra arguments and types. Unnumbered arguments retain their order;
  explicitly positional and named arguments can move. Translations can add explicit
  position numbers to reorder implicit source arguments. `%%` is a literal percent.
  Space flags are not inferred: percentage prose such as `100% complete` stays
  literal. Named argument keys containing parentheses or `%` are not recognized.
- ICU MessageFormat 1: nested plural, select, selectordinal, exact-number selectors,
  offsets, `other`, apostrophe quoting, and `#`. Plural categories may differ by
  language. Select keys, exact-number selectors and offsets must match the source.
  Number/date/time arguments are recognized; their style strings remain opaque.
- HTML/rich text: balanced tags, nesting, missing/extra tag names and counts, HTML
  void tags, custom component tags and numbered tags (`<0>…</0>`). Custom tag case
  matters. HTML names written entirely in lower or upper case are normalized;
  PascalCase names are treated as components. Attribute order and literal attribute
  values may differ; substitutions within attributes are checked. ICU branch
  alternatives are checked separately; additional plural categories use source
  `other` as the structural reference. Balanced fragments may move.
- Length: Unicode character counts of visible literal text, with tags and
  substitutions removed and entities decoded. Source text must have at least 20
  visible characters. Ratios strictly below 0.5 or above 2 produce advisory
  warnings. ICU uses the longest branch expansion. This is a rough heuristic,
  not a layout measurement.

Empty or whitespace-only translations stay missing and have no QA result. Invalid
source syntax is identified as a source issue, without dependent mismatch errors.

## API and lifecycle

`POST /api/projects/{project_id}/translate/qa` accepts `source_text` and a
`translations` locale-to-text map and returns a `qa` locale-to-result map. Existing
project membership/API-key access, configured-target validation, and text limits
apply. Empty sources return an empty map. This operation performs no content writes
and needs no AI credentials.

Each result contains `complete` and `issues`; issues contain `code`, `severity`
(`error` or `warning`), `side` (`source` or `translation`), and a plain-text message.
Preview/proposal responses expose the same map. Saved translation responses expose
`qa`, or null for empty translations. Old job results may omit QA and are checked
when reviewed. Clients must not send QA as part of writes or concurrency baselines.

Results are computed on demand, not stored in translation columns. Source edits,
imports, direct AI saves and restores therefore receive current findings when
strings are fetched. Published snapshots, export shapes, audit entries, and
confidence-filter thresholds are unchanged.

## Limits

QA supports the syntax above, not every interpolation dialect or full ICU formatter
semantics. Legacy ICU `choice` is explicitly incomplete. Parsing is bounded at
the existing 32,768-character text limit, 64 nesting levels, 128 rendered branch paths, and 50 reported issues per translation.
A conservative budget of 256 opening braces (including quoted literal braces) is
checked before calling the native parser to bound its recursion. Any limit being
exceeded marks the result incomplete. This prevents pathological messages
from making editing or listing strings unbounded.

There are no Markdown checks, locale-specific plural completeness rules, semantic
translation scores, sanitization, or QA filter/index. A clean result means no
structural issue was detected by the supported checks, not verified linguistic
correctness. HTML checking never renders or executes the supplied markup.
