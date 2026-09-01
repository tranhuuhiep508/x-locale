"""Classify local vs TMS export mismatches for status, pull, and sync."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from tms_cli.models import UNASSIGNED_SLUG

UNASSIGNED_PREFIX = f"{UNASSIGNED_SLUG}/"


@dataclass
class SyncIssues:
    missing_local: list[str] = field(default_factory=list)
    extra_local: list[str] = field(default_factory=list)
    pending_remove: list[str] = field(default_factory=list)
    tombstone: list[str] = field(default_factory=list)
    source_differs: list[str] = field(default_factory=list)
    unassigned_local: list[str] = field(default_factory=list)

    def blocking_count(self) -> int:
        return (
            len(self.missing_local)
            + len(self.extra_local)
            + len(self.pending_remove)
            + len(self.tombstone)
            + len(self.source_differs)
            + len(self.unassigned_local)
        )

    def has_blocking(self) -> bool:
        return self.blocking_count() > 0


@dataclass
class StatusSnapshot:
    project_id: str
    layout: str
    stage: str
    remote_count: int
    local_count: int
    issues: SyncIssues
    untranslated: dict[str, int]


def classify_sync_issues(
    *,
    local_base: dict[str, str],
    remote_base: dict[str, str],
    pending_remove: Iterable[str] = (),
    tombstones: Iterable[str] = (),
) -> SyncIssues:
    """Split local/export key sets into named mismatch kinds."""
    local_keys = set(local_base)
    remote_keys = set(remote_base)
    pending_set = set(pending_remove)
    tombstone_set = set(tombstones)

    missing_local = sorted(remote_keys - local_keys)
    pending_local = sorted(pending_set & local_keys)
    tombstone_local = sorted(tombstone_set & local_keys)
    hidden = set(pending_local) | set(tombstone_local)
    leftover = local_keys - remote_keys - hidden
    unassigned_local = sorted(k for k in leftover if k.startswith(UNASSIGNED_PREFIX))
    extra_local = sorted(leftover - set(unassigned_local))
    source_differs = sorted(
        key
        for key in local_keys & remote_keys
        if local_base[key] != remote_base[key]
    )
    return SyncIssues(
        missing_local=missing_local,
        extra_local=extra_local,
        pending_remove=pending_local,
        tombstone=tombstone_local,
        source_differs=source_differs,
        unassigned_local=unassigned_local,
    )


def removed_key_reason(
    key: str,
    *,
    pending_remove: Iterable[str] = (),
    tombstones: Iterable[str] = (),
) -> str:
    """Short label for a key pull dropped from a locale file."""
    if key in set(pending_remove):
        return "pending remove on TMS"
    if key in set(tombstones):
        return "tombstone on TMS"
    if key.startswith(UNASSIGNED_PREFIX):
        return "_unassigned (CLI will not push)"
    return "local only — not on TMS"
