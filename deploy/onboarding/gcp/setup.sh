#!/usr/bin/env bash
# Creates the Martian connector service account and grants it access to GCP projects.
#
#   ./setup.sh --host-project <project running the connector> --projects p1,p2 [--remediation]
#
# Prefer GKE Workload Identity (or an attached service account on Compute Engine) so
# the connector uses Application Default Credentials and no key file exists.
set -euo pipefail

HOST=""; PROJECTS=""; REMEDIATION=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host-project) HOST="$2"; shift 2 ;;
    --projects) PROJECTS="$2"; shift 2 ;;
    --remediation) REMEDIATION=true; shift ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
done
[[ -n "$HOST" && -n "$PROJECTS" ]] || { echo "usage: $0 --host-project P --projects a,b [--remediation]" >&2; exit 2; }

SA="martian-connector@${HOST}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" --project "$HOST" >/dev/null 2>&1 \
  || gcloud iam service-accounts create martian-connector --project "$HOST" --display-name "Martian connector"

IFS=, read -ra LIST <<< "$PROJECTS"
for p in "${LIST[@]}"; do
  gcloud services enable compute.googleapis.com monitoring.googleapis.com --project "$p" >/dev/null
  for role in roles/compute.viewer roles/monitoring.viewer; do
    gcloud projects add-iam-policy-binding "$p" --member "serviceAccount:$SA" --role "$role" --condition=None >/dev/null
    echo "✓ $role on $p"
  done
  if $REMEDIATION; then
    gcloud iam roles describe martianRemediator --project "$p" >/dev/null 2>&1 || \
      gcloud iam roles create martianRemediator --project "$p" --title "Martian Remediator" \
        --description "Approved Martian changes: stop/start instances, snapshot and delete unattached disks" \
        --permissions compute.instances.stop,compute.instances.start,compute.disks.delete,compute.disks.createSnapshot,compute.snapshots.create,compute.zoneOperations.get >/dev/null
    gcloud projects add-iam-policy-binding "$p" --member "serviceAccount:$SA" \
      --role "projects/$p/roles/martianRemediator" --condition=None >/dev/null
    echo "✓ Martian Remediator on $p"
  fi
done

echo "Done. Add these project IDs in Martian → Integrations → Google Cloud: $PROJECTS"
echo "Bind $SA to the connector (Workload Identity) or attach it to the connector VM."
