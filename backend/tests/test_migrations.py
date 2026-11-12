"""The migration runner: ordered, once each, refusing a changed file."""

from __future__ import annotations

from pathlib import Path

import psycopg
import pytest

from player_backend.db.migrate import MigrationError, apply_migrations, load_migrations


def test_files_are_numbered_without_gaps() -> None:
    names = [m.name for m in load_migrations()]
    assert names[0].startswith("0001_") and len(names) >= 3


def test_bad_names_and_gaps_are_refused(tmp_path: Path) -> None:
    (tmp_path / "0001_a.sql").write_text("SELECT 1;")
    (tmp_path / "0003_c.sql").write_text("SELECT 1;")
    with pytest.raises(MigrationError):
        load_migrations(tmp_path)
    (tmp_path / "2_bad.sql").write_text("SELECT 1;")
    with pytest.raises(MigrationError):
        load_migrations(tmp_path)


def test_a_second_run_applies_nothing(db_url: str) -> None:
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("SET ROLE player_owner")
        assert apply_migrations(conn) == []


def test_a_changed_applied_file_is_refused(db_url: str) -> None:
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("SET ROLE player_owner")
        conn.execute("UPDATE player_meta.schema_migrations SET sha256 = 'x' WHERE version = 1")
        try:
            with pytest.raises(MigrationError):
                apply_migrations(conn)
        finally:
            first = load_migrations()[0]
            conn.execute(
                "UPDATE player_meta.schema_migrations SET sha256 = %s WHERE version = 1",
                (first.sha256,),
            )
