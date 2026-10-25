# UI tests

Playwright tests that drive the real frontend (Vite) against the real backend. See
[docs/redesign/07-delivery-workflow.md › 7.3](../../docs/redesign/07-delivery-workflow.md#73-ui-tests).

## Run

```bash
cd frontend
npm ci
npm run e2e            # the whole suite
npm run e2e -- --ui    # interactive mode
npm run e2e:report     # open the last HTML report
```

The backend needs Python 3.10 or newer with its dependencies installed (`pip install -e .` in `backend/`).
The harness uses `backend/.venv/bin/python` when it exists; set `ATM_PYTHON` to use another interpreter.

## What the harness does

`playwright.config.ts` picks four free ports and starts:

1. `harness/fake-services.mjs`: stand-ins for GitHub, Jira and Confluence. It serves git over HTTP (through
   `git http-backend`) for the bare repositories in a temporary folder, a small GitHub REST API (repository,
   branches, pull requests), and the Jira and Confluence calls the settings screens make. On its own port
   (`E2E_FAKE_SMTP_PORT`) it is also a mail server that keeps every e-mail. `GET /__e2e/requests` shows what ATM
   sent, so tests can check it.
2. `harness/start-backend.mjs`: creates the sample repository (a bare "GitHub" repository with a README and
   `scripts/hello.sh`, plus a checkout of it), a temporary SQLite database (`ATM_DATABASE_PATH`), runs
   `backend/tools/e2e_seed.py`, then starts `backend/main.py`. Everything is deleted when the run ends.
3. The Vite dev server, with its `/api` proxy (REST and WebSockets) pointed at that backend (`ATM_API_TARGET`).

The seed creates one user per role (`e2e_<role>`, password `E2E_PASSWORD`) and the sample project, and writes the
users' access tokens to `e2e/.auth/sessions.json`. The project points at the fake repository; the super admin and
the automation user have the checkout linked and a GitHub token for it.

## Writing tests

- One spec file per phase: `phase_XX_<name>.spec.ts`.
- `login(page, role)` from `helpers.ts` opens the app as that role's user. It uses the seeded token, because the
  login endpoint allows only 5 attempts per minute; only the login tests sign in through the form.
- Select elements by role and label (`getByRole`, `getByLabel`), not by CSS classes.
- Never call real GitHub, Jira, Confluence or AI services.
- Settings pages load their saved values and put them into the form; wait for the page to finish loading
  (`waitForLoadState('networkidle')`) before typing, or the load can overwrite what was typed.
- Tests run in parallel. Two tests that change the same user's settings can overwrite each other (settings are
  saved as one record); give them different roles.
