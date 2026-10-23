# 7. Delivery workflow

## 7.1 Branches

- **Name.** One branch per phase: `feature/phase_XX_featurename`. `XX` is the two-digit phase number, and
  `featurename` is short, lower case, with underscores.
  - Example: `feature/phase_04_roles_permissions`.
- **Base.** Branched from the latest `origin/main` of `mircea1stanciu/ATM-Redesign`.
- **History.** One or more commits per phase. Commit messages say what changed and why.
- **Merging.** The product owner merges every PR. Nothing is merged by the implementer.

## 7.2 Steps of a phase

1. **Branch.** `git fetch origin && git checkout -b feature/phase_XX_name origin/main`.
2. **Build** the phase as described in [06-implementation-plan.md](06-implementation-plan.md).
3. **Write the UI tests** for what the phase delivers, in `frontend/e2e/phase_XX_*.spec.ts`. They are written next to
   the code, not afterwards.
4. **Run all checks locally.** Every check must pass:
   - backend: `ruff check .`, `mypy app`, `pytest`;
   - frontend: `npm run lint`, `npm run build`;
   - UI tests: `npm run e2e`, the full suite, not only the new tests.
5. **Rebase** on the latest `origin/main` and run step 4 again if anything changed.
6. **Push and open a PR** to `main`. The PR description lists:
   - what was built;
   - the UI tests added, with their results;
   - screenshots of the new screens;
   - migrations;
   - anything left for later.
7. **Wait** for review and merge by the product owner. Review comments are fixed on the same branch.

If a check fails, the PR is not opened. The failure is fixed first, or reported to the product owner if it needs a
decision.

## 7.3 UI tests

| Item | Choice |
|---|---|
| Tool | Playwright, in `frontend/e2e/`, with the Chromium browser already installed on the station (Playwright 1.64) |
| Application under test | The real frontend (Vite) and the real backend, started by the test harness on free ports |
| Data | A fresh SQLite database per test run, created by the migrations and seeded with one user per role and a sample project (a small git repository with a Bruno and a Playwright test) |
| External systems | GitHub, Jira, Confluence and AI providers are replaced by a small fake HTTP server in the harness, so tests never touch real services or real credentials |
| Structure | One spec file per phase plus shared helpers (`login(page, role)`, `seed`). Selectors use roles and labels (`getByRole`, `getByLabel`), not CSS classes |
| Evidence | HTML report, screenshots on failure, traces on retry |
| CI | A `ui-tests` job runs the whole suite on every PR |

## 7.4 Definition of done (every phase)

- [ ] The phase goal from the plan works in the app.
- [ ] Permissions are enforced in the backend for new endpoints and reflected in the UI.
- [ ] Database changes are Alembic revisions that run on a copy of today's database without data loss.
- [ ] Backend and frontend checks pass; the full UI suite passes.
- [ ] No secrets in code, logs or responses.
- [ ] The docs in `docs/redesign/` are updated if the plan changed.
- [ ] The PR is open, conflict-free with `main`, and waiting for the product owner.
