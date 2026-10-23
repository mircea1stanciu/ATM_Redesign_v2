"""Heuristic analyzer for Confluence release pages.

Given the raw Confluence storage-format HTML of a release page, this module
extracts:
  1. Release metadata — Release Date, Status, Team — kept separate from the
     per-service list.
  2. Backend (BE) service version mentions, read strictly from a table that
     has explicit "Microservice" and "Version" columns (plus any of the
     optional columns: Component, LIVE ENV Details, New service/operation
     (Yes/No), Developer, when present).
  3. Frontend (FE) Android/iOS build version mentions — technology + version
     + environment (when mentioned nearby).

Release pages don't follow one single strict format across teams, so this
is intentionally heuristic. Callers should treat results as "best effort"
and always provide a link back to the real Confluence page for manual
confirmation.
"""
from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

VERSION_RE = re.compile(r"\bv?(\d+\.\d+(?:\.\d+){0,2}(?:-[A-Za-z0-9]+)?)\b")

# Confluence's "jira" macro renders a live table of issues at view time, but
# the *storage* HTML (what the REST API returns) only ever contains the macro
# definition — notably its "jqlQuery" parameter — never the literal issue
# rows. To surface those tickets we must extract the JQL and run it ourselves
# against Jira.
_JIRA_MACRO_RE = re.compile(
    r'<ac:structured-macro\b[^>]*\bac:name="jira"[^>]*>(.*?)</ac:structured-macro>',
    re.IGNORECASE | re.DOTALL,
)
_JQL_PARAM_RE = re.compile(
    r'<ac:parameter\b[^>]*\bac:name="jqlQuery"[^>]*>(.*?)</ac:parameter>',
    re.IGNORECASE | re.DOTALL,
)

FE_HEADING_RE = re.compile(r"\b(fe|frontend)\b", re.IGNORECASE)

ANDROID_RE = re.compile(r"\bandroid\b", re.IGNORECASE)
IOS_RE = re.compile(r"\bi[o0]s\b", re.IGNORECASE)

ENV_KEYWORDS = [
    "production", "prod", "staging", "stage", "uat", "sit", "qa",
    "pre-prod", "preprod", "ppe", "dev", "development", "test",
]
ENV_RE = re.compile(r"\b(" + "|".join(re.escape(k) for k in ENV_KEYWORDS) + r")\b", re.IGNORECASE)

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


@dataclass
class BackendServiceVersion:
    service: str
    version: str
    component: str | None = None
    component_color: str | None = None
    live_env_details: str | None = None
    live_env_details_color: str | None = None
    new_service_or_operation: str | None = None
    new_service_or_operation_color: str | None = None
    developer: str | None = None
    developer_color: str | None = None
    context: str = ""


@dataclass
class FrontendPlatformVersion:
    platform: str
    version: str
    environment: str | None
    context: str = ""


@dataclass
class ReleaseMetadata:
    release_date: str | None = None
    status: str | None = None
    team: str | None = None
    context: str = ""


@dataclass
class _Block:
    type: str  # "heading" | "text" | "table"
    level: int = 0
    text: str = ""
    rows: list = field(default_factory=list)


@dataclass
class _Cell:
    text: str = ""
    status_colour: str | None = None


