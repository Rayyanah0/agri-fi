#!/usr/bin/env bash
#
# Self-healing staging validation (#1194)
#
# Runs the acceptance checks for the self-healing engine against a staging
# environment. The production rollout of an automation is only allowed once
# this script succeeds, because the safety policy refuses to run an action
# in production before it has been validated in staging.
#
# Usage:
#   SELF_HEALING_API_URL=https://staging.api.agri-fi.example.com \
#   SELF_HEALING_API_TOKEN=<operator token> \
#   PROMETHEUS_URL=http://prometheus.staging.svc:9090 \
#   ./devops/scripts/self-healing-validate.sh
#
# Exit code 0 means every check passed.

set -uo pipefail

API_URL="${SELF_HEALING_API_URL:-http://localhost:3001}"
API_TOKEN="${SELF_HEALING_API_TOKEN:-}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
NAMESPACE="${SELF_HEALING_NAMESPACE:-agri-fi}"

FAILURES=0
CHECKS=0

pass() {
  CHECKS=$((CHECKS + 1))
  printf '  \033[32mPASS\033[0m %s\n' "$1"
}

fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  printf '  \033[31mFAIL\033[0m %s\n' "$1"
}

section() {
  printf '\n== %s ==\n' "$1"
}

api() {
  local path="$1"
  if [ -n "$API_TOKEN" ]; then
    curl -sS -H "Authorization: Bearer ${API_TOKEN}" "${API_URL}${path}"
  else
    curl -sS "${API_URL}${path}"
  fi
}

section "1. Configuration"

if [ -z "$API_TOKEN" ]; then
  fail "SELF_HEALING_API_TOKEN is not set (the admin endpoints require a token)"
else
  pass "SELF_HEALING_API_TOKEN is set"
fi

if [ "$NAMESPACE" = "agri-fi" ]; then
  pass "namespace '${NAMESPACE}' is configured"
else
  fail "namespace '${NAMESPACE}' does not look like the staging namespace"
fi

section "2. Self-healing API"

STATUS_JSON="$(api /v1/admin/self-healing/status)"
if printf '%s' "$STATUS_JSON" | grep -q '"enabled":true'; then
  pass "the self-healing automation is enabled in this environment"
else
  fail "the self-healing automation is disabled (${STATUS_JSON})"
fi

if printf '%s' "$STATUS_JSON" | grep -q '"environment":"staging"'; then
  pass "the engine reports the staging environment"
else
  fail "the engine does not run in the staging environment (${STATUS_JSON})"
fi

section "3. Detection"

ALERTS_JSON="$(curl -sS "${PROMETHEUS_URL}/api/v1/alerts" 2>/dev/null || echo '{}')"
SELF_HEALING_ALERTS="$(printf '%s' "$ALERTS_JSON" | grep -c 'self_healing' || true)"
if [ "${SELF_HEALING_ALERTS}" -gt 0 ]; then
  pass "Prometheus exposes ${SELF_HEALING_ALERTS} self-healing alert label(s)"
else
  fail "no alert carries the self_healing label; check the Prometheus rule files"
fi

if curl -sS "${PROMETHEUS_URL}/api/v1/rules" 2>/dev/null | grep -q 'SelfHealing'; then
  pass "the self-healing rule group is loaded by Prometheus"
else
  fail "the self-healing rule group is not loaded by Prometheus"
fi

section "4. Safety policies"

POLICIES_JSON="$(api /v1/admin/self-healing/policies)"
if printf '%s' "$POLICIES_JSON" | grep -q 'restart-pod-default'; then
  pass "the default remediation policies are registered"
else
  fail "the default remediation policies are missing (${POLICIES_JSON})"
fi

if printf '%s' "$POLICIES_JSON" | grep -q '"stagingValidated":true'; then
  pass "at least one policy has been validated in staging"
else
  fail "no policy has been validated in staging yet; production is blocked"
fi

section "5. Remediation history"

HISTORY_JSON="$(api /v1/admin/self-healing/history?limit=5)"
if printf '%s' "$HISTORY_JSON" | grep -q '"meta"'; then
  pass "the remediation history is readable"
else
  fail "the remediation history could not be read (${HISTORY_JSON})"
fi

section "6. Analytics"

ANALYTICS_JSON="$(api /v1/admin/self-healing/analytics?hours=24)"
if printf '%s' "$ANALYTICS_JSON" | grep -q 'successRate'; then
  pass "the remediation analytics are available"
else
  fail "the remediation analytics could not be read (${ANALYTICS_JSON})"
fi

section "Summary"

printf '  checks: %d, failures: %d\n' "$CHECKS" "$FAILURES"

if [ "$FAILURES" -gt 0 ]; then
  printf '\n\033[31mSelf-healing validation failed. Do not enable the automation in production.\033[0m\n'
  exit 1
fi

printf '\n\033[32mSelf-healing validation passed. The automation may be enabled in production.\033[0m\n'
