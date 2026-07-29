import tempfile
import unittest
from pathlib import Path

import typer

from tms_cli.main import (
    default_source_file,
    locale_json_from_strings,
    parse_locale_json,
    resolve_push_source,
)


class LocaleJsonTests(unittest.TestCase):
    def test_parse_locale_json(self) -> None:
        data = {"auth.sign_in": "Sign in", "common.save": "Save"}
        self.assertEqual(parse_locale_json(data), data)

    def test_parse_locale_json_rejects_nested_values(self) -> None:
        with self.assertRaises(typer.Exit):
            parse_locale_json({"auth": {"sign_in": "Sign in"}})

    def test_locale_json_from_strings_sorts_keys(self) -> None:
        strings = {"homepage.welcome": "Hello", "common.save": "Save"}
        self.assertEqual(
            list(locale_json_from_strings(strings)),
            ["common.save", "homepage.welcome"],
        )


class ResolvePushSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.locales_dir = Path(self.temp_dir.name) / "locales"
        self.locales_dir.mkdir()
        (self.locales_dir / "en.json").write_text("{}", encoding="utf-8")
        (self.locales_dir / "vi.json").write_text("{}", encoding="utf-8")
        self.config = {
            "output_dir": str(self.locales_dir),
            "base_language": "en",
        }

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_default_source_file(self) -> None:
        self.assertEqual(default_source_file(self.config), self.locales_dir / "en.json")

    def test_resolve_defaults_to_base_language_file(self) -> None:
        path = resolve_push_source(self.config, None)
        self.assertEqual(path, self.locales_dir / "en.json")

    def test_resolve_rejects_translation_file(self) -> None:
        with self.assertRaises(typer.Exit) as ctx:
            resolve_push_source(self.config, self.locales_dir / "vi.json")
        self.assertIn("Cannot push translation file", str(ctx.exception))

    def test_resolve_rejects_directory(self) -> None:
        with self.assertRaises(typer.Exit) as ctx:
            resolve_push_source(self.config, self.locales_dir)
        self.assertIn("got directory", str(ctx.exception))

    def test_resolve_accepts_explicit_base_language_file(self) -> None:
        path = resolve_push_source(self.config, self.locales_dir / "en.json")
        self.assertEqual(path, self.locales_dir / "en.json")


if __name__ == "__main__":
    unittest.main()
