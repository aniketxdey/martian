#!/usr/bin/env bash
# Grants the Martian connector's identity access to one or more Azure subscriptions.
#
#   ./setup.sh --principal-id <object id> --subscriptions sub1,sub2 [--remediation]
#
# Run the connector with a managed identity (VM, AKS workload identity or Container Apps)
# and pass that identity's object id. DefaultAzureCredential picks it up; no secrets.
set -euo pipefail

PRINCIPAL=""; SUBS=""; REMEDIATION=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --principal-id) PRINCIPAL="$2"; shift 2 ;;
    --subscriptions) SUBS="$2"; shift 2 ;;
    --remediation) REMEDIATION=true; shift ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
done
[[ -n "$PRINCIPAL" && -n "$SUBS" ]] || { echo "usage: $0 --principal-id ID --subscriptions a,b [--remediation]" >&2; exit 2; }

IFS=, read -ra SUB_LIST <<< "$SUBS"
SCOPES=$(printf '"/subscriptions/%s",' "${SUB_LIST[@]}"); SCOPES="[${SCOPES%,}]"

for sub in "${SUB_LIST[@]}"; do
  for role in "Reader" "Monitoring Reader" "Cost Management Reader"; do
    az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
      --role "$role" --scope "/subscriptions/$sub" --only-show-errors >/dev/null
    echo "✓ $role on $sub"
  done
done

if $REMEDIATION; then
  DEF=$(mktemp)
  cat > "$DEF" <<JSON
{
  "Name": "Martian Remediator",
  "Description": "Approved Martian changes: deallocate/start VMs, snapshot and delete unattached disks.",
  "Actions": [
    "Microsoft.Compute/virtualMachines/deallocate/action",
    "Microsoft.Compute/virtualMachines/start/action",
    "Microsoft.Compute/disks/delete",
    "Microsoft.Compute/snapshots/write",
    "Microsoft.Compute/disks/beginGetAccess/action"
  ],
  "NotActions": [],
  "AssignableScopes": $SCOPES
}
JSON
  az role definition create --role-definition "@$DEF" --only-show-errors >/dev/null 2>&1 \
    || az role definition update --role-definition "@$DEF" --only-show-errors >/dev/null
  for sub in "${SUB_LIST[@]}"; do
    az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
      --role "Martian Remediator" --scope "/subscriptions/$sub" --only-show-errors >/dev/null
    echo "✓ Martian Remediator on $sub"
  done
  rm -f "$DEF"
fi

echo "Done. Add these subscription IDs in Martian → Integrations → Microsoft Azure: $SUBS"
