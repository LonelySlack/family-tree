import io
import os
import sqlite3
from datetime import date, datetime, timedelta

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
import auth
import database
import export
import importer
import photos

app = Flask(__name__)
app.secret_key = auth.secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    MAX_CONTENT_LENGTH=15 * 1024 * 1024,  # photos and spreadsheets
)
app.register_blueprint(auth.bp)
app.before_request(auth.check_csrf)

# Initialize database
database.init_db()

FIELDS = ['name', 'nickname', 'gender', 'birth_date', 'death_date', 'is_deceased',
          'birth_order', 'father_id', 'mother_id', 'notes']


def clean(data, member_id=None):
    """Normalise a submitted member; returns (values, spouse_ids, error)."""
    def text(key):
        value = (str(data.get(key) or '')).strip()
        return value or None  # store blanks as NULL, not ''

    def ref(key):
        value = data.get(key)
        if value in (None, ''):
            return None
        value = int(value)
        return None if value == member_id else value  # nobody is their own parent

    try:
        values = {
            'name': text('name'),
            'nickname': text('nickname'),
            'gender': text('gender'),
            'birth_date': text('birth_date'),
            'death_date': text('death_date'),
            'birth_order': int(data['birth_order']) if data.get('birth_order') not in (None, '') else None,
            'father_id': ref('father_id'),
            'mother_id': ref('mother_id'),
            'notes': text('notes'),
        }
        spouse_ids = sorted({int(s) for s in data.get('spouse_ids') or [] if int(s) != member_id})
    except (TypeError, ValueError):
        return None, None, 'Invalid value in the form'
    # A death date means the person has passed, whether or not the box was ticked.
    values['is_deceased'] = 1 if data.get('is_deceased') or values['death_date'] else 0

    if not values['name']:
        return None, None, 'Name is required'
    if values['birth_date'] and values['death_date'] and values['death_date'] < values['birth_date']:
        return None, None, 'Death date is before birth date'
    if values['birth_order'] is not None and values['birth_order'] < 1:
        return None, None, 'Birth order starts at 1 (the eldest)'
    return values, spouse_ids, None


def set_spouses(conn, member_id, spouse_ids):
    """Make member_id's marriages exactly spouse_ids. A marriage is one row
    shared by both people, so it is always two-way."""
    conn.execute('DELETE FROM marriages WHERE (person_a=? OR person_b=?)', (member_id, member_id))
    for s in spouse_ids:
        a, b = sorted((member_id, s))
        conn.execute('INSERT OR IGNORE INTO marriages (person_a, person_b) VALUES (?, ?)', (a, b))


def all_members(conn):
    members = [dict(m) for m in conn.execute('SELECT * FROM members')]
    spouses = {}
    for a, b in conn.execute('SELECT person_a, person_b FROM marriages'):
        spouses.setdefault(a, []).append(b)
        spouses.setdefault(b, []).append(a)
    for m in members:
        m.pop('spouse_id', None)  # replaced by the marriages table
        m['spouse_ids'] = sorted(spouses.get(m['id'], []))
        m['photo_url'] = f"/photos/{m['photo']}" if m['photo'] else None
    return members


def snapshot(conn, reason):
    """Copy of the database before a bulk change, kept in instance/snapshots
    (newest 10). Undo by stopping the app and copying one back."""
    folder = os.path.join(database.APP_DIR, 'instance', 'snapshots')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f'{datetime.now():%Y%m%d-%H%M%S}-{reason}.db')
    out = sqlite3.connect(path)
    conn.backup(out)
    out.close()
    for old in sorted(os.listdir(folder))[:-10]:
        os.remove(os.path.join(folder, old))


@app.route('/')
@auth.page_login_required
def index():
    return render_template('index.html')

@app.route('/healthz')
def healthz():
    """Unauthenticated liveness check for monitoring; reveals nothing."""
    conn = database.get_connection()
    conn.execute('SELECT 1 FROM members LIMIT 1').fetchall()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/members', methods=['GET'])
@auth.require('viewer')
def get_members():
    conn = database.get_connection()
    members = all_members(conn)
    conn.close()
    return jsonify(members)

@app.route('/api/export.xlsx')
@auth.require('viewer')
def export_xlsx():
    conn = database.get_connection()
    members = all_members(conn)
    conn.close()
    return send_file(
        export.to_xlsx(members),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'family-tree-{date.today():%Y-%m-%d}.xlsx',
    )

@app.route('/api/import/template.xlsx')
@auth.require('editor')
def import_template():
    return send_file(
        export.template_xlsx(),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name='family-tree-template.xlsx',
    )

def _import_plan(conn):
    upload = request.files.get('file')
    if upload is None:
        return None, (jsonify({'error': 'No file uploaded'}), 400)
    return importer.plan(io.BytesIO(upload.read()), conn), None

