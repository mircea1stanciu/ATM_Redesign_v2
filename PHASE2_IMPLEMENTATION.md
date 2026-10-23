# Phase 2 — Test Runner Engine

## Overview

Phase 2 implements automated test execution in isolated Docker containers with live result streaming to the frontend.

## Architecture

```
┌──────────────────┐
│   Frontend       │ (WebSocket client)
└────────┬─────────┘
         │ ws://api/runs/ws/{run_id}
┌────────▼──────────────────────────────┐
│   FastAPI Backend                      │
│  ┌─────────────────────────────────┐  │
│  │ POST /runs/{id}/execute         │  │
│  │ (delegates to Celery)           │  │
│  └─────────────────────────────────┘  │
└────────┬──────────────────────────────┘
         │
    ┌────▼────────────────┐
    │  Celery Task Queue  │
    │  (Redis broker)     │
    └────┬────────────────┘
         │
    ┌────▼──────────────────────┐
    │  Celery Worker            │
    │  ┌──────────────────────┐ │
    │  │ 1. Clone repo        │ │
    │  │ 2. Detect framework  │ │
    │  │ 3. Run in Docker     │ │
    │  │ 4. Parse JUnit XML   │ │
    │  │ 5. Store results     │ │
    │  └──────────────────────┘ │
    └────┬──────────────────────┘
         │
    ┌────▼─────────────────┐
    │  Docker Container    │
    │  (isolated tests)    │
    │  - pytest            │
    │  - playwright        │
    │  - cypress           │
    │  - robot             │
    └──────────────────────┘
```

## Components

### 1. Framework Detector
Automatically detects the test framework used in a repository.

**Supported Frameworks:**
- **pytest** - Python unit testing
- **Playwright** - Browser automation testing
- **Cypress** - E2E JavaScript testing
- **Robot Framework** - Keyword-driven testing
- **JUnit/Maven** - Java/JVM testing

**Detection Methods:**
- File presence (pytest.ini, cypress.config.ts, robot.yaml)
- File patterns (test_*.py, *.robot, *.spec.ts)
- File content analysis (import statements, test definitions)

### 2. Docker Test Runner
Executes tests in isolated, ephemeral Docker containers.

**Features:**
- Repository cloning (supports HTTPS and SSH)
- Framework-specific Docker images
- Resource limits (512MB RAM, 50% CPU)
- Timeout enforcement (600 seconds default)
- JUnit XML output capture

**Docker Images Used:**
```
pytest         → python:3.11-slim
Playwright     → mcr.microsoft.com/playwright:v1.40.0-focal
Cypress        → cypress/base:latest
Robot          → python:3.11-slim
JUnit/Maven    → maven:3.8-openjdk-11
```

### 3. JUnit XML Parser
Parses test results from JUnit XML format and stores them in the database.

**Extracted Information:**
- Test name and class
- Pass/Fail/Error/Skipped status
- Execution duration (milliseconds)
- Error messages and stack traces
- Test suite aggregates (total, passed, failed)

### 4. WebSocket Manager
Enables real-time streaming of test logs and status updates.

**Event Types:**
- `stdout` - Test standard output
- `stderr` - Test standard error
- `status` - Execution status (running, passed, failed, error)
- `log` - Generic log messages

**Client Example:**
```javascript
const ws = new WebSocket('ws://localhost:8000/api/v1/runs/ws/{run_id}');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'stdout') {
    console.log(msg.data);
  } else if (msg.type === 'status') {
    console.log(`Status: ${msg.status}`);
  }
};
```

### 5. Celery Task Queue
Asynchronous test execution with retry logic and monitoring.

**Main Task:**
```python
execute_test_run_task(run_id, suite_id, project_id, branch)
```
- Maximum 3 retries on failure
- 25-minute soft timeout, 30-minute hard timeout
- Redis broker for job distribution
- Task status tracking

## Usage

### 1. Create a Test Run
```bash
POST /api/v1/runs
{
  "suite_id": "uuid",
  "branch": "main",
  "commit_sha": "abc123...",
  "triggered_by": "user@example.com"
}
```

