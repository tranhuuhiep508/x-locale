"""CLI entrypoint. ``locale`` and ``python -m x_locale_cli`` resolve here."""

from x_locale_cli.app import app

__all__ = ["app"]

if __name__ == "__main__":
    app()
