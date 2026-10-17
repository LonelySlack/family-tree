# Family Tree

A small self-hosted web app for recording a family and seeing it as a tree. It's built with Flask and SQLite, runs on one machine, and only people you approve can see it.

## Features

**The tree**
- **Custom layout:**
  - couples sit side by side, each spouse on the side nearer their own parents
  - children hang from the couple's midpoint in birth order
  - generations are reordered so lines don't cross
- **More than one marriage per person.** Someone with two wives sits between them, with each wife's children on her side.
- **Photos** shown in the tree, the list and the details panel.
- **View options**, remembered per browser:
  - top-to-bottom or left-to-right
  - compact boxes
  - nicknames, photos and colour by gender, each on or off
- **"This is me":** mark yourself, and the tree opens zoomed in on you.
- **Dark mode.** Follows your device's setting, with a toggle in the toolbar.

**People**
- **Name and nickname** (e.g. a family title like "Pak Long").
- **Gender, birth and death dates**, and birth order ("anak ke-") for siblings whose birth dates aren't known.
- **Parents, any number of spouses, and notes.**
- **Details panel:** facts, generation, parents, spouses, siblings (half-siblings marked) and children, all clickable. There are also shortcuts to add a child or spouse already linked.
- **Checks when saving:**
  - name is required
  - a death date can't be before the birth date
  - a death date marks the person as deceased
  - nobody can be their own parent

**How are we related?**
- Pick any two people. The answer comes in English and Malay, with the chain of people connecting them:
  - parent, grandparent, child, grandchild (bapa, datuk, anak, cucu, cicit)
  - siblings and half-siblings (abang/kakak/adik, sebapa/seibu)
  - uncles, aunts, nephews and nieces (bapa saudara, ibu saudara, anak saudara)
  - cousins, including "removed" ones (sepupu, dua pupu)
  - in-laws (mertua, menantu, ipar, biras, besan)

**Export and import**
- **PNG image of the whole tree,** not just the visible part.
- **Excel export** of everyone.
- **Excel import** in the same format: edit an export, or fill in the blank template. Rows with an ID update that person; rows without one add someone new.
  - Every change is previewed before anything is saved.
  - Nobody is ever deleted.
  - The database is snapshotted first.

**Accounts**
- **Register and log in.** The **first account becomes admin.** Everyone after that waits as *pending* until an admin approves them, so the family's details aren't visible to whoever signs up.
- **Roles:**
  - **viewer** can look
  - **editor** can also add and change people, photos and imports
  - **admin** can also manage accounts
- **Security:**
  - passwords are hashed
  - sessions last up to 30 days
  - failed logins are rate-limited
  - every change must come from the app's own page (no cross-site requests)

It works without internet: Bootstrap and vis-network are stored in `static/vendor`.

## Running it

Needs Python 3.10 or newer.

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/waitress-serve --listen=0.0.0.0:5000 app:app
```

Open `http://<host>:5000` and **register straight away**: the first account becomes admin. On first start, the app creates:
- `family_tree.db`, the database
- `instance/secret_key`, the login session key
- `uploads/`, for photos

All three are created next to `app.py`, and none of them go into git.

For development, `venv/bin/flask --app app run --debug` reloads on changes. Waitress caches page templates, so restart it after editing `templates/`.

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

Then run `sudo systemctl enable --now family-tree`. `GET /healthz` answers `{"ok": true}` without a login, for monitoring.

The app serves plain HTTP, so it's meant for your home network. Restrict the port to your LAN, for example:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 5000 proto tcp
```

To reach it from outside your home, put it behind something that adds HTTPS (a reverse proxy or a tunnel) rather than opening the port.

## Your data

Everything that matters is in three places:
- `family_tree.db`: the people, marriages and accounts
- `uploads/`: the photos
- `instance/secret_key`: the session key; if it's lost, everyone just logs in again

Back up the database while the app is running with SQLite's backup command, rather than a plain copy:

```bash
sqlite3 family_tree.db ".backup backup-$(date +%F).db"
tar -cf photos-$(date +%F).tar uploads
```

Before each Excel import, the app also saves a snapshot to `instance/snapshots/` and keeps the latest 10.

To restore, stop the app, copy the backup over `family_tree.db` (and unpack the photos), and start it again.

## Excel format

The export and the import use the same columns. The import reads these:

| Column | Meaning |
|---|---|
| `ID` | Blank for someone new; keep it to update that person |
| `Name` | Required |
| `Nickname` | Optional |
| `Gender` | `Male`, `Female` or `Other` |
| `Birth date`, `Death date` | `YYYY-MM-DD` or `DD/MM/YYYY` |
| `Status` | `Meninggal Dunia` or `Deceased`, else blank |
| `Birth order` | 1 for the eldest child |
| `Father`, `Mother` | A name from the Name column, or `#ID` |
| `Spouses` | Names or `#ID`s, comma-separated |
| `Notes` | Free text |

`Generation`, `Age` and `Children` are filled in by the export and ignored by the import.

## API

The page uses a JSON API. Every change needs a logged-in session and the header `X-Requested-With: fetch`.

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/api/members` | viewer | Everyone, with `spouse_ids` and `photo_url` |
| `POST` | `/api/members` | editor | Add a person, returns `{"id": …}` |
| `PUT` | `/api/members/<id>` | editor | Replace a person's details, including `spouse_ids` |
| `DELETE` | `/api/members/<id>` | editor | Delete a person and their links |
| `POST`/`DELETE` | `/api/members/<id>/photo` | editor | Upload (`multipart`, field `photo`) or remove a photo |
| `GET` | `/api/export.xlsx` | viewer | Everyone as a spreadsheet |
| `GET` | `/api/import/template.xlsx` | editor | Blank spreadsheet to fill in |
| `POST` | `/api/import/preview`, `/api/import/apply` | editor | Upload a spreadsheet (`multipart`, field `file`) |
| `GET`/`PUT`/`DELETE` | `/api/users[/<id>]` | admin | List accounts, change a role, remove an account |

Person fields:

| Field | Meaning |
|---|---|
| `name` | Required |
| `nickname` | Optional |
| `gender` | `Male`, `Female` or `Other` |
| `birth_date`, `death_date` | `YYYY-MM-DD` |
| `is_deceased` | `0` or `1` |
| `birth_order` | 1 for the eldest |
| `father_id`, `mother_id` | IDs of other people |
| `spouse_ids` | List of IDs |
| `notes` | Free text |

An invalid request returns HTTP 400 with `{"error": "…"}`.

## Extras

`conky_stats.py` prints member counts for a [Conky](https://github.com/brndnmtthws/conky) desktop widget. Edit the database path at the top before using it.
