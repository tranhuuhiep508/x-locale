# tms-cli

Sync locale files with a [TMS](https://github.com/your-org/tms) server.

Locale files use **flat** JSON with dot-notation keys:

```json
{
  "greeting.hello": "Hello",
  "auth.sign_in": "Sign in"
}
```

```bash
tms init -k YOUR_API_KEY -u https://tms.example.com -o ./locales
tms push ./locales/en.json
tms pull ./locales/
```

## Install

Install [uv](https://docs.astral.sh/uv/) first if you do not have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**From PyPI**

```bash
uv tool install tms-cli
```

**From this repo**

```bash
uv tool install -e ./cli
```

**Windows:** After install, run `python -m tms_cli.windows` once. It replaces the unsigned `tms.exe` shim with `tms.cmd` so Smart App Control does not block the command.
