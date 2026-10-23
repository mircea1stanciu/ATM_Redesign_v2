#!/bin/bash
# Restart dev servers (frontend + backend)
set -e

echo "🔄 Restarting dev servers..."

# Kill ports
lsof -ti:5173 | xargs kill -9 2>/dev/null && echo "✓ Freed port 5173" || echo "  Port 5173 was free"
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "✓ Freed port 8000" || echo "  Port 8000 was free"
sleep 1

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Backend
cd "$REPO_ROOT/backend"
source venv/bin/activate
nohup python -m uvicorn main:app --host 0.0.0.0 --port 8000 </dev/null > /tmp/backend.log 2>&1 &
echo "✓ Backend starting on :8000"

# Frontend
cd "$REPO_ROOT/frontend"
nohup npm run dev </dev/null > /tmp/vite.log 2>&1 &
echo "✓ Frontend starting on :5173"

sleep 5
curl -s http://localhost:8000/api/auth/login -o /dev/null -w "Backend: %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"username":"x","password":"x"}' 2>/dev/null || echo "Backend: starting..."
curl -s http://localhost:5173 -o /dev/null -w "Frontend: %{http_code}\n" --max-time 3 2>/dev/null || echo "Frontend: starting..."

echo ""
echo "✅ Done. Logs: /tmp/backend.log  /tmp/vite.log"
