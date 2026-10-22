#!/bin/bash
#
# Agri-Fi Kibana bootstrap (#1236).
#
# Creates the log data view, imports the dashboards saved objects, installs the
# alerting rules and applies the SSO role mappings that back access control.
#
# Prerequisites:
#   * Kibana reachable (default http://localhost:5601)
#   * A user able to manage saved objects / alerting rules / security
#   * jq installed
#
# Usage:
#   ./setup-kibana.sh
#   KIBANA_URL=https://kibana.example.com KIBANA_USER=elastic KIBANA_PASSWORD=... ./setup-kibana.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIBANA_URL="${KIBANA_URL:-http://localhost:5601}"
KIBANA_USER="${KIBANA_USER:-elastic}"
KIBANA_PASSWORD="${KIBANA_PASSWORD:-}"

AUTH=()
if [ -n "$KIBANA_PASSWORD" ]; then
  AUTH=(-u "$KIBANA_USER:$KIBANA_PASSWORD")
fi

kbn() {
  curl -sS "${AUTH[@]}" -H "kbn-xsrf: true" "$@"
}

echo "Agri-Fi Kibana bootstrap"
echo "Target: $KIBANA_URL"
echo ""

echo "✓ Creating the log data view..."
kbn -X POST "$KIBANA_URL/api/data_views/data_view" \
  -H "Content-Type: application/json" \
  -d '{
    "data_view": {
      "title": "agri-fi-logs*",
      "name": "Agri-Fi Logs",
      "timeFieldName": "timestamp"
    },
    "override": true
  }' | jq . || true
echo ""

echo "✓ Importing dashboards..."
kbn -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
  -F "file=@$SCRIPT_DIR/dashboards.ndjson" | jq .
echo ""

echo "✓ Installing alerting rules..."
jq -c '.[]' "$SCRIPT_DIR/alerting-rules.json" | while read -r rule; do
  name="$(echo "$rule" | jq -r '.name')"
  kbn -X POST "$KIBANA_URL/api/alerting/rule" \
    -H "Content-Type: application/json" -d "$rule" \
    | jq -r '"  rule: \(.name // "'"$name"'")"'
done
echo ""

echo "✓ Applying role mappings..."
jq -c '.[]' "$SCRIPT_DIR/role-mappings.json" | while read -r mapping; do
  name="$(echo "$mapping" | jq -r '.name')"
  kbn -X POST "$KIBANA_URL/api/security/role_mappings" \
    -H "Content-Type: application/json" -d "$mapping" \
    | jq -r '"  mapping: \(.name // "'"$name"'")"'
done
echo ""

echo "✅ Kibana bootstrap complete."
echo "Open $KIBANA_URL/app/dashboards to view 'Agri-Fi Platform Logs'."
