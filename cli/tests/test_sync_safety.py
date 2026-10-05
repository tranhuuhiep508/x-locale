"""Regression coverage for push/pull validation and failure atomicity."""

from __future__ import annotations

import json
from dataclasses import replace
from importlib import import_module

import httpx
import pytest
from tests.sync_support import export_for_request, sync_state
from tests.test_init import fake_bootstrap
from typer.testing import CliRunner
from x_locale_cli.app import app
from x_locale_cli.commands.sync import sync
from x_locale_cli.errors import XLocaleError
from x_locale_cli.io import load_json_file
from x_locale_cli.models import Config, Layout, Stage
from x_locale_cli.ops import pull_translations, push_strings, show_status
from x_locale_cli.push_index import (
    atomic_write_push_index,
    catalog_hashes_flat,
    index_file_path,
    pending_file_path,
    scope_from_config,
)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".x-locale").mkdir()
    return tmp_path


def config_for(root, layout="flat"):
    config = Config(
        api_url="https://example.test",
        api_key="test",
        project_slug="demo",
        output_dir=str(root / "locales"),
        layout=Layout(layout),
        base_language="vi",
    )
    path = config.output_path / ("auth/vi.json" if layout == "modular" else "vi.json")
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"k": "Local"}))
    return config


def modular_export():
    return {
        "modules": {"auth": {"vi": {"k": "Remote"}, "en": {}}},
        "unassigned": {"vi": {}, "en": {}},
        "manifest": {
            "modules": ["auth"],
            "locales": ["vi", "en"],
            "base_language": "vi",
            "future": True,
        },
    }


class Api:
    def __init__(self, config, export=None):
        self.state = sync_state(config)
        self.export = export if export is not None else {"vi": {"k": "Remote"}, "en": {}}
        self.calls = []
        self.import_status = 200
        self.import_body = {"created": 0, "updated": 0, "total": 1, "dry_run": False, "diff": {}}
        self.client = httpx.Client(
            transport=httpx.MockTransport(self.handle), base_url=config.api_url
        )

    def handle(self, request):
        self.calls.append(request)
        if request.url.path.endswith("/sync-state"):
            data = {**self.state, "stage": request.url.params["stage"]}
        elif request.url.path.endswith("/export"):
            data = (
                export_for_request(self.export, dict(request.url.params))
                if isinstance(self.export, dict)
                else self.export
            )
        else:
            return httpx.Response(self.import_status, json=self.import_body)
        return httpx.Response(
            200, content=json.dumps(data), headers={"Content-Type": "application/json"}
        )


def snapshot(root):
    return {
        str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()
    }


@pytest.mark.parametrize(
    "value",
    [
        "Comma, } and comma, ]",
        'Escaped quote " then, } and backslash \\',
        "Đăng nhập 日本語, }",
        "{count, plural, one {One} other {Many, }}",
        'Two backslashes \\\\ followed by a quote " and, ]',
    ],
)
def test_trailing_comma_support_preserves_all_quoted_text(tmp_path, value):
    path = tmp_path / "vi.json"
    data = {"key, }": value}
    path.write_text(json.dumps(data, ensure_ascii=False)[:-1] + ",\n}")
    assert load_json_file(path) == data


@pytest.mark.parametrize(
    "text", ['{"k": /*comment*/ "v"}', '{"k": "v",,}', '{"k": "v",\n"next": }']
)
def test_other_invalid_json_is_rejected(tmp_path, text):
    path = tmp_path / "vi.json"
    path.write_text(text)
    with pytest.raises(XLocaleError, match="Invalid JSON"):
        load_json_file(path)


@pytest.mark.parametrize("data", [[], None, 1, "text", {"k": {}}, {"k": False}])
def test_invalid_modular_source_stops_sync_before_any_http_or_write(workspace, monkeypatch, data):
    config = config_for(workspace, "modular")
    bad = config.output_path / "bad/vi.json"
    bad.parent.mkdir()
    bad.write_text(json.dumps(data))
    before = snapshot(workspace)
    api = Api(config, modular_export())
    command = import_module("x_locale_cli.commands.sync")
    monkeypatch.setattr(command, "runtime_config", lambda **kwargs: config)
    monkeypatch.setattr(command, "api_client", lambda config: api.client)
    with pytest.raises(XLocaleError, match="bad/vi.json"):
        sync()
    assert api.calls == []
    assert snapshot(workspace) == before


