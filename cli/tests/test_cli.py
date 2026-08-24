"""Smoke tests for Typer command registration and help."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from typer.testing import CliRunner

from tms_cli.app import app


class AppHelpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()

    def test_root_help_lists_commands(self) -> None:
        result = self.runner.invoke(app, ["--help"])
        self.assertEqual(result.exit_code, 0, result.output)
        for name in ("init", "push", "pull", "sync", "status"):
            self.assertIn(name, result.output)

    def test_no_args_shows_help(self) -> None:
        result = self.runner.invoke(app, [])
        self.assertEqual(result.exit_code, 2, result.output)
        self.assertIn("Usage", result.output)

    def test_push_help_uses_layout_choices(self) -> None:
        result = self.runner.invoke(app, ["push", "--help"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("--layout", result.output)
        self.assertIn("flat", result.output)
        self.assertIn("modular", result.output)

    def test_short_help_flag(self) -> None:
        result = self.runner.invoke(app, ["-h"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Usage", result.output)

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
