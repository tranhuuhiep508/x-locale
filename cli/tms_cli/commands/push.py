"""``tms push`` — upload base-language source strings."""

from __future__ import annotations

from tms_cli.commands.options import (
    DryRunOption,
    LayoutOption,
    LocalesOption,
    OutputDirOption,
    StageOption,
)
from tms_cli.config import runtime_config
from tms_cli.ops import push_strings


def push(
    output_dir: OutputDirOption = None,
    layout: LayoutOption = None,
    stage: StageOption = None,
    locales: LocalesOption = None,
    dry_run: DryRunOption = False,
) -> None:
    """Push base-language source strings to TMS.

    Flat layout:    reads  {output_dir}/{base_language}.json
    Modular layout: scans  {output_dir}/*/{base_language}.json
    """
    push_strings(
        runtime_config(output_dir=output_dir, layout=layout, stage=stage, locales=locales),
        dry_run=dry_run,
    )
