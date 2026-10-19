import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICING_TABLE,
  lookupResourcePrice,
  getGlobexInfraPreset,
  resolveUnknownResourceHourlyUsd,
  DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD,
} from '../src/pricing-db.js';
import {
  analyzeTerraformPlan,
  evaluateBudgetPolicy,
  generatePrMarkdownComment,
  generateJUnitXml,
} from '../src/diff-engine.js';
import { normalizeTfValues, normalizeTfAction } from '../src/terraform-normalizer.js';
import { createInfracostServer } from '../src/server.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function unknownPlan(type = 'aws_unknown_service') {
  return {
    resource_changes: [
      {
        address: `${type}.mystery`,
        type,
        change: {
          actions: ['create'],
          before: null,
          after: { name: 'mystery' },
        },
      },
    ],
  };
}

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


test('Terraform action normalization covers each plan action without changing behavior', () => {
  assert.equal(normalizeTfAction(['create']), 'create');
  assert.equal(normalizeTfAction(['delete']), 'delete');
  assert.equal(normalizeTfAction(['update']), 'update');
  assert.equal(normalizeTfAction(['delete', 'create']), 'replace');
  assert.equal(normalizeTfAction(['no-op']), 'no-op');
});

test('Terraform value normalization is pure and tolerates missing values', () => {
  assert.equal(normalizeTfValues('aws_instance', 'example', null), null);
  const source = { instance_type: 'm6i.large', count: 2 };
  const result = normalizeTfValues('aws_instance', 'example', source);
  assert.equal(result.type, 'aws_instance');
  assert.equal(result.instance_type, 'm6i.large');
  assert.equal(result.count, 2);
  assert.deepEqual(source, { instance_type: 'm6i.large', count: 2 });
});

