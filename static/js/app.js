let membersData = [];
let levels = {};
let network = null;
let selectedId = null;
let lastDrawing = null; // what drawTree last rendered, reused by the PNG export
let initialViewDone = false;
let me = null;          // the logged-in account: { display_name, role, ... }
let layoutPos = {};     // computeLayout's positions, shared by the tree and the list

const canEdit = () => me && (me.role === 'editor' || me.role === 'admin');
const isAdmin = () => me && me.role === 'admin';

/* ---------- talking to the server ---------- */

/** fetch() with the header the server requires on changes, JSON in and out,
 *  and a trip back to the login page if the session has ended. */
async function api(url, { method = 'GET', json, form } = {}) {
    const headers = { 'X-Requested-With': 'fetch' };
    let body;
    if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    } else if (form) {
        body = form;
    }
    const res = await fetch(url, { method, headers, body });
    if (res.status === 401) {
        location.href = '/login';
        throw new Error('Logged out');
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

/* ---------- settings (remembered per browser) ---------- */

// homeId: "This is me" — the tree opens zoomed in on that person.
const DEFAULT_SETTINGS = {
    direction: 'down', compact: false, nicknames: true, photos: true, colourByGender: true, homeId: null
};
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
    document.getElementById('optPhotos').checked = settings.photos;
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

document.addEventListener("DOMContentLoaded", async () => {
    loadSettings();
    applyTheme(currentTheme(), false);
    // Follow the device's light/dark setting unless the user picked one here.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        let saved = null;
        try { saved = localStorage.getItem('ft-theme'); } catch (err) {}
        if (!saved) applyTheme(e.matches ? 'dark' : 'light', false);
    });
    await loadMe();
    loadMembers();
});

async function loadMe() {
    const { data } = await api('/api/auth/me');
    me = data;
    document.getElementById('userName').textContent = me.display_name;
    document.getElementById('userRole').textContent = `Signed in as ${me.username} · ${me.role}`;
    document.body.classList.toggle('read-only', !canEdit());
    document.body.classList.toggle('is-admin', isAdmin());
    document.getElementById('treeHint').textContent = canEdit()
        ? 'Click for details · double-click to edit' : 'Click someone for details';
    if (isAdmin()) refreshPendingBadge();
}

async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
}

