let membersData = [];
let levels = {};
let network = null;
let selectedId = null;
let lastDrawing = null; // what drawTree last rendered, reused by the PNG export
let initialViewDone = false;

/* ---------- settings (remembered per browser) ---------- */

// homeId: "This is me" — the tree opens zoomed in on that person.
const DEFAULT_SETTINGS = { direction: 'down', compact: false, nicknames: true, colourByGender: true, homeId: null };
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
    try {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('ft-settings') || '{}') };
    } catch (e) {
        settings = { ...DEFAULT_SETTINGS };
    }
    document.getElementById(settings.direction === 'right' ? 'dirRight' : 'dirDown').checked = true;
    document.getElementById('optCompact').checked = settings.compact;
    document.getElementById('optNicknames').checked = settings.nicknames;
    document.getElementById('optColour').checked = settings.colourByGender;
    document.querySelectorAll('.gender-key').forEach(el => el.classList.toggle('d-none', !settings.colourByGender));
}

function setSetting(key, value) {
    settings[key] = value;
    try { localStorage.setItem('ft-settings', JSON.stringify(settings)); } catch (e) {}
    document.querySelectorAll('.gender-key').forEach(el => el.classList.toggle('d-none', !settings.colourByGender));
    drawTree();
    if (key === 'direction') fitTree();
}

/* ---------- theme ---------- */

function currentTheme() {
    return document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme, remember) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    if (remember) {
        try { localStorage.setItem('ft-theme', theme); } catch (e) {}
    }
    document.getElementById('themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
    if (membersData.length) drawTree();
}

function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
}

/** Tree colours come from the CSS variables, so the page and canvas match. */
function palette() {
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    return {
        male: { background: v('--ft-male-bg'), border: v('--ft-male-border') },
        female: { background: v('--ft-female-bg'), border: v('--ft-female-border') },
        other: { background: v('--bs-secondary-bg'), border: v('--bs-border-color') },
        deceased: { background: v('--ft-dead-bg'), border: v('--ft-dead-border') },
        text: v('--bs-body-color'),
        muted: v('--bs-secondary-color'),
        child: v('--ft-child'),
        spouse: v('--ft-spouse'),
        highlight: v('--bs-primary'),
        treeBg: v('--ft-tree-bg'),
    };
}

/* ---------- start-up ---------- */

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    applyTheme(currentTheme(), false);
    // Follow the device's light/dark setting unless the user picked one here.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        let saved = null;
        try { saved = localStorage.getItem('ft-theme'); } catch (err) {}
        if (!saved) applyTheme(e.matches ? 'dark' : 'light', false);
    });
    loadMembers();
});

async function loadMembers() {
    try {
        const res = await fetch('/api/members');
        membersData = await res.json();
        levels = calculateLevels(membersData);
        renderStats();
        renderMembersList();
        drawTree();
        if (!initialViewDone) {
            initialView();
            initialViewDone = true;
        }
        if (selectedId && byId(selectedId) && isDetailsOpen()) showDetails(selectedId);
    } catch (e) {
        console.error("Failed to load members", e);
        showToast('Could not load the family tree. Is the server running?', true);
    }
}

/* ---------- helpers ---------- */

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