test('unknown resource types are priced with conservative fallback and gate WARN by default', () => {
  const report = analyzeTerraformPlan(unknownPlan(), {
    usdToRub: 100,
    unknownHourlyUsd: DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD,
  });

  assert.equal(report.summary.unknownResourceCount, 1);
  assert.deepEqual(report.summary.unknownResourceTypes, ['aws_unknown_service']);
  assert.equal(report.summary.afterMonthlyUsd, 36.5);
  assert.equal(report.summary.deltaMonthlyUsd, 36.5);
  assert.equal(report.summary.unknownMonthlyUsd, 36.5);
  assert.equal(report.summary.unknownDeltaMonthlyUsd, 36.5);
  assert.equal(report.summary.unknownFallbackHourlyUsd, DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD);

  assert.equal(report.policy.status, 'WARN');
  assert.equal(report.policy.passed, true);
  assert.equal(report.policy.unknown.status, 'WARN');
  assert.equal(report.policy.unknown.strict, false);
  assert.match(report.policy.reasons.join(' '), /Unknown resource types \(aws_unknown_service\)/);

  assert.equal(report.diffItems[0].unknown, true);
  assert.equal(report.diffItems[0].supported, false);
  assert.equal(report.diffItems[0].priceSource, 'fallback-unknown');
  assert.equal(report.diffItems[0].sku, 'unknown-fallback');

  assert.equal(report.unknownResources.count, 1);
  assert.equal(report.unknownResources.items[0].address, 'aws_unknown_service.mystery');
  assert.equal(report.unknownResources.items[0].type, 'aws_unknown_service');

  assert.match(report.prMarkdown, /Unknown Resource Types/);
  assert.match(report.prMarkdown, /aws_unknown_service\.mystery/);
  assert.match(report.prMarkdown, /aws_unknown_service/);
  assert.match(report.prMarkdown, /\$36\.50/);

  assert.match(report.junitXml, /unknown\.resource\.count" value="1"/);
  assert.match(report.junitXml, /unknown\.resource\.types" value="aws_unknown_service"/);
  assert.match(report.junitXml, /Unknown Terraform type aws_unknown_service/);
  assert.doesNotMatch(report.junitXml, /<failure/);
});

test('--strict-unknown turns unknown resource types into FAIL', () => {
  const report = analyzeTerraformPlan(unknownPlan(), {
    strictUnknown: true,
    unknownHourlyUsd: DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD,
  });

  assert.equal(report.policy.status, 'FAIL');
  assert.equal(report.policy.passed, false);
  assert.equal(report.policy.unknown.status, 'FAIL');
  assert.equal(report.policy.unknown.strict, true);
  assert.match(report.policy.reasons.join(' '), /--strict-unknown/);
  assert.match(report.prMarkdown, /❌ FAIL/);
  assert.match(report.prMarkdown, /--strict-unknown/);

  assert.match(report.junitXml, /failures="2"/);
  assert.match(report.junitXml, /<failure message="Unknown resource type: aws_unknown_service"/);
  assert.match(report.junitXml, /failed --strict-unknown/);
  assert.match(report.junitXml, /Infracost gate FAIL/);
});

test('expensive unknown resources still reach BLOCK on absolute thresholds', () => {
  const report = analyzeTerraformPlan(unknownPlan(), {
    unknownHourlyUsd: 1,
  });

  assert.equal(report.summary.afterMonthlyUsd, 730);
  assert.equal(report.policy.status, 'BLOCK');
  assert.equal(report.policy.passed, false);
  assert.equal(report.policy.unknown.status, 'WARN');
  assert.match(report.policy.reasons.join(' '), /exceeds block threshold/);
});

test('unknown fallback rate can be tuned via INFRACOST_UNKNOWN_RESOURCE_HOURLY', () => {
  const previous = process.env.INFRACOST_UNKNOWN_RESOURCE_HOURLY;
  process.env.INFRACOST_UNKNOWN_RESOURCE_HOURLY = '0.5';
  try {
    assert.equal(resolveUnknownResourceHourlyUsd(), 0.5);

    const report = analyzeTerraformPlan(
      {
        resources: [
          { type: 'aws_unknown_service', name: 'mystery', action: 'create' },
        ],
      },
      { usdToRub: 100 }
    );

    assert.equal(report.summary.unknownResourceCount, 1);
    assert.equal(report.summary.unknownFallbackHourlyUsd, 0.5);
    assert.equal(report.summary.afterMonthlyUsd, 365);
    assert.equal(report.policy.status, 'WARN');
    assert.equal(report.policy.passed, true);
  } finally {
    if (previous === undefined) {
      delete process.env.INFRACOST_UNKNOWN_RESOURCE_HOURLY;
    } else {
      process.env.INFRACOST_UNKNOWN_RESOURCE_HOURLY = previous;
    }
  }
});

test('known resource types keep catalog pricing and are not marked unknown', () => {
  const report = analyzeTerraformPlan(
    {
      resource_changes: [
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
    },
    { usdToRub: 100 }
  );

  assert.equal(report.summary.afterMonthlyUsd, 70.08);
  assert.equal(report.summary.deltaMonthlyUsd, 70.08);
  assert.equal(report.summary.unknownResourceCount, 0);
  assert.deepEqual(report.summary.unknownResourceTypes, []);
  assert.equal(report.policy.status, 'PASS');
  assert.equal(report.policy.passed, true);
  assert.equal(report.diffItems[0].unknown, false);
  assert.equal(report.diffItems[0].priceSource, 'catalog');
  assert.equal(report.diffItems[0].sku, 'm6i.large');
  assert.doesNotMatch(report.prMarkdown, /Unknown Resource Types/);
  assert.doesNotMatch(report.junitXml, /\[unknown:/);
});

test('gate CLI exits 0 for WARN and 1 for --strict-unknown FAIL', () => {
  const plan = JSON.stringify(unknownPlan());
  const env = {
    ...process.env,
    INFRACOST_UNKNOWN_RESOURCE_HOURLY: '0.05',
    INFRACOST_STRICT_UNKNOWN: '',
  };

  const warnRun = spawnSync(process.execPath, ['src/cli.js', '-', '--format', 'json'], {
    cwd: REPO_ROOT,
    input: plan,
    encoding: 'utf8',
    env,
  });
  assert.equal(warnRun.status, 0, warnRun.stderr);
  const warnReport = JSON.parse(warnRun.stdout);
  assert.equal(warnReport.policy.status, 'WARN');
  assert.equal(warnReport.unknownResources.count, 1);

  const strictRun = spawnSync(
    process.execPath,
    ['src/cli.js', '-', '--strict-unknown', '--format', 'junit'],
    { cwd: REPO_ROOT, input: plan, encoding: 'utf8', env }
  );
  assert.equal(strictRun.status, 1, strictRun.stderr);
  assert.match(strictRun.stdout, /<failure message="Unknown resource type: aws_unknown_service"/);
  assert.match(strictRun.stdout, /aws_unknown_service/);
});

test('HTTP estimate reports unknown types and honours strictUnknown', async () => {
  const server = createInfracostServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const warnRes = await fetch(`${baseUrl}/api/v1/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unknownPlan()),
    });
    assert.equal(warnRes.status, 200);
    const warnBody = await warnRes.json();
    assert.equal(warnBody.policy.status, 'WARN');
    assert.equal(warnBody.summary.unknownResourceTypes[0], 'aws_unknown_service');
    assert.ok(warnBody.summary.afterMonthlyUsd > 0);

    const strictRes = await fetch(`${baseUrl}/api/v1/estimate?strictUnknown=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unknownPlan()),
    });
    assert.equal(strictRes.status, 200);
    const strictBody = await strictRes.json();
    assert.equal(strictBody.policy.status, 'FAIL');
    assert.equal(strictBody.policy.passed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
