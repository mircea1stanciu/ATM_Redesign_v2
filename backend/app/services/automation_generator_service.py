"""Automation script generator.

Given a set of manual test cases (typically from Zephyr) and a target local
project directory, produce framework-specific automation skeletons.

The initial implementation supports **Bruno** (`.bru` API request files):

- One folder per test case: ``<TC_KEY>_<slug(name)>/``.
- One numbered ``.bru`` file per step.
- Each step is parsed to guess the HTTP method, URL, headers, expected status
  code and any assertions embedded in the step text.
- Before writing a step, the target local repository is scanned for existing
  ``.bru`` files whose URL path matches the step's URL — those are attached
  to the generated file as "Related existing requests" comments so the user
  can pick up any established variable names / env setup already in the
  project.

The service is intentionally forgiving: missing/unparsable fields do not
abort the run, they fall through to a documented placeholder.
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ── Framework detection ──────────────────────────────────────────────────────


def detect_framework(target_dir: Path) -> str:
    """Best-effort framework detection for the target directory.

    Returns one of: ``"bruno"``, ``"playwright"``, ``"pytest"``, ``"generic"``.
    Only files up to two levels deep are inspected to keep the scan quick on
    large trees; we cross-check both filenames and popular manifest names.
    """
    if not target_dir.exists():
        return "generic"

    if (target_dir / "bruno.json").exists():
        return "bruno"

    for path in target_dir.rglob("*"):
        rel = path.relative_to(target_dir)
        if len(rel.parts) > 4:
            continue
        name = path.name.lower()
        if name == "bruno.json":
            return "bruno"
        if name.endswith(".bru"):
            return "bruno"
        if name == "playwright.config.ts" or name == "playwright.config.js":
            return "playwright"
        if name == "pytest.ini" or (name == "pyproject.toml" and "pytest" in path.read_text(errors="ignore").lower()):
            return "pytest"
    return "generic"


# ── URL / step parsing helpers ───────────────────────────────────────────────

_HTTP_METHOD_RE = re.compile(
    r"\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b",
    re.IGNORECASE,
)
_URL_RE = re.compile(
    r"(https?://\S+|(?:/[A-Za-z0-9_\-{}$.]+)+/?)",
)
_STATUS_RE = re.compile(
    r"\b(1\d{2}|2\d{2}|3\d{2}|4\d{2}|5\d{2})\b",
)
_JSON_BLOB_RE = re.compile(r"(\{[^{}]*\})", re.DOTALL)


@dataclass
class ParsedStep:
    index: int
    description: str
    method: str
    url: str
    body: str
    headers: dict[str, str]
    expected_status: int | None
    assertions: list[str]
    raw_data: str
    raw_expected: str
    related_paths: list[str] = field(default_factory=list)


def _slugify(text: str, max_len: int = 60) -> str:
    """Filesystem-safe slug that keeps the source recognisable."""
    cleaned = re.sub(r"[^A-Za-z0-9 _\-]+", "", text or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return (cleaned or "step")[:max_len]


def _parse_step(
    step: dict[str, Any],
    default_method: str = "GET",
) -> ParsedStep:
    """Pull method / URL / body / assertions out of a Zephyr step dict."""
    description = str(step.get("description") or "").strip()
    test_data = str(step.get("test_data") or step.get("data") or "").strip()
    expected = str(step.get("expected_result") or step.get("expected") or "").strip()

    method_match = _HTTP_METHOD_RE.search(description) or _HTTP_METHOD_RE.search(test_data)
    method = (method_match.group(1) if method_match else default_method).upper()

    url = ""
    for candidate in _URL_RE.findall(f"{description}\n{test_data}"):
        # Ignore very short or purely-descriptive matches like "and/or".
        if len(candidate) < 3 or " " in candidate:
            continue
        url = candidate.rstrip(".,;)]")
        break

    body = ""
    body_match = _JSON_BLOB_RE.search(test_data)
    if body_match:
        body = body_match.group(1).strip()

    headers: dict[str, str] = {}
    for header_hit in re.findall(
        r"([A-Za-z0-9-]+)\s*:\s*([^\n,]+)",
        f"{description}\n{test_data}",
    ):
        name, value = header_hit
        low = name.lower()
        # Filter obvious non-header key:value pairs like "step: 1" or "Result: ...".
        if low in {"step", "result", "expected", "note", "notes", "data", "id"}:
            continue
        headers[name.strip()] = value.strip()

    expected_status: int | None = None
    for status_hit in _STATUS_RE.findall(expected):
        try:
            expected_status = int(status_hit)
            break
        except ValueError:
            continue

    assertions: list[str] = []
    if expected_status:
        assertions.append(f"expect(res.getStatus()).to.equal({expected_status});")
    # Any "should return X" style human assertions are surfaced as JS comments
    # so the user can quickly translate them.
    for line in expected.splitlines():
        text = line.strip("-*• \t")
        if text:
            assertions.append(f"// TODO assert: {text}")

    return ParsedStep(
        index=int(step.get("index") or 0) or 1,
        description=description or f"Step {step.get('index') or ''}".strip(),
        method=method,
        url=url,
        body=body,
        headers=headers,
        expected_status=expected_status,
        assertions=assertions,
        raw_data=test_data,
        raw_expected=expected,
    )


# ── Related-component search inside the target repo ─────────────────────────

def _index_existing_bruno_urls(target_dir: Path) -> list[tuple[Path, str, str]]:
    """Build a small index of ``(file, method, url)`` tuples for every existing
    ``.bru`` file in the target repo. This powers the "related requests" hints.
    Errors from unreadable files are swallowed so an unusable index doesn't
    prevent generation."""
    index: list[tuple[Path, str, str]] = []
    if not target_dir.exists():
        return index
    for path in target_dir.rglob("*.bru"):
        try:
            text = path.read_text(errors="ignore")
        except Exception:
            continue
        # Each .bru is structured like:  get { url: ... }
        match = re.search(
            r"^\s*(get|post|put|patch|delete|head|options)\s*\{\s*[^}]*?url:\s*([^\n]+)",
            text,
            re.IGNORECASE | re.MULTILINE,
        )
        if match:
            index.append((path, match.group(1).upper(), match.group(2).strip()))
    return index


def _find_related(
    step: ParsedStep,
    bruno_index: Iterable[tuple[Path, str, str]],
    target_dir: Path,
    max_hits: int = 3,
) -> list[str]:
    """Return up to ``max_hits`` filesystem-relative paths of existing .bru
    files whose URL shares a path segment with the step's URL."""
    if not step.url:
        return []
    step_segments = {seg for seg in re.split(r"[/?&=]+", step.url) if len(seg) > 3 and "{" not in seg}
    if not step_segments:
        return []

    hits: list[tuple[int, Path]] = []
    for path, method, url in bruno_index:
        segments = {seg for seg in re.split(r"[/?&=]+", url) if len(seg) > 3 and "{" not in seg}
        overlap = len(step_segments & segments)
        if not overlap:
            continue
        # A method match is worth one extra "point" in the ranking.
        score = overlap + (1 if method == step.method else 0)
        hits.append((score, path))

    hits.sort(key=lambda t: t[0], reverse=True)
    out: list[str] = []
    for _, path in hits[:max_hits]:
        try:
            out.append(str(path.relative_to(target_dir)))
        except ValueError:
            out.append(str(path))
    return out


