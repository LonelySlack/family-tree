import sqlite3
import os

# Next to this file, not the working directory, so the app finds its data
# however it's started.
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'family_tree.db')

# Columns added after the table was first created. init_db adds any that are
# missing, so an old database and a fresh install end up with the same schema.
ADDED_COLUMNS = {
    'is_deceased': 'INTEGER DEFAULT 0',
    'nickname': 'TEXT',
}

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
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
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
