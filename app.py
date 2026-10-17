from datetime import date

from flask import Flask, render_template, request, jsonify, send_file
import database
import export

app = Flask(__name__)

# Initialize database
database.init_db()

FIELDS = ['name', 'nickname', 'gender', 'birth_date', 'death_date', 'is_deceased',
          'father_id', 'mother_id', 'spouse_id', 'notes']


def clean(data, member_id=None):
    """Normalise a submitted member; returns (values, error)."""
    def text(key):
        value = (data.get(key) or '').strip()
        return value or None  # store blanks as NULL, not ''

    def ref(key):
        value = data.get(key)
        if value in (None, ''):
            return None
        value = int(value)
        return None if value == member_id else value  # nobody is their own parent

    values = {
        'name': text('name'),
        'nickname': text('nickname'),
        'gender': text('gender'),
        'birth_date': text('birth_date'),
        'death_date': text('death_date'),
        'father_id': ref('father_id'),
        'mother_id': ref('mother_id'),
        'spouse_id': ref('spouse_id'),
        'notes': text('notes'),
    }
    # A death date means the person has passed, whether or not the box was ticked.
    values['is_deceased'] = 1 if data.get('is_deceased') or values['death_date'] else 0

    if not values['name']:
        return None, 'Name is required'
    if values['birth_date'] and values['death_date'] and values['death_date'] < values['birth_date']:
        return None, 'Death date is before birth date'
    return values, None


def link_spouse(conn, member_id, spouse_id):
    """Keep spouse links two-way: setting A's spouse to B also sets B's to A,
    and whoever either of them was previously married to is unlinked."""
    conn.execute('UPDATE members SET spouse_id=NULL WHERE spouse_id=? AND id!=?',
                 (member_id, spouse_id or -1))
    if spouse_id:
        conn.execute('UPDATE members SET spouse_id=NULL WHERE spouse_id=? AND id!=?',
                     (spouse_id, member_id))
        conn.execute('UPDATE members SET spouse_id=? WHERE id=?', (member_id, spouse_id))


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/members', methods=['GET'])
def get_members():
    conn = database.get_connection()
    members = conn.execute('SELECT * FROM members').fetchall()
    conn.close()
    return jsonify([dict(m) for m in members])

@app.route('/api/export.xlsx')
def export_xlsx():
    conn = database.get_connection()
    members = [dict(m) for m in conn.execute('SELECT * FROM members')]
    conn.close()
    return send_file(
        export.to_xlsx(members),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'family-tree-{date.today():%Y-%m-%d}.xlsx',
    )

@app.route('/api/members', methods=['POST'])
def add_member():
    values, error = clean(request.json or {})
    if error:
        return jsonify({'success': False, 'error': error}), 400

    conn = database.get_connection()
    c = conn.cursor()
    c.execute(f'''
        INSERT INTO members ({', '.join(FIELDS)})
        VALUES ({', '.join('?' for _ in FIELDS)})
    ''', [values[f] for f in FIELDS])
    new_id = c.lastrowid
    link_spouse(conn, new_id, values['spouse_id'])
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id': new_id}), 201

@app.route('/api/members/<int:member_id>', methods=['PUT'])
def update_member(member_id):
    values, error = clean(request.json or {}, member_id)
    if error:
        return jsonify({'success': False, 'error': error}), 400

    conn = database.get_connection()
    conn.execute(f'''
        UPDATE members
        SET {', '.join(f + '=?' for f in FIELDS)}
        WHERE id=?
    ''', [values[f] for f in FIELDS] + [member_id])
    link_spouse(conn, member_id, values['spouse_id'])
    conn.commit()
    conn.close()

    return jsonify({'success': True})

@app.route('/api/members/<int:member_id>', methods=['DELETE'])
def delete_member(member_id):
    conn = database.get_connection()
    conn.execute('DELETE FROM members WHERE id=?', (member_id,))
    # Clear references to this person
    conn.execute('UPDATE members SET father_id=NULL WHERE father_id=?', (member_id,))
    conn.execute('UPDATE members SET mother_id=NULL WHERE mother_id=?', (member_id,))
    conn.execute('UPDATE members SET spouse_id=NULL WHERE spouse_id=?', (member_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
