"""``tms pull`` — download translations to local JSON files."""

from __future__ import annotations

from tms_cli.commands.options import LayoutOption, LocalesOption, OutputDirOption, StageOption
from tms_cli.config import runtime_config
from tms_cli.ops import pull_translations


def pull(
    output_dir: OutputDirOption = None,
    layout: LayoutOption = None,
    stage: StageOption = None,
    locales: LocalesOption = None,
) -> None:
    """Pull translations from TMS to local JSON files.

    Flat layout:    writes {output_dir}/{locale}.json
    Modular layout: writes {output_dir}/{module}/{locale}.json
                    and optionally {output_dir}/manifest.json
    """
    pull_translations(
        runtime_config(output_dir=output_dir, layout=layout, stage=stage, locales=locales)
    )
