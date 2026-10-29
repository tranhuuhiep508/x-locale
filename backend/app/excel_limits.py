"""Bound XLSX archives, then validate the parts openpyxl will actually read."""

from __future__ import annotations

import io
import posixpath
import re
import zlib
from dataclasses import dataclass
from xml.etree import ElementTree as ET
from xml.parsers import expat
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

from openpyxl.formula.tokenizer import Token, Tokenizer, TokenizerError
from openpyxl.xml.constants import XLSM, XLSX, XLTM, XLTX

from app.limits import (
    EXCEL_MAX_CELLS,
    EXCEL_MAX_COLUMNS,
    EXCEL_MAX_DECODED_CHARACTERS,
    EXCEL_MAX_EXPANDED_BYTES,
    EXCEL_MAX_MEMBER_BYTES,
    EXCEL_MAX_MEMBERS,
    EXCEL_MAX_ROWS,
    EXCEL_MAX_SHEETS,
    TEXT_MAX_LENGTH,
)

_S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_P = "http://schemas.openxmlformats.org/package/2006/relationships}"
_CT = "http://schemas.openxmlformats.org/package/2006/content-types}"
_CHUNK_BYTES = 16 * 1024
_COORDINATE = re.compile(r"([A-Za-z]{1,3})([1-9][0-9]{0,6})\Z")


def _check(value: int, limit: int, label: str) -> None:
    if value > limit:
        raise ValueError(f"Excel {label} must be at most {limit}")


def _require(condition: bool, label: str) -> None:
    if not condition:
        raise ValueError(f"Invalid Excel {label}")


@dataclass
class _Budget:
    rows: int = 0
    cells: int = 0
    elements: int = 0
    characters: int = 0

    def add_text(self, length: int) -> None:
        self.characters += length
        _check(self.characters, EXCEL_MAX_DECODED_CHARACTERS, "decoded characters")


def _reject_declaration(*_args):
    raise ValueError("Excel XML must not contain DTD or entity declarations")


def _archive(archive: ZipFile, budget: _Budget) -> dict[str, str]:
    members = archive.infolist()
    _check(len(members), EXCEL_MAX_MEMBERS, "archive entries")
    names = [member.filename for member in members]
    _require(len(names) == len(set(names)), "archive: duplicate member names")
    _check(sum(m.file_size for m in members), EXCEL_MAX_EXPANDED_BYTES, "expanded archive bytes")
    for member in members:
        name = member.filename.rstrip("/")
        _require(
            bool(name)
            and not name.startswith("/")
            and "\\" not in name
            and posixpath.normpath(name) == name
            and not name.startswith("../")
            and name not in {".", ".."},
            "archive member path",
        )
        _check(member.file_size, EXCEL_MAX_MEMBER_BYTES, "expanded member bytes")
        _require(
            member.compress_type in {ZIP_STORED, ZIP_DEFLATED}, "compression: use stored or deflate"
        )

    roots = {}
    total = 0
    for member in members:
        depth = 0

        def start(name, _attrs, path=member.filename):
            nonlocal depth
            if depth == 0:
                roots[path] = name
            depth += 1
            _check(depth, 128, "XML nesting depth")
            budget.elements += 1
            _check(budget.elements, EXCEL_MAX_CELLS * 8, "XML elements")

        def end(_name):
            nonlocal depth
            depth -= 1

        parser = expat.ParserCreate(namespace_separator="}")
        parser.StartElementHandler, parser.EndElementHandler = start, end
        parser.StartDoctypeDeclHandler = parser.EntityDeclHandler = _reject_declaration
        parser.ExternalEntityRefHandler = _reject_declaration
        xml = member.filename.lower().endswith((".xml", ".rels"))
        sniffed, size = xml, 0
        with archive.open(member) as stream:
            while chunk := stream.read(_CHUNK_BYTES):
                size += len(chunk)
                total += len(chunk)
                _check(size, EXCEL_MAX_MEMBER_BYTES, "expanded member bytes")
                _check(total, EXCEL_MAX_EXPANDED_BYTES, "expanded archive bytes")
                if not sniffed and (prefix := chunk.lstrip()):
                    sniffed = True
                    xml = prefix.startswith(
                        (
                            b"<",
                            b"\xef\xbb\xbf",
                            b"\xff\xfe",
                            b"\xfe\xff",
                            b"\x00<",
                            b"\x00\x00\xfe\xff",
                        )
                    )
                if xml:
                    parser.Parse(chunk, False)
        if xml:
            parser.Parse(b"", True)
    return roots


