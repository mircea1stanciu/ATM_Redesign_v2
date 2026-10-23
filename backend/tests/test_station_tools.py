import asyncio
import hashlib
import io
import os
import tarfile
import zipfile

import httpx
import pytest

from app.services import scaffold_service
from app.services import station_tools_service as tools

FAKE_K6 = b"#!/bin/sh\necho 'k6 v9.9.9 (fake)'\n"


def _zip(name: str, data: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr(name, data)
    return buffer.getvalue()


def _tar(name: str, data: bytes) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tf:
        info = tarfile.TarInfo(name)
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def test_asset_names_per_platform():
    assert tools.k6_asset_name("v2.3.0", "Darwin", "arm64") == "k6-v2.3.0-macos-arm64.zip"
    assert tools.k6_asset_name("v2.3.0", "Darwin", "x86_64") == "k6-v2.3.0-macos-amd64.zip"
    assert tools.k6_asset_name("v2.3.0", "Linux", "aarch64") == "k6-v2.3.0-linux-arm64.tar.gz"
    assert tools.k6_asset_name("v2.3.0", "Windows", "AMD64") == "k6-v2.3.0-windows-amd64.zip"
    with pytest.raises(tools.ToolInstallError):
        tools.k6_asset_name("v2.3.0", "SunOS", "sparc")


def test_checksum_lookup_and_extraction():
    sums = "abc123  k6-v1-linux-amd64.tar.gz\nDEF456  k6-v1-macos-arm64.zip\n"
    assert tools.expected_checksum(sums, "k6-v1-macos-arm64.zip") == "def456"
    with pytest.raises(tools.ToolInstallError):
        tools.expected_checksum(sums, "k6-v1-windows-amd64.zip")
    assert tools.extract_binary(_zip("k6-v1-macos-arm64/k6", b"bin"), "x.zip", "k6") == b"bin"
    assert tools.extract_binary(_tar("k6-v1-linux-amd64/k6", b"bin"), "x.tar.gz", "k6") == b"bin"
    with pytest.raises(tools.ToolInstallError):
        tools.extract_binary(_zip("README.md", b"x"), "x.zip", "k6")


@pytest.mark.skipif(os.name == "nt", reason="the fake k6 is a shell script")
def test_install_downloads_verifies_and_is_found(tmp_path, monkeypatch):
    monkeypatch.setenv("ATM_TOOLS_DIR", str(tmp_path / "tools"))
    monkeypatch.setattr(scaffold_service.shutil, "which", lambda _name: None)
    asset = tools.k6_asset_name("v9.9.9")
    archive = _zip(f"k6-v9.9.9/{'k6'}", FAKE_K6) if asset.endswith(".zip") else _tar("k6-v9.9.9/k6", FAKE_K6)
    checksum = hashlib.sha256(archive).hexdigest()
    base = "https://github.com/grafana/k6/releases/download/v9.9.9/"

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == tools.K6_RELEASE_API:
            return httpx.Response(200, json={"tag_name": "v9.9.9", "assets": [
                {"name": asset, "browser_download_url": base + asset},
                {"name": "k6-v9.9.9-checksums.txt", "browser_download_url": base + "checksums"},
            ]})
        if url.endswith("checksums"):
            return httpx.Response(200, text=f"{checksum}  {asset}\n")
        if url.endswith(asset):
            return httpx.Response(200, content=archive, headers={"content-length": str(len(archive))})
        return httpx.Response(404)

    monkeypatch.setattr(tools, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert scaffold_service.tool_path("k6") is None
    log: list[str] = []
    path = asyncio.run(tools.install("k6", log.append))
    assert path == str(tmp_path / "tools" / "k6" / "k6")
    assert scaffold_service.tool_path("k6") == path
    assert any("Checksum verified" in line for line in log)
    assert any("k6 v9.9.9 (fake)" in line for line in log)
    # A second install is a no-op.
    assert asyncio.run(tools.install("k6", log.append)) == path


def test_install_rejects_a_bad_checksum(tmp_path, monkeypatch):
    monkeypatch.setenv("ATM_TOOLS_DIR", str(tmp_path / "tools"))
    asset = tools.k6_asset_name("v9.9.9")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == tools.K6_RELEASE_API:
            return httpx.Response(200, json={"tag_name": "v9.9.9", "assets": [
                {"name": asset, "browser_download_url": "https://x/" + asset},
                {"name": "k6-v9.9.9-checksums.txt", "browser_download_url": "https://x/sums"},
            ]})
        if url.endswith("sums"):
            return httpx.Response(200, text=f"{'0' * 64}  {asset}\n")
        return httpx.Response(200, content=b"tampered")

    monkeypatch.setattr(tools, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    with pytest.raises(tools.ToolInstallError, match="checksum"):
        asyncio.run(tools.install("k6", lambda _line: None))
    assert tools.managed_path("k6") is None


def test_verify_job_installs_missing_k6_first(tmp_path, monkeypatch):
    monkeypatch.setenv("ATM_TOOLS_DIR", str(tmp_path / "tools"))
    monkeypatch.setattr(scaffold_service.shutil, "which", lambda _name: None)
    folder = tmp_path / "starter"
    folder.mkdir()

    async def fake_install(tool, log):
        log(f"installed {tool}")
        raise tools.ToolInstallError("network blocked")

    monkeypatch.setattr(tools, "install", fake_install)

    async def scenario():
        job = scaffold_service.start_verify(9901, folder, "k6", "javascript")
        assert [s["label"] for s in job.steps] == ["Install k6", "Run smoke test"]
        for _ in range(50):
            if job.status != "running":
                break
            await asyncio.sleep(0.02)
        return job

    job = asyncio.run(scenario())
    assert job.status == "failed"
    assert job.steps[0]["status"] == "failed" and job.steps[1]["status"] == "pending"
    assert "✖ network blocked" in job.log

    catalog = scaffold_service.catalog()
    k6 = next(f for f in catalog["frameworks"] if f["id"] == "k6")["languages"][0]
    assert k6["missing_tools"] == [{"tool": "k6", "hint": scaffold_service._TOOL_HINTS["k6"], "installable": True}]
