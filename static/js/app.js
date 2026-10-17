let membersData = [];
let levels = {};
let network = null;
let selectedId = null;

document.addEventListener("DOMContentLoaded", () => {
    loadMembers();
});

async function loadMembers() {
    try {
        const res = await fetch('/api/members');
        membersData = await res.json();
        levels = calculateLevels(membersData);
        document.getElementById('memberCount').textContent = `· ${membersData.length} members`;
        renderMembersList();
        drawTree();
    } catch (e) {
        console.error("Failed to load members", e);
    }
}

/** Names are stored however they were typed; show them consistently
 *  ("ahmad faiz bin abu bakar" -> "Ahmad Faiz bin Abu Bakar"). */
function displayName(name) {
    const lower = new Set(['bin', 'binti', 'bt', 'bte', 'b.', 'al', 'van', 'de']);
    return (name || '').trim().split(/\s+/).map((w, i) => {
        const lw = w.toLowerCase();
        if (i > 0 && lower.has(lw)) return lw;
        return lw.charAt(0).toUpperCase() + lw.slice(1);
    }).join(' ');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function byId(id) {
    return membersData.find(m => m.id === id);
}

/** "b. 1962 · 64 yrs", "1940 – 2010 · 70 yrs", or "" when nothing is known. */
function lifeLine(m) {
    const born = m.birth_date ? m.birth_date.slice(0, 4) : null;
    const died = m.death_date ? m.death_date.slice(0, 4) : null;
    const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
    let text = '';
    if (born && died) text = `${born} – ${died}`;
    else if (born) text = `b. ${born}`;
    else if (died) text = `d. ${died}`;
    if (age !== null) text += `${text ? ' · ' : ''}${age} yrs`;
    return text;
}

/** Generation first, then oldest first, so the list reads like the tree. */
function sortedMembers() {
    return [...membersData].sort((a, b) =>
        (levels[a.id] ?? 0) - (levels[b.id] ?? 0) ||
        (a.birth_date || '9999').localeCompare(b.birth_date || '9999') ||
        displayName(a.name).localeCompare(displayName(b.name)));
}

function renderMembersList() {
    const list = document.getElementById('membersList');
    const query = document.getElementById('search').value.trim().toLowerCase();
    list.innerHTML = '';

    const shown = sortedMembers().filter(m => !query || m.name.toLowerCase().includes(query));
    if (!shown.length) {
        list.innerHTML = `<li class="list-group-item text-muted small">${membersData.length ? 'No matches' : 'No members yet — add the first one.'}</li>`;
        return;
    }

    shown.forEach(m => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        if (m.id === selectedId) li.classList.add('active-member');
        const meta = lifeLine(m);
        const deceased = m.is_deceased ? ' <span class="badge bg-secondary">Meninggal Dunia</span>' : '';
        li.innerHTML = `
            <div>
                <div>${escapeHtml(displayName(m.name))}${deceased}</div>
                ${meta ? `<div class="member-meta">${escapeHtml(meta)}</div>` : ''}
            </div>
            <button class="btn btn-sm btn-outline-primary">Edit</button>`;
        li.addEventListener('click', () => focusMember(m.id));
        li.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(m.id);
        });
        list.appendChild(li);
    });
}

