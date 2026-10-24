import {
  Activity,
  Bot,
  Braces,
  Code2,
  Coffee,
  FileCode2,
  Gauge,
  Globe,
  MousePointerClick,
  Rocket,
  ScrollText,
  Smartphone,
  Zap,
} from 'lucide-react'

export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

export interface CourseStep {
  title: string
  detail: string
  code?: string
}

export interface Lesson {
  id: string
  title: string
  duration: string
  level: Level
  summary: string
  objectives: string[]
  practice: string
  steps: CourseStep[]
}

export interface ModuleQuiz {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface QuizQuestion {
  type: 'theoretical' | 'practical'
  question: string
  code?: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface Module {
  id: string
  title: string
  description: string
  lessons: Lesson[]
  quiz: ModuleQuiz
}

export interface Resource {
  label: string
  url: string
}

export type FrameworkType = 'web' | 'mobile' | 'api' | 'performance' | 'keyword-driven'

export interface Program {
  id: string
  track: 'frameworks' | 'languages'
  name: string
  tagline: string
  category: string
  icon: typeof Rocket
  accent: string
  overview: string
  prerequisites: string[]
  outcomes: string[]
  modules: Module[]
  resources: Resource[]
  frameworkType?: FrameworkType
}

export const PROGRAMS: Program[] = [
  {
    id: 'bruno',
    track: 'frameworks',
    name: 'Bruno',
    tagline: 'Git-friendly API testing & automation',
    category: 'API Automation',
    frameworkType: 'api',
    icon: Rocket,
    accent: 'orange',
    overview:
      'Bruno is a fast, open-source API client that stores collections as plain-text .bru files right next to your code, making API tests fully version-controllable. This program takes you from your first request to running data-driven API suites in CI/CD, with real, commented commands at every step.',
    prerequisites: [
      'Basic understanding of HTTP (methods, status codes, headers)',
      'Familiarity with JSON payloads',
      'Comfortable using Git for versioning',
      'Node.js 18+ installed (needed for the Bruno CLI)',
    ],
    outcomes: [
      'Build and organize maintainable, Git-tracked API collections',
      'Manage environments, variables and secrets safely',
      'Write assertions and chained request workflows',
      'Automate API suites headlessly with the Bruno CLI in CI/CD',
    ],
    modules: [
      {
        id: 'bruno-m1',
        title: 'Getting Started with Bruno',
        description: 'Install Bruno, learn the interface and send your first request.',
        lessons: [
          {
            id: 'bruno-m1-l1',
            title: 'Why Bruno & Installation',
            duration: '25 min',
            level: 'Beginner',
            summary: 'Understand the offline, Git-native philosophy of Bruno and how it differs from cloud-based API clients.',
            objectives: [
              'Compare Bruno with Postman/Insomnia and the .bru file format',
              'Install the desktop app and the CLI',
              'Tour the workspace, sidebar and request editor',
            ],
            practice: 'Install Bruno, create a new collection named "My First API" and save it inside a local Git repository.',
            steps: [
              {
                title: 'Understand what makes Bruno different',
                detail:
                  'Traditional API clients (Postman, Insomnia) keep your requests in a cloud account or a hidden local database. Bruno instead saves every request as a plain-text .bru file directly in a folder you choose. Because the files live on disk, they can be committed to Git, reviewed in pull requests, branched and merged — exactly like source code. There is no login, no sync service, and no vendor lock-in. This is the single most important idea in the whole course: your API tests become part of your repository.',
              },
              {
                title: 'Install the Bruno desktop app',
                detail:
                  'The desktop app is the graphical editor where you build and run requests. Pick the install command for your operating system. Homebrew (macOS) and winget (Windows) are the easiest because they also handle updates for you.',
                code: '# macOS — installs the Bruno GUI via Homebrew Cask\nbrew install --cask bruno\n\n# Windows — installs Bruno via the Windows Package Manager\nwinget install Bruno.Bruno\n\n# Linux (Debian/Ubuntu) — download the .deb from usebruno.com, then:\nsudo dpkg -i bruno_*.deb   # install the downloaded package',
              },
              {
                title: 'Install the Bruno CLI',
                detail:
                  'The CLI (the "bru" command) is a separate tool that runs your collections from a terminal with no GUI. You need it later for automation and CI/CD. Install it globally with npm so the "bru" command is available everywhere.',
                code: '# -g installs the package globally so "bru" is on your PATH\nnpm install -g @usebruno/cli\n\n# Confirm the CLI is installed and print its version number\nbru --version',
              },
              {
                title: 'Create a project folder under Git',
                detail:
                  'Before creating the collection, make a dedicated folder and turn it into a Git repository. This way every request you add from now on is tracked automatically.',
                code: '# Create the project folder and move into it\nmkdir my-first-api && cd my-first-api\n\n# Turn the folder into a new (empty) Git repository\ngit init',
              },
              {
                title: 'Create the collection inside that folder',
                detail:
                  'Open the Bruno desktop app. Click "Create Collection", set the Location to the my-first-api folder you just created, and name it "My First API". Bruno writes a bruno.json file plus a folder structure into that directory.',
              },
              {
                title: 'Tour the interface',
                detail:
                  'Take a minute to learn the three areas you will use constantly: (1) the left sidebar holds your collections, folders and requests; (2) the center editor lets you set the method, URL, query params, headers, body, auth, scripts and assertions; (3) the response panel (right or bottom) shows the body, headers, status code and a timeline of how long the call took.',
              },
              {
                title: 'Commit the empty collection',
                detail:
                  'Save your starting point in Git. Committing now gives you a clean baseline, so the very next change you make will show up clearly in a diff.',
                code: '# Stage every new file Bruno created\ngit add .\n\n# Save a first snapshot with a descriptive message\ngit commit -m "chore: add empty Bruno collection"',
              },
            ],
          },
          {
            id: 'bruno-m1-l2',
            title: 'Your First Request',
            duration: '20 min',
            level: 'Beginner',
            summary: 'Send a GET request against a public API and learn to read every part of the response.',
            objectives: [
              'Create a GET request to a public REST API',
              'Read the response body, headers, status and timing panels',
              'Save the request as a .bru file and inspect the raw file',
            ],
            practice: 'Call a public REST API, then open the generated .bru file to see the plain-text definition.',
            steps: [
              {
                title: 'Create a new request',
                detail:
                  'In the sidebar, right-click your collection and choose "New Request". Name it "List Users" and set the HTTP method to GET. GET is the method used to read/fetch data without changing anything on the server.',
              },
              {
                title: 'Set the URL and send it',
                detail:
                  'Type the endpoint into the URL bar and press Send (or Ctrl/Cmd+Enter). We use jsonplaceholder, a free fake API that is perfect for practice because it never requires authentication.',
                code: '# Method + URL. GET = read-only fetch of the users list\nGET https://jsonplaceholder.typicode.com/users',
              },
              {
                title: 'Read the status code',
                detail:
                  'The first thing to check on any response is the status code. It tells you whether the call succeeded. Learn these common families so you can debug quickly.',
                code: '# 2xx = success        → 200 OK, 201 Created\n# 3xx = redirect       → 301 Moved, 304 Not Modified\n# 4xx = your mistake   → 400 Bad Request, 401 Unauthorized, 404 Not Found\n# 5xx = server error   → 500 Internal Error, 503 Unavailable',
              },
              {
                title: 'Inspect body, headers and timeline',
                detail:
                  'Explore the response tabs: the Body tab shows the JSON array of users (pretty-printed); the Headers tab shows metadata like content-type: application/json; and the Timeline tab shows how long DNS, connection and download took, which is useful for spotting slow endpoints.',
              },
              {
                title: 'Open the generated .bru file',
                detail:
                  'Bruno saved your request as List Users.bru. Open it in any text editor. Notice how readable it is — this is exactly what Git will show in a diff, which is why code review of API tests actually works with Bruno.',
                code: 'meta {\n  name: List Users     # display name in the sidebar\n  type: http           # this is an HTTP request\n}\n\nget {\n  url: https://jsonplaceholder.typicode.com/users   # the endpoint that gets called\n}',
              },
              {
                title: 'Add a query parameter (useful case)',
                detail:
                  'Real APIs are filtered with query parameters. Add one in the Params tab, or type it straight into the URL after a "?". Here we fetch only the posts written by user number 1.',
                code: '# ?userId=1 filters the results to a single user\nGET https://jsonplaceholder.typicode.com/posts?userId=1',
              },
              {
                title: 'Commit the request',
                detail: 'Track your first working request so it becomes part of the project history.',
                code: 'git add .                                   # stage the new .bru file\ngit commit -m "test: add List Users request"  # save it to history',
              },
            ],
          },
        ],
        quiz: {
          question: 'You want every API request to be reviewable in a pull request just like source code. What should you look for in an API client to enable that?',
          options: [
            'It stores requests in a cloud account synced automatically',
            "It stores each request as a plain-text file (like Bruno's .bru format) that Git can diff",
            'It stores requests in a proprietary binary database',
            'It requires a browser extension to view requests',
          ],
          correctIndex: 1,
          explanation: 'Bruno saves every request as a plain-text .bru file on disk, so Git can diff, branch and review changes just like any other source file.',
        },
      },
      {
        id: 'bruno-m2',
        title: 'Collections, Folders & Version Control',
        description: 'Structure requests and keep them under source control.',
        lessons: [
          {
            id: 'bruno-m2-l1',
            title: 'Organizing Collections',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Group related endpoints into folders and add documentation so the collection scales with your API.',
            objectives: [
              'Create nested folders that mirror your API resources',
              'Add descriptions and docs to requests',
              'Reorder and rename requests cleanly',
            ],
            practice: 'Model a small e-commerce API with Users, Products and Orders folders, each with at least two requests.',
            steps: [
              {
                title: 'Why structure matters',
                detail:
                  'A flat list of 50 requests is impossible to navigate. Mirroring your API resources as folders makes the collection self-documenting: a newcomer can open it and immediately understand what the API offers. A good rule is "one folder per resource".',
              },
              {
                title: 'Create resource folders',
                detail:
                  'Right-click the collection and choose "New Folder". Create three folders named after your main resources: Users, Products and Orders. On disk, Bruno creates a real sub-folder for each.',
              },
              {
                title: 'Add requests to each folder',
                detail:
                  'Inside each folder add at least two requests. A common pattern is a "list" endpoint (GET all) plus a "detail" endpoint (GET one by id), and a "create" endpoint (POST) where relevant.',
                code: 'Users/\n  GET  List Users     -> /users        # fetch all users\n  GET  Get User       -> /users/1      # fetch one user by id\nProducts/\n  GET  List Products  -> /products     # fetch all products\n  POST Create Product -> /products     # create a new product\nOrders/\n  GET  List Orders    -> /orders       # fetch all orders\n  POST Create Order   -> /orders       # place a new order',
              },
              {
                title: 'Send a POST request with a JSON body (useful case)',
                detail:
                  'For the "Create Product" request, set the method to POST and open the Body tab, choose "JSON", and paste a payload. POST is used to create new resources on the server.',
                code: 'post {\n  url: {{baseUrl}}/products\n  body: json                # tell Bruno the body is JSON\n}\n\nbody:json {\n  {\n    "name": "Wireless Mouse",   # product fields sent to the server\n    "price": 29.99,\n    "inStock": true\n  }\n}',
              },
              {
                title: 'Document each request',
                detail:
                  'Open the Docs tab of a request and write a short Markdown note: what it does, required params, and a sample response. This documentation is stored inside the .bru file, so it travels with the request and is versioned too.',
              },
              {
                title: 'Reorder, rename and commit',
                detail:
                  'Drag requests to order them logically (list before detail before create) and rename anything unclear. Then commit so the structure is saved.',
                code: 'git add .\ngit commit -m "feat: structure collection into resource folders"',
              },
            ],
          },
          {
            id: 'bruno-m2-l2',
            title: 'Collections as Code',
            duration: '25 min',
            level: 'Intermediate',
            summary: 'Treat your API collection like source code with meaningful diffs, branches and reviews.',
            objectives: [
              'Commit .bru files and review a diff of a changed request',
              'Resolve a simple merge conflict in a .bru file',
              'Establish naming conventions for a team',
            ],
            practice: 'Change a request URL on a branch, open a pull request and review the human-readable diff.',
            steps: [
              {
                title: 'Commit the current state',
                detail:
                  'Always start a change from a clean tree so the diff you produce next contains only your change and nothing else.',
                code: 'git status                       # verify there is nothing uncommitted\ngit add . && git commit -m "chore: baseline collection"',
              },
              {
                title: 'Create a feature branch',
                detail:
                  'Never edit directly on main. A branch isolates your change so it can be reviewed and merged independently, and so main always stays releasable.',
                code: '# -b creates the branch AND switches to it in one step\ngit checkout -b update-users-endpoint',
              },
              {
                title: 'Change a request and view the diff',
                detail:
                  'In Bruno, edit the URL of "Get User" (for example bump it to a /v2 path) and save. Because .bru is plain text, git diff shows a clean, reviewable change — impossible with binary collection formats.',
                code: '# Show exactly what changed, line by line\ngit diff\n\n# Example output:\n# - url: https://api.example.com/users/1        (old line, removed)\n# + url: https://api.example.com/v2/users/1     (new line, added)',
              },
              {
                title: 'Push the branch and open a PR',
                detail:
                  'Push your branch to the remote and open a pull request. Reviewers can now comment on the exact line that changed, approve it, and merge — the same workflow you already use for code.',
                code: '# -u links your local branch to the remote so future "git push" needs no args\ngit push -u origin update-users-endpoint',
              },
              {
                title: 'Resolve a merge conflict (useful case)',
                detail:
                  'If two people edit the same request, Git reports a conflict. Open the .bru file: Git marks the two versions with <<<<<<<, ======= and >>>>>>>. Keep the correct line, delete the markers, then stage and commit.',
                code: '<<<<<<< HEAD\n  url: https://api.example.com/v2/users/1     # your version\n=======\n  url: https://api.example.com/v3/users/1     # their version\n>>>>>>> main\n\n# After editing to keep the right line:\ngit add "Users/Get User.bru"     # mark the conflict resolved\ngit commit                       # complete the merge',
              },
              {
                title: 'Agree on team conventions',
                detail:
                  'Consistency keeps a growing collection readable. Document rules in your README: request names as "Verb + Resource" (e.g. "List Users"), folders in kebab-case, one resource per folder, and a shared environment naming scheme.',
              },
            ],
          },
        ],
        quiz: {
          question: "You and a teammate both edited the same request on different branches, and Git now reports a conflict inside a .bru file. What's the right way to resolve it?",
          options: [
            'Delete the .bru file and recreate the request from scratch',
            'Open the file, keep the correct content between the conflict markers, remove the markers, then stage and commit',
            "Conflicts can't be resolved because .bru is not real text",
            'Force-push your branch to overwrite the other version',
          ],
          correctIndex: 1,
          explanation: 'Because .bru is plain text, conflicts show up with the usual <<<<<<<, ======= and >>>>>>> markers and are resolved exactly like any code merge conflict.',
        },
      },
      {
        id: 'bruno-m3',
        title: 'Environments, Variables & Secrets',
        description: 'Run the same collection against multiple targets safely.',
        lessons: [
          {
            id: 'bruno-m3-l1',
            title: 'Environments & Variables',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Parameterize base URLs and reuse values across requests so one collection targets dev, staging and prod.',
            objectives: [
              'Create dev/staging/prod environments',
              'Use {{baseUrl}} and collection/runtime variables',
              'Switch environments and confirm requests resolve correctly',
            ],
            practice: 'Define a {{baseUrl}} per environment and point all requests at it, then switch environments and re-run.',
            steps: [
              {
                title: 'Why environments exist',
                detail:
                  'You want to run the exact same requests against different servers without editing every URL. An "environment" is a named set of variables. Switching the environment swaps all those values at once, so {{baseUrl}} points to dev today and prod tomorrow.',
              },
              {
                title: 'Open the environments manager',
                detail:
                  'Click the environment selector in the top-right of Bruno and choose "Configure". Create three environments: dev, staging and prod. Each is stored as its own file under an environments/ folder.',
              },
              {
                title: 'Add a baseUrl variable per environment',
                detail:
                  'Give each environment its own baseUrl. The variable name is identical everywhere; only the value differs.',
                code: 'dev:     baseUrl = https://dev.api.example.com       # local/dev server\nstaging: baseUrl = https://staging.api.example.com   # pre-production\nprod:    baseUrl = https://api.example.com           # live production',
              },
              {
                title: 'Use the variable in requests',
                detail:
                  'Replace every hard-coded host with the {{baseUrl}} placeholder. Bruno substitutes the value of the currently selected environment at send time.',
                code: '# {{baseUrl}} is replaced with the active environment value\nGET {{baseUrl}}/users\nGET {{baseUrl}}/products',
              },
              {
                title: 'Understand variable scopes (useful case)',
                detail:
                  'Bruno has several variable levels. Knowing which to use avoids surprises: environment vars change per target, collection vars are shared defaults, and runtime vars are set by scripts during a run (covered later).',
                code: '{{baseUrl}}     # environment variable  → differs per dev/staging/prod\n{{apiVersion}}  # collection variable   → shared default for all requests\n{{authToken}}   # runtime variable      → set by a script mid-run',
              },
              {
                title: 'Switch environment and re-run',
                detail:
                  'Select "dev" and send a request; check the resolved URL in the Timeline. Switch to "staging" and send again — the same request now hits a different server with zero edits. That is the whole payoff.',
              },
            ],
          },
          {
            id: 'bruno-m3-l2',
            title: 'Handling Secrets',
            duration: '20 min',
            level: 'Intermediate',
            summary: 'Keep API keys and tokens out of version control while still using them in requests.',
            objectives: [
              'Use secret variables and .env style values',
              'Understand what gets committed vs. kept local',
              'Reference secrets in headers and auth',
            ],
            practice: 'Store an API token as a secret variable and use it in an Authorization header without committing the value.',
            steps: [
              {
                title: 'Why secrets need special care',
                detail:
                  'A token committed to Git is a leaked token — anyone with repo access (or a public mirror) can use it. The goal is to reference secrets by name in your requests while the actual values stay only on your machine and out of every commit.',
              },
              {
                title: 'Mark a variable as secret',
                detail:
                  'In the environment configuration, add a variable named token and enable its "secret" flag. Bruno masks secret values in the UI and does not write them into the committed environment file.',
              },
              {
                title: 'Store the real value locally and ignore it',
                detail:
                  'Put the real secret in a local .env file, then add that file to .gitignore so Git never tracks it. This is the standard pattern for keeping credentials off the repo.',
                code: '# .env  (stays on your machine, never committed)\nAPI_TOKEN=super-secret-value\n\n# .gitignore  (tells Git to skip these files)\n.env\nenvironments/*.local.bru',
              },
              {
                title: 'Reference the secret in a header',
                detail:
                  'Use the variable name in an Authorization header instead of pasting the raw token. Bearer authentication is the most common scheme for REST APIs.',
                code: 'headers {\n  # {{token}} is resolved at send time; the raw value never appears here\n  Authorization: Bearer {{token}}\n}',
              },
              {
                title: 'Verify nothing leaked before committing (useful case)',
                detail:
                  'Make it a habit to inspect what you are about to commit. If a secret ever shows up in the staged diff, unstage it and fix your ignore rules before pushing.',
                code: 'git status            # which files are staged?\ngit diff --staged     # show the exact staged content — scan for secrets\n\n# If a secret slipped in, unstage the file:\ngit restore --staged .env',
              },
            ],
          },
        ],
        quiz: {
          question: "You need the same collection of requests to run against dev, staging and prod without editing every URL. What should you do?",
          options: [
            'Duplicate the whole collection once per environment',
            "Hardcode each server's URL directly into every request",
            'Define a baseUrl variable per environment and reference it as {{baseUrl}} in requests',
            'Manually find-and-replace the host before every run',
          ],
          correctIndex: 2,
          explanation: 'Environments let you define the same variable (like baseUrl) with a different value per target; switching environments swaps every request\'s target instantly.',
        },
      },
      {
        id: 'bruno-m4',
        title: 'Scripting & Assertions',
        description: 'Validate responses and chain requests together.',
        lessons: [
          {
            id: 'bruno-m4-l1',
            title: 'Assertions & Tests',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Add automated checks so a request passes or fails on its own, turning a manual call into a real test.',
            objectives: [
              'Use the Assert tab for status and body checks',
              'Write test scripts with expect() assertions',
              'Read the pass/fail results panel',
            ],
            practice: 'Assert that a GET /users request returns 200 and the array contains a user with an email.',
            steps: [
              {
                title: 'Assertions turn calls into tests',
                detail:
                  'Sending a request tells you what happened; an assertion decides whether that is correct. With assertions your collection can run unattended and clearly report pass or fail — the foundation for CI.',
              },
              {
                title: 'Add simple assertions in the Assert tab',
                detail:
                  'The Assert tab uses a simple "expression operator value" format. Each line is one check. This is the quickest way to validate the basics.',
                code: 'res.status         eq   200          # status code must equal 200\nres.body           isNotEmpty         # response body must not be empty\nres.body[0].email  isDefined          # first user must have an email field\nres.headers.content-type contains json  # header must mention json',
              },
              {
                title: 'Write richer checks with a test script',
                detail:
                  'For logic that assertions cannot express, use the Tests tab. It runs JavaScript with the built-in expect() library (Chai-style), letting you check types, lengths and nested values.',
                code: "test('returns 200 with a non-empty user list', function () {\n  // res.getStatus() reads the HTTP status code\n  expect(res.getStatus()).to.equal(200)\n\n  // res.getBody() parses the JSON response body\n  const users = res.getBody()\n\n  // the body should be a non-empty array\n  expect(users).to.be.an('array').that.is.not.empty\n\n  // every user object should include an email property\n  expect(users[0]).to.have.property('email')\n})",
              },
              {
                title: 'Validate a response time (useful case)',
                detail:
                  'You often want to catch performance regressions. Assert that the endpoint responded within an acceptable budget.',
                code: "test('responds quickly', function () {\n  // res.getResponseTime() returns milliseconds\n  expect(res.getResponseTime()).to.be.below(800)  // fail if slower than 800ms\n})",
              },
              {
                title: 'Run and read the results',
                detail:
                  'Send the request and open the results/assertions tab. Green rows passed; a red row shows the expected value vs. the actual value so you can see exactly why it failed. To learn the feedback loop, change eq 200 to eq 201, re-run to watch it fail, then revert.',
              },
            ],
          },
          {
            id: 'bruno-m4-l2',
            title: 'Pre/Post Scripts & Chaining',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Capture data from one response and feed it into the next request to build real workflows.',
            objectives: [
              'Use pre-request scripts to set up data',
              'Extract a value from a response into a variable',
              'Chain a login to an authenticated request flow',
            ],
            practice: 'Send a login request, capture the token, then use it to call a protected endpoint.',
            steps: [
              {
                title: 'Why chaining matters',
                detail:
                  'Most real scenarios need more than one call: log in to get a token, then use that token to read your profile. Chaining lets one request hand data to the next, so you can automate a full user journey.',
              },
              {
                title: 'Create a login request',
                detail:
                  'Add a POST request that sends credentials and receives a token. Notice the password itself comes from a variable so it is never hard-coded.',
                code: 'post {\n  url: {{baseUrl}}/auth/login\n  body: json\n}\n\nbody:json {\n  {\n    "username": "demo",\n    "password": "{{password}}"   # pulled from a (secret) variable\n  }\n}',
              },
              {
                title: 'Capture the token in a post-response script',
                detail:
                  'Open the Script tab and, in the "Post Response" section, read the body and store the token as a runtime variable with bru.setVar. Runtime variables live for the rest of the run and are perfect for passing data between requests.',
                code: "// --- Post Response script on the login request ---\nconst body = res.getBody()          // parse the JSON response\nbru.setVar('authToken', body.token) // save token for later requests\nconsole.log('captured token:', body.token) // handy while debugging",
              },
              {
                title: 'Use a pre-request script (useful case)',
                detail:
                  'Pre-request scripts run before the call is sent — great for generating timestamps, request ids or signatures. Here we attach a unique request id so every call is traceable in server logs.',
                code: "// --- Pre Request script ---\n// crypto.randomUUID() creates a unique id per run\nbru.setVar('requestId', crypto.randomUUID())",
              },
              {
                title: 'Use the token in the next request',
                detail:
                  'In a protected request, reference the captured variable in the Authorization header (and any custom header you set in the pre-script).',
                code: 'get {\n  url: {{baseUrl}}/me         # protected endpoint\n}\n\nheaders {\n  Authorization: Bearer {{authToken}}  # token captured from login\n  X-Request-Id: {{requestId}}          # id set in the pre-request script\n}',
              },
              {
                title: 'Run the chain end to end',
                detail:
                  'Send the login request first so the token is captured, then send the protected request. The second call succeeds using data produced by the first — a complete, repeatable auth flow with no manual copy-paste.',
              },
            ],
          },
        ],
        quiz: {
          question: "You want to log in once and reuse the returned token in later requests, without hardcoding it anywhere. What's the correct approach?",
          options: [
            "Copy the token manually into every request's header after each login",
            'Capture the token in a post-response script with bru.setVar and reference it as {{authToken}} in later requests',
            'Store the token permanently inside the .bru file',
            'Skip authentication in tests entirely',
          ],
          correctIndex: 1,
          explanation: 'A post-response script can read the login response and store the token with bru.setVar, letting later requests reference it as a runtime variable — this is request chaining.',
        },
      },
      {
        id: 'bruno-m5',
        title: 'Automation & CI/CD',
        description: 'Run collections headlessly and integrate with pipelines.',
        lessons: [
          {
            id: 'bruno-m5-l1',
            title: 'Running with the Bruno CLI',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Execute entire collections from the terminal with no GUI, ready for automation.',
            objectives: [
              'Run bru run against a folder and environment',
              'Generate JSON/JUnit reports',
              'Control exit codes for pass/fail gating',
            ],
            practice: 'Run your collection with bru run against staging and produce a JUnit report file.',
            steps: [
              {
                title: 'Why a CLI at all',
                detail:
                  'A pipeline has no mouse. The CLI runs the same requests and assertions you built in the GUI, prints results to the terminal, and returns an exit code a build system can act on. This is the bridge from manual testing to automation.',
              },
              {
                title: 'Move into your collection folder',
                detail:
                  'The CLI operates on the folder that contains your .bru files (the one with bruno.json). Change into it first.',
                code: 'cd my-first-api   # folder that holds bruno.json and your requests',
              },
              {
                title: 'Run the whole collection',
                detail:
                  'Execute every request and assertion against a chosen environment. --env selects which environment file to use.',
                code: '# Run all requests using the "staging" environment\nbru run --env staging',
              },
              {
                title: 'Run a single folder (useful case)',
                detail:
                  'During development you often want only one resource. Pass a folder path to limit the run, and add -r to include sub-folders recursively.',
                code: '# Run only the Users folder and everything inside it\nbru run Users -r --env staging',
              },
              {
                title: 'Produce machine-readable reports',
                detail:
                  'CI systems display results from report files. JUnit XML is understood by almost every CI tool; JSON is handy for custom dashboards.',
                code: '# JUnit report — most CI tools render this as a test summary\nbru run --env staging --reporter-junit results/junit.xml\n\n# JSON report — good for custom processing or archiving\nbru run --env staging --reporter-json results/report.json',
              },
              {
                title: 'Check the exit code for gating',
                detail:
                  'The CLI exits 0 when everything passes and non-zero when any assertion fails. A pipeline uses this to pass or fail the build automatically.',
                code: 'bru run --env staging\necho "exit code: $?"   # $? holds the exit code of the last command; 0 = success',
              },
            ],
          },
          {
            id: 'bruno-m5-l2',
            title: 'Data-Driven Runs & Pipelines',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Iterate over datasets and wire Bruno into continuous integration.',
            objectives: [
              'Drive a request from a CSV/JSON data file',
              'Add a Bruno step to a GitHub Actions workflow',
              'Fail the build when assertions fail',
            ],
            practice: 'Add a CI job that installs the Bruno CLI, runs your collection and uploads the report as an artifact.',
            steps: [
              {
                title: 'What data-driven testing means',
                detail:
                  'Instead of writing one request per input, you supply a list of inputs and the runner repeats the same request once per entry. This is how you cover many cases (valid ids, invalid ids, edge values) with a single request definition.',
              },
              {
                title: 'Create a data file',
                detail:
                  'Each object in the array becomes one iteration. The keys become variables you can reference inside the request with {{...}}.',
                code: '// data/users.json — three iterations, one per object\n[\n  { "userId": 1 },   // iteration 1 → {{userId}} = 1\n  { "userId": 2 },   // iteration 2 → {{userId}} = 2\n  { "userId": 3 }    // iteration 3 → {{userId}} = 3\n]',
              },
              {
                title: 'Reference the data in the request',
                detail:
                  'Use the data keys like any other variable. On each iteration Bruno swaps in the next row.',
                code: '# {{userId}} takes a different value on every iteration\nGET {{baseUrl}}/users/{{userId}}',
              },
              {
                title: 'Run data-driven from the CLI',
                detail:
                  'Point the runner at the data file. --bail stops at the first failure, which is often what you want in CI to fail fast.',
                code: '# Run the Users folder once per row in users.json\nbru run Users --env staging --bail --data-file data/users.json',
              },
              {
                title: 'Add a GitHub Actions job',
                detail:
                  'This workflow checks out the repo, installs Node and the Bruno CLI, runs the collection, and always uploads the report — even on failure — so you can debug from the CI run.',
                code: "name: API Tests\non: [push]                 # run on every push\njobs:\n  bruno:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4          # get the repo (your .bru files)\n      - uses: actions/setup-node@v4        # install Node.js\n        with: { node-version: '20' }\n      - run: npm install -g @usebruno/cli  # install the Bruno CLI\n      - run: bru run --env staging --reporter-junit results/junit.xml\n      - uses: actions/upload-artifact@v4   # save the report\n        if: always()                       # upload even if the tests failed\n        with:\n          name: bruno-report\n          path: results/",
              },
              {
                title: 'Confirm the build fails on assertion errors (useful case)',
                detail:
                  'Prove the safety net works: break one assertion, push, and watch the job turn red because bru returned a non-zero exit code. Fix it and confirm the job goes green. Now your API is protected on every push.',
              },
            ],
          },
          {
            id: 'bruno-m5-l3',
            title: 'Error Handling & Debugging Techniques',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Diagnose failing requests quickly using logs, retries and defensive scripting instead of guesswork.',
            objectives: [
              'Use console.log and the CLI --verbose flag to inspect a run',
              'Handle network errors and timeouts gracefully in scripts',
              'Add retry logic for flaky external dependencies',
              'Debug environment/variable resolution issues',
            ],
            practice: 'Force a request to fail (bad URL, wrong token), then use logging and verbose mode to pinpoint exactly why.',
            steps: [
              {
                title: 'Reproduce the failure with verbose output',
                detail:
                  'When a request behaves unexpectedly, the first step is to get more detail than the summary view provides. The CLI\'s --verbose flag prints full request/response data, which is invaluable when a teammate reports "it fails in CI but works for me".',
                code: '# --verbose prints full request & response details, not just pass/fail\nbru run Users --env staging --verbose',
              },
              {
                title: 'Add diagnostic logging to scripts',
                detail:
                  'console.log inside pre-request or post-response scripts shows up in the CLI output and the GUI console. Log the pieces you are unsure about — resolved URLs, variable values, response snippets — rather than guessing.',
                code: "// --- Post Response script ---\nconsole.log('status:', res.getStatus())\nconsole.log('url called:', req.getUrl())      // confirm the URL that was actually sent\nconsole.log('body preview:', JSON.stringify(res.getBody()).slice(0, 200))",
              },
              {
                title: 'Catch and classify network errors (useful case)',
                detail:
                  'A request can fail before it even gets a response (DNS failure, connection refused, timeout). Wrap risky logic in try/catch inside scripts so you produce a clear, actionable message instead of a cryptic stack trace.',
                code: "test('handles the call and reports clearly on failure', function () {\n  try {\n    const status = res.getStatus()\n    expect(status).to.be.below(500)\n  } catch (err) {\n    // Re-throw with more context so the failure is actionable in reports\n    throw new Error(`Request to ${req.getUrl()} failed unexpectedly: ${err.message}`)\n  }\n})",
              },
              {
                title: 'Set explicit timeouts',
                detail:
                  'A hung request wastes CI minutes and hides the real problem. Configure a timeout in the request settings (or via bru CLI --tests-timeout) so a stuck call fails fast with a clear "timed out" message instead of hanging the whole run.',
                code: '# Fail any request that takes longer than 10s (10000ms), instead of hanging indefinitely\nbru run --env staging --tests-timeout 10000',
              },
              {
                title: 'Retry flaky external dependencies (useful case)',
                detail:
                  'Third-party or shared staging services occasionally hiccup. Rather than failing the whole build on a one-off blip, retry the specific request a couple of times before giving up — but keep the retry count small so real failures still surface quickly.',
                code: '# --tests-retry re-runs a failed request up to N times before marking it failed\nbru run FlakyExternalCheck --env staging --tests-retry 2',
              },
              {
                title: 'Debug variable resolution problems',
                detail:
                  'A very common bug is a variable that resolves to undefined because of scope or a typo. Print the resolved value right before it is used, and double check you are in the environment you think you are in.',
                code: "// Confirm which environment and value are actually active\nconsole.log('active baseUrl:', bru.getEnvVar('baseUrl'))\nconsole.log('active token present:', Boolean(bru.getVar('authToken')))",
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a request fails, work through this order: (1) check the status code and body first, (2) run with --verbose, (3) log the resolved URL and variables, (4) confirm the correct environment is selected, (5) check for a timeout vs. an assertion failure, (6) only then suspect the API itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A request fails intermittently only when hitting a shared staging server, and works fine locally. What is the most appropriate way to make the pipeline resilient without hiding real bugs?',
          options: [
            'Delete the assertion so the request always passes',
            'Add a small, bounded retry (e.g. --tests-retry 2) for that specific flaky request while keeping the assertion intact',
            'Increase the timeout to an hour so it never fails',
            'Run the whole suite twice and ignore the first run',
          ],
          correctIndex: 1,
          explanation: 'A bounded retry absorbs occasional real-world flakiness from shared/external services while still failing the build if the problem is persistent — deleting assertions or disabling checks would hide genuine regressions.',
        },
      },
    ],
    resources: [
      { label: 'Official Bruno Documentation', url: 'https://docs.usebruno.com/' },
      { label: 'Bruno CLI Guide', url: 'https://docs.usebruno.com/bru-cli/overview' },
      { label: 'Bruno GitHub Repository', url: 'https://github.com/usebruno/bruno' },
    ],
  },
  {
    id: 'appium',
    track: 'frameworks',
    name: 'Appium',
    tagline: 'Cross-platform mobile UI automation',
    category: 'Mobile Automation',
    frameworkType: 'mobile',
    icon: Smartphone,
    accent: 'purple',
    overview:
      'Appium is the industry standard for automating native, hybrid and mobile web apps on Android and iOS using a single WebDriver-based API. This program walks you from architecture and setup through robust, CI-ready mobile test suites, with fully commented commands and code.',
    prerequisites: [
      'Working knowledge of a programming language (JavaScript, Java or Python)',
      'Basic understanding of the WebDriver / Selenium model',
      'Node.js 18+ and a JDK installed',
      'Android SDK (for Android) or Xcode (for iOS)',
    ],
    outcomes: [
      'Explain the Appium client-server architecture and drivers',
      'Configure sessions with capabilities for Android and iOS',
      'Locate and interact with elements reliably using explicit waits',
      'Run mobile suites in parallel on device farms and CI/CD',
    ],
    modules: [
      {
        id: 'appium-m1',
        title: 'Introduction & Environment Setup',
        description: 'Understand Appium and get a working automation environment.',
        lessons: [
          {
            id: 'appium-m1-l1',
            title: 'Appium Architecture & Drivers',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Learn how the Appium server, clients and platform drivers fit together before writing any code.',
            objectives: [
              'Describe the client to server to driver to device flow',
              'Understand UiAutomator2 (Android) and XCUITest (iOS) drivers',
              'Know the role of the W3C WebDriver protocol',
            ],
            practice: 'Sketch how a test reaches an Android emulator through the UiAutomator2 driver.',
            steps: [
              {
                title: 'The big picture',
                detail:
                  'Appium is a client-server system. Your test is a client that sends commands over HTTP using the standard WebDriver protocol. The Appium server receives them and hands them to a platform-specific driver, which finally talks to the real automation technology on the device. Understanding this chain makes every later error message easier to place.',
              },
              {
                title: 'Visualize the request flow',
                detail:
                  'Follow a single "tap this button" command as it travels down the stack and back up with a result. Each layer has one job, which is why the same test code can drive both Android and iOS.',
                code: 'Your test (client)\n   |  HTTP request, W3C WebDriver JSON\n   v\nAppium Server        # routes the command to the right driver\n   |  delegates\n   v\nUiAutomator2 / XCUITest driver   # translates to vendor APIs\n   |  native automation calls\n   v\nAndroid emulator / iOS simulator  # performs the tap',
              },
              {
                title: 'Learn the two main drivers',
                detail:
                  'Android automation uses the UiAutomator2 driver (built on Google’s UiAutomator framework). iOS automation uses the XCUITest driver (built on Apple’s XCTest). In Appium 2 these drivers are separate plugins you install on demand, which keeps the core small.',
              },
              {
                title: 'Why the WebDriver protocol matters',
                detail:
                  'Appium speaks the same W3C WebDriver protocol as Selenium. That means the same client libraries, the same "find element then act" mental model, and much of the same tooling carry over from web automation to mobile — you are not learning a brand-new API from scratch.',
              },
            ],
          },
          {
            id: 'appium-m1-l2',
            title: 'Installing Appium & Tooling',
            duration: '40 min',
            level: 'Beginner',
            summary: 'Install Appium 2, add a driver, boot a device and verify the whole setup works.',
            objectives: [
              'Install Appium 2 via npm and add a driver with the driver CLI',
              'Set up an Android emulator or iOS simulator',
              'Validate the environment',
            ],
            practice: 'Install Appium, add the uiautomator2 driver, and confirm a healthy setup.',
            steps: [
              {
                title: 'Install Node and Appium 2',
                detail:
                  'Appium runs on Node.js, so make sure Node 18+ is installed first. Then install Appium globally and confirm you got the 2.x line, which uses the pluggable-driver model taught in this course.',
                code: '# Install the Appium server globally\nnpm install -g appium\n\n# Verify the version — you want 2.x\nappium --version',
              },
              {
                title: 'Add a platform driver',
                detail:
                  'Appium 2 ships without drivers. Install UiAutomator2 for Android using the built-in driver manager, then list installed drivers to confirm.',
                code: '# Download and install the Android (UiAutomator2) driver\nappium driver install uiautomator2\n\n# List installed drivers to confirm it is present\nappium driver list --installed',
              },
              {
                title: 'Validate your environment',
                detail:
                  'The driver doctor checks that prerequisites (JDK, Android SDK, ANDROID_HOME, etc.) are correctly configured and prints clear fixes for anything missing. Run it until everything is green.',
                code: '# Diagnose missing Android/JDK setup for the uiautomator2 driver\nappium driver doctor uiautomator2',
              },
              {
                title: 'List and boot an emulator',
                detail:
                  'You need a running device. List the Android Virtual Devices you have created in Android Studio, then launch one by name.',
                code: '# Show available Android Virtual Devices (AVDs)\nemulator -list-avds\n\n# Boot a specific emulator by its AVD name\nemulator -avd Pixel_7_API_34',
              },
              {
                title: 'Check the device is connected (useful case)',
                detail:
                  'adb (Android Debug Bridge) is your window into connected devices. If your emulator does not appear here, Appium will not find it either — so this is the first thing to check when a session fails to start.',
                code: '# List all devices/emulators Android can see\nadb devices\n\n# Example healthy output:\n# List of devices attached\n# emulator-5554   device',
              },
              {
                title: 'Start the Appium server',
                detail:
                  'Run the server; by default it listens on port 4723. Leave this terminal open — your tests connect to this address. Seeing the "listener started" line means you are ready to run sessions.',
                code: '# Start the Appium server (foreground)\nappium\n# -> [Appium] REST http interface listener started on http://0.0.0.0:4723',
              },
            ],
          },
        ],
        quiz: {
          question: "Your Appium session for Android fails to start and you suspect the environment (JDK/SDK) isn't configured correctly. What should you run first to diagnose it?",
          options: [
            'appium driver doctor uiautomator2',
            'npm install -g appium --force',
            'adb reboot',
            'Reinstall the operating system',
          ],
          correctIndex: 0,
          explanation: "The driver doctor checks prerequisites like JDK and Android SDK configuration for the chosen driver and reports exactly what's missing.",
        },
      },
      {
        id: 'appium-m2',
        title: 'Sessions & Capabilities',
        description: 'Start automation sessions targeting real apps and devices.',
        lessons: [
          {
            id: 'appium-m2-l1',
            title: 'Desired Capabilities',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Configure the capabilities that tell Appium exactly what to automate.',
            objectives: [
              'Set platformName, automationName, deviceName and app',
              'Differentiate Android vs iOS capability sets',
              'Launch a session against a sample app',
            ],
            practice: 'Write a capabilities object that installs and launches a sample .apk on an emulator.',
            steps: [
              {
                title: 'What capabilities are',
                detail:
                  'Capabilities are key/value pairs sent when a session starts. They answer four questions: which platform, which driver, which device, and which app. In Appium 2, vendor-specific keys must carry the appium: prefix — a very common source of beginner errors.',
              },
              {
                title: 'Write Android capabilities',
                detail:
                  'A minimal Android set names the platform, selects the UiAutomator2 driver, targets a device, and points at an .apk to install and launch.',
                code: "const caps = {\n  platformName: 'Android',                       // OS to automate\n  'appium:automationName': 'UiAutomator2',       // Android driver\n  'appium:deviceName': 'Pixel_7_API_34',         // target device/emulator\n  'appium:app': '/absolute/path/to/app-debug.apk' // app to install + launch\n}",
              },
              {
                title: 'Compare with iOS capabilities',
                detail:
                  'iOS keeps the same structure but swaps the platform, the driver (XCUITest) and the app artifact (.app for a simulator, .ipa for a real device). Learning both side by side shows how portable your test logic is.',
                code: "const iosCaps = {\n  platformName: 'iOS',                     // OS to automate\n  'appium:automationName': 'XCUITest',     // iOS driver\n  'appium:deviceName': 'iPhone 15',        // simulator name\n  'appium:app': '/absolute/path/to/MyApp.app' // app bundle to launch\n}",
              },
              {
                title: 'Attach to an already-installed app (useful case)',
                detail:
                  'Instead of installing an .apk every run, you can launch an app that is already on the device by its package and activity (Android) or bundle id (iOS). This is faster during development.',
                code: "const attachCaps = {\n  platformName: 'Android',\n  'appium:automationName': 'UiAutomator2',\n  'appium:appPackage': 'com.example.myapp',        // installed app id\n  'appium:appActivity': '.MainActivity',           // entry screen\n  'appium:noReset': true                           // keep app data between runs\n}",
              },
              {
                title: 'Launch a session',
                detail:
                  'Create the session with a WebDriver client (WebdriverIO shown here). The remote() call connects to the Appium server, the app launches, you automate, then you MUST end the session to free the device.',
                code: "import { remote } from 'webdriverio'\n\nconst driver = await remote({\n  hostname: '127.0.0.1',   // where the Appium server runs\n  port: 4723,              // default Appium port\n  capabilities: caps       // the config from the previous step\n})\n\n// ... your automation steps go here ...\n\nawait driver.deleteSession()  // always clean up the session",
              },
            ],
          },
          {
            id: 'appium-m2-l2',
            title: 'Appium Inspector',
            duration: '25 min',
            level: 'Intermediate',
            summary: 'Explore the app hierarchy visually and craft reliable locators without guesswork.',
            objectives: [
              'Connect Appium Inspector to a running session',
              'Inspect the element tree and attributes',
              'Copy suggested locators for use in tests',
            ],
            practice: 'Open your app in Appium Inspector and identify accessibility ids for three controls.',
            steps: [
              {
                title: 'Why the Inspector saves hours',
                detail:
                  'Instead of guessing selectors, the Inspector shows you a live mirror of the screen and the full element tree with every attribute. You click a control and instantly see how to locate it — this is the fastest way to write correct locators.',
              },
              {
                title: 'Install Appium Inspector',
                detail:
                  'Appium Inspector is a standalone desktop app (separate from the server). Download the installer for your OS from its GitHub releases page and open it.',
              },
              {
                title: 'Configure the connection',
                detail:
                  'In the Inspector, set Remote Host to 127.0.0.1 and Port to 4723 (matching your running server), paste the same capabilities JSON you use in tests, then click "Start Session" to mirror the app.',
                code: '{\n  "platformName": "Android",\n  "appium:automationName": "UiAutomator2",\n  "appium:deviceName": "Pixel_7_API_34",\n  "appium:appPackage": "com.example.myapp",\n  "appium:appActivity": ".MainActivity"\n}',
              },
              {
                title: 'Inspect the element tree',
                detail:
                  'Click any control in the mirror. The Inspector highlights it in the hierarchy and lists its attributes: resource-id, content-desc (this is the accessibility id), text, class and bounds. These attributes are the raw material for locators.',
              },
              {
                title: 'Copy stable locators',
                detail:
                  'Prefer the accessibility id (content-desc) whenever it exists — it is the most stable and cross-platform. The Inspector shows suggested locators you can copy straight into your test, so you never hand-write fragile XPath.',
              },
            ],
          },
        ],
        quiz: {
          question: "In Appium 2, your session fails to start with an 'unrecognized capability' style error even though the capability name looks correct. What's the most likely cause?",
          options: [
            'The capability is missing the appium: vendor prefix required for driver-specific capabilities',
            'Appium 2 no longer supports capabilities',
            'The emulator is turned off',
            'The app file is corrupted',
          ],
          correctIndex: 0,
          explanation: 'Appium 2 requires vendor-specific capabilities (like deviceName or automationName) to be prefixed with appium: — forgetting the prefix is a very common setup mistake.',
        },
      },
      {
        id: 'appium-m3',
        title: 'Locators & Element Interaction',
        description: 'Find elements reliably and act on them without flakiness.',
        lessons: [
          {
            id: 'appium-m3-l1',
            title: 'Locator Strategies',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Choose robust locators that survive UI changes and run fast.',
            objectives: [
              'Prefer accessibility id over brittle XPath',
              'Use UiAutomator and iOS Predicate/Class Chain selectors',
              'Understand locator performance trade-offs',
            ],
            practice: 'Locate a login button three different ways and compare stability and speed.',
            steps: [
              {
                title: 'The locator hierarchy of preference',
                detail:
                  'Not all locators are equal. A good rule of thumb, best to worst: accessibility id > id/resource-id > native platform query > XPath. Higher options are more stable and faster; XPath is the last resort because it breaks easily and is slow.',
              },
              {
                title: 'Start with accessibility id',
                detail:
                  'The accessibility id is the most portable locator because it maps to content-desc on Android and name on iOS. In WebdriverIO the "~" prefix means "accessibility id".',
                code: "// '~' tells WebdriverIO this is an accessibility id\nconst btn = await driver.$('~loginButton')",
              },
              {
                title: 'Use native platform selectors',
                detail:
                  'For tricky cases, the platform-native query engines are far faster than XPath: UiAutomator on Android and Predicate String / Class Chain on iOS.',
                code: "// Android — UiAutomator selector by resource id\nawait driver.$('android=new UiSelector().resourceId(\"com.app:id/login\")')\n\n// iOS — Predicate String selecting a button named 'Login'\nawait driver.$('-ios predicate string:type == \"XCUIElementTypeButton\" AND name == \"Login\"')",
              },
              {
                title: 'Avoid brittle XPath',
                detail:
                  'Absolute XPath breaks on the smallest layout change and is the slowest strategy on mobile. If you must use XPath, keep it relative and based on a stable attribute like text.',
                code: "// Last resort: relative, attribute-based XPath\nawait driver.$('//android.widget.Button[@text=\"Login\"]')",
              },
              {
                title: 'Handle a list of elements (useful case)',
                detail:
                  'Use $$ (double dollar) to get all matching elements, then index or filter. This is essential for lists, menus and search results.',
                code: "// $$ returns an array of all matching elements\nconst items = await driver.$$('~productCard')\nconsole.log('items found:', items.length)  // how many matched\nawait items[0].click()                      // tap the first one",
              },
            ],
          },
          {
            id: 'appium-m3-l2',
            title: 'Actions & Explicit Waits',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Interact with elements without flaky timing issues — the number-one cause of unreliable mobile tests.',
            objectives: [
              'Tap, type and read text from elements',
              'Replace sleeps with explicit wait conditions',
              'Handle element-not-found gracefully',
            ],
            practice: 'Automate a login form using explicit waits so the test never relies on hard-coded sleeps.',
            steps: [
              {
                title: 'Perform basic interactions',
                detail:
                  'The three actions you use constantly are: type text (setValue), tap (click) and read text (getText). These cover the vast majority of UI steps.',
                code: "await driver.$('~username').setValue('demo')   // type into the field\nawait driver.$('~password').setValue('secret') // type the password\nawait driver.$('~loginButton').click()         // tap the login button\nconst msg = await driver.$('~welcomeMessage').getText() // read a label",
              },
              {
                title: 'Never use fixed sleeps',
                detail:
                  'A hard sleep either wastes time (too long) or fails randomly (too short). Explicit waits pause only until a specific condition is true, making tests both faster and reliable.',
                code: "// BAD: guesses how long to wait, causes flaky tests\n// await driver.pause(5000)\n\n// GOOD: waits up to 10s, continues the instant the element appears\nconst welcome = await driver.$('~welcomeMessage')\nawait welcome.waitForDisplayed({ timeout: 10000 })",
              },
              {
                title: 'Wait for an element to disappear (useful case)',
                detail:
                  'Loading spinners are a classic trap. Wait for the spinner to vanish before asserting on the screen behind it. The "reverse: true" flag waits for the opposite condition.',
                code: "const spinner = await driver.$('~loadingSpinner')\n// reverse: true waits until the spinner is NO LONGER displayed\nawait spinner.waitForDisplayed({ timeout: 15000, reverse: true })",
              },
              {
                title: 'Handle missing elements gracefully',
                detail:
                  'Optional UI (promos, cookie banners) may or may not appear. Check existence first so your test makes a clear decision instead of throwing a raw exception.',
                code: "const banner = await driver.$('~promoBanner')\nif (await banner.isExisting()) {   // only act if it is actually there\n  await banner.click()\n}",
              },
              {
                title: 'Automate the full login',
                detail:
                  'Combine the pieces into a real flow: wait for the form, enter credentials, submit, wait for the dashboard, then assert — all without a single hard-coded sleep. This is your first genuinely stable test.',
                code: "await driver.$('~username').waitForDisplayed({ timeout: 8000 })\nawait driver.$('~username').setValue('demo')\nawait driver.$('~password').setValue('secret')\nawait driver.$('~loginButton').click()\nconst title = await driver.$('~dashboardTitle')\nawait title.waitForDisplayed({ timeout: 10000 })  // wait for result",
              },
            ],
          },
        ],
        quiz: {
          question: 'Your test locates a button using an absolute XPath, and it breaks every time the UI layout changes slightly. What is the recommended fix?',
          options: [
            'Add more sleep time before the click',
            'Switch to a more stable locator like accessibility id',
            "Rewrite the XPath with more '/' segments to be more specific",
            'Ignore the failure and retry the test until it passes',
          ],
          correctIndex: 1,
          explanation: 'Accessibility id maps to content-desc (Android) / name (iOS) and is far more stable than layout-dependent XPath, which breaks on the smallest UI change.',
        },
      },
      {
        id: 'appium-m4',
        title: 'Writing Robust Test Scripts',
        description: 'Turn interactions into maintainable automated tests.',
        lessons: [
          {
            id: 'appium-m4-l1',
            title: 'Your First End-to-End Test',
            duration: '40 min',
            level: 'Intermediate',
            summary: 'Build a complete, isolated login-to-dashboard scenario with proper setup and teardown.',
            objectives: [
              'Structure a test with setup/teardown of the session',
              'Assert on visible screen state',
              'Capture a screenshot on failure',
            ],
            practice: 'Automate: launch app, log in, assert the dashboard title, and screenshot on failure.',
            steps: [
              {
                title: 'Why setup/teardown matters',
                detail:
                  'Each test should start from a known state and clean up after itself. Creating a fresh session before each test and deleting it afterwards keeps tests independent, so one failure cannot poison the next.',
                code: "let driver\n\n// runs before EVERY test → fresh app session\nbeforeEach(async () => {\n  driver = await remote({ port: 4723, capabilities: caps })\n})\n\n// runs after EVERY test → release the device\nafterEach(async () => {\n  await driver.deleteSession()\n})",
              },
              {
                title: 'Write the login flow',
                detail:
                  'Describe the user journey inside an it() block. Read it top to bottom: it should map directly to what a human tester would do.',
                code: "it('logs in and shows the dashboard', async () => {\n  await driver.$('~username').setValue('demo')\n  await driver.$('~password').setValue('secret')\n  await driver.$('~loginButton').click()\n})",
              },
              {
                title: 'Assert the result',
                detail:
                  'A test without an assertion proves nothing. Wait for the dashboard and assert on its visible text so a wrong screen fails the test.',
                code: "  const title = await driver.$('~dashboardTitle')\n  await title.waitForDisplayed({ timeout: 10000 }) // wait for the screen\n  // expect() fails the test if the text is wrong\n  expect(await title.getText()).toContain('Welcome')",
              },
              {
                title: 'Screenshot on failure',
                detail:
                  'When a test fails in CI you cannot watch the screen, so capture evidence automatically. This hook saves a PNG only when the current test failed.',
                code: "afterEach(async function () {\n  // only capture when the test did not pass\n  if (this.currentTest?.state === 'failed') {\n    // saveScreenshot writes a PNG you can open from CI artifacts\n    await driver.saveScreenshot(`./artifacts/${this.currentTest.title}.png`)\n  }\n})",
              },
              {
                title: 'Test the negative path too (useful case)',
                detail:
                  'Good suites test failures, not just the happy path. Add a test for invalid credentials that asserts an error message appears — this catches regressions in validation logic.',
                code: "it('shows an error for a wrong password', async () => {\n  await driver.$('~username').setValue('demo')\n  await driver.$('~password').setValue('WRONG')\n  await driver.$('~loginButton').click()\n  const err = await driver.$('~errorMessage')\n  await err.waitForDisplayed({ timeout: 8000 })\n  expect(await err.getText()).toContain('Invalid')\n})",
              },
            ],
          },
          {
            id: 'appium-m4-l2',
            title: 'Page Object Model',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Keep tests clean and reusable with the Page Object pattern so locator changes touch one file.',
            objectives: [
              'Encapsulate screen locators and actions in page classes',
              'Reuse pages across multiple tests',
              'Reduce duplication and improve maintainability',
            ],
            practice: 'Refactor your login test to use a LoginPage and DashboardPage object.',
            steps: [
              {
                title: 'The problem POM solves',
                detail:
                  'Without structure, the same locator (~loginButton) gets copied into dozens of tests. When the app changes, you must fix it everywhere. The Page Object Model puts each screen’s locators and actions in one class, so a UI change means editing a single file.',
              },
              {
                title: 'Create a LoginPage class',
                detail:
                  'Encapsulate the locators as getters and expose a high-level login() action. Tests will never see a raw selector again.',
                code: "class LoginPage {\n  constructor(driver) { this.driver = driver }\n\n  // getters return the elements — locators live here, in ONE place\n  get username() { return this.driver.$('~username') }\n  get password() { return this.driver.$('~password') }\n  get submit()   { return this.driver.$('~loginButton') }\n\n  // a business action the test can call in one line\n  async login(user, pass) {\n    await this.username.setValue(user)\n    await this.password.setValue(pass)\n    await this.submit.click()\n  }\n}",
              },
              {
                title: 'Create a DashboardPage class',
                detail:
                  'Expose only what tests need to verify. Hiding the waiting logic inside isLoaded() keeps tests short and intention-revealing.',
                code: "class DashboardPage {\n  constructor(driver) { this.driver = driver }\n  get title() { return this.driver.$('~dashboardTitle') }\n\n  // waits for the screen, then returns its title text\n  async isLoaded() {\n    await this.title.waitForDisplayed({ timeout: 10000 })\n    return this.title.getText()\n  }\n}",
              },
              {
                title: 'Rewrite the test using pages',
                detail:
                  'The test now reads like plain English and contains zero locators. Anyone can understand it, and it will not break when a selector changes.',
                code: "it('logs in', async () => {\n  const login = new LoginPage(driver)\n  const dash = new DashboardPage(driver)\n  await login.login('demo', 'secret')          // one-line action\n  expect(await dash.isLoaded()).toContain('Welcome')\n})",
              },
              {
                title: 'Reuse across tests (useful case)',
                detail:
                  'Add a second test — invalid login — that reuses the same LoginPage. Notice you did not duplicate a single locator: that reuse is exactly the payoff of the pattern.',
                code: "it('rejects a bad password', async () => {\n  const login = new LoginPage(driver)\n  await login.login('demo', 'WRONG')  // same page object, different data\n  const err = await driver.$('~errorMessage')\n  await err.waitForDisplayed({ timeout: 8000 })\n  expect(await err.getText()).toContain('Invalid')\n})",
              },
            ],
          },
        ],
        quiz: {
          question: 'The same locators are copy-pasted across 10 test files, and a single UI change now requires editing every file. What is the best long-term fix?',
          options: [
            "Keep duplicating locators, it's faster to write",
            "Refactor the screen's locators and actions into a Page Object class that all tests reuse",
            'Delete the failing tests',
            "Hardcode the fix directly into the Appium server config",
          ],
          correctIndex: 1,
          explanation: 'The Page Object Model centralizes each screen\'s locators and actions in one class, so a UI change only needs to be fixed in a single place.',
        },
      },
      {
        id: 'appium-m5',
        title: 'Advanced Interactions & Contexts',
        description: 'Handle gestures, hybrid apps and platform specifics.',
        lessons: [
          {
            id: 'appium-m5-l1',
            title: 'Gestures & Mobile Commands',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Perform swipes, scrolls and taps with the W3C Actions API and driver shortcuts.',
            objectives: [
              'Use the W3C Actions API for swipe and scroll',
              'Call executeScript mobile: commands',
              'Scroll to bring off-screen elements into view',
            ],
            practice: 'Automate scrolling a long list until a target item is visible, then tap it.',
            steps: [
              {
                title: 'How gestures work',
                detail:
                  'A gesture is a timed sequence of pointer events: press down, move, lift up. Appium gives you two ways to express them — the low-level W3C Actions API (fully cross-platform) and convenient driver-specific "mobile:" shortcuts for common gestures.',
              },
              {
                title: 'Swipe with the W3C Actions API',
                detail:
                  'Compose a pointer action to swipe up: move to a start point, press down, move to an end point over a duration, then release. Coordinates are in pixels from the top-left of the screen.',
                code: "await driver.action('pointer')\n  .move({ x: 200, y: 1000 })              // start near the bottom\n  .down()                                 // finger touches the screen\n  .move({ duration: 600, x: 200, y: 300 }) // drag upward over 600ms\n  .up()                                   // lift the finger\n  .perform()                              // execute the whole gesture",
              },
              {
                title: 'Use mobile: shortcuts',
                detail:
                  'For everyday gestures, driver commands are simpler and more readable than raw pointer math. Here scrollGesture scrolls within a rectangle in a given direction.',
                code: "// executeScript runs a driver-specific command\nawait driver.executeScript('mobile: scrollGesture', [{\n  left: 100, top: 100, width: 200, height: 800, // the scrollable area\n  direction: 'down',   // scroll direction\n  percent: 3.0         // how far to scroll (3x the area height)\n}])",
              },
              {
                title: 'Scroll until visible, then tap',
                detail:
                  'A reusable helper for long lists: keep scrolling until the target element is on screen, then tap it. The catch() guards against the element not existing yet.',
                code: "async function scrollToTap(driver, selector) {\n  for (let i = 0; i < 10; i++) {          // try up to 10 scrolls\n    const el = await driver.$(selector)\n    // if it is visible, tap it and stop\n    if (await el.isDisplayed().catch(() => false)) return el.click()\n    // otherwise scroll down and try again\n    await driver.executeScript('mobile: scrollGesture', [{\n      left: 100, top: 300, width: 200, height: 800,\n      direction: 'down', percent: 2\n    }])\n  }\n  throw new Error('Element not found after scrolling: ' + selector)\n}",
              },
            ],
          },
          {
            id: 'appium-m5-l2',
            title: 'Hybrid Apps & Webviews',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Automate the web content embedded inside native apps by switching contexts.',
            objectives: [
              'List available contexts and switch to a WEBVIEW',
              'Interact with DOM elements inside the webview',
              'Switch back to the NATIVE_APP context',
            ],
            practice: 'Switch into a webview, fill an embedded web form, then return to native and submit.',
            steps: [
              {
                title: 'Native vs webview contexts',
                detail:
                  'Hybrid apps mix native screens with embedded web pages (webviews). Appium exposes each as a "context". In NATIVE_APP you use mobile locators; inside a WEBVIEW you use ordinary web CSS selectors. Switching contexts is the key skill.',
              },
              {
                title: 'List the available contexts',
                detail:
                  'First discover what contexts exist. There is always a NATIVE_APP, plus one WEBVIEW entry per embedded web view.',
                code: "const contexts = await driver.getContexts()\nconsole.log(contexts)\n// e.g. ['NATIVE_APP', 'WEBVIEW_com.app']",
              },
              {
                title: 'Switch into the webview',
                detail:
                  'Change context to the webview so Appium routes commands to the embedded browser engine. Now web selectors work.',
                code: "// switch from native into the embedded web view\nawait driver.switchContext('WEBVIEW_com.app')",
              },
              {
                title: 'Interact with DOM elements',
                detail:
                  'Inside the webview you use CSS selectors exactly like a normal web page — # for id, . for class, etc.',
                code: "await driver.$('#email').setValue('demo@example.com') // CSS id selector\nawait driver.$('#subscribe').click()                  // click a web button",
              },
              {
                title: 'Switch back to native',
                detail:
                  'After finishing in the web form, return to NATIVE_APP to keep driving the app’s native shell (e.g. a native submit/confirm button).',
                code: "await driver.switchContext('NATIVE_APP') // back to native locators\nawait driver.$('~submitButton').click()",
              },
            ],
          },
        ],
        quiz: {
          question: 'You need to fill out a web form that is embedded inside a native app screen. What must you do before interacting with the form fields?',
          options: [
            'Nothing, native locators work inside webviews too',
            'Switch context to the app\'s WEBVIEW using switchContext before using CSS selectors',
            'Restart the Appium server',
            'Uninstall and reinstall the app',
          ],
          correctIndex: 1,
          explanation: 'Hybrid apps expose a NATIVE_APP context plus one WEBVIEW per embedded browser; you must switchContext into the webview before using standard CSS selectors.',
        },
      },
      {
        id: 'appium-m6',
        title: 'Scaling & CI/CD',
        description: 'Run suites in parallel and integrate with pipelines.',
        lessons: [
          {
            id: 'appium-m6-l1',
            title: 'Parallel Execution & Device Farms',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Run tests across many devices at once, locally or in the cloud, to cut feedback time.',
            objectives: [
              'Run parallel sessions on multiple emulators',
              'Connect to a cloud device farm',
              'Manage capabilities per device matrix',
            ],
            practice: 'Run the same suite across two device configurations in parallel and compare results.',
            steps: [
              {
                title: 'Why parallelize',
                detail:
                  'Mobile tests are slow. Running them one device at a time does not scale. Parallel execution runs the same suite on several devices simultaneously, so a 30-minute run on four devices finishes in roughly the time of one.',
              },
              {
                title: 'Define a device matrix',
                detail:
                  'Describe each target device as its own capability set. The udid ties a config to a specific running emulator/device.',
                code: "const devices = [\n  { 'appium:deviceName': 'Pixel_7_API_34', 'appium:udid': 'emulator-5554' },\n  { 'appium:deviceName': 'Pixel_5_API_33', 'appium:udid': 'emulator-5556' }\n]",
              },
              {
                title: 'Run sessions in parallel',
                detail:
                  'Test runners like WebdriverIO fan out automatically. maxInstances controls how many run at once; the capabilities array defines the matrix.',
                code: "// wdio.conf.js\nexport const config = {\n  maxInstances: 2,       // run up to 2 devices at the same time\n  capabilities: devices  // one worker per entry in the matrix\n}",
              },
              {
                title: 'Connect to a cloud device farm',
                detail:
                  'Local emulators are limited. Cloud farms (BrowserStack, Sauce Labs) give you hundreds of real devices. You point the client at their hub and add auth credentials in a vendor options block.',
                code: "const driver = await remote({\n  hostname: 'hub.browserstack.com', // cloud endpoint instead of localhost\n  capabilities: {\n    ...caps,\n    'bstack:options': {              // vendor-specific auth block\n      userName: process.env.BS_USER, // read secrets from env vars\n      accessKey: process.env.BS_KEY\n    }\n  }\n})",
              },
              {
                title: 'Compare results across devices (useful case)',
                detail:
                  'Run the suite across both configs and review the per-device report. A failure that appears on only one device usually points to an OS-version or screen-size specific bug — exactly what cross-device testing is meant to catch.',
              },
            ],
          },
          {
            id: 'appium-m6-l2',
            title: 'CI/CD Integration & Best Practices',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Make mobile automation reliable and repeatable inside pipelines.',
            objectives: [
              'Start an emulator and Appium server in CI',
              'Publish test reports and failure screenshots',
              'Apply retry/quarantine strategies for flaky tests',
            ],
            practice: 'Create a CI job that boots an emulator, runs the suite headlessly and uploads reports.',
            steps: [
              {
                title: 'The CI challenge for mobile',
                detail:
                  'Unlike API tests, mobile tests need a device. CI runners have none by default, so the job must boot an emulator, start Appium, run the suite, and publish artifacts — all headlessly. We assemble that pipeline piece by piece.',
              },
              {
                title: 'Boot an emulator in CI',
                detail:
                  'A dedicated GitHub Action provisions and boots an Android emulator inside the runner and then executes your command against it.',
                code: "- uses: reactivecircus/android-emulator-runner@v2\n  with:\n    api-level: 34        # Android version to emulate\n    arch: x86_64         # fast architecture for CI\n    script: npm test     # command to run once the emulator is ready",
              },
              {
                title: 'Start Appium as part of the job',
                detail:
                  'Install Appium and the driver, then start the server in the background (&) so the test process can connect to it. Logging to a file lets you attach it as an artifact later.',
                code: 'npm install -g appium                 # install the server\nappium driver install uiautomator2    # install the Android driver\nappium --log appium.log &             # start server in background, log to file',
              },
              {
                title: 'Publish reports and screenshots',
                detail:
                  'Always upload artifacts, even when the job fails (if: always()), so you can debug from the failure screenshots and the Appium log without re-running.',
                code: "- uses: actions/upload-artifact@v4\n  if: always()             # upload even on failure — that is when you need it\n  with:\n    name: appium-artifacts\n    path: |\n      artifacts/           # failure screenshots\n      appium.log           # server log",
              },
              {
                title: 'Tame flaky tests (useful case)',
                detail:
                  'Mobile tests can be flaky due to timing and device state. Add a small retry for known-flaky specs so a single hiccup does not fail the build, but quarantine persistently unstable tests into a separate non-blocking job rather than disabling your checks — never hide failures by deleting assertions.',
                code: "// wdio.conf.js — retry a failing test once before marking it failed\nexport const config = {\n  specFileRetries: 1,          // re-run a failed spec file one time\n  specFileRetriesDelay: 5      // wait 5s between retries\n}",
              },
            ],
          },
          {
            id: 'appium-m6-l3',
            title: 'Debugging & Troubleshooting Appium Sessions',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Diagnose session start failures, element-not-found errors and flaky gestures using Appium\'s own tooling.',
            objectives: [
              'Read Appium server logs to find the real cause of a failure',
              'Use Appium Inspector to verify locators against the live app',
              'Diagnose common session-creation errors',
              'Capture screenshots and page source at the moment of failure',
            ],
            practice: 'Deliberately break a locator, then use the server log and Appium Inspector to find and fix it.',
            steps: [
              {
                title: 'Start with the Appium server log',
                detail:
                  'Most failures are explained in the server log, not the test framework\'s stack trace. The stack trace tells you a command failed; the server log tells you why (wrong selector strategy, app not installed, device offline). Always check this first.',
                code: '# Start the server with verbose logging directed to a file\nappium --log-level debug --log appium.log\n\n# In another terminal, tail the log while your test runs\ntail -f appium.log',
              },
              {
                title: 'Diagnose "session not created" errors (useful case)',
                detail:
                  'This is the most common first-time failure. It almost always means a capability mismatch: wrong platformVersion, missing app path, or a device/emulator that is not actually running. Check the exact fields the log complains about against `adb devices`.',
                code: '# List connected/booted Android devices and emulators\nadb devices\n\n# Common log clue and fix:\n# "Could not find a connected Android device" -> boot the emulator first\n# "Unable to find an app" -> check the "appium:app" path capability is correct',
              },
              {
                title: 'Verify locators live with Appium Inspector',
                detail:
                  'Rather than guessing why a selector does not match, open Appium Inspector, connect it to your app with the same capabilities, and click the element directly. It shows you the exact accessibility id, resource-id or xpath Appium sees — often different from what you assumed.',
              },
              {
                title: 'Dump the page source on failure',
                detail:
                  'When "element not found" happens intermittently, capture the full accessibility tree at the moment of failure. Comparing it to what your locator expects usually reveals the real cause (element is inside a different container, or simply not rendered yet).',
                code: "// In an afterEach/catch block:\nconst source = await driver.getPageSource()\nconsole.log(source.slice(0, 2000))   // print the first part of the XML tree\n// Save the full tree to disk for later inspection\nrequire('fs').writeFileSync('artifacts/page-source.xml', source)",
              },
              {
                title: 'Capture a screenshot at the point of failure',
                detail:
                  'A screenshot next to the log and page source turns a vague "test failed" into an obvious "the app is stuck on a permission dialog". Always wire this into your global error/failure hook, not into every single test.',
                code: "afterEach(async function () {\n  if (this.currentTest && this.currentTest.state === 'failed') {\n    const png = await driver.takeScreenshot()          // base64-encoded PNG\n    require('fs').writeFileSync(\n      `artifacts/${this.currentTest.title}.png`,\n      png,\n      'base64'\n    )\n  }\n})",
              },
              {
                title: 'Distinguish timing issues from real bugs',
                detail:
                  'An intermittent "element not found" is usually a race condition, not a broken locator: the test looked before the UI finished rendering. Prefer an explicit wait for the element\'s state over blindly increasing global timeouts, which only masks the issue and slows every run down.',
                code: "// Wait specifically for the condition you need, with a clear timeout and message\nawait driver.$('~submitButton').waitForDisplayed({\n  timeout: 5000,\n  timeoutMsg: 'submitButton never appeared — check if a previous screen is still loading',\n})",
              },
              {
                title: 'Build a triage checklist',
                detail:
                  'When a mobile test fails, work through this order: (1) read the server log for the actual error, (2) confirm the device/emulator is alive with adb devices, (3) open Appium Inspector to re-verify the locator, (4) check the captured screenshot and page source, (5) only then consider it a real app bug and file it.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A test intermittently fails with "element not found", but the locator works fine when you step through manually. What is the most likely cause and best fix?',
          options: [
            'The locator syntax is fundamentally wrong and must be rewritten from scratch',
            'It is likely a timing/race condition — replace blind delays with an explicit waitForDisplayed on that specific element',
            'Appium cannot reliably find elements, so retries should be disabled entirely',
            'The app must be reinstalled before every single test run',
          ],
          correctIndex: 1,
          explanation: 'Intermittent "not found" errors when the locator is otherwise correct almost always indicate a race condition; an explicit wait for that element\'s state is the targeted fix, rather than masking it with longer global timeouts.',
        },
      },
    ],
    resources: [
      { label: 'Official Appium Documentation', url: 'https://appium.io/docs/en/latest/' },
      { label: 'Appium Inspector', url: 'https://github.com/appium/appium-inspector' },
      { label: 'UiAutomator2 Driver', url: 'https://github.com/appium/appium-uiautomator2-driver' },
    ],
  },
  {
    id: 'selenium',
    track: 'frameworks',
    name: 'Selenium WebDriver',
    tagline: 'The industry-standard web browser automation framework',
    category: 'Web UI Automation',
    frameworkType: 'web',
    icon: Globe,
    accent: 'blue',
    overview:
      'Selenium WebDriver is the most widely adopted framework for automating real browsers across Chrome, Firefox, Edge and Safari. This program takes you from a first script to a maintainable, CI-ready suite using explicit waits, the Page Object Model and parallel execution — with every command explained.',
    prerequisites: [
      'Working knowledge of a programming language (Java, Python or JavaScript)',
      'Basic HTML/CSS understanding (tags, classes, ids)',
      'A modern browser (Chrome/Firefox) installed locally',
    ],
    outcomes: [
      'Explain the WebDriver protocol and browser driver architecture',
      'Locate and interact with elements using robust selectors',
      'Replace flaky sleeps with explicit waits and expected conditions',
      'Structure suites with the Page Object Model and run them in CI',
    ],
    modules: [
      {
        id: 'selenium-m1',
        title: 'Introduction & Environment Setup',
        description: 'Understand WebDriver and get a working automation environment.',
        lessons: [
          {
            id: 'selenium-m1-l1',
            title: 'WebDriver Architecture',
            duration: '25 min',
            level: 'Beginner',
            summary: 'Learn how your test code, the driver binary and the real browser communicate.',
            objectives: [
              'Describe the client to driver to browser communication flow',
              'Understand the role of browser-specific drivers (chromedriver, geckodriver)',
              'Know the W3C WebDriver protocol basics',
            ],
            practice: 'Sketch how a "click" command travels from your test to the real Chrome browser.',
            steps: [
              {
                title: 'The big picture',
                detail:
                  'Selenium WebDriver is a protocol, not a single tool. Your test calls a language binding (Java, Python, JS...), which sends HTTP requests using the W3C WebDriver protocol to a browser-specific driver executable (e.g. chromedriver). That driver then talks directly to the browser using its native automation interface.',
              },
              {
                title: 'Visualize the request flow',
                detail:
                  'Follow one "click this button" command from your test down to the browser and back with a result.',
                code: 'Your test (Java/Python/JS)\n   |  HTTP request, W3C WebDriver JSON\n   v\nchromedriver / geckodriver / msedgedriver   # browser-specific driver\n   |  native browser automation protocol (CDP for Chrome)\n   v\nReal Chrome / Firefox / Edge browser         # performs the click',
              },
              {
                title: 'Why a driver binary is required',
                detail:
                  'Each browser vendor ships its own driver binary that implements the WebDriver protocol for that specific browser. Selenium 4 can auto-manage these binaries for you, removing a common source of version-mismatch errors.',
              },
              {
                title: 'Same protocol across the industry',
                detail:
                  'Because Appium, Playwright-compatible tooling and many cloud grids also speak (or were inspired by) this same W3C protocol, the "find element, then act" mental model you learn here transfers directly to other tools.',
              },
            ],
          },
          {
            id: 'selenium-m1-l2',
            title: 'Installing Selenium & Drivers',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Set up a project, install Selenium, and launch your first automated browser window.',
            objectives: [
              'Install Selenium via a package manager',
              'Let Selenium Manager resolve the correct driver automatically',
              'Launch and close a real browser from code',
            ],
            practice: 'Install Selenium in your language of choice and open a real browser to a test page.',
            steps: [
              {
                title: 'Install Selenium (Python example)',
                detail:
                  'Selenium ships as a regular package for each supported language. Installing it gives you the WebDriver client bindings needed to control browsers.',
                code: '# Install the Selenium client library\npip install selenium',
              },
              {
                title: 'Let Selenium Manager handle drivers',
                detail:
                  'Since Selenium 4.6, Selenium Manager automatically downloads and configures the correct driver binary for your installed browser version — no manual PATH setup required in most cases.',
                code: '# No manual driver download needed — Selenium Manager resolves it\nfrom selenium import webdriver\ndriver = webdriver.Chrome()  # auto-detects & downloads chromedriver if missing',
              },
              {
                title: 'Open your first page',
                detail:
                  'Navigate the freshly launched browser to a URL and print its title, confirming the whole chain (driver + browser) works end to end.',
                code: 'driver.get(\'https://example.com\')      # navigate to the page\nprint(driver.title)                     # confirm the page loaded\ndriver.quit()                           # always close the browser',
              },
              {
                title: 'Run headless in CI (useful case)',
                detail:
                  'CI runners usually have no display. Headless mode runs the same browser without a visible window, which is faster and works on any server.',
                code: 'from selenium.webdriver.chrome.options import Options\n\nopts = Options()\nopts.add_argument(\'--headless=new\')   # run without a visible UI\ndriver = webdriver.Chrome(options=opts)',
              },
            ],
          },
        ],
        quiz: {
          question: 'You launch webdriver.Chrome() and get a driver version mismatch error. What does Selenium 4.6+ normally do to prevent this?',
          options: [
            'Selenium Manager automatically resolves and downloads the matching driver binary',
            'You must always manually download chromedriver and set the PATH',
            'Selenium refuses to support Chrome without a paid license',
            'The test silently ignores the mismatch',
          ],
          correctIndex: 0,
          explanation: 'Selenium Manager (built into Selenium 4.6+) detects your installed browser version and automatically provisions a matching driver binary.',
        },
      },
      {
        id: 'selenium-m2',
        title: 'Locators & Element Interaction',
        description: 'Find elements reliably and act on them without flakiness.',
        lessons: [
          {
            id: 'selenium-m2-l1',
            title: 'Locator Strategies',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Choose the right selector strategy for stable, fast tests.',
            objectives: [
              'Use By.ID, By.CSS_SELECTOR and By.XPATH appropriately',
              'Prefer stable attributes like data-testid over fragile CSS',
              'Understand when XPath is genuinely necessary',
            ],
            practice: 'Locate a login button three different ways and compare stability and readability.',
            steps: [
              {
                title: 'The locator hierarchy of preference',
                detail:
                  'Prefer, in order: id > CSS selector on a dedicated test attribute (data-testid) > CSS on semantic attributes > XPath. Higher options are faster to evaluate and less likely to break when the UI changes.',
              },
              {
                title: 'Locate by id and CSS',
                detail:
                  'id lookups are the fastest built-in strategy. CSS selectors are readable and support attribute matching, which is ideal for data-testid conventions.',
                code: "from selenium.webdriver.common.by import By\n\n# Fastest — direct id lookup\nusername = driver.find_element(By.ID, 'username')\n\n# CSS selector targeting a dedicated test attribute\nlogin_btn = driver.find_element(By.CSS_SELECTOR, '[data-testid=\"login-submit\"]')",
              },
              {
                title: 'Use XPath only when necessary',
                detail:
                  'XPath can traverse relationships CSS cannot (like "parent of" or "element containing this exact text"), but it is verbose and often brittle. Keep it relative and attribute-based.',
                code: "# XPath: find a button by its visible text\nsubmit = driver.find_element(By.XPATH, \"//button[text()='Login']\")",
              },
              {
                title: 'Find multiple elements (useful case)',
                detail:
                  'find_elements (plural) returns a list instead of raising when nothing matches, which is perfect for lists, tables and search results.',
                code: '# find_elements returns [] instead of throwing if nothing matches\nrows = driver.find_elements(By.CSS_SELECTOR, \'table.results tr\')\nprint(\'rows found:\', len(rows))',
              },
            ],
          },
          {
            id: 'selenium-m2-l2',
            title: 'Explicit Waits',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Eliminate flaky timing issues by waiting for real conditions instead of guessing delays.',
            objectives: [
              'Use WebDriverWait with expected_conditions',
              'Wait for visibility, clickability and text changes',
              'Avoid time.sleep() in test code',
            ],
            practice: 'Automate a login flow that waits for the dashboard to load without a single hard-coded sleep.',
            steps: [
              {
                title: 'Why fixed sleeps fail',
                detail:
                  'time.sleep(5) either wastes time when the app is fast, or fails randomly when the app is slow. Explicit waits poll the page until a condition becomes true, so tests are both quick and stable.',
              },
              {
                title: 'Wait for an element to be clickable',
                detail:
                  'WebDriverWait combined with expected_conditions (EC) is the standard pattern: keep polling until the button is present, visible and enabled.',
                code: "from selenium.webdriver.support.ui import WebDriverWait\nfrom selenium.webdriver.support import expected_conditions as EC\n\nwait = WebDriverWait(driver, 10)  # poll for up to 10 seconds\nbtn = wait.until(EC.element_to_be_clickable((By.ID, 'loginButton')))\nbtn.click()",
              },
              {
                title: 'Wait for a value or text change',
                detail:
                  'After an async action (like an AJAX login), wait for the expected result text to appear rather than assuming a delay is enough.',
                code: "wait.until(EC.text_to_be_present_in_element((By.ID, 'welcome'), 'Welcome'))\n# only proceeds once the welcome text is actually rendered",
              },
              {
                title: 'Wait for an element to disappear (useful case)',
                detail:
                  'Loading spinners are a classic source of flakiness. Wait for invisibility before asserting on what is behind the spinner.',
                code: "wait.until(EC.invisibility_of_element_located((By.ID, 'spinner')))\n# proceeds only once the spinner is gone",
              },
            ],
          },
        ],
        quiz: {
          question: 'Your test clicks a button immediately after a page loads and sometimes fails because the button is not ready yet. What is the recommended fix?',
          options: [
            'Add a fixed time.sleep(5) before every click',
            'Use WebDriverWait with an expected_condition like element_to_be_clickable',
            'Retry the whole test suite until it passes',
            'Remove the assertion causing the failure',
          ],
          correctIndex: 1,
          explanation: 'Explicit waits with expected_conditions poll until the real condition is met, which is faster and far more reliable than a fixed sleep.',
        },
      },
      {
        id: 'selenium-m3',
        title: 'Page Object Model & Test Structure',
        description: 'Keep suites maintainable as they grow.',
        lessons: [
          {
            id: 'selenium-m3-l1',
            title: 'Building Page Objects',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Encapsulate locators and actions per screen so UI changes only touch one file.',
            objectives: [
              'Create a Page Object class per screen',
              'Expose high-level actions instead of raw locators to tests',
              'Reuse page objects across multiple test cases',
            ],
            practice: 'Refactor a login test to use a LoginPage and DashboardPage object.',
            steps: [
              {
                title: 'The problem POM solves',
                detail:
                  'Without structure, the same locator gets copy-pasted into dozens of tests. The Page Object Model puts each screen’s locators and actions into one class, so a UI change means editing a single file instead of many.',
              },
              {
                title: 'Create a LoginPage class',
                detail:
                  'Locators live as attributes; a login() method exposes the business action. Tests never see a raw By selector again.',
                code: "class LoginPage:\n    def __init__(self, driver):\n        self.driver = driver\n\n    def login(self, user, password):\n        self.driver.find_element(By.ID, 'username').send_keys(user)\n        self.driver.find_element(By.ID, 'password').send_keys(password)\n        self.driver.find_element(By.ID, 'loginButton').click()",
              },
              {
                title: 'Create a DashboardPage class',
                detail:
                  'Expose only what tests need to verify, hiding the waiting logic behind a clear method name.',
                code: "class DashboardPage:\n    def __init__(self, driver):\n        self.driver = driver\n\n    def wait_for_load(self):\n        wait = WebDriverWait(self.driver, 10)\n        return wait.until(EC.visibility_of_element_located((By.ID, 'dashboardTitle'))).text",
              },
              {
                title: 'Rewrite the test using pages',
                detail:
                  'The test reads like plain English and contains zero locators, so it survives most UI refactors untouched.',
                code: "def test_login(driver):\n    login = LoginPage(driver)\n    dashboard = DashboardPage(driver)\n    login.login('demo', 'secret')\n    assert 'Welcome' in dashboard.wait_for_load()",
              },
            ],
          },
        ],
        quiz: {
          question: 'The same locators are duplicated across 15 test files, and a UI change now requires editing all of them. What is the recommended long-term fix?',
          options: [
            'Keep duplicating locators since it is faster to write',
            "Refactor each screen's locators and actions into a Page Object class reused by all tests",
            'Delete the failing tests',
            'Hardcode a workaround into the driver binary',
          ],
          correctIndex: 1,
          explanation: 'The Page Object Model centralizes each screen\'s locators and actions in one class, so UI changes only need to be fixed in a single place.',
        },
      },
      {
        id: 'selenium-m4',
        title: 'Cross-Browser & CI/CD',
        description: 'Run suites across browsers and integrate them with pipelines.',
        lessons: [
          {
            id: 'selenium-m4-l1',
            title: 'Cross-Browser Testing & Selenium Grid',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Run the same suite against Chrome, Firefox and remote grids.',
            objectives: [
              'Parameterize tests to run against multiple browsers',
              'Understand Selenium Grid / remote WebDriver basics',
              'Connect to a cloud grid provider',
            ],
            practice: 'Run the same test against Chrome and Firefox locally, then against a remote grid.',
            steps: [
              {
                title: 'Why cross-browser matters',
                detail:
                  'Different browser engines can render and behave slightly differently. Running the same suite across Chrome, Firefox and Edge catches browser-specific regressions before real users do.',
              },
              {
                title: 'Parameterize the browser choice',
                detail:
                  'A small factory function keeps browser selection in one place, so switching browsers is a one-line change.',
                code: "def make_driver(browser: str):\n    if browser == 'firefox':\n        return webdriver.Firefox()\n    return webdriver.Chrome()   # default",
              },
              {
                title: 'Connect to a remote grid',
                detail:
                  'Selenium Remote WebDriver connects to any Selenium Grid endpoint (self-hosted or cloud), so the exact same test code can run on infrastructure you do not manage locally.',
                code: "from selenium.webdriver import Remote\nfrom selenium.webdriver.common.options import ArgOptions\n\ndriver = Remote(\n    command_executor='https://hub.example-grid.com/wd/hub',  # remote grid endpoint\n    options=ArgOptions()\n)",
              },
            ],
          },
          {
            id: 'selenium-m4-l2',
            title: 'CI/CD Integration',
            duration: '25 min',
            level: 'Advanced',
            summary: 'Run headless Selenium suites reliably inside a pipeline.',
            objectives: [
              'Run tests headlessly in a CI job',
              'Publish HTML reports and failure screenshots as artifacts',
              'Apply basic retry strategy for flaky tests',
            ],
            practice: 'Create a CI job that runs the suite headlessly and uploads a report artifact.',
            steps: [
              {
                title: 'Run headless in CI',
                detail:
                  'CI runners typically have no display server, so headless mode is required. It is also faster than a full UI render.',
                code: '- run: |\n    pip install selenium pytest\n    pytest --headless',
              },
              {
                title: 'Publish reports and screenshots',
                detail:
                  'Always upload artifacts even when the job fails, so you can diagnose from screenshots without re-running the suite.',
                code: "- uses: actions/upload-artifact@v4\n  if: always()             # upload even on failure\n  with:\n    name: selenium-artifacts\n    path: |\n      artifacts/\n      report.html",
              },
              {
                title: 'Retry known-flaky tests (useful case)',
                detail:
                  'A small, explicit retry for known-flaky specs prevents a single timing hiccup from failing the whole build, without hiding real regressions.',
                code: '# pytest.ini\n[pytest]\naddopts = --reruns 1 --reruns-delay 2',
              },
            ],
          },
          {
            id: 'selenium-m4-l3',
            title: 'Debugging Flaky Tests & Locator Failures',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Diagnose stale elements, timing races and locator breakage using Selenium\'s own debugging tools.',
            objectives: [
              'Distinguish StaleElementReferenceException from NoSuchElementException',
              'Use explicit waits instead of blind sleeps',
              'Capture screenshots and page source on failure',
              'Debug locator changes using browser DevTools',
            ],
            practice: 'Force a StaleElementReferenceException by re-rendering the DOM, then fix it with a fresh lookup and explicit wait.',
            steps: [
              {
                title: 'Read the exception type first',
                detail:
                  'Selenium failures usually name the exact problem in the exception class. NoSuchElementException means the locator never matched anything; StaleElementReferenceException means it matched, but the DOM node was removed/replaced before you used it (very common after a page re-render or SPA state change). TimeoutException means a wait condition was never satisfied in time. Treat these as different bugs — they have different fixes.',
              },
              {
                title: 'Fix stale elements by re-locating (useful case)',
                detail:
                  'Never cache a WebElement across an action that might re-render the page (a click, a form submit, a React state update). Re-find the element right before you use it so you always hold a reference to the current DOM node.',
                code: '# BAD: element found once, DOM re-renders, then reused -> stale\nbutton = driver.find_element(By.ID, "submit")\ndo_something_that_rerenders_page()\nbutton.click()  # raises StaleElementReferenceException\n\n# GOOD: re-locate immediately before interacting\ndo_something_that_rerenders_page()\ndriver.find_element(By.ID, "submit").click()',
              },
              {
                title: 'Replace sleeps with explicit waits',
                detail:
                  'time.sleep(n) either wastes time (too long) or is flaky (too short). WebDriverWait polls the DOM until the condition is true or a timeout is reached, so it is both faster and more reliable.',
                code: 'from selenium.webdriver.support.ui import WebDriverWait\nfrom selenium.webdriver.support import expected_conditions as EC\n\n# Waits up to 10s, polling frequently, instead of a fixed sleep\nelement = WebDriverWait(driver, 10).until(\n    EC.element_to_be_clickable((By.ID, "submit"))\n)\nelement.click()',
              },
              {
                title: 'Capture a screenshot and page source on failure',
                detail:
                  'A screenshot plus the raw HTML at the moment of failure often shows the answer immediately — a cookie banner covering the button, an error toast, or a completely different page than expected.',
                code: 'def save_failure_artifacts(driver, name):\n    driver.save_screenshot(f"artifacts/{name}.png")\n    with open(f"artifacts/{name}.html", "w") as f:\n        f.write(driver.page_source)   # full rendered DOM at time of failure',
              },
              {
                title: 'Diagnose a broken locator with DevTools (useful case)',
                detail:
                  'When a locator suddenly stops matching, open the app in a real browser, open DevTools (F12), and run the exact CSS selector or XPath in the Console with document.querySelector(...) or $x(...). If it returns null, the markup changed and your locator needs updating — this is much faster than guessing inside the test.',
                code: '// In Chrome DevTools console:\ndocument.querySelector("#submit")      // CSS selector check\n$x("//button[text()=\'Submit\']")        // XPath check (Chrome DevTools helper)',
              },
              {
                title: 'Turn on Selenium/browser driver logs',
                detail:
                  'When even the DOM check does not explain a failure, enable verbose driver logs to see the raw commands sent to the browser and its responses — useful for diagnosing session/driver-level issues rather than app-level ones.',
                code: 'from selenium.webdriver.chrome.service import Service\n\nservice = Service(log_output="chromedriver.log")  # capture driver-level logs\ndriver = webdriver.Chrome(service=service)',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a UI test fails, work through: (1) read the exact exception type, (2) check for a stale element vs. a real missing element, (3) verify the locator in DevTools against the live page, (4) check the failure screenshot/page source, (5) confirm you used an explicit wait rather than a sleep, (6) only then treat it as an application bug.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A test intermittently throws StaleElementReferenceException right after clicking a button that triggers a page re-render. What is the correct fix?',
          options: [
            'Add a long time.sleep() before every interaction',
            'Re-locate the element immediately before interacting with it, instead of reusing a reference captured before the re-render',
            'Catch the exception and ignore it',
            'Restart the browser session before each click',
          ],
          correctIndex: 1,
          explanation: 'StaleElementReferenceException means the previously found DOM node no longer exists after a re-render; re-locating the element right before use ensures you always act on the current node.',
        },
      },
    ],
    resources: [
      { label: 'Official Selenium Documentation', url: 'https://www.selenium.dev/documentation/' },
      { label: 'Selenium Grid', url: 'https://www.selenium.dev/documentation/grid/' },
      { label: 'W3C WebDriver Spec', url: 'https://www.w3.org/TR/webdriver2/' },
    ],
  },
  {
    id: 'postman',
    track: 'frameworks',
    name: 'Postman',
    tagline: 'API design, testing and automation for teams',
    category: 'API Automation',
    frameworkType: 'api',
    icon: MousePointerClick,
    accent: 'teal',
    overview:
      'Postman is the most widely used API client for designing, testing and automating REST APIs. This program covers building collections, writing test scripts, using environments/variables, and running suites headlessly with Newman in CI/CD.',
    prerequisites: [
      'Basic understanding of HTTP (methods, status codes, headers)',
      'Familiarity with JSON',
      'Node.js 18+ installed (needed for the Newman CLI)',
    ],
    outcomes: [
      'Build and organize collections with folders and requests',
      'Write JavaScript test assertions using pm.test',
      'Use environments and variables to run against multiple stages',
      'Automate collection runs headlessly with Newman in CI/CD',
    ],
    modules: [
      {
        id: 'postman-m1',
        title: 'Getting Started with Postman',
        description: 'Install Postman and send your first requests.',
        lessons: [
          {
            id: 'postman-m1-l1',
            title: 'Postman Interface & First Request',
            duration: '25 min',
            level: 'Beginner',
            summary: 'Install Postman, understand the interface, and send your first API request.',
            objectives: [
              'Install Postman (desktop or web)',
              'Send a GET request and inspect the response',
              'Organize requests into a Collection',
            ],
            practice: 'Send a GET request to a public API and inspect the status code and body.',
            steps: [
              {
                title: 'Install Postman',
                detail:
                  'Download the free Postman desktop app for your OS, or use the web version at go.postman.co. Sign in (or work locally) and you are ready to send requests.',
              },
              {
                title: 'Send your first GET request',
                detail:
                  'Choose GET, paste a URL, and hit Send. Postman shows the status code, response time, size, and full body — everything you need to verify an API call worked.',
                code: 'GET https://jsonplaceholder.typicode.com/posts/1\n\n# Expected response:\n# 200 OK\n# { "userId": 1, "id": 1, "title": "...", "body": "..." }',
              },
              {
                title: 'Create a Collection',
                detail:
                  'Collections group related requests (e.g. all "Users" endpoints) so your whole API surface stays organized and shareable with the team.',
              },
              {
                title: 'Inspect headers and status codes (useful case)',
                detail:
                  'The Headers tab shows exactly what the server returned (content-type, caching, rate limits). Checking this early avoids confusing bugs later when writing assertions.',
              },
            ],
          },
        ],
        quiz: {
          question: 'You want to group all "Orders" API endpoints together for your team to reuse. What Postman feature should you use?',
          options: [
            'A Collection',
            'A single saved request with no folder',
            'Browser bookmarks',
            'A new Postman account per endpoint',
          ],
          correctIndex: 0,
          explanation: 'Collections group related requests into folders, making it easy to organize, share and run a whole API surface together.',
        },
      },
      {
        id: 'postman-m2',
        title: 'Writing Test Scripts',
        description: 'Add assertions to validate API responses automatically.',
        lessons: [
          {
            id: 'postman-m2-l1',
            title: 'pm.test() Assertions',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Write JavaScript test scripts that validate status codes, response bodies and headers.',
            objectives: [
              'Write assertions using pm.test and pm.expect',
              'Validate status code, response time and JSON structure',
              'Use pm.response.json() to parse the body',
            ],
            practice: 'Write a test script that checks status 200, response time under 500ms, and a valid JSON shape.',
            steps: [
              {
                title: 'Where test scripts live',
                detail:
                  'Each request has a "Tests" tab (or "Post-response" script in newer Postman) where you write plain JavaScript that runs after the response arrives.',
              },
              {
                title: 'Assert the status code',
                detail:
                  'pm.test wraps an assertion with a readable name. If the pm.expect() check inside fails, the whole test is marked failed and reported.',
                code: "pm.test('Status code is 200', function () {\n  pm.response.to.have.status(200);   // built-in status assertion\n});",
              },
              {
                title: 'Validate the JSON body',
                detail:
                  'Parse the response as JSON, then assert on its shape. This catches both wrong data and broken contracts early.',
                code: "pm.test('Response has expected fields', function () {\n  const body = pm.response.json();     // parse JSON body\n  pm.expect(body).to.have.property('id');\n  pm.expect(body.title).to.be.a('string');\n});",
              },
              {
                title: 'Check response time (useful case)',
                detail:
                  'Performance regressions matter too. Assert the response time stays under an agreed budget so slow endpoints get flagged automatically.',
                code: "pm.test('Response time is acceptable', function () {\n  pm.expect(pm.response.responseTime).to.be.below(500); // ms\n});",
              },
            ],
          },
        ],
        quiz: {
          question: 'You want an automated check that fails the request run if the API takes longer than 500ms to respond. What should you write in the Tests tab?',
          options: [
            "pm.test with pm.expect(pm.response.responseTime).to.be.below(500)",
            'Manually time the request with a stopwatch',
            'Add a comment saying "check performance later"',
            'Nothing — Postman cannot measure response time',
          ],
          correctIndex: 0,
          explanation: 'pm.response.responseTime exposes the request duration in milliseconds, which can be asserted directly in a pm.test block.',
        },
      },
      {
        id: 'postman-m3',
        title: 'Environments, Variables & Newman CI',
        description: 'Run the same collection across stages and automate it in pipelines.',
        lessons: [
          {
            id: 'postman-m3-l1',
            title: 'Environments & Variables',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Parameterize requests so the same collection runs against dev, staging and prod.',
            objectives: [
              'Create environments with base URLs and secrets',
              'Use {{variable}} syntax in requests',
              'Chain requests by saving values between them',
            ],
            practice: 'Create dev and staging environments and switch between them without editing any request.',
            steps: [
              {
                title: 'Why environments matter',
                detail:
                  'Hardcoding a URL into every request means you cannot easily test staging vs production. Environments store variables like baseUrl and apiKey, letting you swap targets from a dropdown.',
              },
              {
                title: 'Use variables in a request',
                detail:
                  'Reference environment variables with double curly braces. Postman substitutes the active environment\'s value at request time.',
                code: 'GET {{baseUrl}}/users/{{userId}}\nAuthorization: Bearer {{apiToken}}',
              },
              {
                title: 'Chain requests with saved values (useful case)',
                detail:
                  'Save a value from one response (like an auth token or created resource id) into an environment variable so the next request can use it automatically.',
                code: "// In the 'Tests' tab of a login request:\nconst token = pm.response.json().access_token;\npm.environment.set('apiToken', token);  // used by later requests",
              },
            ],
          },
          {
            id: 'postman-m3-l2',
            title: 'Automating Runs with Newman',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Run Postman collections headlessly from the command line and in CI/CD pipelines.',
            objectives: [
              'Install and run Newman from the CLI',
              'Export a collection and environment as JSON',
              'Publish HTML/JUnit reports from a CI job',
            ],
            practice: 'Export your collection and environment, then run them headlessly with Newman and generate an HTML report.',
            steps: [
              {
                title: 'Install Newman',
                detail:
                  'Newman is Postman\'s official command-line collection runner, distributed as an npm package so it runs anywhere Node.js runs — including CI.',
                code: 'npm install -g newman\nnewman --version',
              },
              {
                title: 'Export collection and environment',
                detail:
                  'From Postman, export both the collection and the target environment as JSON files. These are the two inputs Newman needs to reproduce a run headlessly.',
              },
              {
                title: 'Run headlessly',
                detail:
                  'Point Newman at the exported files. It executes every request and every pm.test assertion, printing a pass/fail summary — no UI required.',
                code: 'newman run collection.json -e staging.environment.json',
              },
              {
                title: 'Generate a CI-friendly report (useful case)',
                detail:
                  'Add reporters to produce machine-readable JUnit XML (for CI test result panels) alongside a human-friendly HTML report.',
                code: 'newman run collection.json -e staging.environment.json \\\n  --reporters cli,junit,htmlextra \\\n  --reporter-junit-export results/junit.xml \\\n  --reporter-htmlextra-export results/report.html',
              },
              {
                title: 'Wire it into a CI job',
                detail:
                  'Run Newman as a normal pipeline step and always upload the reports, even on failure, so a broken run can be diagnosed without repeating it locally.',
                code: "- run: newman run collection.json -e ci.environment.json --reporters cli,junit\n- uses: actions/upload-artifact@v4\n  if: always()\n  with:\n    name: newman-results\n    path: results/",
              },
            ],
          },
          {
            id: 'postman-m3-l3',
            title: 'Debugging Failed Requests & Newman Runs',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Diagnose failing pm.test assertions, broken variables and CI-only failures efficiently.',
            objectives: [
              'Use the Postman Console to inspect the actual request/response',
              'Debug undefined or wrongly-scoped variables',
              'Interpret Newman CLI output and exit codes',
              'Handle environment differences between local and CI runs',
            ],
            practice: 'Force a variable to resolve incorrectly (wrong scope), then use the Postman Console and Newman verbose output to find and fix it.',
            steps: [
              {
                title: 'Open the Postman Console first',
                detail:
                  'View > Show Postman Console (or Cmd/Ctrl+Alt+C) reveals the exact request sent — full URL, headers, and body — plus the raw response. Most "test failed" mysteries are solved by comparing what you assumed was sent against what the Console shows was actually sent.',
              },
              {
                title: 'Debug variable scope issues (useful case)',
                detail:
                  'Postman has multiple variable scopes (global, environment, collection, local) and a variable set in the wrong scope silently resolves to undefined elsewhere. Use pm.variables.get() during debugging to see the final resolved value regardless of scope, and console.log it.',
                code: "// In a pre-request or test script:\nconsole.log('resolved baseUrl:', pm.variables.get('baseUrl'))\nconsole.log('environment token:', pm.environment.get('apiToken'))\nconsole.log('collection default:', pm.collectionVariables.get('apiVersion'))",
              },
              {
                title: 'Log inside pm.test for clarity',
                detail:
                  'When an assertion fails, print the actual value you received before asserting on it. This turns a bare "AssertionError: expected undefined to equal ..." into an obvious explanation.',
                code: "pm.test('user has an email', function () {\n  const body = pm.response.json()\n  console.log('full body:', JSON.stringify(body))  // see exactly what came back\n  pm.expect(body.email).to.be.a('string')\n})",
              },
              {
                title: 'Run Newman with verbose output',
                detail:
                  'When a collection fails only in CI, reproduce it locally with the same environment file and verbose logging, which prints full request/response details for every call, not just the summary.',
                code: '# --verbose prints full request & response bodies/headers for every call\nnewman run collection.json -e ci.environment.json --verbose',
              },
              {
                title: 'Diagnose local-vs-CI differences (useful case)',
                detail:
                  'A common cause of "works locally, fails in CI" is a different environment file, missing secret, or a stale collection export. Confirm the CI job uses the exact same exported JSON files you tested locally, and that any secrets (API keys) are injected via CI environment variables rather than hardcoded.',
                code: "// pre-request script — fail fast with a clear message if a secret is missing\nif (!pm.environment.get('apiToken')) {\n  throw new Error('apiToken is missing — check CI secrets/environment file')\n}",
              },
              {
                title: 'Read Newman exit codes',
                detail:
                  'Newman exits 0 only if every test assertion passed. A non-zero exit code in CI logs, combined with the JUnit report, tells you exactly which request and assertion failed without needing to re-run interactively.',
                code: 'newman run collection.json -e staging.environment.json\necho "exit code: $?"   # 0 = all assertions passed, non-zero = at least one failed',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a Postman/Newman run fails: (1) open the Console (or --verbose) and compare the actual request/response to what you expect, (2) log resolved variables to catch scope issues, (3) confirm CI uses the same environment file as your local run, (4) check the JUnit/HTML report for the specific failing assertion, (5) only then suspect the API itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A pm.test assertion fails with "expected undefined to equal ..." only when the collection runs in Newman inside CI, but passes locally in the Postman app. What should you check first?',
          options: [
            'Assume Newman is broken and stop using it',
            'Confirm the CI job is using the same exported environment file/variables as your local run, since a missing or differently-scoped variable is the most common cause',
            'Delete the failing assertion',
            'Increase the request timeout to fix it',
          ],
          correctIndex: 1,
          explanation: 'An undefined value in an assertion almost always traces back to a variable that is missing or scoped differently between environments — verifying the CI environment file matches what you tested locally is the fastest way to confirm this.',
        },
      },
    ],
    resources: [
      { label: 'Official Postman Learning Center', url: 'https://learning.postman.com/' },
      { label: 'Newman CLI', url: 'https://github.com/postmanlabs/newman' },
      { label: 'Postman Test Scripts Reference', url: 'https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/' },
    ],
  },
  {
    id: 'cypress',
    track: 'frameworks',
    name: 'Cypress',
    tagline: 'Fast, developer-friendly end-to-end testing for modern web apps',
    category: 'Web UI Automation',
    frameworkType: 'web',
    icon: Zap,
    accent: 'emerald',
    overview:
      'Cypress is a JavaScript-native E2E framework that runs directly in the browser alongside your app, giving fast, reliable tests with automatic waiting and time-travel debugging. This program covers setup, selectors, network stubbing, and CI integration with real, runnable commands.',
    prerequisites: [
      'Basic JavaScript/TypeScript knowledge',
      'Node.js 18+ installed',
      'Familiarity with npm and a code editor',
    ],
    outcomes: [
      'Write and run Cypress tests with automatic retry-ability',
      'Use robust selectors and custom commands',
      'Stub and assert on network requests with cy.intercept',
      'Run Cypress suites headlessly in CI/CD pipelines',
    ],
    modules: [
      {
        id: 'cypress-m1',
        title: 'Getting Started with Cypress',
        description: 'Install Cypress and write your first test.',
        lessons: [
          {
            id: 'cypress-m1-l1',
            title: 'Installing & Running Cypress',
            duration: '25 min',
            level: 'Beginner',
            summary: 'Install Cypress, open the Test Runner, and understand how it runs tests inside the browser.',
            objectives: [
              'Install Cypress via npm',
              'Open the interactive Test Runner',
              'Understand why Cypress runs in-browser (not over WebDriver)',
            ],
            practice: 'Install Cypress in a project and open the Test Runner against a sample spec.',
            steps: [
              {
                title: 'Why Cypress is different',
                detail:
                  'Unlike Selenium/WebDriver tools that drive a browser from the outside, Cypress runs directly inside the browser in the same run-loop as your application. This gives it native access to the DOM, network layer and JS runtime — enabling automatic waiting and detailed time-travel snapshots without extra glue code.',
              },
              {
                title: 'Install Cypress',
                detail:
                  'Cypress installs as a regular dev dependency; the binary itself is downloaded automatically on first install.',
                code: '# Install as a dev dependency\nnpm install --save-dev cypress',
              },
              {
                title: 'Open the Test Runner',
                detail:
                  'The interactive Test Runner shows your app in a real browser next to a live command log, making it easy to see exactly what each step did and why it passed or failed.',
                code: '# Opens the interactive Test Runner\nnpx cypress open',
              },
              {
                title: 'Run headlessly (useful case)',
                detail:
                  'For CI and quick feedback, run the whole suite in the terminal without any UI, producing a pass/fail summary.',
                code: '# Runs all specs headlessly in the terminal\nnpx cypress run',
              },
            ],
          },
          {
            id: 'cypress-m1-l2',
            title: 'Your First Test',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Write a real Cypress spec that visits a page, interacts with it, and asserts the result.',
            objectives: [
              'Structure a spec with describe/it',
              'Use cy.visit, cy.get and cy.contains',
              'Chain assertions with should',
            ],
            practice: 'Write a spec that logs into a demo app and asserts the dashboard is visible.',
            steps: [
              {
                title: 'Anatomy of a spec file',
                detail:
                  'A Cypress spec is plain JavaScript/TypeScript using Mocha-style describe/it blocks. Each it() reads like a step-by-step user story.',
                code: "describe('Login', () => {\n  it('logs in with valid credentials', () => {\n    cy.visit('/login')                         // open the page\n    cy.get('[data-cy=username]').type('demo')   // type into a field\n    cy.get('[data-cy=password]').type('secret')\n    cy.get('[data-cy=submit]').click()          // submit the form\n  })\n})",
              },
              {
                title: 'Assert with should',
                detail:
                  'should() chains onto any command and automatically retries until the assertion passes or a timeout is reached — this is the core of Cypress\'s built-in reliability.',
                code: "cy.get('[data-cy=dashboard-title]')\n  .should('be.visible')          // waits until visible\n  .and('contain.text', 'Welcome') // and contains this text",
              },
              {
                title: 'Use cy.contains for text-based lookups (useful case)',
                detail:
                  'When there is no test id, cy.contains finds an element by its visible text — handy for quick checks, though data-cy attributes remain the more stable long-term choice.',
                code: "cy.contains('Sign out').click()  // finds any element containing this text",
              },
            ],
          },
        ],
        quiz: {
          question: 'Why does Cypress not need explicit waits the way Selenium often does?',
          options: [
            'Cypress commands like should() automatically retry until the assertion passes or times out',
            'Cypress disables all timing checks entirely',
            'Cypress tests always run instantly with no network calls',
            'Cypress requires manual cy.wait() before every single command',
          ],
          correctIndex: 0,
          explanation: 'Cypress bakes automatic retry-ability into commands and assertions, polling until the condition is true or the timeout elapses, removing most manual wait logic.',
        },
      },
      {
        id: 'cypress-m2',
        title: 'Selectors, Custom Commands & Network Stubbing',
        description: 'Write maintainable tests and control network behavior.',
        lessons: [
          {
            id: 'cypress-m2-l1',
            title: 'Robust Selectors & Custom Commands',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Use data-cy attributes and extract reusable custom commands.',
            objectives: [
              'Prefer data-cy attributes over CSS classes',
              'Create a custom Cypress command',
              'Reuse commands across specs',
            ],
            practice: 'Extract a login flow into a cy.login() custom command and reuse it in two specs.',
            steps: [
              {
                title: 'Prefer dedicated test attributes',
                detail:
                  'CSS classes and structure change often for styling reasons; a dedicated data-cy attribute is stable because it exists only for testing and nothing else touches it.',
                code: '<button data-cy="submit">Log in</button>',
              },
              {
                title: 'Create a custom command',
                detail:
                  'Custom commands extend the cy object with your own reusable actions, defined once in a support file and available in every spec.',
                code: "// cypress/support/commands.js\nCypress.Commands.add('login', (user, pass) => {\n  cy.visit('/login')\n  cy.get('[data-cy=username]').type(user)\n  cy.get('[data-cy=password]').type(pass)\n  cy.get('[data-cy=submit]').click()\n})",
              },
              {
                title: 'Reuse it in tests (useful case)',
                detail:
                  'Once defined, the command reads like a single readable step, and any change to the login flow only needs to be fixed in one place.',
                code: "it('shows the dashboard after login', () => {\n  cy.login('demo', 'secret')   // one line, reused everywhere\n  cy.get('[data-cy=dashboard-title]').should('be.visible')\n})",
              },
            ],
          },
          {
            id: 'cypress-m2-l2',
            title: 'Network Stubbing with cy.intercept',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Control and assert on network calls to write fast, deterministic tests.',
            objectives: [
              'Stub API responses with cy.intercept',
              'Wait for a specific network call with cy.wait',
              'Assert on request payloads',
            ],
            practice: 'Stub a slow /api/orders endpoint and assert the UI shows a loading state then the mocked data.',
            steps: [
              {
                title: 'Why stub the network',
                detail:
                  'Hitting a real backend makes tests slow and flaky (shared test data, rate limits, downtime). cy.intercept lets you fake responses instantly and deterministically, focused purely on frontend behavior.',
              },
              {
                title: 'Stub a response',
                detail:
                  'Register an intercept before the action that triggers the request, then trigger it. The alias (as) lets you refer to this specific call later.',
                code: "cy.intercept('GET', '/api/orders', { fixture: 'orders.json' }).as('getOrders')\ncy.visit('/orders')\ncy.wait('@getOrders')  // waits until this exact call resolves",
              },
              {
                title: 'Assert the UI reflects the mocked data',
                detail:
                  'Because the data is fully controlled, assertions are precise and never depend on real backend state.',
                code: "cy.get('[data-cy=order-row]').should('have.length', 3) // matches fixture data",
              },
              {
                title: 'Assert on the outgoing request (useful case)',
                detail:
                  'cy.wait() resolves with the intercepted call\'s request/response, letting you verify your frontend sent the correct payload — not just that it handled the response.',
                code: "cy.wait('@getOrders').its('request.url').should('include', 'status=open')",
              },
            ],
          },
        ],
        quiz: {
          question: 'Your E2E test depends on a slow, flaky third-party API and you only want to verify frontend behavior. What is the recommended Cypress approach?',
          options: [
            'Stub the network call with cy.intercept so the test controls the response deterministically',
            'Add a longer cy.wait() and hope the API responds in time',
            'Skip the test entirely',
            'Call the real API twice in a row',
          ],
          correctIndex: 0,
          explanation: 'cy.intercept lets you mock network responses, decoupling frontend tests from real backend availability and making them fast and deterministic.',
        },
      },
      {
        id: 'cypress-m3',
        title: 'CI/CD Integration',
        description: 'Run Cypress suites reliably inside pipelines.',
        lessons: [
          {
            id: 'cypress-m3-l1',
            title: 'Running Cypress in CI',
            duration: '25 min',
            level: 'Advanced',
            summary: 'Run headless Cypress suites in a pipeline and publish videos/screenshots on failure.',
            objectives: [
              'Run cypress run in a CI job',
              'Publish screenshots and videos as artifacts',
              'Parallelize specs across CI machines',
            ],
            practice: 'Create a CI job that runs the suite headlessly and uploads failure screenshots.',
            steps: [
              {
                title: 'Run headlessly in CI',
                detail:
                  'The same command used locally works in CI with no extra flags, since Cypress runs headless by default with cypress run.',
                code: '- run: npx cypress run',
              },
              {
                title: 'Publish artifacts on failure',
                detail:
                  'Cypress automatically captures a screenshot on failure and (optionally) a video of the whole run — always upload these so failures can be debugged without re-running.',
                code: "- uses: actions/upload-artifact@v4\n  if: always()\n  with:\n    name: cypress-artifacts\n    path: |\n      cypress/screenshots\n      cypress/videos",
              },
              {
                title: 'Parallelize across machines (useful case)',
                detail:
                  'For large suites, Cypress Cloud can split specs across multiple CI machines and combine the results, cutting total run time significantly.',
                code: '- run: npx cypress run --record --parallel --key $CYPRESS_RECORD_KEY',
              },
            ],
          },
          {
            id: 'cypress-m3-l2',
            title: 'Debugging Cypress Failures',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Use the Cypress Test Runner, time-travel debugging and command logs to resolve failures fast.',
            objectives: [
              'Use the Test Runner\'s time-travel snapshots',
              'Debug with cy.pause(), .debug() and browser DevTools',
              'Avoid arbitrary waits and race conditions',
              'Interpret failure screenshots/videos from headless runs',
            ],
            practice: 'Force a failing assertion, then use time-travel debugging in the Test Runner to inspect the DOM at that exact command.',
            steps: [
              {
                title: 'Open the interactive Test Runner',
                detail:
                  'cypress open launches an interactive browser with the Command Log on the side. Every command (visit, click, get) is listed; hovering over one shows a DOM snapshot from that exact moment — "time travel" debugging that headless runs cannot give you.',
                code: '# Launch the interactive runner for local debugging\nnpx cypress open',
              },
              {
                title: 'Pause execution at a specific point',
                detail:
                  'cy.pause() halts the test right where it is placed so you can manually inspect the app state, click around, or open DevTools before resuming.',
                code: "cy.visit('/login')\ncy.get('#username').type('demo')\ncy.pause()               // execution stops here until you click \"Resume\"\ncy.get('#password').type('secret')",
              },
              {
                title: 'Use .debug() to drop into the console (useful case)',
                detail:
                  '.debug() logs the current subject to the browser console and triggers a debugger breakpoint if DevTools is open, letting you inspect the exact element Cypress is about to act on.',
                code: "cy.get('.submit-button')\n  .debug()          // inspect the yielded element in DevTools console\n  .click()",
              },
              {
                title: 'Avoid races with automatic retry-ability',
                detail:
                  'Cypress commands like cy.get() and .should() automatically retry until the assertion passes or a timeout is reached — you rarely need cy.wait(fixedMs). If you find yourself adding arbitrary waits, it usually means you should assert on a condition instead.',
                code: "// BAD: arbitrary fixed wait, flaky and slow\ncy.wait(2000)\ncy.get('.result').should('contain', 'Success')\n\n// GOOD: Cypress retries the assertion automatically until it passes or times out\ncy.get('.result', { timeout: 10000 }).should('contain', 'Success')",
              },
              {
                title: 'Read headless failure artifacts (useful case)',
                detail:
                  'In CI, cypress run has no interactive runner, but it automatically saves a screenshot at the point of failure and (if enabled) a video of the whole spec. Download these from the uploaded artifacts and inspect them exactly like you would the live Test Runner.',
                code: '// cypress.config.js — ensure video is enabled for CI debugging\nmodule.exports = {\n  video: true,\n  screenshotOnRunFailure: true,\n}',
              },
              {
                title: 'Inspect network calls that a test depends on',
                detail:
                  'When a test fails because data never appeared, check whether the underlying API call happened at all and what it returned, using cy.intercept as a debugging aid, not just a stub.',
                code: "cy.intercept('GET', '/api/users').as('getUsers')\ncy.visit('/users')\ncy.wait('@getUsers').then((interception) => {\n  console.log('status:', interception.response.statusCode)\n  console.log('body:', interception.response.body)\n})",
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a Cypress test fails: (1) reproduce locally with cypress open and time-travel to the failing command, (2) check if you are using a fixed wait instead of retry-ability, (3) inspect underlying network calls with cy.intercept, (4) in CI, review the screenshot/video artifact, (5) only then suspect the app itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'You notice a test only fails occasionally, and you suspect it is because data loads asynchronously and cy.wait(2000) is not always long enough. What is the recommended fix?',
          options: [
            'Increase the fixed wait to a much larger number like cy.wait(10000)',
            "Assert directly on the expected UI state (e.g. cy.get(...).should('contain', ...)) and let Cypress's built-in retry-ability handle the timing",
            'Remove the assertion entirely',
            'Run the test only once and hope it passes',
          ],
          correctIndex: 1,
          explanation: "Cypress commands and assertions automatically retry until they pass or time out, which handles async timing far more reliably than a fixed cy.wait(ms).",
        },
      },
    ],
    resources: [
      { label: 'Official Cypress Documentation', url: 'https://docs.cypress.io/' },
      { label: 'Cypress Best Practices', url: 'https://docs.cypress.io/guides/references/best-practices' },
      { label: 'Cypress GitHub Action', url: 'https://github.com/cypress-io/github-action' },
    ],
  },
  {
    id: 'robotframework',
    track: 'frameworks',
    name: 'Robot Framework',
    tagline: 'Keyword-driven automation for web, API and acceptance testing',
    category: 'Keyword-Driven Automation',
    frameworkType: 'keyword-driven',
    icon: Bot,
    accent: 'indigo',
    overview:
      'Robot Framework is a generic, keyword-driven automation framework popular for acceptance testing and RPA, readable even by non-programmers. This program covers writing test cases in plain-text syntax, using the SeleniumLibrary/Browser library for web UI, and running suites in CI.',
    prerequisites: [
      'Python 3.9+ installed',
      'Basic command-line familiarity',
      'Basic HTML understanding for web locators',
    ],
    outcomes: [
      'Write readable, keyword-driven test cases',
      'Automate web UIs with the Browser (Playwright-based) library',
      'Use variables, resource files and custom keywords',
      'Run suites with reporting and integrate them into CI/CD',
    ],
    modules: [
      {
        id: 'robotframework-m1',
        title: 'Getting Started with Robot Framework',
        description: 'Install Robot Framework and write your first test case.',
        lessons: [
          {
            id: 'robotframework-m1-l1',
            title: 'Installation & Test Structure',
            duration: '25 min',
            level: 'Beginner',
            summary: 'Install Robot Framework and understand its plain-text, keyword-driven test syntax.',
            objectives: [
              'Install Robot Framework via pip',
              'Understand Settings/Variables/Test Cases/Keywords sections',
              'Run a suite and read the generated report',
            ],
            practice: 'Install Robot Framework and run a one-line "Log" test, then open the generated report.',
            steps: [
              {
                title: 'Why keyword-driven testing',
                detail:
                  'Robot Framework tests are written as plain-text keywords (Open Browser, Click Element, Should Be Equal) rather than code in a general-purpose language. This makes test cases readable by manual testers and business stakeholders, while the underlying keywords are implemented in Python or other libraries.',
              },
              {
                title: 'Install Robot Framework',
                detail:
                  'Robot Framework is a Python package installed with pip; the core framework alone does not include web/API libraries — those are added separately.',
                code: 'pip install robotframework',
              },
              {
                title: 'Understand the file sections',
                detail:
                  'A .robot file has clearly separated sections. *** Settings *** imports libraries, *** Variables *** defines reusable values, and *** Test Cases *** lists the actual scenarios using keywords.',
                code: '*** Settings ***\nLibrary    Collections\n\n*** Variables ***\n${MESSAGE}    Hello, Robot Framework!\n\n*** Test Cases ***\nLog A Message\n    Log    ${MESSAGE}',
              },
              {
                title: 'Run the suite and view the report',
                detail:
                  'Running any .robot file produces log.html (detailed step-by-step trace) and report.html (high-level pass/fail summary) automatically — no extra reporting library needed.',
                code: '# Runs the suite and generates report.html + log.html\nrobot my_first_test.robot',
              },
            ],
          },
        ],
        quiz: {
          question: 'What is the main reason teams choose Robot Framework for acceptance tests over a general-purpose scripting approach?',
          options: [
            'Its plain-text keyword syntax is readable by non-programmers and business stakeholders',
            'It runs tests faster than every other framework in all cases',
            'It only supports API testing, not UI testing',
            'It requires no reporting since results are never generated',
          ],
          correctIndex: 0,
          explanation: 'Robot Framework\'s keyword-driven, plain-text syntax is designed to be readable by both engineers and non-technical stakeholders, which is its main differentiator.',
        },
      },
      {
        id: 'robotframework-m2',
        title: 'Web Automation with the Browser Library',
        description: 'Automate real browsers using keywords backed by Playwright.',
        lessons: [
          {
            id: 'robotframework-m2-l1',
            title: 'Browser Library Basics',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Install the Playwright-based Browser library and automate a login flow with keywords.',
            objectives: [
              'Install and initialize the Browser library',
              'Use New Browser/New Page, Fill Text and Click',
              'Assert with Get Text and built-in auto-waiting',
            ],
            practice: 'Write a keyword-driven test that logs into a demo app and asserts the dashboard title.',
            steps: [
              {
                title: 'Why the Browser library',
                detail:
                  'The Browser library is built on Playwright under the hood, giving Robot Framework fast, modern browser automation with auto-waiting — similar reliability benefits to Cypress/Playwright, but expressed as Robot keywords.',
              },
              {
                title: 'Install the library',
                detail:
                  'Installing pulls in the Robot Framework Browser package and its Node.js/Playwright dependencies via a one-time init command.',
                code: 'pip install robotframework-browser\nrfbrowser init          # installs Playwright browser binaries',
              },
              {
                title: 'Open a browser and page',
                detail:
                  'New Browser launches an engine (chromium/firefox/webkit); New Page opens a tab and navigates to a URL — the two keywords you use to start almost every web test.',
                code: '*** Settings ***\nLibrary    Browser\n\n*** Test Cases ***\nOpen Login Page\n    New Browser    chromium    headless=False\n    New Page    https://example.com/login',
              },
              {
                title: 'Fill in the form and submit',
                detail:
                  'Fill Text and Click use CSS/text selectors just like other modern frameworks, with automatic waiting for elements to be actionable.',
                code: 'Fill Text    css=#username    demo\nFill Text    css=#password    secret\nClick    css=#submit',
              },
              {
                title: 'Assert the result (useful case)',
                detail:
                  'Get Text retrieves an element\'s text; combined with Should Contain, this becomes a readable, self-documenting assertion.',
                code: '${title}=    Get Text    css=#dashboard-title\nShould Contain    ${title}    Welcome',
              },
            ],
          },
        ],
        quiz: {
          question: 'Which underlying automation engine powers the modern Robot Framework Browser library?',
          options: [
            'Playwright',
            'Selenium WebDriver exclusively',
            'A completely custom, unrelated browser engine',
            'It does not automate real browsers at all',
          ],
          correctIndex: 0,
          explanation: 'The Robot Framework Browser library is built on top of Playwright, providing fast execution and automatic waiting for web automation.',
        },
      },
      {
        id: 'robotframework-m3',
        title: 'Reusable Keywords & CI Integration',
        description: 'Structure suites for reuse and run them in pipelines.',
        lessons: [
          {
            id: 'robotframework-m3-l1',
            title: 'Custom Keywords & Resource Files',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Extract reusable custom keywords into resource files shared across suites.',
            objectives: [
              'Define a custom keyword in the Keywords section',
              'Move shared keywords into a .resource file',
              'Import a resource file from multiple test suites',
            ],
            practice: 'Extract a "Log In As" keyword into a shared resource file and use it from two test suites.',
            steps: [
              {
                title: 'Define a custom keyword',
                detail:
                  'Keywords section lets you compose existing keywords into a new, higher-level, named step — exactly like extracting a function.',
                code: '*** Keywords ***\nLog In As\n    [Arguments]    ${user}    ${pass}\n    Fill Text    css=#username    ${user}\n    Fill Text    css=#password    ${pass}\n    Click    css=#submit',
              },
              {
                title: 'Move it to a resource file',
                detail:
                  'A .resource file holds shared keywords and settings so multiple .robot suites can reuse the same logic without duplication.',
                code: '# common.resource\n*** Settings ***\nLibrary    Browser\n\n*** Keywords ***\nLog In As\n    [Arguments]    ${user}    ${pass}\n    Fill Text    css=#username    ${user}\n    Fill Text    css=#password    ${pass}\n    Click    css=#submit',
              },
              {
                title: 'Import and reuse it (useful case)',
                detail:
                  'Any suite that imports the resource file gets access to Log In As, so a locator change only needs to be fixed once.',
                code: '*** Settings ***\nResource    common.resource\n\n*** Test Cases ***\nValid Login\n    New Browser    chromium\n    New Page    https://example.com/login\n    Log In As    demo    secret',
              },
            ],
          },
          {
            id: 'robotframework-m3-l2',
            title: 'CI/CD Integration',
            duration: '25 min',
            level: 'Advanced',
            summary: 'Run Robot Framework suites headlessly in CI and publish reports.',
            objectives: [
              'Run robot in headless mode in a CI job',
              'Publish log.html/report.html as artifacts',
              'Fail the CI job correctly based on Robot\'s exit code',
            ],
            practice: 'Create a CI job that installs dependencies, runs the suite headlessly, and uploads the HTML report.',
            steps: [
              {
                title: 'Run headlessly',
                detail:
                  'Pass headless=True as a variable to keep the same suite code working both locally (visible browser) and in CI (no display).',
                code: 'robot --variable headless:True tests/',
              },
              {
                title: 'Publish the reports',
                detail:
                  'Always upload log.html and report.html, even on failure, since the step-by-step log is often the fastest way to pinpoint what broke.',
                code: "- uses: actions/upload-artifact@v4\n  if: always()\n  with:\n    name: robot-reports\n    path: |\n      log.html\n      report.html",
              },
              {
                title: 'Respect the exit code (useful case)',
                detail:
                  'Robot Framework already returns a non-zero exit code when tests fail, so most CI systems fail the job automatically — no extra logic needed unless you want custom thresholds.',
                code: '# robot exits non-zero automatically on any failed test\nrobot tests/ || exit 1',
              },
            ],
          },
          {
            id: 'robotframework-m3-l3',
            title: 'Debugging with log.html and Reports',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Use Robot Framework\'s built-in logging to pinpoint failing keywords without adding print statements.',
            objectives: [
              'Navigate log.html to find the exact failing keyword',
              'Use Log and Log To Console for targeted debugging',
              'Debug variable values with Log Variables',
              'Re-run only failed tests to speed up iteration',
            ],
            practice: 'Break a keyword argument, run the suite, then use log.html to trace the failure to its exact line.',
            steps: [
              {
                title: 'log.html is your primary debugging tool',
                detail:
                  'Every robot run generates log.html: a full, expandable tree of every suite, test and keyword call, including arguments passed and values returned. Unlike a flat console log, you can drill into the exact keyword that failed and see precisely what it received.',
                code: '# After a run, open the generated log in a browser\nrobot tests/\nopen log.html   # macOS; use start log.html on Windows',
              },
              {
                title: 'Find the failing keyword in the tree',
                detail:
                  'Failed tests are highlighted in red in log.html. Expand the test to see which specific keyword call failed, and expand that keyword to see the exact arguments it was called with — often revealing a typo or wrong variable value immediately.',
              },
              {
                title: 'Add targeted logging (useful case)',
                detail:
                  'When the built-in log is not enough, add explicit Log calls to print intermediate values. Log To Console additionally prints to the terminal in real time, which is useful for long-running suites in CI.',
                code: '*** Test Cases ***\nCheckout Flow\n    ${total}=    Get Text    css=#cart-total\n    Log    Cart total was: ${total}          # visible in log.html\n    Log To Console    Cart total was: ${total}  # also visible in terminal output\n    Should Be Equal    ${total}    $49.99',
              },
              {
                title: 'Dump all current variables',
                detail:
                  'Log Variables prints every variable currently in scope to the log — extremely useful when you are not sure which variable holds the wrong value or has not been set at all.',
                code: '*** Test Cases ***\nDebug Variable State\n    ${user}=    Set Variable    demo\n    Log Variables    # dumps every variable and its current value to log.html',
              },
              {
                title: 'Re-run only the failed tests (useful case)',
                detail:
                  'After fixing an issue, you do not need to re-run the whole suite. Robot Framework can re-run just the tests that failed last time, from the generated output.xml, which speeds up the debug loop significantly.',
                code: '# --rerunfailed points at the previous run\'s output.xml\nrobot --rerunfailed output.xml --output rerun.xml tests/',
              },
              {
                title: 'Increase log verbosity for stubborn issues',
                detail:
                  'For deep debugging (e.g. library internals), raise the log level to include TRACE/DEBUG messages, which show every low-level keyword call made internally by libraries like Browser or SeleniumLibrary.',
                code: '# --loglevel DEBUG shows internal library calls, useful for hard-to-explain failures\nrobot --loglevel DEBUG tests/',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a suite fails: (1) open log.html and find the exact red keyword, (2) check the arguments it received, (3) add Log/Log Variables around the suspicious area if needed, (4) re-run only the failed tests while iterating, (5) raise --loglevel DEBUG only if the failure is still unclear.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A Robot Framework test fails and you are not sure which specific keyword call caused it or what arguments it received. What is the most direct way to find out?',
          options: [
            'Add print() statements throughout every keyword file',
            'Open the generated log.html and drill into the failing test to inspect the exact keyword call and its arguments',
            'Re-run the entire suite repeatedly and guess',
            'Robot Framework provides no way to inspect keyword-level detail',
          ],
          correctIndex: 1,
          explanation: 'log.html gives a full expandable tree of every keyword call with its arguments and results, making it the fastest way to trace a failure to its exact source without adding manual logging.',
        },
      },
    ],
    resources: [
      { label: 'Official Robot Framework Documentation', url: 'https://robotframework.org/' },
      { label: 'Browser Library Documentation', url: 'https://marketsquare.github.io/robotframework-browser/Browser.html' },
      { label: 'Robot Framework GitHub', url: 'https://github.com/robotframework/robotframework' },
    ],
  },
  {
    id: 'playwright',
    track: 'frameworks',
    name: 'Playwright',
    tagline: 'Modern, reliable cross-browser E2E automation',
    category: 'Web UI Automation',
    frameworkType: 'web',
    icon: FileCode2,
    accent: 'blue',
    overview:
      'Playwright is a modern automation framework built by Microsoft for fast, reliable end-to-end testing across Chromium, Firefox and WebKit with a single API. This program covers setup, auto-waiting locators, network interception, and CI integration with real, commented code.',
    prerequisites: [
      'Basic JavaScript/TypeScript knowledge',
      'Node.js 18+ installed',
      'Basic understanding of browsers and the DOM',
    ],
    outcomes: [
      'Write auto-waiting Playwright tests with resilient locators',
      'Use network interception and API testing features',
      'Run tests across three browser engines from one codebase',
      'Integrate Playwright suites into CI/CD with trace/report artifacts',
    ],
    modules: [
      {
        id: 'playwright-m1',
        title: 'Getting Started with Playwright',
        description: 'Install Playwright and write your first cross-browser test.',
        lessons: [
          {
            id: 'playwright-m1-l1',
            title: 'Installing Playwright & Running Tests',
            duration: '25 min',
            level: 'Beginner',
            summary: 'Scaffold a Playwright project, install browser binaries, and run your first test.',
            objectives: [
              'Scaffold a Playwright project with npm init',
              'Install the three supported browser engines',
              'Run a test and open the HTML report',
            ],
            practice: 'Scaffold a Playwright project and run the generated example test suite.',
            steps: [
              {
                title: 'Why Playwright',
                detail:
                  'Playwright was built from scratch to solve the reliability problems of older browser automation tools: it auto-waits for elements to be actionable, supports Chromium, Firefox and WebKit from one API, and ships powerful debugging tools like the trace viewer.',
              },
              {
                title: 'Scaffold a project',
                detail:
                  'The official init command creates a ready-to-run project with example tests, a config file and CI workflow boilerplate.',
                code: 'npm init playwright@latest      # scaffold project + example tests\nnpx playwright install          # install Chromium, Firefox, WebKit',
              },
              {
                title: 'Run your first test',
                detail:
                  'The test runner executes all specs across configured browsers in parallel by default, then prints a summary.',
                code: 'npx playwright test             # run all specs headlessly',
              },
              {
                title: 'Open the HTML report (useful case)',
                detail:
                  'Every run generates a rich HTML report with screenshots, traces and timing — the fastest way to understand a failure without re-running locally.',
                code: 'npx playwright show-report      # open the last run\'s HTML report',
              },
            ],
          },
          {
            id: 'playwright-m1-l2',
            title: 'Your First Test Script',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Write a real Playwright test using auto-waiting locators and web-first assertions.',
            objectives: [
              'Use page.goto, getByRole/getByTestId locators',
              'Write web-first assertions with expect',
              'Understand auto-waiting behavior',
            ],
            practice: 'Automate a login flow and assert the dashboard heading is visible.',
            steps: [
              {
                title: 'Navigate and locate elements',
                detail:
                  'Playwright encourages semantic, accessibility-based locators (getByRole, getByLabel) over brittle CSS, making tests both more stable and more readable.',
                code: "import { test, expect } from '@playwright/test'\n\ntest('user can log in', async ({ page }) => {\n  await page.goto('/login')\n  await page.getByLabel('Username').fill('demo')\n  await page.getByLabel('Password').fill('secret')\n  await page.getByRole('button', { name: 'Log in' }).click()\n})",
              },
              {
                title: 'Assert with web-first assertions',
                detail:
                  'expect(locator) automatically retries until the condition is true or the timeout elapses — no manual waiting required, unlike plain assert statements.',
                code: "await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()",
              },
              {
                title: 'Understand auto-waiting (useful case)',
                detail:
                  'Every action (click, fill, etc.) automatically waits for the element to be attached, visible, stable and enabled before acting — eliminating most flaky-timing bugs by default.',
              },
            ],
          },
        ],
        quiz: {
          question: 'Why do Playwright tests rarely need manual sleep() calls compared to older automation tools?',
          options: [
            'Playwright actions and assertions auto-wait for elements to be actionable before proceeding',
            'Playwright disables all timing checks by default',
            'Playwright only works with instant, static pages',
            'Playwright requires a manual wait before every single action',
          ],
          correctIndex: 0,
          explanation: 'Playwright bakes auto-waiting into both actions (click, fill) and expect() assertions, polling until elements are ready or a timeout occurs.',
        },
      },
      {
        id: 'playwright-m2',
        title: 'Network Interception & API Testing',
        description: 'Control network behavior and test APIs directly.',
        lessons: [
          {
            id: 'playwright-m2-l1',
            title: 'Mocking Network Requests',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Stub and assert on network calls with page.route for deterministic, fast tests.',
            objectives: [
              'Intercept requests with page.route',
              'Fulfill requests with mocked JSON responses',
              'Wait for and inspect specific requests',
            ],
            practice: 'Mock a slow /api/orders endpoint and assert the UI renders the mocked data instantly.',
            steps: [
              {
                title: 'Intercept and mock a response',
                detail:
                  'page.route intercepts matching requests before they hit the network, letting you fulfill them with controlled, instant fake data.',
                code: "await page.route('**/api/orders', route =>\n  route.fulfill({ json: [{ id: 1, status: 'open' }] })  // fake response\n)\nawait page.goto('/orders')",
              },
              {
                title: 'Wait for a specific request (useful case)',
                detail:
                  'page.waitForResponse resolves once a matching network call completes, letting you assert on the real request that was sent by your frontend.',
                code: "const [response] = await Promise.all([\n  page.waitForResponse('**/api/orders'),\n  page.getByRole('button', { name: 'Refresh' }).click(),\n])\nexpect(response.status()).toBe(200)",
              },
            ],
          },
          {
            id: 'playwright-m2-l2',
            title: 'API Testing with request',
            duration: '25 min',
            level: 'Intermediate',
            summary: 'Use Playwright\'s built-in request context to test REST APIs directly, without a browser.',
            objectives: [
              'Send requests with the APIRequestContext',
              'Assert on status codes and JSON bodies',
              'Combine API setup with UI tests for speed',
            ],
            practice: 'Write an API test that creates a resource via POST and verifies it via GET.',
            steps: [
              {
                title: 'Send API requests directly',
                detail:
                  'Playwright ships a full HTTP client (request fixture) so API-only tests do not need to launch a browser at all — much faster than UI-driven checks.',
                code: "test('create and fetch an order', async ({ request }) => {\n  const created = await request.post('/api/orders', { data: { item: 'Widget' } })\n  expect(created.ok()).toBeTruthy()\n\n  const { id } = await created.json()\n  const fetched = await request.get(`/api/orders/${id}`)\n  expect(fetched.status()).toBe(200)\n})",
              },
              {
                title: 'Use API calls to speed up UI tests (useful case)',
                detail:
                  'Instead of clicking through the UI to set up test data, call the API directly in a beforeEach — this dramatically speeds up suites that need pre-existing state.',
                code: "test.beforeEach(async ({ request }) => {\n  await request.post('/api/seed', { data: { users: 1 } }) // fast setup via API\n})",
              },
            ],
          },
        ],
        quiz: {
          question: 'Your UI test needs a user account to already exist before it starts. What is the fastest way to set that up with Playwright?',
          options: [
            "Use the request fixture to create the account via the API directly in a beforeEach hook",
            'Always click through the full signup UI flow before every single test',
            'Manually create the account once and hope it is never deleted',
            'Skip the test entirely',
          ],
          correctIndex: 0,
          explanation: "Playwright's request fixture lets tests set up data via direct API calls, which is far faster and more reliable than driving the UI for setup steps.",
        },
      },
      {
        id: 'playwright-m3',
        title: 'CI/CD & Debugging',
        description: 'Run suites in pipelines and debug failures efficiently.',
        lessons: [
          {
            id: 'playwright-m3-l1',
            title: 'Traces, Videos & CI Integration',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Enable tracing for failed tests and run the suite inside a CI pipeline.',
            objectives: [
              'Enable trace recording on failure',
              'Open a trace in the Playwright Trace Viewer',
              'Run Playwright in a GitHub Actions workflow',
            ],
            practice: 'Configure trace: retain-on-failure and inspect a failing test\'s trace locally.',
            steps: [
              {
                title: 'Enable traces on failure',
                detail:
                  'Traces record a full timeline of actions, DOM snapshots and network activity — recording them only on failure keeps CI fast while still giving rich debugging data when needed.',
                code: "// playwright.config.ts\nexport default {\n  use: { trace: 'retain-on-failure' },  // only keep traces for failed tests\n}",
              },
              {
                title: 'Open the Trace Viewer',
                detail:
                  'The Trace Viewer lets you step through every action with DOM snapshots and network calls, side by side — often eliminating the need to reproduce a CI failure locally at all.',
                code: 'npx playwright show-trace trace.zip',
              },
              {
                title: 'Run in CI (useful case)',
                detail:
                  'The official Docker image ships with all browsers pre-installed, keeping CI runs fast and consistent across environments.',
                code: "- uses: actions/setup-node@v4\n  with: { node-version: 18 }\n- run: npm ci\n- run: npx playwright install --with-deps\n- run: npx playwright test\n- uses: actions/upload-artifact@v4\n  if: always()\n  with: { name: playwright-report, path: playwright-report/ }",
              },
            ],
          },
          {
            id: 'playwright-m3-l2',
            title: 'Deep-Dive Debugging Techniques',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Use Playwright Inspector, UI Mode and codegen to resolve failures faster than reading stack traces alone.',
            objectives: [
              'Debug interactively with the Playwright Inspector',
              'Use UI Mode to time-travel through a test run',
              'Generate locators with codegen instead of guessing',
              'Diagnose flaky auto-waiting failures with actionability logs',
            ],
            practice: 'Run a failing test with PWDEBUG=1 and step through it command by command in the Inspector.',
            steps: [
              {
                title: 'Launch the Playwright Inspector',
                detail:
                  'Setting PWDEBUG=1 opens the Inspector alongside a real browser window, letting you step through each action, pause at breakpoints, and explore the DOM live — much faster than adding console.log statements.',
                code: '# macOS/Linux\nPWDEBUG=1 npx playwright test tests/login.spec.ts\n\n# Windows PowerShell\n$env:PWDEBUG=1; npx playwright test tests/login.spec.ts',
              },
              {
                title: 'Use UI Mode for time-travel debugging',
                detail:
                  'npx playwright test --ui opens an interactive runner showing every test action with a DOM snapshot, network tab and console log for each step — you can scrub through the whole run like a video.',
                code: 'npx playwright test --ui',
              },
              {
                title: 'Generate reliable locators with codegen (useful case)',
                detail:
                  'Rather than guessing a CSS selector, record real interactions against the live app; Codegen suggests the most resilient locator (role/text-based) automatically, matching Playwright\'s recommended locator strategy.',
                code: 'npx playwright codegen https://example.com',
              },
              {
                title: 'Read actionability failure logs',
                detail:
                  'When a click times out, Playwright prints exactly which actionability check failed (not visible, not enabled, element intercepts pointer events, animating, etc.) — read this message before assuming the locator itself is wrong.',
                code: '// Example error snippet Playwright prints on a timeout:\n// waiting for locator(\'#submit\')\n//   - element is not visible\n// -> the element exists but is hidden, e.g. behind a modal',
              },
              {
                title: 'Add a manual breakpoint in code (useful case)',
                detail:
                  'For complex flows, drop a page.pause() call exactly where you want execution to freeze so you can inspect the live page state, then resume from the Inspector toolbar.',
                code: "await page.goto('/checkout')\nawait page.pause()   // execution freezes here; resume from the Inspector toolbar\nawait page.getByRole('button', { name: 'Place order' }).click()",
              },
              {
                title: 'Compare local vs CI trace files',
                detail:
                  'If a test only fails in CI, download the trace.zip artifact and open it locally with show-trace — this reproduces the exact CI DOM/network state without needing CI access or re-running the pipeline.',
                code: 'npx playwright show-trace downloaded-trace.zip',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a test fails: (1) read the actionability error message carefully, (2) reproduce with --ui or PWDEBUG=1 locally, (3) re-generate the locator with codegen if it seems fragile, (4) for CI-only failures, download and open the trace, (5) only then suspect the application itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A Playwright click times out with the message "element is not visible" even though it appears in the DOM. What does this tell you?',
          options: [
            'The locator syntax must be invalid',
            'Playwright\'s actionability check failed specifically on visibility — likely the element is hidden behind another element or not yet rendered visibly',
            'Playwright cannot interact with any element ever',
            'The test framework itself has crashed',
          ],
          correctIndex: 1,
          explanation: 'Playwright reports the specific actionability check that failed (visible, enabled, stable, etc.), so a "not visible" message points precisely at a visibility/overlap issue rather than a locator syntax problem.',
        },
      },
    ],
    resources: [
      { label: 'Official Playwright Documentation', url: 'https://playwright.dev/docs/intro' },
      { label: 'Playwright Trace Viewer', url: 'https://playwright.dev/docs/trace-viewer' },
      { label: 'Playwright GitHub', url: 'https://github.com/microsoft/playwright' },
    ],
  },
  {
    id: 'webdriverio',
    track: 'frameworks',
    name: 'WebdriverIO',
    tagline: 'Unified web + mobile automation with one JavaScript framework',
    category: 'Web & Mobile Automation',
    frameworkType: 'web',
    icon: Braces,
    accent: 'purple',
    overview:
      'WebdriverIO is a Node.js automation framework built on the WebDriver protocol, popular for teams who want one codebase driving both web browsers and, via Appium, mobile apps. This program covers configuration, the WDIO test runner, and CI integration.',
    prerequisites: [
      'Basic JavaScript/TypeScript knowledge',
      'Node.js 18+ installed',
      'Basic understanding of the WebDriver protocol',
    ],
    outcomes: [
      'Configure the WDIO test runner and services',
      'Write stable tests with WebdriverIO\'s built-in waiting',
      'Share test code between web and mobile (Appium) suites',
      'Run parallelized suites in CI/CD',
    ],
    modules: [
      {
        id: 'webdriverio-m1',
        title: 'Getting Started with WebdriverIO',
        description: 'Scaffold a project and understand the WDIO test runner.',
        lessons: [
          {
            id: 'webdriverio-m1-l1',
            title: 'Setup & Configuration',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Scaffold a WebdriverIO project and understand the wdio.conf.js configuration file.',
            objectives: [
              'Scaffold a project with the WDIO CLI',
              'Understand capabilities, services and reporters in the config',
              'Run a sample test',
            ],
            practice: 'Scaffold a WebdriverIO project targeting Chrome and run the sample test.',
            steps: [
              {
                title: 'Why WebdriverIO',
                detail:
                  'WebdriverIO wraps the WebDriver protocol with a friendly test runner, built-in waiting, and a plugin system (services) for Appium, visual testing, cloud grids and more — one config can drive web and mobile from the same codebase.',
              },
              {
                title: 'Scaffold with the CLI',
                detail:
                  'The interactive CLI wizard asks about your target platforms (web/mobile), language (JS/TS) and test framework (Mocha/Jasmine/Cucumber), generating a ready config.',
                code: 'npm init wdio@latest .    # interactive wizard scaffolds wdio.conf.js',
              },
              {
                title: 'Understand the config file',
                detail:
                  'capabilities defines which browsers/devices to run on; services add integrations (like Appium); this is the single source of truth for how your suite executes.',
                code: "// wdio.conf.js\nexport const config = {\n  runner: 'local',\n  specs: ['./test/specs/**/*.js'],\n  capabilities: [{ browserName: 'chrome' }], // target browser(s)\n  framework: 'mocha',                        // test syntax\n  reporters: ['spec'],\n}",
              },
              {
                title: 'Run the suite',
                detail:
                  'The wdio CLI reads the config, launches the browser(s) and runs every matching spec, printing a readable pass/fail summary.',
                code: 'npx wdio run wdio.conf.js',
              },
            ],
          },
        ],
        quiz: {
          question: 'What is the main advantage of using WebdriverIO for a team automating both a web app and a mobile app?',
          options: [
            'The same framework and much of the same test code can drive both web browsers and, via the Appium service, mobile apps',
            'WebdriverIO only supports web automation, never mobile',
            'It requires two completely separate frameworks with no code sharing',
            'It cannot be configured for different browsers',
          ],
          correctIndex: 0,
          explanation: 'WebdriverIO\'s plugin-based services (including an Appium service) let one framework and often shared page objects drive both web and mobile automation.',
        },
      },
      {
        id: 'webdriverio-m2',
        title: 'Writing Stable Tests',
        description: 'Use built-in waiting and locators effectively.',
        lessons: [
          {
            id: 'webdriverio-m2-l1',
            title: 'Selectors & Smart Waiting',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Locate elements and rely on WebdriverIO\'s built-in smart waiting instead of manual pauses.',
            objectives: [
              'Use $ and $$ to locate one or many elements',
              'Understand implicit smart waiting on commands',
              'Use explicit waitForDisplayed/waitForClickable when needed',
            ],
            practice: 'Automate a login flow that never uses a fixed pause() call.',
            steps: [
              {
                title: 'Locate elements with $ and $$',
                detail:
                  '$ returns a single element (lazily resolved), $$ returns a list — both accept CSS, accessibility id or other supported selector strategies.',
                code: "const username = await $('#username')  // single element\nconst rows = await $$('.result-row')    // list of elements",
              },
              {
                title: 'Rely on built-in smart waiting',
                detail:
                  'Commands like click() and setValue() automatically wait for the element to exist and be interactable before acting, removing most manual wait code.',
                code: "await $('#username').setValue('demo')  // waits automatically, then types\nawait $('#loginButton').click()          // waits automatically, then clicks",
              },
              {
                title: 'Use explicit waits for custom conditions (useful case)',
                detail:
                  'For conditions beyond simple existence (like a spinner disappearing), an explicit wait method makes the intent clear and configurable.',
                code: "const spinner = await $('#spinner')\nawait spinner.waitForDisplayed({ reverse: true, timeout: 10000 }) // wait until gone",
              },
            ],
          },
          {
            id: 'webdriverio-m2-l2',
            title: 'Debugging WebdriverIO Tests',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Use the WDIO REPL, verbose logging and screenshots to resolve locator and timing failures quickly.',
            objectives: [
              'Use browser.debug() to drop into an interactive REPL mid-test',
              'Increase log verbosity to see raw WebDriver commands',
              'Capture screenshots and page source on failure',
              'Diagnose StaleElementReference and timeout errors',
            ],
            practice: 'Insert a browser.debug() call mid-test and use the REPL to try alternate selectors live.',
            steps: [
              {
                title: 'Drop into the interactive REPL',
                detail:
                  'browser.debug() pauses the test and opens a REPL in your terminal where you can run WebdriverIO commands live against the still-open browser — perfect for trying out a different selector without restarting the whole test.',
                code: "await $('#username').setValue('demo')\nawait browser.debug()   // test pauses; terminal REPL opens\n// In the REPL you can now try: await $('#password').isDisplayed()",
              },
              {
                title: 'Increase log verbosity',
                detail:
                  'Setting logLevel to debug or trace in the config prints every raw WebDriver command and response, useful when a failure seems to come from the protocol layer rather than your test code.',
                code: "// wdio.conf.js\nexport const config = {\n  logLevel: 'debug',   // options: trace, debug, info, warn, error, silent\n}",
              },
              {
                title: 'Capture a screenshot on failure (useful case)',
                detail:
                  'Wire a global afterTest hook so every failure automatically saves a screenshot, without needing to add try/catch to individual tests.',
                code: "// wdio.conf.js\nexport const config = {\n  afterTest: async function (test, context, { passed }) {\n    if (!passed) {\n      await browser.saveScreenshot(`./artifacts/${test.title}.png`)\n    }\n  },\n}",
              },
              {
                title: 'Diagnose StaleElementReferenceError',
                detail:
                  'This means the element you found was removed/replaced in the DOM before you used it — usually after a re-render. Because $() lazily re-resolves the selector on each command, simply calling the command again (rather than reusing a raw WebElement handle) often fixes it automatically.',
                code: "// $() is a lazily-resolved reference — re-querying is usually safe\nconst button = $('#submit')  // not yet resolved\nawait someActionThatRerendersThePage()\nawait button.click()          // re-resolves fresh right before clicking",
              },
              {
                title: 'Diagnose timeout errors (useful case)',
                detail:
                  'A "element never became clickable" timeout means the smart wait exhausted its budget. Check whether the element is covered by another element (a modal, overlay) using isDisplayed()/isClickable() in the REPL before assuming the locator is wrong.',
                code: "// In the REPL, inspect why an element is not clickable:\nawait $('#submit').isDisplayed()   // is it even visible?\nawait $('#submit').isEnabled()     // is it enabled?\nawait $('#submit').isClickable()   // combines several checks WDIO uses internally",
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a test fails: (1) reproduce with browser.debug() and try alternate selectors live in the REPL, (2) check isDisplayed/isEnabled/isClickable individually to isolate the exact blocking condition, (3) raise logLevel to debug for protocol-level issues, (4) review the auto-captured failure screenshot, (5) only then suspect the app itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A WebdriverIO test times out waiting for a button to become clickable, but the button is clearly visible in the failure screenshot. What is the most useful next debugging step?',
          options: [
            'Assume the test framework is broken and rewrite the test',
            "Use browser.debug() to open a REPL and check isDisplayed()/isEnabled()/isClickable() individually to isolate exactly which condition is failing",
            'Increase the global timeout to 5 minutes and move on',
            'Delete the assertion',
          ],
          correctIndex: 1,
          explanation: 'isClickable() combines several checks (displayed, enabled, not covered by another element); checking each individually in the interactive REPL quickly isolates the real blocking condition instead of guessing.',
        },
      },
    ],
    resources: [
      { label: 'Official WebdriverIO Documentation', url: 'https://webdriver.io/docs/gettingstarted' },
      { label: 'WebdriverIO Appium Service', url: 'https://webdriver.io/docs/appium-service/' },
      { label: 'WebdriverIO GitHub', url: 'https://github.com/webdriverio/webdriverio' },
    ],
  },
  {
    id: 'restassured',
    track: 'frameworks',
    name: 'RestAssured',
    tagline: 'Java\'s standard library for REST API test automation',
    category: 'API Automation',
    frameworkType: 'api',
    icon: Coffee,
    accent: 'orange',
    overview:
      'RestAssured is the de-facto standard Java library for testing REST APIs with a readable, BDD-style syntax. This program covers writing assertions with given/when/then, validating JSON with JsonPath, and integrating with JUnit/TestNG and CI pipelines.',
    prerequisites: [
      'Working knowledge of Java',
      'Basic understanding of HTTP and JSON',
      'JDK 17+ and Maven or Gradle installed',
    ],
    outcomes: [
      'Write readable API tests using the given/when/then DSL',
      'Validate JSON responses with JsonPath and Hamcrest matchers',
      'Extract and chain values between requests',
      'Run RestAssured suites in CI with JUnit/TestNG reports',
    ],
    modules: [
      {
        id: 'restassured-m1',
        title: 'Getting Started with RestAssured',
        description: 'Set up a project and send your first request.',
        lessons: [
          {
            id: 'restassured-m1-l1',
            title: 'Setup & the given/when/then DSL',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Add RestAssured to a Maven project and write your first readable API test.',
            objectives: [
              'Add the RestAssured dependency to a Maven project',
              'Understand the given/when/then structure',
              'Assert on status code and body content',
            ],
            practice: 'Write a test that GETs a public API and asserts status 200 and a JSON field.',
            steps: [
              {
                title: 'Why RestAssured',
                detail:
                  'RestAssured brings a fluent, BDD-style DSL to Java API testing. Instead of manually building HTTP clients and parsing JSON, given/when/then reads like a specification, making tests self-documenting.',
              },
              {
                title: 'Add the dependency',
                detail:
                  'RestAssured is published to Maven Central and typically paired with JUnit or TestNG as the test runner.',
                code: '<!-- pom.xml -->\n<dependency>\n  <groupId>io.rest-assured</groupId>\n  <artifactId>rest-assured</artifactId>\n  <version>5.4.0</version>\n  <scope>test</scope>\n</dependency>',
              },
              {
                title: 'Write your first test',
                detail:
                  'given() sets up the request, when() performs the action, then() asserts on the response — three clear phases per test.',
                code: 'import static io.restassured.RestAssured.*;\nimport static org.hamcrest.Matchers.*;\n\n@Test\nvoid getsAPost() {\n  given()\n    .baseUri("https://jsonplaceholder.typicode.com")\n  .when()\n    .get("/posts/1")\n  .then()\n    .statusCode(200)                 // assert status\n    .body("userId", equalTo(1));     // assert JSON field via JsonPath\n}',
              },
            ],
          },
        ],
        quiz: {
          question: 'What is the main benefit of RestAssured\'s given/when/then syntax over manually building HTTP requests in Java?',
          options: [
            'It produces readable, self-documenting tests structured as setup, action and assertion',
            'It removes the need for any assertions at all',
            'It only works with SOAP APIs, not REST',
            'It requires no dependencies to use',
          ],
          correctIndex: 0,
          explanation: 'The given/when/then DSL structures a test into clear setup, action and verification phases, making API tests read like a specification.',
        },
      },
      {
        id: 'restassured-m2',
        title: 'JSON Validation & Chaining Requests',
        description: 'Validate complex responses and pass data between calls.',
        lessons: [
          {
            id: 'restassured-m2-l1',
            title: 'JsonPath & Hamcrest Matchers',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Validate nested JSON structures using JsonPath expressions and Hamcrest matchers.',
            objectives: [
              'Use JsonPath to navigate nested JSON',
              'Combine matchers like hasItem, containsString and greaterThan',
              'Extract a value for use later in the test',
            ],
            practice: 'Validate a list response contains an item matching specific criteria.',
            steps: [
              {
                title: 'Navigate nested JSON with JsonPath',
                detail:
                  'Dot and bracket notation lets you assert deep inside a JSON response without manually parsing it.',
                code: '.then()\n  .body("address.city", equalTo("Anytown"))       // nested field\n  .body("tags", hasItem("automation"))            // list contains item\n  .body("items.size()", greaterThan(0));          // list is non-empty',
              },
              {
                title: 'Extract a value for later use',
                detail:
                  'extract().path() pulls a value out of the response so it can be reused, e.g. an id created by a POST request.',
                code: 'String id = given()\n    .contentType("application/json")\n    .body("{\\"item\\":\\"Widget\\"}")\n  .when()\n    .post("/orders")\n  .then()\n    .statusCode(201)\n  .extract().path("id");            // grab the created resource id',
              },
              {
                title: 'Chain requests (useful case)',
                detail:
                  'Use the extracted id in a follow-up request, mirroring a real create-then-verify workflow.',
                code: 'given()\n  .pathParam("id", id)\n.when()\n  .get("/orders/{id}")\n.then()\n  .statusCode(200)\n  .body("item", equalTo("Widget"));',
              },
            ],
          },
          {
            id: 'restassured-m2-l2',
            title: 'Debugging RestAssured Failures',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Use RestAssured\'s logging filters and clear failure messages to diagnose failing API tests quickly.',
            objectives: [
              'Log requests and responses on demand or only on failure',
              'Read Hamcrest matcher failure messages correctly',
              'Debug JsonPath expressions that return null/empty',
              'Diagnose serialization and content-type mismatches',
            ],
            practice: 'Force a matcher failure, enable logIfValidationFails(), and use the printed request/response to find the fix.',
            steps: [
              {
                title: 'Log only when a test fails',
                detail:
                  'Logging every request always is noisy. .log().ifValidationFails() prints the full request and response only when an assertion fails, giving you exactly the context you need without cluttering passing runs.',
                code: 'given()\n  .contentType("application/json")\n  .body(payload)\n.when()\n  .post("/orders")\n.then()\n  .log().ifValidationFails()      // only prints on assertion failure\n  .statusCode(201);',
              },
              {
                title: 'Log everything for a one-off investigation (useful case)',
                detail:
                  'When you need to see exactly what was sent regardless of pass/fail (e.g. verifying headers), use .log().all() temporarily, then remove it once you understand the issue.',
                code: 'given()\n  .log().all()          // prints full request details unconditionally\n.when()\n  .get("/users/1")\n.then()\n  .log().all()          // prints full response details unconditionally\n  .statusCode(200);',
              },
              {
                title: 'Read Hamcrest matcher failures carefully',
                detail:
                  'A failed .body() assertion prints both the expected matcher and the actual value found at that JsonPath — read both sides before assuming the API is wrong; often it is a path typo.',
                code: '// Example failure output:\n// Expected: a collection containing "automation"\n//      but: was <["regression", "smoke"]>\n// -> the actual list simply does not contain that tag; check the test data, not the framework',
              },
              {
                title: 'Debug a JsonPath returning null (useful case)',
                detail:
                  'If extract().path() returns null, print the raw response body first to confirm the field name and nesting are exactly right — a common mistake is missing an array index or a case-sensitive key mismatch.',
                code: 'Response response = given().when().get("/orders/1");\nSystem.out.println(response.getBody().asString());  // inspect the raw JSON\nString status = response.path("order.status");        // now confirm the exact path',
              },
              {
                title: 'Diagnose content-type mismatches',
                detail:
                  'A 415 Unsupported Media Type or unexpected serialization error usually means the Content-Type header does not match the body format. Explicitly set .contentType() rather than relying on defaults when debugging this class of failure.',
                code: 'given()\n  .contentType(ContentType.JSON)   // explicit, avoids ambiguity\n  .body(payload)\n.when()\n  .post("/orders")\n.then()\n  .statusCode(201);',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a RestAssured test fails: (1) enable log().ifValidationFails() to see the real request/response, (2) read the matcher\'s expected-vs-actual message fully, (3) print the raw body if a JsonPath returns null, (4) verify Content-Type explicitly, (5) only then suspect the API endpoint itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'An extract().path("order.status") call keeps returning null even though you can see the field in Postman. What is the fastest way to debug this in RestAssured?',
          options: [
            'Assume RestAssured is broken and switch tools',
            'Print the raw response body with response.getBody().asString() to confirm the exact field name, nesting and casing before re-checking the path expression',
            'Retry the request many times until it works',
            'Add a longer timeout',
          ],
          correctIndex: 1,
          explanation: 'Printing the raw JSON body confirms the actual structure returned, which quickly reveals path typos, case mismatches or unexpected nesting causing the JsonPath to resolve to null.',
        },
      },
    ],
    resources: [
      { label: 'Official RestAssured Documentation', url: 'https://rest-assured.io/' },
      { label: 'RestAssured GitHub', url: 'https://github.com/rest-assured/rest-assured' },
      { label: 'Hamcrest Matchers Reference', url: 'https://hamcrest.org/JavaHamcrest/' },
    ],
  },
  {
    id: 'junit5',
    track: 'frameworks',
    name: 'JUnit 5',
    tagline: 'The standard test runner and assertion library for Java automation',
    category: 'Test Runner & Assertions',
    frameworkType: 'api',
    icon: ScrollText,
    accent: 'indigo',
    overview:
      'JUnit 5 is the foundation almost every Java automation suite (Selenium, RestAssured, Appium) is built on top of. This program covers writing tests, parameterized tests, lifecycle hooks, tags and parallel execution — the skills every Java automation job expects.',
    prerequisites: [
      'Working knowledge of Java',
      'JDK 17+ and Maven or Gradle installed',
    ],
    outcomes: [
      'Write tests with @Test and JUnit 5 assertions',
      'Use @BeforeEach/@AfterEach for setup and teardown',
      'Write data-driven tests with @ParameterizedTest',
      'Organize and parallelize suites with tags and execution config',
    ],
    modules: [
      {
        id: 'junit5-m1',
        title: 'Getting Started with JUnit 5',
        description: 'Write your first tests and understand the test lifecycle.',
        lessons: [
          {
            id: 'junit5-m1-l1',
            title: 'Writing Tests & Lifecycle Hooks',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Write JUnit 5 tests with proper setup/teardown using lifecycle annotations.',
            objectives: [
              'Add the JUnit 5 dependency to a Maven project',
              'Write assertions with assertEquals/assertTrue',
              'Use @BeforeEach and @AfterEach for isolated tests',
            ],
            practice: 'Write a small test class with setup, two tests, and teardown.',
            steps: [
              {
                title: 'Add JUnit 5',
                detail:
                  'JUnit 5 (Jupiter) is added as a test-scoped Maven dependency and works with the standard Surefire test runner out of the box.',
                code: '<dependency>\n  <groupId>org.junit.jupiter</groupId>\n  <artifactId>junit-jupiter</artifactId>\n  <version>5.10.2</version>\n  <scope>test</scope>\n</dependency>',
              },
              {
                title: 'Write a basic test',
                detail:
                  '@Test marks a method as a test case; assertion methods like assertEquals compare expected vs actual and fail the test with a clear message on mismatch.',
                code: 'import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass CalculatorTest {\n  @Test\n  void addsTwoNumbers() {\n    assertEquals(4, 2 + 2, "2 + 2 should equal 4");\n  }\n}',
              },
              {
                title: 'Use lifecycle hooks',
                detail:
                  '@BeforeEach runs before every test method (fresh setup) and @AfterEach runs after every test (cleanup), keeping tests independent of each other.',
                code: "class OrderServiceTest {\n  private OrderService service;\n\n  @BeforeEach\n  void setUp() { service = new OrderService(); }   // fresh instance per test\n\n  @AfterEach\n  void tearDown() { service.close(); }             // release resources\n\n  @Test\n  void createsAnOrder() {\n    assertNotNull(service.create(\"Widget\"));\n  }\n}",
              },
            ],
          },
        ],
        quiz: {
          question: 'Why should @BeforeEach create a fresh instance of the class under test for every single test method?',
          options: [
            'It keeps tests independent, so state from one test cannot leak into and affect another',
            'It makes tests run slower on purpose',
            'It is required only for the very first test in a class',
            'JUnit ignores @BeforeEach unless there is exactly one test',
          ],
          correctIndex: 0,
          explanation: '@BeforeEach runs before every test method, ensuring each test starts from a clean, isolated state and cannot be affected by previous tests.',
        },
      },
      {
        id: 'junit5-m2',
        title: 'Parameterized Tests & Organization',
        description: 'Write data-driven tests and organize large suites.',
        lessons: [
          {
            id: 'junit5-m2-l1',
            title: 'Data-Driven Tests with @ParameterizedTest',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Run the same test logic against multiple inputs using parameterized tests.',
            objectives: [
              'Use @ParameterizedTest with @ValueSource and @CsvSource',
              'Tag tests with @Tag for selective execution',
              'Understand parallel execution configuration',
            ],
            practice: 'Write a parameterized test that validates email format across five example inputs.',
            steps: [
              {
                title: 'Why parameterize tests',
                detail:
                  'Instead of copy-pasting the same assertion logic for each input, a parameterized test runs once per data row, keeping the suite DRY and easy to extend with new cases.',
              },
              {
                title: 'Use @ValueSource for simple inputs',
                detail:
                  'For single-argument tests, @ValueSource is the simplest way to supply a list of values to test against.',
                code: '@ParameterizedTest\n@ValueSource(strings = {"demo@test.com", "user@site.org"})\nvoid validEmailsPassValidation(String email) {\n  assertTrue(EmailValidator.isValid(email));\n}',
              },
              {
                title: 'Use @CsvSource for multiple arguments (useful case)',
                detail:
                  '@CsvSource supplies multiple parameters per row, ideal for input/expected-output pairs.',
                code: '@ParameterizedTest\n@CsvSource({\n  "2, 3, 5",\n  "10, -1, 9"\n})\nvoid addsTwoNumbers(int a, int b, int expected) {\n  assertEquals(expected, a + b);\n}',
              },
              {
                title: 'Tag and select tests',
                detail:
                  '@Tag lets you group tests (e.g. "smoke", "regression") and run only a subset via Maven/Gradle filters — useful for fast smoke runs in CI.',
                code: '@Tag("smoke")\n@Test\nvoid criticalLoginFlowWorks() { /* ... */ }\n\n// Run only smoke tests:\n// mvn test -Dgroups="smoke"',
              },
            ],
          },
          {
            id: 'junit5-m2-l2',
            title: 'Debugging Failing JUnit Tests',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Read assertion failure messages, use debugger breakpoints, and diagnose test isolation problems.',
            objectives: [
              'Write custom, descriptive assertion messages',
              'Use assertAll to see every failure at once, not just the first',
              'Debug a test with breakpoints in an IDE',
              'Diagnose order-dependent/flaky tests caused by shared state',
            ],
            practice: 'Convert several separate assertEquals calls into one assertAll block and observe all failures reported together.',
            steps: [
              {
                title: 'Read the assertion failure output carefully',
                detail:
                  'JUnit prints "expected: <X> but was: <Y>" for failed assertions. Before touching any code, confirm which side is wrong — sometimes the "expected" value in the test itself is outdated, not the application.',
                code: '// Example failure:\n// org.opentest4j.AssertionFailedError:\n// expected: <200> but was: <404>\n// -> the endpoint/path used by the test is likely wrong, not necessarily the app',
              },
              {
                title: 'Add custom failure messages (useful case)',
                detail:
                  'A custom message turns a bare number mismatch into an explanation of intent, saving time for whoever reads the failure next (including future you).',
                code: 'assertEquals(200, response.getStatus(),\n  () -> "Expected checkout endpoint to succeed but got: " + response.getBody());',
              },
              {
                title: 'See every failure at once with assertAll',
                detail:
                  'By default JUnit stops at the first failed assertEquals in a test. assertAll groups related checks so it runs all of them and reports every failure together — much faster than fixing one at a time and re-running.',
                code: 'assertAll("order fields",\n  () -> assertEquals("Widget", order.getName()),\n  () -> assertEquals(2, order.getQuantity()),\n  () -> assertTrue(order.getTotal() > 0)\n);',
              },
              {
                title: 'Debug with IDE breakpoints',
                detail:
                  'Set a breakpoint on the failing assertion line and run the single test in Debug mode. Inspect the actual object graph in the debugger — this is often faster than adding print statements, especially for nested objects.',
                code: '// IntelliJ / VS Code: click the gutter next to the assertion, then\n// "Debug Test" instead of "Run Test" to stop there and inspect variables',
              },
              {
                title: 'Diagnose order-dependent failures (useful case)',
                detail:
                  'If a test passes alone but fails when run with the full suite, suspect shared mutable state (a static field, a shared file, a database row not cleaned up). @BeforeEach should reset everything the test depends on; never rely on execution order between tests.',
                code: '// BAD: static shared state leaks between tests\nstatic List<String> sharedCart = new ArrayList<>();\n\n// GOOD: fresh instance per test via @BeforeEach\nList<String> cart;\n@BeforeEach\nvoid setUp() { cart = new ArrayList<>(); }',
              },
              {
                title: 'Run a single test in isolation to confirm',
                detail:
                  'Use your build tool to run just the suspect test method and compare: if it passes alone but fails in the full suite, that confirms a test-isolation bug rather than a logic bug.',
                code: '# Maven: run a single test method\nmvn test -Dtest=OrderServiceTest#createsAnOrder',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a JUnit test fails: (1) read the expected-vs-actual message fully, (2) run the single test in isolation to rule out shared state, (3) use assertAll to see every related failure at once, (4) set a debugger breakpoint for complex object graphs, (5) only then suspect the code under test.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A test passes when run alone but fails when the whole suite runs together. What does this strongly suggest?',
          options: [
            'JUnit itself is broken',
            'Shared mutable state (e.g. a static field) is leaking between tests, so proper isolation via @BeforeEach is missing',
            'The assertion library cannot be trusted',
            'The test should simply be deleted',
          ],
          correctIndex: 1,
          explanation: 'Tests that only fail in combination with others are a classic symptom of shared state (statics, singletons, un-reset fixtures) leaking across tests; resetting state in @BeforeEach fixes the isolation problem.',
        },
      },
    ],
    resources: [
      { label: 'Official JUnit 5 User Guide', url: 'https://junit.org/junit5/docs/current/user-guide/' },
      { label: 'JUnit 5 GitHub', url: 'https://github.com/junit-team/junit5' },
    ],
  },
  {
    id: 'k6',
    track: 'frameworks',
    name: 'k6',
    tagline: 'Modern, developer-centric load and performance testing',
    category: 'Performance Testing',
    frameworkType: 'performance',
    icon: Gauge,
    accent: 'teal',
    overview:
      'k6 is an open-source, JavaScript-scripted load testing tool built for developers and CI/CD, letting teams performance-test APIs and web apps with code instead of complex GUIs. This program covers scripting, thresholds, and running load tests in pipelines.',
    prerequisites: [
      'Basic JavaScript knowledge',
      'Basic understanding of HTTP APIs',
      'k6 CLI installed (or Docker)',
    ],
    outcomes: [
      'Write k6 load test scripts in JavaScript',
      'Define stages (ramp-up/steady/ramp-down) and virtual users',
      'Set pass/fail thresholds on latency and error rate',
      'Run performance tests automatically in CI/CD',
    ],
    modules: [
      {
        id: 'k6-m1',
        title: 'Getting Started with k6',
        description: 'Install k6 and write your first load test script.',
        lessons: [
          {
            id: 'k6-m1-l1',
            title: 'Installing k6 & Your First Script',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Install k6 and write a script that simulates virtual users hitting an API.',
            objectives: [
              'Install the k6 CLI',
              'Write a default function that sends HTTP requests',
              'Run a basic load test and read the summary output',
            ],
            practice: 'Write and run a k6 script that sends GET requests to a public API for 30 seconds.',
            steps: [
              {
                title: 'Why k6 for performance testing',
                detail:
                  'k6 scripts are plain JavaScript, version-controllable alongside application code, and designed from day one to run in CI/CD — unlike older GUI-heavy tools, there is no separate "performance test project" to maintain.',
              },
              {
                title: 'Install k6',
                detail:
                  'k6 installs as a single binary via a package manager, with no runtime dependencies required to execute scripts.',
                code: '# macOS\nbrew install k6\n\n# verify installation\nk6 version',
              },
              {
                title: 'Write a basic script',
                detail:
                  'The exported default function is what each virtual user executes repeatedly. http.get sends the request; sleep paces requests to mimic real user think-time.',
                code: "import http from 'k6/http'\nimport { sleep } from 'k6'\n\nexport default function () {\n  http.get('https://test-api.example.com/posts')  // simulated user request\n  sleep(1)                                        // think-time between requests\n}",
              },
              {
                title: 'Run the test',
                detail:
                  'The --vus flag sets concurrent virtual users, --duration sets how long the test runs. k6 prints a summary with request rate, latency percentiles and error rate.',
                code: 'k6 run --vus 10 --duration 30s script.js',
              },
            ],
          },
        ],
        quiz: {
          question: 'What is the main advantage of k6 scripts being plain JavaScript files instead of a GUI-based project format?',
          options: [
            'They can be version-controlled alongside application code and run directly in CI/CD pipelines',
            'JavaScript cannot express performance test logic',
            'GUI tools are always faster to configure than code',
            'k6 scripts cannot be automated at all',
          ],
          correctIndex: 0,
          explanation: 'Because k6 tests are just JavaScript files, they live in the same repo as the app and run naturally as part of automated CI/CD pipelines.',
        },
      },
      {
        id: 'k6-m2',
        title: 'Stages, Thresholds & CI Integration',
        description: 'Model realistic load and enforce pass/fail criteria automatically.',
        lessons: [
          {
            id: 'k6-m2-l1',
            title: 'Load Stages & Thresholds',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Model ramp-up/steady/ramp-down load patterns and enforce automatic pass/fail thresholds.',
            objectives: [
              'Define stages to ramp virtual users up and down',
              'Set thresholds on latency (p95) and error rate',
              'Fail the CI job automatically when thresholds are breached',
            ],
            practice: 'Configure a test that ramps to 50 virtual users, holds steady, then ramps down, with a p95 latency threshold.',
            steps: [
              {
                title: 'Model realistic load with stages',
                detail:
                  'Real traffic rarely jumps to full load instantly. Stages ramp virtual users up gradually, hold steady to observe sustained behavior, then ramp down — much closer to real-world patterns than a flat constant load.',
                code: "export const options = {\n  stages: [\n    { duration: '30s', target: 50 }, // ramp up to 50 VUs\n    { duration: '2m',  target: 50 }, // hold steady\n    { duration: '30s', target: 0 },  // ramp down\n  ],\n}",
              },
              {
                title: 'Set pass/fail thresholds',
                detail:
                  'Thresholds turn subjective "is this fast enough?" questions into an automated pass/fail check — exactly what a CI pipeline needs to gate a deployment.',
                code: "export const options = {\n  thresholds: {\n    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms\n    http_req_failed: ['rate<0.01'],    // less than 1% errors\n  },\n}",
              },
              {
                title: 'Fail the CI job automatically (useful case)',
                detail:
                  'k6 exits with a non-zero code when any threshold is breached, so a CI step simply needs to run k6 — no extra parsing logic required to gate the pipeline.',
                code: '# k6 exits non-zero automatically if thresholds fail\nk6 run script.js || exit 1',
              },
            ],
          },
          {
            id: 'k6-m2-l2',
            title: 'Debugging & Analyzing Load Test Results',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Interpret k6\'s summary output, isolate slow endpoints, and diagnose script errors under load.',
            objectives: [
              'Read the end-of-run summary and identify the real bottleneck',
              'Use console.log and tags to debug script logic',
              'Distinguish client-side script errors from server-side failures',
              'Export detailed metrics for deeper analysis',
            ],
            practice: 'Run a script with an intentional bug, then use console.log and check output to locate and fix it.',
            steps: [
              {
                title: 'Read the summary output correctly',
                detail:
                  'k6\'s default summary reports http_req_duration (with avg/min/med/max/p90/p95), http_req_failed (error rate), and iteration counts. Always check http_req_failed first — a high error rate makes latency numbers meaningless, since failed requests often return fast.',
                code: '# Example summary excerpt:\n# http_req_duration..: avg=120ms  p(95)=450ms\n# http_req_failed....: 12.34%      <- check this FIRST; high error rate invalidates latency numbers',
              },
              {
                title: 'Add console.log for script-level debugging',
                detail:
                  'Before assuming a threshold failure is a real performance problem, log the response body/status for a subset of iterations to rule out a scripting bug (wrong URL, missing auth) that is throwing errors unrelated to actual load.',
                code: "export default function () {\n  const res = http.get('https://test.k6.io')\n  if (res.status !== 200) {\n    console.log(`unexpected status ${res.status}: ${res.body.substring(0, 200)}`)\n  }\n}",
              },
              {
                title: 'Tag requests to isolate slow endpoints (useful case)',
                detail:
                  'When a script calls multiple endpoints, tag each http call so the summary/metrics break down duration per endpoint instead of one blended average — this tells you exactly which endpoint is the real bottleneck.',
                code: "http.get(`${BASE_URL}/products`, { tags: { name: 'ListProducts' } })\nhttp.get(`${BASE_URL}/orders`,   { tags: { name: 'ListOrders' } })\n// Now check metrics filtered by tag name to compare endpoint-level latency",
              },
              {
                title: 'Distinguish client vs server-side failures',
                detail:
                  'A connection refused/timeout error means k6 itself could not reach the server (network/client-side issue, or the server fell over); a 4xx/5xx status means the server responded but rejected the request. These need very different investigations.',
                code: "// Log detailed error info to tell the two apart\nif (res.error) {\n  console.log('client-side/network error:', res.error)   // k6 couldn't complete the request\n} else if (res.status >= 500) {\n  console.log('server error:', res.status, res.body)      // server responded but failed\n}",
              },
              {
                title: 'Export detailed metrics for deeper analysis',
                detail:
                  'The default summary is an aggregate. For serious performance debugging, stream all raw metrics to a file or a time-series backend (InfluxDB, Prometheus) so you can plot latency over time and spot exactly when it degraded.',
                code: '# Write every data point to a JSON file for offline analysis\nk6 run --out json=results.json script.js\n\n# Or stream to InfluxDB/Grafana for live dashboards\nk6 run --out influxdb=http://localhost:8086/k6 script.js',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a load test fails or looks wrong: (1) check http_req_failed before latency numbers, (2) log a sample of failing responses to rule out script bugs, (3) tag requests per endpoint to isolate the slow one, (4) separate client-side errors from server errors, (5) export raw metrics if you need to correlate timing with a specific ramp-up stage.',
              },
            ],
          },
        ],
        quiz: {
          question: 'Your k6 run shows a very high p(95) latency, but http_req_failed is also at 40%. What should you investigate first?',
          options: [
            'Immediately conclude the API is too slow and needs performance tuning',
            'Investigate the high error rate first, since failed requests can skew latency numbers and often indicate a script or server error rather than pure slowness',
            'Increase the number of virtual users to see if it gets better',
            'Ignore http_req_failed entirely and only look at latency',
          ],
          correctIndex: 1,
          explanation: 'A high error rate should be investigated before trusting latency numbers, since failed requests (timeouts, 5xx errors) can distort duration statistics and usually point to a different root cause than pure performance.',
        },
      },
    ],
    resources: [
      { label: 'Official k6 Documentation', url: 'https://k6.io/docs/' },
      { label: 'k6 GitHub', url: 'https://github.com/grafana/k6' },
      { label: 'k6 Thresholds Reference', url: 'https://k6.io/docs/using-k6/thresholds/' },
    ],
  },
  {
    id: 'karate',
    track: 'frameworks',
    name: 'Karate DSL',
    tagline: 'BDD-style API testing, mocking and performance in one tool',
    category: 'API Automation',
    frameworkType: 'api',
    icon: Activity,
    accent: 'emerald',
    overview:
      'Karate combines API test automation, mocks and even performance testing into a single Gherkin-like DSL that requires no Java glue code to get started, while still being fully extensible with Java when needed. This program covers writing feature files, JSON assertions, and CI integration.',
    prerequisites: [
      'Basic understanding of HTTP and JSON',
      'Basic familiarity with Gherkin/BDD syntax is helpful but not required',
      'JDK 17+ and Maven installed',
    ],
    outcomes: [
      'Write readable API tests in Karate\'s .feature syntax',
      'Assert on JSON responses with match expressions',
      'Chain requests and reuse steps across scenarios',
      'Run Karate suites in CI with standard JUnit reporting',
    ],
    modules: [
      {
        id: 'karate-m1',
        title: 'Getting Started with Karate',
        description: 'Set up Karate and write your first feature file.',
        lessons: [
          {
            id: 'karate-m1-l1',
            title: 'Setup & Your First Feature File',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Add Karate to a Maven project and write a readable API test in a .feature file.',
            objectives: [
              'Add the Karate dependency to a Maven project',
              'Understand Given/When/Then syntax in a .feature file',
              'Run a feature file via JUnit',
            ],
            practice: 'Write a feature file that GETs a public API and asserts on the response.',
            steps: [
              {
                title: 'Why Karate',
                detail:
                  'Karate lets you write API tests in a plain-text, Gherkin-inspired syntax with built-in HTTP and JSON support — no step-definition glue code is required, unlike traditional Cucumber, which makes it fast to get started for both engineers and QA analysts.',
              },
              {
                title: 'Add the dependency',
                detail:
                  'Karate is added as a test-scoped Maven dependency and runs through a thin JUnit 5 wrapper class.',
                code: '<dependency>\n  <groupId>com.intuit.karate</groupId>\n  <artifactId>karate-junit5</artifactId>\n  <version>1.5.0</version>\n  <scope>test</scope>\n</dependency>',
              },
              {
                title: 'Write a feature file',
                detail:
                  'A .feature file describes a scenario using Given/When/Then, with built-in keywords for URLs, HTTP methods and JSON assertions — no custom code required for basic checks.',
                code: 'Feature: Post API\n\nScenario: get a single post\n  Given url \'https://jsonplaceholder.typicode.com/posts/1\'\n  When method get\n  Then status 200\n  And match response.userId == 1',
              },
              {
                title: 'Run it via JUnit',
                detail:
                  'A minimal JUnit class points at the feature file(s), so Karate tests integrate with the exact same tooling (Maven, IDE, CI) as regular Java tests.',
                code: "import com.intuit.karate.junit5.Karate;\n\nclass PostRunnerTest {\n  @Karate.Test\n  Karate testPosts() { return Karate.run(\"post-api\").relativeTo(getClass()); }\n}",
              },
            ],
          },
        ],
        quiz: {
          question: 'What is a key difference between Karate and traditional Cucumber when writing API tests?',
          options: [
            'Karate has built-in HTTP/JSON support so most scenarios need no custom step-definition code',
            'Karate cannot make HTTP requests at all',
            'Karate requires more Java glue code than plain Cucumber',
            'Karate only supports SOAP APIs',
          ],
          correctIndex: 0,
          explanation: 'Karate provides built-in keywords for HTTP calls and JSON matching, meaning most API scenarios can be written without any custom step-definition code, unlike vanilla Cucumber.',
        },
      },
      {
        id: 'karate-m2',
        title: 'JSON Matching & Reusable Scenarios',
        description: 'Validate complex responses and share logic across features.',
        lessons: [
          {
            id: 'karate-m2-l1',
            title: 'Match Expressions & Reusable Steps',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Validate JSON structures with match expressions and reuse logic across scenarios.',
            objectives: [
              'Use match to validate JSON structure and values',
              'Use markers like #string and #number for flexible schema checks',
              'Call a reusable feature file from another scenario',
            ],
            practice: 'Write a schema-style match that validates a response shape without hardcoding every value.',
            steps: [
              {
                title: 'Match exact and flexible values',
                detail:
                  'match compares JSON deeply; special markers like #string, #number and #uuid validate the type of a field without pinning its exact value, ideal for fields like timestamps or generated ids.',
                code: "Then match response ==\n\"\"\"\n{\n  id: '#number',\n  title: '#string',\n  userId: 1\n}\n\"\"\"",
              },
              {
                title: 'Extract and reuse values',
                detail:
                  'Karate lets you save a response value into a variable for use later in the same scenario, similar to other frameworks\' extract() features.',
                code: "Given url 'https://api.example.com/orders'\nAnd request { item: 'Widget' }\nWhen method post\nThen status 201\n* def orderId = response.id     // save the generated id",
              },
              {
                title: 'Reuse a scenario as a callable feature (useful case)',
                detail:
                  'Common flows like login can be extracted into their own .feature file and called from many other tests, avoiding duplicated setup logic.',
                code: "# login.feature\nFeature: reusable login\nScenario:\n  Given url 'https://api.example.com/login'\n  And request { user: 'demo', pass: 'secret' }\n  When method post\n  Then status 200\n  * def authToken = response.token\n\n# used from another feature:\n* def result = call read('login.feature')\n* def token = result.authToken",
              },
            ],
          },
          {
            id: 'karate-m2-l2',
            title: 'Debugging Karate Scenarios',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Use Karate\'s built-in logging, the debug print keyword, and HTML reports to diagnose failing scenarios.',
            objectives: [
              'Use print and karate.log for inline debugging',
              'Read the generated HTML report to find the failing step',
              'Debug a failing match expression by printing the raw response',
              'Diagnose a broken call to a reusable feature file',
            ],
            practice: 'Break a match expression on purpose, then use print to inspect the actual response and fix it.',
            steps: [
              {
                title: 'Print values inline with print',
                detail:
                  'The print keyword writes a value to the console at that exact point in the scenario, without needing separate debug scripts — the fastest way to inspect a variable mid-scenario.',
                code: "Given url 'https://api.example.com/orders/1'\nWhen method get\n* print 'response was:', response      // prints the full JSON to console\nThen status 200",
              },
              {
                title: 'Debug a failing match by printing the raw response (useful case)',
                detail:
                  'When a match assertion fails, Karate shows expected vs actual, but for deeply nested objects it helps to print the whole response first and visually compare it to your match block.',
                code: "When method get\n* print response\nThen match response ==\n\"\"\"\n{ id: '#number', status: '#string' }\n\"\"\"",
              },
              {
                title: 'Read the HTML report',
                detail:
                  'Karate generates a self-contained HTML report per run showing every scenario, step, request/response payload and the exact step that failed — open it first before re-running anything.',
                code: '# Reports are generated under target/karate-reports by default\nopen target/karate-reports/karate-summary.html',
              },
              {
                title: 'Use karate.log for structured logging',
                detail:
                  'karate.log() (backed by SLF4J) integrates with your existing logging setup and is preferable to print for anything you want to keep permanently in the test, since it respects log levels.',
                code: "* karate.log('order id created:', orderId)",
              },
              {
                title: 'Diagnose a broken callable feature (useful case)',
                detail:
                  'If call read(\'login.feature\') fails or returns unexpected data, run that feature file directly and independently first to confirm it works in isolation, before assuming the calling scenario is at fault.',
                code: '# Run just the login feature standalone to isolate the problem\nmvn test -Dtest=LoginRunnerTest',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a Karate scenario fails: (1) print the raw response before the match statement, (2) open the HTML report to see the exact failing step, (3) run any called feature file independently to rule it out, (4) use karate.log for anything worth keeping long-term, (5) only then suspect the API itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A match expression fails deep inside a nested JSON object and the expected-vs-actual diff is hard to read. What is the fastest way to understand the real response shape?',
          options: [
            'Print the full response with the print keyword right before the match statement, then compare it visually to the expected structure',
            'Delete the match statement so the test passes',
            'Assume the API changed without checking anything',
            'Karate provides no way to inspect a response before asserting on it',
          ],
          correctIndex: 0,
          explanation: 'Printing the raw response right before a failing match gives you the exact actual JSON shape to compare against your expected structure, which is the quickest way to spot a nesting or naming mismatch.',
        },
      },
    ],
    resources: [
      { label: 'Official Karate Documentation', url: 'https://github.com/karatelabs/karate' },
      { label: 'Karate Match Syntax Guide', url: 'https://github.com/karatelabs/karate#match' },
    ],
  },
  {
    id: 'javascript',
    track: 'languages',
    name: 'JavaScript',
    tagline: 'Automation scripting for Web, API and E2E testing',
    category: 'Programming Language',
    icon: Code2,
    accent: 'orange',
    overview:
      'JavaScript is one of the most used languages in test automation thanks to rich ecosystems like Playwright, Cypress and WebdriverIO. This path teaches practical JavaScript patterns directly tied to reliable automation test suites.',
    prerequisites: [
      'Basic programming fundamentals (variables, functions, loops)',
      'Node.js 18+ installed',
      'Basic understanding of APIs and browser concepts',
    ],
    outcomes: [
      'Write clean asynchronous test scripts with async/await',
      'Build maintainable UI and API tests with reusable helpers',
      'Use robust selectors and waiting strategies to reduce flakiness',
      'Integrate JavaScript tests into CI/CD pipelines with reports',
    ],
    modules: [
      {
        id: 'js-m1',
        title: 'JavaScript Fundamentals for Test Automation',
        description: 'Core JavaScript concepts used every day in automation scripts.',
        lessons: [
          {
            id: 'js-m1-l1',
            title: 'Variables, Objects and Arrays in Test Data',
            duration: '35 min',
            level: 'Beginner',
            summary: 'Model realistic test users, payloads and expected responses with JS data structures.',
            objectives: [
              'Use const/let correctly in test code',
              'Build test fixtures as objects and arrays',
              'Generate dynamic data for repeatable tests',
            ],
            practice: 'Create a reusable users fixture and use it in two API test cases.',
            steps: [
              {
                title: 'Create structured test data',
                detail: 'Use objects for entities and arrays for collections so test data remains readable.',
                code: "// Reusable test users fixture\nconst users = [\n  { username: 'qa_admin', role: 'admin', active: true },\n  { username: 'qa_viewer', role: 'viewer', active: true },\n]",
              },
              {
                title: 'Access and transform data',
                detail: 'Automation often needs filtering and mapping fixture data.',
                code: "// Keep only active admin users\nconst activeAdmins = users.filter(u => u.active && u.role === 'admin')\n\n// Extract usernames for assertions\nconst usernames = activeAdmins.map(u => u.username)",
              },
              {
                title: 'Generate unique test values (useful case)',
                detail: 'Avoid collisions by adding unique suffixes for users/emails.',
                code: "const unique = Date.now()\nconst testEmail = `qa+${unique}@example.com`  // unique per run",
              },
            ],
          },
          {
            id: 'js-m1-l2',
            title: 'Functions and Reusable Helpers',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Avoid duplication by extracting repeatable setup and assertion helpers.',
            objectives: [
              'Write parameterized helper functions',
              'Separate setup logic from test intent',
              'Improve readability with clear naming',
            ],
            practice: 'Refactor duplicate login steps into a helper used by 3 tests.',
            steps: [
              {
                title: 'Identify duplication',
                detail: 'If the same steps appear in multiple tests, extract a helper.',
              },
              {
                title: 'Create a helper function',
                detail: 'Parameterize credentials and reuse across tests.',
                code: "async function login(page, username, password) {\n  await page.fill('[data-testid=login-user]', username)\n  await page.fill('[data-testid=login-pass]', password)\n  await page.click('[data-testid=login-submit]')\n}",
              },
              {
                title: 'Use helper in tests',
                detail: 'Tests should read like behavior, not low-level script details.',
                code: "test('admin can access dashboard', async ({ page }) => {\n  await page.goto('/login')\n  await login(page, 'qa_admin', 'secret')\n  await expect(page.getByText('Dashboard')).toBeVisible()\n})",
              },
            ],
          },
        ],
        quiz: {
          question: 'You need unique test emails on every run so parallel or repeated runs never collide. What is a good approach?',
          options: [
            'Reuse the exact same email in every test run',
            'Append a unique value like Date.now() to the email to make each run distinct',
            'Ask a teammate for a new email before every run',
            'Hardcode ten different emails and cycle through them manually',
          ],
          correctIndex: 1,
          explanation: 'Appending something like Date.now() (or a UUID) guarantees a unique value per run, avoiding collisions with existing test data.',
        },
      },
      {
        id: 'js-m2',
        title: 'Async JavaScript for Reliable Tests',
        description: 'Master async/await and timing control to remove flaky behavior.',
        lessons: [
          {
            id: 'js-m2-l1',
            title: 'Promises and async/await in Automation',
            duration: '40 min',
            level: 'Intermediate',
            summary: 'Understand asynchronous browser/API actions and how to await them correctly.',
            objectives: [
              'Use await on every async test action',
              'Avoid race conditions between actions and assertions',
              'Handle async failures cleanly',
            ],
            practice: 'Fix a flaky test by adding missing await statements.',
            steps: [
              {
                title: 'Understand the async model',
                detail: 'Most browser and API operations are Promise-based; assertions must wait for completion.',
              },
              {
                title: 'Spot a classic bug',
                detail: 'Missing await can make assertions run before state changes are complete.',
                code: "// BUG: click is not awaited\npage.click('[data-testid=save]')\nawait expect(page.getByText('Saved')).toBeVisible()",
              },
              {
                title: 'Apply the fix',
                detail: 'Await every async operation before continuing.',
                code: "// FIX: await the action\nawait page.click('[data-testid=save]')\nawait expect(page.getByText('Saved')).toBeVisible()",
              },
            ],
          },
          {
            id: 'js-m2-l2',
            title: 'Waiting Strategies that Reduce Flakes',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Use condition-based waits instead of hard sleeps.',
            objectives: [
              'Replace fixed delays with explicit conditions',
              'Wait for network and UI states safely',
              'Use timeouts intentionally',
            ],
            practice: 'Replace all hard waits in a test suite with robust wait conditions.',
            steps: [
              {
                title: 'Avoid hard sleeps',
                detail: 'Fixed waits are either too short (flaky) or too long (slow).',
                code: "// Avoid this\n// await page.waitForTimeout(5000)",
              },
              {
                title: 'Wait for meaningful conditions',
                detail: 'Wait for selectors, responses, URLs or text that indicate readiness.',
                code: "await page.waitForSelector('[data-testid=result-row]')\nawait page.waitForResponse(r => r.url().includes('/api/results') && r.status() === 200)",
              },
              {
                title: 'Set clear timeout boundaries (useful case)',
                detail: 'Use explicit per-step timeouts and fail with context.',
                code: "await expect(page.getByText('Execution completed')).toBeVisible({ timeout: 15000 })",
              },
            ],
          },
        ],
        quiz: {
          question: "An assertion right after clicking 'Save' sometimes fails, even though the item is saved a moment later. What's the most likely bug?",
          options: [
            'The assertion library is broken',
            'A missing await before the async click, causing the assertion to run before the save completes',
            "The test framework doesn't support clicking buttons",
            'The server is down',
          ],
          correctIndex: 1,
          explanation: "If the click (or another async action) isn't awaited, the test continues immediately and the assertion can run before the UI/state actually updates — a classic race condition.",
        },
      },
      {
        id: 'js-m3',
        title: 'Automation Testing with Playwright (JS)',
        description: 'Build practical UI + API tests in JavaScript using Playwright.',
        lessons: [
          {
            id: 'js-m3-l1',
            title: 'Create and Run Your First Playwright Suite',
            duration: '45 min',
            level: 'Intermediate',
            summary: 'Set up Playwright, run tests and generate HTML reports.',
            objectives: [
              'Bootstrap a Playwright project',
              'Write UI assertions with locator APIs',
              'Run tests headless and with report output',
            ],
            practice: 'Create a login smoke suite and run it in CI mode.',
            steps: [
              {
                title: 'Bootstrap Playwright',
                detail: 'Initialize project and install browsers.',
                code: "npm init playwright@latest      # scaffold Playwright project\nnpx playwright install          # install browser binaries",
              },
              {
                title: 'Write a smoke test',
                detail: 'Use robust test IDs and visibility assertions.',
                code: "import { test, expect } from '@playwright/test'\n\ntest('login smoke', async ({ page }) => {\n  await page.goto('https://example.com/login')\n  await page.fill('[data-testid=login-user]', 'qa_admin')\n  await page.fill('[data-testid=login-pass]', 'secret')\n  await page.click('[data-testid=login-submit]')\n  await expect(page.getByText('Dashboard')).toBeVisible()\n})",
              },
              {
                title: 'Run and inspect report',
                detail: 'Generate report for local debugging and CI artifacts.',
                code: "npx playwright test --reporter=html   # run and produce HTML report\nnpx playwright show-report            # open generated report locally",
              },
            ],
          },
          {
            id: 'js-m3-l2',
            title: 'Combine UI + API Validation',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Validate backend responses directly inside front-end flows.',
            objectives: [
              'Intercept and validate API calls',
              'Assert contract-level response properties',
              'Capture useful debug info on failures',
            ],
            practice: 'During UI test, assert payload from /api/runs endpoint.',
            steps: [
              {
                title: 'Listen for API response',
                detail: 'Wait for a specific endpoint while triggering UI action.',
                code: "const responsePromise = page.waitForResponse(r => r.url().includes('/api/runs') && r.status() === 200)\nawait page.click('[data-testid=load-runs]')\nconst response = await responsePromise",
              },
              {
                title: 'Assert response payload',
                detail: 'Confirm schema-level fields expected by UI.',
                code: "const payload = await response.json()\nexpect(Array.isArray(payload.items)).toBeTruthy()\nexpect(payload.items[0]).toHaveProperty('status')",
              },
              {
                title: 'Attach debug snapshot (useful case)',
                detail: 'Collect trace/screenshot on failure to speed triage.',
                code: "await page.screenshot({ path: 'artifacts/runs-page.png', fullPage: true })",
              },
            ],
          },
          {
            id: 'js-m3-l3',
            title: 'Debugging Async JavaScript Test Failures',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Diagnose the most common bug class in JS automation: mishandled promises and async timing.',
            objectives: [
              'Spot missing await causing false-positive passes',
              'Use try/catch and .catch() to surface hidden promise rejections',
              'Debug with Node\'s inspector and breakpoints',
              'Read unhandled promise rejection warnings correctly',
            ],
            practice: 'Introduce a missing await on purpose, observe the test falsely pass, then fix it and see it correctly fail.',
            steps: [
              {
                title: 'The most common JS test bug: a missing await',
                detail:
                  'If you forget await before an async call, the test moves on before the operation completes — assertions can run against stale state, or the promise rejection is silently swallowed and the test passes even though the underlying action never happened.',
                code: "// BAD: missing await — test may pass even if click() never actually completed\ntest('submits form', async ({ page }) => {\n  page.click('[data-testid=submit]')          // <- missing await!\n  await expect(page.getByText('Success')).toBeVisible()\n})\n\n// GOOD: every async call is awaited\ntest('submits form', async ({ page }) => {\n  await page.click('[data-testid=submit]')\n  await expect(page.getByText('Success')).toBeVisible()\n})",
              },
              {
                title: 'Surface hidden rejections with try/catch',
                detail:
                  'Wrap risky async code in try/catch and log the error explicitly, rather than letting a rejected promise disappear silently or produce a vague generic failure.',
                code: "try {\n  await page.click('[data-testid=submit]')\n} catch (err) {\n  console.error('click failed:', err.message)\n  throw err   // still fail the test, but with a clear, logged reason\n}",
              },
              {
                title: 'Read "UnhandledPromiseRejection" warnings',
                detail:
                  'Node prints this warning when a rejected promise has no .catch()/try-catch anywhere. Treat it as a bug to fix, not noise to ignore — it usually means an async operation failed somewhere without the test properly reporting it.',
                code: "// Example warning in test output:\n// UnhandledPromiseRejectionWarning: Error: Timeout 30000ms exceeded\n// -> find the await-less async call this originated from and add proper error handling",
              },
              {
                title: 'Debug with the Node inspector (useful case)',
                detail:
                  'For complex async logic, run the test process with --inspect-brk and attach Chrome DevTools or your IDE debugger to step through await boundaries one at a time, watching variable values as each promise resolves.',
                code: '# Attach a debugger and pause on the first line\nnode --inspect-brk node_modules/.bin/playwright test tests/checkout.spec.ts',
              },
              {
                title: 'Use Promise.all correctly for concurrent waits (useful case)',
                detail:
                  'When you need to wait for a UI action and a network response together, start the wait before triggering the action and combine them with Promise.all — starting the wait after the click can miss a response that resolves too quickly.',
                code: "// Start listening for the response BEFORE triggering the action\nconst [response] = await Promise.all([\n  page.waitForResponse(r => r.url().includes('/api/submit')),\n  page.click('[data-testid=submit]'),\n])",
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When an async JS test behaves oddly (false pass, hang, or flaky failure): (1) scan for a missing await near the failure, (2) check for unhandled rejection warnings in the output, (3) verify wait-then-trigger ordering with Promise.all, (4) attach the Node inspector for complex flows, (5) only then suspect the app itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A Playwright test sometimes reports success even though a form submission clearly never happened when you watch it run. What is the most likely root cause?',
          options: [
            'A missing await before an async action (like page.click()), letting the test continue and assert before the action actually completed',
            'The test framework has a fundamental bug',
            'The browser is corrupted and needs reinstalling',
            'JavaScript cannot run asynchronous code reliably',
          ],
          correctIndex: 0,
          explanation: 'Forgetting await on an async call is the most common cause of false-positive passes in JS test automation, since the test proceeds before the action (or its rejection) is actually resolved.',
        },
      },
    ],
    resources: [
      { label: 'Playwright Docs', url: 'https://playwright.dev/docs/intro' },
      { label: 'MDN JavaScript Guide', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide' },
      { label: 'Node.js Docs', url: 'https://nodejs.org/docs/latest/api/' },
    ],
  },
  {
    id: 'java',
    track: 'languages',
    name: 'Java',
    tagline: 'Enterprise-grade automation with Selenium, REST Assured and TestNG/JUnit',
    category: 'Programming Language',
    icon: Coffee,
    accent: 'purple',
    overview:
      'Java remains a top choice for enterprise automation testing. This path covers robust test architecture patterns for UI and API automation using Selenium, REST Assured and modern Java testing practices.',
    prerequisites: [
      'Java 17+ installed',
      'Basic OOP concepts (classes, interfaces, inheritance)',
      'Maven or Gradle basics',
    ],
    outcomes: [
      'Build maintainable Java automation projects with clear structure',
      'Write stable Selenium tests using waits and Page Objects',
      'Create API automation with REST Assured and schema checks',
      'Integrate Java tests in CI pipelines with reports',
    ],
    modules: [
      {
        id: 'java-m1',
        title: 'Java Project Setup for Automation',
        description: 'Create a clean automation project structure with dependencies.',
        lessons: [
          {
            id: 'java-m1-l1',
            title: 'Initialize Maven Automation Project',
            duration: '35 min',
            level: 'Beginner',
            summary: 'Set up Maven dependencies for Selenium, TestNG/JUnit and reporting.',
            objectives: [
              'Create a Java automation project skeleton',
              'Configure core dependencies in pom.xml',
              'Run the first test from CLI',
            ],
            practice: 'Create a Maven project and execute one passing smoke test.',
            steps: [
              {
                title: 'Generate Maven project',
                detail: 'Use Maven archetype to bootstrap a standard Java project.',
                code: "mvn archetype:generate \\\n+  -DgroupId=com.example.qa \\\n+  -DartifactId=automation-suite \\\n+  -DarchetypeArtifactId=maven-archetype-quickstart \\\n+  -DinteractiveMode=false    # creates project without prompts",
              },
              {
                title: 'Add testing dependencies',
                detail: 'Include Selenium + test runner + REST Assured as baseline.',
                code: "<!-- pom.xml dependencies -->\n<dependency>\n  <groupId>org.seleniumhq.selenium</groupId>\n  <artifactId>selenium-java</artifactId>\n  <version>4.22.0</version>\n</dependency>\n<dependency>\n  <groupId>io.rest-assured</groupId>\n  <artifactId>rest-assured</artifactId>\n  <version>5.5.0</version>\n  <scope>test</scope>\n</dependency>\n<dependency>\n  <groupId>org.junit.jupiter</groupId>\n  <artifactId>junit-jupiter</artifactId>\n  <version>5.10.2</version>\n  <scope>test</scope>\n</dependency>",
              },
              {
                title: 'Run tests from CLI',
                detail: 'Validate that project compiles and tests execute.',
                code: "mvn test    # compile + run unit/automation tests",
              },
            ],
          },
          {
            id: 'java-m1-l2',
            title: 'Design Test Package Structure',
            duration: '30 min',
            level: 'Intermediate',
            summary: 'Organize tests, pages, API clients and utilities for maintainability.',
            objectives: [
              'Separate concerns by package',
              'Create reusable utility layers',
              'Keep tests focused on behavior',
            ],
            practice: 'Refactor a flat test project into layered package structure.',
            steps: [
              {
                title: 'Create layered packages',
                detail: 'Use clear boundaries between test specs and framework code.',
                code: "src/test/java/com/example/qa/\n  ui/tests/            # test classes only\n  ui/pages/            # page objects\n  api/tests/           # API test classes\n  api/clients/         # reusable API wrappers\n  core/utils/          # shared helpers",
              },
              {
                title: 'Move setup code to base classes',
                detail: 'Avoid copy/paste browser setup and teardown.',
                code: "public abstract class BaseUiTest {\n  protected WebDriver driver;\n\n  @BeforeEach\n  void setUp() {\n    driver = new ChromeDriver();\n  }\n\n  @AfterEach\n  void tearDown() {\n    if (driver != null) driver.quit();\n  }\n}",
              },
            ],
          },
        ],
        quiz: {
          question: 'Every test class in your Java suite repeats the same WebDriver setup and teardown code. What is the best practice to fix this?',
          options: [
            'Copy-paste the setup/teardown into every new test class',
            'Move the shared setup/teardown into a common base class using @BeforeEach/@AfterEach',
            'Only run one test at a time to avoid needing setup',
            'Remove teardown entirely to save time',
          ],
          correctIndex: 1,
          explanation: 'A shared base class with @BeforeEach/@AfterEach centralizes driver lifecycle management so individual test classes stay focused on behavior.',
        },
      },
      {
        id: 'java-m2',
        title: 'Java UI Automation with Selenium',
        description: 'Create resilient browser automation using Java and Selenium.',
        lessons: [
          {
            id: 'java-m2-l1',
            title: 'Locators, Waits and Assertions',
            duration: '40 min',
            level: 'Intermediate',
            summary: 'Use explicit waits and robust locators for reliable UI tests.',
            objectives: [
              'Use By strategies intentionally',
              'Apply WebDriverWait instead of Thread.sleep',
              'Assert user-visible outcomes',
            ],
            practice: 'Replace unstable locators and sleeps in a flaky login test.',
            steps: [
              {
                title: 'Use robust locators',
                detail: 'Prefer data-testid/id over brittle xpath paths.',
                code: "By username = By.cssSelector(\"[data-testid='login-user']\");\nBy submit = By.cssSelector(\"[data-testid='login-submit']\");",
              },
              {
                title: 'Wait for conditions explicitly',
                detail: 'Use ExpectedConditions for synchronization.',
                code: "WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));\nwait.until(ExpectedConditions.visibilityOfElementLocated(username));\ndriver.findElement(username).sendKeys(\"qa_admin\");\ndriver.findElement(submit).click();",
              },
              {
                title: 'Assert final behavior',
                detail: 'Assert what user sees after action.',
                code: "WebElement dashboard = wait.until(\n  ExpectedConditions.visibilityOfElementLocated(By.xpath(\"//*[contains(text(),'Dashboard')]\"))\n);\nAssertions.assertTrue(dashboard.isDisplayed());",
              },
            ],
          },
          {
            id: 'java-m2-l2',
            title: 'Page Object Model in Java',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Encapsulate UI operations into page classes for scalable suites.',
            objectives: [
              'Create page classes with clear APIs',
              'Keep test methods readable and short',
              'Centralize locator changes',
            ],
            practice: 'Implement LoginPage and DashboardPage and refactor smoke tests.',
            steps: [
              {
                title: 'Create page class',
                detail: 'Encapsulate locators and interactions.',
                code: "public class LoginPage {\n  private final WebDriver driver;\n  private final By user = By.cssSelector(\"[data-testid='login-user']\");\n  private final By pass = By.cssSelector(\"[data-testid='login-pass']\");\n  private final By submit = By.cssSelector(\"[data-testid='login-submit']\");\n\n  public LoginPage(WebDriver driver) { this.driver = driver; }\n\n  public void login(String u, String p) {\n    driver.findElement(user).sendKeys(u);\n    driver.findElement(pass).sendKeys(p);\n    driver.findElement(submit).click();\n  }\n}",
              },
              {
                title: 'Use page in tests',
                detail: 'Test reads as business flow now.',
                code: "@Test\nvoid adminCanLogin() {\n  driver.get(baseUrl + \"/login\");\n  new LoginPage(driver).login(\"qa_admin\", \"secret\");\n  Assertions.assertTrue(new DashboardPage(driver).isLoaded());\n}",
              },
            ],
          },
        ],
        quiz: {
          question: 'Your Selenium test uses Thread.sleep(5000) and still fails intermittently. What is the correct fix?',
          options: [
            'Increase the sleep to 15000ms',
            'Replace Thread.sleep with WebDriverWait and ExpectedConditions for the specific state you need',
            'Run the test twice and ignore the first failure',
            'Remove all waits entirely',
          ],
          correctIndex: 1,
          explanation: "Fixed sleeps either waste time or aren't long enough; WebDriverWait with ExpectedConditions waits exactly for the needed condition, making the test both faster and reliable.",
        },
      },
      {
        id: 'java-m3',
        title: 'Java API Automation with REST Assured',
        description: 'Validate REST APIs with Java and contract-level checks.',
        lessons: [
          {
            id: 'java-m3-l1',
            title: 'Build API Request/Response Tests',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Create readable API tests for status, schema and payload checks.',
            objectives: [
              'Send HTTP requests with REST Assured',
              'Assert status and body fields',
              'Use reusable request specs',
            ],
            practice: 'Validate GET /runs returns expected schema and status.',
            steps: [
              {
                title: 'Create base request spec',
                detail: 'Centralize base URL and common headers.',
                code: "RequestSpecification spec = new RequestSpecBuilder()\n  .setBaseUri(baseUrl)\n  .addHeader(\"Authorization\", \"Bearer \" + token)\n  .build();",
              },
              {
                title: 'Send request and assert response',
                detail: 'Check status and payload fields in one flow.',
                code: "given()\n  .spec(spec)\n.when()\n  .get(\"/api/runs\")\n.then()\n  .statusCode(200)\n  .body(\"items.size()\", greaterThan(0))\n  .body(\"items[0].status\", notNullValue());",
              },
              {
                title: 'Add contract assertion (useful case)',
                detail: 'Validate response shape with JSON schema for stronger contracts.',
                code: "given()\n  .spec(spec)\n.when()\n  .get(\"/api/runs\")\n.then()\n  .assertThat()\n  .body(matchesJsonSchemaInClasspath(\"schemas/runs.schema.json\"));",
              },
            ],
          },
          {
            id: 'java-m3-l2',
            title: 'CI Integration and Reporting',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Run Java automation in CI with clear reports and artifact retention.',
            objectives: [
              'Run suite headless in CI',
              'Publish JUnit reports',
              'Archive failure artifacts',
            ],
            practice: 'Add a GitHub Actions job running mvn test with report upload.',
            steps: [
              {
                title: 'Create CI workflow',
                detail: 'Run tests on each push/PR.',
                code: "name: Java Automation\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: '21'\n      - run: mvn -B test",
              },
              {
                title: 'Upload reports',
                detail: 'Keep reports available even on failures.',
                code: "- uses: actions/upload-artifact@v4\n  if: always()\n  with:\n    name: surefire-reports\n    path: target/surefire-reports/",
              },
            ],
          },
          {
            id: 'java-m3-l3',
            title: 'Debugging Java Automation Failures',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Diagnose stack traces, flaky Selenium waits, and API assertion failures methodically.',
            objectives: [
              'Read a Java stack trace to find your code, not just the framework',
              'Debug with breakpoints in an IDE vs. print statements',
              'Diagnose NoSuchElementException and TimeoutException correctly',
              'Use REST Assured logging to inspect a failing API call',
            ],
            practice: 'Trigger a NoSuchElementException on purpose and use the stack trace plus logging to locate the fix.',
            steps: [
              {
                title: 'Read the stack trace top-down, but find your code',
                detail:
                  'The topmost line is where the exception was thrown, but that is often deep inside Selenium/REST Assured internals. Scan down the trace until you find the first line referencing your own test class — that is the line to start investigating from.',
                code: '// Example trace — scan down to find YOUR class:\n// org.openqa.selenium.NoSuchElementException: no such element...\n//   at org.openqa.selenium.remote.RemoteWebDriver.findElement(...)\n//   at com.example.tests.LoginTest.adminCanLogin(LoginTest.java:42)  <- start here',
              },
              {
                title: 'Distinguish NoSuchElementException from TimeoutException',
                detail:
                  'NoSuchElementException from a plain findElement() means the element was never in the DOM at that instant (often too early). TimeoutException from WebDriverWait means it waited the full duration and the condition still never became true — check if the element exists at all vs. is simply slow to satisfy the condition.',
                code: '// Quick check in the debugger/console: does the element exist AT ALL?\nList<WebElement> matches = driver.findElements(locator);\nSystem.out.println("matches found: " + matches.size());  // 0 = wrong locator; >0 = timing/condition issue',
              },
              {
                title: 'Use IDE breakpoints over print statements (useful case)',
                detail:
                  'For non-trivial failures, set a breakpoint right before the failing line and run the single test in Debug mode. You can inspect the live WebDriver session, the actual page HTML, and every local variable — much richer than scattered System.out.println calls.',
                code: '// In IntelliJ: click the gutter next to the failing line, then\n// right-click the test method -> "Debug \'testMethodName()\'"',
              },
              {
                title: 'Enable REST Assured logging for API failures',
                detail:
                  'When an API assertion fails, add .log().ifValidationFails() to see the exact request and response Java sent/received — this alone resolves most "field is null" or "wrong status code" mysteries.',
                code: "given()\n  .spec(spec)\n.when()\n  .get(\"/api/runs\")\n.then()\n  .log().ifValidationFails()   // prints full request/response only when an assertion fails\n  .statusCode(200);",
              },
              {
                title: 'Diagnose intermittent CI-only failures (useful case)',
                detail:
                  'If a test is reliable locally but flaky in CI, suspect resource constraints (slower CI machine) or missing explicit waits that happened to work locally by luck. Convert any remaining Thread.sleep() calls to WebDriverWait conditions — this is the single most common fix for this class of bug.',
                code: '// Replace any remaining fixed sleep with an explicit, condition-based wait\nnew WebDriverWait(driver, Duration.ofSeconds(10))\n    .until(ExpectedConditions.elementToBeClickable(submitButton));',
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a Java test fails: (1) find the first line of the stack trace pointing to your own code, (2) determine whether the element/data exists at all vs. is just slow, (3) use a debugger breakpoint for complex state, (4) enable REST Assured\'s ifValidationFails() logging for API tests, (5) replace any Thread.sleep with explicit waits before suspecting the app.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A Selenium test throws NoSuchElementException, but when you manually check with driver.findElements(locator), it returns an empty list even after waiting. What does this tell you?',
          options: [
            'The wait duration was simply too short, so just add Thread.sleep(10000) everywhere',
            'The locator itself does not match anything in the current DOM — the problem is the selector/locator, not timing',
            'Selenium is fundamentally broken for this page',
            'The test should be deleted since it can never pass',
          ],
          correctIndex: 1,
          explanation: "If findElements() consistently returns zero matches even with adequate waiting, the locator itself is wrong (bad selector, wrong frame/iframe, or element genuinely does not exist), not a timing problem — waiting longer will not fix a bad locator.",
        },
      },
    ],
    resources: [
      { label: 'Selenium Java Docs', url: 'https://www.selenium.dev/documentation/webdriver/' },
      { label: 'REST Assured Docs', url: 'https://rest-assured.io/' },
      { label: 'JUnit 5 User Guide', url: 'https://junit.org/junit5/docs/current/user-guide/' },
    ],
  },
  {
    id: 'python',
    track: 'languages',
    name: 'Python',
    tagline: 'Fast, expressive automation with Pytest, Playwright/Selenium and requests',
    category: 'Programming Language',
    icon: Braces,
    accent: 'orange',
    overview:
      'Python is a top automation language because of readability and mature tooling. This path focuses on practical test automation using pytest, Playwright/Selenium and API testing patterns used by QA and SDET teams.',
    prerequisites: [
      'Python 3.11+ installed',
      'Basic understanding of virtual environments',
      'Introductory programming knowledge',
    ],
    outcomes: [
      'Build maintainable Python test suites with pytest fixtures',
      'Write robust UI automation with explicit waits and page objects',
      'Create API tests with requests and contract checks',
      'Run Python automation in CI with artifacts and logs',
    ],
    modules: [
      {
        id: 'py-m1',
        title: 'Python Test Automation Foundations',
        description: 'Set up environment, dependencies and pytest baseline.',
        lessons: [
          {
            id: 'py-m1-l1',
            title: 'Project Setup with venv and pytest',
            duration: '30 min',
            level: 'Beginner',
            summary: 'Create isolated environments and run first automation tests.',
            objectives: [
              'Set up virtual environment',
              'Install pytest and core libraries',
              'Run initial smoke test',
            ],
            practice: 'Create a project with pytest and execute one passing test.',
            steps: [
              {
                title: 'Create isolated environment',
                detail: 'Use venv to avoid dependency conflicts.',
                code: "python3 -m venv .venv          # create virtual environment\nsource .venv/bin/activate       # activate it on macOS/Linux",
              },
              {
                title: 'Install test dependencies',
                detail: 'Install pytest and optional API/UI libs.',
                code: "pip install pytest requests pytest-playwright   # install core automation packages\npip freeze > requirements.txt                         # lock current dependencies",
              },
              {
                title: 'Write and run smoke test',
                detail: 'Validate test runner configuration quickly.',
                code: "# tests/test_smoke.py\ndef test_smoke():\n    assert 1 + 1 == 2\n\n# run tests\npytest -q",
              },
            ],
          },
          {
            id: 'py-m1-l2',
            title: 'Pytest Fixtures and Parametrization',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Use fixtures for setup/teardown and parametrization for coverage.',
            objectives: [
              'Create reusable fixtures',
              'Parametrize tests with multiple inputs',
              'Reduce duplication in setup code',
            ],
            practice: 'Parametrize login validations across 4 credential combinations.',
            steps: [
              {
                title: 'Create a fixture',
                detail: 'Centralize shared setup data or clients.',
                code: "import pytest\n\n@pytest.fixture\ndef base_url():\n    return 'https://example.com'",
              },
              {
                title: 'Use parametrized tests',
                detail: 'Test multiple data sets in one concise test.',
                code: "@pytest.mark.parametrize('username,password,expected', [\n    ('qa_admin', 'secret', True),\n    ('qa_admin', 'bad', False),\n])\ndef test_login_matrix(username, password, expected):\n    assert isinstance(expected, bool)",
              },
            ],
          },
        ],
        quiz: {
          question: 'You need to test login with 4 different username/password combinations without duplicating the test code four times. What is the best approach?',
          options: [
            'Write four separate, nearly identical test functions',
            'Use @pytest.mark.parametrize to run the same test logic against a list of input combinations',
            'Manually loop over inputs inside a single test with no assertions per case',
            'Skip testing the extra combinations to save time',
          ],
          correctIndex: 1,
          explanation: '@pytest.mark.parametrize runs the same test body once per data set, giving full coverage without duplicating test code.',
        },
      },
      {
        id: 'py-m2',
        title: 'Python UI Automation Patterns',
        description: 'Build stable browser automation with clear architecture.',
        lessons: [
          {
            id: 'py-m2-l1',
            title: 'Reliable UI Actions and Waits',
            duration: '40 min',
            level: 'Intermediate',
            summary: 'Use explicit waits and robust locators for stable tests.',
            objectives: [
              'Avoid hard sleeps in UI tests',
              'Use visible-state assertions',
              'Implement resilient locator strategy',
            ],
            practice: 'Refactor flaky login test to wait-based pattern.',
            steps: [
              {
                title: 'Use condition-based waits',
                detail: 'Wait for UI readiness before interacting.',
                code: "from playwright.sync_api import expect\n\npage.goto(f'{base_url}/login')\nexpect(page.locator('[data-testid=login-user]')).to_be_visible(timeout=10000)",
              },
              {
                title: 'Perform action + assert outcome',
                detail: 'Keep assertions user-focused.',
                code: "page.fill('[data-testid=login-user]', 'qa_admin')\npage.fill('[data-testid=login-pass]', 'secret')\npage.click('[data-testid=login-submit]')\nexpect(page.get_by_text('Dashboard')).to_be_visible()",
              },
              {
                title: 'Capture screenshot on failure (useful case)',
                detail: 'Collect visual artifacts for debugging.',
                code: "page.screenshot(path='artifacts/login-result.png', full_page=True)",
              },
            ],
          },
          {
            id: 'py-m2-l2',
            title: 'Python Page Object Model',
            duration: '35 min',
            level: 'Advanced',
            summary: 'Organize UI automation using page classes and reusable actions.',
            objectives: [
              'Encapsulate selectors in page classes',
              'Expose behavior-driven methods',
              'Keep tests concise and readable',
            ],
            practice: 'Implement LoginPage and DashboardPage and refactor tests.',
            steps: [
              {
                title: 'Create page class',
                detail: 'Hide selector details from tests.',
                code: "class LoginPage:\n    def __init__(self, page):\n        self.page = page\n\n    def login(self, username, password):\n        self.page.fill('[data-testid=login-user]', username)\n        self.page.fill('[data-testid=login-pass]', password)\n        self.page.click('[data-testid=login-submit]')",
              },
              {
                title: 'Use in tests',
                detail: 'Tests read as business behavior now.',
                code: "def test_admin_login(page, base_url):\n    page.goto(f'{base_url}/login')\n    LoginPage(page).login('qa_admin', 'secret')\n    assert page.get_by_text('Dashboard').is_visible()",
              },
            ],
          },
        ],
        quiz: {
          question: 'Your Playwright Python test interacts with an element immediately after page.goto() and fails randomly. What is the fix?',
          options: [
            'Add a fixed time.sleep(5) after every goto()',
            'Use expect(locator).to_be_visible() (or similar waits) before interacting, instead of assuming the page is instantly ready',
            'Refresh the page repeatedly until it works',
            'Ignore the failures since they are rare',
          ],
          correctIndex: 1,
          explanation: 'Condition-based waits like expect(...).to_be_visible() pause only until the element is actually ready, which is both faster and more reliable than guessing a fixed delay.',
        },
      },
      {
        id: 'py-m3',
        title: 'Python API Testing and CI',
        description: 'Validate APIs and run tests in pipelines with reports.',
        lessons: [
          {
            id: 'py-m3-l1',
            title: 'API Tests with requests + pytest',
            duration: '35 min',
            level: 'Intermediate',
            summary: 'Build API assertions for status, schema-like checks and data validation.',
            objectives: [
              'Send authenticated requests',
              'Assert key fields in JSON payloads',
              'Create reusable API clients',
            ],
            practice: 'Validate /api/runs endpoint with token auth and payload checks.',
            steps: [
              {
                title: 'Create API client helper',
                detail: 'Centralize auth and base URL handling.',
                code: "import requests\n\nclass ApiClient:\n    def __init__(self, base_url, token):\n        self.base_url = base_url\n        self.headers = {'Authorization': f'Bearer {token}'}\n\n    def get_runs(self):\n        return requests.get(f'{self.base_url}/api/runs', headers=self.headers, timeout=20)",
              },
              {
                title: 'Assert response contract',
                detail: 'Validate both status and expected keys.',
                code: "def test_get_runs(api_client):\n    r = api_client.get_runs()\n    assert r.status_code == 200\n    payload = r.json()\n    assert isinstance(payload.get('items'), list)\n    assert 'status' in payload['items'][0]",
              },
            ],
          },
          {
            id: 'py-m3-l2',
            title: 'Run Python Automation in CI',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Create CI workflow that runs pytest and stores artifacts.',
            objectives: [
              'Configure GitHub Actions for pytest',
              'Generate JUnit report output',
              'Upload failure artifacts and logs',
            ],
            practice: 'Create CI workflow running pytest with JUnit XML output.',
            steps: [
              {
                title: 'Add CI workflow file',
                detail: 'Run tests on push and pull requests.',
                code: "name: Python Automation\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - run: pip install -r requirements.txt\n      - run: pytest -q --junitxml=artifacts/pytest-report.xml",
              },
              {
                title: 'Upload artifacts',
                detail: 'Keep reports and screenshots for diagnostics.',
                code: "- uses: actions/upload-artifact@v4\n  if: always()\n  with:\n    name: python-test-artifacts\n    path: artifacts/",
              },
            ],
          },
          {
            id: 'py-m3-l3',
            title: 'Debugging Python Test Failures',
            duration: '30 min',
            level: 'Advanced',
            summary: 'Use pytest\'s built-in debugging tools, fixtures inspection and tracebacks to resolve failures fast.',
            objectives: [
              'Read pytest tracebacks to find the real assertion',
              'Use pytest --pdb to drop into a debugger on failure',
              'Use -k and -v to isolate and inspect a single test',
              'Diagnose fixture scope and teardown issues',
            ],
            practice: 'Force a failing assertion, run with --pdb, and inspect live variables at the point of failure.',
            steps: [
              {
                title: 'Read pytest\'s assertion rewriting output',
                detail:
                  'pytest rewrites plain assert statements to show the actual values on both sides of the comparison automatically — no need for custom messages in most cases. Read this output carefully before changing any code.',
                code: '# Example pytest failure output:\n# assert isinstance(payload.get(\'items\'), list)\n# AssertionError: assert False\n#  +  where False = isinstance(None, list)\n#  +    where None = <built-in method get of dict>(\'items\')\n# -> payload["items"] was actually None, not missing entirely',
              },
              {
                title: 'Drop into a debugger exactly where it failed',
                detail:
                  '--pdb opens an interactive Python debugger at the point of failure, letting you inspect every local variable in that exact scope — much richer than adding print statements and re-running.',
                code: '# Drop into pdb on the first failure and stop\npytest -x --pdb tests/test_runs.py\n\n# Inside pdb:\n# p payload        <- print the payload variable\n# p r.status_code  <- print the response status\n# c                <- continue execution',
              },
              {
                title: 'Isolate a single failing test (useful case)',
                detail:
                  'Re-running the whole suite while debugging wastes time. Use -k to match a test by name and -v for verbose output, so you iterate quickly on just the failing case.',
                code: "# Run only tests whose name contains 'get_runs', with verbose output\npytest -k get_runs -v",
              },
              {
                title: 'Add targeted print/logging output',
                detail:
                  'Use -s to allow print() output to reach the terminal (pytest captures stdout by default), which is a quick way to inspect a value without a full debugger session.',
                code: "def test_get_runs(api_client):\n    r = api_client.get_runs()\n    print('status:', r.status_code)     # only visible with -s\n    print('body:', r.text[:300])\n    assert r.status_code == 200",
              },
              {
                title: 'Diagnose fixture scope/teardown problems (useful case)',
                detail:
                  'If a test passes alone but fails in the full suite, suspect a fixture with too broad a scope (session/module) leaking state between tests. Prefer function-scoped fixtures unless you have a specific, deliberate reason for sharing state, and always verify teardown actually runs.',
                code: "import pytest\n\n# BAD: session-scoped mutable fixture can leak state across tests\n@pytest.fixture(scope='session')\ndef shared_client():\n    return ApiClient(base_url, token)\n\n# GOOD: function-scoped fixture gives every test a clean instance\n@pytest.fixture\ndef api_client():\n    client = ApiClient(base_url, token)\n    yield client\n    client.close()   # guaranteed teardown after each test",
              },
              {
                title: 'Build a debugging checklist',
                detail:
                  'When a pytest test fails: (1) read the assertion rewriting output fully — it usually shows the exact wrong value, (2) run just that test with -k and -v, (3) drop into --pdb for anything non-obvious, (4) check fixture scope if the failure only happens in the full suite, (5) only then suspect the API/application itself.',
              },
            ],
          },
        ],
        quiz: {
          question: 'A test passes in isolation (pytest -k test_name) but fails when the whole suite runs. What should you check first?',
          options: [
            'Assume pytest is broken and switch test runners',
            'Check whether a broadly-scoped fixture (e.g. session or module scope) is leaking shared/mutable state between tests instead of being properly isolated per test',
            'Delete the test since it is clearly flaky',
            'Add a fixed time.sleep() between all tests',
          ],
          correctIndex: 1,
          explanation: 'Tests that only fail in combination with others are a classic sign of shared state from an overly broad fixture scope; switching to function-scoped fixtures (or fixing teardown) resolves the isolation problem.',
        },
      },
    ],
    resources: [
      { label: 'Pytest Docs', url: 'https://docs.pytest.org/' },
      { label: 'Playwright Python Docs', url: 'https://playwright.dev/python/docs/intro' },
      { label: 'Python requests Docs', url: 'https://requests.readthedocs.io/' },
    ],
  },
]

function firstCodeLine(code?: string): string {
  if (!code) return 'No code snippet available'
  const line =
    code
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('#')) || code.split('\n')[0]
  return line.length > 90 ? `${line.slice(0, 87)}...` : line
}

function buildModuleQuestionPack(program: Program, module: Module): QuizQuestion[] {
  const stepWithCode = module.lessons.flatMap(l => l.steps).find(s => !!s.code)
  const snippetLine = firstCodeLine(stepWithCode?.code)

  const baseQuestions: Omit<QuizQuestion, 'type'>[] = [
    {
      question: `What is the core learning focus of "${module.title}"?`,
      options: [
        module.description,
        `Only release management, without automation testing practice`,
        `Only visual design topics, no test engineering`,
        `Unrelated data science workflows in ${program.name}`,
      ],
      correctIndex: 0,
      explanation: 'The module description summarizes the target skills and should guide implementation choices.',
    },
    {
      question: `In ${program.name}, which behavior best reflects strong learning in this module?`,
      options: [
        'Use assertions and clear pass/fail criteria for each critical behavior',
        'Rely only on manual observation and avoid assertions',
        'Use random sleeps as the default synchronization strategy',
        'Skip error handling for faster scripts',
      ],
      correctIndex: 0,
      explanation: 'Learning quality is demonstrated through deterministic validations, not guesswork.',
    },
    {
      question: `Which practice improves long-term maintainability for ${module.title}?`,
      options: [
        'Use reusable helpers/page objects/clients to reduce duplication',
        'Copy/paste full flow in every test file',
        'Avoid abstractions and keep hardcoded values everywhere',
        'Keep all logic in one giant test',
      ],
      correctIndex: 0,
      explanation: 'Abstraction and reuse make suites easier to evolve without breaking many tests at once.',
    },
    {
      question: `When a test fails in ${module.title}, what gives the fastest debugging path?`,
      options: [
        'Structured logs/artifacts with precise assertions',
        'Only rerun the same test repeatedly without diagnostics',
        'Delete failed tests to keep pipeline green',
        'Ignore intermittent failures completely',
      ],
      correctIndex: 0,
      explanation: 'Good diagnostics and explicit assertions are essential for reliable root-cause analysis.',
    },
    {
      question: 'Coding task: pick the realistic command/snippet for this module context.',
      options: [
        snippetLine,
        'Thread.sleep(10000) // default solution for sync',
        'console.log("it probably works")',
        'TODO: skip validation for now',
      ],
      correctIndex: 0,
      explanation: 'The correct answer mirrors a concrete implementation style taught in this module.',
    },
    {
      question: module.quiz.question,
      options: module.quiz.options,
      correctIndex: module.quiz.correctIndex,
      explanation: module.quiz.explanation,
    },
    {
      question: `Which testing mindset is most aligned with ${module.title}?`,
      options: [
        'Validate behavior and expected outcomes, not just execution',
        'Focus only on execution speed and skip validations',
        'Keep assertions optional in critical flows',
        'Treat flaky tests as acceptable by design',
      ],
      correctIndex: 0,
      explanation: 'Strong automation is behavior-oriented and evidence-driven.',
    },
    {
      question: `In ${module.title}, when should data-driven testing be preferred?`,
      options: [
        'When the same workflow must be validated against multiple input sets',
        'Only when there is exactly one static input forever',
        'Never, because it always increases flakiness',
        'Only for production user accounts',
      ],
      correctIndex: 0,
      explanation: 'Data-driven design expands coverage while keeping test logic maintainable.',
    },
    {
      question: `What is the best next action after implementing a new test in ${module.title}?`,
      options: [
        'Run it with deterministic checks and review reports/logs',
        'Mark it complete without execution',
        'Remove assertions to avoid brittle failures',
        'Skip CI validation for this test',
      ],
      correctIndex: 0,
      explanation: 'Execution with evidence verifies both correctness and stability.',
    },
    {
      question: `What indicates a mature learning outcome for ${module.title}?`,
      options: [
        'Reliable tests, maintainable structure, and actionable failure output',
        'Large number of tests with inconsistent outcomes',
        'Tests that pass only on one machine',
        'Minimal assertions and no reports',
      ],
      correctIndex: 0,
      explanation: 'Maturity means consistency, maintainability, and fast diagnosis on failures.',
    },
  ]

  const practicalIndexes = new Set([4, 5, 7, 8, 9])
  return baseQuestions.map((q, index) => ({
    ...q,
    type: practicalIndexes.has(index) ? 'practical' : 'theoretical',
  }))
}

interface ModuleQuizProfile {
  focus: string
  primaryTool: string
  secondaryTool: string
  wrongPractice: string
  codingTask: string
  codingCorrect: string
  codingWrong: string
}

const MODULE_QUIZ_PROFILES: Record<string, ModuleQuizProfile> = {
  'bruno-m1': {
    focus: 'installing Bruno and creating the first Git-tracked collection',
    primaryTool: 'Bruno desktop app',
    secondaryTool: 'Bruno CLI',
    wrongPractice: 'keeping requests only in cloud storage without versioning',
    codingTask: 'Choose the command used to install the Bruno GUI on macOS.',
    codingCorrect: 'brew install --cask bruno',
    codingWrong: 'brew install bruno-cli-only',
  },
  'bruno-m2': {
    focus: 'organizing collections/folders and managing them through Git workflows',
    primaryTool: 'resource-based request folders',
    secondaryTool: 'git diff / pull requests',
    wrongPractice: 'storing unrelated endpoints in one flat folder',
    codingTask: 'Pick the Git command used in this module to review request file changes.',
    codingCorrect: 'git diff',
    codingWrong: 'git clean -fd',
  },
  'bruno-m3': {
    focus: 'environments, variable scopes, and secret-safe configuration',
    primaryTool: 'environment variables',
    secondaryTool: 'secret values excluded from Git',
    wrongPractice: 'hardcoding API tokens in committed request files',
    codingTask: 'Choose the variable pattern emphasized in this module for base URL reuse.',
    codingCorrect: '{{baseUrl}}',
    codingWrong: 'http://hardcoded-dev-host.local',
  },
  'bruno-m4': {
    focus: 'assertions, test scripts, and request chaining with tokens',
    primaryTool: 'Assert tab and scripted checks',
    secondaryTool: 'pre/post request scripting',
    wrongPractice: 'treating successful status code as the only validation',
    codingTask: 'Select the expression style used to validate response data in script assertions.',
    codingCorrect: 'expect(res.body.user.id).toBeDefined()',
    codingWrong: 'print(res.body) // no assertion',
  },
  'bruno-m5': {
    focus: 'running Bruno suites in CLI and integrating them in CI/CD',
    primaryTool: 'bru run',
    secondaryTool: 'report artifacts in pipeline jobs',
    wrongPractice: 'ignoring exit codes in CI pipelines',
    codingTask: 'Choose the command pattern used to run Bruno collection headlessly.',
    codingCorrect: 'bru run collection/',
    codingWrong: 'open collection in GUI manually',
  },
  'appium-m1': {
    focus: 'Appium architecture and local environment setup',
    primaryTool: 'Appium server + platform driver',
    secondaryTool: 'adb/emulator verification',
    wrongPractice: 'starting sessions before validating device connectivity',
    codingTask: 'Pick the command used to validate connected Android devices.',
    codingCorrect: 'adb devices',
    codingWrong: 'adb reset-all',
  },
  'appium-m2': {
    focus: 'session creation and desired capabilities plus Appium Inspector usage',
    primaryTool: 'capabilities payload',
    secondaryTool: 'Appium Inspector locator exploration',
    wrongPractice: 'launching sessions with missing platform/app capability fields',
    codingTask: 'Choose the capability key style shown in this module examples.',
    codingCorrect: 'appium:automationName',
    codingWrong: 'webdriver:runRandomMode',
  },
  'appium-m3': {
    focus: 'stable locator strategy and explicit waits for interactions',
    primaryTool: 'accessibility id and native selectors',
    secondaryTool: 'WebDriverWait/ExpectedConditions',
    wrongPractice: 'using brittle XPath with fixed sleep everywhere',
    codingTask: 'Choose the waiting strategy promoted by this module.',
    codingCorrect: 'wait.until(ExpectedConditions.visibilityOf(element))',
    codingWrong: 'Thread.sleep(8000)',
  },
  'appium-m4': {
    focus: 'robust test scripts with setup/teardown and Page Object Model',
    primaryTool: 'end-to-end login test structure',
    secondaryTool: 'Page Objects for maintainability',
    wrongPractice: 'duplicating selectors in every test method',
    codingTask: 'Pick the statement matching this module POM direction.',
    codingCorrect: 'new LoginPage(driver).login(username, password)',
    codingWrong: 'copy all locators directly in each test',
  },
  'appium-m5': {
    focus: 'advanced gestures and context switching (native/webview)',
    primaryTool: 'W3C actions/mobile commands',
    secondaryTool: 'driver.getContextHandles()',
    wrongPractice: 'interacting with webview DOM before context switch',
    codingTask: 'Select the API used in this module to list contexts.',
    codingCorrect: 'driver.getContextHandles()',
    codingWrong: 'driver.getWindowHandlesOnly()',
  },
  'appium-m6': {
    focus: 'scaling mobile tests with parallel execution and CI pipelines',
    primaryTool: 'device matrix / parallel runs',
    secondaryTool: 'CI artifact publishing for reports/screenshots',
    wrongPractice: 'running only one device forever and assuming universal stability',
    codingTask: 'Choose the CI behavior required by this module.',
    codingCorrect: 'publish reports and screenshots for each run',
    codingWrong: 'discard artifacts to keep logs minimal',
  },
  'js-m1': {
    focus: 'JavaScript foundations for test data and reusable helpers',
    primaryTool: 'objects/arrays for test payloads',
    secondaryTool: 'utility functions to reduce duplication',
    wrongPractice: 'hardcoding duplicated test values in every test file',
    codingTask: 'Pick the JavaScript pattern promoted for reusable test setup.',
    codingCorrect: 'function buildUser(overrides = {}) { return { ...defaults, ...overrides } }',
    codingWrong: 'const user = { ... } // copy-pasted in every test',
  },
  'js-m2': {
    focus: 'async/await correctness and waiting strategies that reduce flakes',
    primaryTool: 'await on async operations',
    secondaryTool: 'condition-based waits with clear timeouts',
    wrongPractice: 'mixing unresolved promises with immediate assertions',
    codingTask: 'Choose the fix aligned with this module async guidance.',
    codingCorrect: 'const data = await fetchData()',
    codingWrong: 'const data = fetchData(); expect(data.ok).toBe(true)',
  },
  'js-m3': {
    focus: 'Playwright JS automation including UI + API combined validation',
    primaryTool: 'Playwright test runner and expect API',
    secondaryTool: 'response interception/assertion in same flow',
    wrongPractice: 'validating only UI text without checking backend payload',
    codingTask: 'Pick the Playwright assertion style used in this module.',
    codingCorrect: 'await expect(page.getByRole(\'heading\')).toBeVisible()',
    codingWrong: 'console.log(page.content()) // no assertion',
  },
  'java-m1': {
    focus: 'setting up Java automation project with Maven and package structure',
    primaryTool: 'Maven project/dependency management',
    secondaryTool: 'layered test package architecture',
    wrongPractice: 'placing all tests/helpers/pages in one class',
    codingTask: 'Choose the Maven command used to execute tests from CLI.',
    codingCorrect: 'mvn test',
    codingWrong: 'mvn deploy-prod-now',
  },
  'java-m2': {
    focus: 'Selenium WebDriver essentials with robust locator and wait usage',
    primaryTool: 'By locators',
    secondaryTool: 'WebDriverWait and ExpectedConditions',
    wrongPractice: 'relying on implicit-only waits and brittle selectors',
    codingTask: 'Select the locator style emphasized for stability in this module.',
    codingCorrect: 'By.cssSelector("[data-testid=login-button]")',
    codingWrong: 'By.xpath("/html/body/div[2]/div[1]/button")',
  },
  'java-m3': {
    focus: 'integrating Java UI/API tests and executing them in CI pipelines',
    primaryTool: 'REST-assured + UI assertions',
    secondaryTool: 'JUnit reports in CI artifacts',
    wrongPractice: 'running UI and API validations in disconnected workflows',
    codingTask: 'Pick the report format command usage reinforced in this module.',
    codingCorrect: 'mvn test -Dsurefire.reportFormat=xml',
    codingWrong: 'mvn test --skip-report',
  },
  'py-m1': {
    focus: 'Python automation setup with virtual environments and pytest basics',
    primaryTool: 'venv + pip requirements',
    secondaryTool: 'pytest test discovery',
    wrongPractice: 'installing random global packages outside project environment',
    codingTask: 'Choose the command that activates the virtual environment on Unix-like systems.',
    codingCorrect: 'source .venv/bin/activate',
    codingWrong: 'activate .venv --global',
  },
  'py-m2': {
    focus: 'API automation in Python using requests with validation patterns',
    primaryTool: 'requests session and status/body assertions',
    secondaryTool: 'parameterized test data',
    wrongPractice: 'checking only HTTP 200 without validating payload schema',
    codingTask: 'Pick the assertion style aligned with this module.',
    codingCorrect: "assert response.json()['status'] == 'active'",
    codingWrong: 'print(response.text)  # no assert',
  },
  'py-m3': {
    focus: 'Python UI testing with Playwright and CI execution',
    primaryTool: 'Playwright sync/async Python API',
    secondaryTool: 'pytest JUnit artifacts in CI',
    wrongPractice: 'executing tests in CI without preserving failure reports',
    codingTask: 'Choose the pytest option used for machine-readable CI reports.',
    codingCorrect: '--junitxml=artifacts/pytest-report.xml',
    codingWrong: '--silent-no-report',
  },
}

function buildProfiledModuleQuestionPack(program: Program, module: Module, profile: ModuleQuizProfile): QuizQuestion[] {
  const stepWithCode = module.lessons.flatMap(l => l.steps).find(s => !!s.code)
  const codePreview = firstCodeLine(stepWithCode?.code)

  const baseQuestions: Omit<QuizQuestion, 'type'>[] = [
    {
      question: `Module check (${module.title}): which focus is correct?`,
      options: [
        profile.focus,
        `Only unrelated architecture theory with no practical tests`,
        `Mostly data science workflows outside ${program.name}`,
        `No clear focus in this module`,
      ],
      correctIndex: 0,
      explanation: 'The focus option is defined specifically for this module profile.',
    },
    {
      question: `In ${module.title}, which primary approach/tool is emphasized?`,
      options: [
        profile.primaryTool,
        profile.wrongPractice,
        'Skipping verification and relying on visual confirmation only',
        'Manually repeating every step without reusable logic',
      ],
      correctIndex: 0,
      explanation: 'The primary tool/approach is tied to this module objective.',
    },
    {
      question: `Which secondary capability is part of ${module.title}?`,
      options: [
        profile.secondaryTool,
        'No secondary capability is discussed',
        'Disabling all reports by default',
        'Using random test data without traceability',
      ],
      correctIndex: 0,
      explanation: 'This module includes both core and secondary practical skills.',
    },
    {
      question: `Which approach best applies ${module.title} knowledge in real projects?`,
      options: [
        `Use ${profile.primaryTool} together with ${profile.secondaryTool} to validate behavior end-to-end`,
        `Focus only on happy paths and skip negative checks`,
        `Keep ${profile.wrongPractice} as default approach`,
        `Disable evidence collection to reduce feedback noise`,
      ],
      correctIndex: 0,
      explanation: 'This combines the core and supporting practices the module is designed to teach.',
    },
    {
      question: `Which statement reflects good test quality for ${module.title}?`,
      options: [
        'Assertions are specific, deterministic, and tied to expected behavior',
        'Assertions are optional as long as scripts execute',
        profile.wrongPractice,
        'Intermittent failures should be ignored if retries pass',
      ],
      correctIndex: 0,
      explanation: 'High-quality tests must verify outcomes explicitly and consistently.',
    },
    {
      question: profile.codingTask,
      options: [
        profile.codingCorrect,
        profile.codingWrong,
        // The module's first code line can be the right answer itself: never offer the same option twice.
        [profile.codingCorrect, profile.codingWrong].includes(codePreview) ? 'npm run test -- --skip-all' : codePreview,
        'echo "placeholder"',
      ],
      correctIndex: 0,
      explanation: 'The correct option matches the command/pattern taught by this module.',
    },
    {
      question: `In ${module.title}, which anti-pattern should be avoided?`,
      options: [
        profile.wrongPractice,
        `Pair ${profile.primaryTool} with ${profile.secondaryTool}`,
        'Capture artifacts and logs on failures',
        'Use clear assertions for critical flows',
      ],
      correctIndex: 0,
      explanation: 'This option is intentionally the bad practice to identify and avoid.',
    },
    {
      question: module.quiz.question,
      options: module.quiz.options,
      correctIndex: module.quiz.correctIndex,
      explanation: module.quiz.explanation,
    },
    {
      question: `Which reliability strategy is most suitable for ${module.title}?`,
      options: [
        'Prefer condition-based synchronization and stable locators/contracts',
        'Add fixed sleeps in all test steps',
        'Remove timeouts to force immediate failures everywhere',
        'Validate only visual layout and ignore data/API state',
      ],
      correctIndex: 0,
      explanation: 'Reliable suites synchronize with real system state and verify stable signals.',
    },
    {
      question: `What should you do when a ${module.title} test fails in CI?`,
      options: [
        'Inspect reports/logs/artifacts and isolate root cause before patching',
        'Rerun until it passes and merge immediately',
        'Delete the failing assertion permanently',
        'Disable the test without analysis',
      ],
      correctIndex: 0,
      explanation: 'Diagnosis-first handling prevents hidden regressions and improves long-term stability.',
    },
  ]

  const practicalIndexes = new Set([5, 6, 7, 8, 9])
  return baseQuestions.map((q, index) => ({
    ...q,
    type: practicalIndexes.has(index) ? 'practical' : 'theoretical',
  }))
}

export const MODULE_QUIZZES: Record<string, QuizQuestion[]> = Object.fromEntries(
  PROGRAMS.flatMap(program =>
    program.modules.map(module => {
      const profile = MODULE_QUIZ_PROFILES[module.id]
      const questions = profile
        ? buildProfiledModuleQuestionPack(program, module, profile)
        : buildModuleQuestionPack(program, module)
      return [module.id, questions] as const
    }),
  ),
)