async function loadMembers() {
    try {
        const { data } = await api('/api/members');
        membersData = data;
        levels = calculateLevels(membersData);
        layoutPos = computeLayout(membersData, levels);
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

function initials(name) {
    const words = displayName(name).split(' ').filter(w => !['bin', 'binti'].includes(w));
    return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '?';
}

/** Round photo, or initials when there's no photo. */
function avatar(m, size) {
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
    if (m.photo_url) return `<img class="avatar" src="${escapeHtml(m.photo_url)}" alt="" style="${style}">`;
    const tone = m.gender === 'Female' ? 'female' : m.gender === 'Male' ? 'male' : '';
    return `<span class="avatar avatar-initials ${tone}" style="${style}">${escapeHtml(initials(m.name))}</span>`;
}

/** Generation by generation, left to right as in the tree, so siblings stay
 *  together and in birth order. */
function sortedMembers() {
    const x = id => layoutPos[id]?.x ?? 0;
    return [...membersData].sort((a, b) =>
        (levels[a.id] ?? 0) - (levels[b.id] ?? 0) || x(a.id) - x(b.id) || eldestFirst(a, b));
}

function relations(m) {
    const parents = [byId(m.father_id), byId(m.mother_id)].filter(Boolean);
    const children = membersData.filter(c => c.father_id === m.id || c.mother_id === m.id).sort(eldestFirst);
    const partners = new Map();
    for (const s of m.spouse_ids || []) if (byId(s)) partners.set(s, { person: byId(s), married: true });
    for (const c of children) {
        const other = byId(c.father_id === m.id ? c.mother_id : c.father_id);
        if (other && !partners.has(other.id)) partners.set(other.id, { person: other, married: false });
    }
    const siblings = membersData.filter(s => s.id !== m.id && (
        (m.father_id && s.father_id === m.father_id) || (m.mother_id && s.mother_id === m.mother_id)
    )).map(s => ({
        person: s,
        half: !(s.father_id === m.father_id && s.mother_id === m.mother_id),
    })).sort((a, b) => a.half - b.half || eldestFirst(a.person, b.person)); // full siblings first
    return { parents, partners: [...partners.values()], siblings, children };
}

function showToast(message, isError) {
    const el = document.getElementById('toast');
    el.classList.toggle('text-bg-danger', Boolean(isError));
    el.classList.toggle('text-bg-dark', !isError);
    document.getElementById('toastBody').textContent = message;
    bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show();
}

function personOptions(selected, { exclude = [], filter, blank = 'None' } = {}) {
    const opts = sortedMembers()
        .filter(m => !exclude.includes(m.id) && (!filter || filter(m) || m.id === selected))
        .map(m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${escapeHtml(displayName(m.name))}${m.nickname ? ` (${escapeHtml(m.nickname)})` : ''}</option>`);
    return (blank !== null ? `<option value="">${blank}</option>` : '') + opts.join('');
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
        list.innerHTML = `<li class="list-group-item text-body-secondary small">${membersData.length ? 'No matches' : (canEdit() ? 'No members yet — add the first one.' : 'No members yet.')}</li>`;
        return;
    }

    shown.forEach(m => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex align-items-center gap-2';
        if (m.id === selectedId) li.classList.add('active-member');
        const meta = lifeLine(m);
        const deceased = m.is_deceased ? ' <span class="badge text-bg-secondary">Meninggal Dunia</span>' : '';
        li.innerHTML = `
            ${avatar(m, 34)}
            <div class="min-w-0 flex-grow-1">
                <div>${escapeHtml(displayName(m.name))}${deceased}</div>
                ${m.nickname ? `<div class="nick">${escapeHtml(m.nickname)}</div>` : ''}
                ${meta ? `<div class="member-meta">${escapeHtml(meta)}</div>` : ''}
            </div>
            ${canEdit() ? '<button class="btn btn-sm btn-outline-primary">Edit</button>' : ''}`;
        li.addEventListener('click', () => { focusMember(m.id); showDetails(m.id); });
        li.querySelector('button')?.addEventListener('click', (e) => {
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
    document.getElementById('detailsPhoto').innerHTML = avatar(m, 64);

    const facts = [];
    if (m.gender) facts.push(['Gender', m.gender]);
    if (m.birth_order) facts.push(['Birth order', `Anak ke-${m.birth_order}`]);
    if (m.birth_date) facts.push(['Born', formatDate(m.birth_date)]);
    if (m.death_date) facts.push(['Died', formatDate(m.death_date)]);
    else if (m.is_deceased) facts.push(['Status', 'Meninggal Dunia']);
    const age = calculateAge(m.birth_date, m.death_date, m.is_deceased);
    if (age !== null) facts.push([m.is_deceased ? 'Age at death' : 'Age', `${age}`]);
    facts.push(['Generation', `${(levels[m.id] ?? 0) + 1}`]);

    const home = settings.homeId && settings.homeId !== m.id ? byId(settings.homeId) : null;
    if (home) {
        const r = relationship(m.id, home.id, membersData);
        if (r) facts.push(['To you', `${r.en} · ${r.ms}`]);
    }

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
        ${group(partners.length > 1 ? 'Spouses' : 'Spouse', partners.map(p => chip(p.person, p.married ? '' : ' <small class="text-body-secondary">(co-parent)</small>')))}
        ${group('Siblings', siblings.map(s => chip(s.person, s.half ? ' <small class="text-body-secondary">(half)</small>' : '')))}
        ${group('Children', children.map(c => chip(c)))}
        ${m.notes ? `<div class="relation-group"><h6>Notes</h6><div class="detail-notes">${escapeHtml(m.notes)}</div></div>` : ''}
        <div class="d-flex flex-wrap gap-2 mt-3">
            ${canEdit() ? `
            <button class="btn btn-primary btn-sm" onclick="openEditModal(${m.id})">Edit</button>
            <button class="btn btn-outline-primary btn-sm" onclick="openAddModal({ relativeOf: ${m.id}, as: 'child' })">+ Add child</button>
            <button class="btn btn-outline-primary btn-sm" onclick="openAddModal({ relativeOf: ${m.id}, as: 'spouse' })">+ Add spouse</button>` : ''}
            <button class="btn btn-outline-secondary btn-sm" onclick="openRelationshipModal(${m.id})">🔗 Relationship…</button>
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

let formSpouses = [];        // spouse ids in the open form
let photoChange = null;      // null = keep, File = upload, 'remove' = delete

function renderSpouseChips() {
    const selfId = Number(document.getElementById('memberId').value) || null;
    document.getElementById('spouseChips').innerHTML = formSpouses.map(id => {
        const p = byId(id);
        return p ? `<span class="btn btn-sm btn-outline-secondary">${escapeHtml(displayName(p.name))}
            <span class="ms-1" role="button" title="Remove" onclick="removeSpouse(${id})">✕</span></span>` : '';
    }).join('');
    document.getElementById('spouseAdd').innerHTML =
        personOptions(null, { exclude: [selfId, ...formSpouses], blank: '+ Add a spouse…' });
}

function addSpouseFromSelect() {
    const sel = document.getElementById('spouseAdd');
    if (sel.value) formSpouses.push(Number(sel.value));
    renderSpouseChips();
}

function removeSpouse(id) {
    formSpouses = formSpouses.filter(s => s !== id);
    renderSpouseChips();
}

function fillParentSelects(m) {
    const exclude = m?.id ? [m.id] : [];
    // Fathers male, mothers female; people with no gender recorded fit either.
    document.getElementById('father_id').innerHTML = personOptions(m?.father_id, { exclude, filter: x => x.gender !== 'Female' });
    document.getElementById('mother_id').innerHTML = personOptions(m?.mother_id, { exclude, filter: x => x.gender !== 'Male' });
}

function setPhotoPreview(m) {
    photoChange = null;
    document.getElementById('photoInput').value = '';
    document.getElementById('photoPreview').innerHTML = avatar(m || { name: '?' }, 64);
    document.getElementById('removePhotoBtn').classList.toggle('d-none', !m?.photo_url);
}

function previewPhoto() {
    const file = document.getElementById('photoInput').files[0];
    if (!file) return;
    photoChange = file;
    const url = URL.createObjectURL(file);
    document.getElementById('photoPreview').innerHTML = `<img class="avatar" src="${url}" alt="" style="width:64px;height:64px">`;
    document.getElementById('removePhotoBtn').classList.remove('d-none');
}

function markPhotoRemoved() {
    photoChange = 'remove';
    document.getElementById('photoInput').value = '';
    document.getElementById('photoPreview').innerHTML = avatar({ name: document.getElementById('name').value || '?' }, 64);
    document.getElementById('removePhotoBtn').classList.add('d-none');
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
 * a child gets this person and their spouse as parents, a spouse gets married
 * to this person.
 */
function openAddModal(prefill) {
    document.getElementById('memberForm').reset();
    document.getElementById('memberId').value = '';
    document.getElementById('deleteBtn').style.display = 'none';
    showError('');
    setPhotoPreview(null);
    formSpouses = [];

    const draft = {};
    let title = 'Add member';
    const rel = prefill && byId(prefill.relativeOf);
    if (rel && prefill.as === 'child') {
        const pair = [rel, ...(rel.spouse_ids || []).map(byId)].filter(Boolean);
        draft.father_id = rel.gender === 'Male' ? rel.id : pair.find(p => p.gender === 'Male')?.id;
        draft.mother_id = rel.gender === 'Female' ? rel.id : pair.find(p => p.gender === 'Female')?.id;
        if (!draft.father_id && !draft.mother_id) draft.father_id = rel.id;
        const siblings = membersData.filter(c => c.father_id === rel.id || c.mother_id === rel.id);
        document.getElementById('birth_order').value = siblings.length + 1;
        title = `Add child of ${displayName(rel.name)}`;
    } else if (rel && prefill.as === 'spouse') {
        formSpouses = [rel.id];
        if (rel.gender === 'Male') document.getElementById('gender').value = 'Female';
        if (rel.gender === 'Female') document.getElementById('gender').value = 'Male';
        title = `Add spouse of ${displayName(rel.name)}`;
    }
    document.getElementById('modalTitle').innerText = title;
    fillParentSelects(draft);
    renderSpouseChips();
    showModal();
}

function openEditModal(id) {
    const m = byId(id);
    if (!m || !canEdit()) return;

    document.getElementById('memberId').value = m.id;
    document.getElementById('name').value = m.name || '';
    document.getElementById('nickname').value = m.nickname || '';
    document.getElementById('gender').value = m.gender || '';
    document.getElementById('birth_order').value = m.birth_order || '';
    document.getElementById('birth_date').value = m.birth_date || '';
    document.getElementById('death_date').value = m.death_date || '';
    document.getElementById('is_deceased').checked = m.is_deceased === 1;
    document.getElementById('notes').value = m.notes || '';
    formSpouses = [...(m.spouse_ids || [])];
    fillParentSelects(m);
    renderSpouseChips();
    setPhotoPreview(m);

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
        birth_order: document.getElementById('birth_order').value || null,
        birth_date: document.getElementById('birth_date').value,
        death_date: document.getElementById('death_date').value,
        is_deceased: document.getElementById('is_deceased').checked ? 1 : 0,
        father_id: document.getElementById('father_id').value || null,
        mother_id: document.getElementById('mother_id').value || null,
        spouse_ids: formSpouses,
        notes: document.getElementById('notes').value
    };

    if (!data.name) {
        showError('Name is required.');
        return;
    }

    try {
        const { ok, data: body } = await api(id ? `/api/members/${id}` : '/api/members',
            { method: id ? 'PUT' : 'POST', json: data });
        if (!ok) {
            showError(body.error || 'Save failed.');
            return;
        }
        const savedId = id ? Number(id) : body.id;

        if (photoChange === 'remove') {
            await api(`/api/members/${savedId}/photo`, { method: 'DELETE' });
        } else if (photoChange) {
            const form = new FormData();
            form.append('photo', photoChange);
            const { ok: photoOk, data: photoBody } = await api(`/api/members/${savedId}/photo`, { method: 'POST', form });
            if (!photoOk) showToast(`Saved, but the photo failed: ${photoBody.error || 'unknown error'}`, true);
        }

        hideModal();
        selectedId = savedId;
        await loadMembers();
        showToast(`Saved ${displayName(data.name)}`);
    } catch (e) {
        showError('Could not reach the server. Is it running?');
    }
}

async function deleteMember() {
    const id = Number(document.getElementById('memberId').value);
    const m = byId(id);
    if (!confirm(`Delete ${displayName(m?.name)}? Their links to parents, children and spouses are removed too.`)) return;
    const { ok } = await api(`/api/members/${id}`, { method: 'DELETE' });
    if (ok) {
        hideModal();
        if (selectedId === id) {
            selectedId = null;
            bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('detailsPanel')).hide();
        }
        await loadMembers();
        showToast(`Deleted ${displayName(m?.name)}`);
    } else {
        showError('Delete failed.');
    }
}

/* ---------- how are we related? ---------- */

function openRelationshipModal(fromId) {
    const a = fromId ?? selectedId ?? settings.homeId ?? sortedMembers()[0]?.id;
    let b = settings.homeId && settings.homeId !== a ? settings.homeId : null;
    if (!b) b = sortedMembers().find(m => m.id !== a)?.id;
    document.getElementById('relA').innerHTML = personOptions(a, { blank: null });
    document.getElementById('relB').innerHTML = personOptions(b, { blank: null });
    showRelationship();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('relationshipModal')).show();
}

function swapRelationship() {
    const a = document.getElementById('relA'), b = document.getElementById('relB');
    [a.value, b.value] = [b.value, a.value];
    showRelationship();
}

function showRelationship() {
    const aId = Number(document.getElementById('relA').value);
    const bId = Number(document.getElementById('relB').value);
    const a = byId(aId), b = byId(bId);
    const out = document.getElementById('relResult');
    if (!a || !b) { out.innerHTML = ''; return; }
    const r = relationship(aId, bId, membersData);
    if (!r) {
        out.innerHTML = `<div class="alert alert-secondary mb-0">No link between them in the tree yet.</div>`;
        return;
    }
    const an = escapeHtml(displayName(a.name)), bn = escapeHtml(displayName(b.name));
    const chain = (r.path || []).map((s, i) => `
        ${i ? `<span class="path-arrow">→ <small>${escapeHtml(s.label)}</small></span>` : ''}
        <span class="path-person">${escapeHtml(displayName(s.person.name))}</span>`).join('');
    out.innerHTML = `
        <div class="rel-answer">
            <div class="rel-en"><b>${an}</b> is <b>${bn}</b>'s <span class="rel-term">${escapeHtml(r.en)}</span></div>
            <div class="rel-ms"><b>${an}</b> ialah <span class="rel-term">${escapeHtml(r.ms)}</span> kepada <b>${bn}</b></div>
        </div>
        ${r.path && r.path.length > 1 ? `<h6 class="small text-body-secondary mt-3 mb-1">How</h6><div class="rel-path">${chain}</div>` : ''}`;
}

/* ---------- import from Excel ---------- */

function openImportModal() {
    document.getElementById('importFile').value = '';
    document.getElementById('importResult').innerHTML = '';
    document.getElementById('importApplyBtn').disabled = true;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('importModal')).show();
}

function importForm() {
    const form = new FormData();
    form.append('file', document.getElementById('importFile').files[0]);
    return form;
}

async function previewImport() {
    const btn = document.getElementById('importApplyBtn');
    const out = document.getElementById('importResult');
    btn.disabled = true;
    if (!document.getElementById('importFile').files[0]) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="text-body-secondary">Reading the file…</div>';
    const { ok, data } = await api('/api/import/preview', { method: 'POST', form: importForm() });
    if (!ok) { out.innerHTML = `<div class="alert alert-danger">${escapeHtml(data.error || 'Could not read the file')}</div>`; return; }
    if (data.errors.length) {
        out.innerHTML = `<div class="alert alert-danger"><b>Fix these in the spreadsheet, then choose it again:</b>
            <ul class="mb-0 mt-1">${data.errors.map(e => `<li>Row ${e.row}: ${escapeHtml(e.message)}</li>`).join('')}</ul></div>`;
        return;
    }
    const nothing = !data.adds.length && !data.updates.length && !data.marriages_added.length && !data.marriages_removed.length;
    const show = v => v === null || v === undefined || v === '' ? '<i>empty</i>' : escapeHtml(v);
    out.innerHTML = nothing
        ? `<div class="alert alert-secondary mb-0">Nothing to change: everyone in the file already matches the tree.</div>`
        : `
        ${data.adds.length ? `<h6>New people (${data.adds.length})</h6><ul>${data.adds.map(a => `<li>${escapeHtml(a.name)}</li>`).join('')}</ul>` : ''}
        ${data.updates.length ? `<h6>Changes (${data.updates.length} people)</h6><ul>${data.updates.map(u => `
            <li><b>${escapeHtml(u.name)}</b>: ${u.changes.map(c => `${escapeHtml(c.field)} ${show(c.from)} → ${show(c.to)}`).join('; ')}</li>`).join('')}</ul>` : ''}
        ${data.marriages_added.length ? `<h6>New marriages</h6><ul>${data.marriages_added.map(([a, b]) => `<li>${escapeHtml(displayName(a))} &amp; ${escapeHtml(displayName(b))}</li>`).join('')}</ul>` : ''}
        ${data.marriages_removed.length ? `<h6>Marriages removed</h6><ul>${data.marriages_removed.map(([a, b]) => `<li>${escapeHtml(displayName(a))} &amp; ${escapeHtml(displayName(b))}</li>`).join('')}</ul>` : ''}
        <p class="small text-body-secondary mb-0">${data.unchanged} row(s) unchanged. A copy of the database is saved before importing.</p>`;
    btn.disabled = nothing;
}

async function applyImport() {
    const btn = document.getElementById('importApplyBtn');
    btn.disabled = true;
    const { ok, data } = await api('/api/import/apply', { method: 'POST', form: importForm() });
    if (!ok) {
        showToast(data.error || 'Import failed; nothing was changed.', true);
        previewImport();
        return;
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('importModal')).hide();
    await loadMembers();
    showToast(`Imported: ${data.added} added, ${data.updated} updated`);
}

/* ---------- accounts (admin) ---------- */

async function refreshPendingBadge() {
    const { ok, data } = await api('/api/users');
    if (!ok) return;
    const pending = data.filter(u => u.role === 'pending').length;
    for (const id of ['pendingBadge', 'pendingBadge2']) {
        const el = document.getElementById(id);
        el.textContent = pending;
        el.classList.toggle('d-none', !pending);
    }
    return data;
}

async function openUsersModal() {
    await renderUsers();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('usersModal')).show();
}

async function renderUsers() {
    const users = await refreshPendingBadge();
    if (!users) return;
    const roleSelect = u => `<select class="form-select form-select-sm" onchange="setUserRole(${u.id}, this.value)">
        ${['pending', 'viewer', 'editor', 'admin'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
    document.getElementById('usersList').innerHTML = `
        <table class="table align-middle">
            <thead><tr><th>Name</th><th>Username</th><th>Joined</th><th style="width:9rem">Role</th><th></th></tr></thead>
            <tbody>${users.map(u => `
                <tr class="${u.role === 'pending' ? 'table-warning' : ''}">
                    <td>${escapeHtml(u.display_name)}${u.id === me.id ? ' <span class="badge text-bg-secondary">you</span>' : ''}</td>
                    <td>${escapeHtml(u.username)}</td>
                    <td class="small text-body-secondary">${escapeHtml(formatDate(u.created_at.slice(0, 10)))}</td>
                    <td>${roleSelect(u)}</td>
                    <td class="text-end text-nowrap">
                        ${u.role === 'pending' ? `<button class="btn btn-sm btn-success" onclick="setUserRole(${u.id}, 'viewer')">Approve</button>` : ''}
                        ${u.id !== me.id ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">Remove</button>` : ''}
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;
}

async function setUserRole(id, role) {
    const { ok, data } = await api(`/api/users/${id}`, { method: 'PUT', json: { role } });
    if (!ok) showToast(data.error || 'Could not change the role', true);
    else showToast(`Role set to ${role}`);
    if (id === me.id) { await loadMe(); if (!isAdmin()) location.reload(); }
    renderUsers();
}

async function deleteUser(id, username) {
    if (!confirm(`Remove the account "${username}"? Their family tree entries are not affected.`)) return;
    const { ok, data } = await api(`/api/users/${id}`, { method: 'DELETE' });
    if (!ok) showToast(data.error || 'Could not remove the account', true);
    renderUsers();
}

function openPasswordModal() {
    for (const id of ['pwCurrent', 'pwNew', 'pwNew2']) document.getElementById(id).value = '';
    document.getElementById('passwordError').classList.add('d-none');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('passwordModal')).show();
}

async function changePassword() {
    const err = document.getElementById('passwordError');
    const show = msg => { err.textContent = msg; err.classList.remove('d-none'); };
    const next = document.getElementById('pwNew').value;
    if (next !== document.getElementById('pwNew2').value) return show('The new passwords do not match');
    const { ok, data } = await api('/api/auth/password', { method: 'POST', json: {
        current_password: document.getElementById('pwCurrent').value, new_password: next } });
    if (!ok) return show(data.error || 'Could not change the password');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('passwordModal')).hide();
    showToast('Password changed');
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
    const pos = layoutPos;
    const screen = id => horizontal
        ? { x: (pos[id].y / LEVEL_H) * H_LEVEL, y: pos[id].x * H_SCALE }
        : { x: pos[id].x, y: pos[id].y };

    const nodes = new vis.DataSet(membersData.map(m => {
        // Short labels keep the tree readable; the rest is in the details panel.
        const withPhoto = settings.photos && m.photo_url;
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

        const font = {
            size: 15, multi: 'md', color: colours.text,
            bold: { size: 16, color: colours.text },
            ital: { size: 12, color: colours.muted }
        };
        const common = { id: m.id, label, title: tooltipFor(m), ...screen(m.id), font };

        if (withPhoto) {
            // Photo in a ring of the person's colour, name underneath.
            return {
                ...common,
                shape: 'circularImage',
                image: m.photo_url,
                size: 30,
                borderWidth: 3,
                borderWidthSelected: 5,
                shapeProperties: { useBorderWithImage: true, interpolation: true },
                color: { border: c.border, background: c.background, highlight: { border: colours.highlight, background: c.background } },
                widthConstraint: { maximum: NODE_W - 20 },
            };
        }
        return {
            ...common,
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
        };
    }));

    const edges = new vis.DataSet();
    const childLine = { color: { color: colours.child }, width: 2, arrows: { to: { enabled: true, scaleFactor: 0.5 } } };

    // Each couple gets a small dot midway along a dashed line, and their
    // children hang from that dot — one line per child instead of two crossing
    // ones. A couple is a marriage, or two people who share children, sitting
    // side by side in the layout.
    const coupleKey = (a, b) => `couple-${Math.min(a, b)}-${Math.max(a, b)}`;
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
        for (const s of m.spouse_ids || []) {
            if (m.id > s || !byId(s)) continue; // each marriage once
            if (adjacent(m.id, s)) addCouple(m.id, s);
            else edges.add({ from: m.id, to: s, ...partnerLine }); // far apart in the layout
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
    const maxY = Math.max(...people.map(n => n.y)) + 90;

    // Sharp but within what browsers will allocate for one canvas.
    const ratio = window.devicePixelRatio || 1;
    let scale = 1.5;
    const longest = Math.max(maxX - minX, maxY - minY);
    if (longest * scale * ratio > 14000) scale = 14000 / (longest * ratio);

    const box = document.createElement('div');
    box.style.cssText = `position:fixed; left:-100000px; top:0; width:${Math.ceil((maxX - minX) * scale)}px; height:${Math.ceil((maxY - minY) * scale)}px;`;
    document.body.appendChild(box);

    // Photos load after the first draw and each triggers a redraw, so wait
    // until drawing has gone quiet rather than for one particular frame.
    const settled = net => new Promise(resolve => {
        let quiet;
        const done = () => { net.off('afterDrawing', bump); resolve(); };
        const bump = () => { clearTimeout(quiet); quiet = setTimeout(done, 700); };
        net.on('afterDrawing', bump);
        bump();
        setTimeout(done, 6000);
    });

    try {
        const offscreen = new vis.Network(box,
            { nodes: new vis.DataSet(lastDrawing.nodes.map(n => ({ ...n, title: undefined }))), edges: new vis.DataSet(lastDrawing.edges) },
            { ...lastDrawing.options, interaction: { dragView: false, zoomView: false, hover: false } });
        offscreen.moveTo({ position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, scale, animation: false });
        offscreen.redraw();
        await settled(offscreen);

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
