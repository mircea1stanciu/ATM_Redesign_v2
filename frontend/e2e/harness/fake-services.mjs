// Stand-ins for GitHub, Jira and Confluence so UI tests never call real services.
//
//   /<owner>/<repo>.git/...     git over HTTP for the bare repositories in E2E_FAKE_ROOT (git http-backend)
//   /api/v3/...                 GitHub REST: user, repository, branches (read from the bare repository), pull requests
//                               (list, detail, files from git diff, comments, reviews, check runs)
//   /jira/rest/api/{2,3}/...    Jira: myself, projects, issue search and detail, comments, links, transitions
//   /confluence/rest/api/...    Confluence: current user, spaces, page search and detail; report pages (create,
//                               update, attachments)
//   /models/...                 GitHub Models (the "GitHub Copilot" AI provider): catalog and chat completions
//   /teams/hook                 a Microsoft Teams workflow webhook (deployment cards)
//   /__e2e/requests             what ATM sent (tests inspect it); /__e2e/health for the harness
//   POST /__e2e/pull-request    a pull request opened on GitHub outside ATM: a commit on a new branch of the bare repo
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'

const port = Number(process.env.E2E_FAKE_PORT)
const root = process.env.E2E_FAKE_ROOT
if (!port || !root) {
  console.error('E2E_FAKE_PORT and E2E_FAKE_ROOT are set by playwright.config.ts')
  process.exit(1)
}

const requests = []
const pullRequests = []
// Reviews ATM submitted to GitHub (event, body, line comments with path, line and side).
const reviewWrites = []
// Comments, remote links and transitions ATM wrote to Jira, with their bodies.
const jiraWrites = []
// Report pages ATM created or updated in Confluence, and the attachments it uploaded.
const confluenceWrites = []
// Cards posted to the Teams workflow webhook (/teams/hook).
const teamsPosts = []
const reportPages = {}

// The E2E Jira project: two stories and a bug (the inbox lists stories by default).
const issues = {
  'E2E-1': {
    summary: 'Login shows an error for a wrong password', type: 'Story', status: 'To Do',
    description: 'As a shopper I see a clear message when my password is wrong.',
    acceptance: 'Given a wrong password, the message "Wrong email or password" is shown.',
    comments: [{ author: 'Product Owner', body: 'Copy agreed with UX.' }],
  },
  'E2E-2': {
    summary: 'Checkout API returns the order id', type: 'Technical Story', status: 'In Progress',
    description: 'POST /orders answers 201 with the new order id.', acceptance: '', comments: [],
  },
  'E2E-3': { summary: 'Typo in the footer', type: 'Bug', status: 'To Do', description: '', acceptance: '', comments: [] },
}
const pages = {
  101: { title: 'Checkout requirements', body: '<h2>Checkout</h2><p>Customers pay by card or voucher.</p>' },
  102: { title: 'Login requirements', body: '<p>Accounts lock after five wrong passwords.</p>' },
}

function issueJson(key, full) {
  const issue = issues[key]
  const fields = {
    summary: issue.summary,
    status: { name: issue.status },
    issuetype: { name: issue.type },
    assignee: null,
    labels: [],
    updated: '2026-10-20T10:00:00.000+0000',
  }
  if (!full) return { key, fields }
  const comments = issue.comments.map((c, i) => ({ id: String(i), author: { displayName: c.author }, created: '2026-10-20T10:00:00.000+0000', body: c.body }))
  return {
    key,
    names: { customfield_10100: 'Acceptance Criteria' },
    fields: {
      ...fields,
      reporter: { displayName: 'Product Owner' },
      description: issue.description,
      customfield_10100: issue.acceptance,
      issuelinks: key === 'E2E-1'
        ? [{ type: { outward: 'relates to' }, outwardIssue: { key: 'E2E-2', fields: { summary: issues['E2E-2'].summary, status: { name: issues['E2E-2'].status } } } }]
        : [],
      attachment: key === 'E2E-1' ? [{ filename: 'login-error.png', size: 2048, mimeType: 'image/png' }] : [],
      comment: { comments },
    },
    renderedFields: {
      description: issue.description ? `<p>${issue.description}</p>` : '',
      customfield_10100: issue.acceptance ? `<p>${issue.acceptance}</p>` : '',
      comment: { comments: comments.map(c => ({ body: `<p>${c.body}</p>` })) },
    },
  }
}

