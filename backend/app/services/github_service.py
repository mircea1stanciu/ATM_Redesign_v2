import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import settings


class GitHubService:
    """Service for interacting with GitHub API."""
    
    def __init__(self):
        self.base_url = self._resolve_api_base_url(settings.GITHUB_MCP_BASE_URL)
        self.token = settings.GITHUB_TOKEN
        self.headers = {
            "Authorization": f"token {self.token}" if self.token else "",
            "Accept": "application/vnd.github.v3+json",
        }

    @staticmethod
    def _resolve_api_base_url(configured_base_url: str) -> str:
        """Resolve API base URL for GitHub.com or GitHub Enterprise."""
        if not configured_base_url:
            return "https://api.github.com"

        parsed = urlparse(configured_base_url)
        if not parsed.scheme or not parsed.netloc:
            return "https://api.github.com"

        host = parsed.netloc.lower()
        path = (parsed.path or "").strip("/")

        # Public GitHub.
        if host == "github.com" or host.endswith(".github.com"):
            return "https://api.github.com"

        # GitHub Enterprise API root.
        if path.startswith("api/v3"):
            return f"{parsed.scheme}://{parsed.netloc}/{path}"
        return f"{parsed.scheme}://{parsed.netloc}/api/v3"
    
    @staticmethod
    def parse_github_url(git_repo_url: str) -> tuple[str, str]:
        """
        Parse GitHub URL to extract owner and repo name.
        Supports formats:
        - https://github.com/owner/repo.git
        - https://github.com/owner/repo
        - git@github.com:owner/repo.git
        - git@github.com:owner/repo
        """
        configured_host = ""
        if settings.GITHUB_MCP_BASE_URL:
            parsed_cfg = urlparse(settings.GITHUB_MCP_BASE_URL)
            configured_host = parsed_cfg.netloc.lower()

        allowed_hosts = {"github.com"}
        if configured_host:
            allowed_hosts.add(configured_host)

        # Handle SSH URLs: git@host:owner/repo(.git)
        ssh_match = re.match(r"^git@([^:]+):([^/]+)/(.+)$", git_repo_url)
        if ssh_match:
            ssh_host = ssh_match.group(1).lower()
            if ssh_host not in allowed_hosts:
                raise ValueError(f"Invalid GitHub URL: {git_repo_url}")
            owner = ssh_match.group(2)
            repo = ssh_match.group(3)
            if repo.endswith(".git"):
                repo = repo[:-4]
            return owner, repo
        
        # Remove .git suffix if present
        if git_repo_url.endswith(".git"):
            git_repo_url = git_repo_url[:-4]
        
        parsed = urlparse(git_repo_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"Invalid GitHub URL: {git_repo_url}")

        host = parsed.netloc.lower()
        if host == "www.github.com":
            host = "github.com"
        if host not in allowed_hosts:
            raise ValueError(f"Invalid GitHub URL: {git_repo_url}")

        path_parts = [p for p in parsed.path.strip("/").split("/") if p]
        if len(path_parts) < 2:
            raise ValueError(f"Invalid GitHub URL: {git_repo_url}")

        owner, repo = path_parts[0], path_parts[1]
        if repo.endswith(".git"):
            repo = repo[:-4]
        return owner, repo
    
    async def get_branches(self, owner: str, repo: str) -> list[dict[str, Any]]:
        """
        Get list of branches for a GitHub repository.
        
        Returns:
            List of branches with name, commit SHA, and whether it's default.
        """
        async with httpx.AsyncClient() as client:
            url = f"{self.base_url}/repos/{owner}/{repo}/branches"
            try:
                response = await client.get(
                    url,
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                
                branches = response.json()
                
                # Get default branch info
                default_branch = await self._get_default_branch(owner, repo, client)
                
                return [
                    {
                        "name": branch["name"],
                        "commit_sha": branch["commit"]["sha"],
                        "is_default": branch["name"] == default_branch,
                    }
                    for branch in branches
                ]
            except httpx.HTTPError as e:
                raise ValueError(f"Failed to fetch branches: {str(e)}")
    
    async def get_tags(self, owner: str, repo: str) -> list[dict[str, Any]]:
        """
        Get list of tags for a GitHub repository.
        
        Returns:
            List of tags with name and commit SHA.
        """
        async with httpx.AsyncClient() as client:
            url = f"{self.base_url}/repos/{owner}/{repo}/tags"
            try:
                response = await client.get(
                    url,
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                
                tags = response.json()
                return [
                    {
                        "name": tag["name"],
                        "commit_sha": tag["commit"]["sha"],
                    }
                    for tag in tags
                ]
            except httpx.HTTPError as e:
                raise ValueError(f"Failed to fetch tags: {str(e)}")
    
    async def _get_default_branch(
        self, owner: str, repo: str, client: httpx.AsyncClient
    ) -> str:
        """Get the default branch name for a repository."""
        try:
            url = f"{self.base_url}/repos/{owner}/{repo}"
            response = await client.get(
                url,
                headers=self.headers,
                timeout=10.0
            )
            response.raise_for_status()
            repo_data = response.json()
            return repo_data.get("default_branch", "main")
        except httpx.HTTPError:
            return "main"
    
    async def get_repository_info(self, owner: str, repo: str) -> dict[str, Any]:
        """
        Get repository information from GitHub.
        
        Returns:
            Repository metadata including description, URL, stars, etc.
        """
        async with httpx.AsyncClient() as client:
            url = f"{self.base_url}/repos/{owner}/{repo}"
            try:
                response = await client.get(
                    url,
                    headers=self.headers,
                    timeout=10.0
                )
                response.raise_for_status()
                
                repo_data = response.json()
                return {
                    "name": repo_data.get("name"),
                    "description": repo_data.get("description"),
                    "url": repo_data.get("html_url"),
                    "stars": repo_data.get("stargazers_count"),
                    "default_branch": repo_data.get("default_branch"),
                    "language": repo_data.get("language"),
                    "is_private": repo_data.get("private"),
                }
            except httpx.HTTPError as e:
                raise ValueError(f"Failed to fetch repository info: {str(e)}")
    
    async def check_repository_exists(self, git_repo_url: str) -> bool:
        """Check if a GitHub repository exists and is accessible."""
        try:
            owner, repo = self.parse_github_url(git_repo_url)
            await self.get_repository_info(owner, repo)
            return True
        except (ValueError, Exception):
            return False
