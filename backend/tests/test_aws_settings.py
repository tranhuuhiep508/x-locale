"""Secrets Manager configuration tests; no AWS or database connections required."""

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

import boto3
import pytest
from botocore.exceptions import EndpointConnectionError, NoCredentialsError
from botocore.stub import Stubber
from pydantic import ValidationError

from app import config

ARN = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:x-locale/production-AbCdEf"
PAYLOAD = {
    "DATABASE_URL": "postgresql+psycopg://user:password@localhost/app",
    "X_LOCALE_SECRET": "test-signing-value",
}


@pytest.fixture(autouse=True)
def clean_sources(monkeypatch, tmp_path):
    for name in config.Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    monkeypatch.chdir(tmp_path)


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("SECRET_ENABLE", "true")
    monkeypatch.setenv("X_LOCALE_SECRET_ID", ARN)
    client = boto3.session.Session().client(
        "secretsmanager",
        region_name="eu-west-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    factory = Mock(return_value=client)
    monkeypatch.setattr("boto3.client", factory)
    with Stubber(client) as stub:
        yield stub, factory
        stub.assert_no_pending_responses()


def respond(aws, payload):
    aws[0].add_response(
        "get_secret_value", {"SecretString": json.dumps(payload)}, {"SecretId": ARN}
    )


def test_local_sources_unchanged_and_no_aws(monkeypatch, tmp_path):
    factory = Mock(side_effect=AssertionError("AWS must not be used"))
    monkeypatch.setattr("boto3.client", factory)
    dotenv = tmp_path / ".env"
    dotenv.write_text("DEFAULT_BASE_LANGUAGE=ja\nOPENAI_MAX_OUTPUT_TOKENS=123\n")
    monkeypatch.setenv("DEFAULT_BASE_LANGUAGE", "en")
    loaded = config.Settings(_env_file=dotenv)
    assert loaded.default_base_language == "en"
    assert loaded.openai_max_output_tokens == 123
    assert config.Settings(default_base_language="fr").default_base_language == "fr"
    monkeypatch.delenv("DEFAULT_BASE_LANGUAGE")
    assert config.Settings().default_base_language == "ja"
    assert config.Settings(_env_file=None).default_base_language == "vi"
    factory.assert_not_called()


def test_precedence_and_types(aws, monkeypatch, tmp_path):
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    for key, value in {
        "DEFAULT_BASE_LANGUAGE": "ko",
        "CORS_ORIGINS": "file",
        "STATIC_DIR": "file",
    }.items():
        (secrets / key).write_text(value)
    dotenv = tmp_path / ".env"
    dotenv.write_text("DEFAULT_BASE_LANGUAGE=ja\nOPENAI_MODEL=dotenv-model\n")
    monkeypatch.setenv("DEFAULT_BASE_LANGUAGE", "en")
    respond(
        aws,
        {
            **PAYLOAD,
            "DEFAULT_BASE_LANGUAGE": "de",
            "OPENAI_MODEL": "aws-model",
            "STATIC_DIR": "aws",
            "OPENAI_MAX_OUTPUT_TOKENS": "2048",
            "SESSION_COOKIE_SECURE": True,
            "UNRELATED": "ignored",
        },
    )
    loaded = config.Settings(default_base_language="fr", _secrets_dir=secrets)
    assert loaded.default_base_language == "fr"
    assert loaded.openai_model == "dotenv-model"
    assert loaded.static_dir == "aws"
    assert loaded.cors_origins == "file"
    assert loaded.openai_max_output_tokens == 2048
    assert loaded.session_cookie_secure is True
    assert loaded.activity_retention_days == 90
    aws[1].assert_called_once_with("secretsmanager", region_name=None, endpoint_url=None)


@pytest.mark.parametrize("source", ["init", "env", "dotenv"])
@pytest.mark.parametrize("secret_id", [ARN, "x-locale/production"])
def test_selector_sources(aws, monkeypatch, tmp_path, source, secret_id):
    monkeypatch.delenv("X_LOCALE_SECRET_ID")
    kwargs = {}
    if source == "init":
        kwargs["x_locale_secret_id"] = secret_id
        monkeypatch.setenv("X_LOCALE_SECRET_ID", "wrong-env")
    elif source == "env":
        monkeypatch.setenv("X_LOCALE_SECRET_ID", secret_id)
        (tmp_path / ".env").write_text("X_LOCALE_SECRET_ID=wrong-dotenv\n")
    else:
        (tmp_path / ".env").write_text(f"X_LOCALE_SECRET_ID={secret_id}\n")
    aws[0].add_response(
        "get_secret_value", {"SecretString": json.dumps(PAYLOAD)}, {"SecretId": secret_id}
    )
    assert config.Settings(**kwargs).x_locale_secret_id == secret_id


def test_environment_overrides_aws_including_empty_values(aws, monkeypatch):
    respond(aws, {**PAYLOAD, "OPENAI_MODEL": "aws", "OPENAI_API_KEY": "aws-key"})
    monkeypatch.setenv("OPENAI_MODEL", "env-model")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    assert config.Settings().openai_api_key == ""
    # One retrieval per settings construction.
    respond(aws, {**PAYLOAD, "OPENAI_MODEL": "aws"})
    assert config.Settings().openai_model == "env-model"


def test_merged_required_values_can_come_from_env(aws, monkeypatch):
    respond(aws, {})
    for key, value in PAYLOAD.items():
        monkeypatch.setenv(key, value)
    assert config.Settings().database_url == PAYLOAD["DATABASE_URL"]


@pytest.mark.parametrize("key", ["AUTH_DEV_BYPASS", "auth_dev_bypass"])
def test_secret_rejects_auth_dev_bypass(aws, key):
    respond(aws, {**PAYLOAD, key: True})
    with pytest.raises(RuntimeError, match="AUTH_DEV_BYPASS"):
        config.Settings()


def test_empty_selector_when_enabled_fails_before_aws(aws):
    with pytest.raises(RuntimeError, match="requires X_LOCALE_SECRET_ID"):
        config.Settings(x_locale_secret_id="")
    aws[1].assert_not_called()


@pytest.mark.parametrize("flag", [None, "false", "0", "off"])
def test_secret_id_alone_does_not_enable_aws(aws, monkeypatch, flag):
    if flag is None:
        monkeypatch.delenv("SECRET_ENABLE")
    else:
        monkeypatch.setenv("SECRET_ENABLE", flag)
    assert config.Settings().secret_enable is False
    aws[1].assert_not_called()


@pytest.mark.parametrize("source", ["init", "env", "dotenv"])
def test_enable_sources_and_boolean_parsing(aws, monkeypatch, tmp_path, source):
    monkeypatch.delenv("SECRET_ENABLE")
    kwargs = {}
    if source == "init":
        kwargs["secret_enable"] = True
        monkeypatch.setenv("SECRET_ENABLE", "false")
    elif source == "env":
        monkeypatch.setenv("SECRET_ENABLE", "1")
        (tmp_path / ".env").write_text("SECRET_ENABLE=false\n")
    else:
        (tmp_path / ".env").write_text("SECRET_ENABLE=on\n")
    respond(aws, PAYLOAD)
    assert config.Settings(**kwargs).secret_enable is True


def test_constructor_can_disable_aws_over_environment(aws):
    assert config.Settings(secret_enable=False).secret_enable is False
    aws[1].assert_not_called()


def test_invalid_enable_flag_fails_before_aws(aws, monkeypatch):
    monkeypatch.setenv("SECRET_ENABLE", "invalid")
    with pytest.raises(ValidationError):
        config.Settings()
    aws[1].assert_not_called()


def test_file_secrets_cannot_select_aws(monkeypatch, tmp_path):
    factory = Mock(side_effect=AssertionError("AWS must not be used"))
    monkeypatch.setattr("boto3.client", factory)
    (tmp_path / "X_LOCALE_SECRET_ID").write_text(ARN)
    (tmp_path / "SECRET_ENABLE").write_text("true")
    assert config.Settings(_secrets_dir=tmp_path).x_locale_secret_id == ""
    factory.assert_not_called()


@pytest.mark.parametrize(
    ("key", "value"),
    [("DATABASE_URL", "sqlite:///bad"), ("X_LOCALE_SECRET", "")],
)
def test_invalid_environment_override_is_validated(aws, monkeypatch, key, value):
    respond(aws, PAYLOAD)
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match=key):
        config.Settings()


