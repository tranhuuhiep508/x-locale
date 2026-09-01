"""``tms sync`` — push then pull in one step."""

from __future__ import annotations

from tms_cli.commands.options import LayoutOption, LocalesOption, OutputDirOption, StageOption
from tms_cli.config import runtime_config
from tms_cli.ops import finish_sync, pull_translations, push_strings
from tms_cli.report import print_phase, print_report_header


def sync(
    output_dir: OutputDirOption = None,
    layout: LayoutOption = None,
    stage: StageOption = None,
    locales: LocalesOption = None,
) -> None:
    """Push base-language strings then pull all translations (push + pull)."""
    config = runtime_config(output_dir=output_dir, layout=layout, stage=stage, locales=locales)
    print_report_header("Sync", [config.layout.value, config.stage.value])
    print_phase("Push")
    push_strings(config)
    print_phase("Pull")
    pull_translations(config)
    finish_sync(config)
