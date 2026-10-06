"""Review deep link printed after a successful ``loc push``."""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from rich.console import Console

from tests.sync_support import sync_state
from x_locale_cli.models import Config, resolve_web_base
from x_locale_cli.ops import push_strings
from x_locale_cli.report import print_push_report, push_review_line

BATCH = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "22222222-2222-2222-2222-222222222222"


def _config(**overrides: Any) -> Config:
    data: dict[str, Any] = {
        "api_url": "http://localhost:8000",
        "api_key": "xl_test",
        "project_slug": "demo-app",
        "output_dir": "./locales",
        "layout": "flat",
        "base_language": "vi",
    }
    data.update(overrides)
    return Config.from_dict(data)


def _result(
    *,
    create_count: int = 1,
    update_count: int = 0,
    batch_id: str | None = BATCH,
    dry_run: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "dry_run": dry_run,
        "created": create_count,
        "updated": update_count,
        "diff": {
            "create": [{"key": "hello"}] * create_count,
            "update": [{"key": "saved"}] * update_count,
            "orphan": [],
            "create_count": create_count,
            "update_count": update_count,
            "orphan_count": 0,
        },
    }
    if batch_id is not None:
        body["batch_id"] = batch_id
    return body


def _capture(fn) -> str:
    buf = io.StringIO()
    fake = Console(file=buf, width=80, color_system=None)
    with patch("x_locale_cli.report.console", fake):
        fn()
    return buf.getvalue()


class ResolveWebBaseTests(unittest.TestCase):
    def test_web_url_wins_over_env_and_api_url(self) -> None:
        config = _config(
            api_url="http://localhost:8000/api/",
            web_url="http://localhost:5173/",
        )
        resolved = resolve_web_base(
            config,
            environ={"XLOCALE_WEB_URL": "https://override.example"},
        )
        self.assertEqual(resolved, "http://localhost:5173")

    def test_env_override_when_web_url_unset(self) -> None:
        resolved = resolve_web_base(
            _config(api_url="http://localhost:8000"),
            environ={"XLOCALE_WEB_URL": "https://ui.example/"},
        )
        self.assertEqual(resolved, "https://ui.example")

    def test_api_url_fallback_strips_trailing_api_segment(self) -> None:
        self.assertEqual(
            resolve_web_base(_config(api_url="https://x-locale.example.com/api/"), environ={}),
            "https://x-locale.example.com",
        )
        self.assertEqual(
            resolve_web_base(_config(api_url="http://localhost:8000/"), environ={}),
            "http://localhost:8000",
        )
        self.assertEqual(
            resolve_web_base(_config(api_url="https://example.com/api/v1"), environ={}),
            "https://example.com/api/v1",
        )
        self.assertEqual(
            resolve_web_base(_config(api_url="http://api.example.com"), environ={}),
            "http://api.example.com",
        )

    def test_explicit_web_url_keeps_api_path(self) -> None:
        resolved = resolve_web_base(
            _config(web_url="http://localhost:5173/api", api_url="http://localhost:8000"),
            environ={},
        )
        self.assertEqual(resolved, "http://localhost:5173/api")

    def test_blank_web_url_is_unset(self) -> None:
        resolved = resolve_web_base(
            _config(web_url="  ", api_url="http://localhost:8000"),
            environ={"XLOCALE_WEB_URL": "http://from-env.example"},
        )
        self.assertEqual(resolved, "http://from-env.example")

    def test_missing_base_is_none(self) -> None:
        self.assertIsNone(
            resolve_web_base(_config(api_url="localhost:8000", web_url=""), environ={})
        )
        self.assertIsNone(
            resolve_web_base(_config(web_url="/projects", api_url="not a url"), environ={})
        )


