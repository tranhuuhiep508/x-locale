"""Resource preflight tests; these also run offline with pytest --noconftest."""

import io
from xml.sax.saxutils import escape
from zipfile import ZIP_BZIP2, ZIP_DEFLATED, ZIP_LZMA, ZipFile

import pytest
from openpyxl import Workbook
from openpyxl.formula.translate import Translator

from app import excel_limits
from app.excel_limits import validate_workbook
from app.limits import TEXT_MAX_LENGTH


def archive_bytes(parts):
    raw = io.BytesIO()
    with ZipFile(raw, "w", ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return raw.getvalue()


def worksheet(body):
    return f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{body}</worksheet>'


def shared_formula_sheet(formula, count, *, index="0"):
    rows = []
    for number in range(1, count + 1):
        text = escape(formula) if number == 1 else ""
        rows.append(
            f'<row r="{number}"><c r="A{number}"><f t="shared" si="{index}">{text}</f><v>0</v></c></row>'
        )
    return worksheet(f"<sheetData>{''.join(rows)}</sheetData>")


def shared_string_table(values, *, rich=False):
    entries = []
    for value in values:
        if rich:
            middle = len(value) // 2
            content = (
                f"<r><t>{escape(value[:middle])}</t></r><r><t>{escape(value[middle:])}</t></r>"
            )
        else:
            content = f'<t xml:space="preserve">{escape(value)}</t>'
        entries.append(f"<si>{content}</si>")
    return f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{"".join(entries)}</sst>'


def shared_string_sheet(indices):
    rows = []
    for number, index in enumerate(indices, start=1):
        value = f"<v>{escape(str(index))}</v>" if index is not None else ""
        rows.append(f'<row r="{number}"><c r="A{number}" t="s">{value}</c></row>')
    return worksheet(f"<sheetData>{''.join(rows)}</sheetData>")


@pytest.mark.parametrize(
    "setting,parts,message",
    [
        ("EXCEL_MAX_MEMBERS", {"a": b"", "b": b"", "c": b""}, "archive entries"),
        ("EXCEL_MAX_MEMBER_BYTES", {"a": b"xxx"}, "expanded member bytes"),
        ("EXCEL_MAX_EXPANDED_BYTES", {"a": b"xx", "b": b"x"}, "expanded archive bytes"),
    ],
)
def test_archive_metadata_limits(monkeypatch, setting, parts, message):
    raw = archive_bytes(parts)
    monkeypatch.setattr(excel_limits, setting, 2)

    def fail_open(*_args, **_kwargs):
        raise AssertionError("Archive member opened before metadata validation")

    monkeypatch.setattr(ZipFile, "open", fail_open)
    with pytest.raises(ValueError, match=message):
        validate_workbook(raw)


@pytest.mark.parametrize("setting", ["EXCEL_MAX_MEMBER_BYTES", "EXCEL_MAX_EXPANDED_BYTES"])
def test_actual_stream_bytes_are_checked(monkeypatch, setting):
    raw = archive_bytes({"binary": b"x"})
    original = ZipFile.infolist

    def understated(archive):
        members = original(archive)
        for member in members:
            member.file_size = 1
        return members

    # The stream deliberately disagrees with the directory metadata.
    monkeypatch.setattr(ZipFile, "infolist", understated)
    monkeypatch.setattr(ZipFile, "open", lambda *_args: io.BytesIO(b"xxx"))
    monkeypatch.setattr(excel_limits, setting, 2)
    with pytest.raises(ValueError, match="expanded .* bytes"):
        validate_workbook(raw)


@pytest.mark.parametrize("kind", ["inline", "shared", "rich", "utf16", "alternate-target"])
def test_oversized_cell_text_is_rejected_while_streaming(kind):
    text = "x" * (8 * 1024 * 1024 if kind == "inline" else TEXT_MAX_LENGTH + 1)
    if kind == "shared":
        xml = shared_string_table([text])
    elif kind == "rich":
        xml = shared_string_table([text], rich=True)
    else:
        xml = worksheet(
            f'<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{text}</t></is></c></row></sheetData>'
        )
    if kind == "utf16":
        xml = xml.encode("utf-16")
    raw = archive_bytes({"part.data" if kind == "alternate-target" else "part.xml": xml})
    assert len(raw) < 20 * 1024
    with pytest.raises(ValueError, match="cell/shared-string characters"):
        validate_workbook(raw)


def test_maximum_length_rich_text_is_allowed():
    validate_workbook(
        archive_bytes(
            {
                "strings.xml": shared_string_table(
                    ["x" * 16000 + "y" * (TEXT_MAX_LENGTH - 16000)], rich=True
                )
            }
        )
    )


def test_xml_formatting_whitespace_does_not_reduce_the_text_limit():
    xml = shared_string_table(["x" * 16000 + "y" * (TEXT_MAX_LENGTH - 16000)], rich=True).replace(
        "><", ">\n<"
    )
    validate_workbook(archive_bytes({"strings.xml": xml}))


@pytest.mark.parametrize(
    "body,message",
    [
        ('<dimension ref="A1:A100001"/>', "row slots"),
        ('<dimension ref="A1:IW1"/>', "columns"),
        ('<dimension ref="A1:K100000"/>', "cell slots"),
        ('<sheetData><row r="100001"/></sheetData>', "row slots"),
        ('<sheetData><row><c r="IW1"/></row></sheetData>', "columns"),
        ('<sheetData><row><c r="A100001"/></row></sheetData>', "row slots"),
        ('<sheetData><row r="0"/></sheetData>', "row coordinate"),
        ('<dimension ref="invalid"/>', "cell coordinate"),
    ],
)
def test_dimensions_and_sparse_coordinates_are_bounded(body, message):
    with pytest.raises(ValueError, match=message):
        validate_workbook(archive_bytes({"ignored.xml": worksheet(body)}))


@pytest.mark.parametrize("kind", ["rows", "cells", "sheets", "declarations"])
def test_budgets_are_cumulative_across_sheets(monkeypatch, kind):
    if kind == "rows":
        monkeypatch.setattr(excel_limits, "EXCEL_MAX_ROWS", 3)
        parts = {f"{n}.xml": worksheet('<dimension ref="A1:A2"/>') for n in range(2)}
    elif kind == "cells":
        monkeypatch.setattr(excel_limits, "EXCEL_MAX_CELLS", 3)
        parts = {f"{n}.xml": worksheet('<dimension ref="A1:B1"/>') for n in range(2)}
    elif kind == "sheets":
        monkeypatch.setattr(excel_limits, "EXCEL_MAX_SHEETS", 1)
        parts = {f"{n}.xml": worksheet("") for n in range(2)}
    else:
        monkeypatch.setattr(excel_limits, "EXCEL_MAX_SHEETS", 1)
        parts = {"workbook.xml": "<workbook><sheets><sheet/><sheet/></sheets></workbook>"}
    with pytest.raises(ValueError, match="row slots|cell slots|worksheets"):
        validate_workbook(archive_bytes(parts))


@pytest.mark.parametrize("kind", ["rows", "cells"])
def test_repeated_or_implicit_coordinates_do_not_bypass_counts(monkeypatch, kind):
    if kind == "rows":
        monkeypatch.setattr(excel_limits, "EXCEL_MAX_ROWS", 2)
        body = '<row r="1"/>' * 3
    else:
        monkeypatch.setattr(excel_limits, "EXCEL_MAX_CELLS", 2)
        body = '<row><c r="A1"/><c r="A1"/><c r="A1"/></row>'
    with pytest.raises(ValueError, match="total .* slots"):
        validate_workbook(archive_bytes({"sheet.xml": worksheet(f"<sheetData>{body}</sheetData>")}))


@pytest.mark.parametrize(
    "xml",
    [
        '<!DOCTYPE worksheet [<!ENTITY x "expanded">]><worksheet>&x;</worksheet>',
        '<!DOCTYPE worksheet SYSTEM "file:///etc/passwd"><worksheet/>',
        "<worksheet>",
    ],
)
def test_unsafe_or_malformed_xml_is_a_validation_error(xml):
    with pytest.raises(ValueError, match="DTD|archive/XML"):
        validate_workbook(archive_bytes({"part.xml": xml}))


def test_invalid_zip_is_a_validation_error():
    with pytest.raises(ValueError, match="archive/XML"):
        validate_workbook(b"not a zip")


@pytest.mark.parametrize("compression", [ZIP_BZIP2, ZIP_LZMA])
def test_compression_with_unbounded_decoder_output_is_rejected(monkeypatch, compression):
    raw = io.BytesIO()
    with ZipFile(raw, "w", compression) as archive:
        archive.writestr("part.xml", "<a/>")

    def fail_open(*_args, **_kwargs):
        raise AssertionError("Unsafe decompressor started")

    monkeypatch.setattr(ZipFile, "open", fail_open)
    with pytest.raises(ValueError, match="stored or deflate"):
        validate_workbook(raw.getvalue())


def test_nonstandard_root_does_not_hide_worksheet_records():
    xml = worksheet('<sheetData><row r="100001"/></sheetData>')
    xml = xml.replace("worksheet", "wrapper")
    with pytest.raises(ValueError, match="row slots"):
        validate_workbook(archive_bytes({"sheet.xml": xml}))


@pytest.mark.parametrize("kind", ["relationship", "target"])
def test_reused_worksheet_references_cannot_multiply_parsing_work(kind):
    if kind == "relationship":
        parts = {
            "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet r:id="rId1"/><sheet r:id="rId1"/></sheets></workbook>'
        }
    else:
        parts = {
            "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Type="example/worksheet" Target="worksheets/sheet1.xml"/><Relationship Type="example/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>'
        }
    with pytest.raises(ValueError, match="distinct"):
        validate_workbook(archive_bytes(parts))


@pytest.mark.parametrize("title", ["strings", "_meta"])
def test_duplicate_sheet_names_with_distinct_targets_are_rejected(title):
    workbook = Workbook()
    workbook.active.title = title
    workbook.active.append(["key", "vi"])
    workbook.active.append(["hello", "Source"])
    workbook.create_sheet("alias")
    raw = io.BytesIO()
    workbook.save(raw)
    validate_workbook(raw.getvalue())
    with ZipFile(raw) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    parts["xl/workbook.xml"] = parts["xl/workbook.xml"].replace(
        b'name="alias"', f'name="{title}"'.encode()
    )
    with pytest.raises(ValueError, match="distinct names"):
        validate_workbook(archive_bytes(parts))


@pytest.mark.parametrize(
    "type_name,mode", [("styles", ""), ("comments", ""), ("worksheet", 'TargetMode="External"')]
)
@pytest.mark.parametrize("relationships_first", [False, True])
def test_declared_sheet_relationships_cannot_hide_their_type_or_mode(
    type_name, mode, relationships_first
):
    parts = {
        "xl/custom.data": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet r:id="rId1"/></sheets></workbook>',
        "xl/_rels/custom.data.rels": f'<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{type_name}" Target="/xl/worksheets/sheet1.xml" {mode}/></Relationships>',
        "xl/worksheets/sheet1.xml": worksheet(""),
    }
    if relationships_first:
        parts = dict(reversed(list(parts.items())))
    with pytest.raises(ValueError, match="internal worksheet relationships"):
        validate_workbook(archive_bytes(parts))


@pytest.mark.parametrize(
    "declaration",
    [
        '<renamed r:id="rId1"/>',
        '<sheet id="rId1"/>',
        '<sheet id="alias" r:id="rId1"/>',
        '<renamed id="rId1"/>',
    ],
)
def test_alternate_sheet_declarations_are_rejected(declaration):
    xml = f'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{declaration}</sheets></workbook>'
    with pytest.raises(ValueError, match="Invalid Excel worksheet declaration"):
        validate_workbook(archive_bytes({"xl/workbook.xml": xml}))


def test_shared_formula_expansion_is_bounded_before_translation():
    raw = archive_bytes({"sheet.xml": shared_formula_sheet('"' + "x" * 32000 + '"', 2200)})
    assert len(raw) < 30_000
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(raw)


def test_nested_relationship_cannot_spoof_a_declared_sheet_type():
    parts = {
        "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Type="example/styles" Target="worksheets/sheet1.xml"/><unused><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/spoof.xml"/></unused></Relationships>',
    }
    with pytest.raises(ValueError, match="internal worksheet relationships"):
        validate_workbook(archive_bytes(parts))


def test_decoded_text_budget_is_cumulative_across_sheets(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_DECODED_CHARACTERS", 100)
    parts = {f"{i}.xml": shared_formula_sheet('"' + "x" * 20 + '"', 3) for i in range(2)}
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(archive_bytes(parts))


@pytest.mark.parametrize(
    "lookalike",
    [
        '<fake:f xmlns:fake="urn:fake" t="shared" si="0">1</fake:f>',
        '<unused><f t="shared" si="0">1</f></unused>',
    ],
)
def test_ignored_formula_elements_cannot_poison_the_expansion_budget(lookalike):
    sheet = shared_formula_sheet('"' + "x" * 32000 + '"', 2200)
    sheet = sheet.replace(
        "<sheetData>", f'<sheetData><row r="1"><c r="A1">{lookalike}<v>0</v></c></row>'
    )
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(archive_bytes({"sheet.xml": sheet}))


@pytest.mark.parametrize(
    "body,message",
    [
        ("<row><other><v>1</v></other></row>", "row element"),
        ("<row><c><row><c/></row></c></row>", "must not be nested"),
        ('<row><c><f>1</f><f t="shared" si="0">2</f></c></row>', "at most one formula"),
    ],
)
def test_malformed_row_records_cannot_hide_shared_formula_definitions(body, message):
    with pytest.raises(ValueError, match=message):
        validate_workbook(archive_bytes({"sheet.xml": worksheet(f"<sheetData>{body}</sheetData>")}))


def test_row_extensions_are_allowed_once_after_each_rows_cells():
    body = "<row><c><v>1</v></c><extLst/></row>" * 2
    validate_workbook(archive_bytes({"sheet.xml": worksheet(f"<sheetData>{body}</sheetData>")}))


def test_foreign_extension_names_do_not_change_worksheet_state(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_SHEETS", 1)
    metadata = (
        '<m:worksheet xmlns:m="urn:metadata">'
        '<m:row r="custom-row-id"/><m:c r="custom-cell-id"/>'
        '<m:dimension ref="custom-range"/><m:si><m:t>'
        + "x"
        * (TEXT_MAX_LENGTH + 1)
        + "</m:t></m:si><m:sheets><m:sheet/><m:sheet/></m:sheets>"
        '<m:Relationship Type="example/worksheet" Target="same"/>'
        '<m:Relationship Type="example/worksheet" Target="same"/>'
        "</m:worksheet>"
    )
    body = f'<row><c><v>1</v></c><extLst><ext uri="urn:test">{metadata}</ext></extLst></row>'
    validate_workbook(archive_bytes({"sheet.xml": worksheet(f"<sheetData>{body}</sheetData>")}))


def test_foreign_extension_xml_still_counts_toward_global_limits(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_CELLS", 1)
    metadata = '<m:row xmlns:m="urn:metadata"/>' * 10
    with pytest.raises(ValueError, match="XML elements"):
        validate_workbook(
            archive_bytes(
                {
                    "sheet.xml": worksheet(
                        f'<sheetData><row><extLst><ext uri="urn:test">{metadata}</ext></extLst></row></sheetData>'
                    )
                }
            )
        )


@pytest.mark.parametrize(
    "body,message",
    [
        ("<row><c/><extLst/><extLst/></row>", "at most one extension list"),
        ("<row><extLst/><c/></row>", "must follow their cells"),
    ],
)
def test_invalid_row_extension_lists_are_rejected(body, message):
    with pytest.raises(ValueError, match=message):
        validate_workbook(archive_bytes({"sheet.xml": worksheet(f"<sheetData>{body}</sheetData>")}))


def test_row_extensions_count_toward_cell_work_budget(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_CELLS", 2)
    row = "<row><c/><extLst/></row>"
    with pytest.raises(ValueError, match="total cell slots"):
        validate_workbook(
            archive_bytes(
                {
                    "first.xml": worksheet(f"<sheetData>{row}</sheetData>"),
                    "second.xml": worksheet(f"<sheetData>{row}</sheetData>"),
                }
            )
        )


def test_row_extension_xml_still_counts_toward_depth_budget():
    body = "<row><c/><extLst>" + "<extension>" * 129 + "</extension>" * 129 + "</extLst></row>"
    with pytest.raises(ValueError, match="nesting depth"):
        validate_workbook(archive_bytes({"sheet.xml": worksheet(f"<sheetData>{body}</sheetData>")}))


@pytest.mark.parametrize(
    "formula",
    ['"literal"', "SUM(A1:B2)", "$A1+A$1+$A$1", "SUM(1:2,A:B)", "'Sheet 1'!A1", "A1", "999"],
)
def test_shared_formula_bound_covers_coordinate_growth(formula):
    bound = excel_limits._shared_formula_bound(formula)
    translated = Translator("=" + formula, "A1").translate_formula("IV100000")
    assert len(translated) <= bound
    validate_workbook(archive_bytes({"sheet.xml": shared_formula_sheet(formula, 3)}))


def test_shared_formula_redefinitions_keep_the_original_expansion_budget(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_DECODED_CHARACTERS", 100)
    sheet = shared_formula_sheet('"' + "x" * 40 + '"', 3)
    sheet = sheet.replace('<f t="shared" si="0"></f>', '<f t="shared" si="0">1</f>')
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(archive_bytes({"sheet.xml": sheet}))


def test_ordinary_cell_text_counts_toward_the_decoded_budget(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_DECODED_CHARACTERS", 5)
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(archive_bytes({"text.xml": shared_string_table(["abc", "def"])}))


@pytest.mark.parametrize("table_first", [False, True])
@pytest.mark.parametrize("rich", [False, True])
def test_shared_string_references_are_bounded_before_loading(table_first, rich):
    parts = {
        "sheet.xml": shared_string_sheet([0] * 2200),
        "shared.xml": shared_string_table([" " + "x" * 31999], rich=rich),
    }
    if table_first:
        parts = dict(reversed(list(parts.items())))
    raw = archive_bytes(parts)
    assert len(raw) < 30_000
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(raw)


def test_shared_string_reference_budget_is_cumulative_across_sheets(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_DECODED_CHARACTERS", 100)
    parts = {
        "_meta.xml": shared_string_sheet([0, 0]),
        "ignored.xml": shared_string_sheet([0, 0]),
        "shared.xml": shared_string_table(["x" * 20]),
    }
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(archive_bytes(parts))


def test_later_shorter_string_table_cannot_lower_the_bound(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_DECODED_CHARACTERS", 100)
    parts = {
        "sheet.xml": shared_string_sheet([0, 0, 0, 0]),
        "first.xml": shared_string_table(["x" * 20]),
        "second.xml": shared_string_table(["y"]),
    }
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(archive_bytes(parts))


@pytest.mark.parametrize("index", [-1, 1, "bad", "0.0"])
def test_invalid_shared_string_indices_are_validation_errors(index):
    with pytest.raises(ValueError, match="shared-string index"):
        validate_workbook(
            archive_bytes(
                {
                    "sheet.xml": shared_string_sheet([index]),
                    "shared.xml": shared_string_table(["valid"]),
                }
            )
        )


@pytest.mark.parametrize(
    "cell",
    [
        '<c t="s"><v><nested>0</nested></v></c>',
        '<c t="s"><v>0</v><v>1</v></c>',
    ],
)
def test_malformed_shared_string_indices_cannot_spoof_the_counter(cell):
    with pytest.raises(ValueError, match="shared-string index"):
        validate_workbook(
            archive_bytes({"sheet.xml": worksheet(f"<sheetData><row>{cell}</row></sheetData>")})
        )


def test_nested_shared_strings_cannot_spoof_table_indices():
    xml = shared_string_table(["valid"]).replace("</si>", "<si><t>nested</t></si></si>")
    with pytest.raises(ValueError, match="must not be nested"):
        validate_workbook(archive_bytes({"shared.xml": xml}))


def test_foreign_string_entries_cannot_shift_shared_string_indices(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_DECODED_CHARACTERS", 100)
    table = shared_string_table(["x" * 20]).replace(
        "<si>", '<fake:si xmlns:fake="urn:fake"><t>y</t></fake:si><si>', 1
    )
    with pytest.raises(ValueError, match="decoded characters"):
        validate_workbook(
            archive_bytes({"sheet.xml": shared_string_sheet([0] * 4), "shared.xml": table})
        )


def test_shared_string_metadata_is_bounded_even_for_empty_entries(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_CELLS", 1)
    with pytest.raises(ValueError, match="shared strings per part"):
        validate_workbook(archive_bytes({"shared.xml": shared_string_table(["", ""])}))


def test_empty_strings_and_absent_values_are_supported():
    validate_workbook(
        archive_bytes(
            {
                "sheet.xml": shared_string_sheet([0, "", None]),
                "shared.xml": shared_string_table([""]),
            }
        )
    )


def test_formula_cells_do_not_resolve_ignored_shared_string_caches():
    xml = worksheet('<sheetData><row><c t="s"><f>1+1</f><v>invalid-cache</v></c></row></sheetData>')
    validate_workbook(archive_bytes({"sheet.xml": xml}))


def test_duplicate_archive_member_names_are_rejected():
    raw = io.BytesIO()
    with ZipFile(raw, "w") as archive:
        archive.writestr("part.xml", "<a/>")
        with pytest.warns(UserWarning, match="Duplicate name"):
            archive.writestr("part.xml", "<b/>")
    with pytest.raises(ValueError, match="duplicate member"):
        validate_workbook(raw.getvalue())


def test_xml_nesting_is_bounded():
    with pytest.raises(ValueError, match="nesting depth"):
        validate_workbook(archive_bytes({"deep.xml": "<a>" * 129 + "</a>" * 129}))


def test_xml_element_count_is_bounded_across_parts(monkeypatch):
    monkeypatch.setattr(excel_limits, "EXCEL_MAX_CELLS", 1)
    with pytest.raises(ValueError, match="XML elements"):
        validate_workbook(
            archive_bytes({"one.xml": "<a><b/><b/><b/><b/></a>", "two.xml": "<a><b/><b/><b/></a>"})
        )


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_twenty_thousand_key_workbooks_fit(layout):
    workbook = Workbook(write_only=True)
    sheets = [
        workbook.create_sheet(name)
        for name in (["strings"] if layout == "flat" else ["auth", "home", "common"])
    ]
    for sheet in sheets:
        sheet.append(["key", "vi", "en", "fr"])
    for number in range(20000):
        sheets[number % len(sheets)].append(
            [f"key.{number}", f"Source {number}", f"English {number}", f"French {number}"]
        )
    raw = io.BytesIO()
    workbook.save(raw)
    validate_workbook(raw.getvalue())
