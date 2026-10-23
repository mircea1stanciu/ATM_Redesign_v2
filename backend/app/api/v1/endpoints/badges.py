"""
Badge SVG pentru status-ul ultimului run dintr-un proiect.
Endpoint public (nu necesită autentificare).

Exemplu de utilizare în README.md:
  ![Test Status](https://your-host/api/v1/badge/project/{project_id})
"""
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.models import Project, TestRun, TestSuite

router = APIRouter()

# Culori shields.io-style
_STATUS_COLOR = {
    "passed":    ("#4c1",  "brightgreen"),
    "failed":    ("#e05d44", "red"),
    "running":   ("#dfb317", "yellow"),
    "pending":   ("#9f9f9f", "lightgrey"),
    "error":     ("#e05d44", "red"),
    "cancelled": ("#9f9f9f", "lightgrey"),
    "unknown":   ("#9f9f9f", "lightgrey"),
}

_LABEL = "tests"


def _build_svg(label: str, message: str, color_hex: str) -> str:
    """Generează un badge SVG în stilul shields.io (flat)."""
    label_width = len(label) * 7 + 10
    msg_width = len(message) * 7 + 10
    total_width = label_width + msg_width

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total_width}" height="20"
     role="img" aria-label="{label}: {message}">
  <title>{label}: {message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="{total_width}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_width}" height="20" fill="#555"/>
    <rect x="{label_width}" width="{msg_width}" height="20" fill="{color_hex}"/>
    <rect width="{total_width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle"
     font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="{label_width // 2 * 10 + 50}" y="150" fill="#010101" fill-opacity=".3"
          transform="scale(.1)" textLength="{(label_width - 10) * 10}">{label}</text>
    <text x="{label_width // 2 * 10 + 50}" y="140" transform="scale(.1)"
          textLength="{(label_width - 10) * 10}">{label}</text>
    <text x="{(label_width + msg_width // 2) * 10 + 50}" y="150" fill="#010101"
          fill-opacity=".3" transform="scale(.1)"
          textLength="{(msg_width - 10) * 10}">{message}</text>
    <text x="{(label_width + msg_width // 2) * 10 + 50}" y="140" transform="scale(.1)"
          textLength="{(msg_width - 10) * 10}">{message}</text>
  </g>
</svg>"""


@router.get(
    "/project/{project_id}",
    summary="Badge SVG pentru ultimul run din proiect",
    response_class=Response,
    responses={
        200: {
            "content": {"image/svg+xml": {}},
            "description": "Badge SVG cu statusul ultimului run",
        }
    },
)
async def project_badge(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Returnează un badge SVG cu statusul ultimului test run din proiect.
    Nu necesită autentificare — poate fi embedded direct în README.

    - **passed** → verde
    - **failed / error** → roşu
    - **running** → galben
    - **pending / cancelled** → gri
    """
    # Verificăm că proiectul există
    proj_result = await db.execute(select(Project).where(Project.id == project_id))
    project = proj_result.scalar_one_or_none()

    if not project:
        color_hex, _ = _STATUS_COLOR["unknown"]
        svg = _build_svg(_LABEL, "unknown", color_hex)
        return Response(content=svg, media_type="image/svg+xml")

    # Cel mai recent run din orice suite al proiectului
    run_result = await db.execute(
        select(TestRun)
        .join(TestSuite, TestRun.suite_id == TestSuite.id)
        .where(TestSuite.project_id == project_id)
        .order_by(TestRun.created_at.desc())
        .limit(1)
    )
    run = run_result.scalar_one_or_none()

    status_str = run.status.value if run else "unknown"
    color_hex, _ = _STATUS_COLOR.get(status_str, _STATUS_COLOR["unknown"])
    svg = _build_svg(_LABEL, status_str, color_hex)

    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-cache, max-age=0"},
    )
