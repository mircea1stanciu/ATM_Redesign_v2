# 5. Design

## 5.1 Design goals

1. **Simple.**
   - Seven areas instead of seven top tabs with up to three nested tab levels.
   - Every screen answers one question.
2. **Fast for daily use.**
   - A command palette (⌘K / Ctrl+K) and keyboard shortcuts.
   - Every view has its own URL.
   - Lists load progressively.
3. **Interactive and live.**
   - Run logs, run progress, notifications and review status update without a reload.
   - Side panels open in place instead of new pages.
4. **One look.**
   - One colour system and one component kit.
   - Light and dark themes.
   - The editor uses VS Code colours.
5. **Guiding for trainees.**
   - Hints, empty states that explain the next step, and step-by-step flows.
   - Seniors can switch the hints off.
6. **Accessible.**
   - Keyboard navigation in every component.
   - Visible focus.
   - Contrast at WCAG AA.
   - Labels for icons.

## 5.2 Visual language

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f8fa` | `#0d1117` | Page background |
| `--surface` | `#ffffff` | `#161b22` | Cards, panels |
| `--surface-2` | `#f0f2f5` | `#1c2129` | Hover, nested areas |
| `--border` | `#e3e6eb` | `#2a313c` | Lines, inputs |
| `--text` | `#1b1f24` | `#e6edf3` | Main text |
| `--text-muted` | `#5b6573` | `#8d96a0` | Secondary text |
| `--brand` | `#f59e0b` (amber 500) | `#f5a524` | Logo, primary buttons, focus ring. Kept from today's identity |
| `--accent` | `#2563eb` | `#4c8dff` | Links, selected items, active navigation |
| `--success` | `#16a34a` | `#3fb950` | Passed, approved, deployed |
| `--danger` | `#dc2626` | `#f85149` | Failed, rejected, errors |
| `--warning` | `#d97706` | `#d29922` | Flaky, uncommitted, attention |
| `--info` | `#0891b2` | `#39c5cf` | Hints, running |

### Rules

- **Colour.**
  - Amber marks the brand and the primary action. Blue marks where you are and what is selected.
  - A status always uses its status colour together with an icon, never colour alone.
- **Typography.**
  - Inter for the interface: 13 px body, 12 px dense tables, 15 / 18 / 22 px headings.
  - JetBrains Mono for code, IDs and branch names.
- **Spacing.** A 4 px grid. Cards use a 12 px radius, inputs and buttons 8 px.
- **Elevation.**
  - Flat surfaces with a 1 px border.
  - Shadows only for floating layers: menus, dialogs, toasts, the command palette.
- **Motion.**
  - Fast: 120–180 ms ease-out for panels and menus.
  - No motion on content that is already visible.
  - The operating system's "reduce motion" setting is respected.
- **Icons.** Lucide, 16 px in lists, 18 px in navigation. Icon-only buttons always have a tooltip and an `aria-label`.

The tokens live in one file (`src/ui/tokens.css`) and are mapped into Tailwind. Components never use raw colour
classes such as `bg-blue-600`.

