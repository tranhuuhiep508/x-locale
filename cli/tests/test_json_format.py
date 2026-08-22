import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import typer

from tms_cli.main import (
    ChangeItem,
    PulledFileReport,
    UNASSIGNED_SLUG,
    _diff_locale_maps,
    _merge_overrides,
    _parse_api_error,
    build_modular_push_body,
    collect_modular_local_keys,
    collect_modular_remote_keys,
    count_modular_untranslated,
    default_source_file,
    file_module_locale,
    group_pull_changes,
    load_json_file,
    load_unassigned_base,
    locale_json_from_strings,
    parse_locale_json,
    resolve_push_source,
    scan_modular_base,
    scoped_key,
)


class LocaleJsonTests(unittest.TestCase):
    def test_load_json_file_allows_trailing_comma(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "vi.json"
            path.write_text('{\n  "sign_in": "Đăng nhập",\n}\n', encoding="utf-8")
            self.assertEqual(load_json_file(path), {"sign_in": "Đăng nhập"})

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


class ScanModularBaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _make_module(self, slug: str, locale: str, data: dict) -> None:
        mod_dir = self.root / slug
        mod_dir.mkdir(parents=True, exist_ok=True)
        (mod_dir / f"{locale}.json").write_text(
            json.dumps(data), encoding="utf-8"
        )

    def test_empty_directory_returns_empty(self) -> None:
        result = scan_modular_base(self.root, "en")
        self.assertEqual(result, {})

    def test_finds_module_with_base_language_file(self) -> None:
        self._make_module("auth", "en", {"sign_in": "Sign in", "sign_out": "Sign out"})
        result = scan_modular_base(self.root, "en")
        self.assertIn("auth", result)
        self.assertEqual(result["auth"], {"sign_in": "Sign in", "sign_out": "Sign out"})

    def test_accepts_trailing_comma_in_module_file(self) -> None:
        mod_dir = self.root / "auth"
        mod_dir.mkdir()
        (mod_dir / "en.json").write_text('{\n  "sign_in": "Sign in",\n}\n', encoding="utf-8")
        result = scan_modular_base(self.root, "en")
        self.assertEqual(result, {"auth": {"sign_in": "Sign in"}})

    def test_finds_multiple_modules(self) -> None:
        self._make_module("auth", "en", {"key": "val"})
        self._make_module("homepage", "en", {"title": "Home"})
        result = scan_modular_base(self.root, "en")
        self.assertEqual(set(result.keys()), {"auth", "homepage"})

    def test_skips_module_without_base_language_file(self) -> None:
        # Module only has vi.json, no en.json
        self._make_module("auth", "vi", {"sign_in": "Đăng nhập"})
        result = scan_modular_base(self.root, "en")
        self.assertEqual(result, {})

    def test_skips_underscore_directories(self) -> None:
        self._make_module("_unassigned", "en", {"key": "val"})
        self._make_module("auth", "en", {"key": "val"})
        result = scan_modular_base(self.root, "en")
        self.assertNotIn("_unassigned", result)
        self.assertIn("auth", result)

    def test_skips_dot_directories(self) -> None:
        dot_dir = self.root / ".hidden"
        dot_dir.mkdir()
        (dot_dir / "en.json").write_text('{"k": "v"}', encoding="utf-8")
        result = scan_modular_base(self.root, "en")
        self.assertNotIn(".hidden", result)

    def test_ignores_non_directory_entries(self) -> None:
        # A JSON file at the root level should not cause errors
        (self.root / "stray.json").write_text('{"k": "v"}', encoding="utf-8")
        self._make_module("auth", "en", {"key": "val"})
        result = scan_modular_base(self.root, "en")
        self.assertEqual(set(result.keys()), {"auth"})

    def test_nonexistent_output_dir_returns_empty(self) -> None:
        result = scan_modular_base(self.root / "does_not_exist", "en")
        self.assertEqual(result, {})

    def test_rejects_non_string_values_in_module_file(self) -> None:
        self._make_module("auth", "en", {"key": {"nested": "bad"}})
        with self.assertRaises(typer.Exit):
            scan_modular_base(self.root, "en")


class MergeOverridesTests(unittest.TestCase):
    def test_applies_non_none_override(self) -> None:
        config = {"output_dir": "./locales", "stage": "draft"}
        merged = _merge_overrides(config, stage="public")
        self.assertEqual(merged["stage"], "public")

    def test_ignores_none_override(self) -> None:
        config = {"output_dir": "./locales", "stage": "draft"}
        merged = _merge_overrides(config, stage=None)
        self.assertEqual(merged["stage"], "draft")

    def test_does_not_mutate_original(self) -> None:
        config = {"stage": "draft"}
        _merge_overrides(config, stage="public")
        self.assertEqual(config["stage"], "draft")

    def test_adds_new_key(self) -> None:
        config: dict = {}
        merged = _merge_overrides(config, layout="modular")
        self.assertEqual(merged["layout"], "modular")

    def test_multiple_overrides(self) -> None:
        config = {"stage": "draft", "layout": "flat"}
        merged = _merge_overrides(config, stage="public", layout="modular")
        self.assertEqual(merged["stage"], "public")
        self.assertEqual(merged["layout"], "modular")


class DiffLocaleMapsTests(unittest.TestCase):
    def test_detects_added_and_updated_keys(self) -> None:
        old = {"sign_in": "Login", "password": "Password"}
        new = {"sign_in": "Sign in", "password": "Password", "sign_up": "Create account"}
        added, updated = _diff_locale_maps(old, new)
        self.assertEqual(added, ["sign_up"])
        self.assertEqual(updated, ["sign_in"])


class GroupPullChangesTests(unittest.TestCase):
    def test_groups_locales_under_module_key(self) -> None:
        root = Path("/tmp/locales")
        reports = [
            PulledFileReport(
                path=root / "auth" / "vi.json",
                new_keys=["sign_up"],
                updated_keys=["auth.email"],
            ),
            PulledFileReport(
                path=root / "auth" / "en.json",
                updated_keys=["auth.email"],
            ),
        ]
        self.assertEqual(
            group_pull_changes(reports, output_dir=root, attr="new_keys"),
            [ChangeItem(key="auth/sign_up", extra="vi")],
        )
        self.assertEqual(
            group_pull_changes(reports, output_dir=root, attr="updated_keys"),
            [ChangeItem(key="auth/auth.email", extra="vi, en")],
        )

    def test_flat_layout_keeps_bare_key(self) -> None:
        root = Path("/tmp/locales")
        reports = [
            PulledFileReport(path=root / "vi.json", new_keys=["sign_in"]),
        ]
        self.assertEqual(file_module_locale(root / "vi.json", root), (None, "vi"))
        self.assertEqual(
            group_pull_changes(reports, output_dir=root, attr="new_keys"),
            [ChangeItem(key="sign_in", extra="vi")],
        )


class ScopedKeyTests(unittest.TestCase):
    def test_joins_module_and_json_key(self) -> None:
        self.assertEqual(scoped_key("auth", "auth.email"), "auth/auth.email")

    def test_does_not_encode_dots(self) -> None:
        self.assertEqual(scoped_key("home", "title"), "home/title")


class ModularPushBodyTests(unittest.TestCase):
    def test_nests_base_language_under_each_module(self) -> None:
        modules = {
            "auth": {"auth.email": "Email", "password": "Password"},
            "home": {"title": "Home"},
        }
        self.assertEqual(
            build_modular_push_body(modules, "vi"),
            {
                "modules": {
                    "auth": {"vi": {"auth.email": "Email", "password": "Password"}},
                    "home": {"vi": {"title": "Home"}},
                }
            },
        )


class ModularStatusHelpersTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write(self, *parts: str, data: dict) -> None:
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def test_load_unassigned_base(self) -> None:
        self._write(UNASSIGNED_SLUG, "vi.json", data={"orphan": "X"})
        self.assertEqual(load_unassigned_base(self.root, "vi"), {"orphan": "X"})

    def test_collect_local_keys_includes_modules_and_unassigned(self) -> None:
        self._write("auth", "vi.json", data={"auth.email": "Email"})
        self._write(UNASSIGNED_SLUG, "vi.json", data={"loose": "Hi"})
        keys = collect_modular_local_keys(self.root, "vi")
        self.assertEqual(
            keys,
            {"auth/auth.email": "Email", f"{UNASSIGNED_SLUG}/loose": "Hi"},
        )

    def test_collect_remote_keys_from_modular_export(self) -> None:
        export = {
            "modules": {
                "auth": {
                    "vi": {"auth.email": "Email"},
                    "en": {"auth.email": "Email Address"},
                }
            },
            "unassigned": {"vi": {"loose": "Hi"}, "en": {}},
        }
        keys = collect_modular_remote_keys(export, "vi")
        self.assertEqual(
            keys,
            {"auth/auth.email": "Email", f"{UNASSIGNED_SLUG}/loose": "Hi"},
        )

    def test_count_untranslated_walks_modules(self) -> None:
        export = {
            "modules": {
                "auth": {
                    "vi": {"auth.email": "Email", "password": "Mật khẩu"},
                    "en": {"auth.email": "Email", "password": ""},
                }
            },
            "unassigned": {"vi": {"loose": "Hi"}, "en": {"loose": ""}},
        }
        counts = count_modular_untranslated(
            export, base_language="vi", target_locales=["en"]
        )
        self.assertEqual(counts, {"en": 2})


class ParseApiErrorTests(unittest.TestCase):
    def test_parses_string_detail(self) -> None:
        response = Mock()
        response.status_code = 400
        response.json.return_value = {"detail": "strings required"}
        response.text = '{"detail":"strings required"}'
        self.assertEqual(_parse_api_error(response), "strings required")

    def test_parses_validation_errors(self) -> None:
        response = Mock()
        response.status_code = 422
        response.json.return_value = {
            "detail": [{"loc": ["body", "strings"], "msg": "field required"}]
        }
        response.text = "{}"
        self.assertIn("field required", _parse_api_error(response))

    def test_falls_back_to_response_text(self) -> None:
        response = Mock()
        response.status_code = 500
        response.json.side_effect = json.JSONDecodeError("err", "doc", 0)
        response.text = "Internal Server Error"
        self.assertEqual(_parse_api_error(response), "Internal Server Error")


if __name__ == "__main__":
    unittest.main()