function formatDate(ymd) {
    if (!ymd) return null;
    const d = new Date(ymd + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Generation first, then oldest first, so the list reads like the tree. */
function sortedMembers() {
    return [...membersData].sort((a, b) =>
        (levels[a.id] ?? 0) - (levels[b.id] ?? 0) ||
        (a.birth_date || '9999').localeCompare(b.birth_date || '9999') ||
        a.id - b.id);
}

const byBirth = (a, b) => (a.birth_date || '9999').localeCompare(b.birth_date || '9999') || a.id - b.id;

function relations(m) {
    const parents = [byId(m.father_id), byId(m.mother_id)].filter(Boolean);
    const children = membersData.filter(c => c.father_id === m.id || c.mother_id === m.id).sort(byBirth);
    const partners = new Map();
    const spouse = byId(m.spouse_id);
    if (spouse) partners.set(spouse.id, spouse);
    for (const c of children) {
        const other = byId(c.father_id === m.id ? c.mother_id : c.father_id);
        if (other) partners.set(other.id, other);
    }
    const siblings = membersData.filter(s => s.id !== m.id && (
        (m.father_id && s.father_id === m.father_id) || (m.mother_id && s.mother_id === m.mother_id)
    )).sort(byBirth).map(s => ({
        person: s,
        half: !(s.father_id === m.father_id && s.mother_id === m.mother_id),
    }));
    return { parents, partners: [...partners.values()], siblings, children };
}

function showToast(message, isError) {
    const el = document.getElementById('toast');
    el.classList.toggle('text-bg-danger', Boolean(isError));
    el.classList.toggle('text-bg-dark', !isError);
    document.getElementById('toastBody').textContent = message;
    bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show();
}

/* ---------- stats and list ---------- */

function renderStats() {
    const gens = membersData.length ? Math.max(...Object.values(levels)) + 1 : 0;
    const deceased = membersData.filter(m => m.is_deceased).length;
    const chips = [
        [membersData.length, 'members'],
        [gens, gens === 1 ? 'generation' : 'generations'],
        [deceased, 'meninggal dunia'],
    ];
    document.getElementById('stats').innerHTML = chips
        .map(([n, label]) => `<span class="chip"><b>${n}</b> ${label}</span>`).join('');
}

function renderMembersList() {
    const list = document.getElementById('membersList');
    const query = document.getElementById('search').value.trim().toLowerCase();
    list.innerHTML = '';

    const shown = sortedMembers().filter(m => !query ||
        m.name.toLowerCase().includes(query) || (m.nickname || '').toLowerCase().includes(query));
    if (!shown.length) {
        list.innerHTML = `<li class="list-group-item text-body-secondary small">${membersData.length ? 'No matches' : 'No members yet — add the first one.'}</li>`;
        return;
    }

    shown.forEach(m => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';
        if (m.id === selectedId) li.classList.add('active-member');
        const meta = lifeLine(m);
        const deceased = m.is_deceased ? ' <span class="badge text-bg-secondary">Meninggal Dunia</span>' : '';
        li.innerHTML = `
            <div class="min-w-0">
                <div>${escapeHtml(displayName(m.name))}${deceased}</div>
                ${m.nickname ? `<div class="nick">${escapeHtml(m.nickname)}</div>` : ''}
                ${meta ? `<div class="member-meta">${escapeHtml(meta)}</div>` : ''}
            </div>
            <button class="btn btn-sm btn-outline-primary">Edit</button>`;
        li.addEventListener('click', () => { focusMember(m.id); showDetails(m.id); });
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

/** Opening view: zoomed in on "me" if set. Otherwise the whole tree, unless
 *  that makes the boxes too small to read, in which case its centre at a
 *  readable size. */
const MIN_OPEN_SCALE = 0.45;
function initialView() {
    if (!network) return;
    const home = settings.homeId && byId(settings.homeId);
    if (home) {
        const p = network.getPositions([home.id])[home.id];
        network.moveTo({ position: p, scale: 0.9, animation: false });
        return;
    }
    network.fit({ animation: false });
    if (network.getScale() < MIN_OPEN_SCALE) {
        network.moveTo({ scale: MIN_OPEN_SCALE, animation: false });
    }
}

function toggleHome(id) {
    setSetting('homeId', settings.homeId === id ? null : id);
    showDetails(id);
}

/* ---------- details panel ---------- */

function isDetailsOpen() {
    return document.getElementById('detailsPanel').classList.contains('show');
}

function showDetails(id) {
    const m = byId(id);
    if (!m) return;
    const { parents, partners, siblings, children } = relations(m);

    document.getElementById('detailsName').textContent = displayName(m.name);
    document.getElementById('detailsNickname').textContent = m.nickname || '';

    const facts = [];
    if (m.gender) facts.push(['Gender', m.gender]);
    if (m.birth_date) facts.push(['Born', formatDate(m.birth_date)]);
    if (m.death_date) facts.push(['Died', formatDate(m.death_date)]);
    else if (m.is_deceased) facts.push(['Status', 'Meninggal Dunia']);
    const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
    if (age !== null) facts.push([m.is_deceased ? 'Age at death' : 'Age', `${age}`]);
    facts.push(['Generation', `${(levels[m.id] ?? 0) + 1}`]);

    const chip = (p, extra = '') => `<button class="btn btn-outline-secondary" data-person="${p.id}">${escapeHtml(displayName(p.name))}${extra}</button>`;
    const group = (title, items) => items.length ? `
        <div class="relation-group">
            <h6>${title}</h6>
            <div class="relation-chips">${items.join('')}</div>
        </div>` : '';

    const body = document.getElementById('detailsBody');
    body.innerHTML = `
        <dl class="detail-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
        ${group('Parents', parents.map(p => chip(p)))}
        ${group(partners.length > 1 ? 'Spouses' : 'Spouse', partners.map(p => chip(p)))}
        ${group('Siblings', siblings.map(s => chip(s.person, s.half ? ' <small class="text-body-secondary">(half)</small>' : '')))}
        ${group('Children', children.map(c => chip(c)))}
        ${m.notes ? `<div class="relation-group"><h6>Notes</h6><div class="detail-notes">${escapeHtml(m.notes)}</div></div>` : ''}
        <div class="d-flex flex-wrap gap-2 mt-3">
            <button class="btn btn-primary btn-sm" onclick="openEditModal(${m.id})">Edit</button>
            <button class="btn btn-outline-primary btn-sm" onclick="openAddModal({ relativeOf: ${m.id}, as: 'child' })">+ Add child</button>
            <button class="btn btn-outline-primary btn-sm" onclick="openAddModal({ relativeOf: ${m.id}, as: 'spouse' })">+ Add spouse</button>
            <button class="btn btn-outline-secondary btn-sm" onclick="toggleHome(${m.id})"
                    title="The tree opens zoomed in on this person">${settings.homeId === m.id ? '★ This is me' : '☆ Set as me'}</button>
        </div>`;
    body.querySelectorAll('[data-person]').forEach(btn => btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.person);
        focusMember(pid);
        showDetails(pid);
    }));

    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('detailsPanel')).show();
}