# ── Reference collection reuse ───────────────────────────────────────────────
#
# Lets the user pick an existing folder of ``.bru`` requests (a "collection")
# already in the target repo and reuse it as the base for a generated test
# case: those requests are copied first (unmodified apart from their sequence
# number), then the steps derived from the Zephyr test case are appended
# after them.

_BRU_SEQ_RE = re.compile(r"seq:\s*\d+")


def list_bruno_reference_folders(target_dir: Path, max_depth: int = 6) -> list[dict[str, Any]]:
    """Return every folder under ``target_dir`` that directly contains one or
    more ``.bru`` request files, plus their ancestor folders (so the picker can
    render a full hierarchy), as flat nodes
    ``{id, name, parent_id, bru_count, bru_files}``.

    ``id`` is the folder's path relative to ``target_dir`` (POSIX-style, no
    leading slash) — this is what's sent back as ``reference_folder`` when
    generating. Ancestor-only nodes (no .bru files directly inside them) get
    ``bru_count: 0`` and ``bru_files: []`` but are still included so the tree
    has proper structure.
    """
    target_dir = target_dir.expanduser().resolve()
    if not target_dir.exists():
        return []

    leaf_dirs: set[Path] = set()
    for bru_file in target_dir.rglob("*.bru"):
        try:
            rel_parts = bru_file.relative_to(target_dir).parts
        except ValueError:
            continue
        if len(rel_parts) > max_depth + 1:
            continue
        leaf_dirs.add(bru_file.parent)

    nodes: dict[str, dict[str, Any]] = {}
    for d in leaf_dirs:
        rel = d.relative_to(target_dir)
        parts = rel.parts
        if not parts:
            # .bru files directly in the target root — expose a synthetic root node.
            parts = (".",)
        prefix_parts: list[str] = []
        parent_id: str | None = None
        for part in parts:
            prefix_parts.append(part)
            node_id = "/".join(prefix_parts)
            if node_id not in nodes:
                nodes[node_id] = {
                    "id": node_id,
                    "name": part,
                    "parent_id": parent_id,
                    "bru_count": 0,
                    "bru_files": [],
                }
            parent_id = node_id

        leaf_id = "/".join(parts)
        bru_files = sorted(f.name for f in d.glob("*.bru") if f.is_file())
        nodes[leaf_id]["bru_count"] = len(bru_files)
        nodes[leaf_id]["bru_files"] = bru_files

    return list(nodes.values())


