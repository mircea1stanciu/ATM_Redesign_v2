import asyncio
import os
import tempfile
from typing import Optional

import docker

from app.core.config import settings
from app.services.framework_detector import FrameworkDetector, TestFramework


class DockerTestRunner:
    """Execute tests in isolated Docker containers."""
    
    def __init__(self):
        self.client = docker.from_env()
    
    async def clone_repository(self, git_url: str, branch: str = "main") -> str:
        """
        Clone Git repository to temporary directory.
        
        Args:
            git_url: Git repository URL
            branch: Branch to clone
            
        Returns:
            Path to cloned repository
        """
        temp_dir = tempfile.mkdtemp()
        
        # Run git clone in background
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            self._run_git_clone,
            git_url,
            branch,
            temp_dir
        )
        
        return temp_dir
    
    @staticmethod
    def _run_git_clone(git_url: str, branch: str, target_dir: str) -> None:
        """Run git clone synchronously."""
        import subprocess
        cmd = ["git", "clone", "--branch", branch, "--depth", "1", git_url, target_dir]
        subprocess.run(cmd, check=True, capture_output=True)
    
    async def run_tests(
        self,
        framework: TestFramework,
        repo_path: str,
        test_path: str = ".",
        timeout: int = 600,
        environment: Optional[dict[str, str]] = None,
        custom_command: Optional[str] = None,
        working_dir: Optional[str] = None,
    ) -> tuple[int, str, str]:
        """
        Run tests in a Docker container.
        
        Args:
            framework: Test framework to use
            repo_path: Path to repository with tests
            test_path: Path to tests within repository
            timeout: Timeout in seconds
            environment: Environment variables to pass to container
            
        Returns:
            Tuple of (exit_code, stdout, stderr)
        """
        # Select Docker image based on framework
        image = self._get_docker_image(framework)
        
        # Build run command
        run_cmd = custom_command or FrameworkDetector.get_run_command(framework, test_path)
        install_cmd = FrameworkDetector.get_install_command(framework)

        full_cmd = run_cmd
        if framework == TestFramework.BRUNO and install_cmd:
            full_cmd = f"{install_cmd} && {run_cmd}"

        # Use a shell command to support chained install + run commands.
        container_cmd = ["/bin/sh", "-lc", full_cmd]
        
        # Container environment
        container_env = environment or {}
        container_env.update({
            "CI": "true",
            "CI_COMMIT_SHA": "",
        })
        
        try:
            # Run container
            container = self.client.containers.run(
                image,
                container_cmd,
                volumes={repo_path: {"bind": "/workspace", "mode": "rw"}},
                working_dir=working_dir or "/workspace",
                environment=container_env,
                mem_limit=settings.DOCKER_RUNNER_MEM_LIMIT,
                network_mode=settings.DOCKER_RUNNER_NETWORK,
                detach=True,
                remove=False,  # Keep container for debugging
            )
            
            # Wait for completion with timeout
            loop = asyncio.get_event_loop()
            exit_code = await asyncio.wait_for(
                loop.run_in_executor(None, container.wait),
                timeout=timeout
            )
            
            # Get logs
            logs = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")
            
            # Split stdout/stderr if possible
            stdout = logs
            stderr = ""
            
            return exit_code, stdout, stderr
            
        except asyncio.TimeoutError:
            # Kill container if timeout
            try:
                container.kill()
            except Exception:
                pass
            raise TimeoutError(f"Test execution timed out after {timeout} seconds")
        
        except Exception as e:
            raise RuntimeError(f"Failed to run tests in Docker: {str(e)}")
    
    @staticmethod
    def _get_docker_image(framework: TestFramework) -> str:
        """Get appropriate Docker image for framework."""
        images = {
            TestFramework.PYTEST: "python:3.11-slim",
            TestFramework.PLAYWRIGHT: "mcr.microsoft.com/playwright:v1.40.0-focal",
            TestFramework.APPIUM: "node:20-bullseye",
            TestFramework.CYPRESS: "cypress/base:latest",
            TestFramework.ROBOT: "python:3.11-slim",
            TestFramework.BRUNO: "node:20-bullseye",
            TestFramework.JUNIT: "maven:3.8-openjdk-11",
        }
        return images.get(framework, "python:3.11-slim")
    
    def cleanup(self, repo_path: str) -> None:
        """Clean up temporary repository directory."""
        import shutil
        try:
            shutil.rmtree(repo_path)
        except Exception as e:
            print(f"Failed to cleanup {repo_path}: {e}")


class TestRunEnvironment:
    """Manage test run environment and artifacts."""
    
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.artifacts_dir = self._setup_artifacts_dir()
    
    def _setup_artifacts_dir(self) -> str:
        """Create artifacts directory for this run."""
        run_dir = os.path.join(settings.ARTIFACTS_DIR, self.run_id)
        os.makedirs(run_dir, exist_ok=True)
        return run_dir
    
    def save_artifact(self, filename: str, content: bytes) -> str:
        """
        Save artifact file for test run.
        
        Args:
            filename: Name of artifact file
            content: File content
            
        Returns:
            Path to saved artifact
        """
        file_path = os.path.join(self.artifacts_dir, filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        return file_path
    
    def get_artifact_path(self, filename: str) -> str:
        """Get path to artifact file."""
        return os.path.join(self.artifacts_dir, filename)