def test_secret_cannot_change_bootstrap_selector(aws):
    respond(aws, {**PAYLOAD, "X_LOCALE_SECRET_ID": "", "SECRET_ENABLE": False})
    loaded = config.Settings()
    assert loaded.x_locale_secret_id == ARN
    assert loaded.secret_enable is True


@pytest.mark.parametrize(
    "code", ["AccessDeniedException", "ResourceNotFoundException", "DecryptionFailure"]
)
def test_aws_service_errors_are_safe_and_never_fall_back(aws, monkeypatch, code):
    monkeypatch.setenv("X_LOCALE_SECRET", "fallback-must-not-be-used")
    aws[0].add_client_error(
        "get_secret_value",
        service_error_code=code,
        service_message="sensitive-value",
        expected_params={"SecretId": ARN},
    )
    with pytest.raises(RuntimeError, match="Cannot load Secrets Manager") as error:
        config.Settings()
    assert "sensitive-value" not in str(error.value)
    assert error.value.__suppress_context__


@pytest.mark.parametrize(
    "failure", [NoCredentialsError(), EndpointConnectionError(endpoint_url="sensitive-value")]
)
def test_credential_and_network_errors_are_safe(monkeypatch, failure):
    monkeypatch.setenv("SECRET_ENABLE", "true")
    monkeypatch.setenv("X_LOCALE_SECRET_ID", ARN)
    monkeypatch.setattr("boto3.client", Mock(side_effect=failure))
    with pytest.raises(RuntimeError, match="Cannot load Secrets Manager") as error:
        config.Settings()
    assert "sensitive-value" not in str(error.value)


