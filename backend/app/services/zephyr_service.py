"""
Zephyr (Jira Test Management) integration service.
Supports Zephyr Squad (Server/DC) and Zephyr Scale (TM4J/Cloud).
"""
import asyncio
import re
import time
from typing import Any, Optional

import httpx

# Short-lived cache of the full paginated Zephyr Scale (TM4J) test-case list,
# keyed by (base_url, project_key). Folders and the test-case grid are both
# derived from this single fetch, so selecting folders stays instant and we
# avoid re-paginating the whole project on every click.
_SCALE_CASES_CACHE: dict[tuple[str, str, str], tuple[float, list[dict[str, Any]]]] = {}
_SCALE_CACHE_TTL_SECONDS = 60.0

# Longer-lived cache of a Jira story/task's live metadata (status + team),
# keyed by (base_url, issue_key). Teams/statuses of stories change rarely, so
# caching them avoids re-querying Jira every time the status/team filter runs
# over the same folders (the main source of the earlier "filtering is slow"
# behaviour).
_STORY_META_CACHE: dict[tuple[str, str, str], tuple[float, dict[str, str]]] = {}
_STORY_META_TTL_SECONDS = 600.0


class ZephyrAuthError(Exception):
    """Raised when the Zephyr plugin rejects the auth token (e.g. PAT not supported by plugin)."""
    pass


class ZephyrPermissionError(Exception):
    """Raised when the user's token is valid but lacks Zephyr-specific permissions."""
    pass


class ZephyrUpdateError(Exception):
    """Raised when a write call (e.g. updating a test case's status) is rejected."""
    pass


class ZephyrTransientError(Exception):
    """Raised when a Zephyr Scale (TM4J) call fails for a transient reason
    (timeout, connection error, or a 5xx from Jira) even after retrying, or
    when Jira rejects the request itself (e.g. a malformed folder query).
    This is distinct from ZephyrAuthError: the caller should surface it as a
    "please retry" condition instead of cascading into unrelated Squad-plugin
    auth diagnostics, which would be misleading when TM4J is the working
    integration for this instance."""
    pass


