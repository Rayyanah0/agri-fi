#!/bin/bash
#
# Agri-Fi centralised-logging security bootstrap (#1236).
#
# Creates the RBAC roles and service/login users that back the logging stack:
#   * agri_fi_logs_writer  – service accounts that ship logs
#   * agri_fi_logs_viewer  – read-only dashboard access for support/ops
#   * agri_fi_logs_admin   – full management of log indices and Kibana features
#
# Prerequisites:
#   * Elasticsearch with xpack.security.enabled=true
#   * The `elastic` superuser password exported as ELASTIC_PASSWORD
#   * jq installed
#
# Usage:
#   ELASTIC_PASSWORD=... ./setup-security.sh
#   ES_URL=https://logs.example.com:9200 ELASTIC_PASSWORD=... ./setup-security.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ES_URL="${ES_URL:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
: "${ELASTIC_PASSWORD:?ELASTIC_PASSWORD must be set}"

WRITER_USER="${WRITER_USER:-agri_fi_logstash}"
WRITER_PASSWORD="${WRITER_PASSWORD:-changeme-writer}"
VIEWER_USER="${VIEWER_USER:-agri_fi_viewer}"
VIEWER_PASSWORD="${VIEWER_PASSWORD:-changeme-viewer}"
ADMIN_USER="${ADMIN_USER:-agri_fi_admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme-admin}"

AUTH=(-u "$ES_USER:$ELASTIC_PASSWORD")

echo "Agri-Fi logging security bootstrap"
echo "Target: $ES_URL"
echo ""

echo "✓ Creating roles..."
jq -c '.[]' "$SCRIPT_DIR/roles.json" | while read -r role; do
  name="$(echo "$role" | jq -r '.name')"
  body="$(echo "$role" | jq -c '.body')"
  curl -sS -X PUT "${AUTH[@]}" "$ES_URL/_security/role/$name" \
    -H "Content-Type: application/json" -d "$body" | jq .
  echo "  role $name applied"
done
echo ""

echo "✓ Creating users..."
curl -sS -X PUT "${AUTH[@]}" "$ES_URL/_security/user/$WRITER_USER" \
  -H "Content-Type: application/json" -d "{
    \"password\": \"$WRITER_PASSWORD\",
    \"roles\": [\"agri_fi_logs_writer\"],
    \"full_name\": \"Agri-Fi log shipper\"
  }" | jq .

curl -sS -X PUT "${AUTH[@]}" "$ES_URL/_security/user/$VIEWER_USER" \
  -H "Content-Type: application/json" -d "{
    \"password\": \"$VIEWER_PASSWORD\",
    \"roles\": [\"agri_fi_logs_viewer\"],
    \"full_name\": \"Agri-Fi log viewer\"
  }" | jq .

curl -sS -X PUT "${AUTH[@]}" "$ES_URL/_security/user/$ADMIN_USER" \
  -H "Content-Type: application/json" -d "{
    \"password\": \"$ADMIN_PASSWORD\",
    \"roles\": [\"agri_fi_logs_admin\"],
    \"full_name\": \"Agri-Fi log admin\"
  }" | jq .
echo ""

echo "✓ Creating API key for the log writer..."
curl -sS -X POST "${AUTH[@]}" "$ES_URL/_security/api_key" \
  -H "Content-Type: application/json" -d "{
    \"name\": \"agri-fi-logs-shipper\",
    \"role_descriptors\": {
      \"agri_fi_logs_writer\": {
        \"cluster\": [\"monitor\", \"read_pipeline\"],
        \"indices\": [{
          \"names\": [\"agri-fi-*\"],
          \"privileges\": [\"create_index\", \"index\", \"create\", \"write\"]
        }]
      }
    }
  }" | jq .

echo ""
echo "✅ Security bootstrap complete."
echo ""
echo "Point the shippers at the writer user/API key:"
echo "  ELASTICSEARCH_USER=$WRITER_USER"
echo "  ELASTICSEARCH_PASSWORD=$WRITER_PASSWORD"
