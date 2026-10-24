"""Tools ATM can install itself on the station, without admin rights.

k6: the official release is downloaded from GitHub, its SHA-256 checksum verified, and the binary placed in ATM's
own tools folder (``~/.automationtestmanager/tools/<tool>/``, or ``$ATM_TOOLS_DIR``). Allure (phase 19): the
command line distribution from Maven Central, verified with its SHA-1 file; it needs a Java runtime, which ATM does not
install. Nothing is added to the system PATH; ATM finds the binaries through :func:`managed_path`.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import os
import platform
import stat
import subprocess
import tarfile
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path

import httpx

K6_RELEASE_API = "https://api.github.com/repos/grafana/k6/releases/latest"
ALLURE_MAVEN_PATH = "io/qameta/allure/allure-commandline"
INSTALLABLE = {"k6": "official release from github.com/grafana/k6",
               "allure": "Allure command line from Maven Central (needs Java)"}
# Tests replace this with httpx.MockTransport so no request leaves the process.
HTTP_TRANSPORT: httpx.AsyncBaseTransport | None = None
DOWNLOAD_TIMEOUT_SECONDS = 15 * 60

_install_lock = asyncio.Lock()


class ToolInstallError(Exception):
    pass


def tools_dir() -> Path:
    custom = os.environ.get("ATM_TOOLS_DIR", "").strip()
    return Path(custom).expanduser() if custom else Path.home() / ".automationtestmanager" / "tools"


def _binary_name(tool: str) -> str:
    return f"{tool}.exe" if os.name == "nt" else tool


def managed_path(tool: str) -> str | None:
    """The copy of ``tool`` installed by ATM, if any."""
    if tool not in INSTALLABLE:
        return None
    if tool == "allure":
        binary = tools_dir() / "allure" / "dist" / "bin" / ("allure.bat" if os.name == "nt" else "allure")
    else:
        binary = tools_dir() / tool / _binary_name(tool)
    return str(binary) if binary.is_file() and os.access(binary, os.X_OK) else None


def is_installable(tool: str) -> bool:
    if tool == "allure":
        return True
    return tool in INSTALLABLE and _k6_platform() is not None


def java_available() -> bool:
    """Allure's command line runs on Java: a java on the PATH, or under JAVA_HOME."""
    import shutil

    java_home = os.environ.get("JAVA_HOME", "").strip()
    return bool(shutil.which("java")) or bool(java_home and (Path(java_home) / "bin" / _binary_name("java")).is_file())


def _k6_platform(system: str | None = None, machine: str | None = None) -> tuple[str, str, str] | None:
    """(os, arch, archive extension) used in k6 release asset names, or None if unsupported."""
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    arch = {"x86_64": "amd64", "amd64": "amd64", "arm64": "arm64", "aarch64": "arm64"}.get(machine)
    if system == "darwin" and arch:
        return "macos", arch, "zip"
    if system == "linux" and arch:
        return "linux", arch, "tar.gz"
    if system == "windows" and arch:
        return "windows", "amd64", "zip"  # Only amd64 is published; Windows on ARM runs it emulated.
    return None


def k6_asset_name(tag: str, system: str | None = None, machine: str | None = None) -> str:
    target = _k6_platform(system, machine)
    if not target:
        raise ToolInstallError(f"k6 does not publish a build for {platform.system()} {platform.machine()}.")
    os_name, arch, ext = target
    return f"k6-{tag}-{os_name}-{arch}.{ext}"


def expected_checksum(checksums: str, asset: str) -> str:
    for line in checksums.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip("*") == asset:
            return parts[0].lower()
    raise ToolInstallError(f"The release has no checksum for {asset}.")


def extract_binary(archive: bytes, asset: str, binary: str) -> bytes:
    """Return the ``binary`` file found anywhere inside the zip / tar.gz ``archive``."""
    if asset.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            for name in zf.namelist():
                if name.rsplit("/", 1)[-1] == binary:
                    return zf.read(name)
    else:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
            for member in tf.getmembers():
                if member.isfile() and member.name.rsplit("/", 1)[-1] == binary:
                    extracted = tf.extractfile(member)
                    if extracted:
                        return extracted.read()
    raise ToolInstallError(f"{asset} does not contain '{binary}'.")


def _client() -> httpx.AsyncClient:
    from app.services.scaffold_service import station_ca_bundle

    bundle = station_ca_bundle()  # Trust the station's certificates (TLS-inspecting corporate proxies).
    return httpx.AsyncClient(verify=bundle or True, follow_redirects=True, transport=HTTP_TRANSPORT,
                             timeout=httpx.Timeout(60, read=120), headers={"User-Agent": "AutomationTestManager"})


