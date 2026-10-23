def test_app_imports_on_python39_compatible_syntax():
    import app.main  # noqa: F401

    assert app.main.app is not None