## 5.3 App shell

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ ATM   [ Project: Bruno ▾ ]   [ ⌘K  Search stories, tests, runs, files… ]   🔔3  ☾  (T) │  ← top bar
├────────────┬─────────────────────────────────────────────────────────────────────────┤
│ ⌂ Home     │                                                                         │
│ ☰ Work     │                                                                         │
│ ▶ Tests    │                        page content                                     │
│ ▤ Reports  │                                                                         │
│ ⇄ Reviews  │                                                                         │
│ ⇪ Deploys  │                                                                         │
│ ✎ Learning │                                                                         │
│            │                                                                         │
│ ─────────  │                                                                         │
│ ⚙ Admin    │                                                                         │
│ ⚙ Settings │                                                                         │
│ « collapse │                                                                         │
└────────────┴─────────────────────────────────────────────────────────────────────────┘
```

### Top bar

- **Project switcher.** It searches as you type and shows recent projects first. The whole app follows the selected
  project.
- **Command palette.** Opens with ⌘K or Ctrl+K. It searches stories, test files, suites, runs and PRs, and runs
  actions such as "Run smoke suite", "Open ABC-123" or "Switch branch".
- **Notification bell.** Shows a count. Clicking it opens a panel with deployments, finished runs, review requests
  and promotions. Each item links to its place.
- **Theme toggle** and **user menu.** The user menu shows the role and tag, profile, connections and sign-out.

### Side bar

- It can be collapsed to icons, and the state is remembered.
- Items the role cannot use are not shown. For example, a Viewer sees Home, Tests, Reports, Reviews and Deploys,
  read-only; Admin shows for Super Admin and Lead (phase 15).
- An area with something waiting shows a small badge, for example Reviews with "2 waiting for you".

## 5.4 Areas and screens

### Home

A personal start page that changes with the role:

| Role | Home shows |
|---|---|
| Senior, User | My work items (in progress, in review). PRs waiting for my review (Senior). Latest runs of my projects. New deployments to check |
| Trainee | My learning path with the next lesson. My practice task. My work items. Hints for today. Mentor feedback |
| Lead | Team overview: work in progress, failing suites, open reviews, trainees' progress, readiness requests |
| Viewer | Latest results and reports of my projects |
| Super Admin | System health: integrations status, users, background jobs |

### Work: requirements to tests

- **Inbox.**
  - Jira stories and technical stories of the project, with filters: sprint, status, team, assignee, label.
  - Confluence requirement pages of the project space, with search.
- **Detail panel.** It slides in from the right, without leaving the list:
  - the description and the acceptance criteria;
  - linked issues, attachments and comments;
  - the Confluence page, rendered.
- **"Start work" button.**
  1. Choose which tests to add or change: a suggested list of test files and suites (from traceability and
     changed-file analysis), or "new test".
  2. Create the branch, `feature/ABC-123-short-name`.
  3. Open the workspace with the story attached.
- **Work item board.** To do → In progress → In review → Done. Each card shows the story, its branch, the last run
  result and its PR.

### Workspace: the editor, improved from today's AI Assistant tab

```
┌ Explorer ─────────┬ editor tabs: LoginTest.java  login.bru  (review) payment.spec.ts ──┬ Assistant ────────┐
│ ⑂ feature/ABC-123 │                                                                   │ Story ABC-123 📎  │
│ ● 2 uncommitted   │   1  test('logs in', async () => {                                │                   │
│ ▾ tests           │   2    await page.goto('/login')                                  │ > Add negative    │
│   ▸ api           │   3    …                                                          │   test for wrong  │
│   ▾ ui            │                                                                   │   password        │
│     login.spec.ts │ ┌ hint ───────────────────────────────────────────────┐           │                   │
│                   │ │ 💡 This test has no assertion yet. Add expect(…).    │           │ [proposed change] │
│                   │ └──────────────────────────────────────────────────────┘           │ Review · Accept   │
├───────────────────┴───────────────────────────────────────────────────────────────────┴───────────────────┤
│ ▶ Run changed tests (Test env ▾)   ⧉ Commit & push   ⇄ Open PR       |  run #231 ● passed 14/14  ⓘ report   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Layout.** The explorer, the editor and the assistant can each be resized and collapsed.
- **Without AI.** The assistant panel shows hints and a link to connect a provider.
- **Bottom action bar.** Run, commit and push, open a PR, and the result of the last run, always visible.
- **Views.** Editor, 3-Panel (GitHub, branch and local copy side by side), Compare, Analysis and Runs; the view is in
  the URL.

### Tests and runs

- **Suites.** Each project has suites, and each suite has:
  - a **test type** (functional, regression, smoke, API, UI, mobile, performance), shown as coloured chips;
  - a runner and target, detected from the repository;
  - an environment;
  - an optional schedule.
- **Run dialog.**
  - What to run: a suite, the changed tests only, or a file.
  - Where: an environment, local or GitHub Actions.
  - Then start.
- **Run view.**
  - A live log, with a raw or structured view.
  - Results grouped by suite, file and test, with failures first.
  - For performance runs: response times (p95), throughput and errors.
  - Buttons: Open report, Ask AI to fix, Rerun failed.
- **Devices.** Emulators and simulators, as a side panel of the run dialog.

### Reports

- **Report list** per project and suite: date, pass rate, duration, environment, branch.
- **Embedded report.** The Allure report opens inside ATM and can open in full screen.
- **Trends.** Pass rate, duration, flaky tests and, for performance suites, response times.
- **"Publish to Confluence".** A publish button with the status of the publication. The flow is open topic T1.

### Reviews

- **"Waiting for me"** shows PRs where I am a requested reviewer, and **"All open"** shows every open PR of my
  projects.
- **PR view.**
  - Files changed, in the same diff component as the workspace: side by side or inline.
  - Inline comments and the conversation.
  - Checks, and the ATM runs of the PR branch.
  - The linked Jira story.
  - "Ask AI to review" shows suggested comments; the senior chooses which ones to post.
  - Approve / Request changes / Comment. Shown only to roles with `pr.review`.

### Deployments

- **Timeline** of deployments per environment: component, version, time, source.
- **Service map** (Lead): which backend services and frontend apps each project tests.
- **For each deployment:** who was notified, and the environment check result (open topic T2).

### Learning

- **Paths.** Today's 15 programs, re-organised into paths, for example "Manual to API automation with Bruno" or
  "UI automation with Playwright".
- **Lessons, quizzes and practice tasks.**
  - Quiz options are shuffled.
  - A practice task is a small real change in a sandbox project or a project branch, reviewed by a mentor.
- **Progress is saved on the server.** Badges and streaks are kept light.
- **Hint library.** Lessons and the editor share the same hints.
- **Mentor view (Lead, Senior).**
  - The trainees and their progress.
  - Practice waiting for review.
  - A "request readiness review" button for the trainee.
  - A "decide" action for the lead.

### Admin (Super Admin and Lead)

- **Users:** create, deactivate, role, tag, lead, projects.
- **Projects:** links to GitHub, Jira project, Confluence space; members; services.
- **Integrations** (Super Admin): base URLs and install-wide settings.
- **Audit log:** role changes, promotions, publications, webhook calls.

### Settings (every user)

- **Profile:** name, picture, password.
- **Connections:** GitHub token per project, Jira, Confluence, AI assistant. These are today's working panels,
  restyled.
- **Preferences:** theme, hints on or off, notification choices.

## 5.5 Interaction patterns

| Pattern | Rule |
|---|---|
| Detail panels | Lists open details in a right-hand panel: stories, runs, PRs, users. Esc closes it. The URL changes, so it can be shared |
| Dialogs | Only for short decisions and forms. Never `alert()` / `confirm()` |
| Toasts | Results of background actions ("Run #231 passed", "Pushed feature/ABC-123"), with an action link |
| Empty states | Explain what the area is for and offer the next step ("Connect Jira in Settings › Connections") |
| Loading | Skeletons for lists and panels. Spinners only inside buttons |
| Errors | Shown where they happen, in plain words, with a fix ("Your GitHub token expired. Update it in Settings › Connections") |
| Destructive actions | A confirm dialog that names what is deleted. Undo where possible (toast with "Undo") |
| Long work | Runs, clones and installs show progress and keep going in the background. A toast or notification says when they finish |
| Keyboard | ⌘K palette, `g` then `w` / `t` / `r` / `v` / `d` / `l` to jump to an area, `/` to search the current list, `?` for the shortcut list |
| Permissions | Actions the user cannot take are hidden. If they are shown for context (for example Approve to a User), they are disabled, with a tooltip saying which role can do it |

## 5.6 Component kit (`src/ui/`)

| Component | Notes |
|---|---|
| Button | Variants: primary (brand), secondary, ghost, danger. Sizes sm and md. Loading state |
| Input, Textarea, Select, Combobox, Checkbox, Switch | With label, help text and error text. Combobox searches |
| Tabs | URL-driven |
| Dialog, Drawer (detail panel), Popover, Tooltip, DropdownMenu | Radix primitives |
| Toast | One provider, with stacking and actions |
| Table / DataList | Sorting, column chooser, keyboard row selection, virtualised for long lists |
| Badge, StatusPill, TestTypeChip | Fixed colours from the tokens |
| Card, Section, PageHeader | Page layout |
| EmptyState, Skeleton, ErrorState | |
| SplitPane | One shared resizable split, replacing 8 copies |
| CodeEditor, DiffView | Today's CodeMirror editor and merge view, moved into the kit |
| CommandPalette | `cmdk` |
| Hint | The trainee hint box, which can be dismissed and switched off |
