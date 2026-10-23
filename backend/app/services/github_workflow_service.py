"""Parse GitHub Actions workflow files (``.github/workflows/*.yml``) and issue
form templates (``.github/ISSUE_TEMPLATE/*.yml``) into a UI-friendly schema.

Only pure parsing lives here; the HTTP orchestration (listing the folder,
fetching file contents, dispatching a run) is done by the endpoints so they can
reuse the project's existing GitHub token / auth handling.
"""
from __future__ import annotations

import re
from typing import Any

import yaml


class GitHubWorkflowError(Exception):
    """Raised when a workflow / issue-template YAML cannot be parsed."""


# Phrases workflow authors commonly use to document the accepted values of a
# free-form (non-``choice``) input, e.g. "Supported values: smoke, regression".
_SUPPORTED_VALUES_RE = re.compile(
    r"\b(?:supported|allowed|valid)\s+values?\s*:\s*([^.\n]+)"
    r"|\boptions?\s*:\s*([^.\n]+)"
    r"|\bone\s+of(?:\s+the\s+following)?\s*:\s*([^.\n]+)",
    re.IGNORECASE,
)
# Fallback: a parenthesised slash/comma-separated list, e.g. "(dev/staging/prod)".
_PAREN_LIST_RE = re.compile(r"\(\s*([a-zA-Z0-9_.\-]+(?:\s*[/,|]\s*[a-zA-Z0-9_.\-]+){1,20})\s*\)")
# "Example: smoke" / "e.g. smoke" / "e.g., smoke" / "Eg: smoke".
# Uses letter lookaround (not \b) around "e.g." because \b doesn't behave as
# expected next to periods, and requires the keyword not be part of a larger
# word (e.g. must NOT match "eg" inside "regression").
_EXAMPLE_RE = re.compile(
    r"(?<![A-Za-z])(?:example|e\.?g\.?)(?![A-Za-z])\s*[:,]?\s*([^.\n]+)",
    re.IGNORECASE,
)


def _split_values(raw: str) -> list[str]:
    parts = re.split(r"[,/|]", raw)
    seen: list[str] = []
    for part in parts:
        value = part.strip().strip("'\"")
        if value and value not in seen:
            seen.append(value)
    return seen


def _extract_supported_values(description: str) -> tuple[list[str], str]:
    """Best-effort extraction of "supported values" and an example from a
    workflow input's free-text description, for inputs that aren't declared
    with an explicit ``type: choice`` / ``options:`` list."""
    if not description:
        return [], ""

    example = ""
    example_match = _EXAMPLE_RE.search(description)
    if example_match:
        example = example_match.group(1).strip().strip("'\"")

    values_match = _SUPPORTED_VALUES_RE.search(description)
    if values_match:
        raw = next(g for g in values_match.groups() if g)
        return _split_values(raw), example

    paren_match = _PAREN_LIST_RE.search(description)
    if paren_match:
        return _split_values(paren_match.group(1)), example

    return [], example


def _safe_load(content: str) -> Any:
    try:
        return yaml.safe_load(content)
    except yaml.YAMLError as exc:  # pragma: no cover - defensive
        raise GitHubWorkflowError(f"Invalid YAML: {exc}") from exc


def _get_on_section(data: dict[str, Any]) -> Any:
    """Return the workflow ``on:`` section.

    PyYAML parses the bare key ``on`` as the boolean ``True`` (YAML 1.1 treats
    on/off/yes/no as booleans), so we must look under both keys.
    """
    for key in ("on", True):
        if key in data:
            return data[key]
    return None


def parse_workflow_dispatch(content: str) -> dict[str, Any] | None:
    """Parse a workflow file and, if it declares ``workflow_dispatch``, return
    ``{"name": str, "inputs": [ ... ]}``. Returns ``None`` when the workflow is
    not manually dispatchable.
    """
    data = _safe_load(content)
    if not isinstance(data, dict):
        return None

    on_section = _get_on_section(data)
    dispatch: Any = None

    if isinstance(on_section, dict):
        # on: { workflow_dispatch: {inputs: {...}} }  -> may be under "on" key.
        for key in ("workflow_dispatch", True):
            if key in on_section:
                dispatch = on_section[key]
                break
        else:
            # `workflow_dispatch` sometimes parses oddly; also accept it as a
            # top-level string list.
            dispatch = None
    elif isinstance(on_section, list):
        if "workflow_dispatch" in on_section:
            dispatch = {}
        else:
            return None
    elif isinstance(on_section, str):
        if on_section == "workflow_dispatch":
            dispatch = {}
        else:
            return None

    if dispatch is None:
        return None

    inputs: list[dict[str, Any]] = []
    if isinstance(dispatch, dict):
        raw_inputs = dispatch.get("inputs") or {}
        if isinstance(raw_inputs, dict):
            for name, spec in raw_inputs.items():
                spec = spec if isinstance(spec, dict) else {}
                description = str(spec.get("description") or "")
                declared_options = (
                    [str(o) for o in (spec.get("options") or [])]
                    if isinstance(spec.get("options"), list)
                    else []
                )
                input_type = str(spec.get("type") or "string")

                # For inputs that don't declare a fixed `choice` list, try to
                # infer the accepted values (and an example) from the
                # description text, so the UI can still offer a dropdown.
                options = declared_options
                example = ""
                if input_type != "boolean":
                    inferred_options, example = _extract_supported_values(description)
                    if not options:
                        options = inferred_options

                inputs.append(
                    {
                        "name": str(name),
                        "description": description,
                        "required": bool(spec.get("required", False)),
                        "default": spec.get("default"),
                        "type": input_type,
                        "options": options,
                        "example": example,
                    }
                )

    return {
        "name": str(data.get("name") or ""),
        "inputs": inputs,
    }


def parse_issue_template(content: str) -> dict[str, Any] | None:
    """Parse a GitHub issue-form template (``ISSUE_TEMPLATE/*.yml``) into
    ``{"name", "description", "fields": [...]}``. Returns ``None`` for legacy
    markdown-only templates that have no structured ``body``.
    """
    data = _safe_load(content)
    if not isinstance(data, dict):
        return None

    body = data.get("body")
    if not isinstance(body, list):
        return None

    fields: list[dict[str, Any]] = []
    for element in body:
        if not isinstance(element, dict):
            continue
        el_type = str(element.get("type") or "")
        attrs = element.get("attributes") if isinstance(element.get("attributes"), dict) else {}
        validations = element.get("validations") if isinstance(element.get("validations"), dict) else {}
        if el_type == "markdown":
            fields.append(
                {
                    "id": "",
                    "type": "markdown",
                    "label": "",
                    "description": str(attrs.get("value") or ""),
                    "placeholder": "",
                    "required": False,
                    "options": [],
                }
            )
            continue
        fields.append(
            {
                "id": str(element.get("id") or attrs.get("label") or ""),
                "type": el_type or "input",
                "label": str(attrs.get("label") or ""),
                "description": str(attrs.get("description") or ""),
                "placeholder": str(attrs.get("placeholder") or ""),
                "required": bool(validations.get("required", False)),
                "options": _extract_options(attrs.get("options")),
            }
        )

    return {
        "name": str(data.get("name") or ""),
        "description": str(data.get("description") or ""),
        "fields": fields,
    }


def _extract_options(raw: Any) -> list[str]:
    """Normalise dropdown/checkbox options into a list of label strings."""
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict) and item.get("label"):
            out.append(str(item["label"]))
    return out
