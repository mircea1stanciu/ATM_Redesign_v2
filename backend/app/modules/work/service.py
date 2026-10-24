"""Work: the Jira and Confluence inbox, work items, "start work" and traceability."""
import os
import re
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.modules.work.integrations import (
    ConfluenceClient,
    Connection,
    IntegrationError,
    JiraAgileClient,
    JiraClient,
    confluence_space_key,
    jira_project_key,
)
from app.modules.work.models import TraceLink, WorkItem

PAGE_SIZE = 25
CONTEXT_CHARS = 8000
ISSUE_KEY = re.compile(r"^[A-Z][A-Z0-9_]+-\d+$")
INBOX_FIELDS = "summary,status,issuetype,assignee,labels,updated,priority"


# ── Jira ──────────────────────────────────────────────────────────────────────


def kind_of(issue_type: str) -> str:
    name = (issue_type or "").lower()
    if "tech" in name:
        return "technical_story"
    if "story" in name:
        return "user_story"
    return "other"


def _quote(value: str) -> str:
    """A JQL/CQL string literal."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


ORDER_BY = re.compile(r"\s+order\s+by\s+.*$", re.IGNORECASE | re.DOTALL)


def split_values(value: str) -> list[str]:
    """A filter that may hold several values, comma separated in the URL ("Story,Bug")."""
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def build_jql(project_key: str, *, story_types: list[str], q: str = "", types: Optional[list[str]] = None,
              statuses: Optional[list[str]] = None, assignee: str = "", sprint: str = "",
              labels: Optional[list[str]] = None, jql: str = "") -> str:
    """The inbox query (phase 16): every issue type unless types are chosen ("stories" = the project's story types),
    several statuses and labels, a sprint (the current one or a sprint id), and an optional advanced JQL clause."""
    clauses = [f"project = {_quote(project_key)}"]
    wanted: list[str] = []
    for name in types or []:
        if name == "stories":
            wanted.extend(story_types)
        elif name != "all":
            wanted.append(name)
    if wanted:
        clauses.append("issuetype in (" + ", ".join(_quote(t) for t in dict.fromkeys(wanted)) + ")")
    if statuses:
        clauses.append("status in (" + ", ".join(_quote(s) for s in statuses) + ")")
    if assignee == "me":
        clauses.append("assignee = currentUser()")
    elif assignee == "unassigned":
        clauses.append("assignee is EMPTY")
    if sprint == "current":
        clauses.append("sprint in openSprints()")
    elif sprint.isdigit():
        clauses.append(f"sprint = {int(sprint)}")
    if labels:
        clauses.append("labels in (" + ", ".join(_quote(label) for label in labels) + ")")
    text = q.strip()
    if text:
        clauses.append(f"key = {_quote(text.upper())}" if ISSUE_KEY.match(text.upper()) else f"text ~ {_quote(text)}")
    advanced = ORDER_BY.sub("", (jql or "").strip())
    if advanced:
        clauses.append(f"({advanced})")
    return " AND ".join(clauses) + " ORDER BY updated DESC"


def _person(value: Optional[dict]) -> Optional[str]:
    return (value or {}).get("displayName") if value else None


async def jira_filters(connection: Connection, project: Any) -> dict:
    """Issue types and statuses of the project, for the inbox filters."""
    key = jira_project_key(project, connection)
    client = JiraClient(connection)
    meta = await client.request("GET", f"/project/{key}")
    types = [t.get("name") for t in (meta or {}).get("issueTypes") or [] if not t.get("subtask")]
    statuses: list[str] = []
    try:
        for entry in await client.request("GET", f"/project/{key}/statuses") or []:
            for item in entry.get("statuses") or []:
                if item.get("name") and item["name"] not in statuses:
                    statuses.append(item["name"])
    except IntegrationError:
        pass  # Older servers: the status filter stays free text.
    return {
        "project_key": key,
        "issue_types": [t for t in types if t],
        "story_types": [t for t in types if t and kind_of(t) != "other"],
        "statuses": statuses,
    }


async def jira_inbox(db: Session, connection: Connection, project: Any, *, cursor: int = 0, q: str = "",
                     issue_type: str = "", status: str = "", assignee: str = "", sprint: str = "", label: str = "",
                     jql: str = "") -> dict:
    meta = await jira_filters(connection, project)
    jql = build_jql(meta["project_key"], story_types=meta["story_types"], q=q, types=split_values(issue_type),
                    statuses=split_values(status), assignee=assignee, sprint=sprint, labels=split_values(label),
                    jql=jql)
    data = await JiraClient(connection).request(
        "GET", "/search", params={"jql": jql, "startAt": cursor, "maxResults": PAGE_SIZE, "fields": INBOX_FIELDS})
    issues = (data or {}).get("issues") or []
    items = {i.external_key: i for i in db.query(WorkItem).filter(
        WorkItem.project_id == project.id, WorkItem.source == "jira",
        WorkItem.external_key.in_([issue.get("key") for issue in issues])).all()}
    total = int((data or {}).get("total") or 0)
    next_cursor = cursor + len(issues)
    return {
        "items": [_inbox_issue(connection, issue, items.get(issue.get("key"))) for issue in issues],
        "total": total,
        "next_cursor": next_cursor if next_cursor < total and issues else None,
    }


SPRINT_ORDER = {"active": 0, "future": 1, "closed": 2}
CLOSED_SPRINTS_SHOWN = 5


async def jira_sprints(connection: Connection, project: Any) -> list[dict]:
    """The sprints of the project's boards (Jira Software): active, future, and the last closed ones."""
    key = jira_project_key(project, connection)
    client = JiraAgileClient(connection)
    try:
        boards = (await client.request("GET", "/board", params={"projectKeyOrId": key, "maxResults": 5}) or {})
    except IntegrationError as exc:
        if exc.status_code == 404:
            return []  # no Jira Software: no boards, no sprints
        raise
    sprints: dict[int, dict] = {}
    for board in (boards.get("values") or [])[:3]:
        data = await client.request("GET", f"/board/{board['id']}/sprint",
                                    params={"state": "active,future,closed", "maxResults": 50}) or {}
        for sprint in data.get("values") or []:
            sprints.setdefault(sprint["id"], {
                "id": sprint["id"], "name": sprint.get("name") or f"Sprint {sprint['id']}",
                "state": sprint.get("state") or "future", "start_date": sprint.get("startDate"),
                "end_date": sprint.get("endDate"), "board": board.get("name")})
    ordered = sorted(sprints.values(), key=lambda s: (SPRINT_ORDER.get(s["state"], 3), s["start_date"] or ""))
    closed = [s for s in ordered if s["state"] == "closed"][-CLOSED_SPRINTS_SHOWN:][::-1]
    return [s for s in ordered if s["state"] != "closed"] + closed


def _issue_url(connection: Connection, key: str) -> str:
    return f"{connection.base_url}/browse/{key}"


def _inbox_issue(connection: Connection, issue: dict, item: Optional[WorkItem]) -> dict:
    fields = issue.get("fields") or {}
    issue_type = (fields.get("issuetype") or {}).get("name") or ""
    return {
        "key": issue.get("key"),
        "title": fields.get("summary") or "",
        "status": (fields.get("status") or {}).get("name"),
        "issue_type": issue_type,
        "kind": kind_of(issue_type),
        "assignee": _person(fields.get("assignee")),
        "labels": fields.get("labels") or [],
        "priority": (fields.get("priority") or {}).get("name"),
        "updated": fields.get("updated"),
        "url": _issue_url(connection, issue.get("key") or ""),
        "work_item": serialize_item(item, brief=True) if item else None,
    }


def _acceptance_criteria_field(names: dict) -> Optional[str]:
    for field_id, name in (names or {}).items():
        if "acceptance criteria" in str(name).lower():
            return field_id
    return None


def _plain(value: Any) -> str:
    """Text of a Jira field: wiki/plain strings as they are, Atlassian document format reduced to its text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if value.get("type") == "text":
            return str(value.get("text") or "")
        parts = [_plain(child) for child in value.get("content") or []]
        separator = "\n" if value.get("type") in ("doc", "bulletList", "orderedList") else ""
        return separator.join(parts) + ("\n" if value.get("type") in ("paragraph", "heading", "listItem") else "")
    if isinstance(value, list):
        return "\n".join(_plain(v) for v in value)
    return str(value)


async def jira_issue(db: Session, connection: Connection, project: Any, key: str) -> dict:
    """The detail panel: description, acceptance criteria, links, attachments and comments (HTML as Jira renders it;
    the browser sanitises it before showing it)."""
    key = key.strip().upper()
    if not ISSUE_KEY.match(key):
        raise IntegrationError(400, f"'{key}' is not a Jira issue key.")
    expected = jira_project_key(project, connection)
    if not key.startswith(f"{expected.upper()}-"):
        raise IntegrationError(404, f"{key} is not in this project's Jira project ({expected}).")
    data = await JiraClient(connection).request(
        "GET", f"/issue/{key}", params={"expand": "renderedFields,names", "fields": "*all"})
    fields = data.get("fields") or {}
    rendered = data.get("renderedFields") or {}
    ac_field = _acceptance_criteria_field(data.get("names") or {})
    issue_type = (fields.get("issuetype") or {}).get("name") or ""
    comments = (fields.get("comment") or {}).get("comments") or []
    rendered_comments = (rendered.get("comment") or {}).get("comments") or []
    item = db.query(WorkItem).filter(WorkItem.project_id == project.id, WorkItem.source == "jira",
                                     WorkItem.external_key == key).first()
    return {
        "key": key,
        "title": fields.get("summary") or "",
        "status": (fields.get("status") or {}).get("name"),
        "issue_type": issue_type,
        "kind": kind_of(issue_type),
        "assignee": _person(fields.get("assignee")),
        "reporter": _person(fields.get("reporter")),
        "priority": (fields.get("priority") or {}).get("name"),
        "labels": fields.get("labels") or [],
        "url": _issue_url(connection, key),
        "description_html": rendered.get("description") or "",
        "description_text": _plain(fields.get("description")),
        "acceptance_criteria_html": (rendered.get(ac_field) or "") if ac_field else "",
        "acceptance_criteria_text": _plain(fields.get(ac_field)) if ac_field else "",
        "links": [_issue_link(link) for link in fields.get("issuelinks") or []],
        "attachments": [
            {"name": a.get("filename"), "size": a.get("size"), "mime_type": a.get("mimeType")}
            for a in fields.get("attachment") or []
        ],
        "comments": [
            {
                "author": _person(comment.get("author")),
                "created": comment.get("created"),
                "body_html": (rendered_comments[i].get("body") if i < len(rendered_comments) else "") or "",
                "body_text": _plain(comment.get("body")),
            }
            for i, comment in enumerate(comments[-20:])
        ],
        "work_item": serialize_item(item) if item else None,
    }


def _issue_link(link: dict) -> dict:
    outward = link.get("outwardIssue")
    other = outward or link.get("inwardIssue") or {}
    relation = (link.get("type") or {}).get("outward" if outward else "inward") or ""
    other_fields = other.get("fields") or {}
    return {
        "relation": relation,
        "key": other.get("key"),
        "title": other_fields.get("summary") or "",
        "status": (other_fields.get("status") or {}).get("name"),
    }


# ── Confluence ────────────────────────────────────────────────────────────────


def _page_url(connection: Connection, page: dict) -> str:
    webui = (page.get("_links") or {}).get("webui") or ""
    base = connection.base_url
    if webui and not base.endswith("/wiki") and "/wiki/" not in webui and "atlassian.net" in base:
        base = f"{base}/wiki"
    return f"{base}{webui}" if webui else base


async def confluence_inbox(db: Session, connection: Connection, project: Any, *, q: str = "",
                           cursor: int = 0) -> dict:
    space = confluence_space_key(project, connection)
    cql = f"space = {_quote(space)} and type = page"
    if q.strip():
        cql += f" and (title ~ {_quote(q.strip())} or text ~ {_quote(q.strip())})"
    cql += " order by lastmodified desc"
    data = await ConfluenceClient(connection).request(
        "GET", "/content/search", params={"cql": cql, "start": cursor, "limit": PAGE_SIZE, "expand": "version"})
    pages = (data or {}).get("results") or []
    items = {i.external_key: i for i in db.query(WorkItem).filter(
        WorkItem.project_id == project.id, WorkItem.source == "confluence",
        WorkItem.external_key.in_([str(p.get("id")) for p in pages])).all()}
    size = int((data or {}).get("size") or len(pages))
    has_more = bool(((data or {}).get("_links") or {}).get("next")) or size >= PAGE_SIZE
    return {
        "items": [
            {
                "key": str(page.get("id")),
                "title": page.get("title") or "",
                "updated": (page.get("version") or {}).get("when"),
                "author": _person((page.get("version") or {}).get("by")),
                "kind": "requirement_page",
                "url": _page_url(connection, page),
                "work_item": serialize_item(items[str(page.get("id"))], brief=True)
                if str(page.get("id")) in items else None,
            }
            for page in pages
        ],
        "next_cursor": cursor + len(pages) if pages and has_more else None,
    }


async def confluence_page(db: Session, connection: Connection, project: Any, page_id: str) -> dict:
    if not page_id.isdigit():
        raise IntegrationError(400, "A Confluence page id is a number.")
    space = confluence_space_key(project, connection)
    page = await ConfluenceClient(connection).request(
        "GET", f"/content/{page_id}", params={"expand": "body.view,version,space"})
    if ((page.get("space") or {}).get("key") or space) != space:
        raise IntegrationError(404, f"Page {page_id} is not in this project's Confluence space ({space}).")
    item = db.query(WorkItem).filter(WorkItem.project_id == project.id, WorkItem.source == "confluence",
                                     WorkItem.external_key == page_id).first()
    body = ((page.get("body") or {}).get("view") or {}).get("value") or ""
    return {
        "key": page_id,
        "title": page.get("title") or "",
        "kind": "requirement_page",
        "url": _page_url(connection, page),
        "updated": (page.get("version") or {}).get("when"),
        "author": _person((page.get("version") or {}).get("by")),
        "body_html": body,
        "body_text": re.sub(r"<[^>]+>", " ", body),
        "work_item": serialize_item(item) if item else None,
    }


# ── Start work ────────────────────────────────────────────────────────────────


def branch_name(key: str, title: str) -> str:
    """feature/ABC-123-short-name: the key, then the first words of the title."""
    words = re.findall(r"[a-z0-9]+", title.lower())[:6]
    slug = "-".join(words)[:40].strip("-")
    return f"feature/{key}-{slug}" if slug else f"feature/{key}"


BRANCH_PATTERN = re.compile(r"^(?!/)(?!.*\.\.)(?!.*//)[A-Za-z0-9._/-]{1,200}(?<!/)(?<!\.lock)$")

TEST_DIRS = {"test", "tests", "e2e", "spec", "specs", "cypress", "playwright", "integration", "api-tests"}
TEST_SUFFIXES = (".bru", ".feature", ".robot")
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "target", "build", "dist", "__pycache__", ".idea", ".gradle"}
STOP_WORDS = {"the", "and", "for", "with", "that", "this", "from", "when", "should", "user", "users", "able",
              "into", "have", "will", "can", "story", "test", "tests"}
MAX_FILES_SCANNED = 5000


def _is_test_file(rel: str) -> bool:
    lower = rel.lower()
    name = lower.rsplit("/", 1)[-1]
    parts = set(lower.split("/")[:-1])
    return (name.endswith(TEST_SUFFIXES) or ".spec." in name or ".test." in name or name.startswith("test_")
            or name.endswith(("test.java", "tests.java", "test.kt", "_test.py", "_test.go")) or bool(parts & TEST_DIRS))


def suggest_test_files(repo: Optional[Path], key: str, title: str, limit: int = 8) -> list[dict]:
    """Test files whose path shares words with the story (and files that mention its key in the name)."""
    if repo is None or not repo.exists():
        return []
    words = {w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) >= 4 and w not in STOP_WORDS}
    scored: list[tuple[int, str]] = []
    scanned = 0
    for dirpath, dirnames, filenames in os.walk(repo):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for filename in filenames:
            scanned += 1
            if scanned > MAX_FILES_SCANNED:
                break
            rel = Path(dirpath, filename).relative_to(repo).as_posix()
            if not _is_test_file(rel):
                continue
            lower = rel.lower()
            score = sum(2 if w in lower.rsplit("/", 1)[-1] else 1 for w in words if w in lower)
            if key.lower() in lower:
                score += 5
            if score:
                scored.append((score, rel))
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [{"path": rel, "score": score} for score, rel in scored[:limit]]


def context_snapshot(detail: dict) -> dict:
    """What the AI assistant gets about the story; kept short."""
    text = "\n\n".join(part for part in (
        detail.get("description_text") or detail.get("body_text") or "",
        ("Acceptance criteria:\n" + detail["acceptance_criteria_text"]) if detail.get("acceptance_criteria_text")
        else "",
    ) if part.strip())
    return {
        "title": detail.get("title"),
        "type": detail.get("issue_type") or "Confluence page",
        "status": detail.get("status"),
        "url": detail.get("url"),
        "text": text[:CONTEXT_CHARS],
    }


def story_prompt(item: WorkItem) -> str:
    context = item.context_json or {}
    return (
        f"The user is working on {item.external_key}: {item.title} ({context.get('type') or item.kind}).\n"
        f"{context.get('text') or ''}".strip()
    )


def serialize_item(item: WorkItem, brief: bool = False, assignee_name: Optional[str] = None) -> dict:
    data: dict = {
        "id": item.id,
        "project_id": str(item.project_id),
        "source": item.source,
        "external_key": item.external_key,
        "kind": item.kind,
        "title": item.title,
        "url": item.url,
        "status": item.status,
        "assignee_id": str(item.assignee_id) if item.assignee_id else None,
        "assignee_name": assignee_name,
        "branch": item.branch,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }
    if brief:
        return data
    data["context"] = item.context_json or None
    data["links"] = [
        {"id": link.id, "target_type": link.target_type, "target_ref": link.target_ref, "label": link.label}
        for link in item.links
    ]
    return data


def add_link(db: Session, item: WorkItem, target_type: str, target_ref: str, label: Optional[str] = None) -> TraceLink:
    """Adds a trace link once; an existing link with the same target is returned unchanged."""
    existing = db.query(TraceLink).filter(TraceLink.work_item_id == item.id, TraceLink.target_type == target_type,
                                          TraceLink.target_ref == target_ref).first()
    if existing:
        return existing
    link = TraceLink(work_item_id=item.id, target_type=target_type, target_ref=target_ref, label=label)
    db.add(link)
    db.flush()
    return link


def link_pushed_files(db: Session, project_id: int, branch: str, paths: list[str]) -> int:
    """The test files a push changed trace to the work item of the branch; returns how many were linked."""
    item = db.query(WorkItem).filter(WorkItem.project_id == project_id, WorkItem.branch == branch).first()
    if not item:
        return 0
    before = len(item.links)
    for path in paths:
        if _is_test_file(path):
            add_link(db, item, "test_file", path)
    db.commit()
    db.refresh(item)
    return len(item.links) - before


def link_pull_request(db: Session, project_id: int, branch: str, url: str, title: str) -> Optional[WorkItem]:
    """A pull request opened from a work item's branch traces to the item and moves it to "in review"."""
    item = db.query(WorkItem).filter(WorkItem.project_id == project_id, WorkItem.branch == branch).first()
    if not item:
        return None
    add_link(db, item, "pull_request", url, title)
    if item.status in ("todo", "in_progress"):
        item.status = "in_review"
    db.commit()
    return item
