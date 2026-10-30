"""Deterministic QA rules; no network or model calls."""

import pytest

from app.services.translation_qa import check_translation, check_translations


def codes(source, target):
    result = check_translation(source, target)
    assert result is not None
    return {issue.code for issue in result.issues}


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("Hello {name}", "Bonjour {name}"),
        ("{first} {last}", "{last} {first}"),
        ("{0} {1}", "{1} {0}"),
        ("%s %d", "%s %d"),
        ("%1$s %2$d", "%2$d %1$s"),
        ("%(name)s %(count)d", "%(count)d %(name)s"),
        ("100%% ready", "100%% prêt"),
        ("'{literal}' {name}", "'{littéral}' {name}"),
        ("Don't worry {name}", "Ne t'inquiète pas {name}"),
        ("<strong>Hello</strong><br>", "<STRONG>Bonjour</STRONG><br/>"),
        ("<0>Hello <Link>world</Link></0>", "<0>Bonjour <Link>monde</Link></0>"),
        ('<a href="{url}" title="hello">Hello</a>', '<a title="bonjour" href="{url}">Bonjour</a>'),
        ("x < 5", "x < 6"),
        ("<b>A</b><i>B</i>", "<i>B</i><b>A</b>"),
        (
            "{n, plural, one {One} other {Many}}",
            "{n, plural, few {Kilka} many {Wiele} other {Inne}}",
        ),
        ("{n, plural, one {{name}} other {{name}}}", "{n, plural, other {{name}}}"),
        (
            "{n, plural, offset:1 =0 {None} other {# people}}",
            "{n, plural, offset:1 =0 {Aucun} other {# personnes}}",
        ),
        ("{n, selectordinal, one {#st} other {#th}}", "{n, selectordinal, other {#e}}"),
        (
            "{d,date,short} {t,time} {n,number,::currency/USD}",
            "{n,number,::currency/EUR} {t,time} {d,date,long}",
        ),
        (
            "<b>{n, plural, one {One} other {Many}}</b>",
            "<b>{n, plural, few {Kilka} other {Wiele}}</b>",
        ),
        (
            "{n, plural, one {<b>One</b>} other {<i>Many</i>}}",
            "{n, plural, few {<i>Kilka</i>} other {<i>Wiele</i>}}",
        ),
        (
            "{g,select,male {{n,plural,one {One} other {Many}}} other {Other}}",
            "{g,select,male {{n,plural,other {Beaucoup}}} other {Autre}}",
        ),
        ("{n,plural,other {'#' '' {name}}}", "{n,plural,other {'#' '' {name}}}"),
    ],
)
def test_valid_structures(source, target):
    assert codes(source, target) == set()


@pytest.mark.parametrize(
    ("source", "target", "expected"),
    [
        ("Hello {name}", "Bonjour", "placeholder_missing"),
        ("Hello", "Bonjour {name}", "placeholder_extra"),
        ("{name} {name}", "{name}", "placeholder_count"),
        ("%s %s", "%s", "placeholder_missing"),
        ("%s %d", "%d %s", "placeholder_type"),
        ("%1$s", "%1$d", "placeholder_type"),
        ("%(name)s", "%(name)d", "placeholder_type"),
        ("{n,number}", "{n,date}", "placeholder_type"),
        ("Hello {name}", "Bonjour {name", "icu_syntax"),
        ("Hello", "{,plural,other {x}}", "icu_syntax"),
        ("{n,plural,other {Many}}", "{n,plural,one {One}}", "icu_syntax"),
        ("{n,plural,other {Many}}", "{n,plural,other {A} other {B}}", "icu_syntax"),
        ("{n,plural,other {Many}}", "{n,plural,other Many}", "icu_syntax"),
        ("{n,plural,other {Many}}", "{n,plural,offset:-1 other {Many}}", "icu_syntax"),
        ("{n,plural,other {Many}}", "{n,plural,offset:abc other {Many}}", "icu_syntax"),
        ("{n,plural,other {Many}}", "{n,plural,bogus {One} other {Many}}", "icu_syntax"),
        ("{n,plural,=0 {None} other {Many}}", "{n,plural,other {Many}}", "icu_structure"),
        ("{n,plural,offset:1 other {Many}}", "{n,plural,other {Many}}", "icu_structure"),
        ("{g,select,male {M} other {O}}", "{g,select,female {F} other {O}}", "icu_structure"),
        ("<b>Hello</b>", "<i>Bonjour</i>", "markup_mismatch"),
        ("<b>Hello</b>", "Bonjour", "markup_mismatch"),
        ("Hello", "<b>Bonjour</b>", "markup_mismatch"),
        ("<b>Hello</b>", "<b>Bonjour", "markup_syntax"),
        ("<b><i>Hello</i></b>", "<b><i>Bonjour</b></i>", "markup_syntax"),
        ("<0>Hello</0>", "<1>Bonjour</1>", "markup_mismatch"),
        ("<Link>Hello</Link>", "<link>Bonjour</link>", "markup_syntax"),
        ("<b>Hello</b>", "<b", "markup_syntax"),
        ('<a href="{url}">Hello</a>', '<a href="">Bonjour</a>', "placeholder_missing"),
        (
            "{n,plural,other {<i>Many</i>}}",
            "{n,plural,few {<b>Kilka</b>} other {<i>Wiele</i>}}",
            "markup_mismatch",
        ),
        ("x" * 20, "x" * 9, "length_short"),
        ("x" * 20, "x" * 41, "length_long"),
    ],
)
def test_detects_rule(source, target, expected):
    assert expected in codes(source, target)


