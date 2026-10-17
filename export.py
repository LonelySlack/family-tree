"""Spreadsheet export of the whole tree."""
import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

LOWERCASE_WORDS = {'bin', 'binti', 'bt', 'bte', 'b.', 'al', 'van', 'de'}


def display_name(name):
    """Same formatting as the web page: "ahmad faiz bin abu bakar" -> "Ahmad Faiz bin Abu Bakar"."""
    words = (name or '').split()
    return ' '.join(
        w.lower() if i > 0 and w.lower() in LOWERCASE_WORDS else w[:1].upper() + w[1:].lower()
        for i, w in enumerate(words)
    )


def age(member, today=None):
    if not member['birth_date']:
        return None
    if member['is_deceased'] and not member['death_date']:
        return None
    born = date.fromisoformat(member['birth_date'])
    end = date.fromisoformat(member['death_date']) if member['death_date'] else (today or date.today())
    return end.year - born.year - ((end.month, end.day) < (born.month, born.day))


def generations(members):
    """Generation number per id, 1 = oldest, matching the tree's rows:
    a child sits below both parents, and spouses share a generation."""
    by_id = {m['id']: m for m in members}
    level = {m['id']: 0 for m in members}
    for _ in range(100):
        changed = False
        for m in members:
            new = level[m['id']]
            for p in (m['father_id'], m['mother_id']):
                if p in level:
                    new = max(new, level[p] + 1)
            if m['spouse_id'] in level:
                new = max(new, level[m['spouse_id']])
            if new != level[m['id']]:
                level[m['id']] = new
                changed = True
        if not changed:
            break
    return {i: lv + 1 for i, lv in level.items() if i in by_id}


COLUMNS = [
    ('Generation', 11), ('Name', 34), ('Nickname', 16), ('Gender', 9),
    ('Birth date', 12), ('Death date', 12), ('Status', 16), ('Age', 6),
    ('Father', 30), ('Mother', 30), ('Spouse', 30), ('Children', 50), ('Notes', 50),
]


def to_xlsx(members):
    by_id = {m['id']: m for m in members}
    gen = generations(members)
    name_of = lambda i: display_name(by_id[i]['name']) if i in by_id else ''

    wb = Workbook()
    ws = wb.active
    ws.title = 'Family'
    ws.append([c for c, _ in COLUMNS])

    ordered = sorted(members, key=lambda m: (gen[m['id']], m['birth_date'] or '9999', m['id']))
    for m in ordered:
        children = [c for c in ordered if m['id'] in (c['father_id'], c['mother_id'])]
        ws.append([
            gen[m['id']],
            display_name(m['name']),
            m.get('nickname') or '',
            m['gender'] or '',
            m['birth_date'] or '',
            m['death_date'] or '',
            'Meninggal Dunia' if m['is_deceased'] else '',
            age(m),
            name_of(m['father_id']),
            name_of(m['mother_id']),
            name_of(m['spouse_id']),
            ', '.join(display_name(c['name']) for c in children),
            m['notes'] or '',
        ])

    header_fill = PatternFill('solid', start_color='0D6EFD')
    for cell in ws[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = header_fill
        cell.alignment = Alignment(vertical='center')
    for i, (_, width) in enumerate(COLUMNS, 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical='top', wrap_text=cell.column_letter in ('L', 'M'))
    ws.freeze_panes = 'C2'
    ws.auto_filter.ref = ws.dimensions

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out