class _ConfluenceBlockParser(HTMLParser):
    """Extracts a flat, ordered list of heading/text/table blocks."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[_Block] = []
        self._heading_level: int | None = None
        self._text_parts: list[str] | None = None
        self._table_rows: list[list[_Cell]] | None = None
        self._current_row: list[_Cell] | None = None
        self._cell_parts: list[str] | None = None
        self._cell_status_colours: list[str] | None = None
        self._table_depth = 0
        # ac:parameter elements carry macro configuration (e.g. "colour" for
        # a status lozenge), not visible prose — only the "title" parameter
        # (the lozenge's visible label) should contribute text.
        self._param_suppress_stack: list[bool] = []
        self._suppress_count = 0
        # Track status macro parameters so we can preserve the UI color token.
        self._macro_stack: list[dict[str, str] | None] = []
        self._macro_param_name_stack: list[str | None] = []
        self._macro_param_in_status_stack: list[bool] = []

    def _append_paragraph_break(self) -> None:
        if self._cell_parts is not None:
            if self._cell_parts and not self._cell_parts[-1].endswith((" ", "\n")):
                self._cell_parts.append(" ")
        elif self._text_parts is not None:
            if self._text_parts and not self._text_parts[-1].endswith((" ", "\n")):
                self._text_parts.append(" ")

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag in HEADING_TAGS:
            self._heading_level = int(tag[1])
            self._text_parts = []
        elif tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._table_rows = []
        elif tag == "tr" and self._table_rows is not None:
            self._current_row = []
        elif tag in ("td", "th") and self._current_row is not None:
            self._cell_parts = []
            self._cell_status_colours = []
        elif tag == "p":
            if self._table_rows is None and self._heading_level is None:
                if self._text_parts is None:
                    self._text_parts = []
                else:
                    self._append_paragraph_break()
            else:
                self._append_paragraph_break()
        elif tag in ("br", "li"):
            if self._cell_parts is not None:
                self._cell_parts.append("\n")
            elif self._text_parts is not None:
                self._text_parts.append("\n")
        elif tag == "ac:structured-macro":
            attr_dict = dict(attrs)
            macro_name = str(attr_dict.get("ac:name", "") or "").strip().lower()
            if macro_name == "status":
                self._macro_stack.append({"title": "", "colour": ""})
            else:
                self._macro_stack.append(None)
        elif tag == "ac:parameter":
            attr_dict = dict(attrs)
            param_name = str(attr_dict.get("ac:name", "") or "")
            in_status_macro = bool(self._macro_stack and self._macro_stack[-1] is not None)

            if in_status_macro:
                # Status params are emitted manually when the macro closes.
                suppressed = True
                self._macro_param_name_stack.append(param_name)
                self._macro_param_in_status_stack.append(True)
            else:
                suppressed = param_name != "title"
                self._macro_param_name_stack.append(None)
                self._macro_param_in_status_stack.append(False)

            self._param_suppress_stack.append(suppressed)
            if suppressed:
                self._suppress_count += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in HEADING_TAGS:
            text = "".join(self._text_parts or []).strip()
            if text:
                self.blocks.append(_Block(type="heading", level=self._heading_level or 1, text=text))
            self._heading_level = None
            self._text_parts = None
        elif tag == "table":
            if self._table_depth == 1 and self._table_rows is not None:
                self.blocks.append(_Block(type="table", rows=self._table_rows))
            self._table_depth = max(0, self._table_depth - 1)
            if self._table_depth == 0:
                self._table_rows = None
        elif tag == "tr":
            if self._table_rows is not None and self._current_row is not None:
                self._table_rows.append(self._current_row)
            self._current_row = None
        elif tag in ("td", "th"):
            if self._current_row is not None:
                text = re.sub(r"[ \t]+", " ", "".join(self._cell_parts or [])).strip()
                status_colour = (self._cell_status_colours or [None])[0]
                self._current_row.append(_Cell(text=text, status_colour=status_colour))
            self._cell_parts = None
            self._cell_status_colours = None
        elif tag == "p":
            if self._table_rows is None and self._text_parts is not None:
                text = "".join(self._text_parts).strip()
                if text:
                    self.blocks.append(_Block(type="text", text=text))
                self._text_parts = None
        elif tag == "ac:parameter":
            if self._macro_param_name_stack:
                self._macro_param_name_stack.pop()
            if self._macro_param_in_status_stack:
                self._macro_param_in_status_stack.pop()
            if self._param_suppress_stack:
                was_suppressed = self._param_suppress_stack.pop()
                if was_suppressed and self._suppress_count > 0:
                    self._suppress_count -= 1
        elif tag == "ac:structured-macro":
            macro_data = self._macro_stack.pop() if self._macro_stack else None
            if macro_data is not None:
                title = re.sub(r"\s+", " ", macro_data.get("title", "")).strip()
                colour = re.sub(r"\s+", " ", macro_data.get("colour", "")).strip().lower()

                if title:
                    if self._cell_parts is not None:
                        if self._cell_parts and not self._cell_parts[-1].endswith((" ", "\n")):
                            self._cell_parts.append(" ")
                        self._cell_parts.append(title)
                    elif self._text_parts is not None:
                        if self._text_parts and not self._text_parts[-1].endswith((" ", "\n")):
                            self._text_parts.append(" ")
                        self._text_parts.append(title)

                if colour and self._cell_status_colours is not None:
                    self._cell_status_colours.append(colour)

    def handle_data(self, data: str) -> None:
        if self._macro_param_in_status_stack and self._macro_param_in_status_stack[-1]:
            current_macro = self._macro_stack[-1] if self._macro_stack else None
            param_name = self._macro_param_name_stack[-1] if self._macro_param_name_stack else None
            if current_macro is not None and param_name:
                normalized = param_name.strip().lower()
                if normalized == "title":
                    current_macro["title"] = current_macro.get("title", "") + data
                elif normalized in ("colour", "color"):
                    current_macro["colour"] = current_macro.get("colour", "") + data
        if self._suppress_count > 0:
            return
        if self._cell_parts is not None:
            self._cell_parts.append(data)
        elif self._text_parts is not None:
            self._text_parts.append(data)


def _parse_blocks(html: str) -> list[_Block]:
    parser = _ConfluenceBlockParser()
    try:
        parser.feed(html or "")
    except Exception:
        pass
    return parser.blocks


def _section_blocks(blocks: list[_Block], heading_re: re.Pattern) -> list[_Block]:
    """Return blocks belonging to the first heading section matching heading_re.

    A section ends at the next heading whose level is <= the matching heading's level.
    """
    start_idx = None
    start_level = None
    for idx, block in enumerate(blocks):
        if block.type == "heading" and heading_re.search(block.text):
            start_idx = idx
            start_level = block.level
            break

    if start_idx is None:
        return []

    section: list[_Block] = []
    for block in blocks[start_idx + 1:]:
        if block.type == "heading" and block.level <= (start_level or 1):
            break
        section.append(block)
    return section


def _find_column(header: list[str], keywords: list[str]) -> int | None:
    for idx, cell in enumerate(header):
        lowered = cell.lower()
        if any(kw in lowered for kw in keywords):
            return idx
    return None


def _cell_text(cell: object) -> str:
    if isinstance(cell, _Cell):
        return cell.text or ""
    return str(cell or "")


def _cell_colour(cell: object) -> str | None:
    if isinstance(cell, _Cell):
        colour = (cell.status_colour or "").strip()
        return colour or None
    return None


def _find_header_row_index(rows: list[list[object]], required_keyword_sets: list[list[str]]) -> int | None:
    """Find the row that acts as the real column-header row.

    Release page tables often have a decorative "banner" row first (e.g. a
    single merged/colspan title like "BACKEND OPERATIONS AND SETTINGS")
    before the actual column-name row. So instead of assuming the header is
    always rows[0], scan every row and pick the first one where each
    required keyword set has at least one matching cell.
    """
    for idx, row in enumerate(rows):
        lowered = [_cell_text(c).lower() for c in row]
        if all(_find_column(lowered, keywords) is not None for keywords in required_keyword_sets):
            return idx
    return None


def _extract_backend_versions(blocks: list[_Block]) -> list[BackendServiceVersion]:
    """Extract BE service/version rows strictly from tables that have
    explicit "Microservice" and "Version" columns.

    Only rows from such a table are used — no freeform text/paragraph
    guessing — so results only ever reflect what's actually named in the
    page's own tables (no invented/example entries).
    """
    results: list[BackendServiceVersion] = []
    seen: set[tuple[str, str]] = set()

    for block in blocks:
        if block.type != "table" or not block.rows:
            continue

        rows = block.rows
        header_idx = _find_header_row_index(rows, [["microservice"], ["version"]])

        # This table isn't the BE service/version table — skip it entirely.
        if header_idx is None:
            continue

        header = [_cell_text(c).lower() for c in rows[header_idx]]
        microservice_col = _find_column(header, ["microservice"])
        version_col = _find_column(header, ["version"])
        component_col = _find_column(header, ["component"])
        live_env_col = _find_column(header, ["live env", "live environment", "env details"])
        new_service_col = _find_column(header, ["new service", "operation"])
        developer_col = _find_column(header, ["developer"])

        def cell(row: list[object], col: int | None) -> str | None:
            if col is None or col >= len(row):
                return None
            value = _cell_text(row[col]).strip()
            return value or None

        def cell_colour(row: list[object], col: int | None) -> str | None:
            if col is None or col >= len(row):
                return None
            return _cell_colour(row[col])

        for row in rows[header_idx + 1:]:
            if not row or all(not _cell_text(c).strip() for c in row):
                continue

            service_name = cell(row, microservice_col)
            if not service_name:
                continue

            # Use the literal cell text as version — it's read straight from
            # the page's own "Version" column, so it always matches what's
            # actually written there (no invented/normalized values).
            version = cell(row, version_col)
            if not version:
                continue

            key = (service_name.lower(), version.lower())
            if key in seen:
                continue
            seen.add(key)

            results.append(BackendServiceVersion(
                service=service_name,
                version=version,
                component=cell(row, component_col),
                component_color=cell_colour(row, component_col),
                live_env_details=cell(row, live_env_col),
                live_env_details_color=cell_colour(row, live_env_col),
                new_service_or_operation=cell(row, new_service_col),
                new_service_or_operation_color=cell_colour(row, new_service_col),
                developer=cell(row, developer_col),
                developer_color=cell_colour(row, developer_col),
                context=" | ".join(_cell_text(c) for c in row),
            ))

    return results[:60]


def _extract_release_metadata(blocks: list[_Block]) -> ReleaseMetadata | None:
    """Extract Release Date / Status / Team, kept separate from the BE list.

    Tries a horizontal table layout first (header row with those column
    names), then falls back to vertical key/value rows (label in the first
    cell, value in the second) scattered across any table on the page.
    """
    # Strategy 1: horizontal header row with explicit columns. Require all
    # three keywords on the SAME row so a vertical (label | value) table —
    # where "Release Date" only appears alone as a row label — never gets
    # mistaken for this layout.
    for block in blocks:
        if block.type != "table" or not block.rows:
            continue
        rows = block.rows
        header_idx = _find_header_row_index(rows, [["release date"], ["status"], ["team"]])
        if header_idx is None:
            continue

        header = [_cell_text(c).lower() for c in rows[header_idx]]
        release_date_col = _find_column(header, ["release date"])
        status_col = _find_column(header, ["status"])
        team_col = _find_column(header, ["team"])

        for row in rows[header_idx + 1:]:
            if not row or all(not _cell_text(c).strip() for c in row):
                continue

            def cell(col: int | None) -> str | None:
                if col is None or col >= len(row):
                    return None
                value = _cell_text(row[col]).strip()
                return value or None

            release_date = cell(release_date_col)
            if not release_date:
                continue
            return ReleaseMetadata(
                release_date=release_date,
                status=cell(status_col),
                team=cell(team_col),
                context=" | ".join(_cell_text(c) for c in row),
            )

    # Strategy 2: vertical key/value rows (label | value), possibly spread
    # across different rows/tables.
    metadata = ReleaseMetadata()
    found_any = False
    for block in blocks:
        if block.type != "table" or not block.rows:
            continue
        for row in block.rows:
            if len(row) < 2:
                continue
            label = _cell_text(row[0]).strip().lower()
            value = _cell_text(row[1]).strip()
            if not value:
                continue
            if "release date" in label and not metadata.release_date:
                metadata.release_date = value
                found_any = True
            elif (label == "status" or label.startswith("status")) and not metadata.status:
                metadata.status = value
                found_any = True
            elif (label == "team" or label.startswith("team")) and not metadata.team:
                metadata.team = value
                found_any = True

    return metadata if found_any else None


def _extract_frontend_versions(section: list[_Block]) -> list[FrontendPlatformVersion]:
    results: list[FrontendPlatformVersion] = []
    seen: set[tuple[str, str, str | None]] = set()

    def platform_label(text: str) -> str | None:
        if ANDROID_RE.search(text):
            return "Android"
        if IOS_RE.search(text):
            return "iOS"
        return None

    for block in section:
        if block.type == "table" and block.rows:
            rows = block.rows
            header_idx = _find_header_row_index(rows, [["platform"], ["version", "build"]])
            if header_idx is None:
                continue

            header = [_cell_text(c).lower() for c in rows[header_idx]]
            platform_col = _find_column(header, ["platform", "technology", "app", "os"])
            version_col = _find_column(header, ["version", "build", "release", "tag"])
            env_col = _find_column(header, ["environment", "env", "stage"])
            data_rows = rows[header_idx + 1:]

            for row in data_rows:
                if not row or all(not _cell_text(c).strip() for c in row):
                    continue
                row_text = " | ".join(_cell_text(c) for c in row)
                platform = None
                if platform_col is not None and platform_col < len(row):
                    platform_source = _cell_text(row[platform_col])
                    platform = platform_label(platform_source) or platform_source.strip() or None
                if not platform:
                    platform = platform_label(row_text)
                if not platform:
                    continue

                version_match = None
                if version_col is not None and version_col < len(row):
                    version_match = VERSION_RE.search(_cell_text(row[version_col]))
                if not version_match:
                    version_match = VERSION_RE.search(row_text)
                if not version_match:
                    continue

                environment = None
                if env_col is not None and env_col < len(row):
                    environment = _cell_text(row[env_col]).strip() or None
                if not environment:
                    env_match = ENV_RE.search(row_text)
                    environment = env_match.group(1) if env_match else None

                version = version_match.group(1)
                key = (platform.lower(), version, (environment or "").lower())
                if key in seen:
                    continue
                seen.add(key)
                results.append(FrontendPlatformVersion(
                    platform=platform, version=version, environment=environment, context=row_text,
                ))

        elif block.type == "text":
            for line in block.text.splitlines():
                line = line.strip()
                if not line:
                    continue
                platform = platform_label(line)
                if not platform:
                    continue
                version_match = VERSION_RE.search(line)
                if not version_match:
                    continue
                version = version_match.group(1)
                env_match = ENV_RE.search(line)
                environment = env_match.group(1) if env_match else None
                key = (platform.lower(), version, (environment or "").lower())
                if key in seen:
                    continue
                seen.add(key)
                results.append(FrontendPlatformVersion(
                    platform=platform, version=version, environment=environment, context=line,
                ))

    return results[:40]


def analyze_release_page_html(
    html: str,
) -> tuple[list[BackendServiceVersion], list[FrontendPlatformVersion], ReleaseMetadata | None]:
    """Run the 3-step heuristic analysis over a release page's storage HTML.

    Step 1: extract Release Date / Status / Team (kept separate), then find
            the table with explicit "Microservice" and "Version" columns and
            extract service + version pairs (plus Component, LIVE ENV
            Details, New service/operation, Developer, when present).
    Step 2: locate the FE/Frontend section and extract Android/iOS versions
            together with the environment they're mentioned in, when present.
    """
    blocks = _parse_blocks(html)

    release_metadata = _extract_release_metadata(blocks)
    be_versions = _extract_backend_versions(blocks)

    fe_section = _section_blocks(blocks, FE_HEADING_RE)
    if not fe_section and not any(b.type == "heading" and FE_HEADING_RE.search(b.text) for b in blocks):
        fe_section = blocks

    fe_versions = _extract_frontend_versions(fe_section)
    return be_versions, fe_versions, release_metadata


def extract_jira_macro_jql_queries(html: str) -> list[str]:
    """Return the unique JQL queries embedded via Confluence "jira" macros.

    Sections like "Stories/ Technical stories/ Bugs/ Tasks" are typically a
    live-rendered Jira macro (``<ac:structured-macro ac:name="jira">``) whose
    storage HTML only carries the macro's *definition* (JQL, columns, server)
    — never the literal issue rows, since those are fetched by Confluence at
    view time. To show real ticket data the caller must run the extracted
    JQL against Jira itself.
    """
    queries: list[str] = []
    seen: set[str] = set()
    for macro_match in _JIRA_MACRO_RE.finditer(html or ""):
        jql_match = _JQL_PARAM_RE.search(macro_match.group(1))
        if not jql_match:
            continue
        # Parameter bodies are plain escaped text, but strip any stray tags
        # defensively before unescaping HTML entities (&quot;, &amp;, ...).
        raw = re.sub(r"<[^>]+>", "", jql_match.group(1))
        jql = re.sub(r"\s+", " ", _html.unescape(raw)).strip()
        if jql and jql not in seen:
            seen.add(jql)
            queries.append(jql)
    return queries
