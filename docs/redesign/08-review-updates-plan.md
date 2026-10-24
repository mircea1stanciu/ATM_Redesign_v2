# 8. Updates from the decisions review (phases 15–22)

After phase 14 the product owner reviewed [decisions-to-review.md](decisions-to-review.md) (2026-10-24). Each
decision was either kept ("I'm OK with this decision") or changed ("LET'S DO THIS" = build the alternative, often with
an extra request after "but …"). This document turns the 28 changes into eight more phases, delivered exactly like
phases 01–14 ([07-delivery-workflow.md](07-delivery-workflow.md)): one branch `feature/phase_XX_name` per phase from the
latest `main`, UI tests in `frontend/e2e/phase_XX_*.spec.ts`, all checks green, a PR that the product owner merges.

Decisions kept as they are need no work and are not repeated here.

## 8.1 Every requested change and its phase

| # | From | Change requested | Phase |
|---|---|---|---|
| 1 | 04 | Self-registered Viewers with no project see a banner: ask a higher role for access to projects | 15 |
| 2 | 04 | Project-based users and Viewers start with no project memberships; leads assign them | 15 |
| 3 | 04 | Leads take on unassigned people themselves | 15 |
| 4 | 05 | Viewers see only Home, Tests, Reports, Reviews and Deploys | 15 |
| 5 | 05 | Admin only for Super Admin and Lead; people lists follow the role hierarchy | 15 |
| 6 | 06 | The inbox lists all issue types by default, with extended filters saved to the user's account | 16 |
| 7 | 06 | Sprint filter: a list of sprints from the Jira Agile API | 16 |
| 8 | 07 | A better name for the workspace's "3-Panel" tab | 16 |
| 9 | 07 | The workspace action bar shows the project's last run | 16 |
| 10 | 08 | Encrypted secret environment variables | 17 |
| 11 | 08 | Scheduled runs use a shared service account and checkout | 18 |
| 12 | 08 | Suites are archived instead of deleted; only Leads and Super Admins delete permanently | 17 |
| 13 | 08 | "Changed tests" in the run dialog uses the chosen environment | 17 |
| 14 | 09 | ATM installs the Allure command line itself | 19 |
| 15 | 09 | Leads and Super Admins can permanently delete reports | 19 |
| 16 | 09 | Report links that never expire, revocable only by Leads and Super Admins | 19 |
| 17 | 10 | A switch that publishes a suite's reports to Confluence automatically | 19 |
| 18 | 10 | The report zip attached in Confluence is also available in ATM | 19 |
| 19 | 11 | Whoever opens a pull request chooses reviewers (people or teams) from GitHub | 20 |
| 20 | 11 | E-mail and personal Microsoft Teams notifications | 20 |
| 21 | 12 | Line comments are posted at once (not held until the review is submitted) | 20 |
| 22 | 13 | Community comes back, as its own page | 21 |
| 23 | 13 | Leads build learning paths in the app | 21 |
| 24 | 13 | Leads assign Seniors as mentors to Trainees and Users | 21 |
| 25 | 13 | Seniors mentor (the people assigned to them) | 21 |
| 26 | 13 | AI tutor mode on by default for Users too | 21 |
| 27 | 14 | "PRs merged after review" asks GitHub which pull requests were merged | 22 |
| 28 | 14 | Audit log also covers logins, settings changes and deletions; AI usage counts in the readiness evidence | 22 |

## 8.2 The phases