// Enough JQL for the inbox: issuetype in (...) / = , status =, text ~, key =.
function matchesJql(key, jql) {
  const issue = issues[key]
  const types = jql.match(/issuetype in \(([^)]*)\)/)
  if (types && !types[1].split(',').map(t => t.trim().replace(/^"|"$/g, '')).includes(issue.type)) return false
  const type = jql.match(/issuetype = "([^"]*)"/)
  if (type && type[1] !== issue.type) return false
  const status = jql.match(/status = "([^"]*)"/)
  if (status && status[1] !== issue.status) return false
  const text = jql.match(/text ~ "([^"]*)"/)
  if (text && !issue.summary.toLowerCase().includes(text[1].toLowerCase())) return false
  const exact = jql.match(/key = "([^"]*)"/)
  if (exact && exact[1] !== key) return false
  return true
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

// Smart HTTP through git's own CGI program, so clone, fetch and push behave like a real server.
function gitHttpBackend(req, res, url) {
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.pathname),
      REQUEST_METHOD: req.method,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] || '',
      HTTP_CONTENT_ENCODING: req.headers['content-encoding'] || '',
      REMOTE_ADDR: req.socket.remoteAddress || '',
    },
  })
  req.pipe(child.stdin)
  let headerBuffer = Buffer.alloc(0)
  let headersSent = false
  child.stdout.on('data', chunk => {
    if (headersSent) {
      res.write(chunk)
      return
    }
    headerBuffer = Buffer.concat([headerBuffer, chunk])
    const end = headerBuffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const headers = {}
    let status = 200
    for (const line of headerBuffer.subarray(0, end).toString().split('\r\n')) {
      const [name, ...rest] = line.split(':')
      const value = rest.join(':').trim()
      if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0])
      else headers[name] = value
    }
    res.writeHead(status, headers)
    headersSent = true
    res.write(headerBuffer.subarray(end + 4))
  })
  child.stdout.on('end', () => res.end())
  child.stderr.on('data', data => process.stderr.write(data))
}

// The GitHub user of a token: the seeded tokens are e2e-github-token (a shared bot) and e2e-github-token-senior.
function loginOf(req) {
  const token = (req.headers.authorization || '').split(' ').pop()
  return token === 'e2e-github-token-senior' ? 'e2e-senior' : 'e2e-bot'
}

function bareGit(owner, repo, args, input, env = {}) {
  return execFileSync('git', args, {
    cwd: join(root, owner, `${repo}.git`), input,
    env: { ...process.env, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@e2e.test', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@e2e.test', ...env },
  }).toString()
}

// A commit on a new branch, written straight into the bare repository (no working tree).
function commitToBranch(owner, repo, branch, path, content, message) {
  const blob = bareGit(owner, repo, ['hash-object', '-w', '--stdin'], content).trim()
  const index = { GIT_INDEX_FILE: join(root, `index-${branch.replace(/\W/g, '_')}-${Date.now()}`) }
  bareGit(owner, repo, ['read-tree', 'main'], undefined, index)
  bareGit(owner, repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], undefined, index)
  const tree = bareGit(owner, repo, ['write-tree'], undefined, index).trim()
  const commit = bareGit(owner, repo, ['commit-tree', tree, '-p', 'main', '-m', message]).trim()
  bareGit(owner, repo, ['update-ref', `refs/heads/${branch}`, commit])
  return commit
}

// The files of a pull request as GitHub lists them: status, counts and the patch (hunks only).
function filesOf(owner, repo, base, head) {
  const diff = bareGit(owner, repo, ['diff', '-U3', `${base}...${head}`])
  return diff.split(/^diff --git /m).filter(Boolean).map(chunk => {
    const lines = chunk.split('\n')
    const filename = lines[0].split(' b/').pop()
    const start = lines.findIndex(line => line.startsWith('@@'))
    const patch = start < 0 ? '' : lines.slice(start).join('\n').replace(/\n$/, '')
    const body = start < 0 ? [] : lines.slice(start)
    return {
      filename,
      status: chunk.includes('\nnew file mode') ? 'added' : chunk.includes('\ndeleted file mode') ? 'removed' : 'modified',
      additions: body.filter(l => l.startsWith('+')).length,
      deletions: body.filter(l => l.startsWith('-')).length,
      patch,
    }
  })
}

