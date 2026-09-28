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
from x_locale_cli.io import scoped_key
from x_locale_cli.push_index import (
    catalog_hashes_flat,
    hash_base_value,
    index_file_path,
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
    stage: str = "draft",
    locales: list[str] | None = None,
    manifest: bool = False,
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
                "stage": stage,
                "base_language": "vi",
                "locales": list(locales or []),
                "manifest": manifest,
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


def _http_status_error(status: int, message: str = "error") -> Any:
    def _raise(*_a: object, **_k: object) -> Any:
        response = httpx.Response(status, request=httpx.Request("POST", "http://x"))
        raise XLocaleError(f"Push failed ({status}): {message}") from httpx.HTTPStatusError(
            message,
            request=response.request,
            response=response,
        )

    return _raise


def _request_transport_error(*_a: object, **_k: object) -> Any:
    request = httpx.Request("POST", "http://x")
    raise XLocaleError("Push failed: timeout") from httpx.RequestError("timeout", request=request)


def _json_decode_error(*_a: object, **_k: object) -> Any:
    raise json.JSONDecodeError("Expecting value", "", 0)


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

        def _boom(*_a: object, **_k: object) -> Any:
            raise OSError("disk full")

        with chdir(self.root):
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text('{"entries":{"keep":"abc"}}\n', encoding="utf-8")
            before = index_file_path().read_bytes()
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
                patch("x_locale_cli.ops.apply_pull_export", side_effect=_boom),
            ):
                with self.assertRaises(OSError):
                    pull_translations(config)
            self.assertTrue(push_pending_is_active())
            self.assertEqual(index_file_path().read_bytes(), before)

    def test_push_5xx_keeps_pending_marker(self) -> None:
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
        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_http_status_error(500)):
                with self.assertRaises(XLocaleError):
                    push_strings(config, dry_run=False)
            self.assertTrue(push_pending_is_active())

    def test_push_request_error_keeps_pending_marker(self) -> None:
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
        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_request_transport_error):
                with self.assertRaises(XLocaleError):
                    push_strings(config, dry_run=False)
            self.assertTrue(push_pending_is_active())

    def test_push_json_decode_error_keeps_pending_marker(self) -> None:
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
        with chdir(self.root):
            with patch("x_locale_cli.ops.request_json", side_effect=_json_decode_error):
                with self.assertRaises(json.JSONDecodeError):
                    push_strings(config, dry_run=False)
            self.assertTrue(push_pending_is_active())

    def test_preexisting_marker_survives_index_write_oserror_on_push(self) -> None:
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
        scope = scope_from_config(config)
        index_payload = json.dumps(
            {**scope.__dict__, "entries": catalog_hashes_flat({"a": "A"})},
            ensure_ascii=False,
            indent=2,
        ) + "\n"

        def _request(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            return _import_ok(dry_run=False)

        with chdir(self.root):
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text(index_payload, encoding="utf-8")
            pending_file_path().write_text("", encoding="utf-8")
            before = index_file_path().read_bytes()
            with (
                patch("x_locale_cli.ops.request_json", side_effect=_request),
                patch(
                    "x_locale_cli.push_index.atomic_write_push_index",
                    side_effect=OSError("disk full"),
                ),
            ):
                push_strings(config, dry_run=False)
            self.assertTrue(push_pending_is_active())
            self.assertEqual(index_file_path().read_bytes(), before)

    def test_successful_full_push_clears_preexisting_marker(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text(json.dumps({"a": "A", "b": "B"}), encoding="utf-8")
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
        scope = scope_from_config(config)
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

        with chdir(self.root):
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            (config_dir / "push-index.json").write_text(
                json.dumps({**scope.__dict__, "entries": catalog_hashes_flat({"a": "A", "b": "B"})}),
                encoding="utf-8",
            )
            pending_file_path().write_text("", encoding="utf-8")
            with patch("x_locale_cli.ops.request_json", side_effect=_request):
                push_strings(config, dry_run=False)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("partial", calls[0]["params"])
            self.assertFalse(push_pending_is_active())
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.entries, catalog_hashes_flat({"a": "A", "b": "B"}))

    def test_modular_draft_pull_preserves_index_and_preexisting_marker(self) -> None:
        locales = self.root / "locales"
        auth_dir = locales / "auth"
        home_dir = locales / "home"
        auth_dir.mkdir(parents=True)
        home_dir.mkdir(parents=True)
        (auth_dir / "vi.json").write_text(json.dumps({"k1": "old"}), encoding="utf-8")
        (home_dir / "vi.json").write_text(json.dumps({"k2": "home"}), encoding="utf-8")
        _write_config(self.root, layout="modular")
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "modular",
                "stage": "draft",
                "base_language": "vi",
            }
        )
        scope = scope_from_config(config)
        export = {
            "modules": {"auth": {"vi": {"k1": "new"}}},
            "unassigned": {},
            "manifest": {},
        }

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
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            (config_dir / "push-index.json").write_text(
                json.dumps(
                    {
                        **scope.__dict__,
                        "entries": {
                            scoped_key("auth", "k1"): hash_base_value("old"),
                            scoped_key("home", "k2"): hash_base_value("home"),
                        },
                    }
                ),
                encoding="utf-8",
            )
            pending_file_path().write_text("", encoding="utf-8")
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            ):
                pull_translations(config)
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.entries[scoped_key("auth", "k1")], hash_base_value("new"))
            self.assertNotIn(scoped_key("home", "k2"), loaded.entries)
            self.assertFalse((home_dir / "vi.json").exists())
            self.assertTrue(push_pending_is_active())

    def test_pull_locales_filter_skips_base_index_and_marker(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text('{"base":"x"}', encoding="utf-8")
        (locales / "en.json").write_text('{"e":"E"}', encoding="utf-8")
        _write_config(self.root, locales=["en"])
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "draft",
                "base_language": "vi",
                "locales": ["en"],
            }
        )
        scope = scope_from_config(config)
        export = {"vi": {"base": "remote"}, "en": {"e": "EN"}}
        index_payload = json.dumps(
            {**scope.__dict__, "entries": {"seed": "deadbeef"}},
            ensure_ascii=False,
            indent=2,
        ) + "\n"

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
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text(index_payload, encoding="utf-8")
            pending_file_path().write_text("", encoding="utf-8")
            before = index_file_path().read_bytes()
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            ):
                pull_translations(config)
            self.assertEqual(index_file_path().read_bytes(), before)
            self.assertTrue(push_pending_is_active())

            pending_file_path().unlink(missing_ok=True)
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            ):
                pull_translations(config)
            self.assertFalse(push_pending_is_active())

    def test_public_pull_removes_index_and_pending_marker(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text("{}", encoding="utf-8")
        _write_config(self.root, stage="public")
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "public",
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

        with chdir(self.root):
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text('{"entries":{}}', encoding="utf-8")
            pending_file_path().write_text("", encoding="utf-8")
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            ):
                pull_translations(config)
            self.assertFalse(index_file_path().exists())
            self.assertFalse(push_pending_is_active())

    def test_pull_index_refresh_oserror_keeps_marker_and_index_bytes(self) -> None:
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
        scope = scope_from_config(config)
        export = {"vi": {"k": "v"}}
        index_payload = json.dumps(
            {**scope.__dict__, "entries": {"keep": hash_base_value("me")}},
            ensure_ascii=False,
            indent=2,
        ) + "\n"

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
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text(index_payload, encoding="utf-8")
            pending_file_path().write_text("", encoding="utf-8")
            before = index_file_path().read_bytes()
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
                patch(
                    "x_locale_cli.push_index.atomic_write_push_index",
                    side_effect=OSError("disk full"),
                ),
            ):
                pull_translations(config)
            self.assertTrue(push_pending_is_active())
            self.assertEqual(index_file_path().read_bytes(), before)

    def test_pull_manifest_write_failure_keeps_marker_and_index_bytes(self) -> None:
        locales = self.root / "locales"
        auth_dir = locales / "auth"
        auth_dir.mkdir(parents=True)
        (auth_dir / "vi.json").write_text("{}", encoding="utf-8")
        _write_config(self.root, layout="modular", manifest=True)
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "modular",
                "stage": "draft",
                "base_language": "vi",
                "manifest": True,
            }
        )
        scope = scope_from_config(config)
        export = {
            "modules": {"auth": {"vi": {"k": "v"}}},
            "unassigned": {},
            "manifest": {"version": 1},
        }
        index_payload = json.dumps(
            {**scope.__dict__, "entries": {"seed": "abcd"}},
            ensure_ascii=False,
            indent=2,
        ) + "\n"
        original_write_text = Path.write_text

        def _write_text(self: Path, *args: object, **kwargs: object) -> int:
            if self.name == "manifest.json":
                raise OSError("manifest fail")
            return original_write_text(self, *args, **kwargs)  # type: ignore[arg-type]

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
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text(index_payload, encoding="utf-8")
            before = index_file_path().read_bytes()
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
                patch.object(Path, "write_text", _write_text),
            ):
                with self.assertRaises(OSError):
                    pull_translations(config)
            self.assertTrue(push_pending_is_active())
            self.assertEqual(index_file_path().read_bytes(), before)

    def test_empty_public_modular_pull_does_not_create_pending_marker(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        _write_config(self.root, layout="modular", stage="public")
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "modular",
                "stage": "public",
                "base_language": "vi",
            }
        )
        export = {
            "modules": {},
            "unassigned": {"vi": {}, "en": {}},
            "manifest": {"modules": [], "locales": ["vi", "en"], "base_language": "vi"},
        }

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
            self.assertFalse(push_pending_is_active())

    def test_public_pull_delete_index_oserror_does_not_raise(self) -> None:
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text("{}", encoding="utf-8")
        _write_config(self.root, stage="public")
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "22222222-2222-2222-2222-222222222222",
                "api_key": "k",
                "output_dir": str(locales),
                "layout": "flat",
                "stage": "public",
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

        with chdir(self.root):
            config_dir = self.root / ".x-locale"
            config_dir.mkdir(parents=True, exist_ok=True)
            index_file_path().write_text('{"entries":{}}', encoding="utf-8")
            pending_file_path().write_text("", encoding="utf-8")
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
                patch(
                    "x_locale_cli.push_index.delete_push_index",
                    side_effect=OSError("permission denied"),
                ),
            ):
                pull_translations(config)
            self.assertTrue(index_file_path().exists())
            self.assertTrue(push_pending_is_active())
