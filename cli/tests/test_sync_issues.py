"""Classification and hint copy for local vs x-locale mismatches."""

from __future__ import annotations

import io
import unittest
from pathlib import Path
from unittest.mock import patch

from rich.console import Console

from x_locale_cli.issues import (
    StatusSnapshot,
    SyncIssues,
    classify_sync_issues,
    removed_key_reason,
)
from x_locale_cli.models import PulledFileReport
from x_locale_cli.report import print_pull_report, print_status, print_sync_summary


class ClassifySyncIssuesTests(unittest.TestCase):
    def test_pending_remove_is_not_extra_local(self) -> None:
        issues = classify_sync_issues(
            local_base={"draft/123ewfewf": "sfdsfds", "auth/sign_in": "In"},
            remote_base={"auth/sign_in": "In"},
            pending_remove=["draft/123ewfewf"],
        )
        self.assertEqual(issues.pending_remove, ["draft/123ewfewf"])
        self.assertEqual(issues.extra_local, [])
        self.assertTrue(issues.has_blocking())

    def test_unassigned_split_from_extra_local(self) -> None:
        issues = classify_sync_issues(
            local_base={"_unassigned/loose": "Hi", "draft/new": "X"},
            remote_base={},
        )
        self.assertEqual(issues.unassigned_local, ["_unassigned/loose"])
        self.assertEqual(issues.extra_local, ["draft/new"])

    def test_source_differs_and_missing_local(self) -> None:
        issues = classify_sync_issues(
            local_base={"auth/sign_in": "Local"},
            remote_base={"auth/sign_in": "Remote", "home/welcome": "Hi"},
        )
        self.assertEqual(issues.source_differs, ["auth/sign_in"])
        self.assertEqual(issues.missing_local, ["home/welcome"])

    def test_tombstone_local(self) -> None:
        issues = classify_sync_issues(
            local_base={"auth/gone": "X"},
            remote_base={},
            tombstones=["auth/gone"],
        )
        self.assertEqual(issues.tombstone, ["auth/gone"])
        self.assertEqual(issues.extra_local, [])

    def test_in_sync_is_not_blocking(self) -> None:
        issues = classify_sync_issues(
            local_base={"auth/sign_in": "In"},
            remote_base={"auth/sign_in": "In"},
        )
        self.assertFalse(issues.has_blocking())
        self.assertEqual(issues.blocking_count(), 0)


class RemovedKeyReasonTests(unittest.TestCase):
    def test_pending_remove(self) -> None:
        self.assertEqual(
            removed_key_reason("draft/123ewfewf", pending_remove=["draft/123ewfewf"]),
            "pending remove on x-locale",
        )

    def test_unassigned(self) -> None:
        self.assertEqual(
            removed_key_reason("_unassigned/123ewfewf"),
            "_unassigned (CLI will not push)",
        )


class ReportHintTests(unittest.TestCase):
    def _capture(self, fn) -> str:
        buf = io.StringIO()
        fake = Console(file=buf, width=120, color_system=None)
        with patch("x_locale_cli.report.console", fake):
            fn()
        return buf.getvalue()

    def test_status_explains_pending_remove_instead_of_push(self) -> None:
        snapshot = StatusSnapshot(
            project_id="proj",
            layout="modular",
            stage="draft",
            remote_count=1,
            local_count=2,
            issues=SyncIssues(pending_remove=["draft/123ewfewf"]),
            untranslated={"en": 0},
        )
        text = self._capture(lambda: print_status(snapshot))
        self.assertIn("Pending remove on x-locale", text)
        self.assertIn("draft/123ewfewf", text)
        self.assertIn("omitted from draft export", text)
        self.assertIn("will not re-add", text)
        self.assertNotIn("Orphaned locally", text)
        self.assertNotIn("run `locale push` to add to x-locale", text)

    def test_sync_summary_counts_remaining_issues(self) -> None:
        snapshot = StatusSnapshot(
            project_id="proj",
            layout="modular",
            stage="draft",
            remote_count=1,
            local_count=1,
            issues=SyncIssues(pending_remove=["draft/123ewfewf"]),
            untranslated={},
        )
        text = self._capture(lambda: print_sync_summary(snapshot))
        self.assertIn("1 issue remain", text)
        self.assertIn("draft/123ewfewf", text)

    def test_pull_report_labels_removed_keys(self) -> None:
        root = Path("/tmp/locales")
        reports = [
            PulledFileReport(
                path=root / "_unassigned" / "vi.json",
                removed_keys=["123ewfewf"],
            )
        ]
        text = self._capture(
            lambda: print_pull_report(
                reports,
                output_dir=root,
                layout="modular",
                stage="draft",
                pending_remove=[],
                tombstones=[],
            )
        )
        self.assertIn("Removed from local files", text)
        self.assertIn("_unassigned/123ewfewf", text)
        self.assertIn("_unassigned (CLI will not push)", text)
