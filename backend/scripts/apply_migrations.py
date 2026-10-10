"""Apply the SQL files in backend/migrations/ to the database in DATABASE_URL.

Usage (from the backend/ folder, venv active):
    python -m scripts.apply_migrations           # apply anything not applied yet
    python -m scripts.apply_migrations --status  # show what is applied

Each file runs once; applied files are recorded in public.schema_migrations.
Alternative: paste each file into the Supabase SQL Editor and run it (see README).
"""
import argparse
import sys
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

BOOKKEEPING_SQL = """
create table if not exists public.schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
"""


def _plain_conninfo(url: str) -> str:
    """psycopg wants postgresql://, not SQLAlchemy's postgresql+psycopg://"""
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql"))


def applied(conn) -> set[str]:
    return {row[0] for row in conn.execute("select filename from public.schema_migrations")}


def apply_all(database_url: str, verbose: bool = True) -> list[str]:
    done = []
    with psycopg.connect(_plain_conninfo(database_url), autocommit=True, prepare_threshold=None) as conn:
        conn.execute(BOOKKEEPING_SQL)
        already = applied(conn)
        for path in migration_files():
            if path.name in already:
                continue
            if verbose:
                print(f"Applying {path.name} ...")
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("insert into public.schema_migrations (filename) values (%s)", (path.name,))
            done.append(path.name)
    if verbose:
        print("Applied: " + (", ".join(done) if done else "nothing (already up to date)"))
    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true", help="only list applied migrations")
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app.core.config import get_settings

    url = get_settings().database_url
    if not url:
        print("DATABASE_URL is not set. Add it to backend/.env first.")
        return 1
    if args.status:
        with psycopg.connect(_plain_conninfo(url), autocommit=True, prepare_threshold=None) as conn:
            conn.execute(BOOKKEEPING_SQL)
            names = applied(conn)
        for path in migration_files():
            print(("[applied] " if path.name in names else "[pending] ") + path.name)
        return 0
    apply_all(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