/* ---------- add / edit ---------- */

/** Parent and spouse pickers: never yourself, fathers male, mothers female
 *  (people with no gender recorded stay available in both). */
function fillSelect(selId, current, selfId, filter) {
    const sel = document.getElementById(selId);
    const options = sortedMembers()
        .filter(m => m.id !== selfId && (!filter || filter(m) || m.id === current))
        .map(m => `<option value="${m.id}">${escapeHtml(displayName(m.name))}${m.nickname ? ` (${escapeHtml(m.nickname)})` : ''}</option>`);
    sel.innerHTML = '<option value="">None</option>' + options.join('');
    sel.value = current || '';
}

function fillSelects(m) {
    const selfId = m?.id ?? null;
    fillSelect('father_id', m?.father_id, selfId, x => x.gender !== 'Female');
    fillSelect('mother_id', m?.mother_id, selfId, x => x.gender !== 'Male');
    fillSelect('spouse_id', m?.spouse_id, selfId);
}

function showModal() {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('memberModal')).show();
}

function hideModal() {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('memberModal')).hide();
}

function showError(message) {
    const box = document.getElementById('formError');
    box.textContent = message || '';
    box.classList.toggle('d-none', !message);
}

/**
 * Blank form. With { relativeOf, as: 'child' | 'spouse' } it starts filled in:
 * a child gets this person and their spouse as parents, a spouse gets linked
 * to this person.
 */
function openAddModal(prefill) {
    document.getElementById('memberForm').reset();
    document.getElementById('memberId').value = '';
    document.getElementById('deleteBtn').style.display = 'none';
    showError('');

    const draft = {};
    let title = 'Add member';
    const rel = prefill && byId(prefill.relativeOf);
    if (rel && prefill.as === 'child') {
        const partner = byId(rel.spouse_id);
        const pair = [rel, partner].filter(Boolean);
        draft.father_id = pair.find(p => p.gender === 'Male')?.id;
        draft.mother_id = pair.find(p => p.gender === 'Female')?.id;
        if (!draft.father_id && !draft.mother_id) draft.father_id = rel.id;
        title = `Add child of ${displayName(rel.name)}`;
    } else if (rel && prefill.as === 'spouse') {
        draft.spouse_id = rel.id;
        if (rel.gender === 'Male') document.getElementById('gender').value = 'Female';
        if (rel.gender === 'Female') document.getElementById('gender').value = 'Male';
        title = `Add spouse of ${displayName(rel.name)}`;
    }
    document.getElementById('modalTitle').innerText = title;
    fillSelects(draft);
    showModal();
}

