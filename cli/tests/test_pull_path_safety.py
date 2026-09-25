"""CLI pull must not write outside the configured output directory."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from x_locale_cli.errors import XLocaleError
from x_locale_cli.io import resolve_under_output


class PullPathSafetyTests(unittest.TestCase):
    def test_rejects_parent_segment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(XLocaleError):
                resolve_under_output(root, "..", "en.json")

    def test_rejects_escape_via_slug(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(XLocaleError):
                resolve_under_output(root, "../outside", "en.json")

    def test_allows_normal_module_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = resolve_under_output(root, "auth", "en.json")
            self.assertEqual(target.parent.name, "auth")


if __name__ == "__main__":
    unittest.main()
