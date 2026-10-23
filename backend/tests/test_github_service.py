from app.core.config import settings
from app.services.github_service import GitHubService


class TestGitHubService:
    """Test suite for GitHub service."""
    
    def test_parse_github_url_https(self):
        """Test parsing HTTPS GitHub URL."""
        url = "https://github.com/microsoft/vscode.git"
        owner, repo = GitHubService.parse_github_url(url)
        assert owner == "microsoft"
        assert repo == "vscode"
    
    def test_parse_github_url_https_no_git_suffix(self):
        """Test parsing HTTPS GitHub URL without .git suffix."""
        url = "https://github.com/microsoft/vscode"
        owner, repo = GitHubService.parse_github_url(url)
        assert owner == "microsoft"
        assert repo == "vscode"
    
    def test_parse_github_url_ssh(self):
        """Test parsing SSH GitHub URL."""
        url = "git@github.com:microsoft/vscode.git"
        owner, repo = GitHubService.parse_github_url(url)
        assert owner == "microsoft"
        assert repo == "vscode"
    
    def test_parse_github_url_ssh_no_git_suffix(self):
        """Test parsing SSH GitHub URL without .git suffix."""
        url = "git@github.com:microsoft/vscode"
        owner, repo = GitHubService.parse_github_url(url)
        assert owner == "microsoft"
        assert repo == "vscode"
    
    def test_parse_invalid_github_url(self):
        """Test parsing invalid GitHub URL raises ValueError."""
        url = "https://not-github.com/owner/repo"
        try:
            GitHubService.parse_github_url(url)
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "Invalid GitHub URL" in str(e)

    def test_parse_enterprise_https_url(self):
        """Test parsing HTTPS GitHub Enterprise URL when configured."""
        original = settings.GITHUB_MCP_BASE_URL
        settings.GITHUB_MCP_BASE_URL = "https://code.rbi.tech/"
        try:
            owner, repo = GitHubService.parse_github_url("https://code.rbi.tech/raiffeisen/rbro-athena-api-test-automation")
            assert owner == "raiffeisen"
            assert repo == "rbro-athena-api-test-automation"
        finally:
            settings.GITHUB_MCP_BASE_URL = original

    def test_parse_enterprise_ssh_url(self):
        """Test parsing SSH GitHub Enterprise URL when configured."""
        original = settings.GITHUB_MCP_BASE_URL
        settings.GITHUB_MCP_BASE_URL = "https://code.rbi.tech/"
        try:
            owner, repo = GitHubService.parse_github_url(
                "git@code.rbi.tech:raiffeisen/rbro-athena-api-test-automation.git"
            )
            assert owner == "raiffeisen"
            assert repo == "rbro-athena-api-test-automation"
        finally:
            settings.GITHUB_MCP_BASE_URL = original
    
    def test_github_service_initialization(self):
        """Test GitHub service initialization."""
        original = settings.GITHUB_MCP_BASE_URL
        settings.GITHUB_MCP_BASE_URL = ""
        service = GitHubService()
        assert service.base_url == "https://api.github.com"
        assert "Accept" in service.headers
        assert service.headers["Accept"] == "application/vnd.github.v3+json"
        settings.GITHUB_MCP_BASE_URL = original

    def test_github_service_initialization_enterprise_base_url(self):
        """Test API base URL resolution for GitHub Enterprise."""
        original = settings.GITHUB_MCP_BASE_URL
        settings.GITHUB_MCP_BASE_URL = "https://code.rbi.tech/"
        try:
            service = GitHubService()
            assert service.base_url == "https://code.rbi.tech/api/v3"
        finally:
            settings.GITHUB_MCP_BASE_URL = original