function openEditModal(id) {
    const m = byId(id);
    if (!m) return;

    document.getElementById('memberId').value = m.id;
    document.getElementById('name').value = m.name || '';
    document.getElementById('nickname').value = m.nickname || '';
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
        nickname: document.getElementById('nickname').value.trim(),
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
        showToast(`Saved ${displayName(data.name)}`);
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
        if (selectedId === id) {
            selectedId = null;
            bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('detailsPanel')).hide();
        }
        await loadMembers();
        showToast(`Deleted ${displayName(m?.name)}`);
    } else {
        showError(`Delete failed (HTTP ${res.status}).`);
    }
}

/* ---------- tree ---------- */

/** Hover card. vis-network shows a string title as plain text, so build an element. */
function tooltipFor(m) {
    const el = document.createElement('div');
    const rows = [];
    if (m.nickname) rows.push(`<em>${escapeHtml(m.nickname)}</em>`);
    if (m.is_deceased) rows.push('Meninggal Dunia');
    const meta = lifeLine(m);
    if (meta) rows.push(escapeHtml(meta));
    rows.push('<span style="opacity:.7">Click for details</span>');
    el.innerHTML = `<strong>${escapeHtml(displayName(m.name))}</strong><br>${rows.join('<br>')}`;
    return el;
}

// Left-to-right view: generations become columns, and the row positions are
// squeezed, because boxes are much shorter than they are wide.
const H_LEVEL = NODE_W + 110;
const H_SCALE = 0.5;

