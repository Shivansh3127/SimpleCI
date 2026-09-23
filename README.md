# SimpleCI

A minimal self-hosted CI/CD platform. Push a commit to GitHub → SimpleCI runs your pipeline inside a Docker container → see live logs stream in the browser in real time.

Built with **Express + Prisma + PostgreSQL + Dockerode** on the backend and **React + Vite** on the frontend.

---

## Features

- 🔗 **GitHub webhook integration** — triggers automatically on every `git push`
- 🔒 **HMAC-SHA256 signature verification** — every webhook request is cryptographically verified
- 🐳 **Dockerized pipeline execution** — each run gets a clean, isolated `node:20-alpine` container
- 📡 **Live WebSocket log streaming** — watch pipeline output appear in real time in the browser
- 🗄️ **Persistent run history** — all runs and logs stored in PostgreSQL via Prisma ORM
- 🎨 **Dark terminal UI** — GitHub-style dark dashboard with status badges and color-coded logs
- 📋 **`.simpleci.yaml` support** — define custom pipeline steps and branch filters per repo
- 🌿 **Branch filtering** — only trigger CI on branches you configure (e.g. `main`, `develop`)
- ↩ **Re-run button** — retry any failed pipeline from the UI without pushing an empty commit
- 🛡️ **Stuck-run recovery** — RUNNING runs left by a server crash are auto-marked FAILED on restart

---

## Architecture

```
git push
   │
   ▼
GitHub (computes HMAC-SHA256 signature)
   │  POST /webhook/github
   ▼
ngrok tunnel → localhost:3000
   │
   ▼
Express (apps/backend/src/server.ts)
   │
   ├─ verifyGithubWebhook()  ← HMAC check, 401 if invalid
   ├─ prisma.run.create()    ← DB: status = RUNNING
   ├─ res.status(202)        ← respond to GitHub immediately
   │
   └─ runPipeline() [background, no await]
        │
        ├─ docker.createContainer({ Image: 'node:20-alpine' })
        │    Cmd: git clone → npm install → npm test → npm run build
        │    Memory: 512MB  |  CPU: 0.5 cores  |  AutoRemove: true
        │
        ├─ container.logs() stream
        │    → prisma.log.create()   each line saved to DB
        │    → broadcastLog(wss)     each line sent to WebSocket
        │
        └─ container.wait() → exitCode
             → prisma.run.update({ status: SUCCESS | FAILED })

WebSocket (ws://localhost:3000, shared port with Express)
   │
   ▼
React Frontend (localhost:5173)
   ├─ Dashboard   — polls GET /runs every 5s, shows run list
   └─ RunDetail   — receives live logs via WebSocket, polls status every 3s
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20 + TypeScript |
| HTTP framework | Express |
| WebSocket | `ws` library (shared port with Express) |
| ORM | Prisma |
| Database | PostgreSQL 16 (Docker) |
| Container execution | Dockerode (Docker Engine API) |
| Frontend | React 18 + Vite + TypeScript |
| Routing | React Router v6 |
| Fonts | Inter + JetBrains Mono (Google Fonts) |
| Public tunnel | ngrok |

---

## Project Structure

```
SimpleCI/
├── docker-compose.yml          PostgreSQL container
├── .simpleci.yaml              Example pipeline config
├── .gitignore
└── apps/
    ├── backend/
    │   ├── prisma/
    │   │   ├── schema.prisma   DB models (Run, Log)
    │   │   └── migrations/     SQL migration files
    │   └── src/
    │       ├── server.ts       Entry point — Express + WebSocket setup
    │       ├── db/
    │       │   └── prisma.ts   Singleton PrismaClient
    │       ├── lib/
    │       │   └── verifyWebhook.ts  HMAC-SHA256 verification
    │       ├── routes/
    │       │   ├── webhook.ts  POST /webhook/github
    │       │   └── runs.ts     GET /runs, GET /runs/:id, POST /runs/:id/retry
    │       └── services/
    │           ├── dockerRunner.ts   Docker container + log streaming
    │           └── pipelineParser.ts .simpleci.yaml parser
    └── frontend/
        └── src/
            ├── App.tsx         Routes: / and /runs/:id
            ├── main.tsx        React entry point
            ├── types.ts        TypeScript interfaces
            ├── index.css       Design system (dark theme)
            ├── components/
            │   ├── StatusBadge.tsx   RUNNING / SUCCESS / FAILED badge
            │   └── Terminal.tsx      Live log terminal with auto-scroll
            └── pages/
                ├── Dashboard.tsx     Run list, auto-refreshes every 5s
                └── RunDetail.tsx     Live logs + status polling