/** Pan the tree to a person and highlight them in both views. */
function focusMember(id) {
    selectedId = id;
    renderMembersList();
    if (!network) return;
    network.selectNodes([id]);
    network.focus(id, { scale: 1.1, animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
}

function fitTree() {
    if (network) network.fit({ animation: { duration: 400 } });
}

/** Parent and spouse pickers: never yourself, fathers male, mothers female
 *  (people with no gender recorded stay available in both). */
function fillSelect(selId, current, selfId, filter) {
    const sel = document.getElementById(selId);
    const options = sortedMembers()
        .filter(m => m.id !== selfId && (!filter || filter(m) || m.id === current))
        .map(m => `<option value="${m.id}">${escapeHtml(displayName(m.name))}</option>`);
    sel.innerHTML = '<option value="">None</option>' + options.join('');
    sel.value = current || '';
}

function fillSelects(m) {
    const selfId = m ? m.id : null;
    fillSelect('father_id', m?.father_id, selfId, x => x.gender !== 'Female');
    fillSelect('mother_id', m?.mother_id, selfId, x => x.gender !== 'Male');
    fillSelect('spouse_id', m?.spouse_id, selfId);
}

function showModal() {
    const el = document.getElementById('memberModal');
    bootstrap.Modal.getOrCreateInstance(el).show();
}

function hideModal() {
    const el = document.getElementById('memberModal');
    bootstrap.Modal.getOrCreateInstance(el).hide();
}

function showError(message) {
    const box = document.getElementById('formError');
    box.textContent = message || '';
    box.classList.toggle('d-none', !message);
}

function openAddModal() {
    document.getElementById('memberForm').reset();
    document.getElementById('memberId').value = '';
    document.getElementById('modalTitle').innerText = 'Add Member';
    document.getElementById('deleteBtn').style.display = 'none';
    showError('');
    fillSelects(null);
    showModal();
}

function openEditModal(id) {
    const m = byId(id);
    if (!m) return;

    document.getElementById('memberId').value = m.id;
    document.getElementById('name').value = m.name || '';
    document.getElementById('gender').value = m.gender || '';
    document.getElementById('birth_date').value = m.birth_date || '';
    document.getElementById('death_date').value = m.death_date || '';
    document.getElementById('is_deceased').checked = m.is_deceased === 1;
    document.getElementById('notes').value = m.notes || '';
    fillSelects(m);

    document.getElementById('modalTitle').innerText = `Edit ${displayName(m.name)}`;
    document.getElementById('deleteBtn').style.display = 'block';
    showError('');
    showModal();
}

/** Entering a death date ticks the box; the server enforces the same rule. */
function syncDeceased() {
    if (document.getElementById('death_date').value) {
        document.getElementById('is_deceased').checked = true;
    }
}

async function saveMember() {
    const id = document.getElementById('memberId').value;
    const data = {
        name: document.getElementById('name').value.trim(),
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
        showError('Name is required.');
        return;
    }

    // One spouse each, kept two-way by the server — so marrying someone who is
    // already married unlinks their current spouse. Say so before doing it.
    const spouse = data.spouse_id && byId(Number(data.spouse_id));
    if (spouse && spouse.spouse_id && String(spouse.spouse_id) !== id) {
        const current = byId(spouse.spouse_id);
        if (current && !confirm(`${displayName(spouse.name)} is currently linked as spouse of ${displayName(current.name)}. Replace that link?`)) {
            return;
        }
    }

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/members/${id}` : '/api/members';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(body.error || `Save failed (HTTP ${res.status}).`);
            return;
        }
        hideModal();
        selectedId = id ? Number(id) : body.id;
        await loadMembers();
    } catch (e) {
        showError('Could not reach the server. Is it running?');
    }
}

async function deleteMember() {
    const id = Number(document.getElementById('memberId').value);
    const m = byId(id);
    if (!confirm(`Delete ${displayName(m?.name)}? Their links to parents, children and spouse are removed too.`)) return;
    const res = await fetch(`/api/members/${id}`, { method: 'DELETE' });
    if (res.ok) {
        hideModal();
        if (selectedId === id) selectedId = null;
        loadMembers();
    } else {
        showError(`Delete failed (HTTP ${res.status}).`);
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

const NODE_W = 190;      // every box is this wide, so positions can be computed up front
const COUPLE_GAP = 50;   // room for the spouse line between partners
const UNIT_GAP = 50;     // between neighbouring couples/singles on a row
const LEVEL_H = 170;     // between generations

/**
 * Where each person goes, as { id: {x, y} }.
 *
 * vis-network's hierarchical layout knows nothing about couples, so it put
 * each spouse's parents wherever, and the lines crossed. Instead:
 * 1. each generation is split into units — a couple, or a single person;
 * 2. rows are reordered over several passes: a unit moves under its parents
 *    (going down) and above its children (going up), so lines stop crossing;
 * 3. each row is placed as close as possible to where its units want to be
 *    (children centred under parents, parents centred over children) without
 *    overlapping or changing their order.
 */
function computeLayout(data, levelMap) {
    const people = new Map(data.map(m => [m.id, m]));
    const levelOf = id => levelMap[id] ?? 0;
    const maxLevel = Math.max(0, ...data.map(m => levelOf(m.id)));
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

    const parentIds = id => {
        const m = people.get(id);
        return [m.father_id, m.mother_id].filter(p => p && people.has(p));
    };
    const childIds = id => data.filter(c => c.father_id === id || c.mother_id === id).map(c => c.id);

    // 1. Units: a person plus everyone they're partnered with — their linked
    //    spouse, and anyone else they have children with (a first wife, say).
    //    Partners form a chain, so someone with two wives sits between them.
    const partnersOf = new Map(data.map(m => [m.id, new Set()]));
    const pair = (a, b) => {
        if (a === b || !people.has(a) || !people.has(b) || levelOf(a) !== levelOf(b)) return;
        partnersOf.get(a).add(b);
        partnersOf.get(b).add(a);
    };
    for (const m of data) {
        const s = m.spouse_id && people.get(m.spouse_id);
        if (s && s.spouse_id === m.id) pair(m.id, s.id);
        if (m.father_id && m.mother_id) pair(m.father_id, m.mother_id);
    }

    /** Lay a group of partners out as a line: walk from an end of the chain;
     *  if it isn't a chain, put the most-partnered person in the middle. */
    function chainOrder(group) {
        const ends = group.filter(id => partnersOf.get(id).size <= 1);
        const isChain = group.every(id => partnersOf.get(id).size <= 2) && ends.length === 2;
        if (isChain) {
            const order = [ends[0]];
            while (order.length < group.length) {
                const next = [...partnersOf.get(order[order.length - 1])].find(p => !order.includes(p));
                order.push(next);
            }
            // Husband on the left for a plain couple, until parents say otherwise.
            if (order.length === 2 && people.get(order[0]).gender === 'Female') order.reverse();
            return order;
        }
        const hub = [...group].sort((a, b) => partnersOf.get(b).size - partnersOf.get(a).size)[0];
        const rest = group.filter(id => id !== hub);
        const half = Math.ceil(rest.length / 2);
        return [...rest.slice(0, half), hub, ...rest.slice(half)];
    }

    const rows = Array.from({ length: maxLevel + 1 }, () => []);
    const unitOf = new Map();
    // Oldest first, so siblings start out in birth order.
    const oldestFirst = [...data].sort((a, b) =>
        (a.birth_date || '9999').localeCompare(b.birth_date || '9999') || a.id - b.id);
    for (const m of oldestFirst) {
        if (unitOf.has(m.id)) continue;
        const group = [m.id];
        for (let i = 0; i < group.length; i++) {
            for (const p of partnersOf.get(group[i])) if (!group.includes(p)) group.push(p);
        }
        const unit = { members: chainOrder(group), x: 0 };
        unit.members.forEach(id => unitOf.set(id, unit));
        rows[levelOf(m.id)].push(unit);
    }

    const width = u => u.members.length * NODE_W + (u.members.length - 1) * COUPLE_GAP;
    const xOf = new Map();
    const setMemberX = u => {
        const left = u.x - width(u) / 2 + NODE_W / 2;
        u.members.forEach((id, i) => xOf.set(id, left + i * (NODE_W + COUPLE_GAP)));
    };

    /** Put a row's units as near their desired centres as order and spacing allow.
     *  Overlapping neighbours merge into a block centred on their average wish. */
    function place(row, desired) {
        const blocks = [];
        row.forEach((u, i) => {
            blocks.push({ idx: [i], offs: [width(u) / 2], width: width(u), left: desired[i] - width(u) / 2 });
            while (blocks.length > 1) {
                const b = blocks[blocks.length - 1];
                const a = blocks[blocks.length - 2];
                if (a.left + a.width + UNIT_GAP <= b.left) break;
                const shift = a.width + UNIT_GAP;
                a.idx.push(...b.idx);
                a.offs.push(...b.offs.map(o => o + shift));
                a.width += UNIT_GAP + b.width;
                a.left = mean(a.idx.map((k, j) => desired[k] - a.offs[j]));
                blocks.pop();
            }
        });
        for (const blk of blocks) {
            blk.idx.forEach((k, j) => { row[k].x = blk.left + blk.offs[j]; });
        }
        row.forEach(setMemberX);
    }

    /** Reorder a row by where its units want to be, then place it there. */
    function arrange(row, wantOf) {
        const want = new Map(row.map(u => [u, wantOf(u) ?? u.x]));
        row.sort((a, b) => want.get(a) - want.get(b) || a.x - b.x);
        place(row, row.map(u => want.get(u)));
    }

    /** Which way round a unit sits. The ends go towards their own parents;
     *  failing that, towards their own children — so with two wives, each
     *  wife ends up on the side where her children are. */
    function orientUnits(row) {
        const towards = (id, related) => {
            const xs = related(id).filter(r => xOf.has(r)).map(r => xOf.get(r));
            return xs.length ? mean(xs) : null;
        };
        for (const u of row) {
            if (u.members.length < 2) continue;
            const first = u.members[0];
            const last = u.members[u.members.length - 1];
            let a = towards(first, parentIds);
            let b = towards(last, parentIds);
            if (a === null || b === null) {
                a = towards(first, childIds);
                b = towards(last, childIds);
            }
            if (a !== null && b !== null && a > b) u.members.reverse();
            setMemberX(u);
        }
    }

    // Initial left-to-right packing.
    for (const row of rows) {
        let x = 0;
        for (const u of row) { u.x = x + width(u) / 2; x += width(u) + UNIT_GAP; setMemberX(u); }
    }

    const underParents = u => {
        const ps = u.members.flatMap(parentIds).filter(p => xOf.has(p));
        return ps.length ? mean(ps.map(p => xOf.get(p))) : null;
    };
    const overChildren = u => {
        const cs = u.members.flatMap(childIds).filter(c => xOf.has(c));
        return cs.length ? mean(cs.map(c => xOf.get(c))) : null;
    };

    for (let pass = 0; pass < 6; pass++) {
        for (let L = 1; L <= maxLevel; L++) { orientUnits(rows[L]); arrange(rows[L], underParents); }
        for (let L = maxLevel - 1; L >= 0; L--) { orientUnits(rows[L]); arrange(rows[L], overChildren); }
    }
    for (let L = 1; L <= maxLevel; L++) { orientUnits(rows[L]); arrange(rows[L], underParents); }

    const minX = Math.min(...xOf.values());
    const pos = {};
    for (const m of data) pos[m.id] = { x: xOf.get(m.id) - minX, y: levelOf(m.id) * LEVEL_H };
    return pos;
}

/** Hover card. vis-network shows a string title as plain text, so build an element. */
function tooltipFor(m) {
    const el = document.createElement('div');
    const rows = [];
    if (m.is_deceased) rows.push('<em>Meninggal Dunia</em>');
    if (m.gender) rows.push(`Gender: ${escapeHtml(m.gender)}`);
    if (m.birth_date) rows.push(`Born: ${escapeHtml(m.birth_date)}`);
    if (m.death_date) rows.push(`Died: ${escapeHtml(m.death_date)}`);
    const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
    if (age !== null) rows.push(`Age: ${age}`);
    const spouse = m.spouse_id && byId(m.spouse_id);
    if (spouse) rows.push(`Spouse: ${escapeHtml(displayName(spouse.name))}`);
    const children = membersData.filter(c => c.father_id === m.id || c.mother_id === m.id);
    if (children.length) rows.push(`Children: ${children.length}`);
    if (m.notes) rows.push(`Notes: ${escapeHtml(m.notes)}`);
    el.innerHTML = `<strong>${escapeHtml(displayName(m.name))}</strong>` +
        (rows.length ? `<br>${rows.join('<br>')}` : '');
    return el;
}

function drawTree() {
    const container = document.getElementById('treeNetwork');
    const pos = computeLayout(membersData, levels);

    const nodes = new vis.DataSet(membersData.map(m => {
        // Short labels keep the tree readable; the rest is in the hover card.
        const meta = lifeLine(m);
        let label = `*${displayName(m.name)}*`;
        if (meta) label += `\n${meta}`;
        if (m.is_deceased) label += `\n_Meninggal Dunia_`;

        let background = '#E8EEF5';
        let border = '#8A9BB0';
        if (m.gender === 'Female') { background = '#FFE1E6'; border = '#E58A9B'; }
        if (m.gender === 'Male') { background = '#DCEBFF'; border = '#6FA3E0'; }
        if (m.is_deceased) { background = '#ECECEC'; border = '#9E9E9E'; }

        return {
            id: m.id,
            label: label,
            title: tooltipFor(m),
            x: pos[m.id].x,
            y: pos[m.id].y,
            shape: 'box',
            margin: { top: 10, bottom: 10, left: 14, right: 14 },
            // vis adds the margins outside the constraint; the layout spaces whole boxes.
            widthConstraint: { minimum: NODE_W - 28, maximum: NODE_W - 28 },
            shapeProperties: { borderRadius: 8, borderDashes: m.is_deceased ? [5, 4] : false },
            color: {
                background, border,
                highlight: { background, border: '#0d6efd' },
                hover: { background, border: '#0d6efd' }
            },
            borderWidth: 1.5,
            borderWidthSelected: 3,
            font: { size: 15, multi: 'md', color: '#212529', bold: { size: 16 }, ital: { size: 12, color: '#616161' } }
        };
    }));

    const edges = new vis.DataSet();
    const childLine = { color: { color: '#78909C' }, width: 2, arrows: { to: { enabled: true, scaleFactor: 0.5 } } };

    // Each couple gets a small dot midway along a dashed partner line, and
    // their children hang from that dot — one line per child instead of two
    // crossing ones. A couple is a linked spouse, or two people who share
    // children (a first wife) and sit side by side in the layout.
    const coupleKey = (a, b) => `couple-${Math.min(a, b)}-${Math.max(a, b)}`;
    const isSpouse = (a, b) => byId(a)?.spouse_id === b && byId(b)?.spouse_id === a;
    const adjacent = (a, b) => pos[a].y === pos[b].y &&
        Math.abs(Math.abs(pos[a].x - pos[b].x) - (NODE_W + COUPLE_GAP)) < 1;
    const partnerLine = { color: { color: '#9C27B0' }, dashes: true, width: 3, smooth: false };

    const couples = new Set();
    function addCouple(a, b) {
        const key = coupleKey(a, b);
        if (couples.has(key)) return key;
        couples.add(key);
        nodes.add({
            id: key, shape: 'dot', size: 5, chosen: false,
            color: { background: '#9C27B0', border: '#9C27B0' },
            x: (pos[a].x + pos[b].x) / 2, y: pos[a].y
        });
        edges.add({ from: a, to: key, ...partnerLine });
        edges.add({ from: key, to: b, ...partnerLine });
        return key;
    }

    membersData.forEach(m => {
        const s = m.spouse_id && byId(m.spouse_id);
        if (s && m.id < s.id) {
            if (isSpouse(m.id, s.id) && adjacent(m.id, s.id)) addCouple(m.id, s.id);
            else edges.add({ from: m.id, to: s.id, ...partnerLine }); // one-sided or far apart
        }
    });

    membersData.forEach(m => {
        const father = m.father_id && byId(m.father_id);
        const mother = m.mother_id && byId(m.mother_id);
        if (father && mother && adjacent(father.id, mother.id)) {
            edges.add({ from: addCouple(father.id, mother.id), to: m.id, ...childLine });
        } else {
            if (father) edges.add({ from: father.id, to: m.id, ...childLine });
            if (mother) edges.add({ from: mother.id, to: m.id, ...childLine });
        }
    });

    const data = { nodes: nodes, edges: edges };
    const options = {
        // Positions come from computeLayout, not vis-network's own layout.
        physics: false,
        interaction: { hover: true, tooltipDelay: 150 },
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

    // Couple dots have string ids; only people are selectable.
    const personAt = params => params.nodes.find(id => typeof id === 'number') ?? null;

    network.on("click", function (params) {
        selectedId = personAt(params);
        renderMembersList();
    });

    network.on("doubleClick", function (params) {
        const id = personAt(params);
        if (id !== null) openEditModal(id);
    });

    if (selectedId && byId(selectedId)) {
        network.selectNodes([selectedId]);
    }
}
