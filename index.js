/**
 * PerfOps Infracost SDK & PR Gate Adapter Entrypoint
 */

export {
  PRICING_TABLE,
  HOURS_PER_MONTH,
  DEFAULT_USD_TO_RUB,
  DEFAULT_UNKNOWN_RESOURCE_HOURLY_USD,
  UNKNOWN_RESOURCE_HOURLY_ENV,
  resolveUnknownResourceHourlyUsd,
  lookupResourcePrice,
  getFullPricingCatalog,
  getGlobexInfraPreset,
} from './src/pricing-db.js';

export {
  DEFAULT_POLICY_THRESHOLDS,
  evaluateBudgetPolicy,
  generatePrMarkdownComment,
  generateJUnitXml,
  analyzeTerraformPlan,
} from './src/diff-engine.js';

export { createInfracostServer } from './src/server.js';

export function evaluateCostDelta(diffJson) {
  const delta = Number(diffJson?.monthlyCostDiff ?? diffJson?.summary?.deltaMonthlyUsd ?? 0);
  const unknownResourceCount = Number(
    diffJson?.unknownResources?.count ?? diffJson?.summary?.unknownResourceCount ?? 0
  );
  const strictUnknown = diffJson?.unknownResources?.strict === true;

  let status = delta >= 500 ? 'BLOCK' : delta >= 100 ? 'WARN' : 'PASS';
  if (unknownResourceCount > 0) {
    status = strictUnknown ? 'FAIL' : status === 'PASS' ? 'WARN' : status;
  }

  return {
    passed: status === 'PASS' || status === 'WARN',
    status,
    provider: 'infracost',
    unknownResourceCount,
    unknownResourceTypes: diffJson?.unknownResources?.types || diffJson?.summary?.unknownResourceTypes || [],
  };
}
