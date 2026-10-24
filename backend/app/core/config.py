from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    APP_ENV: str = "development"
    # Signs access tokens. Set a long random value in backend/.env; the default only suits a single dev station.
    SECRET_KEY: str = "unifiedwork-secret-key-change-in-production"
    # Encrypts personal tokens at rest (user_connections). Changing it makes stored tokens unreadable.
    # Without it the key is derived from SECRET_KEY.
    ATM_SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Database. ATM_DATABASE_URL wins; otherwise the SQLite file ATM_DATABASE_PATH (default backend/unifiedwork.db).
    # DATABASE_URL is deliberately not read: it belonged to the removed second backend and pointed at Postgres.
    ATM_DATABASE_URL: str = ""
    ATM_DATABASE_PATH: str = ""
    ATM_DB_POOL_SIZE: int = 10
    ATM_DB_MAX_OVERFLOW: int = 20
    # Suite schedules: checked every N seconds by the in-process scheduler (off in the backend tests).
    ATM_SCHEDULER_ENABLED: bool = True
    ATM_SCHEDULER_INTERVAL_SECONDS: int = 30
    # How people reach ATM (for links in Confluence pages). Empty: the address the publisher used.
    ATM_PUBLIC_URL: str = ""

    # Creates the first super admin "admin" on a database without one (development only).
    ATM_DEV_ADMIN_PASSWORD: str = ""

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Fallback integration settings when a user has none of their own
    GITHUB_TOKEN: str = ""
    GITHUB_MCP_BASE_URL: str = ""  # e.g. https://github.com/org/repo.git
    JIRA_TOKEN: str = ""
    JIRA_MCP_BASE_URL: str = ""  # e.g. https://your-domain.atlassian.net
    JIRA_PROJECT_KEY: str = ""
    JIRA_PROJECT_NAME: str = ""
    CONFLUENCE_TOKEN: str = ""
    CONFLUENCE_MCP_BASE_URL: str = ""  # e.g. https://your-domain.atlassian.net/wiki
    CONFLUENCE_SPACE_KEY: str = ""

    # GitHub Models (the "GitHub Copilot" AI provider). Only GitHub Enterprise setups and the UI tests change it.
    ATM_GITHUB_MODELS_BASE_URL: str = "https://models.github.ai"
    CONFLUENCE_SPACE_NAME: str = ""
    ZEPHYR_PROJECT_KEY: str = ""  # Selected Jira project for Zephyr
    ZEPHYR_SELECTED_FOLDER_ID: str = ""  # Selected test folder/cycle ID

    # Run artifacts storage
    ARTIFACTS_DIR: str = "/tmp/testmanager/artifacts"

    # Mobile devices (Android emulators / iOS simulators on the backend host)
    ANDROID_SDK_ROOT: str = ""  # empty -> ANDROID_SDK_ROOT/ANDROID_HOME env or default SDK location

    # AI assistant: defaults pre-filled for the Azure OpenAI provider (each user enters their own API key)
    AZURE_OPENAI_ENDPOINT: str = "https://rbro-sandbox-openai.openai.azure.com/openai/v1"
    AZURE_OPENAI_DEPLOYMENT: str = "gpt-5.6-terra"
    # Deployments users may choose (the models deployed on the company resource)
    AZURE_OPENAI_DEPLOYMENTS: list[str] = [
        "gpt-4.1", "gpt-4o-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.4", "gpt-5.6-terra", "o4-mini",
    ]
    # AI assistant: RBI GenAI LLM Gateway (sign-in with the user's RBI account; prod | uat | sbox)
    RBI_GENAI_DEFAULT_ENVIRONMENT: str = "prod"
    RBI_GENAI_DEFAULT_MODEL: str = "claude-sonnet-4-6"

    # Local repository working copies (server-side managed git checkouts)
    LOCAL_REPOS_DIR: str = ""  # empty -> defaults to <backend>/local_repos

    @property
    def database_url(self) -> str:
        if self.ATM_DATABASE_URL:
            return self.ATM_DATABASE_URL
        path = self.ATM_DATABASE_PATH or str(BACKEND_DIR / "unifiedwork.db")
        return f"sqlite:///{path}"


settings = Settings()
