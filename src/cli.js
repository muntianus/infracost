#!/usr/bin/env node
/**
 * PerfOps Infracost PR gate CLI.
 *
 * Usage:
 *   node src/cli.js plan.json [--strict-unknown] [--format markdown|json|junit]
 *                             [--junit-out gate-junit.xml] [--unknown-hourly 0.05]
 *
 * Exit codes: 0 = PASS/WARN, 1 = FAIL/BLOCK, 2 = invalid input or usage.
 */

import fs from 'node:fs';
import process from 'node:process';
import { analyzeTerraformPlan } from './diff-engine.js';
import { UNKNOWN_RESOURCE_HOURLY_ENV } from './pricing-db.js';

const USAGE = `Usage: node src/cli.js <plan.json|-> [options]

Options:
  --strict-unknown           Fail the gate on unknown resource types (default: WARN)
  --format <markdown|json|junit>  Output format (default: markdown)
  --junit-out <path>         Also write JUnit XML to a file
  --out <path>               Write the selected format to a file instead of stdout
  --unknown-hourly <usd>     Fallback rate for unknown types (default: $${process.env[UNKNOWN_RESOURCE_HOURLY_ENV] || '0.05'}/h)
  --usd-to-rub <rate>        USD to RUB conversion rate
  --help                     Show this help

Environment:
  INFRACOST_UNKNOWN_RESOURCE_HOURLY   Fallback hourly USD rate for unknown types
  INFRACOST_STRICT_UNKNOWN=1          Same as --strict-unknown`;

function fail(message) {
  console.error(`[infracost-gate] ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = {
    input: null,
    strictUnknown: false,
    format: 'markdown',
    junitOut: null,
    out: null,
    unknownHourlyUsd: undefined,
    usdToRub: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--strict-unknown':
        parsed.strictUnknown = true;
        break;
      case '--format':
        parsed.format = argv[++i];
        break;
      case '--junit-out':
        parsed.junitOut = argv[++i];
        break;
      case '--out':
        parsed.out = argv[++i];
        break;
      case '--unknown-hourly':
        parsed.unknownHourlyUsd = argv[++i];
        break;
      case '--usd-to-rub':
        parsed.usdToRub = argv[++i];
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        if (arg.startsWith('-') && arg !== '-') {
          fail(`Unknown option: ${arg}`);
        }
        if (parsed.input !== null) {
          fail(`Unexpected argument: ${arg}`);
        }
        parsed.input = arg;
        break;
    }
  }

  if (!['markdown', 'json', 'junit'].includes(parsed.format)) {
    fail(`Unsupported --format: ${parsed.format}`);
  }
  if (parsed.unknownHourlyUsd !== undefined) {
    const rate = Number(parsed.unknownHourlyUsd);
    if (!Number.isFinite(rate) || rate <= 0) {
      fail(`--unknown-hourly must be a positive number, got: ${parsed.unknownHourlyUsd}`);
    }
    parsed.unknownHourlyUsd = rate;
  }
  if (parsed.usdToRub !== undefined) {
    const rate = Number(parsed.usdToRub);
    if (!Number.isFinite(rate) || rate <= 0) {
      fail(`--usd-to-rub must be a positive number, got: ${parsed.usdToRub}`);
    }
    parsed.usdToRub = rate;
  }

  return parsed;
}

function readInput(input) {
  try {
    if (!input || input === '-') {
      return fs.readFileSync(0, 'utf8');
    }
    return fs.readFileSync(input, 'utf8');
  } catch (err) {
    fail(`Cannot read plan: ${err.message}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const raw = readInput(args.input);
let plan;
try {
  plan = JSON.parse(raw);
} catch (err) {
  fail(`Invalid Terraform plan JSON: ${err.message}`);
}

const report = analyzeTerraformPlan(plan, {
  strictUnknown: args.strictUnknown || undefined,
  unknownHourlyUsd: args.unknownHourlyUsd,
  usdToRub: args.usdToRub,
});

const output =
  args.format === 'json'
    ? JSON.stringify(report, null, 2)
    : args.format === 'junit'
    ? report.junitXml
    : report.prMarkdown;

if (args.junitOut) {
  fs.writeFileSync(args.junitOut, `${report.junitXml}\n`, 'utf8');
}
if (args.out) {
  fs.writeFileSync(args.out, `${output}\n`, 'utf8');
} else {
  console.log(output);
}

console.error(
  `[infracost-gate] status=${report.policy.status} passed=${report.policy.passed} unknown=${report.unknownResources.count} types=${report.unknownResources.types.join(',') || '-'}`
);

process.exit(report.policy.passed ? 0 : 1);
