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


@pytest.fixture
def bootstrap(tmp_path, monkeypatch):
    path = tmp_path / "secrets-arn"
    monkeypatch.setattr(config, "SECRETS_ARN_PATH", path)
    return path


@pytest.fixture
def aws(bootstrap, monkeypatch):
    bootstrap.write_text(ARN + "\n", encoding="utf-8")
    client = boto3.session.Session().client(
        "secretsmanager",
        region_name="eu-west-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    factory = Mock(return_value=client)
    monkeypatch.setattr(config.boto3, "client", factory)
    with Stubber(client) as stub:
        yield stub, factory
        stub.assert_no_pending_responses()


def respond(aws, payload):
    aws[0].add_response(
        "get_secret_value", {"SecretString": json.dumps(payload)}, {"SecretId": ARN}
    )


def test_local_sources_unchanged_and_no_aws(bootstrap, monkeypatch, tmp_path):
    factory = Mock(side_effect=AssertionError("AWS must not be used"))
    monkeypatch.setattr(config.boto3, "client", factory)
    dotenv = tmp_path / ".env"
    dotenv.write_text("DEFAULT_BASE_LANGUAGE=ja\nBEDROCK_MAX_TOKENS=123\n")
    monkeypatch.delenv("BEDROCK_MAX_TOKENS", raising=False)
    monkeypatch.setenv("DEFAULT_BASE_LANGUAGE", "en")
    loaded = config.Settings(_env_file=dotenv)
    assert loaded.default_base_language == "en"
    assert loaded.bedrock_max_tokens == 123
    assert (
        config.Settings(_env_file=dotenv, default_base_language="fr").default_base_language == "fr"
    )
    monkeypatch.delenv("DEFAULT_BASE_LANGUAGE")
    assert config.Settings(_env_file=dotenv).default_base_language == "ja"
    assert config.Settings(_env_file=None).default_base_language == "vi"
    factory.assert_not_called()


def test_all_settings_map_and_aws_is_authoritative(aws, monkeypatch, tmp_path):
    payload = {
        name.upper(): field.default
        for name, field in config.Settings.model_fields.items()
        if name != "auth_dev_bypass"
    }
    payload.update(PAYLOAD)
    payload.update(
        {
            "ENV": "production",
            "AWS_REGION": "ap-southeast-1",
            "BEDROCK_MAX_TOKENS": "2048",
            "SESSION_COOKIE_SECURE": True,
            "IMPORT_ASYNC_THRESHOLD": 22,
            "OIDC_CLIENT_SECRET": "test-oidc-value",
            "STATIC_DIR": "static",
            "UNRELATED": "ignored",
            "aws_region": "ignored",
        }
    )
    respond(aws, payload)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///wrong.db")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AWS_REGION", "wrong-region")
    dotenv = tmp_path / ".env"
    dotenv.write_text("BEDROCK_MAX_TOKENS=not-an-integer\n")
    loaded = config.Settings(_env_file=dotenv, database_url="sqlite:///also-wrong.db")
    for name in config.Settings.model_fields:
        if name == "auth_dev_bypass":
            assert loaded.auth_dev_bypass is True
            continue
        expected = 2048 if name == "bedrock_max_tokens" else payload[name.upper()]
        assert getattr(loaded, name) == expected
    kwargs = aws[1].call_args.kwargs
    assert kwargs["region_name"] == "eu-west-1"
    assert kwargs["config"].retries == {"mode": "standard", "total_max_attempts": 3}
    assert kwargs["config"].connect_timeout == 5
    assert kwargs["config"].read_timeout == 10
    aws[1].assert_called_once()


def test_aws_mode_env_fills_keys_missing_from_secret(aws, monkeypatch):
    respond(aws, PAYLOAD)
    monkeypatch.setenv("BEDROCK_MAX_TOKENS", "999")
    monkeypatch.setenv("STATIC_DIR", "static")
    loaded = config.Settings()
    assert loaded.bedrock_max_tokens == 999
    assert loaded.static_dir == "static"
    assert loaded.oidc_client_secret == ""


def test_aws_mode_secret_beats_env_for_present_keys(aws, monkeypatch):
    respond(aws, {**PAYLOAD, "BEDROCK_MAX_TOKENS": 2048})
    monkeypatch.setenv("BEDROCK_MAX_TOKENS", "999")
    assert config.Settings().bedrock_max_tokens == 2048


def test_secret_rejects_auth_dev_bypass(aws):
    respond(aws, {**PAYLOAD, "AUTH_DEV_BYPASS": True})
    with pytest.raises(RuntimeError, match="AUTH_DEV_BYPASS"):
        config.Settings()


@pytest.mark.parametrize("explicit_env_file", [False, True])
@pytest.mark.parametrize("dotenv_error", ["encoding", "permission"])
def test_aws_mode_never_reads_dotenv(aws, monkeypatch, tmp_path, explicit_env_file, dotenv_error):
    respond(aws, PAYLOAD)
    dotenv = tmp_path / ".env"
    dotenv.write_bytes(b"DEFAULT_BASE_LANGUAGE=\xff\n")
    monkeypatch.chdir(tmp_path)
    if dotenv_error == "permission":
        original_open = open

        def open_file(path, *args, **kwargs):
            if Path(path).name == ".env":
                raise PermissionError("dotenv must not be read")
            return original_open(path, *args, **kwargs)

        monkeypatch.setattr("builtins.open", open_file)
    loaded = config.Settings(**({"_env_file": dotenv} if explicit_env_file else {}))
    assert loaded.database_url == PAYLOAD["DATABASE_URL"]
    assert loaded.default_base_language == "vi"
    aws[1].assert_called_once()


@pytest.mark.parametrize("content", ["", "   ", "name-only", "arn:aws:s3:::bucket", ARN + ":key::"])
def test_invalid_bootstrap_fails_before_aws(bootstrap, monkeypatch, content):
    bootstrap.write_text(content)
    factory = Mock()
    monkeypatch.setattr(config.boto3, "client", factory)
    with pytest.raises(RuntimeError, match="full secret ARN"):
        config.Settings()
    factory.assert_not_called()


def test_unreadable_bootstrap_fails(bootstrap):
    bootstrap.mkdir()
    with pytest.raises(RuntimeError, match="Cannot read"):
        config.Settings()


def test_dangling_bootstrap_symlink_fails(bootstrap):
    bootstrap.symlink_to(bootstrap.parent / "missing")
    with pytest.raises(RuntimeError, match="Cannot read"):
        config.Settings()


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
def test_credential_and_network_errors_are_safe(bootstrap, monkeypatch, failure):
    bootstrap.write_text(ARN)
    monkeypatch.setattr(config.boto3, "client", Mock(side_effect=failure))
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
original_read = Path.read_text
def read(path, *args, **kwargs):
    if str(path) == '/run/x-locale/secrets-arn':
        return {ARN!r}
    return original_read(path, *args, **kwargs)
with Stubber(client) as stub:
    stub.add_response('get_secret_value', {{'SecretString': json.dumps({payload!r})}},
                      {{'SecretId': {ARN!r}}})
    with patch.object(Path, 'read_text', read), patch('boto3.client', return_value=client), \
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
        env=os.environ.copy(),
    )


def test_production_command_requires_bootstrap_before_alembic():
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile.prod"
    command = next(line for line in dockerfile.read_text().splitlines() if line.startswith("CMD "))
    args = json.loads(command.removeprefix("CMD "))
    # Exercise the actual Docker command with a guaranteed absent mount and a migration sentinel.
    script = args[2].replace("/run/x-locale/secrets-arn", "/proc/xlocale-missing-bootstrap")
    script = script.replace("alembic upgrade head", "echo MIGRATIONS_STARTED")
    result = subprocess.run([*args[:2], script], capture_output=True, text=True)
    assert result.returncode == 1
    assert "Production requires" in result.stderr
    assert "MIGRATIONS_STARTED" not in result.stdout
