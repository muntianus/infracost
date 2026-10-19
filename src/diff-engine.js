/**
 * PerfOps Infracost Terraform Plan Diff & PR Gate Engine
 * Parses Terraform plan JSON (`resource_changes` with create/update/delete or simplified `resources` list),
 * computes monthly USD & RUB cost before/after, delta %, budget policy gate (PASS / WARN / BLOCK),
 * and generates a GitHub PR Markdown comment table.
 */

import { lookupResourcePrice, DEFAULT_USD_TO_RUB, HOURS_PER_MONTH } from './pricing-db.js';
import { normalizeTfValues, normalizeTfAction } from './terraform-normalizer.js';

export const DEFAULT_POLICY_THRESHOLDS = {
  warnDeltaUsd: 100,
  blockDeltaUsd: 500,
  warnDeltaPct: 15,
  blockDeltaPct: 50,
};

/**
 * Evaluates budget gate status (`PASS`, `WARN`, `BLOCK`) given cost deltas and thresholds.
 */
export function evaluateBudgetPolicy(
  deltaMonthlyUsd,
  deltaPct,
  thresholds = DEFAULT_POLICY_THRESHOLDS
) {
  const warnUsd = thresholds.warnDeltaUsd ?? DEFAULT_POLICY_THRESHOLDS.warnDeltaUsd;
  const blockUsd = thresholds.blockDeltaUsd ?? DEFAULT_POLICY_THRESHOLDS.blockDeltaUsd;
  const warnPct = thresholds.warnDeltaPct ?? DEFAULT_POLICY_THRESHOLDS.warnDeltaPct;
  const blockPct = thresholds.blockDeltaPct ?? DEFAULT_POLICY_THRESHOLDS.blockDeltaPct;

  const reasons = [];
  let status = 'PASS';

  if (deltaMonthlyUsd >= blockUsd || (deltaMonthlyUsd > 0 && deltaPct >= blockPct)) {
    status = 'BLOCK';
    if (deltaMonthlyUsd >= blockUsd) {
      reasons.push(`Monthly cost increase (+$${deltaMonthlyUsd.toFixed(2)}) exceeds block threshold ($${blockUsd.toFixed(2)})`);
    }
    if (deltaPct >= blockPct) {
      reasons.push(`Cost delta (+${deltaPct.toFixed(1)}%) exceeds block percentage threshold (${blockPct}%)`);
    }
  } else if (deltaMonthlyUsd >= warnUsd || (deltaMonthlyUsd > 0 && deltaPct >= warnPct)) {
    status = 'WARN';
    if (deltaMonthlyUsd >= warnUsd) {
      reasons.push(`Monthly cost increase (+$${deltaMonthlyUsd.toFixed(2)}) exceeds warning threshold ($${warnUsd.toFixed(2)})`);
    }
    if (deltaPct >= warnPct) {
      reasons.push(`Cost delta (+${deltaPct.toFixed(1)}%) exceeds warning percentage threshold (${warnPct}%)`);
    }
  } else {
    reasons.push('Cost delta is within PerfOps FinOps budget guardrails.');
  }

  return {
    status,
    passed: status !== 'BLOCK',
    reasons,
    thresholds: { warnDeltaUsd: warnUsd, blockDeltaUsd: blockUsd, warnDeltaPct: warnPct, blockDeltaPct: blockPct },
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

  lines.push('');
  lines.push(`**Policy Gate (${policy.status}):** ${policy.reasons.join('; ')}`);
  return lines.join('\n');
}

/**
 * Parses either a Terraform Plan JSON (`resource_changes`) or a simplified resource list (`resources` or Array)
 * and produces a complete FinOps diff report.
 */
export function analyzeTerraformPlan(input = {}, options = {}) {
  const usdToRub = Number(options.usdToRub || input.usdToRub || DEFAULT_USD_TO_RUB);
  const thresholds = { ...DEFAULT_POLICY_THRESHOLDS, ...(options.thresholds || input.policyThresholds || {}) };

  const diffItems = [];

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
        ? lookupResourcePrice(beforeSpec, usdToRub)
        : { monthlyUsd: 0, monthlyRub: 0, hourlyUsd: 0, sku: '-' };
      const afterPrice = afterSpec
        ? lookupResourcePrice(afterSpec, usdToRub)
        : { monthlyUsd: 0, monthlyRub: 0, hourlyUsd: 0, sku: '-' };

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
      const price = lookupResourcePrice(res, usdToRub);

      let beforeMonthlyUsd = 0;
      let afterMonthlyUsd = price.monthlyUsd;

      if (action === 'delete') {
        beforeMonthlyUsd = price.monthlyUsd;
        afterMonthlyUsd = 0;
      } else if (action === 'update' && res.before) {
        const beforePrice = lookupResourcePrice({ ...res.before, type: res.type }, usdToRub);
        beforeMonthlyUsd = beforePrice.monthlyUsd;
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
  };

  const policy = evaluateBudgetPolicy(deltaMonthlyUsd, deltaPct, thresholds);

  const report = {
    provider: 'perfops-infracost',
    timestamp: new Date().toISOString(),
    summary,
    policy,
    diffItems,
    integrations: {
      finopsCostAgentHook: 'https://aco.perfops.shop/api/v1/gate/infracost',
      globexProject: 'globex-portal',
    },
  };

  report.prMarkdown = generatePrMarkdownComment(report);
  return report;
}
