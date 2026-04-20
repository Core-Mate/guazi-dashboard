#!/usr/bin/env bash
TEST_ENV="${TEST_ENV:-local}"
case "$TEST_ENV" in
  local)
    export E2E_API_BASE="${E2E_API_BASE:-http://localhost:8403}"
    export E2E_FRONTEND_URL="${E2E_FRONTEND_URL:-http://localhost:8402}"
    export E2E_LOGIN_PHONE="${E2E_LOGIN_PHONE:-13800138001}"
    export E2E_LOGIN_CODE="${E2E_LOGIN_CODE:-123456}"
    export E2E_TENANT_ID="${E2E_TENANT_ID:-1}"
    ;;
  staging|prod)
    : "${E2E_API_BASE:?must set E2E_API_BASE for $TEST_ENV}"
    : "${E2E_FRONTEND_URL:?must set E2E_FRONTEND_URL for $TEST_ENV}"
    : "${E2E_LOGIN_PHONE:?must set E2E_LOGIN_PHONE for $TEST_ENV}"
    : "${E2E_LOGIN_CODE:?must set E2E_LOGIN_CODE for $TEST_ENV}"
    : "${E2E_TENANT_ID:?must set E2E_TENANT_ID for $TEST_ENV}"
    ;;
  *)
    echo "Unknown TEST_ENV: $TEST_ENV (expected local|staging|prod)" >&2
    exit 1 ;;
esac
echo "[e2e] env=$TEST_ENV api=$E2E_API_BASE frontend=$E2E_FRONTEND_URL tenant=$E2E_TENANT_ID"