### Phase 15: `feature/phase_15_access_roles`
- **Goal:** access follows the role hierarchy and the leads' choices.
- **Delivers:**
  - Banner for a Viewer (or anyone) with no project: "You don't have access to any project yet. Ask your Automation
    Lead or a Super Admin to add you." (#1)
  - A migration that removes the project memberships the phase 04 upgrade added automatically (those without
    `added_by_user_id`, added at the upgrade); memberships a lead added stay. Leads assign projects in Admin › Users.
    (#2)
  - Leads see the people without a lead in Admin › Users and take them on ("Assign to me"); a Super Admin can still
    assign anyone. (#3)
  - Viewers lose `work.view` and `learning.use`: the side bar shows Home, Tests, Reports, Reviews and Deploys, and the
    Work and Learning routes are closed to them. (#4)
  - `user.view` only for Super Admin and Lead: Admin is no longer shown to Seniors. The user list follows the
    hierarchy: a Super Admin sees everyone; a Lead sees themselves and the people below Lead. (#5)
- **UI tests:** a Viewer sees five areas and the no-project banner; a Senior has no Admin; a Lead does not see Super
  Admins in the user list and takes on an unassigned person.
- **Decided while building phase 15:**
  - The banner shows for anyone without a project who cannot create projects (so not for a Super Admin or Lead on a
    fresh install).
  - Migration `0012` removes the memberships with no `added_by_user_id` whose `added_at` matches a
    `role_migration_log` entry (the phase 04 upgrade). It cannot be undone: leads assign the projects again. Back up the
    database before upgrading a station that has real users.
  - `ROLE_RANK` in `app/core/permissions.py` is the one hierarchy (people lists, promotions). `can_see_user` applies it
    to Admin › Users; leads still edit only their own people.
  - "Assign to me" (`POST /api/users/{id}/claim`) is for Leads; a Super Admin keeps assigning any lead in the edit
    dialog. Taking someone on is audited (`user.claim`).
  - The phase 04, 05 and 06 UI tests follow the new matrix (a Senior has no Admin; a Viewer has no Work or Learning).

### Phase 16: `feature/phase_16_work_filters`
- **Delivers:**
  - Inbox: all issue types by default; an extended filter (issue types, statuses, assignee, labels, sprint, text,
    JQL for advanced users) that can be saved under a name, kept on the user's account, and picked again. (#6)
  - Sprint filter from the Jira Agile API (board sprints: active, future, recently closed). (#7)
  - The "3-Panel" workspace tab is renamed "Repository" (the GitHub tree, the file and the changes side by side). (#8)
  - The action bar shows the project's last run (with who started it). (#9)
- **UI tests:** save a filter, reload, pick it again; choose a sprint from the list; the tab name; the last run of the
  project after another user's run.
- **Decided while building phase 16:**
  - Type, status and label take several values (comma separated in the URL); `type=stories` means the project's story
    types. The quick selects stay for one value; "More filters" chooses several and adds an advanced JQL clause
    (ANDed with the rest; an `ORDER BY` in it is dropped, the inbox keeps its own order).
  - Sprints come from the Agile API of the project's boards (up to three boards): active, future and the last five
    closed. Without Jira Software the list is empty and "Current sprint" still works.
  - Saved filters (`saved_filters`, migration `0013`) belong to one user and one project, since statuses and sprints
    differ per project. Saving under an existing name replaces it; one filter can be the default, applied when the
    inbox opens without filters in the URL.
  - The "3-Panel" tab is now "Repository" (its URL stays `?view=three-panel`, so links keep working).
  - The action bar shows the project's last run and who started it ("by you", "by a schedule", or the person). The
    phase 07 UI test checks the trainee's own run through the API, since another test's run may be the newest.

### Phase 17: `feature/phase_17_suites_environments`
- **Delivers:**
  - Secret environment variables: encrypted at rest, never sent back to the browser (shown as ••••), passed to the
    runner; only people who manage environments set them. (#10)
  - Archive instead of delete: archived suites keep their runs and reports, disappear from lists (a filter shows
    them), and can be restored; permanent deletion only for Leads and Super Admins. (#12)
  - "Changed tests" in the run dialog runs with the chosen environment. (#13)
- **UI tests:** a secret variable reaches the run but never the page; archive and restore a suite; a Senior cannot
  delete permanently, a Lead can; changed tests with an environment.
- **Decided while building phase 17:**
  - Secret variables are one encrypted JSON object per environment (`test_environments.secrets`, migration `0014`,
    the same key as personal tokens). The API returns only their names (`secret_names`); a save sets the secrets it
    names, an empty value removes one, and the others stay. A name is a variable or a secret, not both.
  - The runner gets variables and secrets together. Secret values (of four characters or more) are replaced by `***`
    in the run log as it streams; the raw `process.log` in the user's checkout (kept out of Git) is not rewritten.
  - Archive replaces delete for everyone who manages suites; archived suites keep their runs and reports, are left out
    of the suite list (an "Archived" tab shows them), are skipped by the scheduler and by deployment checks, and do
    not run until restored. Permanent deletion is the new permission `suite.delete` (Super Admin, Lead) and only for
    archived suites.
  - The run dialog's environment applies to "Changed tests" too (framework targets; Bruno requests keep choosing their
    Bruno environment).
  - The UI tests seed a `secrets_tester` with their own checkout, so the spec can change a test file safely.

### Phase 18: `feature/phase_18_service_account`
- **Delivers:** each project can have an ATM service account, set up by a Lead: a GitHub token for the project kept
  encrypted on the project, and a checkout that ATM keeps up to date on the station. Scheduled runs use it (they no
  longer depend on the person who set the schedule); without a service account a schedule keeps running as its
  owner. Runs show "ATM scheduler" as who started them. (#11)
- **UI tests:** a Lead sets up the service account; a schedule runs in the shared checkout after its owner lost access.
- **Decided while building phase 18:**
  - The service account is a GitHub token on the project (`projects.service_github_token`, encrypted, migration
    `0015`), set in Admin › Projects by those with the new permission `project.service_account` (Super Admin, Lead).
    Saving clones the repository first, so only a token that works is kept.
  - Its checkout lives in `ARTIFACTS_DIR/service-checkouts/project-<id>`. Before each scheduled run ATM brings it to the
    latest commit of the default branch (`reset --hard` and `clean -fd`: ignored files such as dependencies and run
    artifacts stay).
  - With a service account, schedules run as ATM: no person started them (`started_by_id` empty, "by a schedule"), so
    nobody gets a "run finished" notification; the owner's access no longer matters. Without one, nothing changes.
  - A failed sync is shown in Admin › Projects ("Last sync failed") and the schedule is skipped that minute.
  - Setting and removing the service account are audited. The ad-hoc "Default Suite" no longer picks an archived suite
    (a phase 17 gap found here).
  - The UI test uses a project of its own, so the other specs' schedules keep running as their owners.

### Phase 19: `feature/phase_19_reports`
- **Delivers:**
  - Station tools: "Install Allure" downloads the Allure command line from Maven Central (like k6); a missing Java is
    reported with how to install it. (#14)
  - Leads and Super Admins can permanently delete a report (and its files). (#15)
  - "Share link": a link that never expires, made by those who publish reports; Leads and Super Admins see all share
    links and revoke them. Hourly links stay for viewing inside ATM. (#16)
  - "Publish automatically" switch per suite: every finished run with a report is published to Confluence with the
    token of the person who switched it on. (#17)
  - "Download report (zip)" in ATM: the same archive that is attached in Confluence. (#18)
- **UI tests:** install Allure (fake download); a permanent link works, is revoked by a Lead, and stops working; an
  automatic publication after a run; the zip download; a Lead deletes a report.

### Phase 20: `feature/phase_20_reviews_notifications`
- **Delivers:**
  - Opening a pull request from ATM: choose reviewers among the repository's collaborators and the organisation's
    teams (from GitHub); they are requested on GitHub, and ATM's own review notifications still go out. (#19)
  - Line comments are posted to GitHub at once, one by one; the review panel sends the summary with Comment, Approve
    or Request changes. AI suggestions are posted when picked. (#21)
  - E-mail notifications (SMTP set by a Super Admin) and personal Teams messages (each user's own Teams workflow
    webhook), chosen per notification kind in /notifications. (#20)
- **UI tests:** reviewers requested on the fake GitHub; a line comment reaches GitHub before the review is submitted;
  an e-mail (fake SMTP) and a personal Teams post for a deployment.

### Phase 21: `feature/phase_21_learning_community`
- **Delivers:**
  - Community is back as its own page in the side bar (questions and answers), restored from phase 12's code with
    the kept `forum_*` tables. (#22)
  - Learning paths are stored in the database, seeded with today's eight; Leads create, rename, reorder and delete
    paths and choose their programs. The lessons themselves stay in the code. (#23)
  - Mentors: a Lead assigns a Senior as mentor to Trainees and Users (not Viewers). A Senior mentors the people
    assigned to them; a Lead keeps mentoring their own people. (#24, #25)
  - Tutor mode on by default for Users as well as Trainees. (#26)
- **UI tests:** ask and answer in Community; a Lead builds a path a Trainee then follows; a Lead assigns a mentor who
  then reviews that person's practice; tutor mode on for a new User.

### Phase 22: `feature/phase_22_readiness_audit`
- **Delivers:**
  - Readiness evidence: pull requests merged after review, asked from GitHub with the lead's token per project
    (approved and merged, and approved but not merged). (#27)
  - AI usage in the evidence, when the person has AI connected: assistant messages, tutor questions and AI reviews,
    counted from now on. (#28)
  - Audit log also records sign-ins (and failed attempts), settings changes (connections, AI settings, project
    settings) and deletions (projects, suites, users, services, hints, reports, share links). (#28)
- **UI tests:** the evidence shows merged pull requests and AI usage; a failed sign-in and a deletion appear in
  Admin › Audit.

## 8.3 How the notes were read

Where a note could be read in more than one way, this is the reading being built. Each is easy to change and is
listed again in the "Decided while building" notes of its phase.

- **#5 Hierarchy:** "lowest can't see the higher roles" is read as: you see yourself and the roles below yours, not
  your peers (a Lead does not see other Leads). Super Admins see everyone.
- **#6** The marker was on the alternative: the inbox switches to all issue types by default.
- **#12 "admins and super admins"** is read as Automation Leads and Super Admins (there is no separate admin role).
- **#16** Share links are made by those who may publish reports (Super Admin, Lead, Senior) and revoked by Leads and
  Super Admins.
- **#20** Personal Teams messages go through a Teams workflow webhook each user creates for themselves (no bot
  registration in Azure needed); e-mail needs an SMTP server.
- **#25** Seniors mentor the people a Lead assigned to them, instead of every learner of their projects.

## 8.4 Order

The phases follow the order of the review and are independent, except that 22 (AI usage) counts AI requests from the
moment it ships. Each phase updates [decisions-to-review.md](decisions-to-review.md) with its own judgement calls.
