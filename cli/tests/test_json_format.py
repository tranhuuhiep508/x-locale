import unittest

import typer

from tms_cli.main import locale_json_from_strings, parse_locale_json


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


if __name__ == "__main__":
    unittest.main()
