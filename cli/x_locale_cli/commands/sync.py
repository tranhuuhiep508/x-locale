"""``locale sync`` — push then pull in one step."""

from __future__ import annotations

from x_locale_cli.client import api_client
from x_locale_cli.commands.options import LayoutOption, LocalesOption, OutputDirOption, StageOption
from x_locale_cli.config import runtime_config
from x_locale_cli.ops import finish_sync, pull_translations, push_strings
from x_locale_cli.report import print_phase, print_report_header


def sync(
    output_dir: OutputDirOption = None,
    layout: LayoutOption = None,
    stage: StageOption = None,
    locales: LocalesOption = None,
) -> None:
    """Push base-language strings then pull all translations (push + pull)."""
    config = runtime_config(output_dir=output_dir, layout=layout, stage=stage, locales=locales)
    print_report_header("Sync", [config.layout.value, config.stage.value])
    with api_client(config) as client:
        print_phase("Push")
        push_strings(config, client=client)
        print_phase("Pull")
        pulled = pull_translations(config, client=client)
        finish_sync(config, export=pulled.export, state=pulled.state)
