# Family Tree

A small self-hosted web app for recording a family and seeing it as a tree. It's Flask and SQLite on the server, with one page in the browser.

## Features

- **Tree view** with a custom layout:
  - couples sit side by side, each spouse on the side nearer their own parents
  - children hang from the couple's midpoint, oldest first
  - generations are reordered so lines don't cross
- **Hover card** for each person: dates, age, spouse, number of children and notes.
- **Member list** ordered by generation, with search. Clicking a name zooms the tree to that person.
- **Add, edit and delete** people. Double-click a person in the tree to edit them.
- **Spouse links are kept two-way.** Setting A's spouse to B also sets B's spouse to A. If B is already married, the app asks before replacing that link.
- **Checks when saving:**
  - name is required
  - a death date can't be before the birth date
  - a death date marks the person as deceased
  - nobody can be their own parent
- **Works without internet.** Bootstrap and vis-network are stored in `static/vendor`.

## Running it

Needs Python 3.10 or newer.

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/waitress-serve --listen=0.0.0.0:5000 app:app
```

Then open `http://<host>:5000`. The database (`family_tree.db`) is created next to `database.py` on first start.

For development, `venv/bin/flask --app app run --debug` reloads on changes. The Waitress server caches page templates, so restart it after editing `templates/index.html`.

### As a service

`/etc/systemd/system/family-tree.service`:

```ini
[Unit]
Description=Family Tree web app
After=network-online.target
Wants=network-online.target

[Service]
User=youruser
WorkingDirectory=/path/to/family_tree_app
ExecStart=/path/to/family_tree_app/venv/bin/waitress-serve --listen=0.0.0.0:5000 app:app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now family-tree`.

There is no login, so anyone who can reach the port can edit the tree. Keep it on your home network, for example with a firewall rule that only allows your LAN:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 5000 proto tcp
```

## Your data

Everything is stored in one SQLite file, `family_tree.db`. The repo never includes it (see `.gitignore`), because it holds your family's personal details.

To back it up while the app is running, use SQLite's backup command rather than a plain copy:

```bash
sqlite3 family_tree.db ".backup backup-$(date +%F).db"
```

To restore, stop the app, copy a backup over `family_tree.db`, and start it again.

## API

The page uses a small JSON API:

| Method | Path | |
|---|---|---|
| `GET` | `/api/members` | All members |
| `POST` | `/api/members` | Add a member, returns `{"id": …}` |
| `PUT` | `/api/members/<id>` | Replace a member's details |
| `DELETE` | `/api/members/<id>` | Delete a member and clear links to them |

Members have these fields:

| Field | Meaning |
|---|---|
| `name` | Required |
| `gender` | `Male`, `Female` or `Other` |
| `birth_date`, `death_date` | `YYYY-MM-DD` |
| `is_deceased` | `0` or `1` |
| `father_id`, `mother_id`, `spouse_id` | IDs of other members |
| `notes` | Free text |

An invalid save returns HTTP 400 with `{"error": "…"}`.

## Extras

`conky_stats.py` prints member counts for a [Conky](https://github.com/brndnmtthws/conky) desktop widget. Edit the database path at the top before using it.
