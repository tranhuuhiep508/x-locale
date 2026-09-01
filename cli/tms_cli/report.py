"""Rich reports for push, pull, sync, and status."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from rich.table import Table

from tms_cli.console import console
from tms_cli.io import file_module_locale, scoped_key
from tms_cli.issues import StatusSnapshot, SyncIssues, removed_key_reason
from tms_cli.models import ChangeItem, PulledFileReport

_KEY_LIST_LIMIT = 100
_STATUS_KEY_LIMIT = 20

# (field, table label, section title, why, action, style)
_ISSUE_SPECS: list[tuple[str, str, str, str, str, str]] = [
    (
        "missing_local",
        "Missing locally",
        "Missing locally",
        "On TMS export, absent from local files.",
        "→ Run `tms pull` to add them.",
        "red",
    ),
    (
        "extra_local",
        "Local only (not on TMS)",
        "Local only (not on TMS)",
        "In local files, not on TMS. Push can create them.",
        "→ Run `tms push` to add them to TMS.",
        "yellow",
    ),
    (
        "pending_remove",
        "Pending remove on TMS",
        "Pending remove on TMS",
        "These keys exist on TMS but are omitted from draft export. Push will not re-add them.",
        "→ In TMS: Restore or publish the delete.\n"
        "  → Locally: remove the key if files should match export.",
        "yellow",
    ),
    (
        "tombstone",
        "Removed on TMS (tombstone)",
        "Removed on TMS (tombstone)",
        "Soft-deleted on TMS. Export omits them; push will not restore them.",
        "→ In TMS: Restore the string.\n"
        "  → Locally: remove the key if files should match export.",
        "yellow",
    ),
    (
        "source_differs",
        "Source text differs",
        "Source text differs",
        "Same key on both sides, base-language text is different.",
        "→ Run `tms push` to send local text, or `tms pull` to take TMS.",
        "yellow",
    ),
    (
        "unassigned_local",
        "_unassigned (CLI will not push)",
        "_unassigned (CLI will not push)",
        "Keys under _unassigned/ are counted locally but skipped by `tms push`.",
        "→ Assign a module in TMS, or import with `unassigned`.",
        "yellow",
    ),
]


def change_items(keys: list[str]) -> list[ChangeItem]:
    return [ChangeItem(key=key) for key in sorted(keys)]


def group_pull_changes(
    reports: list[PulledFileReport],
    *,
    output_dir: Path,
    attr: str,
) -> list[ChangeItem]:
    """Group pull diffs by ``module/key`` (same identity as push), with locales."""
    locales_by_key: dict[str, list[str]] = {}
    for report in reports:
        module, locale = file_module_locale(report.path, output_dir)
        for key in getattr(report, attr):
            ident = scoped_key(module, key) if module else key
            seen = locales_by_key.setdefault(ident, [])
            if locale not in seen:
                seen.append(locale)
    return [
        ChangeItem(key=ident, extra=", ".join(locales))
        for ident, locales in sorted(locales_by_key.items())
    ]


def _removed_extra(
    key: str,
    locales: str,
    pending_remove: list[str],
    tombstones: list[str],
) -> str:
    reason = removed_key_reason(key, pending_remove=pending_remove, tombstones=tombstones)
    return f"{locales} · {reason}" if locales else reason


def print_report_header(command: str, details: list[str]) -> None:
    suffix = f"  [dim]{' · '.join(details)}[/dim]" if details else ""
    console.print(f"\n[bold]{command}[/bold]{suffix}")


def print_phase(name: str) -> None:
    console.print()
    console.rule(f"[bold]{name}[/bold]", align="left")


def _print_counts(rows: list[tuple[str, int]]) -> None:
    if not rows:
        return
    width = max(len(label) for label, _ in rows)
    console.print()
    for label, count in rows:
        if label in {"Created", "Updated"} and count:
            style = "green" if label == "Created" else "cyan"
        elif label in {"On TMS, not in local files", "Pending remove (unchanged)"} and count:
            style = "yellow"
        elif label == "Removed" and count:
            style = "yellow"
        elif count == 0:
            style = "dim"
        else:
            style = ""
        line = f"  {label:<{width}}  {count:>4}"
        console.print(f"[{style}]{line}[/]" if style else line)


def _print_change_section(
    title: str,
    items: list[ChangeItem],
    *,
    style: str = "",
    hint: str = "",
    action: str = "",
    limit: int = _KEY_LIST_LIMIT,
) -> None:
    if not items:
        return
    heading = f"{title} ({len(items)})"
    console.print()
    if style:
        console.print(f"[{style}]{heading}[/]")
    else:
        console.print(heading)
    if hint:
        console.print(f"[dim]{hint}[/dim]")
    shown = items[:limit]
    key_width = max(len(item.key) for item in shown)
    for item in shown:
        if item.extra:
            console.print(f"    {item.key:<{key_width}}  [dim]{item.extra}[/dim]")
        else:
            console.print(f"    {item.key}")
    if len(items) > limit:
        console.print(f"    … and {len(items) - limit} more")
    if action:
        for line in action.split("\n"):
            console.print(f"  [dim]{line}[/dim]")


def print_issue_sections(
    issues: SyncIssues,
    *,
    limit: int = _STATUS_KEY_LIMIT,
) -> None:
    for field, _label, title, why, action, style in _ISSUE_SPECS:
        keys = getattr(issues, field)
        _print_change_section(
            title,
            change_items(keys),
            style=style,
            hint=why,
            action=action,
            limit=limit,
        )


def print_pull_report(
    reports: list[PulledFileReport],
    *,
    output_dir: Path,
    layout: str,
    stage: str,
    manifest_written: Path | None = None,
    pending_remove: list[str] | None = None,
    tombstones: list[str] | None = None,
) -> None:
    if not reports:
        console.print("[yellow]No locale files written.[/yellow]")
        return

    created = group_pull_changes(reports, output_dir=output_dir, attr="new_keys")
    updated = group_pull_changes(reports, output_dir=output_dir, attr="updated_keys")
    removed = group_pull_changes(reports, output_dir=output_dir, attr="removed_keys")
    pending_set = pending_remove or []
    tombstone_set = tombstones or []
    removed_labeled = [
        ChangeItem(
            key=item.key,
            extra=_removed_extra(item.key, item.extra, pending_set, tombstone_set),
        )
        for item in removed
    ]

    details = [layout, stage, f"{len(reports)} files"]
    print_report_header("Pull", details)
    counts: list[tuple[str, int]] = [
        ("Created", len(created)),
        ("Updated", len(updated)),
        ("Removed", len(removed_labeled)),
        ("Files", len(reports)),
    ]
    _print_counts(counts)
    _print_change_section(
        "Created",
        created,
        style="green",
        hint="New keys in local files.",
    )
    _print_change_section(
        "Updated",
        updated,
        style="cyan",
        hint="Values changed in local files.",
    )
    _print_change_section(
        "Removed from local files",
        removed_labeled,
        style="yellow",
        hint="Dropped because they are not in this stage's export.",
        action="→ Leftover keys in folders pull did not rewrite still show in `tms status`.",
    )

    if not created and not updated and not removed_labeled:
        console.print("\n[green]Local files are already up to date.[/green]")
    footer = f"Wrote {len(reports)} files to {output_dir}"
    if manifest_written is not None:
        footer += f"  ·  manifest {manifest_written.name}"
    console.print(f"\n[dim]{footer}[/dim]")


def print_push_report(
    *,
    result: dict[str, Any],
    local_key_count: int,
    orphans: list[str],
    details: list[str],
    dry_run: bool,
    pending_remove: list[str] | None = None,
) -> None:
    diff = result.get("diff") or {}
    created = change_items(diff.get("create", []))
    updated = change_items(diff.get("update", []))
    remote_only = change_items(orphans)
    pending_items = change_items(pending_remove or [])
    unchanged_count = max(0, local_key_count - len(created) - len(updated))

    print_report_header("Push", details)
    counts: list[tuple[str, int]] = [
        ("Created", len(created)),
        ("Updated", len(updated)),
        ("Unchanged", unchanged_count),
    ]
    if remote_only:
        counts.append(("On TMS, not in local files", len(remote_only)))
    if pending_items:
        counts.append(("Pending remove (unchanged)", len(pending_items)))
    _print_counts(counts)
    _print_change_section(
        "Created",
        created,
        style="green",
        hint="New strings on TMS.",
    )
    _print_change_section(
        "Updated",
        updated,
        style="cyan",
        hint="Base-language text changed on TMS.",
    )
    _print_change_section(
        "On TMS, not in local files",
        remote_only,
        style="yellow",
        hint="Present in TMS export for the modules you pushed — not deleted.",
        action="→ Run `tms pull` to add them locally. Push never deletes remote keys.",
    )
    _print_change_section(
        "Pending remove (unchanged)",
        pending_items,
        style="yellow",
        hint="Local keys match TMS rows queued for removal. They are omitted from draft export.",
        action="→ In TMS: Restore or publish the delete. Push will not re-create them.",
    )

    if dry_run:
        console.print("\n[dim]Dry run — no changes were saved.[/dim]")
    elif not created and not updated and not remote_only and not pending_items:
        console.print("\n[green]Everything is already up to date.[/green]")


def print_status(snapshot: StatusSnapshot) -> None:
    issues = snapshot.issues
    console.print(
        f"\n[bold]TMS Status[/bold]  project={snapshot.project_id}  "
        f"layout={snapshot.layout}  stage={snapshot.stage}\n"
    )

    summary = Table(show_header=True)
    summary.add_column("Category", style="bold")
    summary.add_column("Count", justify="right")
    summary.add_row("Keys in export (base)", str(snapshot.remote_count))
    summary.add_row("Local keys (base)", str(snapshot.local_count))
    for field, label, _title, _why, _action, style in _ISSUE_SPECS:
        count = len(getattr(issues, field))
        if count:
            summary.add_row(f"[{style}]{label}[/{style}]", str(count))
    for locale, count in snapshot.untranslated.items():
        color = "red" if count > 0 else "green"
        summary.add_row(f"[{color}]Untranslated ({locale})[/{color}]", str(count))
    console.print(summary)

    if snapshot.stage == "draft":
        console.print(
            "\n[dim]Draft export omits keys pending remove and tombstones.[/dim]"
        )

    print_issue_sections(issues, limit=_STATUS_KEY_LIMIT)


def print_sync_summary(snapshot: StatusSnapshot) -> None:
    print_phase("Sync summary")
    issues = snapshot.issues
    count = issues.blocking_count()
    if not count:
        console.print("\n[green]Local files match this stage's export.[/green]")
        return
    noun = "issue" if count == 1 else "issues"
    console.print(f"\n[yellow]{count} {noun} remain after push + pull[/yellow]")
    print_issue_sections(issues, limit=_STATUS_KEY_LIMIT)
    console.print("\n[dim]Full breakdown: tms status[/dim]")
