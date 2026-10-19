# PerfOps Infracost — Terraform Plan Diff & PR Gate Service

Real-time cloud infrastructure cost estimation, Terraform plan diffing, FinOps budget policy gating (`PASS` / `WARN` / `BLOCK`), and automated GitHub PR Markdown comment generation for the **PerfOps & Globex** platform.

## Architecture & Features

- **`src/pricing-db.js`**: Multi-cloud hourly & monthly pricing catalog in **USD** and **RUB** covering:
  - **AWS**: `aws_instance`, `aws_db_instance`, `aws_nat_gateway`, `aws_lb`, `aws_ebs_volume`
  - **GCP**: `google_compute_instance`, `google_container_cluster`, `google_sql_database_instance`
  - **Hostinger VPS**: `hostinger_vps_kvm1`, `hostinger_vps_kvm2`, `hostinger_vps_kvm4`
- **`src/diff-engine.js`**: Parses Terraform Plan JSON (`resource_changes` with `create`, `update`, `delete`, `replace`) or simplified resource definitions, computes before/after monthly USD & RUB totals, delta %, evaluates FinOps guardrails (`PASS` / `WARN` / `FAIL` / `BLOCK`), and renders a ready-to-post GitHub PR Markdown report plus JUnit XML for CI.
- **`src/cli.js`**: Dependency-free PR gate CLI. Reads a plan from a file or stdin, prints Markdown/JSON/JUnit, and exits `1` on `FAIL`/`BLOCK`.
- **`src/server.js`**: Zero-dependency Node.js HTTP microservice (default `PORT=4050`) integrated with `finops-cost-agent`, `aco.perfops.shop`, and `globex`.

## Unknown Resource Types

Resource types missing from `PRICING_TABLE` are **never treated as `$0`**. They are priced with a conservative fallback of **`$0.05/hour`** (≈ `$36.50/month`) and marked `unknown: true`:

- default gate status: **`WARN`** — the PR report and JUnit XML list every unknown address and Terraform type;
- `--strict-unknown` (CLI) / `strictUnknown: true` (API) / `INFRACOST_STRICT_UNKNOWN=1`: **`FAIL`**, exit code `1`;
- fallback rate override: `INFRACOST_UNKNOWN_RESOURCE_HOURLY=<usd/hour>`;
- absolute budget thresholds still apply, so an expensive unknown stack can still reach `BLOCK`.

```bash
# Markdown report, WARN unknown -> exit 0
npm run gate -- plan.json

# Strict gate + JUnit for CI
npm run gate -- plan.json --strict-unknown --format junit --junit-out gate-junit.xml
```

Percentage thresholds are skipped when the baseline is `$0` (a brand-new stack is gated on absolute deltas only).

## API Endpoints (`PORT=4050`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health check and upstream FinOps integration metadata |
| `GET` | `/api/v1/prices` | Full AWS, GCP, and Hostinger VPS resource pricing catalog |
| `POST` | `/api/v1/estimate` | Evaluates Terraform `resource_changes` or `resources` array and returns diff + PR Markdown + JUnit XML; `?strictUnknown=true` fails on unknown types |
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
