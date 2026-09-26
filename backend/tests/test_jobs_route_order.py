"""Jobs router registration order and jobs-page URL checks.

Importing the application pulls in Celery, Mongo, and mail clients, so this
test reads the route module as source and replays the GET paths on a tiny
FastAPI app. That is enough to prove literal paths are not captured by
/{job_id}.
"""

import ast
from pathlib import Path

from fastapi import FastAPI
from starlette.routing import Match

REPO_ROOT = Path(__file__).resolve().parents[2]
JOBS_API = REPO_ROOT / "backend" / "app" / "api" / "jobs.py"
JOBS_PAGE = REPO_ROOT / "frontend" / "assets" / "js" / "pages" / "jobs.js"

STATIC_GET_PATHS = ("/matched/me", "/saved/me", "/stats/overview")


def _router_get_paths(source: str) -> list:
    tree = ast.parse(source)
    paths = []
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for deco in node.decorator_list:
            if not isinstance(deco, ast.Call):
                continue
            func = deco.func
            if not isinstance(func, ast.Attribute):
                continue
            if not isinstance(func.value, ast.Name) or func.value.id != "router":
                continue
            if func.attr != "get":
                continue
            if not deco.args or not isinstance(deco.args[0], ast.Constant):
                continue
            paths.append(deco.args[0].value)
    return paths


def test_literal_job_gets_are_registered_before_job_id():
    paths = _router_get_paths(JOBS_API.read_text())
    job_id_index = paths.index("/{job_id}")
    for static_path in STATIC_GET_PATHS:
        assert paths.index(static_path) < job_id_index


def test_fastapi_matches_literal_job_paths():
    paths = _router_get_paths(JOBS_API.read_text())
    app = FastAPI()
    for path in paths:
        app.get(path)(lambda: None)

    def winning_route(path: str):
        scope = {"type": "http", "path": path, "method": "GET"}
        for route in app.router.routes:
            if not hasattr(route, "matches"):
                continue
            match, _child = route.matches(scope)
            if match == Match.FULL:
                return route.path
        return None

    for static_path in STATIC_GET_PATHS:
        assert winning_route(static_path) == static_path

    assert winning_route("/507f1f77bcf86cd799439011") == "/{job_id}"


def test_jobs_page_urls_have_no_embedded_spaces():
    source = JOBS_PAGE.read_text()
    assert " /api/v1 " not in source
    assert " /auth/gmail " not in source
    assert "/api/v1/documents/?document_type=cv" in source
    assert "/api/v1/applications/stats/overview" in source
    assert "/auth/gmail/connect" in source
