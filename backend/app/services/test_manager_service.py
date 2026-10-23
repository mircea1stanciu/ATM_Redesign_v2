"""
Test Manager Service — fetches sprint-based test data from Jira Agile + REST APIs.

Uses only the standard Jira REST API (/rest/api/2, /rest/agile/1.0) which fully
supports Personal Access Token (Bearer) authentication on Jira Server/DC.
"""
import asyncio
import time as _time
from typing import Any, Optional

import httpx

# Module-level in-process cache for test cases (avoids repeating 5+ Jira calls per page load)
# Format: project_key → (timestamp, [issue_dicts], total_jira_count)
_CASES_CACHE: dict[str, tuple[float, list[dict], int]] = {}
_EPICS_CACHE: dict[str, tuple[float, list[dict], int]] = {}
_CACHE_TTL = 300  # 5 minutes


def clear_test_manager_caches(project_key: Optional[str] = None) -> None:
    """Invalidate the in-process epics/test-cases caches.

    Called whenever a Jira connection (token, base URL or connected project)
    is changed/reset from Settings, so Jira Management doesn't keep serving
    data fetched under the old configuration. If *project_key* is given, only
    that project's cache entries are cleared; otherwise everything is
    cleared (safe default when the token/base URL itself changes, since that
    affects every project's cached results).
    """
    if project_key:
        _CASES_CACHE.pop(project_key, None)
        _EPICS_CACHE.pop(project_key, None)
    else:
        _CASES_CACHE.clear()
        _EPICS_CACHE.clear()


