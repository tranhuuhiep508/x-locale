"""Rich reports for push, pull, sync, and status."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from rich.table import Table

from x_locale_cli.console import console
from x_locale_cli.io import file_module_locale, scoped_key
from x_locale_cli.issues import StatusSnapshot, SyncIssues, removed_key_reason
from x_locale_cli.models import ChangeItem, PulledFileReport

_KEY_LIST_LIMIT = 100
_STATUS_KEY_LIMIT = 20

# (field, table label, section title, why, action, style)
_ISSUE_SPECS: list[tuple[str, str, str, str, str, str]] = [
    (
        "missing_local",
        "Missing locally",
        "Missing locally",
        "On x-locale export, absent from local files.",
        "→ Run `locale pull` to add them.",
        "red",
    ),
    (
        "extra_local",
        "Local only (not on x-locale)",
        "Local only (not on x-locale)",
        "In local files, not on x-locale. Push can create them.",
        "→ Run `locale push` to add them to x-locale.",
        "yellow",
    ),
    (
        "pending_remove",
        "Pending remove on x-locale",
        "Pending remove on x-locale",
        "These keys exist on x-locale but are omitted from draft export. Push will not re-add them.",
        "→ In x-locale: Restore or publish the delete.\n"
        "  → Locally: remove the key if files should match export.",
        "yellow",
    ),
    (
        "tombstone",
        "Removed on x-locale (tombstone)",
        "Removed on x-locale (tombstone)",
        "Soft-deleted on x-locale. Export omits them; push will not restore them.",
        "→ In x-locale: Restore the string.\n"
        "  → Locally: remove the key if files should match export.",
        "yellow",
    ),
    (
        "source_differs",
        "Source text differs",
        "Source text differs",
        "Same key on both sides, base-language text is different.",
        "→ Run `locale push` to send local text, or `locale pull` to take x-locale.",
        "yellow",
    ),
    (
        "unassigned_local",
        "_unassigned (CLI will not push)",
        "_unassigned (CLI will not push)",
        "Keys under _unassigned/ are counted locally but skipped by `locale push`.",
        "→ Assign a module in x-locale, or import with `unassigned`.",
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
        elif label == "On x-locale, not in local files" and count:
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
    total: int | None = None,
) -> None:
    count = total if total is not None else len(items)
    if not items and count == 0:
        return
    heading = f"{title} ({count})"
    console.print()
    if style:
        console.print(f"[{style}]{heading}[/]")
    else:
        console.print(heading)
    if hint:
        console.print(f"[dim]{hint}[/dim]")
    shown = items[:limit]
    if shown:
        key_width = max(len(item.key) for item in shown)
        for item in shown:
            if item.extra:
                console.print(f"    {item.key:<{key_width}}  [dim]{item.extra}[/dim]")
            else:
                console.print(f"    {item.key}")
    remaining = count - len(shown)
    if remaining > 0:
        console.print(f"    … and {remaining} more")
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
        action="→ Leftover keys in folders pull did not rewrite still show in `locale status`.",
    )

    if not created and not updated and not removed_labeled:
        console.print("\n[green]Local files are already up to date.[/green]")
    written_count = sum(1 for report in reports if report.written)
    if written_count:
        footer = f"Wrote {written_count} files to {output_dir}"
    else:
        footer = f"Checked {len(reports)} files in {output_dir}"
    if manifest_written is not None:
        footer += f"  ·  manifest {manifest_written.name}"
    console.print(f"\n[dim]{footer}[/dim]")


def print_push_report(
    *,
    result: dict[str, Any],
    local_key_count: int,
    details: list[str],
    dry_run: bool,
) -> None:
    diff = result.get("diff") or {}
    create_keys = diff.get("create") or []
    update_keys = diff.get("update") or []
    orphan_keys = diff.get("orphan") or []
    create_count = int(diff.get("create_count") if diff.get("create_count") is not None else len(create_keys))
    update_count = int(diff.get("update_count") if diff.get("update_count") is not None else len(update_keys))
    orphan_count = int(diff.get("orphan_count") if diff.get("orphan_count") is not None else len(orphan_keys))
    created = change_items(create_keys)
    updated = change_items(update_keys)
    remote_only = change_items(orphan_keys)
    unchanged_count = max(0, local_key_count - create_count - update_count)

    print_report_header("Push", details)
    counts: list[tuple[str, int]] = [
        ("Created", create_count),
        ("Updated", update_count),
        ("Unchanged", unchanged_count),
    ]
    if orphan_count:
        counts.append(("On x-locale, not in local files", orphan_count))
    _print_counts(counts)
    _print_change_section(
        "Created",
        created,
        style="green",
        hint="New strings on x-locale.",
        total=create_count,
    )
    _print_change_section(
        "Updated",
        updated,
        style="cyan",
        hint="Base-language text changed on x-locale.",
        total=update_count,
    )
    _print_change_section(
        "On x-locale, not in local files",
        remote_only,
        style="yellow",
        hint="Present in x-locale export for the modules you pushed — not deleted.",
        action="→ Run `locale pull` to add them locally. Push never deletes remote keys.",
        total=orphan_count,
    )

    if dry_run:
        console.print("\n[dim]Dry run — no changes were saved.[/dim]")
    elif not create_count and not update_count and not orphan_count:
        console.print("\n[green]Everything is already up to date.[/green]")


def print_status(snapshot: StatusSnapshot) -> None:
    issues = snapshot.issues
    console.print(
        f"\n[bold]x-locale Status[/bold]  project={snapshot.project_id}  "
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
    console.print("\n[dim]Full breakdown: locale status[/dim]")
