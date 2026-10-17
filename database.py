import sqlite3
import os

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# Next to this file, not the working directory, so the app finds its data
# however it's started.
DB_FILE = os.path.join(APP_DIR, 'family_tree.db')

# Columns added after the members table was first created. init_db adds any
# that are missing, so an old database and a fresh install end up the same.
ADDED_COLUMNS = {
    'is_deceased': 'INTEGER DEFAULT 0',
    'nickname': 'TEXT',
    'birth_order': 'INTEGER',  # 1 = eldest of their parents' children
    'photo': 'TEXT',           # file name in uploads/
}

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

def init_db():
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            gender TEXT,
            birth_date TEXT,
            death_date TEXT,
            father_id INTEGER,
            mother_id INTEGER,
            spouse_id INTEGER,
            notes TEXT,
            FOREIGN KEY(father_id) REFERENCES members(id),
            FOREIGN KEY(mother_id) REFERENCES members(id),
            FOREIGN KEY(spouse_id) REFERENCES members(id)
        )
    ''')
    existing = {row['name'] for row in c.execute('PRAGMA table_info(members)')}
    for column, definition in ADDED_COLUMNS.items():
        if column not in existing:
            c.execute(f'ALTER TABLE members ADD COLUMN {column} {definition}')

    # Marriages replace members.spouse_id, which allowed only one spouse each.
    # Each pair is stored once, smaller id first.
    has_marriages = c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='marriages'").fetchone()
    c.execute('''
        CREATE TABLE IF NOT EXISTS marriages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_a INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            person_b INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            UNIQUE(person_a, person_b),
            CHECK(person_a < person_b)
        )
    ''')
    if not has_marriages:
        # One-off: carry the old single-spouse links over. spouse_id is left in
        # place for older copies of the app but is no longer read or written.
        c.execute('''
            INSERT OR IGNORE INTO marriages (person_a, person_b)
            SELECT MIN(m.id, m.spouse_id), MAX(m.id, m.spouse_id)
            FROM members m JOIN members s ON s.id = m.spouse_id
            WHERE m.spouse_id IS NOT NULL AND m.spouse_id != m.id
        ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('pending', 'viewer', 'editor', 'admin')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
