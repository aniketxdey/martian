# Deploying Martian

Martian runs as a hosted control plane. Each customer installs one **connector**
inside their network. The connector dials out over TLS, so customers need no inbound
firewall rules, VPN or shared cloud keys.

## 1. Control plane on AWS

`deploy/terraform/aws` provisions the following:

| Piece | Choice |
| --- | --- |
| Network | VPC across 3 AZs, private subnets for tasks, isolated database subnets, flow logs |
| Compute | ECS Fargate on Graviton: `api` (autoscaled on CPU), `worker`, `gateway`, `forecast`, plus a one‑shot `migrate` task |
| Service discovery | ECS Service Connect (`http://gateway:8787`, `http://forecast:8790`, `http://api:8000`) |
| Database | RDS Postgres 16: Multi‑AZ in prod, KMS‑encrypted, forced TLS, RDS‑managed owner password, PITR (14 days) |
| Secrets | Secrets Manager under one customer‑managed KMS key; the same key envelope‑encrypts integration credentials |
| Edge | ALB with TLS 1.3 policy and WAF (AWS common rules + login rate limit). `api.` serves the API; `connect.` exposes only the connector WebSocket. `/internal/*` is never routed from the internet |
| Console | S3 + CloudFront (origin access control, security headers, SPA fallback) on `app.` |
| Images | ECR (immutable tags, scan on push) |

```bash
cd deploy/terraform/aws
cp terraform.tfvars.example terraform.tfvars   # set domain (a Route 53 zone) and image_tag
terraform init && terraform apply
```

After the first apply:

1. Put real values in the operator secrets listed in the `operator_secrets` output:
   `anthropic_api_key`, and optionally `workos_api_key` and `workos_client_id` for
   SSO. The placeholder `unset` means "not configured".
2. In GitHub, set the repository variables listed at the top of
   `.github/workflows/deploy.yml`. Also create an OIDC deploy role.
3. Push to `main`. The deploy workflow:
   - builds arm64 images;
   - runs `martian-migrate`, which creates the `martian_app` role if needed and applies Alembic;
   - rolls the services, which roll back automatically on failed health checks;
   - publishes the console.
4. Create the first organization from the migrate task definition, with the command
   overridden to:
   `martian-seed --org "Acme" --email admin@acme.com --password '…'`

Pushing a `v*` tag also publishes the connector image and Helm chart to GHCR.

**Gateway scaling.** Each connector holds one WebSocket to one gateway task, and the
API reaches integrations through that task. The default is one gateway task, which
handles thousands of connectors. To go beyond one, route `/mcp/{integration}` with
connector affinity: look up the owning task through `/internal/integrations/{id}/route`.

## 2. Onboard a customer

1. **Create a connector.** In the console go to Integrations, then Add connector. The
   token is shown once.
2. **Run the connector** inside the customer's network:
   - Kubernetes:
     ```bash
     helm install martian-connector oci://ghcr.io/aniketxdey/charts/martian-connector \
       --namespace martian --create-namespace \
       --set token=$TOKEN --set gatewayUrl=wss://connect.<domain>/connect \
       --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::…:role/MartianConnector
     ```
   - A VM or ECS: the `docker run` command shown in the console.

   The chart runs as non‑root with a read‑only root filesystem. Its NetworkPolicy
   allows egress only.
3. **Grant cloud access.** These grants are read‑only by default. Remediation is a
   separate, explicit opt‑in.
   - **AWS:** deploy `deploy/onboarding/aws/connector-identity.yaml` once, in the account
     that runs the connector. Then deploy `deploy/onboarding/aws/martian-role.yaml` to
     every account, using a StackSet across an OU. The role's trust policy requires
     the organization's external ID (shown in Integrations → AWS). With
     `EnableRemediation=true`, tagging a resource `martian:protect=true` blocks changes to it.
   - **Azure:** run `deploy/onboarding/azure/setup.sh --principal-id <managed identity> --subscriptions a,b [--remediation]`.
   - **Google Cloud:** run `deploy/onboarding/gcp/setup.sh --host-project p --projects a,b [--remediation]`.
   - **vCenter / SSH:** enter the URL and credentials in the console. They are
     encrypted and delivered only to that customer's connector.
4. **Fill in integration scope.** In Integrations, add account role ARNs and regions,
   subscription IDs or project IDs. Click **Test connection**, then run a scan from
   Overview.

## 3. Single‑host install

For proofs of concept or air‑gapped environments, `docker compose up` runs everything
on one machine. See the root `README.md`. Set `MARTIAN_ENV=production`, real secrets,
HTTPS in front of port 8080 and `MARTIAN_COOKIE_SECURE=true` before exposing it.

## Production checklist

- `MARTIAN_ENV=production`. The API refuses to start with development secrets, a
  missing KMS key or encryption key, or insecure cookies.
- Database access: the API and worker connect as `martian_app`, which owns no tables,
  so row‑level security always applies. Migrations run as the owner.
- Backups: RDS automated backups with point‑in‑time recovery. Agent checkpoints and
  pending approvals live in the same database.
- Observability: structured JSON logs (structlog and pino) in CloudWatch, with
  request IDs on every API call. Container Insights and Performance Insights are
  enabled.
