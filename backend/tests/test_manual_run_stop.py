import asyncio
import os
import subprocess
import sys

import pytest

from app.services.appium_project_service import AppiumRunPlan, process_group_kwargs, terminate_process_tree

SLEEPER = "import time; print('started', flush=True); time.sleep(60)"


@pytest.fixture
def routes(monkeypatch, tmp_path):
    import api.project_routes as module

    recorded = {"statuses": [], "logs": []}

    async def set_status(run_id, manual_run_id, artifact_dir, status):
        recorded["statuses"].append(status)

    async def broadcast(run_id, payload):
        return None

    monkeypatch.setattr(module, "_append_manual_run_logs", lambda run_id, payloads: recorded["logs"].extend(payloads))
    monkeypatch.setattr(module, "_set_manual_run_status", set_status)
    monkeypatch.setattr(module, "_broadcast_manual_run_message", broadcast)
    monkeypatch.setattr(module, "_run_registry_path", lambda: tmp_path / "registry.json")
    module.recorded = recorded
    return module


async def _wait_for_process(routes, run_id):
    for _ in range(100):
        await asyncio.sleep(0.05)
        if run_id in routes.manual_run_processes:
            return routes.manual_run_processes[run_id]
    raise AssertionError("run never registered its process")


def _stop(routes, run_id, pid):
    # What the cancel endpoint does.
    routes.cancelled_manual_runs.add(run_id)
    terminate_process_tree(pid)


def _assert_stopped(routes, run_id, pid):
    # The cancel endpoint sets the final status; the background task must not override it.
    assert routes.recorded["statuses"] == []
    assert any("stopped by user" in str(entry.get("data")) for entry in routes.recorded["logs"])
    assert run_id not in routes.manual_run_processes
    assert run_id not in routes.cancelled_manual_runs
    assert run_id not in routes._load_run_registry()
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_stop_terminates_running_appium_execution(routes, tmp_path):
    run_id = "manual-999"
    plan = AppiumRunPlan([sys.executable, "-c", SLEEPER], str(tmp_path), dict(os.environ), "runner:X", "X",
                         "pre", "i20")

    async def scenario():
        task = asyncio.create_task(routes._execute_appium_run_background(run_id, 999, tmp_path, plan))
        pid = await _wait_for_process(routes, run_id)
        assert routes._load_run_registry()[run_id]["pid"] == pid
        await asyncio.sleep(0.8)
        _stop(routes, run_id, pid)
        await asyncio.wait_for(task, timeout=10)
        return pid

    pid = asyncio.run(scenario())

    _assert_stopped(routes, run_id, pid)
    assert any(entry.get("data") == "started" for entry in routes.recorded["logs"])


def test_running_execution_is_reattached_after_backend_restart(routes, tmp_path, monkeypatch):
    run_id = "manual-998"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    with open(artifact_dir / "process.log", "wb") as output:
        proc = subprocess.Popen([sys.executable, "-c", SLEEPER], stdout=output, stderr=subprocess.STDOUT,
                                **process_group_kwargs())
    routes._update_run_registry(run_id, {
        "manual_run_id": 998, "pid": proc.pid, "repo_path": str(tmp_path), "artifact_dir": str(artifact_dir),
        "started": 0, "label": "X", "offset": 0,
    })
    monkeypatch.setattr(routes, "_manual_run_is_active", lambda manual_run_id: True)
    monkeypatch.setattr(routes, "APPIUM_RUN_TIMEOUT_SECONDS", 10 ** 12)

    async def scenario():
        await routes.resume_orphaned_manual_runs()
        assert routes.manual_run_processes[run_id] == proc.pid
        await asyncio.sleep(0.8)
        _stop(routes, run_id, proc.pid)
        await asyncio.wait_for(asyncio.gather(*routes._run_tasks), timeout=10)

    try:
        asyncio.run(scenario())
        proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()

    assert any("re-attached" in str(entry.get("data")) for entry in routes.recorded["logs"])
    assert any(entry.get("data") == "started" for entry in routes.recorded["logs"])
    _assert_stopped(routes, run_id, proc.pid)
