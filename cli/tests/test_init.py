"""Interactive and flag-mode ``locale init``."""

from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch

from typer.testing import CliRunner

from tests.conftest import strip_ansi
from x_locale_cli.app import app
from x_locale_cli.commands.init import _normalize_api_url
from x_locale_cli.config import load_config
from x_locale_cli.errors import XLocaleError
from x_locale_cli.models import Layout, Stage

DEMO_PROJECT = {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "Demo App",
    "base_language": "vi",
    "target_languages": ["en", "ko", "ja"],
    "layout": "modular",
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
def fake_bootstrap(project: dict[str, Any] | None = None) -> Iterator[None]:
    class _Client:
        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

    payload = project if project is not None else DEMO_PROJECT
    with (
        patch("x_locale_cli.commands.init.api_client", return_value=_Client()),
        patch("x_locale_cli.commands.init.request_json", return_value=payload),
    ):
        yield


class NormalizeApiUrlTests(unittest.TestCase):
    def test_adds_scheme_and_strips_slash(self) -> None:
        self.assertEqual(_normalize_api_url("localhost:8000/"), "http://localhost:8000")

    def test_keeps_https(self) -> None:
        self.assertEqual(_normalize_api_url(" https://x-locale.example.com "), "https://x-locale.example.com")


class InitCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _invoke(self, args: list[str], *, input: str | None = None) -> Any:
        with chdir(self.root):
            return self.runner.invoke(app, args, input=input)

    def test_help_mentions_wizard_and_yes(self) -> None:
        result = self.runner.invoke(app, ["init", "--help"])
        self.assertEqual(result.exit_code, 0, result.output)
        output = strip_ansi(result.output)
        self.assertIn("--yes", output)
        self.assertIn("--api-key", output)
        self.assertIn("if omitted", output)
        self.assertNotIn("[required]", output)

    def test_noninteractive_requires_api_key(self) -> None:
        result = self._invoke(["init"])
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("API key is required", result.output)

    def test_flag_mode_writes_project_config(self) -> None:
        with fake_bootstrap():
            result = self._invoke(
                ["init", "-k", "xl_secret", "-u", "https://x-locale.example.com", "-o", "./src/locales"]
            )
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Demo App", result.output)
        self.assertTrue((self.root / ".x-locale" / "config.yaml").exists())
        self.assertFalse((self.root / ".tms" / "config.yaml").exists())
        with chdir(self.root):
            config = load_config()
        self.assertEqual(config.api_key, "xl_secret")
        self.assertEqual(config.api_url, "https://x-locale.example.com")
        self.assertEqual(config.output_dir, "./src/locales")
        self.assertEqual(config.base_language, "vi")
        self.assertEqual(config.locales, ["vi", "en", "ko", "ja"])
        self.assertEqual(config.layout, Layout.modular)
        self.assertEqual(config.stage, Stage.draft)
        self.assertTrue(config.manifest)
        self.assertIn("Layout: modular", result.output)

    def test_flag_mode_skips_wizard_on_tty(self) -> None:
        with fake_bootstrap(), patch("x_locale_cli.commands.init._stdin_is_tty", return_value=True):
            result = self._invoke(["init", "-k", "xl_secret"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("API URL", result.output)
        self.assertNotIn("x-locale init", result.output)
        with chdir(self.root):
            self.assertEqual(load_config().api_key, "xl_secret")

    def test_layout_flag_overrides_project(self) -> None:
        with fake_bootstrap():
            result = self._invoke(["init", "-k", "xl_secret", "--layout", "flat", "-y"])
        self.assertEqual(result.exit_code, 0, result.output)
        with chdir(self.root):
            config = load_config()
        self.assertEqual(config.layout, Layout.flat)

    def test_existing_config_requires_yes_when_not_a_tty(self) -> None:
        with fake_bootstrap():
            first = self._invoke(["init", "-k", "xl_secret"])
            self.assertEqual(first.exit_code, 0, first.output)
            second = self._invoke(["init", "-k", "xl_other"])
        self.assertEqual(second.exit_code, 1, second.output)
        self.assertIn("already exists", second.output)
        with chdir(self.root):
            self.assertEqual(load_config().api_key, "xl_secret")

    def test_yes_overwrites_existing_config(self) -> None:
        with fake_bootstrap():
            self._invoke(["init", "-k", "xl_secret"])
            result = self._invoke(["init", "-k", "xl_rotated", "--yes"])
        self.assertEqual(result.exit_code, 0, result.output)
        with chdir(self.root):
            self.assertEqual(load_config().api_key, "xl_rotated")

    def test_wizard_prompts_for_omitted_values(self) -> None:
        with fake_bootstrap(), patch("x_locale_cli.commands.init._stdin_is_tty", return_value=True):
            result = self._invoke(
                ["init"],
                input="https://x-locale.example.com\nxl_wizard_key\n./src/locales\npublic\n",
            )
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("x-locale init", result.output)
        self.assertIn("API URL", result.output)
        self.assertIn("API key", result.output)
        self.assertIn("Output directory", result.output)
        self.assertIn("Pull stage", result.output)
        self.assertIn("Found:", result.output)
        with chdir(self.root):
            config = load_config()
        self.assertEqual(config.api_url, "https://x-locale.example.com")
        self.assertEqual(config.api_key, "xl_wizard_key")
        self.assertEqual(config.output_dir, "./src/locales")
        self.assertEqual(config.stage, Stage.public)
        self.assertEqual(config.layout, Layout.modular)

    def test_wizard_accepts_defaults_and_confirms_overwrite(self) -> None:
        with fake_bootstrap():
            seeded = self._invoke(["init", "-k", "xl_old"])
        self.assertEqual(seeded.exit_code, 0, seeded.output)
        with fake_bootstrap(), patch("x_locale_cli.commands.init._stdin_is_tty", return_value=True):
            cancelled = self._invoke(["init"], input="\nxl_new\n\n\nn\n")
        self.assertEqual(cancelled.exit_code, 1, cancelled.output)
        self.assertIn("Cancelled", cancelled.output)
        with chdir(self.root):
            self.assertEqual(load_config().api_key, "xl_old")

        with fake_bootstrap(), patch("x_locale_cli.commands.init._stdin_is_tty", return_value=True):
            overwritten = self._invoke(["init"], input="\nxl_new\n\n\ny\n")
        self.assertEqual(overwritten.exit_code, 0, overwritten.output)
        with chdir(self.root):
            self.assertEqual(load_config().api_key, "xl_new")
            self.assertEqual(load_config().api_url, "http://localhost:8000")
            self.assertEqual(load_config().output_dir, "./locales")

    def test_wizard_rejects_empty_api_key_then_accepts_retry(self) -> None:
        with fake_bootstrap(), patch("x_locale_cli.commands.init._stdin_is_tty", return_value=True):
            result = self._invoke(["init"], input="\n\nxl_ok\n\n\n")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertGreaterEqual(result.output.count("API key:"), 2)
        with chdir(self.root):
            self.assertEqual(load_config().api_key, "xl_ok")

    def test_wizard_stage_is_case_insensitive_and_rejects_unknown(self) -> None:
        with fake_bootstrap(), patch("x_locale_cli.commands.init._stdin_is_tty", return_value=True):
            result = self._invoke(["init"], input="\nxl_ok\n\nnope\nPUBLIC\n")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Stage must be", result.output)
        with chdir(self.root):
            self.assertEqual(load_config().stage, Stage.public)

    def test_bootstrap_failure_does_not_write_config(self) -> None:
        class _Client:
            def __enter__(self) -> _Client:
                return self

            def __exit__(self, *exc: object) -> bool:
                return False

        with (
            patch("x_locale_cli.commands.init.api_client", return_value=_Client()),
            patch(
                "x_locale_cli.commands.init.request_json",
                side_effect=XLocaleError("Bootstrap failed (401): Invalid API key"),
            ),
        ):
            result = self._invoke(["init", "-k", "bad"])
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("Invalid API key", result.output)
        self.assertFalse((self.root / ".x-locale" / "config.yaml").exists())