@pytest.mark.parametrize(
    "response",
    [
        {"SecretBinary": b"sensitive-value"},
        {"SecretString": "{sensitive-value"},
        {"SecretString": "[]"},
        {"SecretString": "null"},
        {"SecretString": "42"},
        {"SecretString": '"sensitive-value"'},
    ],
)
def test_invalid_payload_is_safe(aws, response):
    aws[0].add_response("get_secret_value", response, {"SecretId": ARN})
    with pytest.raises(RuntimeError, match="Secrets Manager configuration") as error:
        config.Settings()
    assert "sensitive-value" not in str(error.value)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("DATABASE_URL", None),
        ("DATABASE_URL", "sqlite:///sensitive-value"),
        ("DATABASE_URL", "postgresql://user:sensitive-value@localhost:invalid/app"),
        ("DATABASE_URL", "postgresql://localhost"),
        ("X_LOCALE_SECRET", None),
        ("X_LOCALE_SECRET", " "),
        ("X_LOCALE_SECRET", config.INSECURE_DEFAULT_X_LOCALE_SECRET),
    ],
)
def test_required_values_checked_even_with_dev_bypass(aws, field, value, monkeypatch):
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    payload = {**PAYLOAD}
    if value is None:
        payload.pop(field)
    else:
        payload[field] = value
    respond(aws, payload)
    with pytest.raises(RuntimeError, match=field) as error:
        config.Settings()
    assert "sensitive-value" not in str(error.value)


