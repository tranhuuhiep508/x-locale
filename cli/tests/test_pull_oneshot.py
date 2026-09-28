"""Oneshot pull: rewrite from export, prune, and push-index edges."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from x_locale_cli.io import (
    UNASSIGNED_SLUG,
    apply_pull_export,
    write_locale_file_reported,
)
from x_locale_cli.models import Config
from x_locale_cli.ops import pull_translations
from x_locale_cli.push_index import catalog_hashes_flat, load_push_index
from tests.test_push_index import chdir, _write_config


class ApplyPullExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(self._testMethodName)
        self.root.mkdir(exist_ok=True)

    def tearDown(self) -> None:
        import shutil

        shutil.rmtree(self.root, ignore_errors=True)

    def test_modular_writes_empty_locale_file(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "modular",
                "base_language": "vi",
                "locales": ["vi", "en"],
            }
        )
        export = {
            "modules": {"auth": {"vi": {"k": "v"}, "en": {}}},
            "unassigned": {"vi": {}, "en": {}},
            "manifest": {"modules": ["auth"], "locales": ["vi", "en"], "base_language": "vi"},
        }
        result = apply_pull_export(
            config, export, output_root=self.root.resolve(), write_manifest=False
        )
        en_path = self.root / "auth" / "en.json"
        self.assertTrue(en_path.exists())
        self.assertEqual(json.loads(en_path.read_text(encoding="utf-8")), {})
        self.assertFalse((self.root / UNASSIGNED_SLUG).exists())

    def test_prunes_removed_module(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "modular",
                "base_language": "vi",
                "locales": ["vi"],
            }
        )
        stale = self.root / "gone" / "vi.json"
        stale.parent.mkdir(parents=True)
        stale.write_text('{"x":"y"}', encoding="utf-8")
        export = {
            "modules": {"auth": {"vi": {"k": "v"}}},
            "unassigned": {"vi": {}},
            "manifest": {"modules": ["auth"], "locales": ["vi"], "base_language": "vi"},
        }
        apply_pull_export(config, export, output_root=self.root.resolve(), write_manifest=False)
        self.assertFalse(stale.exists())
        self.assertFalse((self.root / "gone").exists())

    def test_locale_filter_does_not_prune_other_locales(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "flat",
                "base_language": "vi",
                "locales": ["en"],
            }
        )
        vi_path = self.root / "vi.json"
        vi_path.write_text('{"keep": "local"}', encoding="utf-8")
        export = {"en": {"e": "E"}}
        apply_pull_export(config, export, output_root=self.root.resolve(), write_manifest=False)
        self.assertTrue(vi_path.exists())
        self.assertEqual(json.loads(vi_path.read_text(encoding="utf-8")), {"keep": "local"})

    def test_flat_empty_map_is_kept(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "flat",
                "base_language": "vi",
                "locales": ["vi"],
            }
        )
        (self.root / "vi.json").write_text('{"stale": "x"}', encoding="utf-8")
        apply_pull_export(
            config, {"vi": {}}, output_root=self.root.resolve(), write_manifest=False
        )
        text = (self.root / "vi.json").read_text(encoding="utf-8")
        self.assertEqual(json.loads(text), {})

    def test_public_empty_string_is_written(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "flat",
                "stage": "public",
                "base_language": "vi",
                "locales": ["en"],
            }
        )
        apply_pull_export(
            config,
            {"en": {"hello": ""}},
            output_root=self.root.resolve(),
            write_manifest=False,
        )
        self.assertEqual(json.loads((self.root / "en.json").read_text(encoding="utf-8")), {"hello": ""})

    def test_unassigned_partial_writes_empty_sibling(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "modular",
                "base_language": "vi",
                "locales": ["vi", "en"],
            }
        )
        stale = self.root / UNASSIGNED_SLUG / "en.json"
        stale.parent.mkdir(parents=True)
        stale.write_text('{"old": "x"}', encoding="utf-8")
        export = {
            "modules": {"auth": {"vi": {"k": "v"}, "en": {}}},
            "unassigned": {"vi": {"loose": "Hi"}, "en": {}},
            "manifest": {},
        }
        apply_pull_export(config, export, output_root=self.root.resolve(), write_manifest=False)
        self.assertEqual(
            json.loads((self.root / UNASSIGNED_SLUG / "en.json").read_text(encoding="utf-8")),
            {},
        )
        self.assertEqual(
            json.loads((self.root / UNASSIGNED_SLUG / "vi.json").read_text(encoding="utf-8")),
            {"loose": "Hi"},
        )

    def test_locale_in_scope_missing_from_export_is_pruned(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "flat",
                "base_language": "vi",
                "locales": ["vi", "ko"],
            }
        )
        (self.root / "ko.json").write_text('{"k": "v"}', encoding="utf-8")
        (self.root / "readme.json").write_text('{"note": "keep"}', encoding="utf-8")
        apply_pull_export(
            config, {"vi": {"a": "A"}}, output_root=self.root.resolve(), write_manifest=False
        )
        self.assertFalse((self.root / "ko.json").exists())
        self.assertTrue((self.root / "readme.json").exists())
        self.assertTrue((self.root / "vi.json").exists())

    def test_out_of_scope_locale_keeps_module_dir(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "modular",
                "base_language": "vi",
                "locales": ["vi"],
            }
        )
        gone = self.root / "gone"
        gone.mkdir()
        (gone / "vi.json").write_text('{"x": "y"}', encoding="utf-8")
        (gone / "ja.json").write_text('{"j": "a"}', encoding="utf-8")
        (gone / "notes.txt").write_text("keep", encoding="utf-8")
        export = {
            "modules": {"auth": {"vi": {"k": "v"}}},
            "unassigned": {"vi": {}},
            "manifest": {"locales": ["vi"]},
        }
        apply_pull_export(config, export, output_root=self.root.resolve(), write_manifest=False)
        self.assertFalse((gone / "vi.json").exists())
        self.assertTrue((gone / "ja.json").exists())
        self.assertEqual((gone / "notes.txt").read_text(encoding="utf-8"), "keep")
        self.assertTrue(gone.is_dir())

    def test_manifest_false_deletes_manifest(self) -> None:
        config = Config.from_dict(
            {
                "api_url": "http://127.0.0.1:8000",
                "project_id": "p",
                "api_key": "k",
                "output_dir": str(self.root),
                "layout": "modular",
                "base_language": "vi",
                "locales": ["vi"],
                "manifest": False,
            }
        )
        (self.root / "manifest.json").write_text("{}\n", encoding="utf-8")
        export = {
            "modules": {"auth": {"vi": {"k": "v"}}},
            "unassigned": {"vi": {}},
            "manifest": {"modules": ["auth"]},
        }
        result = apply_pull_export(
            config, export, output_root=self.root.resolve(), write_manifest=False
        )
        self.assertTrue(result.manifest_deleted)
        self.assertFalse((self.root / "manifest.json").exists())

    def test_invalid_json_is_overwritten(self) -> None:
        path = self.root / "en.json"
        path.write_text("{not json", encoding="utf-8")
        report = write_locale_file_reported(path, {"ok": "yes"})
        self.assertTrue(report.written)
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"ok": "yes"})


class PullOneshotIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(self._testMethodName)
        self.root.mkdir(exist_ok=True)

    def tearDown(self) -> None:
        import shutil

        shutil.rmtree(self.root, ignore_errors=True)

    def test_draft_pull_rebuilds_index_without_full_push(self) -> None:
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
                "stage": "draft",
                "base_language": "vi",
            }
        )
        export = {"vi": {"a": "A"}}

        class _Client:
            def __enter__(self) -> _Client:
                return self

            def __exit__(self, *exc: object) -> bool:
                return False

        calls: list[dict[str, Any]] = []

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

        def _push_request(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            calls.append({"params": dict(params or {}), "payload": payload})
            return {
                "dry_run": False,
                "created": 0,
                "updated": 0,
                "total": 0,
                "diff": {
                    "create": [],
                    "update": [],
                    "orphan": [],
                    "create_count": 0,
                    "update_count": 0,
                    "orphan_count": 0,
                },
            }

        with chdir(self.root):
            with (
                patch("x_locale_cli.ops.api_client", return_value=_Client()),
                patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            ):
                pull_translations(config)
            loaded = load_push_index(config)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.entries, catalog_hashes_flat({"a": "A"}))
            with patch("x_locale_cli.ops.request_json", side_effect=_push_request):
                from x_locale_cli.ops import push_strings

                push_strings(config, dry_run=False)
            self.assertEqual(len(calls), 0)