function pullJson(owner, repo, pr) {
  return {
    number: pr.number, title: pr.title, body: pr.body || '', state: 'open', draft: Boolean(pr.draft), merged: false,
    html_url: `http://127.0.0.1:${port}/${owner}/${repo}/pull/${pr.number}`,
    user: { login: pr.author }, head: { ref: pr.head, sha: pr.sha }, base: { ref: pr.base },
    requested_reviewers: (pr.requested || []).map(login => ({ login })),
    created_at: pr.created_at, updated_at: pr.updated_at,
  }
}

function branchesOf(owner, repo) {
  const out = execFileSync('git', ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'], {
    cwd: join(root, owner, `${repo}.git`),
  }).toString()
  return out.trim().split('\n').filter(Boolean).map(line => {
    const [name, sha] = line.split(' ')
    return { name, commit: { sha }, protected: false }
  })
}

async function github(req, res, url) {
  if (url.pathname === '/api/v3/user') return json(res, 200, { login: loginOf(req) })
  const match = url.pathname.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (!match) return json(res, 404, { message: 'Not Found' })
  const [, owner, repo, rest = ''] = match
  if (req.method === 'GET' && rest === '') {
    return json(res, 200, { name: repo, full_name: `${owner}/${repo}`, default_branch: 'main', private: true })
  }
  if (req.method === 'GET' && rest === '/branches') return json(res, 200, branchesOf(owner, repo))
  if (req.method === 'POST' && rest === '/pulls') {
    const body = JSON.parse(await readBody(req))
    const number = pullRequests.length + 1
    const now = new Date().toISOString()
    let sha = ''
    try { sha = bareGit(owner, repo, ['rev-parse', body.head]).trim() } catch { /* branch not pushed */ }
    pullRequests.push({ number, ...body, authorization: req.headers.authorization || '', author: loginOf(req), sha,
      requested: [], reviews: [], comments: [], issueComments: [], created_at: now, updated_at: now })
    return json(res, 201, {
      number, state: 'open', title: body.title, html_url: `http://127.0.0.1:${port}/${owner}/${repo}/pull/${number}`,
    })
  }
  if (req.method === 'GET' && rest === '/pulls') {
    if (Number(url.searchParams.get('page') || 1) > 1) return json(res, 200, [])
    return json(res, 200, pullRequests.filter(pr => pr.sha).map(pr => pullJson(owner, repo, pr)).reverse())
  }
  const pull = rest.match(/^\/(pulls|issues)\/(\d+)(\/[a-z]+)?$/)
  const pr = pull && pullRequests.find(p => p.number === Number(pull[2]))
  if (pull && !pr) return json(res, 404, { message: 'Not Found' })
  if (pr) {
    const [, kind, , action = ''] = pull
    const page = Number(url.searchParams.get('page') || 1)
    const list = items => json(res, 200, page > 1 ? [] : items)
    if (req.method === 'GET' && kind === 'pulls' && action === '') return json(res, 200, pullJson(owner, repo, pr))
    if (req.method === 'GET' && kind === 'pulls' && action === '/files') return list(filesOf(owner, repo, pr.base, pr.sha))
    if (req.method === 'GET' && kind === 'pulls' && action === '/comments') return list(pr.comments)
    if (req.method === 'GET' && kind === 'pulls' && action === '/reviews') return list(pr.reviews)
    if (req.method === 'GET' && kind === 'issues' && action === '/comments') return list(pr.issueComments)
    const body = JSON.parse((await readBody(req)) || '{}')
    const user = { login: loginOf(req) }
    const now = new Date().toISOString()
    if (req.method === 'POST' && kind === 'pulls' && action === '/reviews') {
      const id = 1000 + reviewWrites.length
      const state = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }[body.event]
      reviewWrites.push({ number: pr.number, login: user.login, ...body })
      pr.reviews.push({ id, state, body: body.body || '', user, submitted_at: now })
      for (const c of body.comments || []) {
        pr.comments.push({ id: id * 100 + pr.comments.length, path: c.path, line: c.line, side: c.side, position: 1, body: c.body, user, created_at: now })
      }
      pr.requested = pr.requested.filter(login => login !== user.login)
      return json(res, 200, { id, state })
    }
    if (req.method === 'POST' && kind === 'issues' && action === '/comments') {
      const comment = { id: 5000 + pr.issueComments.length, body: body.body, user, created_at: now }
      pr.issueComments.push(comment)
      return json(res, 201, comment)
    }
  }
  const checks = rest.match(/^\/commits\/([0-9a-f]+)\/check-runs$/)
  if (req.method === 'GET' && checks) {
    return json(res, 200, { check_runs: [{ name: 'unit tests', status: 'completed', conclusion: 'success', html_url: null }] })
  }
  return json(res, 404, { message: 'Not Found' })
}

