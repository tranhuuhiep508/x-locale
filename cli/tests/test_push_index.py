"""Tests for push-index delta push and pull index refresh."""

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

import httpx

from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import Config, PulledFileReport
from x_locale_cli.ops import pull_translations, push_strings
from x_locale_cli.push_index import (
    catalog_hashes_flat,
    hash_base_value,
    load_push_index,
    normalize_api_origin,
    pending_file_path,
    push_pending_is_active,
    scope_from_config,
)


def _write_config(
    root: Path,
    *,
    layout: str = "flat",
    api_url: str = "http://127.0.0.1:8000",
    output_rel: str = "./locales",
) -> Path:
    config_dir = root / ".x-locale"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "api_url": api_url,
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "xl_test_key",
                "output_dir": output_rel,
                "layout": layout,
                "stage": "draft",
                "base_language": "vi",
                "locales": [],
                "manifest": False,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return config_dir


@contextmanager
def chdir(path: Path) -> Iterator[None]:
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)


def _import_ok(*, dry_run: bool = False) -> dict[str, Any]:
    return {
        "dry_run": dry_run,
        "created": 0 if dry_run else 1,
        "updated": 0,
        "total": 1,
        "diff": {
            "create": [],
            "update": [],
            "orphan": [],
            "create_count": 0,
            "update_count": 0,
            "orphan_count": 0,
        },
    }


class PushIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_trailing_slash_origin_matches(self) -> None:
        self.assertEqual(
            normalize_api_origin("http://127.0.0.1:8000/"),
            normalize_api_origin("http://127.0.0.1:8000"),
        )

    def test_empty_delta_skips_api_and_writes_index_after_prior_push(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text(json.dumps({"a": "A", "b": "B"}), encoding="utf-8")
        _write_config(self.root)
        calls: list[dict[str, Any]] = []

        def _request(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            calls.append({"params": dict(params or {}), "payload": payload})
            return _import_ok(dry_run=False)

        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )
        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=False)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("partial", calls[0]["params"])
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            calls.clear()
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=False)
            self.assertEqual(len(calls), 0)
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            self.assertEqual(len(loaded.entries), 2)

    def test_delta_sends_partial_and_merges_index(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        path = locales / "vi.json"
        path.write_text(json.dumps({"k": "v1"}), encoding="utf-8")
        _write_config(self.root)
        calls: list[dict[str, Any]] = []

        def _request(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            calls.append({"params": dict(params or {}), "payload": payload})
            return _import_ok(dry_run=False)

        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )
        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=False)
            path.write_text(json.dumps({"k": "v2", "other": "x"}), encoding="utf-8")
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=False)
            self.assertEqual(len(calls), 2)
            delta = calls[1]
            self.assertTrue(delta["params"].get("partial"))
            self.assertEqual(delta["payload"], {"strings": {"k": "v2", "other": "x"}})
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.entries["k"], hash_base_value("v2"))
            self.assertEqual(loaded.entries["other"], hash_base_value("x"))

    def test_full_push_omits_partial(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"a":"A"}', encoding="utf-8")
        _write_config(self.root)
        # Pre-seed index so a delta would otherwise be used
        scope = scope_from_config(
            Config.from_dict(
                {
                    "api_url": "http://127.0.0.1:8000",
                    "project_id": "22222222-2222-2222-2222-222222222222",
                    "api_key": "k",
                    "output_dir": str(locales),
                    "layout": "flat",
                    "base_language": "vi",
                }
            )
        )
        config_dir = self.root / ".x-locale"
        config_dir.mkdir(parents=True, exist_ok=True)
        (config_dir / "push-index.json").write_text(
            json.dumps(
                {
                    **scope.__dict__,
                    "entries": catalog_hashes_flat({"a": "A"}),
                }
            ),
            encoding="utf-8",
        )
        calls: list[dict[str, Any]] = []

        def _request(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            calls.append({"params": dict(params or {})})
            return _import_ok(dry_run=False)

        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )
        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, full=True)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("partial", calls[0]["params"])

    def test_draft_pull_updates_flat_index(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text("{}", encoding="utf-8")
        _write_config(self.root)
        export = {"vi": {"remote": "text"}}
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "draft",
                "base_language": "vi",
            }
        )

        class _Client:
            def __enter__(self) -> _Client:
                return self

            def __exit__(self, *exc: object) -> bool:
                return False

        def _request_json(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            if "export" in path:
                return export
            return {"pending_remove": [], "tombstones": []}

        with chdir(self.root):
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            ):
                pull_translations(config)
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.entries["remote"], hash_base_value("text"))
            self.assertFalse(push_pending_is_active())

    def test_pending_marker_forces_full_push_without_partial(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text(json.dumps({"a": "A"}), encoding="utf-8")
        _write_config(self.root)
        config_dir = self.root / ".x-locale"
        config_dir.mkdir(parents=True, exist_ok=True)
        scope = scope_from_config(
            Config.from_dict(
                {
                    "api_url": "http://127.0.0.1:8000",
                    "project_id": "22222222-2222-2222-2222-222222222222",
                    "api_key": "k",
                    "output_dir": str(locales),
                    "layout": "flat",
                    "base_language": "vi",
                }
            )
        )
        calls: list[dict[str, Any]] = []

        def _request(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            calls.append({"params": dict(params or {}), "payload": payload})
            return _import_ok(dry_run=False)

        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )
        with chdir(self.root):
            (config_dir / "push-index.json").write_text(
                json.dumps({**scope.__dict__, "entries": catalog_hashes_flat({"a": "A"})}),
                encoding="utf-8",
            )
            pending_file_path().write_text("", encoding="utf-8")
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=False)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("partial", calls[0]["params"])
            self.assertEqual(calls[0]["payload"], {"strings": {"a": "A"}})

    def test_preexisting_marker_survives_allowlisted_4xx(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"a":"A"}', encoding="utf-8")
        _write_config(self.root)
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )

        def _conflict(*_a: object, **_k: object) -> Any:
            response = httpx.Response(409, request=httpx.Request("POST", "http://x"))
            raise XLocaleError("Push failed (409): conflict") from httpx.HTTPStatusError(
                "conflict",
                request=response.request,
                response=response,
            )

        with chdir(self.root):
            pending_file_path().write_text("", encoding="utf-8")
            with patch("x_locale_cli.ops.request_json", side_effect=_conflict):
                with self.assertRaises(XLocaleError):
                    push_strings(config, dry_run=False)
            self.assertTrue(push_pending_is_active())

    def test_new_marker_cleared_on_allowlisted_4xx(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"a":"A"}', encoding="utf-8")
        _write_config(self.root)
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )

        def _conflict(*_a: object, **_k: object) -> Any:
            response = httpx.Response(409, request=httpx.Request("POST", "http://x"))
            raise XLocaleError("Push failed (409): conflict") from httpx.HTTPStatusError(
                "conflict",
                request=response.request,
                response=response,
            )

        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_conflict):
                with self.assertRaises(XLocaleError):
                    push_strings(config, dry_run=False)
            self.assertFalse(push_pending_is_active())

    def test_dry_run_with_pending_does_not_clear_marker(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"a":"A"}', encoding="utf-8")
        _write_config(self.root)
        calls: list[Any] = []

        def _request(*_a: object, **_k: object) -> Any:
            calls.append(1)
            return _import_ok(dry_run=True)

        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "base_language": "vi",
            }
        )
        with chdir(self.root):
            pending_file_path().write_text("", encoding="utf-8")
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=True)
            self.assertTrue(push_pending_is_active())
            self.assertIsNone(load_push_index(config))
            self.assertEqual(len(calls), 1)

    def test_pull_write_failure_keeps_pending_marker(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text("{}", encoding="utf-8")
        _write_config(self.root)
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "draft",
                "base_language": "vi",
            }
        )
        export = {"vi": {"k": "v"}}

        class _Client:
            def __enter__(self) -> _Client:
                return self

            def __exit__(self, *exc: object) -> bool:
                return False

        def _request_json(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            if "export" in path:
                return export
            return {"pending_remove": [], "tombstones": []}

        def _boom(*_a: object, **_k: object) -> PulledFileReport:
            raise OSError("disk full")

        with chdir(self.root):
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
                patch("x_locale_cli.ops.write_locale_file_reported", side_effect=_boom),
            ):
                with self.assertRaises(OSError):
                    pull_translations(config)
            self.assertTrue(push_pending_is_active())