```

---

## Local Setup

### Prerequisites

- **Node.js** ≥ 18
- **Docker Desktop** (must be running)
- A GitHub repo with a webhook configured (see below)
- **ngrok** for the public tunnel

### 1. Install dependencies

```bash
# Backend
cd apps/backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment variables

```bash
cd apps/backend
cp .env.example .env   # if .env.example exists, otherwise create .env
```

Fill in `apps/backend/.env`:

```env
DATABASE_URL="postgresql://simpleci:simpleci_secret@localhost:5432/simpleci_db"
PORT=3000
GITHUB_WEBHOOK_SECRET="your-secret-here"
```

### 3. Start PostgreSQL

```bash
# From the project root
docker compose up -d
```

### 4. Apply the database schema

```bash
cd apps/backend
npx prisma migrate dev --name init
```

### 5. Start the backend

```bash
cd apps/backend
npm run dev
# → http://localhost:3000
```

### 6. Start the frontend

```bash
cd apps/frontend
npm run dev
# → http://localhost:5173
```

### 7. Start ngrok

```bash
ngrok http 3000
# Copy the https://xxxx.ngrok-free.app URL
```

### 8. Configure your GitHub webhook

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. Payload URL: `https://xxxx.ngrok-free.app/webhook/github`
3. Content type: `application/json`
4. Secret: the value of `GITHUB_WEBHOOK_SECRET` in your `.env`
5. Events: **Just the push event**
6. Save

Now push a commit — the pipeline will trigger automatically.

---

## Pipeline Config (`.simpleci.yaml`)

Put this file in the **root of the repo you want SimpleCI to test** (not the SimpleCI repo itself).

```yaml
pipeline:
  name: my-app

  # Optional: only trigger CI on these branches.
  # Remove the 'branches' key entirely to run CI on ALL branches.
  branches:
    - main
    - develop

  steps:
    - name: Install Dependencies
      run: npm install

    - name: Run Tests
      run: npm test

    - name: Build
      run: npm run build
```

**How it works:**
- When a push event arrives, SimpleCI does a shallow `git clone` of the repo
- It reads `.simpleci.yaml` from the cloned repo
- If a `branches` list is defined, pushes to other branches are silently ignored
- If no `.simpleci.yaml` is found, it falls back to the default steps above
- Steps are chained with `&&` — if any step fails, the pipeline stops and the run is marked **FAILED**

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/webhook/github` | GitHub push webhook receiver |
| `GET` | `/runs` | List all pipeline runs (no logs) |
| `GET` | `/runs/:id` | Single run with full log history |
| `POST` | `/runs/:id/retry` | Re-run a pipeline using the same repo + commit |

### WebSocket

Connect to `ws://localhost:3000`. Messages are broadcast to all clients:

```json
{ "runId": "550e8400-...", "line": "npm install complete" }
```

Filter by `runId` on the client side to show logs for a specific run.

---

## Database Schema

```
Run
  id          UUID (primary key)
  repoName    string
  repoUrl     string
  branch      string
  commitSha   string (7-char short SHA)
  commitMsg   string
  status      string  RUNNING | SUCCESS | FAILED
  startedAt   datetime (auto)
  finishedAt  datetime (null until complete)
  logs        Log[]   (cascade delete)

Log
  id          int (autoincrement)
  runId       UUID (foreign key → Run)
  line        string
  createdAt   datetime (auto)
```

---

## Security

- All webhook requests are verified with **HMAC-SHA256** before any processing
- `crypto.timingSafeEqual` is used for signature comparison to prevent timing attacks
- The raw request body (not parsed JSON) is used for HMAC — ensures byte-exact verification
- `.env` is excluded from version control via `.gitignore`

---

## Known Limitations

- No authentication on the dashboard — anyone with the URL can see all runs
- No concurrency limit — simultaneous pushes create simultaneous Docker containers
- The retry endpoint (`POST /runs/:id/retry`) uses default steps rather than re-reading `.simpleci.yaml` (next improvement)
- No build caching — `npm install` re-downloads all packages on every run

---

## License

MIT