async def install(tool: str, log: Callable[[str], None]) -> str:
    """Download and install ``tool`` into ATM's tools folder. Returns the binary path."""
    if tool not in INSTALLABLE:
        raise ToolInstallError(f"ATM cannot install '{tool}' automatically.")
    async with _install_lock:
        existing = managed_path(tool)
        if existing:
            log(f"{tool} is already installed at {existing}")
            return existing
        try:
            installer = _install_allure(log) if tool == "allure" else _install_k6(log)
            return await asyncio.wait_for(installer, timeout=DOWNLOAD_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as exc:
            minutes = DOWNLOAD_TIMEOUT_SECONDS // 60
            raise ToolInstallError(f"Downloading {tool} took longer than {minutes} minutes.") from exc
        except httpx.HTTPError as exc:
            source = "repo1.maven.org" if tool == "allure" else "github.com"
            raise ToolInstallError(f"Could not download {tool}: {exc}. Check that {source} is reachable "
                                   "from this station, or install it manually.") from exc


async def _install_k6(log: Callable[[str], None]) -> str:
    async with _client() as client:
        log("Looking up the latest k6 release on GitHub…")
        response = await client.get(K6_RELEASE_API, headers={"Accept": "application/vnd.github+json"})
        response.raise_for_status()
        release = response.json()
        tag = release.get("tag_name") or ""
        asset_name = k6_asset_name(tag)
        assets = {a.get("name"): a.get("browser_download_url") for a in release.get("assets") or []}
        url, checksums_url = assets.get(asset_name), assets.get(f"k6-{tag}-checksums.txt")
        if not url or not checksums_url:
            raise ToolInstallError(f"The k6 {tag} release has no {asset_name} download.")

        checksums = (await client.get(checksums_url)).raise_for_status().text
        expected = expected_checksum(checksums, asset_name)

        log(f"Downloading {asset_name}…")
        buffer = bytearray()
        async with client.stream("GET", url) as stream:
            stream.raise_for_status()
            total = int(stream.headers.get("content-length") or 0)
            next_report = 25
            async for chunk in stream.aiter_bytes():
                buffer.extend(chunk)
                if total and len(buffer) * 100 // total >= next_report:
                    log(f"  {len(buffer) * 100 // total}% of {total / 1_048_576:.1f} MB")
                    next_report += 25
        archive = bytes(buffer)

    if hashlib.sha256(archive).hexdigest() != expected:
        raise ToolInstallError(f"{asset_name} failed its checksum verification; nothing was installed.")
    log("Checksum verified (SHA-256).")

    binary = _binary_name("k6")
    data = await asyncio.to_thread(extract_binary, archive, asset_name, binary)
    target_dir = tools_dir() / "k6"
    target_dir.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(dir=target_dir, prefix=".k6-")
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    os.chmod(temp_name, os.stat(temp_name).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    target = target_dir / binary
    os.replace(temp_name, target)

    version = await asyncio.to_thread(
        subprocess.run, [str(target), "version"], capture_output=True, text=True, timeout=30, check=False)
    if version.returncode != 0:
        raise ToolInstallError(f"The downloaded k6 does not start: {(version.stderr or version.stdout).strip()}")
    log(f"Installed {version.stdout.strip().splitlines()[0] if version.stdout.strip() else 'k6 ' + tag} at {target}")
    return str(target)


def maven_base() -> str:
    from app.core.config import settings

    return settings.ATM_MAVEN_BASE_URL.rstrip("/")


def allure_latest_version(metadata: str) -> str:
    """The <release> (or last <version>) of Maven's metadata for allure-commandline."""
    import re

    release = re.search(r"<release>([^<]+)</release>", metadata)
    versions = re.findall(r"<version>([^<]+)</version>", metadata)
    version = release.group(1) if release else (versions[-1] if versions else "")
    if not version:
        raise ToolInstallError("Maven Central lists no Allure version.")
    return version.strip()


def extract_allure(archive: bytes, target: Path) -> Path:
    """Unpack the distribution (allure-<version>/bin/allure, lib/...) into ``target`` and return its bin script."""
    import shutil

    staging = target.with_name(target.name + ".new")
    shutil.rmtree(staging, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for member in bundle.infolist():
            path = (staging / member.filename).resolve()
            if staging.resolve() not in path.parents and path != staging.resolve():
                raise ToolInstallError(f"The Allure archive has an unsafe path: {member.filename}")
        bundle.extractall(staging)
    roots = [p for p in staging.iterdir() if p.is_dir()]
    if len(roots) != 1 or not (roots[0] / "bin").is_dir():
        raise ToolInstallError("The Allure archive does not look like the command line distribution.")
    for script in (roots[0] / "bin").iterdir():
        script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    shutil.rmtree(target, ignore_errors=True)
    roots[0].rename(target)
    shutil.rmtree(staging, ignore_errors=True)
    return target / "bin" / ("allure.bat" if os.name == "nt" else "allure")


async def _install_allure(log: Callable[[str], None]) -> str:
    base = f"{maven_base()}/{ALLURE_MAVEN_PATH}"
    async with _client() as client:
        log("Looking up the latest Allure command line on Maven Central…")
        version = allure_latest_version((await client.get(f"{base}/maven-metadata.xml")).raise_for_status().text)
        name = f"allure-commandline-{version}.zip"
        expected = (await client.get(f"{base}/{version}/{name}.sha1")).raise_for_status().text.split()[0].strip()
        log(f"Downloading {name}…")
        archive = (await client.get(f"{base}/{version}/{name}")).raise_for_status().content
    if hashlib.sha1(archive).hexdigest() != expected.lower():  # noqa: S324 - Maven Central publishes SHA-1
        raise ToolInstallError(f"{name} failed its checksum verification; nothing was installed.")
    log("Checksum verified (SHA-1, as published on Maven Central).")
    target = tools_dir() / "allure" / "dist"
    target.parent.mkdir(parents=True, exist_ok=True)
    binary = await asyncio.to_thread(extract_allure, archive, target)
    log(f"Installed Allure {version} at {binary}")
    if not java_available():
        log("Java was not found: install a Java runtime (for example Eclipse Temurin 21) so Allure can generate "
            "reports.")
    return str(binary)
