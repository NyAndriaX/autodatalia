"""User authentication storage backed by PostgreSQL.

Why Postgres (not SQLite): the rest of Datalia's state still lives in
JSON files inside the content volume (posts, automation rules, oauth
tokens, cost logs…). That's intentional — those are single-writer
workloads where a file is fine. But the ``users`` table sits in front
of every auth call and needs to outlive container restarts on
multi-host setups (Caddy + caption-api split, blue-green deploys,
read-replica routing later). Postgres handles all of that cleanly and
the connection cost is negligible at this scale.

Connection model: ``psycopg2.connect()`` per call. This is fine for the
auth-only workload (handful of writes/day, dozens of reads/day) and
keeps the code identical to the previous SQLite pattern — no pool to
size, no async machinery to keep alive across event loops. Swap to a
pool when ``/auth/me`` starts trending past 50 req/s.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import psycopg2
import psycopg2.extras
from passlib.context import CryptContext

from .config import settings

log = logging.getLogger("datalia.db")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _connect():
    """Open a fresh connection to the configured Postgres instance.

    Prefers ``DATABASE_URL`` when present (the standard 12-factor knob);
    otherwise falls back to the individual ``POSTGRES_*`` variables so
    the docker-compose default (host=postgres, db=datalia) keeps
    working without anyone exporting a full DSN.
    """
    if settings.database_url:
        return psycopg2.connect(settings.database_url)
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "datalia"),
        user=os.getenv("POSTGRES_USER", "datalia"),
        password=os.getenv("POSTGRES_PASSWORD", "datalia"),
    )


def init_db(*, retries: int = 30, delay: float = 1.0) -> None:
    """Create the ``users`` table if it doesn't exist.

    Called from the FastAPI startup hook (not at module import) so a
    Postgres that's still booting doesn't crash the whole API process.
    Retries with a short backoff to ride out the typical 1-5s window
    after ``docker compose up`` where the postgres container is up but
    not yet accepting connections.
    """
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            conn = _connect()
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id          SERIAL PRIMARY KEY,
                        email       TEXT UNIQUE NOT NULL,
                        password_hash TEXT,
                        full_name   TEXT
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()
            log.info("[db] users table ready (postgres)")
            return
        except psycopg2.OperationalError as exc:
            last_err = exc
            if attempt == 0:
                log.info("[db] waiting for postgres… (%s)", exc.__class__.__name__)
            time.sleep(delay)
    # If we exhausted retries the next /auth call will surface the real
    # error to the client. Don't crash the API — other endpoints
    # (publish, scheduler, etc.) don't need users.db at all.
    log.warning("[db] init_db gave up after %d retries: %s", retries, last_err)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    conn = _connect()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    conn = _connect()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_user(
    email: str,
    password_hash: str | None = None,
    full_name: str | None = None,
) -> int:
    """Insert a new user and return the auto-assigned id.

    Postgres has no ``cursor.lastrowid`` — use ``RETURNING id`` so we
    can read the new pk in the same round-trip.
    """
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (email, password_hash, full_name) "
            "VALUES (%s, %s, %s) RETURNING id",
            (email, password_hash, full_name),
        )
        user_id = cur.fetchone()[0]
        conn.commit()
        return int(user_id)
    finally:
        conn.close()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)
