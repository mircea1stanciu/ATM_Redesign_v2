# Decisions to review

All 14 phases are built. These are the judgement calls made while implementing them, collected for one review.
Each entry says what was decided, the main alternative, and what reversing it involves. The full context is in the
"Decided while building" notes of each phase in [06-implementation-plan.md](06-implementation-plan.md).

**Reviewed on 2026-10-24.** The changes asked for in that review are planned as phases 15–22 in
[08-review-updates-plan.md](08-review-updates-plan.md); decisions not mentioned there are kept. New phases add their
own judgement calls at the end of this file.

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

## Phase 11: deployments and notifications (open topics T2 and T3, suggested defaults)

| Decision | Alternative | To reverse |
|---|---|---|
| Deployments arrive through a signed CI/CD webhook, one secret per service | Poll release pages or service endpoints; one secret per team | `deployments/service.py` (`verify`), `router.py` |
| After a deployment, ATM runs each project's chosen smoke suite on the environment with the same name | Health or version checks; no automatic check | `start_checks` in `deployments/service.py` |
| The check runs as a tester the lead picks, in that tester's checkout | A shared service account and checkout | `ServiceProject.check_user_id`, `_check_user` |
| A deployment to an environment the project does not have is "skipped", not run against another environment | Run on the suite's default environment | `start_checks` |
| Notified: members and lead of the projects that test the service (Lead, Senior, User, Trainee); not Viewers or shared-scope Seniors who are not members | Everyone who can see the project | `project_testers` in `notifications/service.py` |
| Every kind is on by default; users mute kinds and projects | Opt in per kind | `NotificationSubscription`, `wants` |
| Finished runs notify the person who started them (also scheduled runs: the schedule's owner) | Only failed runs, or none | `_notify_starter` |
| Review requests (a PR opened from ATM) go to the project's Seniors and lead and the author's lead | Reviewers chosen on GitHub | `reviewers` in `notifications/service.py` (phase 12 builds the Reviews area) |
| Teams: one channel per project through a Teams workflow webhook, deployments and checks only; no e-mail | E-mail; personal Teams messages through a bot | `notifications/teams.py`, `Project.teams_webhook` |
| Setting a project's Teams channel needs `deployment.configure` (Super Admin, Lead) | `project.configure` (Seniors too) | `update_project` in `projects/router.py` |
| An unknown service answers 401 like a bad signature | 404 "unknown service" (easier to set up, reveals names) | `verify` |

## Phase 12: code review

| Decision | Alternative | To reverse |
|---|---|---|
| Pull requests are read live from GitHub with each person's own token (Viewers need one too) | A shared read token or a cached copy in ATM | `reviews/github.py` (`repo_for`) |
| "Waiting for me" = requested reviewer on GitHub, or a reviewer in ATM of a PR opened from ATM that I have not reviewed | Only GitHub's requested reviewers | `_waiting` in `reviews/router.py` |
| The diff is drawn from GitHub's patch, not with the workspace's CodeMirror merge view | Fetch both file versions and use the merge view with a comment gutter | `PatchView.tsx` |
| Line comments are pending until the review is submitted (one GitHub review) | Post each comment at once | `PullRequestPage.tsx`, `submit_review` |
| Users and Trainees may write line comments and "Comment" reviews | Conversation comments only | `submit_review` (event COMMENT needs `pr.comment`) |
| AI review returns at most 10 line comments; off-diff ones are dropped; the reviewer picks | Post AI comments directly; a summary instead of line comments | `ai_review`, `MAX_AI_SUGGESTIONS` |
| Only authors of PRs opened from ATM are notified of reviews | Map GitHub logins to ATM users for all PRs | `_notify_author` |

## Phase 13: learning paths

| Decision | Alternative | To reverse |
|---|---|---|
| **Community is removed** (page, components, API, router); its `forum_*` tables are kept | Keep it as a Q&A tab in Learning | Restore `CommunityPage.tsx`, `components/community/`, `community_router.py`, `schemas.py` from git history; or drop the tables in a migration |
| Lessons and quizzes stay in the frontend code; the server stores progress by id | Content in the database, edited in the app | `features/learning/content.ts`, `paths.ts` |
| Eight fixed paths built from the 15 programs | Leads build paths in the app | `PATHS` in `features/learning/paths.ts` |
| Quizzes are graded in the browser; a quiz passes from 7 of 10 | Server-side grading (questions without answers sent to the browser) | `record_quiz`, `QUIZ_PASS_MARK` |
| Practice is handed in as a branch or pull request link, reviewed in ATM by a mentor | Practice as a pull request reviewed in Reviews | `submit_practice`, `review_practice` |
| A lead mentors their assigned people; a senior the learners of their projects | Only leads mentor | `mentees` in `learning/service.py` |
| Tutor mode is on by default for Trainees (workspace assistant guides instead of writing files) | Off by default | `tutor_mode` in `learning/service.py` |
| Hints live in the database and are edited by leads; detection rules stay in the frontend | Rules in the database too | `hints` table, `features/workspace/hints.ts` |
| Viewers read lessons but do not hand in practice | Viewers practise too | `submit_practice` (`code.edit`) |

## Phase 14: readiness and promotion (open topic T4, suggested default)

| Decision | Alternative | To reverse |
|---|---|---|
| The lead sees evidence only (path progress, lessons, quizzes, practice, work items, PRs approved, runs); no thresholds or score | Criteria with minimums ("ready" when met) | `evidence` in `learning/readiness_router.py`, `ReadinessPage.tsx` |
| "PRs merged after review" is counted as PRs opened from ATM and approved in an ATM review | Ask GitHub which were merged | `evidence` (pull requests) |
| Trainees and Users request a review themselves; mentors may request it for them | Only the lead starts a review | `request_review` |
| A decision needs a note; "Not yet" is recorded and told like a promotion | Note optional; "not yet" without a record | `decide` |
| A promotion keeps the person's scope tag (project_base stays project_base) | Ask for the tag when promoting | `decide` (scope_tag) |
| The audit log covers promotions, readiness decisions, role changes, report publications and deployment webhooks | Also logins, settings, deletions | `app/modules/audit/service.py` callers |
| A lead sees audit entries they made, about their people, or in their projects; webhook calls only super admins | Leads see everything | `list_audit` in `modules/audit/router.py` |

## Phase 15: access and roles (from the review)

| Decision | Alternative | To reverse |
|---|---|---|
| People lists show yourself and the roles below yours; peers (another Lead) are not shown | Show peers too | `can_see_user` in `app/core/permissions.py` |
| The no-project banner shows for everyone who has no project and cannot create one | Only for Viewers | `NoProjectBanner.tsx` |
| Only the upgrade's automatic memberships are removed; memberships given by a lead stay | Remove every membership of project-based users and Viewers | `0012_no_automatic_memberships.py` |

## Phase 16: work filters and workspace (from the review)

| Decision | Alternative | To reverse |
|---|---|---|
| Saved filters belong to a user and a project | One list per user for every project | `SavedFilter`, `saved-filters` endpoints in `work/router.py` |
| The advanced JQL clause is ANDed with the other filters, inside the project | Free JQL replacing everything | `build_jql` in `work/service.py` |
| The sprint list shows active, future and the last five closed sprints of up to three boards | Every sprint | `jira_sprints`, `CLOSED_SPRINTS_SHOWN` |
| The workspace tab is called "Repository" | "Explorer", "Code" | `WorkspacePage.tsx` |

## Phase 17: suites and environments (from the review)

| Decision | Alternative | To reverse |
|---|---|---|
| Secret values are masked in the streamed run log but not in the raw `process.log` file in the checkout | Rewrite or delete the raw file too | `secrets.mask`, `_ManualRunLogger` in `testing/runs.py` |
| Only archived suites can be deleted permanently | Leads delete active suites directly | `delete_suite` in `testing/suites_router.py` |
| Archived suites are skipped by schedules and deployment checks (the check says why) | Archiving also removes the schedule | `scheduler.run_due_suites`, `start_checks` |
| "Changed tests" applies the project environment to framework targets; Bruno requests keep their Bruno environment | Map the project environment to a Bruno environment | `ChangedTestsPanel.tsx` |

## Phase 18: service account for scheduled runs (from the review)

| Decision | Alternative | To reverse |
|---|---|---|
| Scheduled runs with a service account always use the latest default branch | The branch the owner had checked out | `service_account.sync` |
| Nobody is notified when a service account run finishes | Notify the schedule's owner | `_notify_starter` in `deployments/service.py` (set `started_by_id` to the owner) |
| Deployment checks keep running as the tester the lead picked | Use the service account for checks too | `start_checks` in `deployments/service.py` |
| Only a token that can clone the repository is saved | Save it and report the error later | `set_service_account` |

## Phase 19: reports (from the review)

| Decision | Alternative | To reverse |
|---|---|---|
| One permission (`report.manage`, Lead and Super Admin) for deleting reports, revoking share links and installing Allure | Separate permissions | `PERMISSIONS` in `app/core/permissions.py` |
| Share links are made by those who publish reports (Super Admin, Lead, Senior) | Everyone who sees the report | `create_share_link` (`report.publish`) |
| ATM installs Allure but not Java; the page says what is missing | Download a Java runtime too | `station_tools_service._install_allure` |
| Auto-publish uses the token of whoever switched it on, and stops if they may no longer publish | A shared Confluence service account | `auto_publish.after_run` |
| Deleting a report keeps the run and its results | Delete the run too | `delete_report` |

