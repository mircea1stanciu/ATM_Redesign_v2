"""Start script for the ATM backend: `python main.py` (or `uvicorn main:app`). The app lives in app/main.py."""
import os

from dotenv import load_dotenv

load_dotenv()

from app.main import app  # noqa: E402

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8002"))
    print(f"🚀 Starting backend on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
