#!/usr/bin/env bash
set -euo pipefail

# ─── Restore Athena to Azure ──────────────────────────────────────
# Switches the Teams bot back to the Azure Container App endpoint.
# Also optionally rebuilds and deploys the latest code.
#
# Usage:  ./scripts/dev-azure.sh            # just switch endpoint
#         ./scripts/dev-azure.sh --deploy   # switch + rebuild + deploy
# ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi
source "$ENV_FILE"

BOT="${BOT_NAME:?Set BOT_NAME in deploy/.env}"
BOT_RG="${BOT_RESOURCE_GROUP:?Set BOT_RESOURCE_GROUP in deploy/.env}"
AZURE_ENDPOINT="https://${AZURE_FQDN:?Set AZURE_FQDN in deploy/.env}/api/messages"

# ─── 1. Restore bot endpoint ─────────────────────────────────────
echo "==> Restoring Azure Bot endpoint to Container App..."
az bot update --name "$BOT" --resource-group "$BOT_RG" \
  --endpoint "$AZURE_ENDPOINT" -o none
echo "    Endpoint: $AZURE_ENDPOINT"

# ─── 2. Optionally rebuild and deploy ────────────────────────────
if [[ "${1:-}" == "--deploy" ]]; then
  echo ""
  echo "==> Building and deploying to Azure Container Apps..."

  ACR_NAME="sonanceathena"
  IMAGE="$ACR_NAME.azurecr.io/athena-gateway:latest"

  echo "    Building image (this takes ~6 min)..."
  az acr build \
    --registry "$ACR_NAME" \
    --image athena-gateway:latest \
    --file deploy/Dockerfile.athena \
    "$ROOT_DIR" 2>&1 | tail -3

  echo "    Deploying new revision..."
  az containerapp update \
    --name athena-gateway \
    --resource-group "$BOT_RG" \
    --container-name athena-gateway \
    --image "$IMAGE" \
    --set-env-vars "DEPLOY_TS=$(date +%s)" \
    -o none

  echo "    Waiting for revision to activate..."
  sleep 15

  REV=$(az containerapp revision list \
    --name athena-gateway --resource-group "$BOT_RG" \
    --query "[?properties.active].name" -o tsv)
  echo "    Active revision: $REV"
fi

echo ""
echo "==> Athena is running on Azure."
echo "    Teams messages now route to the Container App."
