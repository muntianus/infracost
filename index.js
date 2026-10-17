/**
 * PerfOps Infracost SDK & PR Gate Adapter Entrypoint
 */

export {
  PRICING_TABLE,
  HOURS_PER_MONTH,
  DEFAULT_USD_TO_RUB,
  lookupResourcePrice,
  getFullPricingCatalog,
  getGlobexInfraPreset,
} from './src/pricing-db.js';

export {
  DEFAULT_POLICY_THRESHOLDS,
  evaluateBudgetPolicy,
  generatePrMarkdownComment,
  analyzeTerraformPlan,
} from './src/diff-engine.js';

export { createInfracostServer } from './src/server.js';

export function evaluateCostDelta(diffJson) {
  const delta = Number(diffJson?.monthlyCostDiff ?? diffJson?.summary?.deltaMonthlyUsd ?? 0);
  return {
    passed: delta < 500,
    status: delta >= 500 ? 'BLOCK' : delta >= 100 ? 'WARN' : 'PASS',
    provider: 'infracost',
  };
}