@app.route('/api/import/preview', methods=['POST'])
@auth.require('editor')
def import_preview():
    conn = database.get_connection()
    result, err = _import_plan(conn)
    conn.close()
    if err:
        return err
    return jsonify({k: v for k, v in result.items() if not k.startswith('_')})

@app.route('/api/import/apply', methods=['POST'])
@auth.require('editor')
def import_apply():
    conn = database.get_connection()
    result, err = _import_plan(conn)
    if err:
        conn.close()
        return err
    if result['errors']:
        conn.close()
        return jsonify({k: v for k, v in result.items() if not k.startswith('_')}), 400
    snapshot(conn, 'pre-import')
    try:
        added = importer.apply(result, conn)
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        conn.close()
        return jsonify({'error': 'Import failed; nothing was changed'}), 500
    conn.close()
    return jsonify({'success': True, 'added': added, 'updated': len(result['updates'])})

@app.route('/api/members', methods=['POST'])
@auth.require('editor')
def add_member():
    values, spouse_ids, error = clean(request.json or {})
    if error:
        return jsonify({'success': False, 'error': error}), 400

    conn = database.get_connection()
    try:
        c = conn.cursor()
        c.execute(f'''
            INSERT INTO members ({', '.join(FIELDS)})
            VALUES ({', '.join('?' for _ in FIELDS)})
        ''', [values[f] for f in FIELDS])
        new_id = c.lastrowid
        set_spouses(conn, new_id, spouse_ids)
        conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'A parent or spouse no longer exists; reload the page'}), 400
    finally:
        conn.close()

    return jsonify({'success': True, 'id': new_id}), 201

@app.route('/api/members/<int:member_id>', methods=['PUT'])
@auth.require('editor')
def update_member(member_id):
    values, spouse_ids, error = clean(request.json or {}, member_id)
    if error:
        return jsonify({'success': False, 'error': error}), 400

    conn = database.get_connection()
    try:
        conn.execute(f'''
            UPDATE members
            SET {', '.join(f + '=?' for f in FIELDS)}
            WHERE id=?
        ''', [values[f] for f in FIELDS] + [member_id])
        set_spouses(conn, member_id, spouse_ids)
        conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'A parent or spouse no longer exists; reload the page'}), 400
    finally:
        conn.close()

    return jsonify({'success': True})

@app.route('/api/members/<int:member_id>', methods=['DELETE'])
@auth.require('editor')
def delete_member(member_id):
    conn = database.get_connection()
    row = conn.execute('SELECT photo FROM members WHERE id=?', (member_id,)).fetchone()
    # Clear references to this person first; foreign keys are enforced.
    conn.execute('UPDATE members SET father_id=NULL WHERE father_id=?', (member_id,))
    conn.execute('UPDATE members SET mother_id=NULL WHERE mother_id=?', (member_id,))
    conn.execute('UPDATE members SET spouse_id=NULL WHERE spouse_id=?', (member_id,))
    conn.execute('DELETE FROM members WHERE id=?', (member_id,))  # marriages cascade
    conn.commit()
    conn.close()
    if row:
        photos.remove(row['photo'])

    return jsonify({'success': True})

@app.route('/api/members/<int:member_id>/photo', methods=['POST'])
@auth.require('editor')
def upload_photo(member_id):
    upload = request.files.get('photo')
    if upload is None:
        return jsonify({'error': 'No photo uploaded'}), 400
    conn = database.get_connection()
    row = conn.execute('SELECT photo FROM members WHERE id=?', (member_id,)).fetchone()
    if row is None:
        conn.close()
        return jsonify({'error': 'No such person'}), 404
    try:
        name = photos.save(upload.read(), member_id)
    except ValueError as e:
        conn.close()
        return jsonify({'error': str(e)}), 400
    conn.execute('UPDATE members SET photo=? WHERE id=?', (name, member_id))
    conn.commit()
    conn.close()
    photos.remove(row['photo'])
    return jsonify({'success': True, 'photo_url': f'/photos/{name}'})

@app.route('/api/members/<int:member_id>/photo', methods=['DELETE'])
@auth.require('editor')
def delete_photo(member_id):
    conn = database.get_connection()
    row = conn.execute('SELECT photo FROM members WHERE id=?', (member_id,)).fetchone()
    conn.execute('UPDATE members SET photo=NULL WHERE id=?', (member_id,))
    conn.commit()
    conn.close()
    if row:
        photos.remove(row['photo'])
    return jsonify({'success': True})

@app.route('/photos/<path:name>')
@auth.require('viewer')
def photo(name):
    return send_from_directory(photos.UPLOADS, name, max_age=86400)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
