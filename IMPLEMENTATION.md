# TestManager — Plan de Implementare

> **Ultima actualizare:** 2026-05-01  
> **Status general:** ✅ Faza 5 Completă

---

## Arhitectură

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (SPA)                       │
│        React + TypeScript + TailwindCSS + Recharts       │
└───────────────────────┬─────────────────────────────────┘
                        │ REST / WebSocket
┌───────────────────────▼─────────────────────────────────┐
│                   Backend API (FastAPI)                  │
│     Auth │ Test Runner │ Scheduler │ Reports │ MCP       │
└────┬──────────────┬────────────────┬────────────────────┘
     │              │                │
┌────▼───┐   ┌──────▼──────┐  ┌─────▼──────┐
│Postgres│   │Celery+Redis │  │ MCP Client │
│        │   │(job queue)  │  │→ GitHub/   │
│        │   │             │  │  GitLab    │
└────────┘   └─────────────┘  └────────────┘
```

---

## Stack Tehnologic

| Layer      | Tehnologie                  | Status     |
|------------|-----------------------------|------------|
| Frontend   | React 18 + TypeScript       | ⬜ Nepornit |
| UI         | TailwindCSS + shadcn/ui     | ⬜ Nepornit |
| Grafice    | Recharts                    | ⬜ Nepornit |
| Backend    | FastAPI (Python 3.12)       | ⬜ Nepornit |
| Queue      | Celery + Redis              | ⬜ Nepornit |
| DB         | PostgreSQL + SQLAlchemy     | ⬜ Nepornit |
| Containere | Docker + Docker SDK         | ⬜ Nepornit |
| Auth       | JWT (python-jose)           | ⬜ Nepornit |
| MCP        | GitHub MCP Server           | ⬜ Nepornit |

---

## Faze de Implementare

---

### ✅ FAZA 0 — Setup Proiect Local
> Obiectiv: Structură monorepo, fișiere de configurare de bază.

| # | Task | Status | Note |
|---|------|--------|------|
| 0.1 | Creare structură foldere monorepo | ✅ Done | `backend/`, `frontend/` |
| 0.2 | Creare `IMPLEMENTATION.md` | ✅ Done | Acest fișier |
| 0.3 | Inițializare backend FastAPI (pyproject.toml, venv) | ✅ Done | |
| 0.4 | Inițializare frontend React + TypeScript (Vite) | ✅ Done | |
| 0.5 | Creare `docker-compose.yml` (Postgres + Redis) | ✅ Done | |
| 0.6 | Creare `.gitignore` | ✅ Done | |
| 0.7 | Inițializare repository Git local | ✅ Done | |

---

### 🟡 FAZA 1 — Fundație Backend
> Obiectiv: API funcțional cu autentificare, modele DB și conexiune GIT via MCP.

| # | Task | Status | Note |
|---|------|--------|------|
| 1.1 | Configurare SQLAlchemy + Alembic (migrații) | ✅ Done | Initial migration created |
| 1.2 | Modele DB: `User`, `Project`, `TestSuite`, `TestRun`, `TestResult` | ✅ Done | All models implemented |
| 1.3 | Endpoint autentificare JWT (`/auth/login`, `/auth/refresh`) | ✅ Done | Login, register, refresh endpoints |
| 1.4 | CRUD Proiecte (conectare repo GIT) | ✅ Done | Create, read, update, delete endpoints |
| 1.5 | Integrare MCP Client → GitHub (clone/pull/list repos) | ✅ Done | GitHub service with URL parsing |
| 1.6 | Endpoint listare branch-uri / tag-uri repo | ✅ Done | GET `/projects/{id}/branches`, `/projects/{id}/tags` |
| 1.7 | Scriere teste unitare pentru API | ✅ Done | Service tests and API structure tests |

---

### ⬜ FAZA 2 — Test Runner Engine
> Obiectiv: Execuție teste în Docker, captură rezultate, streaming log-uri.

| # | Task | Status | Note |
|---|------|--------|------|
| 2.1 | Docker SDK — creare container efemer per run | ✅ Done | Async Docker runner implemented |
| 2.2 | Detectare automată framework (pytest / Playwright / Cypress / JUnit / Robot) | ✅ Done | FrameworkDetector with file/content analysis |
| 2.3 | Execuție și captură output (stdout/stderr) | ✅ Done | DockerTestRunner with timeout support |
| 2.4 | Parsare rezultate JUnit XML → TestResult DB | ✅ Done | JunitParser with full test metadata |
| 2.5 | WebSocket streaming log-uri live către frontend | ✅ Done | ConnectionManager + WS endpoint /runs/ws/{run_id} |
| 2.6 | Stocare artefacte (HTML report, XML) | ✅ Done | TestRunEnvironment with artifact management |
| 2.7 | Celery task pentru runs asincrone | ✅ Done | Celery tasks with retry/monitoring |

---

### ⬜ FAZA 3 — Frontend & Management
> Obiectiv: Dashboard, vizualizare runs, configurare proiecte.

| # | Task | Status | Note |
|---|------|--------|------|
| 3.1 | Setup Vite + TailwindCSS + shadcn/ui | ✅ Partial | Vite + Tailwind complet; shadcn/ui neintegrat |
| 3.2 | Pagina Login + gestionare token JWT | ✅ Done | Login/Register + token storage in localStorage |
| 3.3 | Dashboard overview (stats sumare) | ✅ Done | Dashboard operational pentru proiect/suite/run |
| 3.4 | Pagina Proiecte (CRUD + conectare repo) | ✅ Done | Create + list + select project |
| 3.5 | Pagina Test Runs (listă, filtru, detalii) | ✅ Done | List runs + create run + execute run |
| 3.6 | Vizualizare live log-uri (WebSocket) | ✅ Done | WebSocket hook si panel live logs |
| 3.7 | Detalii test case (passed/failed/skipped + stack trace) | ✅ Done | Panou detalii pe run selectat + expand stack trace |
| 3.8 | Configurare Scheduler (cron jobs per suite) | ✅ Done | Editare cron_expression + active per suite in dashboard |

---

### ⬜ FAZA 4 — Raportare Avansată
> Obiectiv: Grafice trend, identificare teste flaky, export rapoarte.

| # | Task | Status | Note |
|---|------|--------|------|
| 4.1 | Grafic pass rate % pe perioadă (Recharts) | ✅ Done | Trend pass rate per run in dashboard |
| 4.2 | Grafic durată medie execuție | ✅ Done | Trend durată execuție per run (sec) |
| 4.3 | Top N teste flaky (eșuează intermitent) | ✅ Done | Agregare din run details recente (passed + failed/error) |
| 4.4 | Comparație runs (diff rezultate) | ✅ Done | Selectie Run A/B + diff pe status test-case |
| 4.5 | Export PDF raport | ✅ Done | Export din Test Case Details cu sumar + tabel rezultate |
| 4.6 | Export CSV rezultate | ✅ Done | Export din panoul Test Case Details pentru run-ul selectat |
| 4.7 | Notificări email la eșecuri | ✅ Done | Configurare per proiect + trimitere la run failed/error |
| 4.8 | Notificări Slack (webhook) | ✅ Done | Webhook per proiect + alert la run failed/error |

---

### ⬜ FAZA 5 — CI/CD & Webhooks
> Obiectiv: Triggere automate, badge-uri status, API public.

| # | Task | Status | Note |
|---|------|--------|------|
| 5.1 | Webhook GitHub/GitLab → trigger run automat la push/PR | ✅ Done | `POST /api/v1/webhooks/github/{project_id}` + GitLab; HMAC-SHA256 |
| 5.2 | Badge-uri status (SVG endpoint) | ✅ Done | `GET /api/v1/badge/project/{project_id}` — SVG public |
| 5.3 | API public documentat (Swagger/OpenAPI) | ✅ Done | FastAPI auto-docs + tags + descrieri la `/docs` și `/redoc` |
| 5.4 | GitHub Actions workflow pentru CI | ✅ Done | `.github/workflows/ci.yml` — backend pytest + frontend build |
| 5.5 | Docker Compose pentru deploy producție | ✅ Done | Postgres, Redis, backend, worker, beat, frontend (nginx) |

---

## Schema Bază de Date

```sql
projects     → id, name, git_repo_url, git_provider, framework, config_json, created_at
test_suites  → id, project_id, name, tags, cron_expression
test_runs    → id, suite_id, status, branch, commit_sha, started_at, finished_at, triggered_by
test_results → id, run_id, test_name, class_name, status, duration_ms, error_message, stack_trace
artifacts    → id, run_id, file_path, file_type (log/html/xml), created_at
schedules    → id, suite_id, cron_expression, active, last_run_at
users        → id, email, hashed_password, role (admin/developer/viewer), created_at
```

---

## Structură Proiect

```
testmanager/
├── IMPLEMENTATION.md         ← acest fișier
├── docker-compose.yml        ← Postgres + Redis + (opțional) backend
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── app/
│   │   ├── main.py
│   │   ├── core/             ← config, security, settings
│   │   ├── api/v1/endpoints/ ← routes
│   │   ├── db/               ← session, base
│   │   ├── models/           ← SQLAlchemy models
│   │   ├── schemas/          ← Pydantic schemas
│   │   ├── services/         ← business logic
│   │   └── workers/          ← Celery tasks
│   └── tests/
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    └── src/
        ├── components/
        │   ├── ui/
        │   ├── charts/
        │   └── layout/
        ├── pages/
        ├── hooks/
        ├── services/         ← API calls
        ├── store/            ← Zustand state
        └── types/
```

---

## Note & Decizii Tehnice

- **Docker izolat per run** → securitate (fără acces la host), resurse limitate (CPU/RAM)
- **JWT cu refresh token** → stateless, scalabil
- **Celery + Redis** → runs asincrone, nu blochează API-ul
- **Alembic** → migrații DB versionare
- **Pydantic v2** → validare strictă input/output API
- **Secrets** → doar în `.env` (niciodată în cod sau git)
