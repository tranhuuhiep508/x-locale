"""CLI E2E: push writes working copy only (XLOCALE-26), public pull omits unpublished (XLOCALE-27)."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import httpx
import pytest

from .support import (
    api_key_client,
    combined_output,
    create_module,
    create_string,
    export_flat_keys,
    export_modular_keys,
    find_string_by_key,
    publish_strings,
    run_locale,
    unpublish_strings,
    write_config,
    write_json,
)

pytestmark = pytest.mark.e2e


def _unique_key(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class TestPushWritesWorkingCopyNotPublish:
    """XLOCALE-26: locale push updates draft/working copy; public snapshot unchanged until publish."""

    def test_flat_push_stays_draft_and_absent_from_public_export(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        key = _unique_key("flat_push")
        write_json(workspace / "locales" / "vi.json", {key: "Nguồn push"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        push = run_locale(workspace, "push")
        assert push.returncode == 0, combined_output(push)
        assert "fingerprint" not in combined_output(push).lower()

        with api_key_client(api_base_url, flat_project.api_key) as client:
            row = find_string_by_key(client, flat_project.id, key)
            assert row is not None
            assert row["status"] == "draft"
            assert row.get("published_key") is None
            assert key in export_flat_keys(client, flat_project.id, stage="draft")
            assert key not in export_flat_keys(client, flat_project.id, stage="public")

    def test_flat_pull_public_omits_until_api_publish(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        key = _unique_key("flat_pull")
        write_json(workspace / "locales" / "vi.json", {key: "Trước publish"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )
        run_locale(workspace, "push")

        pull_public = run_locale(workspace, "pull", "--stage", "public")
        assert pull_public.returncode == 0, combined_output(pull_public)
        vi_public = json.loads((workspace / "locales" / "vi.json").read_text(encoding="utf-8"))
        assert key not in vi_public

        with api_key_client(api_base_url, flat_project.api_key) as client:
            row = find_string_by_key(client, flat_project.id, key)
            assert row is not None
        publish_strings(admin_client, flat_project.id, [row["id"]])

        pull_after = run_locale(workspace, "pull", "--stage", "public")
        assert pull_after.returncode == 0, combined_output(pull_after)
        vi_after = json.loads((workspace / "locales" / "vi.json").read_text(encoding="utf-8"))
        assert vi_after[key] == "Trước publish"

    def test_modular_push_stays_draft_and_absent_from_public_export(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        modular_project,
    ) -> None:
        module_slug = "auth"
        create_module(admin_client, modular_project.id, module_slug)
        key = _unique_key("mod_push")
        write_json(workspace / "locales" / module_slug / "vi.json", {key: "Modular push"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=modular_project.api_key,
            project_id=modular_project.id,
            layout="modular",
            base_language="vi",
            locales=["vi", "en"],
        )

        push = run_locale(workspace, "push")
        assert push.returncode == 0, combined_output(push)

        with api_key_client(api_base_url, modular_project.api_key) as client:
            row = find_string_by_key(client, modular_project.id, key)
            assert row is not None
            assert row["status"] == "draft"
            assert key in export_modular_keys(
                client, modular_project.id, stage="draft", module_slug=module_slug
            )
            assert key not in export_modular_keys(
                client, modular_project.id, stage="public", module_slug=module_slug
            )

    def test_cli_has_no_publish_subcommand(self, workspace: Path) -> None:
        result = run_locale(workspace, "publish", timeout=15.0)
        assert result.returncode != 0
        output = combined_output(result).lower()
        assert "no such command" in output or "unknown" in output or "publish" in output


class TestPullPublicOmitsUnpublishedKeepSnapshot:
    """XLOCALE-27: after unpublish, public pull omits key; draft pull still has working copy."""

    def test_unpublished_string_omitted_from_public_pull_included_in_draft(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        key = _unique_key("unpub")
        created = create_string(
            admin_client,
            flat_project.id,
            key=key,
            source_text="Đã publish",
            status="public",
            translations={"en": "Was public"},
        )
        publish_strings(admin_client, flat_project.id, [created["id"]])
        admin_client.patch(
            f"/api/projects/{flat_project.id}/strings/{created['id']}",
            json={"source_text": "Bản làm việc", "translations": {"en": "Working"}},
        )
        unpublish_strings(admin_client, flat_project.id, [created["id"]])

        detail = admin_client.get(
            f"/api/projects/{flat_project.id}/strings/{created['id']}"
        ).json()
        assert detail["status"] == "draft"
        assert detail["published_source_text"] == "Đã publish"
        assert detail["published_key"] == key

        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        pull_public = run_locale(workspace, "pull", "--stage", "public")
        assert pull_public.returncode == 0, combined_output(pull_public)
        vi_public = json.loads((workspace / "locales" / "vi.json").read_text(encoding="utf-8"))
        en_public = json.loads((workspace / "locales" / "en.json").read_text(encoding="utf-8"))
        assert key not in vi_public
        assert key not in en_public

        pull_draft = run_locale(workspace, "pull", "--stage", "draft")
        assert pull_draft.returncode == 0, combined_output(pull_draft)
        vi_draft = json.loads((workspace / "locales" / "vi.json").read_text(encoding="utf-8"))
        en_draft = json.loads((workspace / "locales" / "en.json").read_text(encoding="utf-8"))
        assert vi_draft[key] == "Bản làm việc"
        assert en_draft[key] == "Working"

        with api_key_client(api_base_url, flat_project.api_key) as client:
            assert key not in export_flat_keys(client, flat_project.id, stage="public", locale="vi")
            assert key in export_flat_keys(client, flat_project.id, stage="draft", locale="vi")
