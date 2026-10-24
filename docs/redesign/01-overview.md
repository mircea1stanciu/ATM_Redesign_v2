# 1. Overview

## Why a redesign

ATM grew from several earlier products. A survey of the code (October 2026, see
[02-current-architecture.md](02-current-architecture.md)) shows:

- **Two backends.** Today's app runs on the original backend (`backend/main.py`). A second, unfinished backend
  (`backend/app/main.py`) holds about 45 of the features the frontend calls. On the running app those calls return
  *Not Found*. This is why Community, Tasks, Epics, Zephyr, Publish/PR and running scripts do not work.
- **Features unrelated to testing.** Office desk and parking booking, billing and subscriptions, several
  organizations in one install, direct messaging, and the "UnifiedWork" chat agents.
- **About 40% of the frontend code is never loaded.** That is 43 files (22,000 lines), including a whole leftover
  Next.js app.
- **Five places are mock or stub only.** Billing, data export, webhooks, privacy and security sessions have screens,
  but nothing real behind them.
- **Eight roles that overlap.** Two different role lists exist (one per backend), and the browser restricts only one
  page by role.
- **No frontend tests.** The two old browser-test folders target ports and screens that no longer exist.

The useful parts are strong and stay:
- the AI-assisted workspace;
- local test runs for about 20 frameworks;
- the Bruno and Appium runners;
- GitHub and GitHub Enterprise access;
- the Jira and Confluence connections;
- the Upskilling content.

The redesign keeps these, removes the rest, and builds the missing workflows around two kinds of users.

## Who uses ATM

| Persona | Daily goal in ATM |
|---|---|
| **Automation tester** (Senior or User) | Turn Jira stories, technical stories and Confluence requirements into new or changed automated tests, run them, report the results, and react when a new version is deployed |
| **Senior automation tester** | Everything above, plus review open pull requests of the team's GitHub projects and mentor trainees |
| **Manual tester moving to automation** (Trainee) | Learn step by step, with built-in hints and, if connected, the AI assistant, until the lead decides they are ready |
| **Automation lead** | Organise people and projects, follow progress, decide when a trainee or user takes on more responsibility |
| **Super admin** | Install-wide settings, users and integrations |
| **Viewer** | Read results and reports |

## What the product must do

### Goal 1: daily tool for skilled automation testers

1. **Work from requirements.**
   - Open a Jira user story or technical story, or a Confluence requirements page.
   - Read the description, acceptance criteria and linked items.
   - Decide which tests to add or change.
2. **Implement with or without AI.**
   - Do the work in the built-in workspace (editor, branch, diff review).
   - Optionally use the AI assistant, which receives the story or page as context.
   - Without an AI connection, everything works manually.
3. **All kinds of testing.** Functional, regression, smoke, API, UI, mobile and performance runs. The project's own
   frameworks run locally or in GitHub Actions, tests are grouped into suites, and suites can run on a schedule.
4. **One common report.**
   - Every run produces an Allure report, whatever the framework.
   - Reports keep history and trends.
   - Reports can be published to Confluence. *How the upload works will be discussed later.*
5. **Deployment notifications.** ATM tells the testers of a project when a new backend service version or frontend
   build is deployed to a test environment, so they can check it. *Environment checks will be discussed later.*
6. **Code review.**
   - Senior testers see the open pull requests of the loaded GitHub projects.
   - They review diffs and comment, approve or request changes, and see the test results of the PR.
   - The AI assistant can help with the review.

### Goal 2: grow manual testers into senior automation testers

1. **Guided learning paths.** Lessons and practice tasks, with progress saved per user and visible to the lead.
2. **Help while working.**
   - Standard hints appear in the workspace and the test runner. For example: "this test has no assertion" or "how
     to select an element".
   - The AI assistant works as a tutor when connected.
3. **Real work, safely.** Trainees work on real stories on their own branches. A senior or lead reviews their PRs.
4. **Readiness decided by the lead.**
   - ATM shows each trainee's progress: lessons, practice tasks, reviewed PRs, test runs.
   - The automation lead decides when a person moves up (Trainee → User → Senior) and changes their role.

## Decisions already made

| Topic | Decision |
|---|---|
| Backend | Keep the backend in use today (`backend/main.py`, SQLite). Move the features it needs from the unfinished second backend into it as clean modules, then delete the second backend and its duplicate data model |
| Database | SQLite for local, per-station use. Schema changes go through Alembic so that Postgres is a configuration change later |
| Unrelated features | Remove: office booking, billing and subscriptions, multi-organization tenancy, the UnifiedWork chat agents, direct messaging, the mock privacy and data-export settings. Git history keeps them |
| Roles | Keep Super Admin, Automation Lead, Viewer. Add Automation Senior, Automation User, Automation Trainee. Remove admin, org_admin, community_lead, user, developer. See [04-roles-and-permissions.md](04-roles-and-permissions.md) |
| Role tags | Every Senior, User and Trainee has one tag. `project_base`: works only on the projects they are assigned to. `shared`: works across all projects |
| Delivery | One branch per phase, named `feature/phase_XX_featurename`. Each phase ends with UI tests and a PR that the product owner merges. See [07-delivery-workflow.md](07-delivery-workflow.md) |

## Open topics

The product owner will decide these later. The plan leaves room for them without blocking other work.

| # | Topic | What is needed | Planned in |
|---|---|---|---|
| T1 | Uploading Allure reports to Confluence | Page structure, who publishes, when (manual, after each run, nightly), which space | Phase 10 (built with the suggested default, see [decisions-to-review.md](decisions-to-review.md)) |
| T2 | Testing-environment checks after a deployment | Which checks (health, smoke suite, version check), where deployments are detected (CI/CD webhook, release pages, service endpoints) | Phase 11 (built with the suggested default, see [decisions-to-review.md](decisions-to-review.md)) |
| T3 | Notification channels beyond the app | Email, Microsoft Teams, both | Phase 11 (built with the suggested default, see [decisions-to-review.md](decisions-to-review.md)) |
| T4 | Trainee readiness criteria | Which numbers the lead wants to see before a promotion | Phase 14 (built with the suggested default, see [decisions-to-review.md](decisions-to-review.md)) |
| T5 | Shared team server or one install per station | Decides when Postgres and real HTTPS sign-in callbacks are needed | After phase 14 |
