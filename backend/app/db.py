"""MariaDB-backed persistence for users and application state."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import pymysql
from passlib.context import CryptContext

from .config import settings

log = logging.getLogger("datalia.db")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_DOC_TABLE = "app_documents"


def _database_params(*, database_override: str | None = None) -> dict[str, Any]:
    if settings.database_url:
        parsed = urlparse(settings.database_url)
        if parsed.scheme not in {"mysql", "mariadb"}:
            raise RuntimeError(
                "DATABASE_URL must use a mysql:// or mariadb:// scheme for MariaDB."
            )
        db_name = database_override
        if db_name is None:
            db_name = parsed.path.lstrip("/") or None
        # Fail fast on a DSN with no database. Passing database=None to
        # pymysql connects without selecting a schema, so every query would
        # then fail with "No database selected" far from the real cause.
        if db_name is None:
            raise RuntimeError(
                "DATABASE_URL must include a database name "
                "(e.g. mysql://user:pw@host:3306/datalia)."
            )
        # Preserve query params (e.g. ?charset=utf8mb4&ssl=true) instead of
        # silently dropping everything after '?'. urlparse keeps them out of
        # .path, but they were never threaded through to pymysql before.
        query = parse_qs(parsed.query)
        charset = (query.get("charset") or ["utf8mb4"])[0]
        ssl_raw = (query.get("ssl") or [""])[0].strip().lower()
        use_ssl = ssl_raw in {"1", "true", "yes", "on", "required"}
        params: dict[str, Any] = {
            "host": parsed.hostname or os.getenv("MARIADB_HOST", "mariadb"),
            "port": parsed.port or int(os.getenv("MARIADB_PORT", "3306")),
            "user": unquote(parsed.username or os.getenv("MARIADB_USER", "datalia")),
            "password": unquote(
                parsed.password or os.getenv("MARIADB_PASSWORD", "datalia")
            ),
            "database": db_name,
            "charset": charset,
        }
        if use_ssl:
            params["ssl"] = {"ssl": {}}
        return params
    return {
        "host": os.getenv("MARIADB_HOST", "mariadb"),
        "port": int(os.getenv("MARIADB_PORT", "3306")),
        "user": os.getenv("MARIADB_USER", "datalia"),
        "password": os.getenv("MARIADB_PASSWORD", "datalia"),
        "database": database_override or os.getenv("MARIADB_DATABASE", "datalia"),
        "charset": "utf8mb4",
    }


def _connect(*, database_override: str | None = None):
    params = _database_params(database_override=database_override)
    connect_kwargs: dict[str, Any] = {
        "host": params["host"],
        "port": params["port"],
        "user": params["user"],
        "password": params["password"],
        "database": params["database"],
        "autocommit": True,
        "charset": params.get("charset", "utf8mb4"),
        "cursorclass": pymysql.cursors.DictCursor,
    }
    if params.get("ssl"):
        connect_kwargs["ssl"] = params["ssl"]
    return pymysql.connect(**connect_kwargs)


def _scope_key(scope_owner_id: str | int | None = None) -> str:
    """Map a WORKSPACE id to its data-isolation scope key.

    Every collaborative collection is partitioned by ``ws:{workspace_id}``. The
    argument is a workspace id (resolved from membership by authz), NOT a user
    id. A clean ``ws:`` prefix means any stray non-workspace id fails closed
    (resolves to a scope with no rows) rather than leaking ``user:`` era data.
    """
    if scope_owner_id in (None, "", 0, "0"):
        return "global"
    try:
        normalized = int(scope_owner_id)
    except (TypeError, ValueError):
        return "global"
    if normalized <= 0:
        return "global"
    return f"ws:{normalized}"


def _workspace_id_from_scope(scope_key: str) -> str | None:
    if scope_key.startswith("ws:"):
        return scope_key.split(":", 1)[1]
    return None


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _json_loads(raw: str) -> Any:
    return json.loads(raw) if raw else None


def _fetchone(query: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(query, args)
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _fetchall(query: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(query, args)
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def _execute(query: str, args: tuple[Any, ...]) -> None:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(query, args)
    finally:
        conn.close()


def init_db(*, retries: int = 30, delay: float = 1.0) -> None:
    """Create the MariaDB schema and import legacy file-backed state."""
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            conn = _connect()
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        email         VARCHAR(255) NOT NULL UNIQUE,
                        password_hash TEXT NULL,
                        full_name     TEXT NULL,
                        role          VARCHAR(32) NOT NULL DEFAULT 'member'
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    SELECT COUNT(*) AS n
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'users'
                      AND COLUMN_NAME = 'role'
                    """
                )
                has_role = int((cur.fetchone() or {}).get("n") or 0) > 0
                if not has_role:
                    cur.execute(
                        "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'member'"
                    )
                    # Preserve previous behavior for pre-existing installs:
                    # any users created before roles existed keep admin-level
                    # capability until an explicit role-management flow exists.
                    cur.execute("UPDATE users SET role = 'admin'")
                # active_workspace_id: which of the user's workspaces is current
                # (multi-workspace membership + switcher). NULL => fall back to
                # their earliest membership.
                cur.execute(
                    """
                    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
                      AND COLUMN_NAME = 'active_workspace_id'
                    """
                )
                if int((cur.fetchone() or {}).get("n") or 0) == 0:
                    cur.execute(
                        "ALTER TABLE users ADD COLUMN active_workspace_id BIGINT NULL"
                    )
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {_DOC_TABLE} (
                        collection_name VARCHAR(64) NOT NULL,
                        scope_key       VARCHAR(64) NOT NULL,
                        doc_id          VARCHAR(191) NOT NULL,
                        sort_ts         DOUBLE NULL,
                        payload_json    LONGTEXT NOT NULL,
                        created_at      DOUBLE NOT NULL,
                        updated_at      DOUBLE NOT NULL,
                        PRIMARY KEY (collection_name, scope_key, doc_id),
                        KEY idx_collection_scope_sort (collection_name, scope_key, sort_ts),
                        KEY idx_collection_sort (collection_name, sort_ts),
                        KEY idx_collection_updated (collection_name, updated_at)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
                # --- Workspaces + RBAC control plane (real tables, not the
                # doc-store: authz must be read BEFORE the scope is known, and
                # we need UNIQUE constraints + joins). Tenant DATA stays in
                # app_documents, re-scoped to ws:{id}. ---
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS workspaces (
                        id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        name          VARCHAR(255) NOT NULL,
                        owner_user_id BIGINT NOT NULL,
                        is_personal   TINYINT(1) NOT NULL DEFAULT 0,
                        created_at    DOUBLE NOT NULL,
                        KEY idx_owner (owner_user_id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
                # is_personal: a user's HOME workspace (created at registration)
                # which can never be deleted. On existing installs the column is
                # missing — add it and backfill the earliest-owned workspace per
                # owner as their personal one.
                cur.execute(
                    """
                    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspaces'
                      AND COLUMN_NAME = 'is_personal'
                    """
                )
                if int((cur.fetchone() or {}).get("n") or 0) == 0:
                    cur.execute(
                        "ALTER TABLE workspaces ADD COLUMN is_personal "
                        "TINYINT(1) NOT NULL DEFAULT 0"
                    )
                    cur.execute(
                        "UPDATE workspaces t JOIN ("
                        "  SELECT MIN(id) AS id FROM workspaces GROUP BY owner_user_id"
                        ") m ON t.id = m.id SET t.is_personal = 1"
                    )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS workspace_members (
                        id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        workspace_id BIGINT NOT NULL,
                        user_id      BIGINT NOT NULL,
                        role_id      BIGINT NOT NULL,
                        created_at   DOUBLE NOT NULL,
                        UNIQUE KEY uq_ws_user (workspace_id, user_id),
                        KEY idx_user (user_id),
                        KEY idx_ws (workspace_id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS roles (
                        id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        workspace_id BIGINT NOT NULL,
                        name         VARCHAR(64) NOT NULL,
                        is_system    TINYINT(1) NOT NULL DEFAULT 0,
                        created_at   DOUBLE NOT NULL,
                        UNIQUE KEY uq_ws_role (workspace_id, name),
                        KEY idx_ws (workspace_id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS role_permissions (
                        role_id        BIGINT NOT NULL,
                        permission_key VARCHAR(64) NOT NULL,
                        PRIMARY KEY (role_id, permission_key),
                        KEY idx_role (role_id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS workspace_invitations (
                        id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        workspace_id BIGINT NOT NULL,
                        email        VARCHAR(255) NOT NULL,
                        role_id      BIGINT NOT NULL,
                        token_hash   CHAR(64) NOT NULL,
                        invited_by   BIGINT NOT NULL,
                        expires_at   DOUBLE NOT NULL,
                        accepted_at  DOUBLE NULL,
                        created_at   DOUBLE NOT NULL,
                        UNIQUE KEY uq_token (token_hash),
                        KEY idx_ws_email (workspace_id, email)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """
                )
            finally:
                conn.close()
            migrate_legacy_state()
            # Backfill workspaces for any pre-workspace users + re-scope their
            # data to ws:{id}. Idempotent (no-op once any workspace exists).
            # Local import to avoid a db<->workspaces import cycle.
            from .workspaces import migrate_to_workspaces

            migrate_to_workspaces()
            log.info("[db] MariaDB schema ready")
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt == 0:
                log.info("[db] waiting for MariaDB… (%s)", exc.__class__.__name__)
            time.sleep(delay)
    raise RuntimeError(
        f"MariaDB init_db gave up after {retries} retries: {last_err}"
    ) from last_err


def count_users() -> int:
    row = _fetchone("SELECT COUNT(*) AS n FROM users", ())
    return int((row or {}).get("n") or 0)


def get_only_user_id() -> int | None:
    rows = _fetchall("SELECT id FROM users ORDER BY id ASC LIMIT 2", ())
    if len(rows) != 1:
        return None
    return int(rows[0]["id"])


def get_user_by_email(email: str) -> dict[str, Any] | None:
    return _fetchone("SELECT * FROM users WHERE email = %s", (email,))


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    return _fetchone("SELECT * FROM users WHERE id = %s", (user_id,))


def create_user(
    email: str,
    password_hash: str | None = None,
    full_name: str | None = None,
    role: str | None = None,
) -> int:
    # Flat internal tool — no admin tier. Everyone is a plain "member".
    assigned_role = role or "member"
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (email, password_hash, full_name, role) VALUES (%s, %s, %s, %s)",
            (email, password_hash, full_name, assigned_role),
        )
        return int(cur.lastrowid)
    finally:
        conn.close()


def update_user_password(user_id: int, password_hash: str) -> bool:
    """Set a user's password hash. Returns True if a row was updated.

    Used by the self-service "change password" flow and by the
    forgot/reset-password flow once a reset token has been validated.
    """
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (password_hash, int(user_id)),
        )
        return cur.rowcount > 0
    finally:
        conn.close()


def reset_all_state_for_tests() -> None:
    """Clear all persisted app/user state for isolated test runs."""
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {_DOC_TABLE}")
        cur.execute("DELETE FROM workspace_invitations")
        cur.execute("DELETE FROM role_permissions")
        cur.execute("DELETE FROM workspace_members")
        cur.execute("DELETE FROM roles")
        cur.execute("DELETE FROM workspaces")
        cur.execute("DELETE FROM users")
        cur.execute(f"ALTER TABLE {_DOC_TABLE} AUTO_INCREMENT = 1")
        cur.execute("ALTER TABLE workspace_invitations AUTO_INCREMENT = 1")
        cur.execute("ALTER TABLE workspace_members AUTO_INCREMENT = 1")
        cur.execute("ALTER TABLE roles AUTO_INCREMENT = 1")
        cur.execute("ALTER TABLE workspaces AUTO_INCREMENT = 1")
        cur.execute("ALTER TABLE users AUTO_INCREMENT = 1")
    finally:
        conn.close()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def list_collection_documents(
    collection: str,
    *,
    user_id: str | int | None = None,
    all_scopes: bool = False,
    newest_first: bool = True,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    query = (
        f"SELECT scope_key, payload_json FROM {_DOC_TABLE} "
        "WHERE collection_name = %s"
    )
    args: list[Any] = [collection]
    if not all_scopes:
        query += " AND scope_key = %s"
        args.append(_scope_key(user_id))
    order = "DESC" if newest_first else "ASC"
    query += f" ORDER BY COALESCE(sort_ts, updated_at) {order}, updated_at {order}"
    if limit is not None:
        query += " LIMIT %s"
        args.append(int(limit))
    rows = _fetchall(query, tuple(args))
    out: list[dict[str, Any]] = []
    for row in rows:
        payload = _json_loads(row["payload_json"])
        if isinstance(payload, dict) and "workspace_id" not in payload:
            wsid = _workspace_id_from_scope(row["scope_key"])
            if wsid is not None:
                payload["workspace_id"] = int(wsid)
        out.append(payload)
    return out


def get_collection_document(
    collection: str,
    doc_id: str,
    *,
    user_id: str | int | None = None,
    all_scopes: bool = False,
) -> dict[str, Any] | None:
    query = (
        f"SELECT scope_key, payload_json FROM {_DOC_TABLE} "
        "WHERE collection_name = %s AND doc_id = %s"
    )
    args: list[Any] = [collection, doc_id]
    if not all_scopes:
        query += " AND scope_key = %s"
        args.append(_scope_key(user_id))
    query += " LIMIT 1"
    row = _fetchone(query, tuple(args))
    if not row:
        return None
    payload = _json_loads(row["payload_json"])
    if isinstance(payload, dict) and "workspace_id" not in payload:
        wsid = _workspace_id_from_scope(row["scope_key"])
        if wsid is not None:
            payload["workspace_id"] = int(wsid)
    return payload


def upsert_collection_document(
    collection: str,
    doc_id: str,
    payload: dict[str, Any] | list[Any] | str,
    *,
    user_id: str | int | None = None,
    sort_ts: float | None = None,
) -> None:
    scope_key = _scope_key(user_id)
    now = time.time()
    existing = _fetchone(
        f"""
        SELECT created_at FROM {_DOC_TABLE}
        WHERE collection_name = %s AND scope_key = %s AND doc_id = %s
        LIMIT 1
        """,
        (collection, scope_key, doc_id),
    )
    created_at = float((existing or {}).get("created_at") or now)
    encoded = _json_dumps(payload)
    _execute(
        f"""
        INSERT INTO {_DOC_TABLE}
            (collection_name, scope_key, doc_id, sort_ts, payload_json, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            sort_ts = VALUES(sort_ts),
            payload_json = VALUES(payload_json),
            updated_at = VALUES(updated_at)
        """,
        (collection, scope_key, doc_id, sort_ts, encoded, created_at, now),
    )


def delete_collection_document(
    collection: str,
    doc_id: str,
    *,
    user_id: str | int | None = None,
) -> bool:
    scope_key = _scope_key(user_id)
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            DELETE FROM {_DOC_TABLE}
            WHERE collection_name = %s AND scope_key = %s AND doc_id = %s
            """,
            (collection, scope_key, doc_id),
        )
        return cur.rowcount > 0
    finally:
        conn.close()


def count_collection_documents(
    collection: str,
    *,
    user_id: str | int | None = None,
    all_scopes: bool = False,
) -> int:
    query = f"SELECT COUNT(*) AS n FROM {_DOC_TABLE} WHERE collection_name = %s"
    args: list[Any] = [collection]
    if not all_scopes:
        query += " AND scope_key = %s"
        args.append(_scope_key(user_id))
    row = _fetchone(query, tuple(args))
    return int((row or {}).get("n") or 0)


def load_scoped_blob(
    name: str,
    *,
    user_id: str | int | None = None,
    default: Any = None,
) -> Any:
    payload = get_collection_document("blobs", name, user_id=user_id)
    return default if payload is None else payload


def save_scoped_blob(
    name: str,
    payload: dict[str, Any] | list[Any] | str,
    *,
    user_id: str | int | None = None,
) -> None:
    upsert_collection_document("blobs", name, payload, user_id=user_id)


def list_scoped_blob_user_ids(name: str) -> list[int]:
    rows = _fetchall(
        f"""
        SELECT DISTINCT scope_key
        FROM {_DOC_TABLE}
        WHERE collection_name = %s AND doc_id = %s AND scope_key LIKE 'ws:%%'
        ORDER BY scope_key ASC
        """,
        ("blobs", name),
    )
    out: list[int] = []
    for row in rows:
        raw = str(row.get("scope_key") or "")
        suffix = raw.split(":", 1)[1] if ":" in raw else ""
        try:
            normalized = int(suffix)
        except (TypeError, ValueError):
            continue
        if normalized > 0:
            out.append(normalized)
    return out


def migrate_legacy_state() -> None:
    """One-time import from file-backed stores into MariaDB."""

    def _read_json(path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _migrate_collection(path: Path, collection: str, *, newest_first: bool) -> None:
        if count_collection_documents(collection, all_scopes=True) > 0 or not path.exists():
            return
        payload = _read_json(path)
        if not isinstance(payload, list):
            return
        items = payload if newest_first else list(payload)
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            doc_id = str(item.get("id") or f"{collection}-{index}")
            uid = item.get("user_id")
            sort_ts = (
                item.get("timestamp")
                or item.get("ts")
                or item.get("created_at")
                or item.get("updated_at")
                or item.get("published_at")
                or item.get("finished_at")
            )
            try:
                numeric_sort = float(sort_ts) if sort_ts is not None else None
            except (TypeError, ValueError):
                numeric_sort = None
            upsert_collection_document(
                collection,
                doc_id,
                item,
                user_id=uid,
                sort_ts=numeric_sort,
            )

    content = settings.content_dir
    _migrate_collection(content / "posts.json", "posts", newest_first=False)
    _migrate_collection(content / "automation_rules.json", "automation_rules", newest_first=False)
    _migrate_collection(content / "messages.json", "messages", newest_first=True)
    _migrate_collection(content / "video_jobs.json", "video_jobs", newest_first=True)
    _migrate_collection(content / "cost_logs.json", "cost_logs", newest_first=True)

    if load_scoped_blob("ai_cache", default=None) is None:
        cache = _read_json(content / ".ai_cache.json")
        if isinstance(cache, dict):
            save_scoped_blob("ai_cache", cache)

    if load_scoped_blob("runtime_settings", default=None) is None:
        overrides = _read_json(content / "runtime_settings.json")
        if isinstance(overrides, dict):
            save_scoped_blob("runtime_settings", overrides)

    for path in content.glob("runtime_settings_user_*.json"):
        suffix = path.stem.replace("runtime_settings_user_", "", 1)
        try:
            user_id = int(suffix)
        except ValueError:
            continue
        if load_scoped_blob("runtime_settings", user_id=user_id, default=None) is not None:
            continue
        overrides = _read_json(path)
        if isinstance(overrides, dict):
            save_scoped_blob("runtime_settings", overrides, user_id=user_id)

    global_tokens = _read_json(content / ".oauth_tokens.json")
    if load_scoped_blob("oauth_tokens", default=None) is None and isinstance(global_tokens, dict):
        save_scoped_blob("oauth_tokens", global_tokens)

    for path in content.glob(".oauth_tokens_*.json"):
        suffix = path.stem.replace(".oauth_tokens_", "", 1)
        try:
            user_id = int(suffix)
        except ValueError:
            continue
        if load_scoped_blob("oauth_tokens", user_id=user_id, default=None) is not None:
            continue
        tokens = _read_json(path)
        if isinstance(tokens, dict):
            save_scoped_blob("oauth_tokens", tokens, user_id=user_id)
