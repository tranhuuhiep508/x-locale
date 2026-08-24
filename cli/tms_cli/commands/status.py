"""``tms status`` — diff local files against TMS without writing."""

from __future__ import annotations

from tms_cli.commands.options import LayoutOption, LocalesOption, OutputDirOption, StageOption
from tms_cli.config import runtime_config
from tms_cli.ops import show_status


def status(
    output_dir: OutputDirOption = None,
    layout: LayoutOption = None,
    stage: StageOption = None,
    locales: LocalesOption = None,
) -> None:
    """Show diff between local files and TMS (missing keys, orphans, untranslated)."""
    show_status(
        runtime_config(output_dir=output_dir, layout=layout, stage=stage, locales=locales)
    )