### 2. Execute the Test Run
```bash
POST /api/v1/runs/{run_id}/execute
```

Returns:
```json
{
  "status": "scheduled",
  "run_id": "uuid",
  "task_id": "celery_task_id",
  "message": "Test run scheduled for execution"
}
```

### 3. Stream Results via WebSocket
```javascript
const ws = new WebSocket(`ws://api/v1/runs/ws/{run_id}`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  updateUI(msg);
};
```

## Environment Setup

### Local Development

1. **Start PostgreSQL** (Docker):
```bash
docker-compose up -d postgres
```

2. **Start Redis** (Docker):
```bash
docker-compose up -d redis
```

3. **Install dependencies**:
```bash
cd backend
pip install -e .
```

4. **Apply migrations**:
```bash
alembic upgrade head
```

5. **Start Celery Worker**:
```bash
celery -A app.workers.celery_app worker --loglevel=info
```

6. **Start Celery Beat** (optional, for scheduled runs):
```bash
celery -A app.workers.celery_app beat --loglevel=info
```

7. **Start FastAPI server**:
```bash
uvicorn app.main:app --reload
```

### Docker Daemon Requirements

The backend must have access to the Docker daemon:
```bash
# On Linux, ensure Docker socket is readable
sudo usermod -aG docker $USER

# On macOS, Docker Desktop includes the daemon
```

## Configuration

### Settings (backend/app/core/config.py)

```python
# Docker runner
DOCKER_RUNNER_NETWORK: str = "none"          # Network mode
DOCKER_RUNNER_MEM_LIMIT: str = "512m"        # Memory limit
DOCKER_RUNNER_CPU_QUOTA: int = 50000         # 50% of CPU

# Artifacts storage
ARTIFACTS_DIR: str = "/tmp/testmanager/artifacts"

# Celery
CELERY_BROKER_URL: str = "redis://localhost:6379/0"
CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"
```

## Database Schema

### TestRun (extended)
```
id: UUID (PK)
suite_id: UUID (FK)
status: RunStatus (pending, running, passed, failed, error, cancelled)
branch: str
commit_sha: str
triggered_by: str
total_tests: int
passed_tests: int
failed_tests: int
skipped_tests: int
execution_time_seconds: float
started_at: datetime
completed_at: datetime
error_message: str
created_at: datetime
```

### TestResult (new)
```
id: UUID (PK)
run_id: UUID (FK → TestRun)
test_name: str
class_name: str
status: TestStatus (passed, failed, skipped, error)
duration_ms: float
error_message: str
stack_trace: str
created_at: datetime
```

## Testing

Run all tests:
```bash
python -m pytest tests/ -v
```

Framework detector tests:
```bash
python -m pytest tests/test_framework_detector.py -v
```

JUnit parser tests:
```bash
python -m pytest tests/test_junit_parser.py -v
```

## Next Steps

### Phase 3: Frontend
- React dashboard for test execution
- Real-time log viewer with WebSocket
- Test result visualization
- Artifact download management

### Production Deployment
- Configure Docker resource limits via Kubernetes/Docker Swarm
- Set up secure WebSocket (WSS)
- Implement distributed Celery workers
- Add Prometheus metrics for monitoring
- Configure log aggregation (ELK stack)

## Troubleshooting

### Docker Connection Failed
```
Error: Cannot connect to Docker daemon
Solution: Ensure Docker Desktop is running or Docker daemon is accessible
```

### Celery Tasks Not Running
```
Error: No tasks
Solution: 
  1. Check Redis is running: redis-cli ping
  2. Start worker: celery -A app.workers.celery_app worker
  3. Check Redis connection in logs
```

### WebSocket Connection Refused
```
Error: WebSocket connection failed
Solution:
  1. Ensure FastAPI server is running with WebSocket support
  2. Check CORS configuration allows WebSocket
  3. Verify run_id exists in database
```

### Tests Timeout in Docker
```
Solution:
  1. Increase DOCKER_RUNNER_MEM_LIMIT in config
  2. Reduce DOCKER_RUNNER_CPU_QUOTA
  3. Check container has network access if needed
  4. Increase timeout in test suite settings
```
