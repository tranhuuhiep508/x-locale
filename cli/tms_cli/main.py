"""CLI entrypoint. ``tms`` and ``python -m tms_cli`` resolve here."""

from tms_cli.app import app

__all__ = ["app"]

if __name__ == "__main__":
    app()
