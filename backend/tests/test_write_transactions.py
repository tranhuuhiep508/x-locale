"""Retry eligibility, commit ownership, and transaction state after failure."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, OperationalError

from app.models import Project
from app.services import write_transactions as transactions
from tests.helpers import make_project


def database_error(state="40P01", constraint="", *, integrity=False):
    original = Exception("injected database failure")
    original.sqlstate = state
    original.diag = SimpleNamespace(constraint_name=constraint)
    return (IntegrityError if integrity else OperationalError)("statement", {}, original)


@pytest.fixture()
def no_retry_delay(monkeypatch):
    delays = []
    monkeypatch.setattr(transactions.time, "sleep", delays.append)
    return delays


@pytest.mark.parametrize("constraint", transactions.MODULE_REFERENCE_CONSTRAINTS)
def test_retry_classifier_requires_exact_constraint_and_state(constraint):
    error = database_error("23503", constraint, integrity=True)
    assert transactions.retryable_write_code(error, restore=True) == "module_reference_conflict"
    assert transactions.retryable_write_code(error, restore=False) is None
    assert (
        transactions.retryable_write_code(
            database_error("23505", constraint, integrity=True), restore=True
        )
        is None
    )
    assert (
        transactions.retryable_write_code(
            database_error("23503", "fk_strings_project_module", integrity=True), restore=True
        )
        is None
    )
    assert transactions.retryable_write_code(database_error("08006"), restore=True) is None


@pytest.mark.parametrize("commit_failure", [False, True])
def test_full_write_retried_with_clean_context(
    client, session_factory, monkeypatch, no_retry_delay, commit_failure
):
    pid = uuid.UUID(make_project(client)["id"])
    calls, access_checks = [], []
    with session_factory() as db:
        actor = {"actor_type": "system", "actor_id": None, "actor_label": "Retry test"}
        db.info["activity"] = dict(actor)
        db.info["retry_project_access"] = lambda: access_checks.append(True)
        commit = db.commit
        commits = 0

        def fail_commit_once():
            nonlocal commits
            commits += 1
            if commit_failure and commits == 1:
                raise database_error()
            commit()

        monkeypatch.setattr(db, "commit", fail_commit_once)

        def write():
            calls.append(True)
            assert db.info["activity"] == actor
            assert "restore_key" not in db.info
            assert "_x_locale_restore_intent" not in db.info
            project = db.get(Project, pid)
            assert project.name == "Test Project"
            project.name = "Committed once"
            db.info["activity"]["batch_id"] = str(uuid.uuid4())
            db.info["restore_key"] = "attempt key"
            db.info["_x_locale_restore_intent"] = True
            db.flush()
            if not commit_failure and len(calls) == 1:
                raise database_error()
            return "result"

        assert transactions.run_write(db, pid, "test", write) == "result"
        assert len(calls) == 2 and access_checks == [True]
        assert db.info["activity"] == actor
        assert len(no_retry_delay) == 1 and 0.05 <= no_retry_delay[0] <= 0.15
    with session_factory() as db:
        assert db.get(Project, pid).name == "Committed once"


@pytest.mark.parametrize(
    "error,restore,code",
    [
        (database_error(), False, "concurrent_modification"),
        (
            database_error("23503", "strings_module_id_fkey", integrity=True),
            True,
            "module_reference_conflict",
        ),
        (
            database_error("23503", "strings_published_module_id_fkey", integrity=True),
            True,
            "module_reference_conflict",
        ),
        (
            database_error("23503", "fk_strings_published_module_id_modules", integrity=True),
            True,
            "module_reference_conflict",
        ),
    ],
)
def test_retry_exhaustion_rolls_back_and_maps_409(
    client, session_factory, no_retry_delay, error, restore, code
):
    pid = uuid.UUID(make_project(client)["id"])
    calls = []
    with session_factory() as db:

        def write():
            calls.append(True)
            db.get(Project, pid).name = "Must roll back"
            db.flush()
            raise error

        with pytest.raises(HTTPException) as caught:
            transactions.run_write(db, pid, "test", write, restore=restore)
        assert caught.value.status_code == 409
        assert caught.value.detail == transactions.retryable_write_conflict(code).detail
        assert len(calls) == 2 and len(no_retry_delay) == 1
        assert not db.in_transaction()
    with session_factory() as db:
        assert db.get(Project, pid).name == "Test Project"


@pytest.mark.parametrize(
    "error,restore,status",
    [
        (HTTPException(409, "Conflict on activity. Pass force=true to override."), True, 409),
        (HTTPException(409, {"code": "invalid_snapshot"}), True, 409),
        (database_error("08006"), True, None),
        (database_error("23503", "other_fk", integrity=True), True, None),
        (database_error("23503", "strings_module_id_fkey", integrity=True), False, None),
        (database_error("23505", "uq_project_key_alive", integrity=True), True, 409),
        (database_error("23503", "fk_strings_project_module", integrity=True), True, 400),
    ],
)
def test_nonretryable_errors_keep_existing_behavior(
    client, session_factory, no_retry_delay, error, restore, status
):
    pid = uuid.UUID(make_project(client)["id"])
    calls = []
    with session_factory() as db:

        def write():
            calls.append(True)
            db.info["restore_key"] = "occupied"
            raise error

        with pytest.raises(HTTPException if status else type(error)) as caught:
            transactions.run_write(db, pid, "test", write, restore=restore)
        if status:
            assert caught.value.status_code == status
        assert len(calls) == 1 and no_retry_delay == []


def test_success_is_not_replayed_after_response_failure(client, session_factory, no_retry_delay):
    pid = uuid.UUID(make_project(client)["id"])
    calls = []
    with session_factory() as db:

        def write():
            calls.append(True)
            db.get(Project, pid).name = "Already committed"

        transactions.run_write(db, pid, "test", write)
        with pytest.raises(OperationalError):
            raise database_error()  # Response construction is outside the runner.
        assert len(calls) == 1 and no_retry_delay == []
    with session_factory() as db:
        assert db.get(Project, pid).name == "Already committed"
