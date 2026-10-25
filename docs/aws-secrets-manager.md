# Production configuration with AWS Secrets Manager

The backend uses the existing boto3 SDK to read one JSON secret containing all
application settings. Pydantic validates the result. The API, Alembic, seed-demo,
and maintenance commands all use the same configuration module.

This follows AWS's [Python SDK retrieval guidance](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-python-sdk.html).
Each process retrieves the secret once when importing the configuration module
and retains the shared settings instance in memory. There are no request-time
AWS calls or automatic configuration refreshes. Alembic and each API worker are
separate processes and therefore retrieve their own copy. Configuration updates
require new processes.

## Secret format

Create a separate secret for each application/environment using `SecretString`
with a JSON object. Use uppercase names matching the settings in
`backend/app/config.py`. Values may be JSON strings, numbers, or booleans; numeric
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

AWS mode merges **code defaults, then environment variables, then Secrets Manager**
for each setting (later sources win). Dotenv and file-secret settings are not
read. Keys present in the JSON override env for that key; env fills settings
absent from the secret. `DATABASE_URL` and `X_LOCALE_SECRET` must be present and
valid in the secret. The signing secret cannot be blank or the repository's
insecure default, even when dev bypass is enabled. Do not put `AUTH_DEV_BYPASS`
in the secret; startup rejects it. Set bypass only via environment variables and
keep `AUTH_DEV_BYPASS=false` in production.

The SDK and infrastructure retain their own configuration: AWS credential-chain
variables, proxy settings, `PATH`, and `WEB_CONCURRENCY` are not application
settings and are not loaded from this JSON. Do not store AWS access keys in the
application secret; they cannot authenticate the request needed to retrieve it.

## Bootstrap mount and IAM

Mount a read-only UTF-8 file at `/run/x-locale/secrets-arn` containing only the full
secret ARN, optionally followed by a newline:

```text
arn:aws:secretsmanager:us-east-1:123456789012:secret:x-locale/production-AbCdEf
```

This file path is an application convention, not an AWS requirement. Deployment
must create the mount; no secret values should be baked into the image. The
retrieval region comes from the ARN, so no bootstrap `AWS_REGION` is needed.
The JSON's `AWS_REGION` is a separate application setting and is not the region used to fetch this secret.

Use a workload IAM role through boto3's
[default credential chain](https://docs.aws.amazon.com/boto3/latest/guide/credentials.html).
Both migration jobs and API workloads need access. Grant the following policy,
substituting the actual complete ARN:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:x-locale/production-AbCdEf"
  }]
}
```

For a customer-managed KMS key, also grant `kms:Decrypt` on that key and ensure
its key policy permits the role. No `ListSecrets`, `DescribeSecret`, or write
permissions are required by this loader. See the
[GetSecretValue permissions reference](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html).

Allow HTTPS connectivity to the Secrets Manager endpoint in the ARN's region,
through appropriate egress or a Secrets Manager VPC interface endpoint. SDK
standard retries allow three total attempts, with a five-second connection
timeout and ten-second read timeout. These are SDK attempt limits, not an
overall process startup deadline.

## Startup and changes

The production image's default command checks that the bootstrap path is a
regular nonempty file before running `alembic upgrade head`, then starts the API.
An invalid ARN, inaccessible secret, binary payload, invalid JSON, or invalid
configuration aborts startup. Errors omit configuration values and raw AWS error
messages. Do not enable boto3/botocore debug logging or log the settings object:
SDK debug output and explicit settings dumps can expose secret values.

When overriding the container command or running a separate production migration
or maintenance job, require the same mount before invoking Python. For example:

```sh
test -f /run/x-locale/secrets-arn && test -s /run/x-locale/secrets-arn || exit 1
alembic upgrade head
```

The loader itself also rejects unreadable or invalid existing bootstrap files.
Without the file, ordinary local commands and CI use the existing environment
and `.env` configuration and make no Secrets Manager requests. Do not bypass the
production startup guard: an absent file intentionally selects local behavior.

Retrieval uses `AWSCURRENT`. After updating the JSON, perform a rolling restart
of every API process and restart any long-running backend commands. Schedule
updates outside migration runs so migrations and workers use the intended
configuration version. Coordinate database-password rotation with database
credential validity; old workers retain the old password. Changing
`X_LOCALE_SECRET` invalidates existing signed sessions, and mixed signing keys
during a rollout can cause intermittent authentication failures.

## Compose file

`docker-compose.prod.yml` mounts the bootstrap file from the host path in
`X_LOCALE_SECRETS_ARN_FILE` and uses the image default command (bootstrap check,
migrations, then uvicorn). Create that file before `up`. Compose does not create
a missing source path. If an earlier run left a directory there, delete it and
create the file. A missing path must fail startup; it must not become a directory.

Non-secret settings stay in Compose `environment`. `DATABASE_URL`,
`X_LOCALE_SECRET`, and other JSON keys come from Secrets Manager. The sample
above (`db.internal`) is for a database outside this Compose file. For
`docker-compose.prod.yml`, the secret `DATABASE_URL` must use host `postgres`,
user `xlocale`, database `xlocale`, and the same password as `POSTGRES_PASSWORD`:

```text
postgresql+psycopg://xlocale:<POSTGRES_PASSWORD>@postgres:5432/xlocale
```

Export `POSTGRES_PASSWORD` before `up`. The app does not read that variable;
Postgres does. A URL that points somewhere else migrates that other database
and leaves the Compose Postgres unused.

`AUTH_DEV_BYPASS` must not appear in the secret; set it only via environment
variables. The frontend build does not read the backend secret.
