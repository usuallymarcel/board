# Board

A self-hosted workspace: markdown notes with pasted images, kanban boards, file sharing, one-time
secret links and a public forum with comments. A FastAPI backend serves a React frontend from one
container, with nothing loaded from a CDN. Accounts come from users-api, the same as Shelf.

## Run

```sh
docker network create proxy   # first time only, on a machine without Traefik
docker compose up -d --build
```

Open `https://board.marcel.co.nz` through Traefik, or `http://127.0.0.1:8081` on the server itself.
No `.env` is needed. `docker compose down` keeps your data. `docker compose down -v` deletes it.

users-api needs no changes. Board joins the `proxy` network and finds it at `http://users-api:8000`.
Set `ADMIN_USERS=yourname` in a `.env` next to the compose file to moderate the forum.

## Organising

Notes, boards and files are all **items**, so they work the same way everywhere.

- **Collections** nest to any depth, with an icon and colour. Drag items or collections onto one in the sidebar, or use Move to. Deleting a collection only ever moves its contents up a level.
- **Right-click, or use the `...` menu** on anything to rename, pin, move, share, duplicate or trash it.
- **Select** in any list to move, pin or trash many at once. Trash has Undo, and items stay restorable for 30 days.
- **Search** with `Ctrl K`, from anywhere except inside the editor, where it inserts a link. It covers notes, boards, cards, files and collections.

## Markdown

Paste or drop an image into any editor and it uploads and appears as `![name](/api/media/...)`. Other
files become links. Checkboxes tick from the preview, and lists continue on Enter. `.md` files you
upload become notes, and any note downloads as `.md`.

Pasted files are readable by anyone holding the URL, which is what lets them appear in forum posts
and shared notes. The URL contains a 128-bit random id. Location data is stripped from pasted JPEG
and WebP photos. Regular uploads stay private, and trashing a pasted file takes its URL down.

Images from other sites are blocked by the content security policy, so a post cannot track its
readers. Upload them instead.

## Sharing

| Thing | How | Who can open it |
| --- | --- | --- |
| Note, board or file | Share link, with optional password, expiry and view limit | Anyone with the link, read-only |
| Secret | Secrets page | Anyone with the link, until views or time run out |
| Forum post | Forum | Everyone. Writing needs an account |

**Secrets are end-to-end encrypted.** The browser encrypts with AES-256-GCM and the key stays in the
part of the URL after `#`, which browsers never send. The server stores ciphertext only and clears it
once the views are used up or the link expires. Because of that the link cannot be shown twice. An
optional passphrase is stretched with PBKDF2 (600,000 rounds) and adds to the key. A wrong one costs no
view, and 10 wrong ones destroy the secret. Opening the page costs nothing either, so a chat app
previewing the link cannot burn it. Encryption needs https or localhost.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `USERS_API_URL` | `http://users-api:8000` | Login backend. Empty means one shared workspace with no login. |
| `AUTH_FAIL_MODE` | `closed` | `closed` or `global`: what happens while users-api is down. |
| `ALLOW_SIGNUP` | `true` | Allow new accounts. |
| `ADMIN_USERS` | empty | Comma separated names who can pin, lock and remove forum content. |
| `MAX_UPLOAD_MB` | `500` | Limit per file. |
| `USER_QUOTA_MB` | `10240` | Storage per user. Trash counts until it is emptied. |
| `BOARD_PORT` | `8081` | Port on the server's loopback. |
| `DATA_DIR` | `/data` | Data location. |
| `CSRF_TRUSTED_ORIGINS` | empty | Extra allowed origins, comma separated. For the Vite dev server. |

## Auth

As in Shelf, the browser only talks to Board, which keeps its own `board_session` cookie and checks it
against users-api. `GET /api/health` on users-api is probed every 15s and must list the
`session-introspection` and `remember-me` capabilities. Tokens are cached for 60s.

| users-api | Visitor | Result |
| --- | --- | --- |
| healthy | no or bad session | login required for private pages |
| healthy | valid session | own items only, every query filtered by user |
| down | anyone | **503 on private data**, public pages keep working |
| not configured | anyone | one shared workspace, no login |

**This differs from Shelf on purpose.** Shelf defaults to `AUTH_FAIL_MODE=global` and shows everything
during an outage. Board holds private notes and files on a public address, so it defaults to `closed`.
Setting `global` gives a separate shared workspace during an outage. It never exposes anyone's own
data, but anyone reaching the site could use that workspace.

The forum, share links and secret links keep working during an outage. Posting does not.

Login is limited to 10 attempts a minute per IP and per name, in process. Secret reveals and share
passwords allow 30 a minute per IP, and forum posts 20 a minute per user.

## Health

`GET /api/healthz` is liveness. `GET /api/readyz` checks the database and reports users-api status. It
stays 200 while users-api is down, because public pages still work.

## Data

Everything is in the `board_data` volume, mounted at `/data`. The container runs as a non-root user.

| Path | Contents |
| --- | --- |
| `board.sqlite3` | Database (WAL mode, with `-wal` and `-shm` files) |
| `files/` | Uploaded files, stored under random names |
| `signing.key` | Signs share-link password grants. Losing it only logs guests out of those links |
| `tmp/` | Uploads in progress, cleared at boot |

Upgrading is automatic: migrations run at container start.

## Backup

Stop the container so the database is consistent, then archive the volume:

```sh
docker compose stop
docker run --rm -v board_board_data:/data -v "$PWD":/backup alpine tar czf /backup/board.tgz -C /data .
docker compose start
```

The volume name is prefixed with the compose project, so check it with `docker volume ls`.

## Development

Backend, on Python 3.12:

```sh
cd backend
python -m venv ~/.venvs/board
~/.venvs/board/bin/pip install -r requirements-dev.txt
~/.venvs/board/bin/pytest
DATA_DIR=./.data ~/.venvs/board/bin/alembic upgrade head
DATA_DIR=./.data USERS_API_URL= CSRF_TRUSTED_ORIGINS=http://localhost:5173 FRONTEND_DIST=../frontend/dist \
  ~/.venvs/board/bin/uvicorn app.main:create_app --factory --reload
```

Frontend, proxying `/api` to port 8000:

```sh
cd frontend
npm ci
npm run dev
npm test
```

Browser tests run the real backend and built frontend against a stand-in users-api:

```sh
npm run build
npx playwright install chromium --only-shell
PYTHON=~/.venvs/board/bin/python npm run test:e2e
```