@pytest.mark.parametrize("layout", ["flat", "modular"])
@pytest.mark.parametrize("field", ["pending_remove", "tombstones"])
@pytest.mark.parametrize("options", [{}, {"dry_run": True}, {"full": True}])
def test_deleted_keys_reject_whole_push_even_after_cached_success(
    workspace, layout, field, options
):
    config = config_for(workspace, layout)
    api = Api(config)
    push_strings(config, client=api.client)
    pending_file_path().write_text("preexisting")
    before = snapshot(workspace)
    # Different module labels must not allow a folder move to bypass the decision.
    api.state[field] = ["other/k"] if layout == "modular" else ["k"]
    api.calls.clear()
    with pytest.raises(XLocaleError, match="Restore them"):
        push_strings(config, client=api.client, **options)
    assert [request.method for request in api.calls] == ["GET"]
    assert api.calls[0].url.params["stage"] == "draft"
    assert snapshot(workspace) == before


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_empty_delta_still_reads_state_but_skips_import(workspace, layout):
    config = config_for(workspace, layout)
    api = Api(config)
    push_strings(config, client=api.client)
    api.calls.clear()
    push_strings(config, client=api.client)
    assert len(api.calls) == 1
    assert api.calls[0].url.path.endswith("/sync-state")
    assert api.calls[0].method == "GET"


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_stale_base_language_rejects_cached_push(workspace, layout):
    config = config_for(workspace, layout)
    api = Api(config)
    push_strings(config, client=api.client)
    before = snapshot(workspace)
    api.state.update(base_language="en", locales=["en", "vi"])
    api.calls.clear()
    with pytest.raises(XLocaleError, match="does not match"):
        push_strings(config, client=api.client)
    assert len(api.calls) == 1
    assert snapshot(workspace) == before


@pytest.mark.parametrize("preexisting", [False, True])
def test_backend_conflict_preserves_index_and_marker_rules(workspace, preexisting):
    config = config_for(workspace)
    atomic_write_push_index(scope_from_config(config), {})
    if preexisting:
        pending_file_path().write_text("preexisting")
    before = index_file_path().read_bytes()
    api = Api(config)
    api.import_status = 409
    api.import_body = {
        "detail": {
            "code": "push_deleted_keys",
            "message": "Restore the deleted keys.",
            "pending_remove": ["k"],
            "tombstones": [],
        }
    }
    with pytest.raises(XLocaleError, match="Pending remove: k"):
        push_strings(config, client=api.client)
    assert index_file_path().read_bytes() == before
    assert pending_file_path().exists() == preexisting
    assert [request.method for request in api.calls] == ["GET", "POST"]


def test_version_one_index_forces_full_payload(workspace):
    config = config_for(workspace)
    old_scope = replace(scope_from_config(config), version=1)
    atomic_write_push_index(old_scope, catalog_hashes_flat({"k": "Local"}))
    api = Api(config)
    push_strings(config, client=api.client)
    post = api.calls[-1]
    assert "partial" not in post.url.params
    assert json.loads(post.content) == {"strings": {"k": "Local"}, "base_language": "vi"}
    assert json.loads(index_file_path().read_text())["version"] == 2


@pytest.mark.parametrize("base", ["vi", "en"])
def test_init_base_override_must_match_and_preserve_existing_config(workspace, base):
    existing = workspace / ".x-locale/config.yaml"
    existing.write_text("keep: true\n")
    with fake_bootstrap():
        result = CliRunner().invoke(app, ["init", "-k", "test", "--base-language", base, "--yes"])
    if base == "en":
        assert result.exit_code == 1
        assert existing.read_text() == "keep: true\n"
        assert "does not match" in result.output
    else:
        assert result.exit_code == 0, result.output
        assert "base_language: vi" in existing.read_text()


@pytest.mark.parametrize(
    "export",
    [
        None,
        [],
        {},
        {"detail": "Oops"},
        {"vi": {}},
        {"vi": {"k": 1}, "en": {}},
        {"vi": {}, "en": {"k": {"nested": "bad"}}},
    ],
)
def test_malformed_flat_export_leaves_every_file_and_marker_unchanged(workspace, export):
    config = config_for(workspace)
    (workspace / ".x-locale/push-index.json").write_text("old index")
    pending_file_path().write_text("preexisting")
    api = Api(config)
    api.export = export
    before = snapshot(workspace)
    with pytest.raises(XLocaleError, match="Invalid server response"):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before


@pytest.mark.parametrize(
    "mutate",
    [
        lambda e: e.pop("modules"),
        lambda e: e.pop("unassigned"),
        lambda e: e["modules"]["auth"].pop("en"),
        lambda e: e["modules"]["auth"]["en"].update(k=None),
        lambda e: e["manifest"].update(modules=["wrong"]),
        lambda e: e["manifest"].update(locales=["vi"]),
        lambda e: e["manifest"].update(base_language="en"),
        lambda e: e["manifest"].update(content_hash=None),
        lambda e: e["modules"].update({"../escape": {"vi": {}, "en": {}}}),
    ],
)
def test_malformed_modular_export_is_rejected_before_writing(workspace, mutate):
    config = config_for(workspace, "modular")
    export = modular_export()
    mutate(export)
    before = snapshot(workspace)
    api = Api(config, export)
    with pytest.raises(XLocaleError):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before


def test_malformed_out_of_scope_map_is_not_ignored(workspace):
    config = replace(config_for(workspace), locales=["vi", "ko"])
    api = Api(config, {"vi": {"k": "Remote"}, "en": {"k": False}})
    before = snapshot(workspace)
    with pytest.raises(XLocaleError):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_invalid_export_does_not_create_output_directory(workspace, layout):
    config = replace(config_for(workspace, layout), output_dir=str(workspace / "new-directory"))
    api = Api(config)
    api.export = {}
    with pytest.raises(XLocaleError):
        pull_translations(config, client=api.client)
    assert not config.output_path.exists()
    assert not pending_file_path().exists()


