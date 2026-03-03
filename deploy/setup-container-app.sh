#!/usr/bin/env bash
set -euo pipefail

# Athena Multi-Tenant Bot - Azure Container Apps Deployment Script
# Prerequisites:
#   - Azure CLI installed and logged in
#   - .env file configured from .env.template
#   - Docker image built and pushed to ACR

RESOURCE_GROUP="Athena"
LOCATION="westus3"
ENV_NAME="athena-env"
APP_NAME="athena-gateway"
ACR_NAME="sonanceathena"
IMAGE="sonanceathena.azurecr.io/athena-gateway:latest"

echo "==> Deploying Athena to Azure Container Apps"

# Get ACR credentials
ACR_USER=$(az acr credential show --name $ACR_NAME --query "username" -o tsv)
ACR_PASS=$(az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv)

# Load env vars
if [ -f .env ]; then
  source .env
else
  echo "ERROR: .env file not found. Copy .env.template to .env and fill in values."
  exit 1
fi

echo "==> Creating container app: $APP_NAME"
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$IMAGE" \
  --registry-server "$ACR_NAME.azurecr.io" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 3978 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --env-vars \
    "HOME=/home/node" \
    "OPENCLAW_STATE_DIR=/home/node/.openclaw" \
    "OPENCLAW_GATEWAY_BIND=lan" \
    "ATHENA_PROFILE_DIR=/data/profiles" \
    "MSTEAMS_APP_ID=$MSTEAMS_APP_ID" \
    "MSTEAMS_APP_PASSWORD=$MSTEAMS_APP_PASSWORD" \
    "MSTEAMS_TENANT_ID=$MSTEAMS_TENANT_ID" \
    "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
    "OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:-}" \
  --command "node" "openclaw.mjs" "gateway" "--bind" "lan" "--port" "3978" \
  -o json

FQDN=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)
echo ""
echo "==> Athena deployed!"
echo "    URL: https://$FQDN"
echo "    Messaging endpoint: https://$FQDN/api/messages"
echo ""
echo "==> Next steps:"
echo "    1. Update Azure Bot messaging endpoint to: https://$FQDN/api/messages"
echo "    2. Upload the updated Teams manifest (deploy/AthenaAgent-teams-manifest-v2.zip)"
echo "    3. Test by messaging Athena in Teams"
