"""CLI ship-gate E2E tests against a live seeded API (XLOCALE-11)."""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import pytest
import yaml

from .support import (
    api_key_client,
    combined_output,
    create_module,
    create_string,
    create_test_project,
    list_string_keys,
    publish_strings,
    run_locale,
    write_config,
    write_json,
)

pytestmark = pytest.mark.e2e


class TestInit:
    def test_init_writes_config_from_bootstrap(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        result = run_locale(
            workspace,
            "init",
            "-k",
            flat_project.api_key,
            "-u",
            api_base_url,
            "-o",
            "./src/locales",
            "-y",
        )
        assert result.returncode == 0, combined_output(result)
        assert "Initialized" in result.stdout

        config_path = workspace / ".x-locale" / "config.yaml"
        assert config_path.exists()
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        assert config["api_url"] == api_base_url
        assert config["api_key"] == flat_project.api_key
        assert config["project_id"] == flat_project.id
        assert config["output_dir"] == "./src/locales"
        assert config["layout"] == "flat"
        assert config["base_language"] == "vi"
        assert "en" in config["locales"]


class TestPush:
    def test_flat_push_creates_and_updates_strings(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        locales_dir = workspace / "locales"
        write_json(locales_dir / "vi.json", {"hello": "Xin chào", "save": "Lưu"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        first = run_locale(workspace, "push")
        assert first.returncode == 0, combined_output(first)
        assert "Created" in first.stdout

        with api_key_client(api_base_url, flat_project.api_key) as client:
            keys = list_string_keys(client, flat_project.id)
        assert keys == {"hello", "save"}

        write_json(locales_dir / "vi.json", {"hello": "Chào", "save": "Lưu", "new_key": "Mới"})
        second = run_locale(workspace, "push")
        assert second.returncode == 0, combined_output(second)
        assert "Updated" in second.stdout or "Created" in second.stdout

        with api_key_client(api_base_url, flat_project.api_key) as client:
            keys = list_string_keys(client, flat_project.id)
        assert keys == {"hello", "save", "new_key"}

    def test_modular_push_creates_module_strings(
        self,
        workspace: Path,
        api_base_url: str,
        modular_project,
    ) -> None:
        locales_dir = workspace / "locales"
        write_json(locales_dir / "auth" / "vi.json", {"sign_in": "Đăng nhập"})
        write_json(locales_dir / "home" / "vi.json", {"welcome": "Chào mừng"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=modular_project.api_key,
            project_id=modular_project.id,
            layout="modular",
            base_language="vi",
            locales=["vi", "en"],
        )

        result = run_locale(workspace, "push")
        assert result.returncode == 0, combined_output(result)
        assert "Created" in result.stdout

        with api_key_client(api_base_url, modular_project.api_key) as client:
            keys = list_string_keys(client, modular_project.id)
        assert "sign_in" in keys
        assert "welcome" in keys

    def test_push_reports_orphans_without_deleting(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        create_string(
            admin_client,
            flat_project.id,
            key="remote_only",
            source_text="Chỉ trên server",
        )
        write_json(workspace / "locales" / "vi.json", {"local_only": "Chỉ local"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
        )

        result = run_locale(workspace, "push")
        assert result.returncode == 0, combined_output(result)
        assert "On x-locale, not in local files" in result.stdout
        assert "remote_only" in result.stdout

        with api_key_client(api_base_url, flat_project.api_key) as client:
            keys = list_string_keys(client, flat_project.id)
        assert "remote_only" in keys
        assert "local_only" in keys


class TestPushDryRun:
    def test_dry_run_reports_without_writing(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        write_json(workspace / "locales" / "vi.json", {"dry": "Thử"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
        )

        result = run_locale(workspace, "push", "--dry-run")
        assert result.returncode == 0, combined_output(result)
        assert "dry run" in result.stdout.lower()
        assert "Created" in result.stdout

        with api_key_client(api_base_url, flat_project.api_key) as client:
            keys = list_string_keys(client, flat_project.id)
        assert keys == set()


class TestPull:
    def test_pull_draft_omits_pending_delete(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        live = create_string(
            admin_client,
            flat_project.id,
            key="live",
            source_text="Còn",
            status="public",
            translations={"en": "Live"},
        )
        pending = create_string(
            admin_client,
            flat_project.id,
            key="pending",
            source_text="Xóa",
            status="public",
            translations={"en": "Delete"},
        )
        publish_strings(admin_client, flat_project.id, [live["id"], pending["id"]])
        admin_client.delete(f"/api/projects/{flat_project.id}/strings/{pending['id']}")

        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        result = run_locale(workspace, "pull", "--stage", "draft")
        assert result.returncode == 0, combined_output(result)

        vi = json.loads((workspace / "locales" / "vi.json").read_text(encoding="utf-8"))
        en = json.loads((workspace / "locales" / "en.json").read_text(encoding="utf-8"))
        assert "live" in vi
        assert "pending" not in vi
        assert "live" in en
        assert "pending" not in en

    def test_pull_public_uses_published_snapshot(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        created = create_string(
            admin_client,
            flat_project.id,
            key="greet",
            source_text="Xin chào",
            status="public",
            translations={"en": "Hello"},
        )
        publish_strings(admin_client, flat_project.id, [created["id"]])

        admin_client.patch(
            f"/api/projects/{flat_project.id}/strings/{created['id']}",
            json={"source_text": "Chào bạn", "translations": {"en": "Hi there"}},
        )

        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        result = run_locale(workspace, "pull", "--stage", "public")
        assert result.returncode == 0, combined_output(result)

        vi = json.loads((workspace / "locales" / "vi.json").read_text(encoding="utf-8"))
        en = json.loads((workspace / "locales" / "en.json").read_text(encoding="utf-8"))
        assert vi["greet"] == "Xin chào"
        assert en["greet"] == "Hello"


class TestStatus:
    def test_status_exit_zero_when_in_sync(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        write_json(workspace / "locales" / "vi.json", {"synced": "Đồng bộ"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
        )
        run_locale(workspace, "push")

        result = run_locale(workspace, "status")
        assert result.returncode == 0, combined_output(result)
        output = combined_output(result)
        assert "Missing locally" not in output
        assert "Source text differs" not in output

    def test_status_exit_one_for_missing_extra_and_source_differs(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        create_string(
            admin_client,
            flat_project.id,
            key="remote",
            source_text="Server",
        )
        write_json(
            workspace / "locales" / "vi.json",
            {"local_only": "Local", "shared": "Khác"},
        )
        create_string(
            admin_client,
            flat_project.id,
            key="shared",
            source_text="Gốc",
        )
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
        )

        result = run_locale(workspace, "status")
        assert result.returncode == 1, combined_output(result)
        output = combined_output(result)
        assert "Missing locally" in output
        assert "Local only" in output or "not on x-locale" in output
        assert "Source text differs" in output


class TestSync:
    def test_sync_push_then_pull(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        write_json(workspace / "locales" / "vi.json", {"sync_key": "Đồng bộ"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        result = run_locale(workspace, "sync")
        assert result.returncode == 0, combined_output(result)
        assert "Sync summary" in result.stdout
        assert (workspace / "locales" / "vi.json").exists()
        assert (workspace / "locales" / "en.json").exists()

    def test_sync_exit_one_when_leftovers_remain(
        self,
        workspace: Path,
        api_base_url: str,
        modular_project,
    ) -> None:
        locales_dir = workspace / "locales"
        write_json(locales_dir / "auth" / "vi.json", {"sign_in": "Đăng nhập"})
        write_json(locales_dir / "_unassigned" / "vi.json", {"stray": "Lạc"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=modular_project.api_key,
            project_id=modular_project.id,
            layout="modular",
            base_language="vi",
            locales=["vi", "en"],
        )

        result = run_locale(workspace, "sync")
        assert result.returncode == 1, combined_output(result)
        output = combined_output(result)
        assert "issue" in output.lower()
        assert "_unassigned" in output


class TestAuth:
    def test_bad_api_key_exits_nonzero_without_hanging(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        write_config(
            workspace,
            api_url=api_base_url,
            api_key="xlocale_invalid_key_000000000000000000000000",
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
        )
        write_json(workspace / "locales" / "vi.json", {"x": "y"})

        started = time.monotonic()
        result = run_locale(workspace, "status", timeout=15.0)
        elapsed = time.monotonic() - started

        assert result.returncode == 1
        assert elapsed < 10.0
        assert "Invalid API key" in combined_output(result) or "401" in combined_output(result)


class TestShouldCoverage:
    def test_unassigned_not_pushed(
        self,
        workspace: Path,
        api_base_url: str,
        modular_project,
    ) -> None:
        locales_dir = workspace / "locales"
        write_json(locales_dir / "auth" / "vi.json", {"sign_in": "Đăng nhập"})
        write_json(locales_dir / "_unassigned" / "vi.json", {"orphan": "Không gán"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=modular_project.api_key,
            project_id=modular_project.id,
            layout="modular",
            base_language="vi",
        )

        result = run_locale(workspace, "push")
        assert result.returncode == 0, combined_output(result)

        with api_key_client(api_base_url, modular_project.api_key) as client:
            keys = list_string_keys(client, modular_project.id)
        assert "sign_in" in keys
        assert "orphan" not in keys

        status = run_locale(workspace, "status")
        assert status.returncode == 1, combined_output(status)
        assert "_unassigned" in combined_output(status)

    def test_pull_skips_rewrite_when_unchanged(
        self,
        workspace: Path,
        api_base_url: str,
        flat_project,
    ) -> None:
        write_json(workspace / "locales" / "vi.json", {"stable": "Ổn định"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )
        run_locale(workspace, "sync")

        target = workspace / "locales" / "en.json"
        mtime_before = target.stat().st_mtime

        second = run_locale(workspace, "pull")
        assert second.returncode == 0, combined_output(second)
        assert "already up to date" in second.stdout.lower() or "Checked" in second.stdout
        assert target.stat().st_mtime == mtime_before

    def test_single_locale_pull_and_status_for_base(
        self,
        workspace: Path,
        api_base_url: str,
        admin_client: httpx.Client,
        flat_project,
    ) -> None:
        created = create_string(
            admin_client,
            flat_project.id,
            key="only_en",
            source_text="Chỉ EN",
            translations={"en": "Only EN"},
        )
        publish_strings(admin_client, flat_project.id, [created["id"]])

        write_json(workspace / "locales" / "vi.json", {"only_en": "Chỉ EN"})
        write_config(
            workspace,
            api_url=api_base_url,
            api_key=flat_project.api_key,
            project_id=flat_project.id,
            layout="flat",
            base_language="vi",
            locales=["vi", "en"],
        )

        pull = run_locale(workspace, "pull", "--locales", "en", "--stage", "public")
        assert pull.returncode == 0, combined_output(pull)
        assert (workspace / "locales" / "en.json").exists()
        en = json.loads((workspace / "locales" / "en.json").read_text(encoding="utf-8"))
        assert en["only_en"] == "Only EN"
        assert (workspace / "locales" / "vi.json").exists()

        status = run_locale(workspace, "status", "--stage", "draft")
        assert status.returncode == 0, combined_output(status)
