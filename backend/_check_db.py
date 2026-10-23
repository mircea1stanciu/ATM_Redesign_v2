import asyncio

from sqlalchemy import text

from app.db.session import AsyncSessionLocal


async def check():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT email, role, settings_json FROM users WHERE role IN ('automation_lead', 'admin')"))
        rows = result.fetchall()
        for row in rows:
            settings = row[2] or {}
            base_url = settings.get("jira_mcp_base_url", "NOT_SET")
            project_key = settings.get("jira_project_key", "NOT_SET")
            print(f"email={row[0]}, role={row[1]}, base_url={base_url!r}, project_key={project_key!r}")

asyncio.run(check())
