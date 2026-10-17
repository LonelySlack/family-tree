// "How are we related?" — names the relationship between two people, in
// English and Malay, plus the chain of people that connects them.
// Pure functions of the member list; app.js shows the result.

/** Pick a word by gender: g(person, 'father', 'mother', 'parent'). */
function g(person, male, female, neutral) {
    if (person?.gender === 'Male') return male;
    if (person?.gender === 'Female') return female;
    return neutral;
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times'];
const MALAY_NUM = ['', 'se', 'dua ', 'tiga ', 'empat ', 'lima ', 'enam ', 'tujuh ', 'lapan '];

/** Every ancestor of id with its distance: Map(ancestorId -> generations up). */
function ancestorsOf(id, people) {
    const out = new Map([[id, 0]]);
    const queue = [id];
    while (queue.length) {
        const cur = queue.shift();
        const m = people.get(cur);
        for (const p of [m?.father_id, m?.mother_id]) {
            if (p && people.has(p) && !out.has(p)) {
                out.set(p, out.get(cur) + 1);
                queue.push(p);
            }
        }
    }
    return out;
}

/** Is a older than b? true / false, or null when we can't tell. */
function isOlder(a, b) {
    if (a.birth_order && b.birth_order && a.father_id === b.father_id) return a.birth_order < b.birth_order;
    if (a.birth_date && b.birth_date) return a.birth_date < b.birth_date;
    return null;
}

/**
 * Blood relationship: what A is to B, from their nearest common ancestor.
 * da / db = generations from A / B up to that ancestor.
 */
function bloodRelation(aId, bId, people) {
    const ua = ancestorsOf(aId, people);
    const ub = ancestorsOf(bId, people);
    let best = null;
    for (const [anc, da] of ua) {
        if (!ub.has(anc)) continue;
        const db = ub.get(anc);
        if (!best || da + db < best.da + best.db) best = { anc, da, db };
    }
    if (!best) return null;
    const { da, db } = best;
    const a = people.get(aId), b = people.get(bId);

    if (da === 0) { // A is B's ancestor
        const en = ['', g(a, 'father', 'mother', 'parent'), g(a, 'grandfather', 'grandmother', 'grandparent')][db]
            ?? `${'great-'.repeat(db - 2)}${g(a, 'grandfather', 'grandmother', 'grandparent')}`;
        const ms = ['', g(a, 'bapa', 'ibu', 'ibu bapa'), g(a, 'datuk', 'nenek', 'datuk/nenek'), 'moyang'][db]
            ?? `nenek moyang (${db} generasi ke atas)`;
        return { en, ms };
    }
    if (db === 0) { // A is B's descendant
        const en = ['', g(a, 'son', 'daughter', 'child'), g(a, 'grandson', 'granddaughter', 'grandchild')][da]
            ?? `${'great-'.repeat(da - 2)}${g(a, 'grandson', 'granddaughter', 'grandchild')}`;
        const ms = ['', 'anak', 'cucu', 'cicit', 'piut'][da] ?? `keturunan (${da} generasi ke bawah)`;
        return { en, ms };
    }
    if (da === 1 && db === 1) { // siblings
        const shareFather = a.father_id && a.father_id === b.father_id;
        const shareMother = a.mother_id && a.mother_id === b.mother_id;
        const half = a.father_id && a.mother_id && b.father_id && b.mother_id && !(shareFather && shareMother);
        const en = `${half ? 'half-' : ''}${g(a, 'brother', 'sister', 'sibling')}`;
        const older = isOlder(a, b);
        let ms = older === null ? 'adik-beradik' : older ? g(a, 'abang', 'kakak', 'abang/kakak') : 'adik';
        if (half) ms += shareFather ? ' sebapa' : ' seibu';
        return { en, ms };
    }
    if (da === 1) { // A is a sibling of B's ancestor
        const en = `${'great-'.repeat(Math.max(0, db - 3))}${db >= 3 ? 'grand-' : ''}${g(a, 'uncle', 'aunt', 'aunt/uncle')}`
            .replace('grand-', 'great-');
        const ms = ['', '', g(a, 'bapa saudara', 'ibu saudara', 'bapa/ibu saudara'),
            g(a, 'datuk saudara', 'nenek saudara', 'datuk/nenek saudara'), 'moyang saudara'][db]
            ?? `saudara nenek moyang (${db} generasi)`;
        return { en, ms };
    }
    if (db === 1) { // A is a descendant of B's sibling
        const en = `${'great-'.repeat(Math.max(0, da - 3))}${da >= 3 ? 'grand' : ''}${g(a, 'nephew', 'niece', 'nephew/niece')}`;
        const ms = ['', '', 'anak saudara', 'cucu saudara', 'cicit saudara'][da] ?? `keturunan saudara (${da} generasi)`;
        return { en, ms };
    }
    // Cousins: degree from the nearer side, "removed" by the generation gap.
    const degree = Math.min(da, db) - 1;
    const removed = Math.abs(da - db);
    const en = `${ORDINAL[degree] ?? `${degree}th`} cousin${removed ? ` ${TIMES[removed] ?? `${removed} times`} removed` : ''}`;
    const base = `${MALAY_NUM[degree] ?? `${degree} `}pupu`;
    let ms = base;
    if (removed === 1) ms = da > db ? `anak ${base}` : `${base} ibu bapa`;
    else if (removed === 2) ms = da > db ? `cucu ${base}` : `${base} datuk/nenek`;
    else if (removed > 2) ms = `${base} (berbeza ${removed} generasi)`;
    return { en, ms };
}

/** Shortest chain of parent/child/spouse links from A to B, for display:
 *  [{ person, label }] where label says what this person is to the one before. */
function relationPath(aId, bId, people, members) {
    const childrenOf = new Map();
    for (const m of members) {
        for (const p of [m.father_id, m.mother_id]) {
            if (p) childrenOf.set(p, [...(childrenOf.get(p) || []), m.id]);
        }
    }
    const prev = new Map([[aId, null]]);
    const queue = [aId];
    while (queue.length && !prev.has(bId)) {
        const cur = queue.shift();
        const m = people.get(cur);
        const next = [
            ...[m.father_id, m.mother_id].filter(p => p && people.has(p)).map(p => [p, 'parent']),
            ...(childrenOf.get(cur) || []).map(c => [c, 'child']),
            ...(m.spouse_ids || []).filter(s => people.has(s)).map(s => [s, 'spouse']),
        ];
        for (const [n, kind] of next) {
            if (prev.has(n)) continue;
            prev.set(n, { from: cur, kind });
            queue.push(n);
        }
    }
    if (!prev.has(bId)) return null;
    const steps = [];
    for (let cur = bId; prev.get(cur); cur = prev.get(cur).from) {
        const { kind } = prev.get(cur);
        const p = people.get(cur);
        const label = kind === 'parent' ? g(p, 'father', 'mother', 'parent')
            : kind === 'child' ? g(p, 'son', 'daughter', 'child')
            : g(p, 'husband', 'wife', 'spouse');
        steps.unshift({ person: p, label });
    }
    return [{ person: people.get(aId), label: null }, ...steps];
}

/**
 * What A is to B: { en, ms, path } or null if nothing in the tree links them.
 * en reads "A is B's <en>"; ms reads "A ialah <ms> kepada B".
 */
function relationship(aId, bId, members) {
    const people = new Map(members.map(m => [m.id, m]));
    const a = people.get(aId), b = people.get(bId);
    if (!a || !b) return null;
    if (aId === bId) return { en: 'the same person', ms: 'orang yang sama', path: [] };

    const path = relationPath(aId, bId, people, members);
    const result = (r) => ({ ...r, path });

    const blood = bloodRelation(aId, bId, people);
    if (blood) return result(blood);

    if ((a.spouse_ids || []).includes(bId)) {
        return result({ en: g(a, 'husband', 'wife', 'spouse'), ms: g(a, 'suami', 'isteri', 'pasangan') });
    }

    // A married someone related to B.
    for (const s of a.spouse_ids || []) {
        const r = bloodRelation(s, bId, people);
        if (!r) continue;
        const x = people.get(s);
        if (r.en.match(/^(son|daughter|child)$/)) return result({ en: g(a, 'son-in-law', 'daughter-in-law', 'child-in-law'), ms: 'menantu' });
        if (r.en.match(/^(grandson|granddaughter|grandchild)$/)) return result({ en: g(a, 'grandson-in-law', 'granddaughter-in-law', 'grandchild-in-law'), ms: 'cucu menantu' });
        if (r.en.match(/^(half-)?(brother|sister|sibling)$/)) return result({ en: g(a, 'brother-in-law', 'sister-in-law', 'sibling-in-law'), ms: 'ipar' });
        if (r.en.match(/uncle|aunt/)) return result({ en: `${g(a, 'uncle', 'aunt', 'aunt/uncle')} by marriage`, ms: `${g(a, 'bapa saudara', 'ibu saudara', 'bapa/ibu saudara')} (melalui perkahwinan)` });
        return result({ en: `${r.en}'s ${g(a, 'husband', 'wife', 'spouse')}`, ms: `${g(a, 'suami', 'isteri', 'pasangan')} kepada ${r.ms}`, via: x });
    }

    // A is related to someone B married.
    for (const s of b.spouse_ids || []) {
        const r = bloodRelation(aId, s, people);
        if (!r) continue;
        const y = people.get(s);
        const spouseEn = g(y, 'husband', 'wife', 'spouse');
        const spouseMs = g(y, 'suami', 'isteri', 'pasangan');
        if (r.en.match(/^(father|mother|parent)$/)) return result({ en: g(a, 'father-in-law', 'mother-in-law', 'parent-in-law'), ms: g(a, 'bapa mertua', 'ibu mertua', 'mertua') });
        if (r.en.match(/^(half-)?(brother|sister|sibling)$/)) return result({ en: g(a, 'brother-in-law', 'sister-in-law', 'sibling-in-law'), ms: 'ipar' });
        return result({ en: `${spouseEn}'s ${r.en}`, ms: `${r.ms} kepada ${spouseMs}` });
    }

    // Both married in: biras (spouses are siblings) and besan (children married).
    for (const s of a.spouse_ids || []) {
        for (const t of b.spouse_ids || []) {
            const r = bloodRelation(s, t, people);
            if (r && r.en.match(/^(half-)?(brother|sister|sibling)$/)) {
                return result({ en: 'spouse of a sibling-in-law (co-sibling-in-law)', ms: 'biras' });
            }
        }
    }
    const kids = id => members.filter(c => c.father_id === id || c.mother_id === id);
    for (const c of kids(aId)) {
        for (const d of c.spouse_ids || []) {
            const dm = people.get(d);
            if (dm && (dm.father_id === bId || dm.mother_id === bId)) {
                return result({ en: "child's spouse's parent (co-parent-in-law)", ms: 'besan' });
            }
        }
    }

    if (path) return result({ en: 'relative by marriage', ms: 'saudara melalui perkahwinan' });
    return null;
}
