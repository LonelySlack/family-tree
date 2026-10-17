let membersData = [];
let network = null;

document.addEventListener("DOMContentLoaded", () => {
    loadMembers();
});

async function loadMembers() {
    try {
        const res = await fetch('/api/members');
        membersData = await res.json();
        renderMembersList();
        updateSelectOptions();
        drawTree();
    } catch (e) {
        console.error("Failed to load members", e);
    }
}

function renderMembersList() {
    const list = document.getElementById('membersList');
    list.innerHTML = '';
    membersData.forEach(m => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
        const ageText = age !== null ? ` <small class="text-muted">(Age: ${age})</small>` : '';
        const deceasedText = m.is_deceased ? ' <span class="badge bg-secondary">Meninggal Dunia</span>' : '';
        li.innerHTML = `<span>${m.name}${ageText}${deceasedText}</span> <button class="btn btn-sm btn-outline-primary" onclick="openEditModal(${m.id})">Edit</button>`;
        list.appendChild(li);
    });
}

function updateSelectOptions() {
    const selects = ['father_id', 'mother_id', 'spouse_id'];
    selects.forEach(selId => {
        const sel = document.getElementById(selId);
        sel.innerHTML = '<option value="">None</option>';
        membersData.forEach(m => {
            sel.innerHTML += `<option value="${m.id}">${m.name}</option>`;
        });
    });
}

function openAddModal() {
    document.getElementById('memberForm').reset();
    document.getElementById('memberId').value = '';
    document.getElementById('modalTitle').innerText = 'Add Member';
    document.getElementById('deleteBtn').style.display = 'none';
}

function openEditModal(id) {
    const m = membersData.find(x => x.id === id);
    if (!m) return;
    
    document.getElementById('memberId').value = m.id;
    document.getElementById('name').value = m.name || '';
    document.getElementById('gender').value = m.gender || '';
    document.getElementById('birth_date').value = m.birth_date || '';
    document.getElementById('death_date').value = m.death_date || '';
    document.getElementById('is_deceased').checked = m.is_deceased === 1;
    document.getElementById('father_id').value = m.father_id || '';
    document.getElementById('mother_id').value = m.mother_id || '';
    document.getElementById('spouse_id').value = m.spouse_id || '';
    document.getElementById('notes').value = m.notes || '';
    
    document.getElementById('modalTitle').innerText = 'Edit Member';
    document.getElementById('deleteBtn').style.display = 'block';
    
    const modalElement = document.getElementById('memberModal');
    let modal = bootstrap.Modal.getInstance(modalElement);
    if (!modal) {
        modal = new bootstrap.Modal(modalElement);
    }
    modal.show();
}