async function jira(req, res, url) {
  const path = url.pathname.replace(/^\/jira\/rest\/api\/[23]/, '')
  if (path === '/myself') return json(res, 200, { displayName: 'E2E Jira User', name: 'e2e' })
  if (path === '/project/search') return json(res, 200, { values: [{ id: '10000', key: 'E2E', name: 'E2E Jira Project' }] })
  if (path === '/project/E2E') {
    return json(res, 200, { key: 'E2E', issueTypes: [{ name: 'Story' }, { name: 'Technical Story' }, { name: 'Bug' }, { name: 'Sub-task', subtask: true }] })
  }
  if (path === '/project/E2E/statuses') return json(res, 200, [{ statuses: [{ name: 'To Do' }, { name: 'In Progress' }, { name: 'Done' }] }])
  if (path === '/search') {
    const jql = url.searchParams.get('jql') || ''
    const found = Object.keys(issues).filter(key => matchesJql(key, jql))
    return json(res, 200, { issues: found.map(key => issueJson(key, false)), total: found.length })
  }
  const match = path.match(/^\/issue\/([A-Z0-9]+-\d+)(\/[a-z]+)?$/)
  if (match && issues[match[1]]) {
    const [, key, action = ''] = match
    if (req.method === 'GET' && action === '') return json(res, 200, issueJson(key, true))
    if (req.method === 'GET' && action === '/transitions') {
      return json(res, 200, { transitions: [{ id: '21', name: 'Start progress', to: { name: 'In Progress' } }, { id: '31', name: 'Done', to: { name: 'Done' } }] })
    }
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      jiraWrites.push({ key, action: action.slice(1), body })
      if (action === '/comment') issues[key].comments.push({ author: 'E2E Jira User', body: body.body })
      if (action === '/transitions') issues[key].status = body.transition?.id === '31' ? 'Done' : 'In Progress'
      return json(res, action === '/transitions' ? 204 : 201, {})
    }
  }
  return json(res, 404, { errorMessages: ['Not Found'] })
}

async function confluence(req, res, url) {
  const path = url.pathname.replace(/^\/confluence(\/wiki)?\/rest\/api/, '')
  if (path === '/content' && req.method === 'GET') {
    const title = url.searchParams.get('title')
    return json(res, 200, { results: Object.values(reportPages).filter(p => p.title === title) })
  }
  if (path === '/content' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const id = String(9000 + Object.keys(reportPages).length)
    reportPages[id] = { id, title: body.title, version: { number: 1 }, _links: { webui: `/pages/${id}` } }
    confluenceWrites.push({ action: 'create', id, title: body.title, space: body.space, ancestors: body.ancestors, body: body.body.storage.value })
    return json(res, 200, reportPages[id])
  }
  const update = path.match(/^\/content\/(\d+)$/)
  if (update && req.method === 'PUT' && reportPages[update[1]]) {
    const body = JSON.parse(await readBody(req))
    reportPages[update[1]].version = { number: body.version.number }
    confluenceWrites.push({ action: 'update', id: update[1], version: body.version.number, body: body.body.storage.value })
    return json(res, 200, reportPages[update[1]])
  }
  const attach = path.match(/^\/content\/(\d+)\/child\/attachment$/)
  if (attach && req.method === 'POST') {
    const raw = await new Promise(resolve => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))) })
    const filename = (raw.toString('latin1').match(/filename="([^"]+)"/) || [])[1]
    confluenceWrites.push({ action: 'attach', id: attach[1], filename, bytes: raw.length, token: req.headers['x-atlassian-token'] })
    return json(res, 200, { results: [{ id: `att-${confluenceWrites.length}`, title: filename }] })
  }
  if (path === '/user/current') return json(res, 200, { displayName: 'E2E Confluence User' })
  if (path === '/space') return json(res, 200, { results: [{ id: '1', key: 'E2E', name: 'E2E Space' }] })
  if (path === '/content/search') {
    const text = ((url.searchParams.get('cql') || '').match(/title ~ "([^"]*)"/) || [])[1]
    const found = Object.entries(pages).filter(([, page]) => !text || page.title.toLowerCase().includes(text.toLowerCase()))
    return json(res, 200, {
      results: found.map(([id, page]) => ({ id, title: page.title, _links: { webui: `/pages/${id}` }, version: { when: '2026-10-19T09:00:00.000Z', by: { displayName: 'Business Analyst' } } })),
      size: found.length,
    })
  }
  const page = path.match(/^\/content\/(\d+)$/)
  if (page && pages[page[1]]) {
    const { title, body } = pages[page[1]]
    return json(res, 200, { id: page[1], title, space: { key: 'E2E' }, _links: { webui: `/pages/${page[1]}` }, version: { when: '2026-10-19T09:00:00.000Z', by: { displayName: 'Business Analyst' } }, body: { view: { value: body } } })
  }
  return json(res, 404, { message: 'Not Found' })
}

