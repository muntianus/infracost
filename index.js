// PerfOps Infracost PR Gate Adapter
export function evaluateCostDelta(diffJson) {
  return { passed: (diffJson?.monthlyCostDiff ?? 0) < 500, provider: 'infracost' };
}