def _package(archive: ZipFile, roots: dict[str, str]) -> tuple[list[str], str | None]:
    def tree(path: str, root: str):
        _require(roots.get(path) == root, f"{path} root")
        return ET.fromstring(archive.read(path))

    manifest = tree("[Content_Types].xml", _CT + "Types")
    overrides = {}
    for child in manifest:
        _require(
            child.tag in {"{" + _CT + "Default", "{" + _CT + "Override"}, "content-type declaration"
        )
        if child.tag == "{" + _CT + "Override":
            part = child.get("PartName", "")
            _require(part.startswith("/") and part not in overrides, "content-type part")
            overrides[part] = child.get("ContentType")
    workbooks = [p[1:] for p, kind in overrides.items() if kind in {XLSX, XLSM, XLTM, XLTX}]
    strings = [
        p[1:]
        for p, kind in overrides.items()
        if kind == "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
    ]
    _require(len(workbooks) == 1 and len(strings) <= 1, "workbook/shared-string declarations")
    workbook = workbooks[0]
    root = tree(workbook, _S + "workbook")
    # openpyxl matches workbook child names without their namespaces. Require one
    # canonical declaration so it cannot select a different sheets list.
    tags = [child.tag for child in root]
    _require(
        all(tag.startswith("{" + _S) for tag in tags) and len(tags) == len(set(tags)),
        "workbook structure",
    )
    sheets = root.find("{" + _S + "sheets")
    _require(sheets is not None, "worksheet declarations")
    _check(len(sheets), EXCEL_MAX_SHEETS, "worksheets")
    folder, filename = posixpath.split(workbook)
    relationships = tree(posixpath.join(folder, "_rels", filename + ".rels"), _P + "Relationships")
    rels = {}
    for rel in relationships:
        _require(rel.tag == "{" + _P + "Relationship" and len(rel) == 0, "relationship declaration")
        identity = rel.get("Id")
        _require(bool(identity) and identity not in rels, "relationships: distinct IDs required")
        rels[identity] = rel.attrib
    targets, names, ids = [], set(), set()
    for sheet in sheets:
        _require(
            sheet.tag == "{" + _S + "sheet" and "id" not in sheet.attrib, "worksheet declaration"
        )
        title, identity = sheet.get("name"), sheet.get("{" + _R + "}id")
        _require(bool(title) and title not in names, "worksheets: distinct names required")
        _require(
            bool(identity) and identity not in ids, "worksheets: distinct relationships required"
        )
        names.add(title)
        ids.add(identity)
        rel = rels.get(identity, {})
        _require(
            rel.get("Type") == _R + "/worksheet"
            and rel.get("TargetMode", "Internal") == "Internal",
            "internal worksheet relationships",
        )
        target = rel.get("Target", "")
        _require(
            bool(target)
            and not target.startswith("//")
            and (not target.startswith("/") or posixpath.normpath(target) == target),
            "worksheet target path",
        )
        path = posixpath.normpath(posixpath.join("/" + folder, target)).lstrip("/")
        _require(path not in targets, "worksheets: distinct targets required")
        _require(roots.get(path) == _S + "worksheet", "worksheet root")
        targets.append(path)
    shared = strings[0] if strings else None
    if shared:
        _require(roots.get(shared) == _S + "sst", "shared-string root")
    return targets, shared


def _coordinate(value: str) -> tuple[int, int]:
    match = _COORDINATE.fullmatch(value)
    _require(match is not None, "cell coordinate")
    column = 0
    for letter in match[1].upper():
        column = column * 26 + ord(letter) - ord("A") + 1
    return int(match[2]), column


def _shared_formula_bound(formula: str) -> int:
    try:
        tokens = Tokenizer("=" + formula).items
    except TokenizerError as exc:
        raise ValueError("Invalid Excel shared formula") from exc
    growth = sum(
        7 * len(re.findall(r"[A-Za-z]+|[0-9]+", token.value))
        for token in tokens
        if token.type == Token.OPERAND and token.subtype == Token.RANGE
    )
    return len(formula) + 1 + growth


