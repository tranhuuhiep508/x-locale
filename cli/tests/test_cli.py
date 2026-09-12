"""Smoke tests for Typer command registration and help."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from typer.testing import CliRunner

from tests.conftest import strip_ansi
from x_locale_cli.app import app
from x_locale_cli.config import CONFIG_DIR, CONFIG_FILE

CLI_ROOT = Path(__file__).resolve().parents[1]


class AppHelpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()

    def test_root_help_lists_commands(self) -> None:
        result = self.runner.invoke(app, ["--help"])
        self.assertEqual(result.exit_code, 0, result.output)
        output = strip_ansi(result.output)
        for name in ("init", "push", "pull", "sync", "status"):
            self.assertIn(name, output)

    def test_root_help_uses_locale_entrypoint_and_x_locale_branding(self) -> None:
        result = self.runner.invoke(app, ["--help"], prog_name="locale")
        self.assertEqual(result.exit_code, 0, result.output)
        output = strip_ansi(result.output)
        self.assertIn("Usage: locale", output)
        self.assertIn("x-locale CLI", output)
        self.assertNotIn("Usage: tms", output)
        self.assertNotIn("TMS CLI", output)

    def test_no_args_shows_help(self) -> None:
        result = self.runner.invoke(app, [])
        self.assertEqual(result.exit_code, 2, result.output)
        self.assertIn("Usage", strip_ansi(result.output))

    def test_push_help_uses_layout_choices(self) -> None:
        result = self.runner.invoke(app, ["push", "--help"])
        self.assertEqual(result.exit_code, 0, result.output)
        output = strip_ansi(result.output)
        self.assertIn("--layout", output)
        self.assertIn("flat", output)
        self.assertIn("modular", output)

    def test_short_help_flag(self) -> None:
        result = self.runner.invoke(app, ["-h"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Usage", strip_ansi(result.output))

    def test_push_without_config_prints_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            previous = Path.cwd()
            os.chdir(tmp)
            try:
                result = self.runner.invoke(app, ["push"])
            finally:
                os.chdir(previous)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("No config found", result.output)
        self.assertIn("locale init", result.output)
        self.assertNotIn("tms init", result.output)


class PackageIdentityTests(unittest.TestCase):
    def test_pyproject_names_locale_binary_and_x_locale_cli_package(self) -> None:
        text = (CLI_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('name = "x-locale-cli"', text)
        self.assertIn('locale = "x_locale_cli.main:app"', text)
        self.assertIn('include = ["x_locale_cli*"]', text)
        self.assertNotIn("tms-cli", text)
        self.assertNotIn("tms_cli", text)
        self.assertNotIn("\ntms = ", text)

    def test_config_dir_is_dot_x_locale(self) -> None:
        self.assertEqual(CONFIG_DIR, Path(".x-locale"))
        self.assertEqual(CONFIG_FILE, Path(".x-locale") / "config.yaml")

    def test_windows_shim_invokes_x_locale_cli(self) -> None:
        text = (CLI_ROOT / "x_locale_cli" / "locale.cmd").read_text(encoding="utf-8")
        self.assertIn("x_locale_cli.main", text)
        self.assertNotIn("tms_cli", text)
