/**
 * PerfOps Infracost Terraform Plan Diff & PR Gate Engine
 * Parses Terraform plan JSON (`resource_changes` with create/update/delete or simplified `resources` list),
 * computes monthly USD & RUB cost before/after, delta %, budget policy gate (PASS / WARN / BLOCK),
 * and generates a GitHub PR Markdown comment table.
 */

import {
  lookupResourcePrice,
  resolveUnknownResourceHourlyUsd,
  DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD,
  UNKNOWN_RESOURCE_HOURLY_ENV,
  DEFAULT_USD_TO_RUB,
  HOURS_PER_MONTH,
} from './pricing-db.js';
import { normalizeTfValues, normalizeTfAction } from './terraform-normalizer.js';

export const DEFAULT_POLICY_THRESHOLDS = {
  warnDeltaUsd: 100,
  blockDeltaUsd: 500,
  warnDeltaPct: 15,
  blockDeltaPct: 50,
};

/**
 * Evaluates budget gate status (`PASS`, `WARN`, `FAIL`, `BLOCK`) given cost deltas and thresholds.
 *
 * Unknown (unpriced) Terraform resource types are never allowed to produce a silent PASS:
 * - default: downgrade PASS to WARN and surface the affected types;
 * - `strictUnknown: true`: hard FAIL regardless of the cost delta.
 */
export function evaluateBudgetPolicy(
  deltaMonthlyUsd,
  deltaPct,
  thresholds = DEFAULT_POLICY_THRESHOLDS,
  unknown = {}
) {
  const warnUsd = thresholds.warnDeltaUsd ?? DEFAULT_POLICY_THRESHOLDS.warnDeltaUsd;
  const blockUsd = thresholds.blockDeltaUsd ?? DEFAULT_POLICY_THRESHOLDS.blockDeltaUsd;
  const warnPct = thresholds.warnDeltaPct ?? DEFAULT_POLICY_THRESHOLDS.warnDeltaPct;
  const blockPct = thresholds.blockDeltaPct ?? DEFAULT_POLICY_THRESHOLDS.blockDeltaPct;

  const unknownResourceCount = Number(unknown.unknownResourceCount || 0);
  const unknownResourceTypes = Array.isArray(unknown.unknownResourceTypes)
    ? unknown.unknownResourceTypes.filter(Boolean)
    : [];
  const strictUnknown = unknown.strictUnknown === true;
  const fallbackHourlyUsd = Number.isFinite(Number(unknown.unknownFallbackHourlyUsd))
    ? Number(unknown.unknownFallbackHourlyUsd)
    : resolveUnknownResourceHourlyUsd();
  const unknownMonthlyUsd = Number(unknown.unknownMonthlyUsd || 0);
  // Percentage thresholds are meaningless when the baseline is $0 (any spend is "+inf%"),
  // so a brand-new stack is gated on absolute deltas only. Direct callers that omit
  // baselineMonthlyUsd keep the historical percentage behavior.
  const percentageEligible =
    unknown.baselineMonthlyUsd === undefined || Number(unknown.baselineMonthlyUsd) > 0;

  const reasons = [];
  let status = 'PASS';

  if (
    deltaMonthlyUsd >= blockUsd ||
    (percentageEligible && deltaMonthlyUsd > 0 && deltaPct >= blockPct)
  ) {
    status = 'BLOCK';
    if (deltaMonthlyUsd >= blockUsd) {
      reasons.push(`Monthly cost increase (+$${deltaMonthlyUsd.toFixed(2)}) exceeds block threshold ($${blockUsd.toFixed(2)})`);
    }
    if (percentageEligible && deltaPct >= blockPct) {
      reasons.push(`Cost delta (+${deltaPct.toFixed(1)}%) exceeds block percentage threshold (${blockPct}%)`);
    }
  } else if (
    deltaMonthlyUsd >= warnUsd ||
    (percentageEligible && deltaMonthlyUsd > 0 && deltaPct >= warnPct)
  ) {
    status = 'WARN';
    if (deltaMonthlyUsd >= warnUsd) {
      reasons.push(`Monthly cost increase (+$${deltaMonthlyUsd.toFixed(2)}) exceeds warning threshold ($${warnUsd.toFixed(2)})`);
    }
    if (percentageEligible && deltaPct >= warnPct) {
      reasons.push(`Cost delta (+${deltaPct.toFixed(1)}%) exceeds warning percentage threshold (${warnPct}%)`);
    }
  } else {
    reasons.push('Cost delta is within PerfOps FinOps budget guardrails.');
  }

  const typesLabel = unknownResourceTypes.length > 0 ? unknownResourceTypes.join(', ') : 'unrecognized types';

  if (unknownResourceCount > 0 && strictUnknown) {
    status = 'FAIL';
    if (reasons.length === 1 && reasons[0].startsWith('Cost delta is within')) {
      reasons.length = 0;
    }
    reasons.push(
      `Unknown resource types (${typesLabel}) are not priced; --strict-unknown blocks the gate. Conservative fallback applied: $${fallbackHourlyUsd}/h ($${unknownMonthlyUsd.toFixed(2)}/mo for ${unknownResourceCount} resource(s)).`
    );
  } else if (unknownResourceCount > 0) {
    if (status === 'PASS') {
      reasons.length = 0;
      status = 'WARN';
    }
    reasons.push(
      `Unknown resource types (${typesLabel}) are not priced; conservative fallback $${fallbackHourlyUsd}/h applied ($${unknownMonthlyUsd.toFixed(2)}/mo for ${unknownResourceCount} resource(s)). Review before merge.`
    );
  }

  const unknownStatus = unknownResourceCount === 0 ? 'PASS' : strictUnknown ? 'FAIL' : 'WARN';

  return {
    status,
    passed: status === 'PASS' || status === 'WARN',
    reasons,
    thresholds: { warnDeltaUsd: warnUsd, blockDeltaUsd: blockUsd, warnDeltaPct: warnPct, blockDeltaPct: blockPct },
    unknown: {
      count: unknownResourceCount,
      types: unknownResourceTypes,
      strict: strictUnknown,
      status: unknownStatus,
      fallbackHourlyUsd,
      monthlyUsd: unknownMonthlyUsd,
    },
  };
}