def _content(
    archive: ZipFile, path: str, budget: _Budget, strings: list[int], *, shared=False
) -> None:
    """Check a known worksheet or string table, rejecting misplaced records."""
    stack = []
    rows = cells = max_row = max_col = row = column = extensions = 0
    cell = None
    entry_length = 0
    leaf = None
    text_parts = []
    formulae = {}
    row_extension = False

    def grid():
        _check(max_col, EXCEL_MAX_COLUMNS, "columns")
        slots = max(rows, max_row)
        _check(budget.rows + slots, EXCEL_MAX_ROWS, "total row slots")
        _check(
            budget.cells + max(slots * max_col, cells) + extensions,
            EXCEL_MAX_CELLS,
            "total cell slots",
        )

    def start(name, attrs):
        nonlocal rows, cells, max_row, max_col, row, column, extensions
        nonlocal cell, entry_length, leaf, text_parts, row_extension
        parent = stack[-1] if stack else None
        name = name.removeprefix(_S) if name.startswith(_S) else name
        _require(leaf is None, "cell/shared-string text structure")
        if shared:
            if name == "si":
                _require(stack == ["sst"], "shared-string entry structure")
                entry_length = 0
            if parent == "sst":
                _require(name == "si", "shared-string entry structure")
        else:
            positions = {
                "dimension": ["worksheet"],
                "sheetData": ["worksheet"],
                "row": ["worksheet", "sheetData"],
                "c": ["worksheet", "sheetData", "row"],
            }
            if name in positions:
                _require(stack == positions[name], "worksheet record structure")
            if parent == "row":
                _require(name in {"c", "extLst"} and not row_extension, "worksheet row structure")
                if name == "extLst":
                    row_extension = True
                    extensions += 1
                    grid()
            if parent == "c":
                _require(name in {"f", "v", "is", "extLst"}, "worksheet cell structure")
                _require(name not in cell["children"], "duplicate cell element")
                cell["children"].add(name)
            if name == "dimension":
                for point in attrs.get("ref", "A1").split(":"):
                    r, c = _coordinate(point)
                    max_row, max_col = max(max_row, r), max(max_col, c)
            elif name == "row":
                rows += 1
                row, column = int(attrs.get("r", row + 1)), 0
                _require(row > 0, "row coordinate")
                max_row = max(max_row, row)
                row_extension = False
            elif name == "c":
                cells += 1
                r, column = _coordinate(attrs["r"]) if "r" in attrs else (row, column + 1)
                max_row, max_col = max(max_row, r), max(max_col, column)
                cell = {"type": attrs.get("t"), "children": set(), "value": "", "formula": None}
                entry_length = 0
            if name in positions:
                grid()
            if name in {"f", "v"}:
                _require(parent == "c", "cell value/formula structure")
            if name == "f":
                cell["formula"] = attrs
        # Text.from_tree also matches rich text by local name. Count those same
        # leaves, without charging pretty-print whitespace between fragments.
        if (cell is not None or shared and "si" in stack) and name.rsplit("}", 1)[-1] in {
            "t",
            "v",
            "f",
        }:
            leaf, text_parts = name, []
        stack.append(name)

    def text(value):
        nonlocal entry_length
        if leaf is not None:
            entry_length += len(value)
            _check(entry_length, TEXT_MAX_LENGTH, "cell/shared-string characters")
            budget.add_text(len(value))
            if leaf in {"f", "v"}:
                text_parts.append(value)

    def end(_name):
        nonlocal leaf, cell
        name = stack.pop()
        if name == leaf:
            value = "".join(text_parts)
            if not shared and name == "v":
                cell["value"] = value
            if not shared and name == "f" and cell["formula"].get("t") == "shared":
                identity = cell["formula"].get("si")
                if identity not in formulae and value:
                    formulae[identity] = _shared_formula_bound(value)
                budget.add_text(max(formulae.get(identity, 1) - len(value), 0))
            leaf = None
        if shared and name == "si":
            _check(len(strings) + 1, EXCEL_MAX_CELLS, "shared strings per part")
            strings.append(entry_length)
        if not shared and name == "c":
            if cell["type"] == "s" and cell["formula"] is None and cell["value"]:
                try:
                    index = int(cell["value"])
                except ValueError as exc:
                    raise ValueError("Invalid Excel shared-string index") from exc
                _require(0 <= index < len(strings), "shared-string index")
                budget.add_text(strings[index])
            cell = None

    parser = expat.ParserCreate(namespace_separator="}")
    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = (
        start,
        end,
        text,
    )
    with archive.open(path) as stream:
        while chunk := stream.read(_CHUNK_BYTES):
            parser.Parse(chunk, False)
    parser.Parse(b"", True)
    if not shared:
        budget.rows += max(rows, max_row)
        budget.cells += max(max(rows, max_row) * max_col, cells) + extensions


def validate_workbook(raw: bytes) -> None:
    """Validate the immutable package before openpyxl loads it or imports write."""
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            budget = _Budget()
            roots = _archive(archive, budget)
            sheets, shared = _package(archive, roots)
            strings = []
            if shared:
                _content(archive, shared, budget, strings, shared=True)
            for path in sheets:
                _content(archive, path, budget, strings)
    except (
        BadZipFile,
        expat.ExpatError,
        ET.ParseError,
        EOFError,
        RuntimeError,
        NotImplementedError,
        zlib.error,
    ) as exc:
        raise ValueError("Invalid or unsupported Excel archive/XML") from exc
