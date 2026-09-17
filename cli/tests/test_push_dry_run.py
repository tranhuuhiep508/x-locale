"""Unit tests for ``locale push --dry-run`` (mocked HTTP, no live API)."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch

import yaml
from typer.testing import CliRunner

from tests.conftest import strip_ansi
from x_locale_cli.app import app
from x_locale_cli.ops import push_strings
from x_locale_cli.models import Config


def _write_workspace(
    root: Path,
    *,
    locale_data: dict[str, str],
    layout: str = "flat",
    base_language: str = "vi",
) -> None:
    locales = root / "locales"
    locales.mkdir(parents=True, exist_ok=True)
    (locales / f"{base_language}.json").write_text(
        json.dumps(locale_data, ensure_ascii=False),
        encoding="utf-8",
    )
    config_dir = root / ".x-locale"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "xl_test_key",
                "output_dir": "./locales",
                "layout": layout,
                "stage": "draft",
                "base_language": base_language,
                "locales": [],
                "manifest": False,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def _sample_import_result(*, dry_run: bool = True) -> dict[str, Any]:
    return {
        "dry_run": dry_run,
        "created": 0 if dry_run else 1,
        "updated": 0 if dry_run else 1,
        "total": 3,
        "diff": {
            "create": [{"key": "local_only", "source_text": "Mới"}],
            "update": [{"key": "changed", "source_text": "Đã đổi"}],
            "orphan": [{"key": "remote_only", "source_text": "Xa"}],
            "create_count": 1,
            "update_count": 1,
            "orphan_count": 2,
        },
    }


@contextmanager
def chdir(path: Path) -> Iterator[None]:
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)


@contextmanager
def mock_strings_import(
    response: dict[str, Any] | None = None,
) -> Iterator[list[dict[str, Any]]]:
    """Patch push HTTP; record each ``request_json`` call (no real network)."""
    calls: list[dict[str, Any]] = []

    class _Client:
        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

    body = response if response is not None else _sample_import_result()

    def _request_json(
        client: object,
        method: str,
        path: str,
        *,
        action: str,
        params: dict[str, Any] | None = None,
        payload: Any = None,
    ) -> Any:
        calls.append(
            {
                "method": method,
                "path": path,
                "action": action,
                "params": dict(params or {}),
                "payload": payload,
            }
        )
        return body

    with (
        patch("x_locale_cli.ops.api_client", return_value=_Client()),
        patch("x_locale_cli.ops.request_json", side_effect=_request_json),
    ):
        yield calls


class PushDryRunCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _invoke(self, args: list[str]) -> Any:
        with chdir(self.root):
            return self.runner.invoke(app, args)

    def test_dry_run_posts_import_with_dry_run_query_flag(self) -> None:
        _write_workspace(self.root, locale_data={"hello": "Xin chào"})
        with mock_strings_import() as calls:
            result = self._invoke(["push", "--dry-run"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(len(calls), 1)
        call = calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertIn("/strings/import", call["path"])
        self.assertTrue(call["params"].get("dry_run"))
        self.assertEqual(call["payload"], {"strings": {"hello": "Xin chào"}})

    def test_dry_run_stdout_and_single_preview_request(self) -> None:
        _write_workspace(self.root, locale_data={"a": "A"})
        with mock_strings_import() as calls:
            result = self._invoke(["push", "--dry-run"])
        output = strip_ansi(result.output).lower()
        self.assertIn("dry run", output)
        self.assertIn("no changes were saved", output)
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["params"]["dry_run"])

    def test_dry_run_report_matches_live_push_shape(self) -> None:
        _write_workspace(self.root, locale_data={"a": "A"})
        with mock_strings_import():
            result = self._invoke(["push", "--dry-run"])
        text = strip_ansi(result.output)
        self.assertIn("Created", text)
        self.assertIn("Updated", text)
        self.assertIn("Unchanged", text)
        self.assertIn("On x-locale, not in local files", text)
        self.assertIn("local_only", text)
        self.assertIn("changed", text)
        self.assertIn("remote_only", text)
        self.assertIn("and 1 more", text)

    def test_modular_dry_run_sends_modules_payload(self) -> None:
        auth = self.root / "locales" / "auth"
        auth.mkdir(parents=True)
        (auth / "vi.json").write_text(
            json.dumps({"sign_in": "Đăng nhập"}),
            encoding="utf-8",
        )
        _write_workspace(self.root, locale_data={}, layout="modular")
        with mock_strings_import() as calls:
            result = self._invoke(["push", "--dry-run"])
        self.assertEqual(result.exit_code, 0, result.output)
        payload = calls[0]["payload"]
        self.assertIn("modules", payload)
        self.assertIn("auth", payload["modules"])
        self.assertTrue(calls[0]["params"]["dry_run"])


class PushDryRunOpsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_push_strings_dry_run_does_not_report_applied_counts(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"k": "v"}', encoding="utf-8")
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "xl_test_key",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "draft",
                "base_language": "vi",
            }
        )
        with mock_strings_import(_sample_import_result(dry_run=True)) as calls:
            push_strings(config, dry_run=True)
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["params"]["dry_run"])

    def test_push_without_dry_run_sends_dry_run_false(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"k": "v"}', encoding="utf-8")
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "xl_test_key",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "draft",
                "base_language": "vi",
            }
        )
        applied = _sample_import_result(dry_run=False)
        applied["created"] = 1
        applied["updated"] = 1
        with mock_strings_import(applied) as calls:
            push_strings(config, dry_run=False)
        self.assertEqual(len(calls), 1)
        self.assertFalse(calls[0]["params"]["dry_run"])
