from app.services.github_overview_service import analyze_tree, language_shares, summarize_package_json, summarize_pom

POM = """
<project>
  <artifactId>athena-appium</artifactId>
  <properties>
    <java.version>21</java.version>
    <java-client.version>9.5.0</java-client.version>
  </properties>
  <dependency><groupId>io.appium</groupId></dependency>
  <dependency><groupId>io.cucumber</groupId></dependency>
  <dependency><groupId>org.testng</groupId></dependency>
  <dependency><groupId>io.qameta.allure</groupId></dependency>
</project>
"""

APPIUM_TREE = [
    "pom.xml",
    "README.md",
    ".github/workflows/regression.yml",
    "src/test/java/com/x/runners/SanityRunner.java",
    "src/test/java/com/x/pages/LoginPage.java",
    "src/test/resources/features/Login.feature",
    "src/test/resources/features/Payments.feature",
    "src/test/resources/envProp.properties",
    "target/classes/envProp.properties",
    "target/surefire-reports/TEST-x.xml",
]


def test_appium_maven_repository_is_summarised():
    result = analyze_tree(APPIUM_TREE, POM)

    assert result["frameworks"] == ["Appium", "Cucumber", "TestNG", "Allure"]
    assert result["build_tools"] == ["Maven"]
    assert result["test_files"] == {
        "Cucumber feature files": 2,
        "Cucumber runners (Java)": 1,
        "Java test classes": 2,
    }
    assert result["properties_files"] == ["src/test/resources/envProp.properties"]
    assert result["workflows"] == ["regression.yml"]
    assert result["has_readme"] is True
    assert result["maven"]["java_release"] == "21"
    assert result["maven"]["appium_java_client"] == "9.5.0"
    assert result["files_count"] == 8  # target/ is ignored


def test_bruno_repository_lists_collections():
    tree = [
        "api/bruno.json",
        "api/environments/pre.bru",
        "api/environments/test.bru",
        "api/payments/create.bru",
        "api/payments/list.bru",
    ]
    result = analyze_tree(tree)
    assert "Bruno" in result["frameworks"]
    assert "Bruno" in result["build_tools"]
    assert result["test_files"] == {"Bruno requests": 2}
    assert result["collections"] == ["api"]


def test_package_json_test_libraries():
    package = summarize_package_json('{"name": "web", "devDependencies": {"@playwright/test": "^1.48.0"},'
                                     ' "scripts": {"test": "playwright test"}}')
    assert package == {"name": "web", "test_libraries": {"Playwright": "^1.48.0"}, "scripts": ["test"]}
    assert summarize_package_json("not json") == {}


def test_pom_without_appium():
    assert summarize_pom("<project><dependency>org.junit</dependency></project>")["stacks"] == ["JUnit"]


def test_language_shares():
    assert language_shares({"Java": 750, "Gherkin": 250}) == [
        {"name": "Java", "percent": 75.0},
        {"name": "Gherkin", "percent": 25.0},
    ]
    assert language_shares({}) == []
