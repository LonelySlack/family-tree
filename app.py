from flask import Flask, render_template, request, jsonify
import database

app = Flask(__name__)

# Initialize database
database.init_db()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/members', methods=['GET'])
def get_members():
    conn = database.get_connection()
    members = conn.execute('SELECT * FROM members').fetchall()
    conn.close()
    return jsonify([dict(m) for m in members])

@app.route('/api/members', methods=['POST'])
def add_member():
    data = request.json
    name = data.get('name')
    gender = data.get('gender')
    birth_date = data.get('birth_date')
    death_date = data.get('death_date')
    is_deceased = 1 if data.get('is_deceased') else 0
    father_id = data.get('father_id')
    mother_id = data.get('mother_id')
    spouse_id = data.get('spouse_id')
    notes = data.get('notes')
    
    conn = database.get_connection()
    c = conn.cursor()
    c.execute('''
        INSERT INTO members (name, gender, birth_date, death_date, is_deceased, father_id, mother_id, spouse_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (name, gender, birth_date, death_date, is_deceased, father_id, mother_id, spouse_id, notes))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    
    return jsonify({'success': True, 'id': new_id}), 201

@app.route('/api/members/<int:member_id>', methods=['PUT'])
def update_member(member_id):
    data = request.json
    name = data.get('name')
    gender = data.get('gender')
    birth_date = data.get('birth_date')
    death_date = data.get('death_date')
    is_deceased = 1 if data.get('is_deceased') else 0
    father_id = data.get('father_id')
    mother_id = data.get('mother_id')
    spouse_id = data.get('spouse_id')
    notes = data.get('notes')

    conn = database.get_connection()
    conn.execute('''
        UPDATE members 
        SET name=?, gender=?, birth_date=?, death_date=?, is_deceased=?, father_id=?, mother_id=?, spouse_id=?, notes=?
        WHERE id=?
    ''', (name, gender, birth_date, death_date, is_deceased, father_id, mother_id, spouse_id, notes, member_id))
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
