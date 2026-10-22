/**
 * PerfOps Infracost HTTP Microservice
 * Default PORT: 4050
 */

import http from 'node:http';
import { URL } from 'node:url';
import { getFullPricingCatalog, getGlobexInfraPreset } from './pricing-db.js';
import { analyzeTerraformPlan } from './diff-engine.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/** `?usdToRub=` override; ignored unless it is a positive number. */
function usdToRubParam(url) {
  const rate = Number(url.searchParams.get('usdToRub'));
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function health(req, res) {
  sendJson(res, 200, {
    status: 'ok',
    service: 'perfops-infracost',
    version: '1.0.0',
    integrations: ['finops-cost-agent', 'aco.perfops.shop', 'globex'],
    timestamp: new Date().toISOString(),
  });
}

function prices(req, res, url) {
  sendJson(res, 200, getFullPricingCatalog(usdToRubParam(url)));
}

function globexInfraPreset(req, res, url) {
  sendJson(res, 200, getGlobexInfraPreset(usdToRubParam(url)));
}

async function estimate(req, res, url) {
  try {
    const body = await readJsonBody(req);
    const strictQuery = String(url.searchParams.get('strictUnknown') || '').toLowerCase();
    const strictUnknown =
      body.strictUnknown === true ||
      strictQuery === '1' ||
      strictQuery === 'true';
    const analyzeOptions = {
      usdToRub: body.usdToRub,
      thresholds: body.thresholds,
      unknownHourlyUsd: body.unknownHourlyUsd,
    };
    if (strictUnknown) {
      analyzeOptions.strictUnknown = true;
    }
    sendJson(res, 200, analyzeTerraformPlan(body, analyzeOptions));
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

/**
 * Every route the service answers. tests/openapi-contract.test.js keeps this
 * table and docs/api/openapi.json in lockstep.
 */
export const ROUTES = [
  { method: 'GET', path: '/health', handler: health },
  { method: 'GET', path: '/api/v1/prices', handler: prices },
  { method: 'GET', path: '/api/v1/presets/globex-infra', handler: globexInfraPreset },
  { method: 'POST', path: '/api/v1/estimate', handler: estimate },
];

export function createInfracostServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const route = ROUTES.find((r) => r.method === req.method && r.path === url.pathname);
    if (!route) {
      sendJson(res, 404, { error: `Route ${req.method} ${url.pathname} not found` });
      return;
    }
    await route.handler(req, res, url);
  });
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
  const port = Number(process.env.PORT || 4050);
  const server = createInfracostServer();
  server.listen(port, () => {
    console.log(`[perfops-infracost] listening on http://0.0.0.0:${port}`);
  });
}
