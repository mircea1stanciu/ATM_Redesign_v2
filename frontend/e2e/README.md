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

`playwright.config.ts` picks two free ports and starts:

1. `harness/start-backend.mjs`: creates a temporary SQLite database (`ATM_DATABASE_PATH`), runs
   `backend/tools/e2e_seed.py`, then starts `backend/main.py`. The database is deleted when the run ends.
2. The Vite dev server, with its `/api` proxy pointed at that backend (`ATM_API_TARGET`).

The seed creates one user per role (`e2e_<role>`, password `E2E_PASSWORD`) and a sample project, and writes the
users' access tokens to `e2e/.auth/sessions.json`.

## Writing tests

- One spec file per phase: `phase_XX_<name>.spec.ts`.
- `login(page, role)` from `helpers.ts` opens the app as that role's user. It uses the seeded token, because the
  login endpoint allows only 5 attempts per minute; only the login tests sign in through the form.
- Select elements by role and label (`getByRole`, `getByLabel`), not by CSS classes.
- Never call real GitHub, Jira, Confluence or AI services.
