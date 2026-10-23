from app.services.test_run_service import TestRunService


class TestBrunoCommandBuilder:
    def test_build_bruno_command_with_project_collection_environment(self):
        command, working_dir = TestRunService._build_bruno_command(
            run_project="athena",
            run_collection="athena/smoke",
            run_environment="dev",
        )

        assert command is not None
        assert "mkdir -p results-athena &&" in command
        assert "bru run -r --sandbox developer" in command
        assert "--env-file environments/dev.bru" in command
        assert "--reporter-html results-athena/smoke-dev-" in command
        assert command.endswith(".html")
        assert working_dir == "/workspace/athena/smoke"

    def test_build_bruno_command_requires_collection_and_environment(self):
        command, working_dir = TestRunService._build_bruno_command(
            run_project="athena",
            run_collection="",
            run_environment="",
        )

        assert command is None
        assert working_dir is None
