# tms-cli

Sync locale files with a [TMS](https://github.com/your-org/tms) server.

```bash
tms init -k YOUR_API_KEY -u https://tms.example.com -o ./locales
tms push ./locales/en.json
tms pull ./locales/
```

### JSON format

By default, locale files use **nested** JSON (`{"greeting": {"hello": "Hello"}}`). Use **flat** JSON with dot-notation keys (`{"greeting.hello": "Hello"}`) instead:

```bash
# Set default format for this repo
tms init -k YOUR_API_KEY --format flat

# Or override per command
tms push ./locales/en.json --format flat
tms pull ./locales/ --format flat
```

## Install

Install [uv](https://docs.astral.sh/uv/) first if you do not have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # macOS / Linux
winget install astral-sh.uv                         # Windows
```

**From PyPI**

```bash
uv tool install tms-cli
python -m tms_cli.windows   # Windows only, once per machine
```

**From this repo**

```bash
uv tool install -e ./cli
python -m tms_cli.windows   # Windows only, once per machine
```

On Windows, run `python -m tms_cli.windows` once after install. It replaces the unsigned `tms.exe` shim with `tms.cmd` so Smart App Control does not block the command.