def _read_reference_bruno_files(folder_dir: Path) -> list[tuple[str, str]]:
    """Return ``(filename_stem, raw_content)`` for every top-level ``.bru``
    file in ``folder_dir``, ordered by their ``meta.seq`` (falls back to
    alphabetical filename order when a file has no parseable seq)."""
    if not folder_dir.exists() or not folder_dir.is_dir():
        return []
    items: list[tuple[int, str, str]] = []
    for f in sorted(folder_dir.glob("*.bru")):
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        seq_match = re.search(r"seq:\s*(\d+)", content)
        seq = int(seq_match.group(1)) if seq_match else 999_999
        items.append((seq, f.stem, content))
    items.sort(key=lambda t: t[0])
    return [(stem, content) for _, stem, content in items]


def _renumber_bruno_seq(content: str, new_seq: int) -> str:
    """Patch only the ``meta.seq`` field so a reused request keeps its
    original name/URL/headers/tests untouched but sorts correctly once copied
    alongside the newly generated steps."""
    patched, count = _BRU_SEQ_RE.subn(f"seq: {new_seq}", content, count=1)
    return patched if count else content


# ── Bruno file writer ────────────────────────────────────────────────────────

def _render_bruno_file(
    step: ParsedStep,
    case_name: str,
) -> str:
    method_lower = step.method.lower()
    url = step.url or "{{base_url}}/TODO"
    header_lines = "\n".join(
        f"  {name}: {value}" for name, value in step.headers.items()
    ) or "  content-type: application/json"

    body_block = "  body: none" if not step.body else "  body: json"
    body_section = ""
    if step.body:
        body_section = f"\nbody:json {{\n{step.body}\n}}\n"

    assertion_block = "\n".join(f"  {line}" for line in step.assertions) or "  // TODO: add assertions"

    related_comment = ""
    if step.related_paths:
        joined = "\n".join(f"// - {p}" for p in step.related_paths)
        related_comment = (
            "// Related existing requests found in this repo:\n"
            f"{joined}\n"
            "// Consider reusing their variable names / environment.\n\n"
        )

    return (
        f"{related_comment}"
        "meta {\n"
        f"  name: {step.index:02d}_{_slugify(step.description, 40)}\n"
        "  type: http\n"
        f"  seq: {step.index}\n"
        "}\n\n"
        f"{method_lower} {{\n"
        f"  url: {url}\n"
        f"{body_block}\n"
        "  auth: none\n"
        "}\n\n"
        "headers {\n"
        f"{header_lines}\n"
        "}\n"
        f"{body_section}\n"
        "tests {\n"
        f"{assertion_block}\n"
        "}\n\n"
        f"docs {{\n"
        f"  Test case: {case_name}\n"
        f"  Step: {step.description}\n"
        f"  Expected: {step.raw_expected or 'n/a'}\n"
        "}\n"
    )


def _render_case_readme(
    case: dict[str, Any],
    steps: list[ParsedStep],
    reused_count: int = 0,
    reference_folder: str = "",
) -> str:
    lines = [
        f"# {case.get('key', '')} — {case.get('name', '')}",
        "",
        f"- Status: {case.get('status', '') or 'n/a'}",
        f"- Priority: {case.get('priority', '') or 'n/a'}",
        f"- Folder: {case.get('folder', '') or 'n/a'}",
        f"- Source: Zephyr ({case.get('source', 'unknown')})",
    ]
    if reused_count:
        lines.append(
            f"- Reused {reused_count} request(s) from reference collection `{reference_folder}` "
            "(numbered first, before the Zephyr-derived steps below)."
        )
    lines.extend([
        "",
        "## Precondition",
        (case.get("precondition") or "_none_").strip(),
        "",
        "## Objective",
        (case.get("objective") or "_none_").strip(),
        "",
        "## Steps",
    ])
    for step in steps:
        lines.extend([
            "",
            f"### {step.index}. {step.description or '(no description)'}",
            f"- Method: `{step.method}`",
            f"- URL: `{step.url or 'n/a'}`",
            f"- Expected: {step.raw_expected or 'n/a'}",
        ])
    return "\n".join(lines) + "\n"


# ── Public entrypoint ────────────────────────────────────────────────────────

@dataclass
class GenerationRequest:
    target_dir: Path
    output_subpath: str
    cases: list[dict[str, Any]]
    framework: str = "auto"
    reference_folder: str = ""


@dataclass
class GenerationOutcome:
    framework: str
    target_dir: str
    output_dir: str
    created_files: list[str]
    skipped_cases: list[dict[str, str]]
    warnings: list[str]