function drawTree() {
    const container = document.getElementById('treeNetwork');
    const colours = palette();
    const horizontal = settings.direction === 'right';
    const pos = computeLayout(membersData, levels);
    const screen = id => horizontal
        ? { x: (pos[id].y / LEVEL_H) * H_LEVEL, y: pos[id].x * H_SCALE }
        : { x: pos[id].x, y: pos[id].y };

    const nodes = new vis.DataSet(membersData.map(m => {
        // Short labels keep the tree readable; the rest is in the details panel.
        let label = `*${m.id === settings.homeId ? '★ ' : ''}${displayName(m.name)}*`;
        if (settings.nicknames && m.nickname) label += `\n_${m.nickname}_`;
        if (!settings.compact) {
            const meta = lifeLine(m);
            if (meta) label += `\n${meta}`;
            if (m.is_deceased) label += `\n_Meninggal Dunia_`;
        }

        let c = colours.other;
        if (settings.colourByGender && m.gender === 'Female') c = colours.female;
        if (settings.colourByGender && m.gender === 'Male') c = colours.male;
        if (m.is_deceased) c = colours.deceased;

        return {
            id: m.id,
            label: label,
            title: tooltipFor(m),
            ...screen(m.id),
            shape: 'box',
            margin: { top: 10, bottom: 10, left: 14, right: 14 },
            // vis adds the margins outside the constraint; the layout spaces whole boxes.
            widthConstraint: { minimum: NODE_W - 28, maximum: NODE_W - 28 },
            shapeProperties: { borderRadius: 8, borderDashes: m.is_deceased ? [5, 4] : false },
            color: {
                background: c.background, border: c.border,
                highlight: { background: c.background, border: colours.highlight },
                hover: { background: c.background, border: colours.highlight }
            },
            borderWidth: 1.5,
            borderWidthSelected: 3,
            font: {
                size: 15, multi: 'md', color: colours.text,
                bold: { size: 16, color: colours.text },
                ital: { size: 12, color: colours.muted }
            }
        };
    }));

    const edges = new vis.DataSet();
    const childLine = { color: { color: colours.child }, width: 2, arrows: { to: { enabled: true, scaleFactor: 0.5 } } };

    // Each couple gets a small dot midway along a dashed partner line, and
    // their children hang from that dot — one line per child instead of two
    // crossing ones. A couple is a linked spouse, or two people who share
    // children (a first wife) and sit side by side in the layout.
    const coupleKey = (a, b) => `couple-${Math.min(a, b)}-${Math.max(a, b)}`;
    const isSpouse = (a, b) => byId(a)?.spouse_id === b && byId(b)?.spouse_id === a;
    const adjacent = (a, b) => pos[a].y === pos[b].y &&
        Math.abs(Math.abs(pos[a].x - pos[b].x) - (NODE_W + COUPLE_GAP)) < 1;
    const partnerLine = { color: { color: colours.spouse }, dashes: true, width: 3, smooth: false };

    const couples = new Set();
    function addCouple(a, b) {
        const key = coupleKey(a, b);
        if (couples.has(key)) return key;
        couples.add(key);
        const sa = screen(a), sb = screen(b);
        nodes.add({
            id: key, shape: 'dot', size: 5, chosen: false,
            color: { background: colours.spouse, border: colours.spouse },
            x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2
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

    const options = {
        // Positions come from computeLayout, not vis-network's own layout.
        physics: false,
        interaction: { hover: true, tooltipDelay: 200 },
        edges: {
            smooth: {
                type: 'cubicBezier',
                forceDirection: horizontal ? 'horizontal' : 'vertical',
                roundness: 0.4
            }
        }
    };

    // Keep the view where it was when redrawing (theme or option change).
    const view = network ? { position: network.getViewPosition(), scale: network.getScale() } : null;
    const sameDirection = lastDrawing && lastDrawing.horizontal === horizontal;

    if (network) network.destroy();
    network = new vis.Network(container, { nodes, edges }, options);
    lastDrawing = { nodes: nodes.get(), edges: edges.get(), options, horizontal, colours };

    if (view && sameDirection) network.moveTo({ ...view, animation: false });

    // Couple dots have string ids; only people are selectable.
    const personAt = params => params.nodes.find(id => typeof id === 'number') ?? null;

    network.on("click", function (params) {
        selectedId = personAt(params);
        renderMembersList();
        if (selectedId !== null) showDetails(selectedId);
    });

    network.on("doubleClick", function (params) {
        const id = personAt(params);
        if (id !== null) openEditModal(id);
    });

    if (selectedId && byId(selectedId)) {
        network.selectNodes([selectedId]);
    }
}

/* ---------- PNG export ---------- */

/**
 * The whole tree as an image, not just what's on screen: the same drawing is
 * rendered off-screen at full size, then given a background and a title.
 */
async function exportPng() {
    if (!lastDrawing || !membersData.length) return;
    showToast('Preparing image…');

    const people = lastDrawing.nodes.filter(n => typeof n.id === 'number');
    const minX = Math.min(...people.map(n => n.x)) - NODE_W / 2 - 40;
    const maxX = Math.max(...people.map(n => n.x)) + NODE_W / 2 + 40;
    const minY = Math.min(...people.map(n => n.y)) - 70;
    const maxY = Math.max(...people.map(n => n.y)) + 70;

    // Sharp but within what browsers will allocate for one canvas.
    const ratio = window.devicePixelRatio || 1;
    let scale = 1.5;
    const longest = Math.max(maxX - minX, maxY - minY);
    if (longest * scale * ratio > 14000) scale = 14000 / (longest * ratio);

    const box = document.createElement('div');
    box.style.cssText = `position:fixed; left:-100000px; top:0; width:${Math.ceil((maxX - minX) * scale)}px; height:${Math.ceil((maxY - minY) * scale)}px;`;
    document.body.appendChild(box);

    const drawn = net => new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        net.once('afterDrawing', () => { clearTimeout(timer); resolve(); });
    });

    try {
        const offscreen = new vis.Network(box,
            { nodes: new vis.DataSet(lastDrawing.nodes.map(n => ({ ...n, title: undefined }))), edges: new vis.DataSet(lastDrawing.edges) },
            { ...lastDrawing.options, interaction: { dragView: false, zoomView: false, hover: false } });
        await drawn(offscreen);
        const settled = drawn(offscreen);
        offscreen.moveTo({ position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, scale, animation: false });
        offscreen.redraw();
        await settled;

        const src = box.querySelector('canvas');
        const header = Math.round(64 * ratio);
        const out = document.createElement('canvas');
        out.width = src.width;
        out.height = src.height + header;
        const ctx = out.getContext('2d');
        ctx.fillStyle = lastDrawing.colours.treeBg || '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.fillStyle = lastDrawing.colours.text;
        ctx.font = `600 ${Math.round(24 * ratio)}px system-ui, sans-serif`;
        ctx.fillText('Family Tree', 24 * ratio, 38 * ratio);
        ctx.fillStyle = lastDrawing.colours.muted;
        ctx.font = `${Math.round(14 * ratio)}px system-ui, sans-serif`;
        const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        ctx.fillText(`${membersData.length} members · ${today}`, 24 * ratio, 58 * ratio);
        ctx.drawImage(src, 0, header);
        offscreen.destroy();

        const link = document.createElement('a');
        link.download = `family-tree-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = out.toDataURL('image/png');
        link.click();
        showToast('Image saved');
    } catch (e) {
        console.error('PNG export failed', e);
        showToast('Could not create the image.', true);
    } finally {
        box.remove();
    }
}