class ZephyrService:
    """Service for interacting with Jira Zephyr API."""

    def __init__(self, base_url: str, token: str, session_cookie: Optional[str] = None):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.session_cookie = (session_cookie or '').strip()
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        }
        # Legacy Zephyr Squad plugins reject PAT/Bearer and only trust a Jira
        # web session cookie. When the user supplies one (copied from their
        # already-authenticated browser, which has passed SSO/2FA), authenticate
        # every call with that cookie instead. The Authorization/Bearer header is
        # dropped in this mode because Jira's Seraph filter would otherwise
        # process the (plugin-rejected) Bearer first and never fall through to
        # the cookie. A valid web session authenticates the standard REST API
        # too, so nothing else breaks. Accepts either a bare JSESSIONID value or
        # a full "JSESSIONID=...; other=..." cookie string.
        if self.session_cookie:
            cookie = self.session_cookie
            if '=' not in cookie:
                cookie = f'JSESSIONID={cookie}'
            self.headers['Cookie'] = cookie
            self.headers.pop('Authorization', None)

    async def _get_project_id(self, project_key: str) -> Optional[str]:
        """
        Resolve a project key to its numeric Jira project ID.
        Needed for Zephyr Squad which uses IDs, not keys.
        """
        async with httpx.AsyncClient(timeout=10) as client:
            for api_version in ('rest/api/3', 'rest/api/2'):
                try:
                    resp = await client.get(
                        f'{self.base_url}/{api_version}/project/{project_key}',
                        headers=self.headers,
                    )
                    if resp.status_code == 200:
                        return str(resp.json().get('id', ''))
                except Exception:
                    continue
        return None

    def _is_login_redirect(self, resp: httpx.Response) -> bool:
        """Check if a response is a Jira login page redirect (auth/permission failure)."""
        if resp.status_code in (302, 301):
            location = resp.headers.get('location', '')
            return 'login.jsp' in location or 'permissionViolation' in location
        # Some setups follow redirects and return HTML with 200
        if resp.status_code == 200:
            ct = resp.headers.get('content-type', '')
            if 'text/html' in ct:
                return True
        return False

    async def _try_zephyr_squad(self, project_id: str) -> list[dict[str, Any]]:
        """
        Zephyr Squad (Server/DC/Cloud): GET /rest/zephyr/1.0/cycle
        Response is a dict where each key is a cycle ID (or 'recordsCount').
        versionId=-1 means "All Versions".

        Raises ZephyrAuthError if the plugin rejects the Bearer token (returns login redirect).
        """
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/zephyr/1.0/cycle',
                    params={'projectId': project_id, 'versionId': '-1'},
                    headers=self.headers,
                )
                if self._is_login_redirect(resp):
                    raise ZephyrAuthError(
                        "The Zephyr plugin on this Jira Server instance does not accept "
                        "Personal Access Token (Bearer) authentication. This typically occurs "
                        "when the Zephyr plugin version is older and only supports session-based "
                        "login, or when 2FA is enforced on the instance. "
                        "Contact your Jira administrator to: (1) upgrade Zephyr Squad to a "
                        "version that supports PAT auth, or (2) grant API access for the "
                        "service account without 2FA enforcement."
                    )
                if resp.status_code == 401:
                    raise ZephyrAuthError("Jira token is invalid or expired.")
                if resp.status_code == 403:
                    raise ZephyrPermissionError(
                        "The Jira token is valid but lacks Zephyr-specific permissions. "
                        "Ask your Jira admin to grant 'Zephyr View' permissions to your account."
                    )
                if resp.status_code != 200:
                    return []

                data = resp.json()
                cycles = []
                for key, value in data.items():
                    # Skip metadata fields
                    if not isinstance(value, dict):
                        continue
                    # Skip the built-in "Ad hoc" cycle (id=-1)
                    if str(key) == '-1':
                        continue
                    cycle = dict(value)
                    cycle['id'] = key
                    cycles.append(cycle)
                return cycles
            except (ZephyrAuthError, ZephyrPermissionError):
                raise
            except Exception:
                return []

    async def _try_zephyr_scale(self, project_key: str) -> list[dict[str, Any]]:
        """
        Zephyr Scale / TM4J: GET /rest/atm/1.0/testcycle?project={key}
        """
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/atm/1.0/testcycle',
                    params={'project': project_key},
                    headers=self.headers,
                )
                if resp.status_code != 200:
                    return []
                data = resp.json()
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return data.get('testcycles', data.get('values', []))
            except Exception:
                pass
        return []

    async def _try_zephyr_squad_cloud(self, project_key: str) -> list[dict[str, Any]]:
        """
        Zephyr Squad Cloud: GET /public/rest/api/1.0/cycles?projectKey={key}
        Used on Atlassian Cloud with Zephyr Squad app.
        """
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/public/rest/api/1.0/cycles',
                    params={'projectKey': project_key, 'maxRecords': '200'},
                    headers=self.headers,
                )
                if resp.status_code != 200:
                    return []
                data = resp.json()
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return data.get('cycles', data.get('items', []))
            except Exception:
                pass
        return []

    async def get_cycles(self, project_key: str) -> list[dict[str, Any]]:
        """
        Get all test cycles for a project, trying multiple Zephyr API variants:
        1. Zephyr Squad (Server/DC) — uses numeric project ID
        2. Zephyr Scale / TM4J — uses project key
        3. Zephyr Squad Cloud — uses project key

        A definitive auth/permission failure from one variant (e.g. the Squad
        plugin rejecting PAT/Bearer auth) does NOT abort the whole lookup —
        the other variants are still tried, since a Jira instance commonly
        only has one of these plugins actually configured. The error is only
        raised if every variant came back empty, so the user still gets a
        useful diagnostic when Zephyr genuinely isn't reachable at all.
        """
        # Step 1: Resolve project key → numeric ID for Zephyr Squad
        project_id = await self._get_project_id(project_key)

        last_error: Optional[Exception] = None

        # Step 2: Try Zephyr Squad (Server/DC) first — most common on enterprise.
        # Remember any auth/permission error but keep trying other variants.
        if project_id:
            try:
                cycles = await self._try_zephyr_squad(project_id)
                if cycles:
                    return cycles
            except (ZephyrAuthError, ZephyrPermissionError) as exc:
                last_error = exc

        # Step 3: Try Zephyr Scale / TM4J
        cycles = await self._try_zephyr_scale(project_key)
        if cycles:
            return cycles

        # Step 4: Try Zephyr Squad Cloud
        cycles = await self._try_zephyr_squad_cloud(project_key)
        if cycles:
            return cycles

        # Nothing worked — surface the most informative error we have, if any.
        if last_error:
            raise last_error
        return []

    # ── Folders + Test cases (Zephyr "Automation Planner" support) ─────────────

    async def get_folders(
        self, project_key: str, status: Optional[str] = None, team: Optional[str] = None
    ) -> list[dict[str, Any]]:
        """Return the complete Zephyr Scale (TM4J) folder tree for the project.

        Uses the native ``/rest/tests/1.0/project/{id}/foldertree/testcase``
        endpoint — the same one the Zephyr UI itself uses — which returns the
        FULL tree (every folder, including empty ones) with per-folder counts in
        a single fast call, exactly matching what Jira/Zephyr shows. Falls back
        to path-derivation from test cases, then to Squad cycles, only when that
        native endpoint is unavailable.

        When ``status`` and/or ``team`` is given, each folder's ``count`` is
        recomputed to only include matching test cases (cumulative over its
        subtree) and folders with no matching case are dropped, so the folder
        tree is filtered/scoped the same way the Manual Test Cases panel is.
        """
        tree = await self._fetch_scale_folder_tree(project_key)
        if tree:
            return await self._apply_folder_status_filter(project_key, tree, status, team)

        # Fallback 1: derive folders from the test cases' folder paths.
        scale_cases = await self._fetch_all_scale_cases(project_key)
        if scale_cases:
            paths = {c["folder"] for c in scale_cases if c.get("folder")}
            derived = self._build_folder_tree_from_paths(paths)
            if derived:
                return await self._apply_folder_status_filter(project_key, derived, status, team)

        # Fallback 2 (Squad-only instances): expose cycles as pseudo-folders.
        # (This may raise ZephyrAuthError when the Squad plugin rejects the PAT.)
        cycles = await self.get_cycles(project_key)
        return [
            {
                "id": str(c.get("id") or c.get("key") or c.get("name") or ""),
                "name": str(c.get("name") or c.get("key") or c.get("id") or "Unnamed"),
                "parent_id": None,
                "kind": "cycle",
                "count": 0,
            }
            for c in cycles
            if c.get("id") or c.get("key") or c.get("name")
        ]

    async def _apply_folder_status_filter(
        self,
        project_key: str,
        tree: list[dict[str, Any]],
        status: Optional[str],
        team: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Recompute each folder node's ``count`` to reflect only test cases
        matching the given ``status`` and/or ``team`` (cumulative over its
        subtree), and drop any folder whose cumulative count is 0 so the tree
        only shows folders that actually contain a matching test case (directly
        or in a subfolder). Returns ``tree`` unchanged when neither filter is
        set."""
        if not status and not team:
            return tree

        all_cases = await self._fetch_all_scale_cases(project_key)
        wanted_status = status.strip().lower() if status else None

        # Status is a native field on the case; narrow by it first.
        matching = [
            c for c in all_cases
            if not wanted_status
            or str(c.get('status') or '').strip().lower() == wanted_status
        ]

        # Team is derived from the linked story/task (folder-path key); resolve
        # it only for the already status-narrowed set to keep Jira calls small.
        if team:
            wanted_team = team.strip().lower()
            story_ids = {
                self._extract_story_task_id(str(c.get('folder') or ''), project_key)
                for c in matching
            }
            story_ids = {sid for sid in story_ids if sid}
            meta_by_story = await self._fetch_story_task_meta(sorted(story_ids)) if story_ids else {}
            matching = [
                c for c in matching
                if str(
                    (meta_by_story.get(
                        self._extract_story_task_id(str(c.get('folder') or ''), project_key)
                    ) or {}).get('team') or ''
                ).strip().lower() == wanted_team
            ]

        leaf_counts: dict[str, int] = {}
        for c in matching:
            folder_path = str(c.get('folder') or '')
            if folder_path:
                leaf_counts[folder_path] = leaf_counts.get(folder_path, 0) + 1

        children_by_parent: dict[str, list[str]] = {}
        for node in tree:
            parent_id = node.get('parent_id')
            if parent_id:
                children_by_parent.setdefault(parent_id, []).append(node['id'])

        memo: dict[str, int] = {}

        def cumulative(node_id: str) -> int:
            if node_id in memo:
                return memo[node_id]
            total = leaf_counts.get(node_id, 0)
            for child_id in children_by_parent.get(node_id, []):
                total += cumulative(child_id)
            memo[node_id] = total
            return total

        return [
            {**node, "count": cumulative(node['id'])}
            for node in tree
            if cumulative(node['id']) > 0
        ]

    async def _fetch_scale_folder_tree(self, project_key: str) -> list[dict[str, Any]]:
        """Fetch the native TM4J folder tree and flatten it into path-keyed nodes.

        Each node is ``{id: full_path, name, parent_id: parent_path, kind, count}``
        where ``count`` is the folder's cumulative test-case count (as shown in
        the Zephyr UI). Returns [] if the endpoint isn't available."""
        project_id = await self._get_project_id(project_key)
        if not project_id:
            return []

        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/tests/1.0/project/{project_id}/foldertree/testcase',
                    headers=self.headers,
                )
            except Exception:
                return []
            if resp.status_code != 200:
                return []
            try:
                root = resp.json()
            except Exception:
                return []

        out: list[dict[str, Any]] = []

        def walk(node: dict[str, Any], parent_path: str) -> None:
            for child in (node.get('children') or []):
                if not isinstance(child, dict):
                    continue
                name = str(child.get('name') or '')
                path = f'{parent_path}/{name}'
                out.append({
                    "id": path,
                    "name": name,
                    "parent_id": parent_path or None,
                    "kind": "folder",
                    "count": int(child.get('itemsCount') or 0),
                })
                walk(child, path)

        if isinstance(root, dict):
            walk(root, '')
        return out

    def _build_folder_tree_from_paths(self, paths: set[str]) -> list[dict[str, Any]]:
        """Turn a set of ``/a/b/c`` folder paths into a flat list of nodes with
        ``{id, name, parent_id, kind}`` where each node's id is its full path
        prefix and parent_id is the parent prefix. The frontend nests them."""
        nodes: dict[str, dict[str, Any]] = {}
        for path in paths:
            segments = [s for s in path.split('/') if s != '']
            prefix = ''
            parent: Optional[str] = None
            for seg in segments:
                prefix = f'{prefix}/{seg}'
                if prefix not in nodes:
                    nodes[prefix] = {
                        "id": prefix,
                        "name": seg,
                        "parent_id": parent,
                        "kind": "folder",
                        "count": 0,
                    }
                parent = prefix
        return list(nodes.values())

    async def _fetch_all_scale_cases(
        self, project_key: str, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        """Fetch and normalize every Zephyr Scale (TM4J) test case for a project,
        paginating through ``/rest/atm/1.0/testcase/search`` (500/page). Results
        are cached briefly per (base_url, project_key) so the folder tree and the
        case grid share a single fetch. Returns [] when Scale isn't available."""
        auth_key = self.session_cookie or self.token
        cache_key = (self.base_url, project_key, auth_key)
        now = time.time()
        if not force_refresh:
            cached = _SCALE_CASES_CACHE.get(cache_key)
            if cached and (now - cached[0]) < _SCALE_CACHE_TTL_SECONDS:
                return cached[1]

        all_cases: list[dict[str, Any]] = []
        page_size = 500
        max_total = 5000  # hard safety cap
        start = 0
        async with httpx.AsyncClient(timeout=30) as client:
            while start < max_total:
                try:
                    resp = await client.get(
                        f'{self.base_url}/rest/atm/1.0/testcase/search',
                        params={
                            'query': f'projectKey = "{project_key}"',
                            'fields': 'key,name,status,priority,folder,precondition,objective,testScript',
                            'startAt': start,
                            'maxResults': page_size,
                        },
                        headers=self.headers,
                    )
                except Exception:
                    break
                if resp.status_code != 200:
                    break
                try:
                    data = resp.json()
                except Exception:
                    break
                items = data if isinstance(data, list) else data.get('values', [])
                if not items:
                    break
                for x in items:
                    if isinstance(x, dict):
                        all_cases.append(self._normalize_scale_case(x))
                if len(items) < page_size:
                    break
                start += page_size

        if all_cases:
            _SCALE_CASES_CACHE[cache_key] = (now, all_cases)
        return all_cases

    async def _try_scale_folders(self, project_key: str) -> list[dict[str, Any]]:
        """Zephyr Scale / TM4J: GET /rest/atm/1.0/folder?projectKey=X&type=TEST_CASE"""
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/atm/1.0/folder',
                    params={'projectKey': project_key, 'type': 'TEST_CASE', 'maxResults': 500},
                    headers=self.headers,
                )
                if resp.status_code != 200:
                    return []
                data = resp.json()
                items = data if isinstance(data, list) else data.get('values', [])
                folders = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    folders.append({
                        "id": str(item.get('id') or item.get('key') or item.get('name') or ''),
                        "name": str(item.get('name') or item.get('key') or ''),
                        "parent_id": str(item.get('parentId') or '') or None,
                        "kind": "folder",
                    })
                return [f for f in folders if f["id"]]
            except Exception:
                return []

    async def get_test_cases(
        self,
        project_key: str,
        folder_id: Optional[str] = None,
        case_status: Optional[str] = None,
        case_team: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Return manual test cases for a project, scoped to a folder path.

        Uses Zephyr Scale (TM4J) ``/rest/atm/1.0/testcase/search`` with a
        SERVER-SIDE ``folder = "<path>"`` filter, paginated fully so every case
        in that folder is returned (no artificial cap). This matches Zephyr's
        own behaviour: selecting a folder shows the cases directly in it. When
        no folder is given, an empty list is returned rather than pulling the
        entire project (which can be 16k+ cases) — the UI asks the user to pick
        a folder, exactly like the Zephyr Test Case view.

        ``case_status`` filters on the test case's own status; ``case_team``
        filters on the team of the linked story/task (its first Jira
        component). Status is applied first (cheap, native field) so team
        metadata only has to be resolved for the already-narrowed set.

        Falls back to Zephyr Squad Server/Cloud for non-TM4J instances.
        """
        cases, scale_ok = await self._fetch_scale_folder_cases(project_key, folder_id)
        if scale_ok:
            return await self._enrich_and_filter_cases(
                cases, project_key, case_status, case_team
            )

        cases = await self._try_squad_test_cases(project_key, folder_id)
        if cases:
            return await self._enrich_and_filter_cases(
                cases, project_key, case_status, case_team
            )

        cases = await self._try_squad_cloud_test_cases(project_key, folder_id)
        if cases:
            return await self._enrich_and_filter_cases(
                cases, project_key, case_status, case_team
            )

        # No data from any variant. Distinguish "genuinely empty" from
        # "authentication rejected" so the caller/UI reacts consistently with
        # the folders endpoint (which surfaces the same auth error). Probing the
        # Squad cycle endpoint raises ZephyrAuthError/ZephyrPermissionError when
        # the plugin rejects our auth; otherwise it returns quietly and we treat
        # the empty result as a genuinely empty folder/project.
        await self.get_cycles(project_key)
        return []

    def _filter_cases_by_status(
        self,
        cases: list[dict[str, Any]],
        case_status: Optional[str],
    ) -> list[dict[str, Any]]:
        """Return only cases whose status matches ``case_status``.

        Matching is trimmed and case-insensitive to stay robust against minor
        formatting differences across Zephyr variants.
        """
        if not case_status:
            return cases
        wanted = str(case_status).strip().lower()
        return [
            c for c in cases
            if str(c.get('status') or '').strip().lower() == wanted
        ]

    def _filter_cases_by_team(
        self,
        cases: list[dict[str, Any]],
        case_team: Optional[str],
    ) -> list[dict[str, Any]]:
        """Return only cases whose linked story/task team matches ``case_team``
        (trimmed, case-insensitive). Requires ``story_task_team`` to already be
        attached (see ``_attach_story_task_metadata``)."""
        if not case_team:
            return cases
        wanted = str(case_team).strip().lower()
        return [
            c for c in cases
            if str(c.get('story_task_team') or '').strip().lower() == wanted
        ]

    async def _enrich_and_filter_cases(
        self,
        cases: list[dict[str, Any]],
        project_key: str,
        case_status: Optional[str],
        case_team: Optional[str],
    ) -> list[dict[str, Any]]:
        """Apply the (native) status filter first, attach story/task metadata,
        then apply the team filter. Ordering keeps the number of Jira metadata
        lookups minimal by narrowing on the cheap native field before resolving
        per-story team/status."""
        cases = self._filter_cases_by_status(cases, case_status)
        cases = await self._attach_story_task_metadata(cases, project_key)
        cases = self._filter_cases_by_team(cases, case_team)
        return cases

    def _extract_story_task_id(self, folder_value: str, project_key: str) -> str:
        """Extract a Jira story/task key from a folder path.

        Expected common pattern: ``<PROJECT>-<number>`` (e.g. ``ARO-1234``).
        """
        if not folder_value:
            return ""
        project = re.escape(project_key.strip())
        if not project:
            return ""
        match = re.search(rf"\b{project}-\d+\b", folder_value, flags=re.IGNORECASE)
        return match.group(0).upper() if match else ""

    async def _fetch_story_task_meta(self, issue_keys: list[str]) -> dict[str, dict[str, str]]:
        """Fetch Jira issue ``status`` and ``team`` (first component name) for a
        list of issue keys, in batches, with a short module-level cache so
        repeated status/team filtering over the same stories doesn't re-hit
        Jira. Returns ``{KEY: {"status": ..., "team": ...}}``."""
        if not issue_keys:
            return {}

        now = time.time()
        auth_key = self.session_cookie or self.token
        out: dict[str, dict[str, str]] = {}
        misses: list[str] = []
        for key in issue_keys:
            cache_key = (self.base_url, auth_key, key.upper())
            cached = _STORY_META_CACHE.get(cache_key)
            if cached and (now - cached[0]) < _STORY_META_TTL_SECONDS:
                out[key.upper()] = cached[1]
            else:
                misses.append(key)

        chunk_size = 50
        async with httpx.AsyncClient(timeout=20) as client:
            for i in range(0, len(misses), chunk_size):
                chunk = misses[i:i + chunk_size]
                jql = f"key in ({', '.join(chunk)})"
                for api_version in ('2', '3'):
                    try:
                        resp = await client.get(
                            f'{self.base_url}/rest/api/{api_version}/search',
                            params={
                                'jql': jql,
                                'fields': 'status,components',
                                'maxResults': len(chunk),
                            },
                            headers=self.headers,
                        )
                    except Exception:
                        continue
                    if resp.status_code != 200:
                        continue
                    try:
                        payload = resp.json()
                    except Exception:
                        continue
                    for issue in payload.get('issues', []) if isinstance(payload, dict) else []:
                        if not isinstance(issue, dict):
                            continue
                        key = str(issue.get('key') or '').upper()
                        if not key:
                            continue
                        fields = issue.get('fields') or {}
                        status_obj = fields.get('status') if isinstance(fields, dict) else {}
                        status_name = str((status_obj or {}).get('name') or '')
                        components = fields.get('components') if isinstance(fields, dict) else []
                        team_name = ''
                        if isinstance(components, list) and components:
                            first = components[0]
                            if isinstance(first, dict):
                                team_name = str(first.get('name') or '')
                        meta = {"status": status_name, "team": team_name}
                        out[key] = meta
                        _STORY_META_CACHE[(self.base_url, auth_key, key)] = (now, meta)
                    break
        return out

    async def _attach_story_task_metadata(
        self,
        cases: list[dict[str, Any]],
        project_key: str,
    ) -> list[dict[str, Any]]:
        """Add ``story_task_id`` plus live ``story_task_status`` and
        ``story_task_team`` (the linked story/task's first Jira component) to
        each case."""
        if not cases:
            return cases

        story_ids = {
            self._extract_story_task_id(str(c.get('folder') or ''), project_key)
            for c in cases
        }
        story_ids = {sid for sid in story_ids if sid}
        meta_by_story = await self._fetch_story_task_meta(sorted(story_ids)) if story_ids else {}

        for c in cases:
            story_id = self._extract_story_task_id(str(c.get('folder') or ''), project_key)
            meta = meta_by_story.get(story_id) or {}
            c['story_task_id'] = story_id
            c['story_task_status'] = meta.get('status', '') if story_id else ''
            c['story_task_team'] = meta.get('team', '') if story_id else ''
        return cases

    async def get_project_teams(self, project_key: str) -> list[str]:
        """Return the project's team names, sourced from its Jira components
        (the same field a story/task's team is derived from — its first
        component). This gives the Team filter a full, project-wide list of
        options independent of which folder is currently selected."""
        async with httpx.AsyncClient(timeout=15) as client:
            for api_version in ('2', '3'):
                try:
                    resp = await client.get(
                        f'{self.base_url}/rest/api/{api_version}/project/{project_key}/components',
                        headers=self.headers,
                    )
                except Exception:
                    continue
                if resp.status_code != 200:
                    continue
                try:
                    data = resp.json()
                except Exception:
                    continue
                if not isinstance(data, list):
                    continue
                names = {
                    str(item.get('name') or '').strip()
                    for item in data
                    if isinstance(item, dict) and str(item.get('name') or '').strip()
                }
                return sorted(names, key=str.lower)
        return []

    async def get_test_case_statuses(self, project_key: str) -> list[dict[str, Any]]:
        """Return the project's configured Zephyr Scale (TM4J) test-case statuses
        (e.g. Draft, Manual, Approved, Automated, custom ones like "Suggested for
        Automation"), in their configured display order, via the native
        ``/rest/tests/1.0/testcasestatus`` endpoint (same one the Zephyr UI
        uses). Each item is ``{name, color, is_default, is_archived}``."""
        project_id = await self._get_project_id(project_key)
        if not project_id:
            return []
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/tests/1.0/testcasestatus',
                    params={'projectId': project_id},
                    headers=self.headers,
                )
            except Exception:
                return []
            if resp.status_code != 200:
                return []
            try:
                data = resp.json()
            except Exception:
                return []
        if not isinstance(data, list):
            return []
        statuses = [
            {
                "name": str(item.get('name') or ''),
                "color": str(item.get('color') or ''),
                "is_default": bool(item.get('isDefault')),
                "is_archived": bool(item.get('isArchived')),
                "index": int(item.get('index') if item.get('index') is not None else 999),
            }
            for item in data
            if isinstance(item, dict) and item.get('name')
        ]
        statuses.sort(key=lambda s: s["index"])
        for s in statuses:
            del s["index"]
        return statuses

    async def update_test_case_status(self, test_case_key: str, status: str) -> None:
        """Update a single TM4J test case's status (e.g. from the Automation
        Planner UI). Uses a minimal partial PUT — TM4J accepts a body with just
        the changed field(s) rather than requiring the full test case payload.
        Raises on any non-2xx response so the caller can surface a clear error."""
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.put(
                f'{self.base_url}/rest/atm/1.0/testcase/{test_case_key}',
                json={'status': status},
                headers=self.headers,
            )
        if resp.status_code == 401:
            raise ZephyrAuthError("Jira token is invalid or expired.")
        if resp.status_code == 403:
            raise ZephyrPermissionError(
                "The Jira token is valid but lacks permission to edit this test case."
            )
        if resp.status_code >= 400:
            raise ZephyrUpdateError(
                f"Failed to update status for {test_case_key}: "
                f"HTTP {resp.status_code} {resp.text[:200]}"
            )
        # Invalidate the cached full-project fetch (used by the fallback path)
        # so a subsequent full reload doesn't show the stale status.
        for cache_key in list(_SCALE_CASES_CACHE.keys()):
            if cache_key[0] == self.base_url:
                _SCALE_CASES_CACHE.pop(cache_key, None)

    async def _fetch_scale_folder_cases(
        self, project_key: str, folder_id: Optional[str]
    ) -> tuple[list[dict[str, Any]], bool]:
        """Fetch all TM4J test cases in a given folder path (server-side filter,
        fully paginated). Returns ``(cases, scale_available)``. ``scale_available``
        is True when the TM4J search endpoint responded 200 at least once, so the
        caller knows whether to fall back to Squad. With no ``folder_id`` we skip
        the (potentially huge) unfiltered fetch and return ``([], True)``.

        Transient failures (timeouts, connection errors, 5xx) are retried a few
        times before giving up. If they still fail, or Jira rejects the query
        outright (e.g. a malformed folder path), a ``ZephyrTransientError`` is
        raised so the caller can surface a clear "please retry" message instead
        of silently falling through to the unrelated Squad-plugin auth check
        (which produces a misleading "PAT not supported" error on instances
        where TM4J is in fact the working integration)."""
        if not folder_id:
            # Probe availability cheaply without pulling the whole project.
            ok = await self._scale_available(project_key)
            return [], ok

        safe_path = folder_id.rstrip('/').replace('"', '\\"')
        query = f'projectKey = "{project_key}" AND folder = "{safe_path}"'
        all_cases: list[dict[str, Any]] = []
        page_size = 1000
        start = 0
        max_attempts = 3
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                resp: Optional[httpx.Response] = None
                for attempt in range(1, max_attempts + 1):
                    try:
                        resp = await client.get(
                            f'{self.base_url}/rest/atm/1.0/testcase/search',
                            params={
                                'query': query,
                                'fields': 'key,name,status,priority,folder,precondition,objective,testScript',
                                'startAt': start,
                                'maxResults': page_size,
                            },
                            headers=self.headers,
                        )
                    except (httpx.TimeoutException, httpx.TransportError) as exc:
                        if attempt >= max_attempts:
                            fallback = await self._fallback_scale_folder_filter(project_key, folder_id)
                            if fallback is not None:
                                return fallback, True
                            raise ZephyrTransientError(
                                "Jira/Zephyr did not respond while loading test cases for this "
                                "folder (timeout or connection error). Please try again."
                            ) from exc
                        await asyncio.sleep(0.4 * attempt)
                        continue
                    if resp.status_code >= 500:
                        if attempt >= max_attempts:
                            fallback = await self._fallback_scale_folder_filter(project_key, folder_id)
                            if fallback is not None:
                                return fallback, True
                            raise ZephyrTransientError(
                                f"Jira/Zephyr returned a server error (HTTP {resp.status_code}) "
                                "while loading test cases for this folder. Please try again."
                            )
                        await asyncio.sleep(0.4 * attempt)
                        continue
                    break  # got a definitive response, stop retrying

                assert resp is not None
                if resp.status_code == 404:
                    # The TM4J search endpoint itself isn't present on this
                    # instance at all — genuinely not available, let the
                    # caller fall back to Squad.
                    return [], False
                if resp.status_code != 200:
                    fallback = await self._fallback_scale_folder_filter(project_key, folder_id)
                    if fallback is not None:
                        return fallback, True
                    # Jira rejected this specific request (e.g. malformed
                    # folder query) — surface directly rather than cascading
                    # into the unrelated Squad-plugin auth diagnostics.
                    raise ZephyrTransientError(
                        f"Jira/Zephyr rejected the test case query for this folder "
                        f"(HTTP {resp.status_code}). {resp.text[:200]}"
                    )
                try:
                    data = resp.json()
                except Exception as exc:
                    fallback = await self._fallback_scale_folder_filter(project_key, folder_id)
                    if fallback is not None:
                        return fallback, True
                    raise ZephyrTransientError(
                        "Jira/Zephyr returned an unexpected response while loading test "
                        "cases for this folder. Please try again."
                    ) from exc
                items = data if isinstance(data, list) else data.get('values', [])
                for x in items:
                    if isinstance(x, dict):
                        all_cases.append(self._normalize_scale_case(x))
                if len(items) < page_size:
                    break
                start += page_size
        return all_cases, True

    async def _fallback_scale_folder_filter(
        self, project_key: str, folder_id: str
    ) -> Optional[list[dict[str, Any]]]:
        """Fallback for problematic folder-query strings: load project cases and
        filter by exact folder path locally.

        TM4J sometimes rejects ``folder = "..."`` queries for specific folder
        names containing edge characters. In those cases we avoid surfacing a
        hard error and return the same result via full-project fetch + in-memory
        filtering. Returns ``None`` only when TM4J itself seems unavailable.
        """
        try:
            all_cases = await self._fetch_all_scale_cases(project_key, force_refresh=True)
        except Exception:
            all_cases = []

        normalized = folder_id.rstrip('/')
        if all_cases:
            return [
                c for c in all_cases
                if str(c.get('folder') or '').rstrip('/') == normalized
            ]

        # Distinguish "empty project" from "TM4J unavailable".
        try:
            if await self._scale_available(project_key):
                return []
        except Exception:
            pass
        return None

    async def _scale_available(self, project_key: str) -> bool:
        """Cheap 1-item probe to see if the TM4J search endpoint answers 200."""
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/atm/1.0/testcase/search',
                    params={'query': f'projectKey = "{project_key}"', 'fields': 'key', 'maxResults': 1},
                    headers=self.headers,
                )
                return resp.status_code == 200
            except Exception:
                return False

    def _normalize_scale_case(self, item: dict[str, Any]) -> dict[str, Any]:
        script = item.get('testScript') or {}
        raw_steps: list[dict[str, Any]] = []
        if isinstance(script, dict):
            raw_steps = script.get('steps') or []
        elif isinstance(script, list):
            raw_steps = script
        steps: list[dict[str, str]] = []
        for idx, s in enumerate(raw_steps, 1):
            if not isinstance(s, dict):
                continue
            steps.append({
                "index": idx,
                "description": str(s.get('description') or s.get('step') or '').strip(),
                "test_data": str(s.get('testData') or s.get('data') or '').strip(),
                "expected_result": str(s.get('expectedResult') or s.get('result') or '').strip(),
            })
        return {
            "key": str(item.get('key') or ''),
            "name": str(item.get('name') or item.get('summary') or ''),
            "status": str(item.get('status') or ''),
            "priority": str(item.get('priority') or ''),
            "folder": str(item.get('folder') or ''),
            "precondition": str(item.get('precondition') or '').strip(),
            "objective": str(item.get('objective') or '').strip(),
            "steps": steps,
            "source": "scale",
        }

    async def _try_squad_test_cases(
        self, project_key: str, folder_id: Optional[str]
    ) -> list[dict[str, Any]]:
        """Zephyr Squad Server/DC — resolve executions inside a cycle, then read the
        underlying Jira test issue for name/description/steps."""
        project_id = await self._get_project_id(project_key)
        if not project_id:
            return []

        # The folder_id passed by the UI is either a real Squad folderId or a
        # cycle id (when Scale folders are absent we surface cycles as folders).
        # We treat the id first as a cycleId; if that yields nothing, as a folderId.
        exec_params: dict[str, str] = {"projectId": str(project_id)}
        if folder_id:
            exec_params["cycleId"] = folder_id

        issues: list[str] = []
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            for url_path in ('/rest/zapi/latest/execution', '/rest/zephyr/latest/execution'):
                try:
                    resp = await client.get(
                        f'{self.base_url}{url_path}',
                        params=exec_params,
                        headers=self.headers,
                    )
                    if resp.status_code != 200:
                        continue
                    payload = resp.json()
                    executions = payload.get('executions') if isinstance(payload, dict) else []
                    if isinstance(executions, list):
                        for ex in executions:
                            key = ex.get('issueKey') or ex.get('key')
                            if key:
                                issues.append(str(key))
                        if issues:
                            break
                except Exception:
                    continue

        # Deduplicate while preserving order.
        seen: set[str] = set()
        unique = [k for k in issues if not (k in seen or seen.add(k))]

        cases: list[dict[str, Any]] = []
        for key in unique[:200]:  # hard cap to avoid runaway
            detail = await self._fetch_squad_case_detail(key)
            if detail:
                cases.append(detail)
        return cases

    async def _fetch_squad_case_detail(self, issue_key: str) -> Optional[dict[str, Any]]:
        """Fetch a single Jira test issue's summary/description/steps."""
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(
                    f'{self.base_url}/rest/api/2/issue/{issue_key}',
                    params={'fields': 'summary,description,priority,status,components,labels'},
                    headers=self.headers,
                )
                if resp.status_code != 200:
                    return None
                data = resp.json()
                fields = data.get('fields', {}) or {}
                summary = str(fields.get('summary') or '')
                description = str(fields.get('description') or '').strip()
                priority = str((fields.get('priority') or {}).get('name') or '')
                jira_status = str((fields.get('status') or {}).get('name') or '')
            except Exception:
                return None

            # Squad exposes its steps via a separate endpoint; the issue id is
            # required (not the key).
            issue_id = str(data.get('id') or '')
            steps: list[dict[str, str]] = []
            if issue_id:
                try:
                    step_resp = await client.get(
                        f'{self.base_url}/rest/zapi/latest/teststep/{issue_id}',
                        headers=self.headers,
                    )
                    if step_resp.status_code == 200:
                        step_payload = step_resp.json()
                        step_beans = step_payload.get('stepBeanCollection') if isinstance(step_payload, dict) else None
                        raw_steps = step_beans if isinstance(step_beans, list) else []
                        for idx, s in enumerate(raw_steps, 1):
                            if not isinstance(s, dict):
                                continue
                            steps.append({
                                "index": idx,
                                "description": str(s.get('step') or s.get('htmlStep') or '').strip(),
                                "test_data": str(s.get('data') or s.get('htmlData') or '').strip(),
                                "expected_result": str(s.get('result') or s.get('htmlResult') or '').strip(),
                            })
                except Exception:
                    pass

        return {
            "key": issue_key,
            "name": summary,
            "status": jira_status,
            "priority": priority,
            "folder": "",
            "precondition": "",
            "objective": description,
            "steps": steps,
            "source": "squad",
        }

    async def _try_squad_cloud_test_cases(
        self, project_key: str, folder_id: Optional[str]
    ) -> list[dict[str, Any]]:
        """Zephyr Squad Cloud — /public/rest/api/1.0/testcases with paging."""
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                params: dict[str, str] = {"projectKey": project_key, "maxResults": "200"}
                if folder_id:
                    params["folderId"] = folder_id
                resp = await client.get(
                    f'{self.base_url}/public/rest/api/1.0/testcases',
                    params=params,
                    headers=self.headers,
                )
                if resp.status_code != 200:
                    return []
                data = resp.json()
                items = data if isinstance(data, list) else data.get('values', data.get('testcases', []))
                cases: list[dict[str, Any]] = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    raw_steps = (
                        item.get('testScript', {}).get('steps', [])
                        if isinstance(item.get('testScript'), dict) else []
                    )
                    steps: list[dict[str, str]] = []
                    for idx, s in enumerate(raw_steps, 1):
                        if not isinstance(s, dict):
                            continue
                        steps.append({
                            "index": idx,
                            "description": str(s.get('description') or '').strip(),
                            "test_data": str(s.get('testData') or '').strip(),
                            "expected_result": str(s.get('expectedResult') or '').strip(),
                        })
                    cases.append({
                        "key": str(item.get('key') or item.get('id') or ''),
                        "name": str(item.get('name') or ''),
                        "status": str(item.get('status') or ''),
                        "priority": str(item.get('priority') or ''),
                        "folder": str(item.get('folder') or ''),
                        "precondition": str(item.get('precondition') or ''),
                        "objective": str(item.get('objective') or ''),
                        "steps": steps,
                        "source": "squad-cloud",
                    })
                return cases
            except Exception:
                return []
