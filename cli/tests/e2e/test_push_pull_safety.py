"""Real CLI processes must preserve content and fail before destructive sync phases."""

from __future__ import annotations

import json

import pytest

from .support import (
    combined_output,
    create_module,
    create_string,
    create_test_project,
    publish_strings,
    run_locale,
    write_config,
    write_json,
)

pytestmark = pytest.mark.e2e


def _workspace(workspace, api_base_url, project):
    write_config(
        workspace,
        api_url=api_base_url,
        api_key=project.api_key,
        project_id=project.id,
        layout=project.layout,
        base_language="vi",
        locales=["vi", "en"],
    )
    return workspace / "locales" / ("auth/vi.json" if project.layout == "modular" else "vi.json")


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_sync_preserves_json_punctuation_and_empty_sources(
    workspace, api_base_url, admin_client, layout
):
    project = create_test_project(admin_client, layout=layout)
    source = _workspace(workspace, api_base_url, project)
    strings = {
        "punctuation, }": 'Đăng nhập, } and, ] with "quote" and \\',
        "blank": "",
        "icu": "{n, plural, one {One} other {Many, }}",
    }
    write_json(source, strings)
    result = run_locale(workspace, "sync")
    assert result.returncode == 0, combined_output(result)
    assert json.loads(source.read_text()) == strings
    repeat = run_locale(workspace, "push")
    assert repeat.returncode == 0, combined_output(repeat)
    assert "Nothing to push" in repeat.stdout
    assert json.loads((workspace / ".x-locale/push-index.json").read_text())["version"] == 2
    listed = admin_client.get(f"/api/projects/{project.id}/strings").json()["items"]
    publish_strings(admin_client, project.id, [row["id"] for row in listed])
    public = run_locale(workspace, "pull", "--stage", "public")
    assert public.returncode == 0, combined_output(public)
    assert json.loads(source.read_text()) == strings


@pytest.mark.parametrize("layout", ["flat", "modular"])
def test_cli_accepts_base_language_also_in_project_targets(
    workspace, api_base_url, admin_client, layout
):
    project = create_test_project(admin_client, layout=layout, target_languages=["en", "vi"])
    source = _workspace(workspace, api_base_url, project)
    strings = {"hello": "Xin chào"}
    write_json(source, strings)
    for command in ("push", "pull", "sync", "status"):
        result = run_locale(workspace, command)
        assert result.returncode == 0, combined_output(result)
        assert json.loads(source.read_text()) == strings


@pytest.mark.parametrize("layout", ["flat", "modular"])
@pytest.mark.parametrize("deletion", ["pending", "tombstone"])
def test_sync_rejects_deleted_cached_keys_before_pull(
    workspace, api_base_url, admin_client, layout, deletion
):
    project = create_test_project(admin_client, layout=layout)
    source = _workspace(workspace, api_base_url, project)
    write_json(source, {"gone": "Old"})
    first = run_locale(workspace, "push")
    assert first.returncode == 0, combined_output(first)
    row = admin_client.get(f"/api/projects/{project.id}/strings").json()["items"][0]
    if deletion == "pending":
        publish_strings(admin_client, project.id, [row["id"]])
    admin_client.delete(f"/api/projects/{project.id}/strings/{row['id']}").raise_for_status()
    index = workspace / ".x-locale/push-index.json"
    before = index.read_bytes()
    source_before = source.read_bytes()
    result = run_locale(workspace, "sync")
    assert result.returncode == 1, combined_output(result)
    assert "Restore them" in combined_output(result)
    assert source.read_bytes() == source_before
    assert index.read_bytes() == before
    assert not (workspace / ".x-locale/push-index.pending").exists()
    detail = admin_client.get(f"/api/projects/{project.id}/strings/{row['id']}").json()
    if deletion == "pending":
        assert detail["pending_delete"]
    else:
        assert detail["deleted_at"] is not None
    write_json(source, {"gone": "Local edit", "fresh": "Must not upload"})
    full = run_locale(workspace, "push", "--full")
    assert full.returncode == 1, combined_output(full)
    draft = admin_client.get(f"/api/projects/{project.id}/export", params={"layout": "flat"}).json()
    assert "fresh" not in draft["vi"]


