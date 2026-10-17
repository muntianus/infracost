import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICING_TABLE,
  lookupResourcePrice,
  getGlobexInfraPreset,
} from '../src/pricing-db.js';
import {
  analyzeTerraformPlan,
  evaluateBudgetPolicy,
  generatePrMarkdownComment,
} from '../src/diff-engine.js';
import { createInfracostServer } from '../src/server.js';

test('pricing-db covers required AWS, GCP, and Hostinger VPS resources', () => {
  const requiredTypes = [
    'aws_instance',
    'aws_db_instance',
    'aws_nat_gateway',
    'aws_lb',
    'aws_ebs_volume',
    'google_compute_instance',
    'google_container_cluster',
    'google_sql_database_instance',
    'hostinger_vps_kvm1',
    'hostinger_vps_kvm2',
    'hostinger_vps_kvm4',
  ];

  for (const rType of requiredTypes) {
    assert.ok(PRICING_TABLE[rType], `Missing pricing table entry for ${rType}`);
    const priced = lookupResourcePrice({ type: rType }, 100);
    assert.equal(priced.supported, true);
    assert.ok(priced.monthlyUsd > 0, `${rType} should have positive monthlyUsd`);
    assert.equal(priced.monthlyRub, Number((priced.monthlyUsd * 100).toFixed(2)));
  }
});

test('diff-engine parses Terraform plan resource_changes and evaluates PASS/WARN/BLOCK gates', () => {
  const tfPlan = {
    resource_changes: [
      {
        address: 'hostinger_vps_kvm2.edge',
        type: 'hostinger_vps_kvm2',
        change: {
          actions: ['update'],
          before: { sku: 'kvm2' },
          after: { sku: 'kvm2' },
        },
      },
      {
        address: 'aws_instance.worker',
        type: 'aws_instance',
        change: {
          actions: ['create'],
          before: null,
          after: { instance_type: 'm6i.large' },
        },
      },
    ],
  };

  const report = analyzeTerraformPlan(tfPlan, {
    usdToRub: 100,
    thresholds: { warnDeltaUsd: 50, blockDeltaUsd: 500, warnDeltaPct: 20, blockDeltaPct: 1000 },
  });

  assert.equal(report.summary.beforeMonthlyUsd, 8.99);
  assert.equal(report.summary.afterMonthlyUsd, Number((8.99 + 70.08).toFixed(2)));
  assert.equal(report.summary.deltaMonthlyUsd, 70.08);
  assert.equal(report.summary.deltaMonthlyRub, 7008);
  assert.equal(report.policy.status, 'WARN');
  assert.equal(report.policy.passed, true);
  assert.match(report.prMarkdown, /PerfOps Infracost FinOps Gate/);
  assert.match(report.prMarkdown, /aws_instance\.worker/);
});

test('diff-engine triggers BLOCK when delta exceeds threshold', () => {
  const policy = evaluateBudgetPolicy(620, 85, {
    warnDeltaUsd: 100,
    blockDeltaUsd: 500,
    warnDeltaPct: 15,
    blockDeltaPct: 50,
  });
  assert.equal(policy.status, 'BLOCK');
  assert.equal(policy.passed, false);
});

test('HTTP server responds to /health, /api/v1/prices, /api/v1/presets/globex-infra, and POST /api/v1/estimate', async () => {
  const server = createInfracostServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'ok');

    const pricesRes = await fetch(`${baseUrl}/api/v1/prices`);
    assert.equal(pricesRes.status, 200);
    const pricesBody = await pricesRes.json();
    assert.ok(pricesBody.resourceTypes.includes('hostinger_vps_kvm4'));

    const presetRes = await fetch(`${baseUrl}/api/v1/presets/globex-infra`);
    assert.equal(presetRes.status, 200);
    const presetBody = await presetRes.json();
    assert.equal(presetBody.preset, 'globex-infra');
    assert.ok(presetBody.summary.monthlyUsd > 0);

    const estimateRes = await fetch(`${baseUrl}/api/v1/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resources: [
          { type: 'hostinger_vps_kvm4', name: 'main-vps', action: 'create' },
          { type: 'aws_nat_gateway', name: 'nat', action: 'create' },
        ],
      }),
    });
    assert.equal(estimateRes.status, 200);
    const estimateBody = await estimateRes.json();
    assert.equal(estimateBody.summary.resourceCount, 2);
    assert.ok(estimateBody.prMarkdown.includes('hostinger_vps_kvm4.main-vps'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
