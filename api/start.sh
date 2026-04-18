#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a
source .env
set +a
# Clear stale __pycache__ to prevent routing drift caused by Python
# reusing old compiled bytecode when mtime heuristics get confused.
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
# Disable bytecode write so pycache can't drift out of sync again.
export PYTHONDONTWRITEBYTECODE=1
exec uvicorn main:app --host 0.0.0.0 --port 8403 --reload
