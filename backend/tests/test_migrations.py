"""The migration runner: ordered, once each, refusing a changed file, every file wired in."""

from __future__ import annotations

import ast
from pathlib import Path

import psycopg
import pytest

import player_backend.db.migrate as migrate
from player_backend.db.executor import SQL_DIR, SQL_FILES, Handle
from player_backend.db.executor._query import registered_text  # pyright: ignore[reportPrivateUsage]
from player_backend.db.migrate import MigrationError, apply_migrations, load_migrations, sha256
from player_backend.db.queries import migrations as q


def test_files_are_numbered_without_gaps() -> None:
    names = load_migrations()
    assert names[0].startswith("0001_") and len(names) >= 3


def test_bad_names_and_gaps_are_refused(tmp_path: Path) -> None:
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "0003_c.sql").write_text("SELECT 1;")
    with pytest.raises(MigrationError):
        load_migrations(tmp_path)
    (tmp_path / "2_bad.sql").write_text("SELECT 1;")
    with pytest.raises(MigrationError):
        load_migrations(tmp_path)


def _steps() -> list[tuple[str, str]]:
    """(file, constant executed) for each step of apply_migrations."""
    tree = ast.parse(Path(migrate.__file__).read_text(encoding="utf-8"))
    steps: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.With):
            call = node.items[0].context_expr
            if isinstance(call, ast.Call) and ast.unparse(call.func) == "_step":
                name = call.args[2]
                assert isinstance(name, ast.Constant)
                executed = [
                    ast.unparse(c.args[0])
                    for c in ast.walk(node)
                    if isinstance(c, ast.Call) and ast.unparse(c.func) == "db.rows"
                ]
                assert len(executed) == 1
                steps.append((str(name.value), executed[0]))
    return steps


def test_every_file_has_one_step_in_order_executing_its_own_constant() -> None:
    steps = _steps()
    assert [file for file, _ in steps] == load_migrations() == list(SQL_FILES)
    for file, executed in steps:
        # What the executor will run for the step's constant is the file, byte for byte.
        constant = vars(q)[executed.removeprefix("q.")]
        assert registered_text(constant) == (SQL_DIR / file).read_text(encoding="utf-8")


def test_a_second_run_applies_nothing(owner_db: Handle) -> None:
    assert apply_migrations(owner_db) == []


def test_a_changed_applied_file_is_refused(db_url: str, owner_db: Handle) -> None:
    update = "UPDATE player_meta.schema_migrations SET sha256 = %s WHERE version = 1"
    with psycopg.connect(db_url, autocommit=True) as conn:
        before = conn.execute(
            "SELECT sha256 FROM player_meta.schema_migrations WHERE version = 1"
        ).fetchone()
        assert before == (sha256((SQL_DIR / SQL_FILES[0]).read_text(encoding="utf-8")),)
        conn.execute(update, ("x",))
        try:
            with pytest.raises(MigrationError):
                apply_migrations(owner_db)
        finally:
            conn.execute(update, before)