def generate_automation(request: GenerationRequest) -> GenerationOutcome:
    """Generate automation files under ``target_dir/output_subpath``.

    ``request.framework`` may be ``"auto"``, in which case the framework is
    detected from ``target_dir``. When the detected/requested framework is
    unsupported the outcome still reports which cases were skipped so the
    caller can display a meaningful message.
    """
    target = request.target_dir.expanduser().resolve()
    if not target.exists():
        raise FileNotFoundError(f"Target directory '{target}' does not exist.")
    if not target.is_dir():
        raise NotADirectoryError(f"Target path '{target}' is not a directory.")

    framework = (
        detect_framework(target) if request.framework in ("auto", "")
        else request.framework.lower()
    )
    output_dir = (target / request.output_subpath.strip(" /")).resolve()
    # Refuse to escape the target directory even with tricky ../ paths.
    try:
        output_dir.relative_to(target)
    except ValueError as exc:
        raise ValueError(
            "output_subpath must stay inside the target directory."
        ) from exc
    output_dir.mkdir(parents=True, exist_ok=True)

    created: list[str] = []
    skipped: list[dict[str, str]] = []
    warnings: list[str] = []

    if framework != "bruno":
        warnings.append(
            f"Detected framework '{framework}' is not yet supported for "
            "generation. Only Bruno is implemented; add a generator for this "
            "framework or point at a Bruno collection."
        )
        return GenerationOutcome(
            framework=framework,
            target_dir=str(target),
            output_dir=str(output_dir),
            created_files=[],
            skipped_cases=[{"key": c.get("key", ""), "reason": "framework not supported"} for c in request.cases],
            warnings=warnings,
        )

    bruno_index = _index_existing_bruno_urls(target)

    # Optional "reference collection": an existing folder of .bru requests to
    # reuse as-is. Its requests are copied first (renumbered only), then the
    # Zephyr-derived steps are appended after them for every generated case.
    reused_files: list[tuple[str, str]] = []
    reference_folder = (request.reference_folder or "").strip(" /")
    if reference_folder:
        ref_dir = (target / reference_folder).resolve()
        try:
            ref_dir.relative_to(target)
        except ValueError:
            warnings.append(
                f"reference_folder '{reference_folder}' escapes the target "
                "directory and was ignored."
            )
        else:
            reused_files = _read_reference_bruno_files(ref_dir)
            if not reused_files:
                warnings.append(
                    f"Reference folder '{reference_folder}' has no .bru "
                    "requests to reuse — generating without a reference."
                )

    for case in request.cases:
        key = str(case.get("key") or "").strip()
        name = str(case.get("name") or "").strip()
        if not key:
            skipped.append({"key": "", "reason": "missing test case key"})
            continue
        raw_steps = case.get("steps") or []
        if not raw_steps:
            skipped.append({"key": key, "reason": "no steps available"})
            continue

        case_folder_name = f"{_slugify(key, 20)}_{_slugify(name, 40)}"
        case_dir = output_dir / case_folder_name
        case_dir.mkdir(parents=True, exist_ok=True)

        parsed_steps: list[ParsedStep] = []
        for step_dict in raw_steps:
            parsed = _parse_step(step_dict)
            parsed.related_paths = _find_related(parsed, bruno_index, target)
            parsed_steps.append(parsed)

        write_index = 0

        # 1) Reused reference collection requests first, unmodified apart from
        #    their sequence number, so they keep sorting correctly ahead of the
        #    newly generated Zephyr steps.
        for stem, content in reused_files:
            write_index += 1
            patched = _renumber_bruno_seq(content, write_index)
            # Strip any pre-existing "NN_" numeric prefix from the original
            # filename so it doesn't get doubled up with the new one.
            clean_stem = re.sub(r"^\d+[_\-]+", "", stem) or stem
            file_name = f"{write_index:02d}_{_slugify(clean_stem, 40)}.bru"
            file_path = case_dir / file_name
            file_path.write_text(patched, encoding="utf-8")
            created.append(str(file_path.relative_to(target)))

        # 2) Then the Zephyr-derived steps, numbered to continue right after.
        for step in parsed_steps:
            write_index += 1
            step.index = write_index
            file_name = f"{write_index:02d}_{_slugify(step.description, 40)}.bru"
            file_path = case_dir / file_name
            file_path.write_text(_render_bruno_file(step, name or key), encoding="utf-8")
            created.append(str(file_path.relative_to(target)))

        readme_path = case_dir / "README.md"
        readme_path.write_text(
            _render_case_readme(case, parsed_steps, len(reused_files), reference_folder),
            encoding="utf-8",
        )
        created.append(str(readme_path.relative_to(target)))

    return GenerationOutcome(
        framework=framework,
        target_dir=str(target),
        output_dir=str(output_dir),
        created_files=created,
        skipped_cases=skipped,
        warnings=warnings,
    )
