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

**Windows**

```powershell
pip install tms-cli
python -m tms_cli.windows   # once per machine (Smart App Control)
```

Or from this repo: `.\scripts\install-cli.ps1`

**macOS / Linux**

```bash
pipx install tms-cli
# or from this repo:
./scripts/install-cli.sh
```

On Windows, the installer uses `tms.cmd` instead of pip's unsigned `tms.exe` so Smart App Control does not block the command.
