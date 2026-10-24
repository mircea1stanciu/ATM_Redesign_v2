"""The GitHub pull request API, with the signed-in user's token for the project."""
import re
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from app.modules.projects.service import github_headers, github_repository_context

TIMEOUT_SECONDS = 20
MAX_FILES = 300
# Tests replace this with httpx.MockTransport so no request leaves the process.
HTTP_TRANSPORT: Optional[httpx.AsyncBaseTransport] = None
HUNK = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


@dataclass
class Repo:
    api_base: str
    owner: str
    name: str
    token: str

    @property
    def base(self) -> str:
        return f"{self.api_base}/repos/{self.owner}/{self.name}"


def repo_for(project: Any, user: Any) -> Repo:
    if not (project.github_repo_url or "").strip():
        raise HTTPException(status_code=400, detail="This project has no GitHub repository.")
    owner, name, api_base, token = github_repository_context(project, user, project.id)
    return Repo(api_base, owner, name, token)


def _error(response: httpx.Response) -> HTTPException:
    try:
        data = response.json()
        message = str(data.get("message") or "")
        details = [str(e.get("message") or e) for e in data.get("errors") or [] if e]
        message = message + (f": {'; '.join(details)}" if details else "")
    except ValueError:
        message = response.text[:300]
    if response.status_code == 401:
        return HTTPException(status_code=400, detail="GitHub refused your token for this project. Update it in "
                                                     "Settings › Connections.")
    if response.status_code == 403:
        return HTTPException(status_code=400, detail=f"Your GitHub account may not do this: {message}")
    if response.status_code == 404:
        return HTTPException(status_code=404, detail="Not found on GitHub (or your token cannot see it).")
    if response.status_code == 422:
        return HTTPException(status_code=400, detail=f"GitHub did not accept it: {message}")
    return HTTPException(status_code=502, detail=f"GitHub answered {response.status_code}: {message}")


async def call(repo: Repo, method: str, path: str, *, params: Optional[dict] = None,
               json: Optional[dict] = None, root: bool = False) -> Any:
    """One request; ``path`` is relative to the repository (or to the API when ``root``)."""
    url = f"{repo.api_base}{path}" if root else f"{repo.base}{path}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=HTTP_TRANSPORT) as client:
            response = await client.request(method, url, params=params, json=json,
                                            headers=github_headers(repo.token))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {exc.__class__.__name__}.") from exc
    if response.status_code >= 400:
        raise _error(response)
    return response.json() if response.content else None


async def pages(repo: Repo, path: str, limit: int = MAX_FILES) -> list:
    """A list endpoint, page by page (100 per page), up to ``limit`` items."""
    items: list = []
    page = 1
    while len(items) < limit:
        batch = await call(repo, "GET", path, params={"per_page": 100, "page": page})
        items.extend(batch or [])
        if not batch or len(batch) < 100:
            break
        page += 1
    return items[:limit]


def commentable_lines(patch: Optional[str]) -> set[tuple[str, int]]:
    """The (side, line) pairs GitHub accepts review comments on: lines shown in the diff's hunks."""
    lines: set[tuple[str, int]] = set()
    old = new = 0
    for text in (patch or "").splitlines():
        hunk = HUNK.match(text)
        if hunk:
            old, new = int(hunk.group(1)), int(hunk.group(2))
            continue
        if text.startswith("\\"):  # "\ No newline at end of file"
            continue
        if text.startswith("+"):
            lines.add(("RIGHT", new))
            new += 1
        elif text.startswith("-"):
            lines.add(("LEFT", old))
            old += 1
        else:
            lines.add(("RIGHT", new))
            lines.add(("LEFT", old))
            old += 1
            new += 1
    return lines


def numbered_patch(patch: Optional[str]) -> str:
    """The patch with the new file's line number in front of each kept or added line (for the AI)."""
    out = []
    new = 0
    for text in (patch or "").splitlines():
        hunk = HUNK.match(text)
        if hunk:
            new = int(hunk.group(2))
            out.append(text)
        elif text.startswith("-"):
            out.append(f"     {text}")
        elif text.startswith("\\"):
            continue
        else:
            out.append(f"{new:>4} {text}")
            new += 1
    return "\n".join(out)