def test_pydantic_validation_does_not_print_secret_inputs(aws):
    respond(aws, {**PAYLOAD, "OIDC_CLIENT_SECRET": {"sensitive-value": "sensitive-value"}})
    with pytest.raises(ValidationError) as error:
        config.Settings()
    assert "oidc_client_secret" in str(error.value)
    assert "sensitive-value" not in str(error.value)


@pytest.mark.parametrize(
    "entrypoint",
    [
        "import app.main",
        "import runpy; runpy.run_path('alembic/env.py')",
        "from app.cli import app; app(['seed-demo'])",
    ],
)
def test_entrypoints_load_configuration_before_database_setup(entrypoint):
    result = _run_entrypoint(entrypoint, {"X_LOCALE_SECRET": "test-value"}, handled=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "payload",
    [
        {**PAYLOAD, "DATABASE_URL": "sqlite:///sensitive-value"},
        {**PAYLOAD, "OIDC_CLIENT_SECRET": {"sensitive-value": "sensitive-value"}},
    ],
)
def test_unhandled_cli_errors_do_not_print_configuration(payload):
    result = _run_entrypoint("from app.cli import app; app(['seed-demo'])", payload)
    assert result.returncode != 0
    assert "sensitive-value" not in result.stdout + result.stderr
    assert PAYLOAD["X_LOCALE_SECRET"] not in result.stdout + result.stderr
    assert "RuntimeError" in result.stderr or "ValidationError" in result.stderr


def _run_entrypoint(entrypoint, payload, *, handled=False):
    script = f"""
import json
from pathlib import Path
from unittest.mock import patch
import boto3
from botocore.stub import Stubber
client = boto3.client('secretsmanager', region_name='eu-west-1',
                      aws_access_key_id='testing', aws_secret_access_key='testing')
with Stubber(client) as stub:
    stub.add_response('get_secret_value', {{'SecretString': json.dumps({payload!r})}},
                      {{'SecretId': {ARN!r}}})
    with patch('pydantic_settings.sources.DotEnvSettingsSource._load_env_vars', return_value={{}}), \
         patch('boto3.client', return_value=client), \
         patch('sqlalchemy.create_engine', side_effect=AssertionError('Database initialized too early')):
        try:
            {entrypoint}
        except RuntimeError as error:
            if not {handled!r}:
                raise
            assert 'DATABASE_URL' in str(error), str(error)
        else:
            raise AssertionError('Startup should fail')
    stub.assert_no_pending_responses()
"""
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        env={**os.environ, "SECRET_ENABLE": "true", "X_LOCALE_SECRET_ID": ARN},
    )


def _production_command():
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile.prod"
    command = next(line for line in dockerfile.read_text().splitlines() if line.startswith("CMD "))
    return json.loads(command.removeprefix("CMD "))


def _run_production_guard(secret_id):
    args = _production_command()
    script = args[2].replace("alembic upgrade head", "echo MIGRATIONS_STARTED")
    script = script.replace("exec uvicorn", "echo uvicorn")
    env = {**os.environ, "X_LOCALE_SECRET_ID": secret_id}
    return subprocess.run([*args[:2], script], capture_output=True, text=True, env=env)


def test_production_command_allows_env_configuration_without_secret():
    result = _run_production_guard("")
    assert result.returncode == 0
    assert "MIGRATIONS_STARTED" in result.stdout


def test_compose_secret_url_matches_bundled_postgres():
    root = Path(__file__).resolve().parents[2]
    readme = (root / "README.md").read_text(encoding="utf-8")
    docs = (root / "docs" / "aws-secrets-manager.md").read_text(encoding="utf-8")
    compose = (root / "docker-compose.prod.yml").read_text(encoding="utf-8")
    url = "postgresql+psycopg://xlocale:<POSTGRES_PASSWORD>@postgres:5432/xlocale"
    assert "export POSTGRES_PASSWORD=" in readme
    assert "@postgres:5432/xlocale" in docs
    assert url in compose
    assert "secrets-arn" not in compose
    assert "X_LOCALE_SECRET_ID" in compose
