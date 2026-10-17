// Tree layout: which generation everyone is in, and where each box goes.
// Pure functions of the member list, no DOM — app.js draws the result.

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

/** Sibling order: birth order where both have one ("anak ke-"), else birth
 *  date, else the order they were added. */
function eldestFirst(a, b) {
    if (a.birth_order && b.birth_order && a.birth_order !== b.birth_order) return a.birth_order - b.birth_order;
    return (a.birth_date || '9999').localeCompare(b.birth_date || '9999') || a.id - b.id;
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
            for (const s of m.spouse_ids || []) {
                if (levelMap[s] !== undefined && levelMap[s] > newLevel) newLevel = levelMap[s];
            }

            if (newLevel !== currentLevel) {
                levelMap[m.id] = newLevel;
                changed = true;
            }
        });
    }

    data.forEach(m => {
        for (const s of m.spouse_ids || []) {
            if (levelMap[s] === undefined) continue;
            levelMap[m.id] = Math.max(levelMap[m.id], levelMap[s]);
            levelMap[s] = levelMap[m.id];
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
        for (const s of m.spouse_ids || []) pair(m.id, s);
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
    const oldestFirst = [...data].sort(eldestFirst);
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
