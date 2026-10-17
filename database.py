import sqlite3
import os

DB_FILE = 'family_tree.db'

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
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
