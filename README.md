# PerfOps Infracost — Terraform Plan Diff & PR Gate Service

Real-time cloud infrastructure cost estimation, Terraform plan diffing, FinOps budget policy gating (`PASS` / `WARN` / `BLOCK`), and automated GitHub PR Markdown comment generation for the **PerfOps & Globex** platform.

## Architecture & Features

- **`src/pricing-db.js`**: Multi-cloud hourly & monthly pricing catalog in **USD** and **RUB** covering:
  - **AWS**: `aws_instance`, `aws_db_instance`, `aws_nat_gateway`, `aws_lb`, `aws_ebs_volume`
  - **GCP**: `google_compute_instance`, `google_container_cluster`, `google_sql_database_instance`
  - **Hostinger VPS**: `hostinger_vps_kvm1`, `hostinger_vps_kvm2`, `hostinger_vps_kvm4`
- **`src/diff-engine.js`**: Parses Terraform Plan JSON (`resource_changes` with `create`, `update`, `delete`, `replace`) or simplified resource definitions, computes before/after monthly USD & RUB totals, delta %, evaluates FinOps guardrails (`PASS` / `WARN` / `BLOCK`), and renders a ready-to-post GitHub PR Markdown report.
- **`src/server.js`**: Zero-dependency Node.js HTTP microservice (default `PORT=4050`) integrated with `finops-cost-agent`, `aco.perfops.shop`, and `globex`.

## API Endpoints (`PORT=4050`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health check and upstream FinOps integration metadata |
| `GET` | `/api/v1/prices` | Full AWS, GCP, and Hostinger VPS resource pricing catalog |
| `POST` | `/api/v1/estimate` | Evaluates Terraform `resource_changes` or `resources` array and returns diff + PR Markdown |
| `GET` | `/api/v1/presets/globex-infra` | Returns the production topology cost breakdown for Globex & PerfOps |

## Quick Start

```bash
# Run tests
node --test tests/infracost.test.js

# Start HTTP microservice on port 4050
npm start
```

## Contact / Support

PerfOps official Telegram contact: [@perfops_ai_manager](https://t.me/perfops_ai_manager).

For security vulnerabilities, use private vulnerability reporting rather than public Telegram messages.
