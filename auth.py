"""Accounts: register, log in, roles, and the admin's user management.

Roles, from least to most:
  pending - registered, waiting for an admin; can see nothing
  viewer  - can look at the tree
  editor  - can also add, edit and delete people, photos and imports
  admin   - can also approve and manage accounts

The first account ever registered becomes admin, so a fresh install is
claimed by whoever sets it up.
"""
import os
import secrets
import time
from collections import defaultdict, deque
from functools import wraps

from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

import database

bp = Blueprint('auth', __name__)

ROLES = ['pending', 'viewer', 'editor', 'admin']
RANK = {r: i for i, r in enumerate(ROLES)}
MIN_PASSWORD = 8


def secret_key():
    """Per-install session key, created on first run and kept out of git."""
    path = os.path.join(database.APP_DIR, 'instance', 'secret_key')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


def current_user():
    uid = session.get('uid')
    if not uid:
        return None
    conn = database.get_connection()
    row = conn.execute('SELECT id, username, display_name, role FROM users WHERE id=?', (uid,)).fetchone()
    conn.close()
    if row is None:
        session.clear()  # account was deleted
    return dict(row) if row else None


def require(role):
    """API guard: 401 when logged out, 403 below the needed role."""
    def wrap(fn):
        @wraps(fn)
        def inner(*args, **kwargs):
            user = current_user()
            if user is None:
                return jsonify({'error': 'Please log in'}), 401
            if RANK[user['role']] < RANK[role]:
                return jsonify({'error': 'You do not have permission to do that'}), 403
            return fn(*args, **kwargs)
        return inner
    return wrap


def page_login_required(fn):
    """Page guard: sends logged-out visitors (and pending accounts) to /login."""
    @wraps(fn)
    def inner(*args, **kwargs):
        user = current_user()
        if user is None or user['role'] == 'pending':
            return redirect(url_for('auth.login_page'))
        return fn(*args, **kwargs)
    return inner


def check_csrf():
    """Every state-changing API call must come from our own page's fetch(),
    which sends this header. A form on another site can't add custom
    headers, so it can't make the browser act with this session."""
    if request.method in ('POST', 'PUT', 'DELETE') and request.path.startswith('/api/'):
        if request.headers.get('X-Requested-With') != 'fetch':
            return jsonify({'error': 'Bad request'}), 400
    return None


# Login throttling: per client address, at most 10 failures per 15 minutes.
FAIL_WINDOW = 15 * 60
FAIL_LIMIT = 10
_failures = defaultdict(deque)


def _throttled(addr):
    q = _failures[addr]
    now = time.time()
    while q and now - q[0] > FAIL_WINDOW:
        q.popleft()
    return len(q) >= FAIL_LIMIT


@bp.route('/login')
def login_page():
    user = current_user()
    if user and user['role'] != 'pending':
        return redirect('/')
    conn = database.get_connection()
    has_users = conn.execute('SELECT 1 FROM users LIMIT 1').fetchone() is not None
    conn.close()
    return render_template('login.html', user=user, first_run=not has_users)


@bp.route('/api/auth/me')
def me():
    user = current_user()
    if user is None:
        return jsonify({'error': 'Please log in'}), 401
    return jsonify(user)


@bp.route('/api/auth/login', methods=['POST'])
def login():
    addr = request.remote_addr or '?'
    if _throttled(addr):
        return jsonify({'error': 'Too many failed attempts. Try again in a few minutes.'}), 429
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    conn = database.get_connection()
    row = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    conn.close()
    if row is None or not check_password_hash(row['password_hash'], password):
        _failures[addr].append(time.time())
        return jsonify({'error': 'Wrong username or password'}), 401

    session.clear()
    session.permanent = bool(data.get('remember', True))
    session['uid'] = row['id']
    return jsonify({'role': row['role']})


@bp.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    display_name = (data.get('display_name') or '').strip() or username
    password = data.get('password') or ''

    if not (3 <= len(username) <= 32) or not all(ch.isalnum() or ch in '._-' for ch in username):
        return jsonify({'error': 'Username must be 3-32 letters, numbers, dots, dashes or underscores'}), 400
    if len(password) < MIN_PASSWORD:
        return jsonify({'error': f'Password must be at least {MIN_PASSWORD} characters'}), 400

    conn = database.get_connection()
    try:
        # Whoever registers first on a fresh install owns it. The write lock
        # stops two simultaneous first registrations both becoming admin.
        conn.execute('BEGIN IMMEDIATE')
        is_first = conn.execute('SELECT 1 FROM users LIMIT 1').fetchone() is None
        role = 'admin' if is_first else 'pending'
        cur = conn.execute(
            'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)',
            (username, display_name[:60], generate_password_hash(password), role))
        conn.commit()
    except database.sqlite3.IntegrityError:
        return jsonify({'error': 'That username is taken'}), 400
    finally:
        conn.close()

    session.clear()
    session.permanent = True
    session['uid'] = cur.lastrowid
    return jsonify({'role': role}), 201


@bp.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


@bp.route('/api/auth/password', methods=['POST'])
@require('pending')
def change_password():
    data = request.get_json(silent=True) or {}
    new = data.get('new_password') or ''
    if len(new) < MIN_PASSWORD:
        return jsonify({'error': f'Password must be at least {MIN_PASSWORD} characters'}), 400
    uid = session['uid']
    conn = database.get_connection()
    row = conn.execute('SELECT password_hash FROM users WHERE id=?', (uid,)).fetchone()
    if not check_password_hash(row['password_hash'], data.get('current_password') or ''):
        conn.close()
        return jsonify({'error': 'Current password is wrong'}), 400
    conn.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(new), uid))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ---------- admin: accounts ----------

@bp.route('/api/users')
@require('admin')
def list_users():
    conn = database.get_connection()
    rows = conn.execute('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


def _admin_count(conn):
    return conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]


@bp.route('/api/users/<int:user_id>', methods=['PUT'])
@require('admin')
def update_user(user_id):
    role = (request.get_json(silent=True) or {}).get('role')
    if role not in ROLES:
        return jsonify({'error': 'Unknown role'}), 400
    conn = database.get_connection()
    target = conn.execute('SELECT role FROM users WHERE id=?', (user_id,)).fetchone()
    if target is None:
        conn.close()
        return jsonify({'error': 'No such user'}), 404
    if target['role'] == 'admin' and role != 'admin' and _admin_count(conn) == 1:
        conn.close()
        return jsonify({'error': 'There must always be at least one admin'}), 400
    conn.execute('UPDATE users SET role=? WHERE id=?', (role, user_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@bp.route('/api/users/<int:user_id>', methods=['DELETE'])
@require('admin')
def delete_user(user_id):
    conn = database.get_connection()
    target = conn.execute('SELECT role FROM users WHERE id=?', (user_id,)).fetchone()
    if target is None:
        conn.close()
        return jsonify({'error': 'No such user'}), 404
    if target['role'] == 'admin' and _admin_count(conn) == 1:
        conn.close()
        return jsonify({'error': 'There must always be at least one admin'}), 400
    conn.execute('DELETE FROM users WHERE id=?', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})
