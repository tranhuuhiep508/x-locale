"""Rich reports for push, pull, sync, and status."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from rich.table import Table

from tms_cli.console import console
from tms_cli.io import file_module_locale, scoped_key
from tms_cli.models import ChangeItem, PulledFileReport

_KEY_LIST_LIMIT = 100
_STATUS_KEY_LIMIT = 20


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
        elif label == "Orphaned" and count:
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
    shown = items[:_KEY_LIST_LIMIT]
    key_width = max(len(item.key) for item in shown)
    for item in shown:
        if item.extra:
            console.print(f"    {item.key:<{key_width}}  [dim]{item.extra}[/dim]")
        else:
            console.print(f"    {item.key}")
    if len(items) > _KEY_LIST_LIMIT:
        console.print(f"    … and {len(items) - _KEY_LIST_LIMIT} more")


def print_pull_report(
    reports: list[PulledFileReport],
    *,
    output_dir: Path,
    layout: str,
    stage: str,
    manifest_written: Path | None = None,
) -> None:
    if not reports:
        console.print("[yellow]No locale files written.[/yellow]")
        return

    created = group_pull_changes(reports, output_dir=output_dir, attr="new_keys")
    updated = group_pull_changes(reports, output_dir=output_dir, attr="updated_keys")

    details = [layout, stage, f"{len(reports)} files"]
    print_report_header("Pull", details)
    _print_counts(
        [
            ("Created", len(created)),
            ("Updated", len(updated)),
            ("Files", len(reports)),
        ]
    )
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

    if not created and not updated:
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
) -> None:
    diff = result.get("diff") or {}
    created = change_items(diff.get("create", []))
    updated = change_items(diff.get("update", []))
    orphan_items = change_items(orphans)
    unchanged_count = max(0, local_key_count - len(created) - len(updated))

    print_report_header("Push", details)
    counts: list[tuple[str, int]] = [
        ("Created", len(created)),
        ("Updated", len(updated)),
        ("Unchanged", unchanged_count),
    ]
    if orphan_items:
        counts.append(("Orphaned", len(orphan_items)))
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
        "Orphaned",
        orphan_items,
        style="yellow",
        hint="On TMS, missing locally — not deleted.",
    )

    if dry_run:
        console.print("\n[dim]Dry run — no changes were saved.[/dim]")
    elif not created and not updated and not orphan_items:
        console.print("\n[green]Everything is already up to date.[/green]")


def print_status(
    *,
    project_id: str,
    layout: str,
    stage: str,
    remote_count: int,
    local_count: int,
    missing: list[str],
    orphan: list[str],
    untranslated: dict[str, int],
) -> None:
    console.print(
        f"\n[bold]TMS Status[/bold]  project={project_id}  layout={layout}  stage={stage}\n"
    )

    summary = Table(show_header=True)
    summary.add_column("Category", style="bold")
    summary.add_column("Count", justify="right")
    summary.add_row("Remote keys (base)", str(remote_count))
    summary.add_row("Local keys (base)", str(local_count))
    summary.add_row("[red]Missing locally[/red]", str(len(missing)))
    summary.add_row("[yellow]Orphaned locally[/yellow]", str(len(orphan)))
    for locale, count in untranslated.items():
        color = "red" if count > 0 else "green"
        summary.add_row(f"[{color}]Untranslated ({locale})[/{color}]", str(count))
    console.print(summary)

    if missing:
        console.print(f"\n[red]Missing locally ({len(missing)}) — run `tms pull` to add:[/red]")
        for key in missing[:_STATUS_KEY_LIMIT]:
            console.print(f"  {key}")
        if len(missing) > _STATUS_KEY_LIMIT:
            console.print(f"  … and {len(missing) - _STATUS_KEY_LIMIT} more")

    if orphan:
        console.print(
            f"\n[yellow]Orphaned locally ({len(orphan)}) — run `tms push` to add to TMS:[/yellow]"
        )
        for key in orphan[:_STATUS_KEY_LIMIT]:
            console.print(f"  {key}")
        if len(orphan) > _STATUS_KEY_LIMIT:
            console.print(f"  … and {len(orphan) - _STATUS_KEY_LIMIT} more")