async function saveMember() {
    const id = document.getElementById('memberId').value;
    const data = {
        name: document.getElementById('name').value,
        gender: document.getElementById('gender').value,
        birth_date: document.getElementById('birth_date').value,
        death_date: document.getElementById('death_date').value,
        is_deceased: document.getElementById('is_deceased').checked ? 1 : 0,
        father_id: document.getElementById('father_id').value || null,
        mother_id: document.getElementById('mother_id').value || null,
        spouse_id: document.getElementById('spouse_id').value || null,
        notes: document.getElementById('notes').value
    };

    if (!data.name) {
        alert("Name is required!");
        return;
    }

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/members/${id}` : '/api/members';

    const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (res.ok) {
        const modalElement = document.getElementById('memberModal');
        const modal = bootstrap.Modal.getInstance(modalElement);
        modal.hide();
        loadMembers();
    }
}

async function deleteMember() {
    if(!confirm("Are you sure you want to delete this member?")) return;
    const id = document.getElementById('memberId').value;
    const res = await fetch(`/api/members/${id}`, { method: 'DELETE' });
    if (res.ok) {
        const modalElement = document.getElementById('memberModal');
        const modal = bootstrap.Modal.getInstance(modalElement);
        modal.hide();
        loadMembers();
    }
}

function calculateAge(birthDateString, deathDateString, isDeceased) {
    if (!birthDateString) return null;
    if (isDeceased && !deathDateString) return null;
    const birthDate = new Date(birthDateString);
    const end = deathDateString ? new Date(deathDateString) : new Date();
    let age = end.getFullYear() - birthDate.getFullYear();
    const m = end.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && end.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

function calculateLevels(data) {
    let levelMap = {};
    data.forEach(m => levelMap[m.id] = 0);
    
    let changed = true;
    let iterations = 0;
    while(changed && iterations < 100) {
        changed = false;
        iterations++;
        data.forEach(m => {
            let currentLevel = levelMap[m.id];
            let newLevel = currentLevel;
            
            if (m.father_id && levelMap[m.father_id] !== undefined) {
                newLevel = Math.max(newLevel, levelMap[m.father_id] + 1);
            }
            if (m.mother_id && levelMap[m.mother_id] !== undefined) {
                newLevel = Math.max(newLevel, levelMap[m.mother_id] + 1);
            }
            if (m.spouse_id && levelMap[m.spouse_id] !== undefined) {
                let spouseLevel = levelMap[m.spouse_id];
                if (spouseLevel > newLevel) newLevel = spouseLevel;
            }

            if (newLevel !== currentLevel) {
                levelMap[m.id] = newLevel;
                changed = true;
            }
        });
    }
    
    data.forEach(m => {
        if (m.spouse_id && levelMap[m.spouse_id] !== undefined) {
            levelMap[m.id] = Math.max(levelMap[m.id], levelMap[m.spouse_id]);
            levelMap[m.spouse_id] = levelMap[m.id];
        }
    });
    
    return levelMap;
}

function drawTree() {
    const container = document.getElementById('treeNetwork');
    
    const levels = calculateLevels(membersData);
    
    const nodes = new vis.DataSet(membersData.map(m => {
        let label = m.name;
        if (m.is_deceased) {
            label += `\n(Meninggal Dunia)`;
        }
        if (m.gender) {
            label += `\nGender: ${m.gender}`;
        }
        if (m.birth_date) {
            label += `\nBorn: ${m.birth_date}`;
        }
        if (m.death_date) {
            label += `\nDied: ${m.death_date}`;
        }
        if (m.birth_date) {
            const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
            if (age !== null) {
                label += `\nAge: ${age}`;
            }
        }
        if (m.notes) {
            let notesText = m.notes.length > 40 ? m.notes.substring(0, 37) + "..." : m.notes;
            label += `\nNotes: ${notesText}`;
        }
        
        // HTML title for tooltip on hover
        let titleHtml = `<strong>${m.name}</strong><br>`;
        if (m.is_deceased) titleHtml += `<em>(Meninggal Dunia)</em><br>`;
        titleHtml += m.gender ? `Gender: ${m.gender}<br>` : '';
        titleHtml += m.birth_date ? `Born: ${m.birth_date}<br>` : '';
        titleHtml += m.death_date ? `Died: ${m.death_date}<br>` : '';
        if (m.birth_date) {
            const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
            if (age !== null) titleHtml += `Age: ${age}<br>`;
        }
        titleHtml += m.notes ? `Notes: ${m.notes}<br>` : '';
        let color = '#97C2FC'; // Default blue
        if (m.gender === 'Female') color = '#FFB3B3'; // Pink for female
        if (m.gender === 'Male') color = '#B3D9FF'; // Light blue for male

        return {
            id: m.id,
            label: label,
            title: titleHtml,
            level: levels[m.id],
            shape: 'box',
            color: {
                background: color,
                border: '#2B7CE9'
            },
            font: { size: 16 }
        };
    }));

    const edges = new vis.DataSet();

    membersData.forEach(m => {
        if (m.father_id) {
            edges.add({ from: m.father_id, to: m.id, color: { color: '#4285F4' }, width: 2 }); // Blue for Father
        }
        if (m.mother_id) {
            edges.add({ from: m.mother_id, to: m.id, color: { color: '#EA4335' }, width: 2 }); // Red for Mother
        }
        if (m.spouse_id) {
            // Prevent duplicate inverse edges
            const existingEdge = edges.get({
                filter: function (item) {
                    return (item.from == m.spouse_id && item.to == m.id) || (item.from == m.id && item.to == m.spouse_id);
                }
            });
            if (existingEdge.length === 0) {
                edges.add({ from: m.id, to: m.spouse_id, color: { color: '#9C27B0' }, dashes: true, width: 3 }); // Purple for Spouse
            }
        }
    });

    const data = { nodes: nodes, edges: edges };
    const options = {
        layout: {
            hierarchical: {
                direction: 'UD',
                nodeSpacing: 300,
                levelSeparation: 250,
                shakeTowards: 'roots'
            }
        },
        physics: false,
        edges: {
            smooth: {
                type: 'cubicBezier',
                forceDirection: 'vertical',
                roundness: 0.4
            }
        }
    };

    if (network) {
        network.destroy();
    }
    network = new vis.Network(container, data, options);
    
    // Add double click to edit
    network.on("doubleClick", function (params) {
        if (params.nodes.length > 0) {
            openEditModal(params.nodes[0]);
        }
    });

}