// The AI proposes one change: an assertion for the sample pytest test.
const AI_ANSWER = [
  'The test has no assertion yet, so it can never fail. I added one.',
  '',
  '```file:tests/test_login_error.py',
  'def test_login_error_message():',
  "    message = 'Wrong email or password'",
  "    assert message.startswith('Wrong')",
  '```',
].join('\n')
const aiRequests = []
const AI_REVIEW = JSON.stringify([
  { path: 'tests/test_login_error.py', line: 4, body: 'Compare with the exact text the page shows instead of the length.' },
  { path: 'tests/test_login_error.py', line: 40, body: 'Not a line of this diff.' },
])

async function models(req, res, url) {
  const path = url.pathname.replace(/^\/models/, '')
  if (path === '/catalog/models') return json(res, 200, [{ id: 'openai/gpt-4.1', name: 'GPT-4.1', supported_output_modalities: ['text'] }])
  if (path === '/inference/chat/completions' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}')
    const last = body.messages?.at(-1)?.content ?? ''
    aiRequests.push({ messages: body.messages?.length ?? 0, last })
    // A pull request review: one suggestion on a line of the diff, and one outside it (ATM drops that one).
    const content = last.startsWith('Review this pull request') ? AI_REVIEW : AI_ANSWER
    return json(res, 200, { choices: [{ message: { role: 'assistant', content } }] })
  }
  return json(res, 404, { message: 'Not Found' })
}

// Microsoft Teams workflow webhook: records the Adaptive Card's title and link.
async function teams(req, res) {
  if (req.method !== 'POST') return json(res, 405, { message: 'Method Not Allowed' })
  const card = JSON.parse(await readBody(req)).attachments[0].content
  teamsPosts.push({ title: card.body[0].text, text: card.body[1]?.text ?? '', link: card.actions?.[0]?.url ?? null })
  return json(res, 202, {})
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (url.pathname === '/__e2e/health') return json(res, 200, { ok: true })
  if (url.pathname === '/__e2e/pull-request' && req.method === 'POST') {
    // { branch, path, content, title, author, requested } → a commit on the branch and an open pull request.
    const body = JSON.parse(await readBody(req))
    const sha = commitToBranch('e2e', 'sample', body.branch, body.path, body.content, body.title)
    const now = new Date().toISOString()
    const number = pullRequests.length + 1
    pullRequests.push({ number, title: body.title, body: body.body || '', head: body.branch, base: 'main', sha,
      author: body.author || 'e2e-user', requested: body.requested || [], reviews: [], comments: [], issueComments: [],
      created_at: now, updated_at: now })
    return json(res, 201, { number })
  }
  if (url.pathname === '/__e2e/requests') return json(res, 200, { requests, pullRequests, jiraWrites, aiRequests, confluenceWrites, teamsPosts, reviewWrites })
  requests.push({ method: req.method, path: url.pathname, authorization: Boolean(req.headers.authorization) })
  if (/^\/[^/]+\/[^/]+\.git\//.test(url.pathname)) return gitHttpBackend(req, res, url)
  if (url.pathname.startsWith('/api/v3/')) return github(req, res, url)
  if (url.pathname.startsWith('/jira/')) return jira(req, res, url)
  if (url.pathname.startsWith('/confluence/')) return confluence(req, res, url)
  if (url.pathname.startsWith('/models/')) return models(req, res, url)
  if (url.pathname === '/teams/hook') return teams(req, res)
  json(res, 404, { message: 'Not Found' })
}).listen(port, '127.0.0.1', () => console.log(`fake services on http://127.0.0.1:${port}`))