class PushReviewLineTests(unittest.TestCase):
    def _print(self, **kwargs: Any) -> str:
        result = kwargs.pop("result", _result())
        return _capture(
            lambda: print_push_report(
                result=result,
                local_key_count=2,
                details=["flat"],
                dry_run=kwargs.pop("dry_run", False),
                project_ref=kwargs.pop("project_ref", "demo-app"),
                web_base=kwargs.pop("web_base", "http://localhost:5173"),
            )
        )

    def test_prints_one_review_line_for_creates(self) -> None:
        text = self._print()
        expected = (
            f"Review: http://localhost:5173/projects/demo-app/strings"
            f"?batch_id={BATCH}&batch_kind=import"
        )
        self.assertEqual(text.count("Review:"), 1)
        self.assertIn(expected, text)
        self.assertNotIn("nothing to review", text.lower())

    def test_prints_review_line_for_updates_only(self) -> None:
        text = self._print(result=_result(create_count=0, update_count=2))
        self.assertEqual(text.count("Review:"), 1)
        self.assertIn(f"batch_id={BATCH}&batch_kind=import", text)

    def test_project_id_when_slug_missing(self) -> None:
        config = _config(project_slug="", project_id=PROJECT_ID, web_url="http://localhost:5173")
        text = self._print(
            project_ref=config.project_ref,
            web_base=resolve_web_base(config, environ={}),
        )
        self.assertIn(f"/projects/{PROJECT_ID}/strings?", text)
        self.assertNotIn("/projects/demo-app/", text)

    def test_dry_run_omits_line_even_with_batch_id(self) -> None:
        text = self._print(dry_run=True, result=_result(dry_run=True))
        self.assertNotIn("Review:", text)
        self.assertIn("Dry run", text)
        self.assertIsNone(
            push_review_line(
                batch_id=BATCH,
                create_count=3,
                update_count=1,
                dry_run=True,
                project_ref="demo-app",
                web_base="http://localhost:5173",
            )
        )

    def test_zero_creates_and_updates_omits_line(self) -> None:
        text = self._print(result=_result(create_count=0, update_count=0))
        self.assertNotIn("Review:", text)
        self.assertNotIn("nothing to review", text.lower())

    def test_missing_batch_id_omits_line(self) -> None:
        text = self._print(result=_result(batch_id=None))
        self.assertNotIn("Review:", text)

    def test_missing_web_base_omits_line(self) -> None:
        text = self._print(web_base=None)
        self.assertNotIn("Review:", text)
        self.assertNotIn("/projects/", text)

    def test_relative_web_base_omits_line(self) -> None:
        text = self._print(web_base="/projects")
        self.assertNotIn("Review:", text)
        self.assertNotIn("projects/demo-app/strings", text)


class PushPathReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        locales = self.root / "locales"
        locales.mkdir()
        (locales / "vi.json").write_text(json.dumps({"hello": "Xin chao"}), encoding="utf-8")
        self.output_dir = str(locales)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _run(self, config: Config, *, dry_run: bool, body: dict[str, Any]) -> str:
        buf = io.StringIO()
        fake = Console(file=buf, width=80, color_system=None)

        def _request_json(
            client: object,
            method: str,
            path: str,
            *,
            action: str,
            params: dict[str, Any] | None = None,
            payload: Any = None,
        ) -> Any:
            del client, method, action, payload
            if path.endswith("/sync-state"):
                return sync_state(config, stage=(params or {})["stage"])
            return body

        class _Client:
            def __enter__(self) -> _Client:
                return self

            def __exit__(self, *exc: object) -> bool:
                return False

        with (
            patch("x_locale_cli.ops.api_client", return_value=_Client()),
            patch("x_locale_cli.ops.request_json", side_effect=_request_json),
            patch("x_locale_cli.report.console", fake),
            patch.dict(os.environ, {"XLOCALE_WEB_URL": ""}, clear=False),
        ):
            push_strings(config, dry_run=dry_run)
        return buf.getvalue()

    def test_push_prints_review_link_from_config_web_url(self) -> None:
        config = _config(
            output_dir=self.output_dir,
            web_url="http://localhost:5173",
        )
        text = self._run(config, dry_run=False, body=_result(create_count=1, update_count=1))
        expected = (
            f"Review: http://localhost:5173/projects/demo-app/strings"
            f"?batch_id={BATCH}&batch_kind=import"
        )
        self.assertEqual(text.count("Review:"), 1)
        self.assertIn(expected, text)

    def test_push_dry_run_does_not_print_review_link(self) -> None:
        config = _config(output_dir=self.output_dir, web_url="http://localhost:5173")
        text = self._run(config, dry_run=True, body=_result(dry_run=True))
        self.assertNotIn("Review:", text)
        self.assertIn("Dry run", text)

    def test_push_falls_back_to_api_origin(self) -> None:
        config = _config(output_dir=self.output_dir, api_url="http://127.0.0.1:8000")
        text = self._run(config, dry_run=False, body=_result())
        self.assertIn(
            f"Review: http://127.0.0.1:8000/projects/demo-app/strings?batch_id={BATCH}&batch_kind=import",
            text,
        )

    def test_push_omits_link_when_base_is_not_absolute(self) -> None:
        config = _config(output_dir=self.output_dir, api_url="localhost:8000", project_slug="demo-app")
        text = self._run(config, dry_run=False, body=_result())
        self.assertNotIn("Review:", text)
        self.assertNotIn("/projects/demo-app/strings", text)