/**
 * Generates a GitHub PR Markdown comment table from the diff calculation.
 */
export function generatePrMarkdownComment(report) {
  const { summary, policy, diffItems } = report;
  const badge =
    policy.status === 'PASS'
      ? '✅ PASS'
      : policy.status === 'WARN'
      ? '⚠️ WARN'
      : policy.status === 'FAIL'
      ? '❌ FAIL'
      : '🛑 BLOCK';

  const sign = summary.deltaMonthlyUsd > 0 ? '+' : '';
  const pctStr =
    summary.beforeMonthlyUsd === 0 && summary.afterMonthlyUsd > 0
      ? '+100.0%'
      : `${sign}${summary.deltaPct.toFixed(1)}%`;

  const lines = [
    `### 💰 PerfOps Infracost FinOps Gate — **${badge}**`,
    '',
    `| Metric | Before | After | Delta | Delta % |`,
    `| :--- | ---: | ---: | ---: | ---: |`,
    `| **Monthly USD** | $${summary.beforeMonthlyUsd.toFixed(2)} | $${summary.afterMonthlyUsd.toFixed(2)} | ${sign}$${summary.deltaMonthlyUsd.toFixed(2)} | ${pctStr} |`,
    `| **Monthly RUB** | ₽${summary.beforeMonthlyRub.toFixed(2)} | ₽${summary.afterMonthlyRub.toFixed(2)} | ${sign}₽${summary.deltaMonthlyRub.toFixed(2)} | ${pctStr} |`,
    '',
    `#### Resource Breakdown`,
    `| Resource | Action | SKU | Before ($/mo) | After ($/mo) | Delta ($/mo) |`,
    `| :--- | :---: | :--- | ---: | ---: | ---: |`,
  ];

  for (const item of diffItems) {
    const itemSign = item.deltaMonthlyUsd > 0 ? '+' : '';
    lines.push(
      `| \`${item.address}\` | \`${item.action}\` | \`${item.sku}\` | $${item.beforeMonthlyUsd.toFixed(2)} | $${item.afterMonthlyUsd.toFixed(2)} | ${itemSign}$${item.deltaMonthlyUsd.toFixed(2)} |`
    );
  }

  const unknown = report.unknownResources;
  if (unknown && unknown.count > 0) {
    const fallbackHourly = unknown.fallbackHourlyUsd ?? DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD;
    lines.push('');
    lines.push(`#### ⚠️ Unknown Resource Types — Conservative Fallback`);
    lines.push(
      `${unknown.count} resource(s) use types missing from the pricing catalog. They are estimated at **$${fallbackHourly}/hour** ($${(fallbackHourly * HOURS_PER_MONTH).toFixed(2)}/month each) so the gate never treats them as $0.`
    );
    lines.push('');
    lines.push(`| Resource | Type | Action | Est. After ($/mo) | Est. Delta ($/mo) |`);
    lines.push(`| :--- | :--- | :---: | ---: | ---: |`);
    for (const item of unknown.items) {
      const itemSign = item.deltaMonthlyUsd > 0 ? '+' : '';
      lines.push(
        `| \`${item.address}\` | \`${item.type}\` | \`${item.action}\` | $${item.afterMonthlyUsd.toFixed(2)} | ${itemSign}$${item.deltaMonthlyUsd.toFixed(2)} |`
      );
    }
    lines.push('');
    lines.push(
      `> Gate policy: **WARN** by default; **FAIL** with \`--strict-unknown\`. Add explicit prices for these types or set \`${unknown.envVar || 'INFRACOST_UNKNOWN_RESOURCE_HOURLY'}\` to tune the fallback.`
    );
  }

  lines.push('');
  lines.push(`**Policy Gate (${policy.status}):** ${policy.reasons.join('; ')}`);
  return lines.join('\n');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Renders the gate report as JUnit XML so CI can publish the unknown-resource
 * verdict without parsing Markdown. Every unknown resource is listed by address
 * and Terraform type; `--strict-unknown` turns each entry into a failed testcase.
 */
export function generateJUnitXml(report) {
  const { summary, policy, diffItems = [] } = report;
  const unknown = report.unknownResources || { count: 0, items: [], types: [], fallbackHourlyUsd: null };
  const unknownItems = Array.isArray(unknown.items) ? unknown.items : [];
  const unknownAddresses = new Set(unknownItems.map((item) => item.address));
  const strictUnknownFailure = policy.unknown?.strict === true && unknown.count > 0;
  const policyFailure = policy.passed === false;
  const failures = unknownItems.length > 0 && strictUnknownFailure ? unknownItems.length : 0;
  const totalFailures = failures + (policyFailure ? 1 : 0);
  const totalTests = diffItems.length + 1;
  const fallbackHourly = unknown.fallbackHourlyUsd ?? DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="perfops-infracost" tests="${totalTests}" failures="${totalFailures}" errors="0" skipped="0">`,
    `  <testsuite name="perfops-infracost-gate" tests="${totalTests}" failures="${totalFailures}" errors="0" skipped="0" timestamp="${escapeXml(report.timestamp || new Date().toISOString())}">`,
    '    <properties>',
    `      <property name="policy.status" value="${escapeXml(policy.status)}"/>`,
    `      <property name="policy.passed" value="${policy.passed ? 'true' : 'false'}"/>`,
    `      <property name="unknown.resource.count" value="${unknown.count || 0}"/>`,
    `      <property name="unknown.resource.types" value="${escapeXml((unknown.types || []).join(','))}"/>`,
    `      <property name="unknown.fallback.hourlyUsd" value="${escapeXml(fallbackHourly)}"/>`,
    `      <property name="unknown.strict" value="${policy.unknown?.strict ? 'true' : 'false'}"/>`,
    `      <property name="budget.beforeMonthlyUsd" value="${escapeXml(summary.beforeMonthlyUsd)}"/>`,
    `      <property name="budget.afterMonthlyUsd" value="${escapeXml(summary.afterMonthlyUsd)}"/>`,
    `      <property name="budget.deltaMonthlyUsd" value="${escapeXml(summary.deltaMonthlyUsd)}"/>`,
    '    </properties>',
  ];

  for (const item of diffItems) {
    const isUnknown = unknownAddresses.has(item.address) || item.unknown === true;
    const label = isUnknown ? `${item.address} [unknown: ${item.type}]` : item.address;
    lines.push(
      `    <testcase classname="perfops.infracost.resource" name="${escapeXml(label)}" time="0">`
    );
    if (isUnknown) {
      lines.push(
        `      <system-out>Unknown Terraform type ${escapeXml(item.type)} at ${escapeXml(item.address)}; conservative fallback $${escapeXml(fallbackHourly)}/h, estimated $${Number(item.afterMonthlyUsd).toFixed(2)}/mo.</system-out>`
      );
      if (strictUnknownFailure) {
        lines.push(
          `      <failure message="Unknown resource type: ${escapeXml(item.type)}">Unpriced Terraform type ${escapeXml(item.type)} at ${escapeXml(item.address)} failed --strict-unknown. Add a pricing entry or increase the fallback rate.</failure>`
        );
      }
    } else {
      lines.push(
        `      <system-out>${escapeXml(item.address)} (${escapeXml(item.type)}) ${escapeXml(item.action)} delta $${escapeXml(item.deltaMonthlyUsd)}/mo.</system-out>`
      );
    }
    lines.push('    </testcase>');
  }

  lines.push('    <testcase classname="perfops.infracost.policy" name="budget-gate" time="0">');
  if (policyFailure) {
    lines.push(
      `      <failure message="Infracost gate ${escapeXml(policy.status)}">${escapeXml(policy.reasons.join('; '))}</failure>`
    );
  } else {
    lines.push(`      <system-out>${escapeXml(policy.reasons.join('; '))}</system-out>`);
  }
  lines.push('    </testcase>');
  lines.push('  </testsuite>');
  lines.push('</testsuites>');

  return lines.join('\n');
}

/**
 * Parses either a Terraform Plan JSON (`resource_changes`) or a simplified resource list (`resources` or Array)
 * and produces a complete FinOps diff report.
 *
 * Unknown resource types are priced with a conservative fallback (never $0) and marked
 * `unknown: true`. They downgrade a PASS to WARN, or to FAIL when `strictUnknown` /
 * `--strict-unknown` is enabled.
 */
export function analyzeTerraformPlan(input = {}, options = {}) {
  const usdToRub = Number(options.usdToRub || input.usdToRub || DEFAULT_USD_TO_RUB);
  const thresholds = { ...DEFAULT_POLICY_THRESHOLDS, ...(options.thresholds || input.policyThresholds || {}) };
  const unknownHourlyUsd = options.unknownHourlyUsd ?? input.unknownHourlyUsd;
  const priceOptions = { unknownHourlyUsd };
  const strictUnknown =
    options.strictUnknown !== undefined
      ? options.strictUnknown === true
      : input.strictUnknown !== undefined
      ? input.strictUnknown === true
      : ['1', 'true', 'yes'].includes(
          String(process.env.INFRACOST_STRICT_UNKNOWN || '').toLowerCase()
        );

  const diffItems = [];
  const zeroPrice = {
    monthlyUsd: 0,
    monthlyRub: 0,
    hourlyUsd: 0,
    sku: '-',
    supported: true,
    priceSource: 'none',
    fallbackHourlyUsd: null,
  };

  if (Array.isArray(input.resource_changes)) {
    for (const rc of input.resource_changes) {
      const type = rc.type;
      const address = rc.address || `${rc.type}.${rc.name || 'default'}`;
      const actions = rc.change?.actions || ['create'];
      const beforeVals = rc.change?.before;
      const afterVals = rc.change?.after;

      const action = normalizeTfAction(actions);

      const beforeSpec =
        action === 'create' ? null : normalizeTfValues(type, address, beforeVals);
      const afterSpec =
        action === 'delete' ? null : normalizeTfValues(type, address, afterVals);

      const beforePrice = beforeSpec
        ? lookupResourcePrice(beforeSpec, usdToRub, priceOptions)
        : zeroPrice;
      const afterPrice = afterSpec
        ? lookupResourcePrice(afterSpec, usdToRub, priceOptions)
        : zeroPrice;

      const unknown =
        (beforeSpec !== null && beforePrice.supported === false) ||
        (afterSpec !== null && afterPrice.supported === false);

      const deltaMonthlyUsd = Number(
        (afterPrice.monthlyUsd - beforePrice.monthlyUsd).toFixed(2)
      );
      const deltaMonthlyRub = Number(
        (afterPrice.monthlyRub - beforePrice.monthlyRub).toFixed(2)
      );

      diffItems.push({
        address,
        type,
        action,
        sku: afterPrice.sku !== '-' ? afterPrice.sku : beforePrice.sku,
        beforeMonthlyUsd: beforePrice.monthlyUsd,
        afterMonthlyUsd: afterPrice.monthlyUsd,
        deltaMonthlyUsd,
        beforeMonthlyRub: beforePrice.monthlyRub,
        afterMonthlyRub: afterPrice.monthlyRub,
        deltaMonthlyRub,
        unknown,
        supported: !unknown,
        priceSource: unknown ? 'fallback-unknown' : 'catalog',
        fallbackHourlyUsd: unknown
          ? afterPrice.fallbackHourlyUsd ?? beforePrice.fallbackHourlyUsd ?? null
          : null,
      });
    }
  } else {
    const resourceList = Array.isArray(input)
      ? input
      : Array.isArray(input.resources)
      ? input.resources
      : [];

    for (const res of resourceList) {
      const action = res.action || 'create';
      const address = res.address || `${res.type}.${res.name || 'resource'}`;
      const price = lookupResourcePrice(res, usdToRub, priceOptions);

      let beforeMonthlyUsd = 0;
      let afterMonthlyUsd = price.monthlyUsd;
      let unknown = price.supported === false;
      let fallbackHourlyUsd = price.fallbackHourlyUsd ?? null;

      if (action === 'delete') {
        beforeMonthlyUsd = price.monthlyUsd;
        afterMonthlyUsd = 0;
      } else if (action === 'update' && res.before) {
        const beforePrice = lookupResourcePrice({ ...res.before, type: res.type }, usdToRub, priceOptions);
        beforeMonthlyUsd = beforePrice.monthlyUsd;
        unknown = unknown || beforePrice.supported === false;
        fallbackHourlyUsd = fallbackHourlyUsd ?? beforePrice.fallbackHourlyUsd ?? null;
      } else if (action === 'no-op') {
        beforeMonthlyUsd = price.monthlyUsd;
        afterMonthlyUsd = price.monthlyUsd;
      }

      const beforeMonthlyRub = Number((beforeMonthlyUsd * usdToRub).toFixed(2));
      const afterMonthlyRub = Number((afterMonthlyUsd * usdToRub).toFixed(2));
      const deltaMonthlyUsd = Number((afterMonthlyUsd - beforeMonthlyUsd).toFixed(2));
      const deltaMonthlyRub = Number((afterMonthlyRub - beforeMonthlyRub).toFixed(2));

      diffItems.push({
        address,
        type: res.type,
        action,
        sku: price.sku,
        beforeMonthlyUsd,
        afterMonthlyUsd,
        deltaMonthlyUsd,
        beforeMonthlyRub,
        afterMonthlyRub,
        deltaMonthlyRub,
        unknown,
        supported: !unknown,
        priceSource: unknown ? 'fallback-unknown' : 'catalog',
        fallbackHourlyUsd: unknown ? fallbackHourlyUsd : null,
      });
    }
  }

  const beforeMonthlyUsd = Number(
    diffItems.reduce((acc, i) => acc + i.beforeMonthlyUsd, 0).toFixed(2)
  );
  const afterMonthlyUsd = Number(
    diffItems.reduce((acc, i) => acc + i.afterMonthlyUsd, 0).toFixed(2)
  );
  const deltaMonthlyUsd = Number((afterMonthlyUsd - beforeMonthlyUsd).toFixed(2));

  const beforeMonthlyRub = Number((beforeMonthlyUsd * usdToRub).toFixed(2));
  const afterMonthlyRub = Number((afterMonthlyUsd * usdToRub).toFixed(2));
  const deltaMonthlyRub = Number((afterMonthlyRub - beforeMonthlyRub).toFixed(2));

  let deltaPct = 0;
  if (beforeMonthlyUsd > 0) {
    deltaPct = Number(((deltaMonthlyUsd / beforeMonthlyUsd) * 100).toFixed(2));
  } else if (afterMonthlyUsd > 0) {
    deltaPct = 100;
  }

  const unknownItems = diffItems
    .filter((item) => item.unknown)
    .map((item) => ({
      address: item.address,
      type: item.type,
      action: item.action,
      sku: item.sku,
      beforeMonthlyUsd: item.beforeMonthlyUsd,
      afterMonthlyUsd: item.afterMonthlyUsd,
      deltaMonthlyUsd: item.deltaMonthlyUsd,
      fallbackHourlyUsd: item.fallbackHourlyUsd,
      priceSource: item.priceSource,
    }));
  const unknownTypes = [...new Set(unknownItems.map((item) => item.type).filter(Boolean))].sort();
  const unknownMonthlyUsd = Number(
    unknownItems
      .reduce((acc, item) => acc + Math.max(item.beforeMonthlyUsd, item.afterMonthlyUsd), 0)
      .toFixed(2)
  );
  const unknownDeltaMonthlyUsd = Number(
    unknownItems.reduce((acc, item) => acc + item.deltaMonthlyUsd, 0).toFixed(2)
  );
  const effectiveFallbackHourlyUsd =
    unknownItems.find((item) => item.fallbackHourlyUsd !== null)?.fallbackHourlyUsd ??
    resolveUnknownResourceHourlyUsd(unknownHourlyUsd);

  const summary = {
    resourceCount: diffItems.length,
    beforeMonthlyUsd,
    afterMonthlyUsd,
    deltaMonthlyUsd,
    beforeHourlyUsd: Number((beforeMonthlyUsd / HOURS_PER_MONTH).toFixed(4)),
    afterHourlyUsd: Number((afterMonthlyUsd / HOURS_PER_MONTH).toFixed(4)),
    beforeMonthlyRub,
    afterMonthlyRub,
    deltaMonthlyRub,
    deltaPct,
    usdToRubRate: usdToRub,
    unknownResourceCount: unknownItems.length,
    unknownResourceTypes: unknownTypes,
    unknownMonthlyUsd,
    unknownDeltaMonthlyUsd,
    unknownFallbackHourlyUsd: effectiveFallbackHourlyUsd,
  };

  const policy = evaluateBudgetPolicy(deltaMonthlyUsd, deltaPct, thresholds, {
    strictUnknown,
    baselineMonthlyUsd: beforeMonthlyUsd,
    unknownResourceCount: unknownItems.length,
    unknownResourceTypes: unknownTypes,
    unknownFallbackHourlyUsd: effectiveFallbackHourlyUsd,
    unknownMonthlyUsd,
  });

  const report = {
    provider: 'perfops-infracost',
    timestamp: new Date().toISOString(),
    summary,
    policy,
    diffItems,
    unknownResources: {
      count: unknownItems.length,
      types: unknownTypes,
      strict: strictUnknown,
      status: policy.unknown.status,
      fallbackHourlyUsd: effectiveFallbackHourlyUsd,
      envVar: UNKNOWN_RESOURCE_HOURLY_ENV,
      monthlyUsd: unknownMonthlyUsd,
      deltaMonthlyUsd: unknownDeltaMonthlyUsd,
      items: unknownItems,
    },
    integrations: {
      finopsCostAgentHook: 'https://aco.perfops.shop/api/v1/gate/infracost',
      globexProject: 'globex-portal',
    },
  };

  report.prMarkdown = generatePrMarkdownComment(report);
  report.junitXml = generateJUnitXml(report);
  return report;
}
