# Decisions to review

Judgement calls made while implementing the phases, collected for one review after phase 14. Each entry says what was
decided, the main alternative, and what reversing it involves. The full context is in the "Decided while building"
notes of each phase in [06-implementation-plan.md](06-implementation-plan.md).

## Phase 04: roles and permissions

| Decision | Alternative | To reverse |
|---|---|---|
| A separate `project.delete` permission (Super Admin, Lead) | Deleting is part of `project.configure` (Seniors too) | Change the matrix in `app/core/permissions.py` and doc 04 |
| Self-registered accounts become Viewers with no projects | Trainee, or registration switched off | `identity/router.py` register endpoint |
| The upgrade made existing project-based users and Viewers members of every existing project | Start with no memberships; leads assign | Remove memberships by hand (Admin › Users) |
| Leads cannot take on unassigned people; a Super Admin assigns them | Leads claim unassigned people themselves | `check_role_change` in `app/core/permissions.py` |
| Changing a project's lead needs `project.members.manage` (fixed in phase 06) | `project.configure` was enough | `projects/router.py` update endpoint |

## Phase 05: design system and shell

| Decision | Alternative | To reverse |
|---|---|---|
| The side bar follows the permission matrix: Viewers see Work and Learning, read-only | Doc 05's example: Viewers see only Home, Tests, Reports, Reviews, Deploys | `AREAS` in `src/app/navigation.ts` |
| Seniors see Admin (the user list, read-only) | Admin only for Super Admin and Lead | `SECONDARY_AREAS` permissions |
| Today's screens keep their inner layout; only colours and shared styles changed | Rework every screen now | Done area by area in later phases |
| Fonts are bundled instead of loaded from Google Fonts | Google Fonts | `src/main.tsx`, `index.css` |

## Phase 06: work from Jira and Confluence

| Decision | Alternative | To reverse |
|---|---|---|
| The inbox lists story issue types (names containing "story") by default | All issue types by default | `service.build_jql` |
| Jira REST API v2 first, v3 as fallback | v3 first | `JiraClient._bases` |
| Attachments are listed by name only | Download through ATM with the user's token | New endpoint in `work/router.py` |
| Only "current sprint" as sprint filter | A sprint list from the Jira Agile API | Inbox filters |
| Test suggestions match words of the story title against test file paths | Changed-file analysis or AI suggestions | `service.suggest_test_files` |

## Phase 07: workspace and publish

| Decision | Alternative | To reverse |
|---|---|---|
| The Repository "Structure" view was dropped (the 3-Panel view shows the GitHub tree) | Keep it as a workspace view | Bring back the tree view in `WorkspacePage` |
| The separate Repository Editor was merged into the workspace editor | Keep both | — |
| Hints are on by default; the switch is remembered per browser | Off by default, or a server-side preference now | `WorkspacePage` layout defaults (phase 13 adds the preference) |
| The action bar shows the user's own last run, not the project's | The project's last run | `ActionBar.tsx` |
| Run artifacts are kept out of commits through `.git/info/exclude` | Leave it to each repository's `.gitignore` | `_exclude_from_git` in `testing/runs.py` |

## Phase 08: testing suites

| Decision | Alternative | To reverse |
|---|---|---|
| A suite runs one detected framework target; Bruno collections and Appium runs stay on the Runs screen | Suites for Bruno and Appium too | Extend `start_suite_run` |
| Environments hold plain variables that everyone in the project can see; no secrets | Encrypted secret variables | New column + encryption like `user_connections` |
| GitHub Actions suite runs dispatch the suite's workflow without passing the environment | Pass the environment as a workflow input (fails for workflows that do not declare it) | `run_suite` in `testing/suites_router.py` |
| A schedule runs as the person who set it, in their checkout; it is skipped if they lost the right to run tests | A shared service account / checkout | `testing/scheduler.py` |
| Schedules missed while ATM was not running are not caught up | Run missed schedules at start | `scheduler.run_due_suites` |
| Deleting a suite deletes its runs | Archive suites instead | `delete_suite` |
| "Changed tests" in the run dialog does not apply an environment yet | Pass the environment there too | `ChangedTestsPanel` |
| The UI tests use the sample repository's own pytest test and k6 script, and a k6 stand-in, instead of projects generated from the starter templates | Generate starter projects in the tests (slow: installs dependencies) | `e2e/harness/start-backend.mjs` |

## Phase 09: Allure reporting

| Decision | Alternative | To reverse |
|---|---|---|
| The custom HTML report is retired: without the Allure command line (and Java) a run has no report, only the message "Allure not installed" | Keep the old report as a fallback | Restore `report_template.py` and call it when `allure_binary()` is missing |
| ATM does not install Allure itself yet | Download it like k6 (from Maven Central) | `station_tools_service` |
| Reports are stored centrally under `ARTIFACTS_DIR/reports` and kept forever | A retention period (for example 90 days or the last N runs per suite) | A clean-up job in the scheduler |
| A report link is valid for one hour | Longer, or links that never expire for sharing | `LINK_TTL_SECONDS` in `reports_router.py` |
| Flaky tests = passed in some and failed in others of the suite's last 30 runs | Allure's own flaky marks (retries) | `suite_trends` |

## Phase 10: Confluence reports (open topic T1, suggested default)

| Decision | Alternative | To reverse |
|---|---|---|
| One page per project and suite, under a parent page set per project, updated on each publication | One page per run, or one page per project | `page_title` and `_upsert_page` in `reporting/confluence_publisher.py` |
| Leads and Seniors publish by hand; nothing is published automatically | Publish after each run or nightly | Call `publish_run` from `testing/runs.py` or the scheduler |
| Publishing uses the publisher's own Confluence token | A shared service account | `confluence_connection` in `publish_run` |
| The Allure report is attached as a zip on every publication (Confluence keeps attachment versions) | No attachment, only the link to ATM | `publish_run` |
| The link back to ATM uses `ATM_PUBLIC_URL`, otherwise the browser's address | Always require `ATM_PUBLIC_URL` | `publish` in `reports_router.py` |
| Imported Allure results cannot be published | Publish them too (no suite: page per project) | `PublishPanel.tsx`, `publish` endpoint |