@pytest.mark.parametrize("target", ["x" * 10, "x" * 40])
def test_length_boundaries_pass(target):
    assert codes("x" * 20, target) == set()


def test_visible_length_unicode_and_entities():
    assert codes("<b>" + "é&amp;" * 10 + "</b>{name}", "é" * 10 + "{name}<b></b>") == set()
    assert "length_short" in codes("<b>" + "é&amp;" * 10 + "</b>{name}", "é{name}<b></b>")
    assert codes("x" * 19, "x" * 100) == set()


def test_icu_length_uses_longest_branch():
    assert (
        codes(
            "{n,plural,one {" + "x" * 20 + "} other {" + "x" * 20 + "}}",
            "{n,plural,other {" + "x" * 20 + "}}",
        )
        == set()
    )


def test_empty_translations_are_not_checked():
    assert check_translation("Hello {name}", "  ") is None
    assert check_translations("", {"fr": "Bonjour"}) == {}
    assert check_translations("Hello", {"fr": "", "en": "Hello"}).keys() == {"en"}


def test_source_errors_are_attributed_without_cascading_comparison():
    result = check_translation("<b>{n,plural,one {One}}", "Bonjour")
    assert result
    assert {issue.side for issue in result.issues} == {"source"}
    assert {issue.code for issue in result.issues} == {"icu_syntax", "markup_syntax"}


def test_unsupported_syntax_is_incomplete():
    result = check_translation("{n,choice,0#None|1#One}", "Bonjour")
    assert result and not result.complete
    assert result.issues[0].code == "qa_incomplete"


def test_limits_and_determinism():
    nested = "{n,select,other {" * 66 + "Text" + "}}" * 66
    for source in [nested, "<b>" * 65 + "Text" + "</b>" * 65, "{n,plural,one {a} other {b}}" * 8]:
        result = check_translation(source, "Text")
        assert result and not result.complete
        assert "qa_incomplete" in {issue.code for issue in result.issues}
    source = " ".join("{arg" + str(i) + "}" for i in range(60))
    result = check_translation(source, "Hello")
    assert result and len(result.issues) == 50 and not result.complete
    assert result == check_translation(source, "Hello")


def test_source_is_parsed_once(monkeypatch):
    from app.services import translation_qa

    original = translation_qa.analyze
    calls = []

    def tracked(text):
        calls.append(text)
        return original(text)

    monkeypatch.setattr(translation_qa, "analyze", tracked)
    check_translations("Hello {name}", {"en": "Hi {name}", "fr": "Bonjour {name}"})
    assert calls.count("Hello {name}") == 1


def test_reordered_icu_controls_still_compare_branch_markup():
    first = "{a,select,x {<b>A</b>} other {<b>B</b>}}"
    second = "{b,select,y {<i>C</i>} other {<i>D</i>}}"
    assert codes(first + second, second + first) == set()
    assert "markup_mismatch" in codes(
        first + second, second.replace("<i>", "<em>").replace("</i>", "</em>") + first
    )


def test_historical_text_above_request_limit_is_incomplete():
    from app.limits import TEXT_MAX_LENGTH

    result = check_translation("x" * (TEXT_MAX_LENGTH + 1), "Hello")
    assert result and not result.complete
    assert result.issues[0].code == "qa_incomplete"
    assert result.issues[0].side == "source"


@pytest.mark.parametrize(
    "source,target",
    [
        ("100% complete", "100% terminé"),
        ("Save 50% off", "Économisez 50% maintenant"),
        ("Progress: 75% done", "Avancement : 75% effectué"),
    ],
)
def test_percentage_prose_is_not_a_printf_placeholder(source, target):
    assert codes(source, target) == set()


@pytest.mark.parametrize(
    "value",
    [
        "%" + "0" * 32766 + "!",
        "%" + "1" * 32766 + "!",
        "%(" * 16384,
    ],
)
def test_malformed_printf_at_text_limit_has_bounded_matching_time(value):
    from time import perf_counter

    from app.services.translation_qa import printf_tokens

    start = perf_counter()
    tokens, visible = printf_tokens(value)
    elapsed = perf_counter() - start
    assert tokens == {} and visible == value
    # Generous margin: linear scanning takes milliseconds; the old regex takes seconds.
    assert elapsed < 2


