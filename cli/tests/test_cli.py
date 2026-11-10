"""Smoke tests for Typer command registration and help."""

from __future__ import annotations

import inspect
import os
import tempfile
import unittest
from pathlib import Path

from typer.testing import CliRunner

from tests.conftest import strip_ansi
from x_locale_cli.app import app
from x_locale_cli.commands import COMMANDS
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

    def test_root_help_uses_loc_entrypoint_and_x_locale_branding(self) -> None:
        result = self.runner.invoke(app, ["--help"], prog_name="loc")
        self.assertEqual(result.exit_code, 0, result.output)
        output = strip_ansi(result.output)
        self.assertIn("Usage: loc", output)
        self.assertIn("x-locale CLI", output)
        self.assertNotIn("Usage: tms", output)
        self.assertNotIn("TMS CLI", output)

    def test_no_args_shows_help(self) -> None:
        result = self.runner.invoke(app, [])
        # Click 8.2+ exits 2 for no_args_is_help; Click 8.1 (the last release for Python 3.9) exits 0.
        self.assertIn(result.exit_code, (0, 2), result.output)
        self.assertIn("Usage", strip_ansi(result.output))

    def test_command_annotations_are_not_strings(self) -> None:
        # Typer 0.23 (Python 3.9) drops Annotated option metadata when annotations are strings,
        # so command modules must not use `from __future__ import annotations`.
        for command in COMMANDS:
            for param in inspect.signature(command).parameters.values():
                self.assertNotIsInstance(param.annotation, str, f"{command.__name__}({param.name})")

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
        self.assertIn("loc init", result.output)
        self.assertNotIn("tms init", result.output)


class PackageIdentityTests(unittest.TestCase):
    def test_pyproject_names_loc_binary_and_x_locale_cli_package(self) -> None:
        text = (CLI_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('name = "x-locale-cli"', text)
        self.assertIn('loc = "x_locale_cli.main:app"', text)
        self.assertIn('include = ["x_locale_cli*"]', text)
        self.assertNotIn("tms-cli", text)
        self.assertNotIn("tms_cli", text)
        self.assertNotIn("\ntms = ", text)
        self.assertNotIn("\nlocale = ", text)

    def test_config_dir_is_dot_x_locale(self) -> None:
        self.assertEqual(CONFIG_DIR, Path(".x-locale"))
        self.assertEqual(CONFIG_FILE, Path(".x-locale") / "config.yaml")
