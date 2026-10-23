import asyncio

from sqlalchemy import text

from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal


async def get_token():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT id, email FROM users WHERE email = 'au1@test.com'"))
        row = result.fetchone()
        if row:
            token = create_access_token(str(row[0]))
            print(f"Token for {row[1]}: {token}")

asyncio.run(get_token())
