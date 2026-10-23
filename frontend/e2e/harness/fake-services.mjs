// Stand-ins for GitHub, Jira and Confluence so UI tests never call real services.
//
//   /<owner>/<repo>.git/...     git over HTTP for the bare repositories in E2E_FAKE_ROOT (git http-backend)
//   /api/v3/...                 GitHub REST: repository, branches (read from the bare repository), pull requests
//   /jira/rest/api/{2,3}/...    Jira: myself, project search
//   /confluence/rest/api/...    Confluence: current user, spaces
//   /__e2e/requests             what ATM sent (tests inspect it); /__e2e/health for the harness
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
    pullRequests.push({ number, ...body, authorization: req.headers.authorization || '' })
    return json(res, 201, {
      number, state: 'open', title: body.title, html_url: `http://127.0.0.1:${port}/${owner}/${repo}/pull/${number}`,
    })
  }
  return json(res, 404, { message: 'Not Found' })
}

function jira(req, res, url) {
  const path = url.pathname.replace(/^\/jira\/rest\/api\/[23]/, '')
  if (path === '/myself') return json(res, 200, { displayName: 'E2E Jira User', name: 'e2e' })
  if (path === '/project/search') return json(res, 200, { values: [{ id: '10000', key: 'E2E', name: 'E2E Jira Project' }] })
  return json(res, 404, { errorMessages: ['Not Found'] })
}

function confluence(req, res, url) {
  const path = url.pathname.replace(/^\/confluence(\/wiki)?\/rest\/api/, '')
  if (path === '/user/current') return json(res, 200, { displayName: 'E2E Confluence User' })
  if (path === '/space') return json(res, 200, { results: [{ id: '1', key: 'E2E', name: 'E2E Space' }] })
  return json(res, 404, { message: 'Not Found' })
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (url.pathname === '/__e2e/health') return json(res, 200, { ok: true })
  if (url.pathname === '/__e2e/requests') return json(res, 200, { requests, pullRequests })
  requests.push({ method: req.method, path: url.pathname, authorization: Boolean(req.headers.authorization) })
  if (/^\/[^/]+\/[^/]+\.git\//.test(url.pathname)) return gitHttpBackend(req, res, url)
  if (url.pathname.startsWith('/api/v3/')) return github(req, res, url)
  if (url.pathname.startsWith('/jira/')) return jira(req, res, url)
  if (url.pathname.startsWith('/confluence/')) return confluence(req, res, url)
  json(res, 404, { message: 'Not Found' })
}).listen(port, '127.0.0.1', () => console.log(`fake services on http://127.0.0.1:${port}`))
