#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a
source .env
set +a
exec uvicorn main:app --host 0.0.0.0 --port 8403 --reload