def test_stale_base_config_does_not_overwrite_server_source(
    workspace, api_base_url, admin_client, flat_project
):
    row = create_string(admin_client, flat_project.id, key="hello", source_text="Xin chào")
    write_config(
        workspace,
        api_url=api_base_url,
        api_key=flat_project.api_key,
        project_id=flat_project.id,
        base_language="en",
        locales=["en"],
    )
    source = workspace / "locales/en.json"
    write_json(source, {"hello": "English local"})
    result = run_locale(workspace, "sync")
    assert result.returncode == 1, combined_output(result)
    assert "does not match" in combined_output(result)
    detail = admin_client.get(f"/api/projects/{flat_project.id}/strings/{row['id']}").json()
    assert detail["source_text"] == "Xin chào"
    assert json.loads(source.read_text()) == {"hello": "English local"}
    assert not (workspace / ".x-locale/push-index.json").exists()


def test_invalid_modular_source_is_not_overwritten_by_sync(
    workspace, api_base_url, admin_client, modular_project
):
    valid = _workspace(workspace, api_base_url, modular_project)
    write_json(valid, {"valid": "Valid"})
    bad = workspace / "locales/bad/vi.json"
    bad.parent.mkdir()
    text = '[{"local_only":"Unuploaded work"}]'
    bad.write_text(text)
    result = run_locale(workspace, "sync")
    assert result.returncode == 1, combined_output(result)
    assert "bad/vi.json" in combined_output(result)
    assert bad.read_text() == text
    assert admin_client.get(f"/api/projects/{modular_project.id}/strings").json()["items"] == []
    assert admin_client.get(f"/api/projects/{modular_project.id}/modules").json() == []


@pytest.mark.parametrize("deletion", ["pending", "tombstone"])
def test_push_respects_module_scoped_deleted_keys(
    workspace, api_base_url, admin_client, deletion
):
    project = create_test_project(admin_client, layout="modular")
    root = f"/api/projects/{project.id}"
    admin_client.patch(root, json={"allow_duplicate_keys": True}).raise_for_status()
    auth_module = create_module(admin_client, project.id, "auth")
    home_module = create_module(admin_client, project.id, "home")
    auth = create_string(
        admin_client, project.id, key="title", source_text="Auth", module_id=auth_module["id"]
    )
    home = create_string(
        admin_client, project.id, key="title", source_text="Home", module_id=home_module["id"]
    )
    source = _workspace(workspace, api_base_url, project)
    write_json(source, {"title": "Auth"})
    first = run_locale(workspace, "push")
    assert first.returncode == 0, combined_output(first)
    if deletion == "pending":
        publish_strings(admin_client, project.id, [home["id"]])
    admin_client.delete(f"{root}/strings/{home['id']}").raise_for_status()
    write_json(source, {"title": "Updated auth"})
    result = run_locale(workspace, "push")
    assert result.returncode == 0, combined_output(result)
    saved = admin_client.get(f"{root}/strings/{auth['id']}")
    saved.raise_for_status()
    assert saved.json()["source_text"] == "Updated auth"
    removed = admin_client.get(f"{root}/strings/{home['id']}")
    removed.raise_for_status()
    if deletion == "pending":
        assert removed.json()["pending_delete"]
    else:
        assert removed.json()["deleted_at"] is not None

    # The actual deleted identity must still block the whole push.
    write_json(workspace / "locales/home/vi.json", {"title": "Must not restore"})
    index = workspace / ".x-locale/push-index.json"
    before = index.read_bytes()
    rejected = run_locale(workspace, "push")
    assert rejected.returncode == 1, combined_output(rejected)
    assert "home/title" in combined_output(rejected)
    assert index.read_bytes() == before
    assert not (workspace / ".x-locale/push-index.pending").exists()
