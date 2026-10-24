"""Secret environment variables (phase 17): stored encrypted on the environment, handed to the runner, never sent back
to the browser, and masked in run logs."""
import json
from typing import Any, Optional

from app.core.crypto import SecretUnreadable, decrypt, encrypt

MASK = "***"
MIN_MASKED_LENGTH = 4  # shorter values would mask ordinary words in the log


def read(environment: Any) -> dict[str, str]:
    """The environment's secret variables; empty when there are none or the key changed (enter them again)."""
    if not getattr(environment, "secrets", None):
        return {}
    try:
        value = json.loads(decrypt(environment.secrets))
    except (SecretUnreadable, ValueError):
        return {}
    return {str(k): str(v) for k, v in value.items()} if isinstance(value, dict) else {}


def write(environment: Any, secrets: dict[str, str]) -> None:
    environment.secrets = encrypt(json.dumps(secrets)) if secrets else None


def apply_changes(current: dict[str, str], changes: dict[str, Optional[str]]) -> dict[str, str]:
    """A value sets the secret, an empty value or None removes it; names left out keep their value."""
    result = dict(current)
    for name, value in changes.items():
        if value:
            result[name] = value
        else:
            result.pop(name, None)
    return result


def mask(text: str, values: list[str]) -> str:
    for value in sorted(values, key=len, reverse=True):
        if len(value) >= MIN_MASKED_LENGTH:
            text = text.replace(value, MASK)
    return text