def test_unsafe_later_path_does_not_write_earlier_module(workspace, tmp_path):
    config = config_for(workspace, "modular")
    outside = workspace / "outside"
    outside.mkdir()
    (config.output_path / "later").symlink_to(outside, target_is_directory=True)
    export = modular_export()
    export["modules"]["later"] = {"vi": {"danger": "Never"}, "en": {}}
    export["manifest"]["modules"].append("later")
    before = snapshot(workspace)
    api = Api(config, export)
    with pytest.raises(XLocaleError, match="outside"):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before
    assert list(outside.iterdir()) == []


def test_directory_at_later_locale_path_does_not_write_first_locale(workspace):
    config = config_for(workspace)
    (config.output_path / "en.json").mkdir()
    before = snapshot(workspace)
    api = Api(config)
    with pytest.raises(XLocaleError, match="directory"):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_valid_empty_catalog_and_empty_values_are_written(workspace, layout):
    config = config_for(workspace, layout)
    export = {"vi": {"blank": ""}, "en": {}}
    if layout == "modular":
        export = modular_export()
        export["modules"]["auth"]["vi"] = {"blank": ""}
    api = Api(config, export)
    pull_translations(config, client=api.client)
    path = config.output_path / ("auth/vi.json" if layout == "modular" else "vi.json")
    assert json.loads(path.read_text()) == {"blank": ""}
    api.export = {"vi": {}, "en": {}}
    if layout == "modular":
        api.export = {
            "modules": {},
            "unassigned": {"vi": {}, "en": {}},
            "manifest": {"modules": [], "locales": ["vi", "en"], "base_language": "vi"},
        }
    pull_translations(config, client=api.client)
    if layout == "flat":
        assert json.loads(path.read_text()) == {}
    else:
        assert not path.exists()


def test_unknown_sync_contract_fails_clearly_before_push(workspace):
    config = config_for(workspace)
    api = Api(config)
    api.state.pop("locales")
    with pytest.raises(XLocaleError, match="Update the backend"):
        push_strings(config, client=api.client)
    assert not pending_file_path().exists()
    assert not index_file_path().exists()


def test_status_rejects_invalid_flat_source_instead_of_omitting_it(workspace, monkeypatch):
    config = config_for(workspace)
    (config.output_path / "vi.json").write_text("[]")
    api = Api(config)
    monkeypatch.setattr("x_locale_cli.ops.api_client", lambda config: api.client)
    with pytest.raises(XLocaleError, match="top-level object"):
        show_status(config)


@pytest.mark.parametrize("stage", [Stage.draft, Stage.public])
def test_base_symlink_with_different_filename_still_updates_index(workspace, stage):
    config = replace(config_for(workspace), stage=stage)
    base = config.output_path / "vi.json"
    stored = config.output_path / "stored.json"
    base.rename(stored)
    base.symlink_to(stored)
    atomic_write_push_index(scope_from_config(config), {"stale": "digest"})
    api = Api(config)
    pull_translations(config, client=api.client)
    assert json.loads(stored.read_text()) == {"k": "Remote"}
    assert not pending_file_path().exists()
    if stage is Stage.draft:
        assert json.loads(index_file_path().read_text())["entries"] == catalog_hashes_flat(
            {"k": "Remote"}
        )
    else:
        assert not index_file_path().exists()


def test_aliasing_locale_files_are_rejected_before_any_write(workspace):
    config = config_for(workspace)
    (config.output_path / "en.json").symlink_to(config.output_path / "vi.json")
    before = snapshot(workspace)
    api = Api(config)
    with pytest.raises(XLocaleError, match="distinct paths"):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before


def test_aliasing_manifest_is_rejected_even_when_manifest_is_disabled(workspace):
    config = config_for(workspace, "modular")
    (config.output_path / "manifest.json").symlink_to(config.output_path / "auth/vi.json")
    before = snapshot(workspace)
    api = Api(config, modular_export())
    with pytest.raises(XLocaleError, match="distinct paths"):
        pull_translations(config, client=api.client)
    assert snapshot(workspace) == before


def test_full_empty_catalog_reports_remote_only_keys_without_deleting_them(workspace, capsys):
    config = config_for(workspace)
    (config.output_path / "vi.json").write_text("{}")
    api = Api(config)
    api.import_body["diff"] = {
        "orphan": [{"key": "remote", "source_text": "Remote"}],
        "orphan_count": 1,
    }
    push_strings(config, full=True, client=api.client)
    assert [request.method for request in api.calls] == ["GET", "POST"]
    assert json.loads(api.calls[-1].content) == {"strings": {}, "base_language": "vi"}
    assert "remote" in capsys.readouterr().out
    assert json.loads(index_file_path().read_text())["entries"] == {}
    api.calls.clear()
    push_strings(config, client=api.client)
    assert [request.method for request in api.calls] == ["GET"]