def test_printf_flags_width_precision_and_named_arguments_remain_supported():
    assert codes("%08.2f %-10s %+d %1$s %(name)s", "%(name)s %1$s %08.2f %-10s %+d") == set()
    assert "placeholder_type" in codes("%08.2f", "%08.2d")


@pytest.mark.parametrize("tag,expected", [("b", set()), ("i", {"markup_mismatch"})])
def test_plural_fallback_uses_the_matching_outer_branch(tag, expected):
    source = (
        "{g,select,a {{n,plural,one {<b>A</b>} other {<b>B</b>}}} "
        "other {{n,plural,few {<b>C</b>} other {<b>D</b>}}}}"
    )
    target = (
        "{g,select,a {{n,plural,few {<" + tag + ">A</" + tag + ">} other {<b>B</b>}}} "
        "other {{n,plural,few {<b>C</b>} other {<b>D</b>}}}}"
    )
    assert codes(source, target) == expected


def test_plural_fallback_normalizes_parent_context_before_nested_arguments():
    source = "{n,plural,other {{g,select,a {<b>A</b>} other {<b>B</b>}}}}"
    target = (
        "{n,plural,few {{g,select,a {<i>A</i>} other {<b>B</b>}}} "
        "other {{g,select,a {<b>A</b>} other {<b>B</b>}}}}"
    )
    assert codes(source, target) == {"markup_mismatch"}


def test_formatjs_treats_top_level_closing_braces_as_literal_text():
    assert codes("Hello }", "Bonjour }") == set()


@pytest.mark.parametrize(
    "source,target",
    [
        ("Hello %s, %d items", "%2$d items for %1$s"),
        ("%2$d items for %1$s", "Hello %s, %d items"),
        ("{n,plural,one {%s %d} other {%s %d}}", "{n,plural,other {%2$d %1$s}}"),
        ("<a href={url}>Open</a>", "<a href={url}>Ouvrir</a>"),
        ("<a href={url}>Open</a>", '<a href="{url}">Ouvrir</a>'),
    ],
)
def test_review_reproductions_accept_valid_formatting(source, target):
    assert codes(source, target) == set()


def test_printf_explicit_reordering_still_checks_actual_argument_types():
    assert "placeholder_type" in codes("%s %d", "%1$d %2$s")


@pytest.mark.parametrize(
    "kind,first,second",
    [
        ("plural", "offset:1 other {# items}", "offset:2 other {# items}"),
        ("select", "x {X} other {A}", "y {Y} other {B}"),
    ],
)
def test_review_reproductions_compare_icu_structure_within_its_parent(kind, first, second):
    source = "{g,select,a {{n," + kind + "," + first + "}} other {{n," + kind + "," + second + "}}}"
    target = (
        "{g,select,a {{n," + kind + "," + second + "}} other {{n," + kind + "," + second + "}}}"
    )
    assert codes(source, target) == {"icu_structure"}


def test_native_parser_budget_is_checked_before_calling_it(monkeypatch):
    from app.services import translation_qa

    calls = []
    original = translation_qa.parse

    def tracked(text, **options):
        calls.append(text)
        return original(text, **options)

    monkeypatch.setattr(translation_qa, "parse", tracked)
    source = "{n,select,other {" * 1500 + "Text" + "}}" * 1500
    result = check_translation(source, "Text")
    assert result and not result.complete
    assert source not in calls
    assert result.issues[0].code == "qa_incomplete"


def test_substitution_standins_do_not_affect_visible_length():
    assert codes("x" * 20 + " {name}", "x" * 10 + "{name}") == set()
    assert "length_short" in codes("x" * 20 + " {name}", "x" * 9 + "{name}")


@pytest.mark.parametrize("text", ["x <5", "Value must be <10", "x </5"])
def test_numeric_comparisons_are_literal_text(text):
    assert codes(text, text) == set()


def test_numbered_tags_still_require_balanced_nesting():
    assert codes("<0>Hello</0>", "<0>Bonjour</0>") == set()
    assert "markup_syntax" in codes("<0>Hello</0>", "<0>Bonjour")
    assert "markup_syntax" in codes("<0><1>Hello</1></0>", "<0><1>Bonjour</0></1>")


@pytest.mark.parametrize("changed", [False, True])
def test_formatter_types_are_compared_in_their_branch_context(changed):
    source = "{g,select,a {{value,number}} other {{value,date}}}"
    target = "{g,select,a {{value,date}} other {{value,number}}}" if changed else source
    assert codes(source, target) == ({"placeholder_type"} if changed else set())


@pytest.mark.parametrize("kind,expected", [("date", set()), ("number", {"placeholder_type"})])
def test_formatter_types_in_added_plural_categories_use_source_other(kind, expected):
    source = "{n,plural,one {{value,number}} other {{value,date}}}"
    target = "{n,plural,one {{value,number}} few {{value," + kind + "}} other {{value,date}}}"
    assert codes(source, target) == expected
    assert "markup_mismatch" in codes("<a href={url}>Open</a>", "<b>{url}</b>")
