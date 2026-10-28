# Production configuration with AWS Secrets Manager

The backend uses Pydantic's built-in
[`AWSSecretsManagerSettingsSource`](https://docs.pydantic.dev/latest/concepts/pydantic_settings/#aws-secrets-manager)
to retrieve one JSON secret. boto3 is an internal dependency of Pydantic's AWS
integration; application code does not create an SDK client. The API, Alembic,
seed-demo, and maintenance commands share the same configuration module.

Each process retrieves the secret once when importing the shared settings instance.
Alembic and API workers retrieve separate copies. There are no request-time calls
or automatic refreshes; configuration changes require process restarts.

## Secret format

Create a separate secret for each application/environment using `SecretString`
with a JSON object. Use names matching the settings in
`backend/app/config.py` (case-insensitive; uppercase names are conventional). Values may be JSON strings, numbers, or booleans; numeric
and boolean strings are also parsed by Pydantic. Unrelated keys are ignored.

The following example lists all current settings. Replace the placeholder
database credentials, signing secret, demo key, and OIDC registration values
before deployment. `TEST_DATABASE_URL` is unused during normal production
operation; leave it empty. Set `STATIC_DIR` to `static` when using the bundled
frontend image.

```json
{
  "DATABASE_URL": "postgresql+psycopg://app:REPLACE_WITH_DB_PASSWORD@db.internal:5432/xlocale",
  "TEST_DATABASE_URL": "",
  "ENV": "production",
  "AWS_REGION": "us-east-1",
  "OPENAI_API_KEY": "REPLACE_WITH_OPENAI_API_KEY",
  "OPENAI_MODEL": "gpt-6-luna",
  "OPENAI_BASE_URL": "",
  "OPENAI_MAX_OUTPUT_TOKENS": 16000,
  "OPENAI_REASONING_EFFORT": "none",
  "AI_TRANSLATE_BATCH_SIZE": 20,
  "AI_TRANSLATE_MAX_WORKERS": 5,
  "AI_TRANSLATE_STUB": false,
  "AI_TRANSLATE_STUB_DELAY_MS": 0,
  "X_LOCALE_SECRET": "REPLACE_WITH_A_LONG_RANDOM_SIGNING_SECRET",
  "X_LOCALE_DEMO_API_KEY": "REPLACE_IF_SEEDING_A_DEMO_PROJECT",
  "DEFAULT_BASE_LANGUAGE": "vi",
  "OIDC_ISSUER": "https://login.microsoftonline.com/common/v2.0",
  "OIDC_CLIENT_ID": "REPLACE_WITH_CLIENT_ID",
  "OIDC_CLIENT_SECRET": "REPLACE_WITH_CLIENT_SECRET",
  "OIDC_SCOPES": "openid email profile",
  "OIDC_REDIRECT_URL": "https://locale.example.com/api/auth/callback",
  "SESSION_COOKIE_SECURE": true,
  "IMPORT_ASYNC_THRESHOLD": 5000,
  "ACTIVITY_RETENTION_DAYS": 90,
  "CORS_ORIGINS": "",
  "STATIC_DIR": "static"
}
```

Settings precedence, highest first:

1. Constructor arguments.
2. Process environment variables.
3. Dotenv files (`.env`, then `../.env`; later files override earlier ones).
4. AWS secret JSON.
5. Pydantic file secrets, when configured.
6. Code defaults.

Explicit empty values override lower sources too. The final merged `DATABASE_URL`
must be a valid Postgres URL with a database name, and `X_LOCALE_SECRET` must be
random, at least 32 UTF-8 bytes after trimming, and different from repository
placeholders. Generate one with `python -c 'import secrets; print(secrets.token_urlsafe(32))'`.
Replace short or example values before upgrading. In AWS mode these
checks apply even with dev bypass enabled. Required settings may come from env or
dotenv instead of AWS. Never put `AUTH_DEV_BYPASS` in the secret, in any casing;
startup rejects it. Keep bypass false in production.

OIDC defaults to the Microsoft common issuer when omitted. When `STATIC_DIR` is
nonblank (the bundled production frontend), an omitted `OIDC_REDIRECT_URL` defaults
to `http://localhost:8000/api/auth/callback`; separate frontend development defaults
to port 5173. Set an explicit public HTTPS callback for hosted deployments. Values
from environment, dotenv, AWS, or file secrets override this fallback.

## Secret selection and IAM

Set `SECRET_ENABLE=true` and `X_LOCALE_SECRET_ID` to a secret name or full ARN:

```sh
export SECRET_ENABLE=true
export X_LOCALE_SECRET_ID=x-locale/production
export AWS_DEFAULT_REGION=us-east-1
```

The flag and selector use constructor arguments, environment, then dotenv.
`SECRET_ENABLE` defaults to false; when false, the secret ID is ignored and AWS is
never contacted. Standard Pydantic booleans such as `true`, `1`, and `on` enable it.
Enabling the flag without a secret ID aborts startup before AWS is contacted.
AWS payloads and file secrets cannot change either bootstrap setting. The old `/run/x-locale/secrets-arn` mount and
`X_LOCALE_SECRETS_ARN_FILE` variable are no longer supported.

The SDK resolves both region and credentials through its normal configuration
chain. Set `AWS_DEFAULT_REGION` or configure a region in the selected `AWS_PROFILE`.
The region is not inferred from an ARN. The application field `AWS_REGION` does
not configure the SDK. SDK credentials and region must be available before
retrieval; neither AWS secret JSON nor application dotenv loading configures them.
Use the process environment, shared AWS configuration, or a workload IAM role.
Do not store AWS credentials inside the application secret.

Use a workload IAM role through the SDK's
[default credential chain](https://docs.aws.amazon.com/boto3/latest/guide/credentials.html).
Migration jobs and API workloads need `secretsmanager:GetSecretValue` on the selected
secret. For a customer-managed KMS key, also grant `kms:Decrypt` and ensure its key
policy permits the role. No list, describe, or write permissions are needed.
Allow HTTPS connectivity to Secrets Manager in the configured region. Retry and
timeout behavior follows SDK defaults, without application overrides.

## Startup and changes

The production image validates configuration through Alembic before migrations
and API startup. With `SECRET_ENABLE=true`, a nonempty `X_LOCALE_SECRET_ID` is
required. With the flag false or unset, production and local commands use standard
Pydantic behavior and make no AWS calls, even when a secret ID is present.

When secrets are enabled, inaccessible secrets, binary payloads, invalid JSON,
non-object JSON, forbidden bypass keys, or invalid settings abort startup, even
when environment variables supply all required values. Retrieval and validation
errors omit configuration values and raw AWS error messages. Do not enable SDK
debug logging or log the settings object; both can expose secrets.

Retrieval uses `AWSCURRENT`. After updating the JSON, perform a rolling restart
of every API process and restart any long-running backend commands. Schedule
updates outside migration runs so migrations and workers use the intended
configuration version. Coordinate database-password rotation with database
credential validity; old workers retain the old password. Changing
`X_LOCALE_SECRET` invalidates existing signed sessions, and mixed signing keys
during a rollout can cause intermittent authentication failures.

## Compose file

`docker-compose.prod.yml` requires `POSTGRES_PASSWORD` and defaults
`SECRET_ENABLE=false`. To load AWS settings, export `SECRET_ENABLE=true` and
`X_LOCALE_SECRET_ID`. It forwards optional environment overrides only when supplied,
without injecting empty values or code defaults. Explicit empty overrides still
win. It sets `STATIC_DIR=static` and defaults `AUTH_DEV_BYPASS=false`.

For this stack, the effective `DATABASE_URL` must be:

```text
postgresql+psycopg://xlocale:<POSTGRES_PASSWORD>@postgres:5432/xlocale
```

Export `POSTGRES_PASSWORD` to the matching password. The app does not read this
variable; Postgres does. A URL pointing elsewhere migrates that other database.

Compose reads host `.env` for interpolation and bare environment forwarding.
Check inherited values before deploying: local sample values, including empty
API keys, override secret JSON when forwarded. Host AWS profile files are not
mounted automatically; provide workload credentials or mount the SDK configuration
explicitly if using profiles. The frontend build does not read backend secrets.
