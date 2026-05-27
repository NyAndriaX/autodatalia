import sqlite3
import os
from pathlib import Path
from typing import Optional, Dict, Any
from passlib.context import CryptContext

from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _get_db_path() -> Path:
    db_path = settings.content_dir / "users.db"
    return db_path

def init_db():
    """Initialize the users table."""
    conn = sqlite3.connect(_get_db_path())
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            full_name TEXT
        )
    ''')
    conn.commit()
    conn.close()

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = sqlite3.connect(_get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = sqlite3.connect(_get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def create_user(email: str, password_hash: Optional[str] = None, full_name: Optional[str] = None) -> int:
    conn = sqlite3.connect(_get_db_path())
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)",
        (email, password_hash, full_name)
    )
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return user_id

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

# Initialize the db when the module is imported
init_db()