def _extract_team_name(value: Any) -> str:
    """Best-effort extraction of a readable team name from a Jira custom
    field value, which may be a plain string, a select-list dict (with
    value/name/displayName), or a list of either."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for candidate in ('value', 'name', 'displayName'):
            v = value.get(candidate)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for nested in value.values():
            extracted = _extract_team_name(nested)
            if extracted:
                return extracted
    if isinstance(value, list):
        for item in value:
            extracted = _extract_team_name(item)
            if extracted:
                return extracted
    return ''


async def _jira_request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    max_retries: int = 2,
    **kwargs: Any,
) -> httpx.Response:
    """Retry Jira request on connection errors."""
    last_error = None
    for attempt in range(max_retries):
        try:
            if method.upper() == 'GET':
                return await client.get(url, **kwargs)
            elif method.upper() == 'POST':
                return await client.post(url, **kwargs)
            else:
                raise ValueError(f"Unsupported method: {method}")
        except (OSError, httpx.ReadError, httpx.WriteError, asyncio.TimeoutError) as e:
            last_error = e
            if attempt < max_retries - 1:
                await asyncio.sleep(0.5)
            continue
    raise last_error or Exception("Unknown error after retries")


class TestManagerService:
    """Service for aggregating test work from Jira sprints."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip('/')
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        }

    async def get_boards(self, project_key: str) -> list[dict[str, Any]]:
        """Get all Agile boards for a project."""
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            r = await client.get(
                f'{self.base_url}/rest/agile/1.0/board',
                params={'projectKeyOrId': project_key, 'maxResults': 50},
                headers=self.headers,
            )
            if r.status_code != 200:
                return []
            return r.json().get('values', [])

    async def get_sprints_with_stats(
        self,
        project_key: str,
        state: str = 'active',
        max_sprints: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Return sprints for a project with testing-issue statistics.

        Each entry looks like:
        {
          "id": 17388643,
          "name": "F@ke Sprint 193",
          "state": "active",
          "startDate": "2026-04-22",
          "endDate": "2026-05-06",
          "boardId": 8002621,
          "boardName": "RBRO Athena PI Board",
          "totalTests": 24,
          "byStatus": {"Done": 20, "In Progress": 2, "To Do": 2},
        }
        """
        boards = await self.get_boards(project_key)
        if not boards:
            return []

        seen_sprint_ids: set[int] = set()
        sprints: list[dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            for board in boards:
                board_id = board['id']
                board_name = board.get('name', '')

                r = await client.get(
                    f'{self.base_url}/rest/agile/1.0/board/{board_id}/sprint',
                    params={'state': state, 'maxResults': 50},
                    headers=self.headers,
                )
                if r.status_code != 200:
                    continue

                for sprint in r.json().get('values', []):
                    sid = sprint['id']
                    if sid in seen_sprint_ids:
                        continue
                    seen_sprint_ids.add(sid)

                    stats = await self._get_sprint_test_stats(client, sid, project_key)

                    sprints.append({
                        'id': sid,
                        'name': sprint.get('name', ''),
                        'state': sprint.get('state', ''),
                        'startDate': (sprint.get('startDate') or '')[:10],
                        'endDate': (sprint.get('endDate') or '')[:10],
                        'boardId': board_id,
                        'boardName': board_name,
                        **stats,
                    })

                    if len(sprints) >= max_sprints:
                        break

                if len(sprints) >= max_sprints:
                    break

        # Sort: active first, then by startDate desc
        sprints.sort(key=lambda s: (0 if s['state'] == 'active' else 1, s['startDate']), reverse=False)
        return sprints

    async def _get_sprint_test_stats(
        self,
        client: httpx.AsyncClient,
        sprint_id: int,
        project_key: str,
    ) -> dict[str, Any]:
        """Count Testing/Dev-Testing issues in a sprint grouped by status."""
        try:
            r = await client.post(
                f'{self.base_url}/rest/api/2/search',
                json={
                    'jql': (
                        f'project={project_key} AND sprint={sprint_id} '
                        'AND issuetype in (Testing,"Dev-Testing") '
                        'ORDER BY status'
                    ),
                    'maxResults': 200,
                    'fields': ['status'],
                },
                headers=self.headers,
            )
            if r.status_code != 200:
                return {'totalTests': 0, 'byStatus': {}}

            data = r.json()
            by_status: dict[str, int] = {}
            for issue in data.get('issues', []):
                status_name = issue['fields']['status']['name']
                by_status[status_name] = by_status.get(status_name, 0) + 1

            return {
                'totalTests': data.get('total', sum(by_status.values())),
                'byStatus': by_status,
            }
        except Exception:
            return {'totalTests': 0, 'byStatus': {}}

    async def get_sprint_issues(
        self,
        sprint_id: int,
        project_key: str,
        max_results: int = 100,
    ) -> list[dict[str, Any]]:
        """Return individual Testing/Dev-Testing issues for a sprint."""
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            r = await client.post(
                f'{self.base_url}/rest/api/2/search',
                json={
                    'jql': (
                        f'project={project_key} AND sprint={sprint_id} '
                        'AND issuetype in (Testing,"Dev-Testing") '
                        'ORDER BY status ASC, updated DESC'
                    ),
                    'maxResults': max_results,
                    'fields': ['summary', 'status', 'issuetype', 'assignee', 'components', 'updated'],
                },
                headers=self.headers,
            )
            if r.status_code != 200:
                return []

            issues = []
            for item in r.json().get('issues', []):
                f = item['fields']
                assignee = f.get('assignee') or {}
                issues.append({
                    'key': item['key'],
                    'summary': f.get('summary', ''),
                    'status': f['status']['name'],
                    'issueType': f['issuetype']['name'],
                    'assignee': assignee.get('displayName') or assignee.get('name', ''),
                    'components': [c['name'] for c in f.get('components', [])],
                    'updated': (f.get('updated') or '')[:10],
                    'url': f'{self.base_url}/browse/{item["key"]}',
                })
            return issues

    async def get_all_test_cases(
        self,
        project_key: str,
        max_issues: int = 1000,
        force_refresh: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Fetch and cache all Testing/Dev-Testing issues (up to *max_issues*).

        Returns a (issues_list, total_jira_count) tuple.
        The total_jira_count may exceed len(issues_list) when the project has
        more issues than the cap.
        """
        cached = _CASES_CACHE.get(project_key)
        if not force_refresh and cached and (_time.time() - cached[0]) < _CACHE_TTL:
            return cached[1], cached[2]

        issues: list[dict[str, Any]] = []
        total_jira = 0
        start_at = 0
        page_size = 200

        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            while start_at < max_issues:
                fetch = min(page_size, max_issues - start_at)
                r = await client.post(
                    f'{self.base_url}/rest/api/2/search',
                    json={
                        'jql': (
                            f'project={project_key} '
                            'AND issuetype in (Testing,"Dev-Testing") '
                            'ORDER BY updated DESC'
                        ),
                        'startAt': start_at,
                        'maxResults': fetch,
                        'fields': ['summary', 'status', 'issuetype', 'components', 'updated', 'assignee'],
                    },
                    headers=self.headers,
                )
                if r.status_code != 200:
                    break

                data = r.json()
                total_jira = data.get('total', 0)
                batch = data.get('issues', [])

                for item in batch:
                    f = item['fields']
                    assignee = f.get('assignee') or {}
                    issues.append({
                        'key': item['key'],
                        'summary': f.get('summary', ''),
                        'jiraStatus': f['status']['name'],
                        'issueType': f['issuetype']['name'],
                        'components': [c['name'] for c in f.get('components', [])],
                        'updated': (f.get('updated') or '')[:10],
                        'assignee': assignee.get('displayName') or assignee.get('name', ''),
                        'url': f'{self.base_url}/browse/{item["key"]}',
                    })

                start_at += len(batch)
                if start_at >= total_jira or not batch:
                    break

        _CASES_CACHE[project_key] = (_time.time(), issues, total_jira)
        return issues, total_jira

    async def get_epics_with_stories(
        self,
        project_key: str,
        max_epics: int = 120,
        max_stories_per_epic: int = 100,
        force_refresh: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Return Epics sorted by created DESC, each with child Stories.

        Tree model is intended for frontend hierarchy rendering:
        Year -> Team -> Epic -> Story
        """
        cached = _EPICS_CACHE.get(project_key)
        if not force_refresh and cached and (_time.time() - cached[0]) < _CACHE_TTL:
            return cached[1], cached[2]

        epics: list[dict[str, Any]] = []
        total_epics = 0
        start_at = 0
        page_size = 100

        def _chunks(values: list[str], size: int) -> list[list[str]]:
            return [values[i:i + size] for i in range(0, len(values), size)]

        def _extract_epic_key(fields: dict[str, Any], keys_set: set[str]) -> Optional[str]:
            def _normalize_key(value: Any) -> Optional[str]:
                if isinstance(value, str) and value in keys_set:
                    return value
                if isinstance(value, dict):
                    for candidate in (value.get('key'), value.get('value'), value.get('name')):
                        if isinstance(candidate, str) and candidate in keys_set:
                            return candidate
                    parent_candidate = value.get('parent')
                    if isinstance(parent_candidate, dict):
                        parent_key = parent_candidate.get('key')
                        if isinstance(parent_key, str) and parent_key in keys_set:
                            return parent_key
                if isinstance(value, list):
                    for item in value:
                        maybe_key = _normalize_key(item)
                        if maybe_key:
                            return maybe_key
                return None

            parent = fields.get('parent') or {}
            parent_key = parent.get('key') if isinstance(parent, dict) else None
            if parent_key in keys_set:
                return parent_key

            for k, v in fields.items():
                if not (k.startswith('customfield_') or k in ('Epic Link', 'epicLink')):
                    continue
                maybe = _normalize_key(v)
                if maybe:
                    return maybe
            return None

        async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
            epic_link_jql_field = '"Epic Link"'
            epic_link_response_field = 'Epic Link'
            team_name_response_field: Optional[str] = None
            fields_r = await _jira_request_with_retry(
                client,
                'GET',
                f'{self.base_url}/rest/api/2/field',
                headers=self.headers,
            )
            if fields_r.status_code == 200:
                for field in fields_r.json():
                    field_name = (field.get('name') or '').strip()
                    field_id = field.get('id', '')

                    schema = field.get('schema') or {}
                    if schema.get('custom') != 'com.pyxis.greenhopper.jira:gh-epic-link':
                        if (
                            not team_name_response_field
                            and isinstance(field_name, str)
                            and 'team name' in field_name.lower()
                        ):
                            if isinstance(field_id, str) and field_id:
                                team_name_response_field = field_id
                            elif field_name:
                                team_name_response_field = field_name
                        continue

                    if isinstance(field_id, str) and field_id.startswith('customfield_'):
                        field_num = field_id.split('_', 1)[1]
                        epic_link_jql_field = f'cf[{field_num}]'
                        epic_link_response_field = field_id
                    elif isinstance(field_name, str) and field_name:
                        epic_link_jql_field = f'"{field_name}"'
                        epic_link_response_field = field_name

            epic_fields = ['summary', 'created', 'components']
            if team_name_response_field:
                epic_fields.append(team_name_response_field)

            while start_at < max_epics:
                r = await _jira_request_with_retry(
                    client,
                    'POST',
                    f'{self.base_url}/rest/api/2/search',
                    json={
                        'jql': (
                            f'project={project_key} '
                            'AND issuetype = Epic '
                            'ORDER BY created DESC'
                        ),
                        'startAt': start_at,
                        'maxResults': min(page_size, max_epics - start_at),
                        'fields': epic_fields,
                    },
                    headers=self.headers,
                )
                if r.status_code != 200:
                    break

                data = r.json()
                total_epics = data.get('total', 0)
                batch = data.get('issues', [])
                if not batch:
                    break

                for epic in batch:
                    ef = epic.get('fields', {})
                    epic_key = epic['key']
                    epic_created = ef.get('created') or ''
                    epic_team = (
                        _extract_team_name(ef.get(team_name_response_field, ''))
                        if team_name_response_field else ''
                    )
                    epic_year = (epic_created[:4] if len(epic_created) >= 4 else '') or 'Unknown'

                    epics.append({
                        'key': epic_key,
                        'summary': ef.get('summary', ''),
                        'created': epic_created[:10],
                        'year': epic_year,
                        'team': epic_team or '',
                        'url': f'{self.base_url}/browse/{epic_key}',
                        'stories': [],
                    })

                start_at += len(batch)
                if start_at >= total_epics:
                    break

            epic_keys = [e['key'] for e in epics]
            stories_by_epic: dict[str, list[dict[str, Any]]] = {k: [] for k in epic_keys}
            seen_story_keys: dict[str, set[str]] = {k: set() for k in epic_keys}

            for key_batch in _chunks(epic_keys, 20):
                key_batch_csv = ','.join(key_batch)
                story_jqls = [
                    (
                        f'project={project_key} '
                        'AND issuetype != Epic '
                        f'AND {epic_link_jql_field} in ({key_batch_csv}) '
                        'ORDER BY created DESC'
                    ),
                    (
                        f'project={project_key} '
                        'AND issuetype != Epic '
                        f'AND parent in ({key_batch_csv}) '
                        'ORDER BY created DESC'
                    ),
                ]

                for jql in story_jqls:
                    sr = await _jira_request_with_retry(
                        client,
                        'POST',
                        f'{self.base_url}/rest/api/2/search',
                        json={
                            'jql': jql,
                            'maxResults': min(2000, max_stories_per_epic * len(key_batch)),
                            'fields': [
                                'summary',
                                'created',
                                'components',
                                'status',
                                'issuetype',
                                'parent',
                                epic_link_response_field,
                                'Epic Link',
                            ],
                        },
                        headers=self.headers,
                    )
                    if sr.status_code != 200:
                        continue

                    sissues = sr.json().get('issues', [])
                    if not sissues:
                        continue

                    batch_set = set(key_batch)
                    for s in sissues:
                        sf = s.get('fields', {})

                        # Include Story, Task and Technical Story issue types
                        issue_type_name = (sf.get('issuetype') or {}).get('name', '')
                        if issue_type_name not in ('Story', 'Task', 'Technical Story'):
                            continue

                        epic_key = _extract_epic_key(sf, batch_set)
                        if not epic_key:
                            continue

                        story_key = s['key']
                        if story_key in seen_story_keys[epic_key]:
                            continue
                        if len(stories_by_epic[epic_key]) >= max_stories_per_epic:
                            continue

                        seen_story_keys[epic_key].add(story_key)
                        screated = sf.get('created') or ''
                        scomponents = [c.get('name', '') for c in sf.get('components', []) if c.get('name')]
                        stories_by_epic[epic_key].append({
                            'key': story_key,
                            'summary': sf.get('summary', ''),
                            'created': screated[:10],
                            'team': (scomponents[0] if scomponents else ''),
                            'status': (sf.get('status') or {}).get('name', ''),
                            'issueType': issue_type_name,
                            'url': f'{self.base_url}/browse/{story_key}',
                        })

            for epic in epics:
                epic_stories = stories_by_epic.get(epic['key'], [])
                epic['stories'] = epic_stories

        _EPICS_CACHE[project_key] = (_time.time(), epics, total_epics)
        return epics, total_epics

    async def search_release_tickets(
        self,
        jql: str,
        max_results: int = 300,
    ) -> list[dict[str, Any]]:
        """Run an arbitrary JQL query (e.g. one extracted from a Confluence
        "jira" macro) and return issues shaped for a release-ticket table:
        key, summary, issue type, status, team name, epic link, components.
        """
        issues: list[dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            epic_link_response_field = 'Epic Link'
            team_name_response_field: Optional[str] = None

            fields_r = await _jira_request_with_retry(
                client, 'GET', f'{self.base_url}/rest/api/2/field', headers=self.headers,
            )
            if fields_r.status_code == 200:
                for field in fields_r.json():
                    field_name = (field.get('name') or '').strip()
                    field_id = field.get('id', '')
                    schema = field.get('schema') or {}
                    if schema.get('custom') != 'com.pyxis.greenhopper.jira:gh-epic-link':
                        if (
                            not team_name_response_field
                            and isinstance(field_name, str)
                            and 'team name' in field_name.lower()
                        ):
                            if isinstance(field_id, str) and field_id:
                                team_name_response_field = field_id
                            elif field_name:
                                team_name_response_field = field_name
                        continue
                    if isinstance(field_id, str) and field_id.startswith('customfield_'):
                        epic_link_response_field = field_id
                    elif isinstance(field_name, str) and field_name:
                        epic_link_response_field = field_name

            search_fields = ['summary', 'issuetype', 'status', 'components', epic_link_response_field]
            if team_name_response_field:
                search_fields.append(team_name_response_field)

            seen_keys: set[str] = set()
            start_at = 0
            page_size = 200

            while start_at < max_results:
                r = await _jira_request_with_retry(
                    client, 'POST', f'{self.base_url}/rest/api/2/search',
                    json={
                        'jql': jql,
                        'startAt': start_at,
                        'maxResults': min(page_size, max_results - start_at),
                        'fields': search_fields,
                    },
                    headers=self.headers,
                )
                if r.status_code != 200:
                    break

                data = r.json()
                batch = data.get('issues', [])
                if not batch:
                    break

                for item in batch:
                    key = item.get('key')
                    if not key or key in seen_keys:
                        continue
                    seen_keys.add(key)
                    f = item.get('fields', {}) or {}

                    team_name = _extract_team_name(f.get(team_name_response_field)) if team_name_response_field else ''

                    epic_link_val = f.get(epic_link_response_field) or f.get('Epic Link')
                    if isinstance(epic_link_val, str):
                        epic_link = epic_link_val
                    elif isinstance(epic_link_val, dict):
                        epic_link = epic_link_val.get('key') or epic_link_val.get('value') or ''
                    else:
                        epic_link = ''

                    components = ', '.join(
                        c.get('name', '') for c in (f.get('components') or []) if c.get('name')
                    )

                    issues.append({
                        'key': key,
                        'summary': f.get('summary', ''),
                        'issue_type': (f.get('issuetype') or {}).get('name', ''),
                        'status': (f.get('status') or {}).get('name', ''),
                        'team_name': team_name,
                        'epic_link': epic_link,
                        'components': components,
                        'url': f'{self.base_url}/browse/{key}',
                    })

                start_at += len(batch)
                if start_at >= data.get('total', 0):
                    break

        return issues
