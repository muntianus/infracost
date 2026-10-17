/**
 * PerfOps Infracost HTTP Microservice
 * Default PORT: 4050
 */

import http from 'node:http';
import { URL } from 'node:url';
import { getFullPricingCatalog, getGlobexInfraPreset } from './pricing-db.js';
import { analyzeTerraformPlan } from './diff-engine.js';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

export function createInfracostServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'perfops-infracost',
        version: '1.0.0',
        integrations: ['finops-cost-agent', 'aco.perfops.shop', 'globex'],
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/v1/prices') {
      const rateParam = Number(parsedUrl.searchParams.get('usdToRub'));
      const catalog = getFullPricingCatalog(
        Number.isFinite(rateParam) && rateParam > 0 ? rateParam : undefined
      );
      sendJson(res, 200, catalog);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/v1/presets/globex-infra') {
      const rateParam = Number(parsedUrl.searchParams.get('usdToRub'));
      const preset = getGlobexInfraPreset(
        Number.isFinite(rateParam) && rateParam > 0 ? rateParam : undefined
      );
      sendJson(res, 200, preset);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/v1/estimate') {
      try {
        const body = await readJsonBody(req);
        const report = analyzeTerraformPlan(body, {
          usdToRub: body.usdToRub,
          thresholds: body.thresholds,
        });
        sendJson(res, 200, report);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    sendJson(res, 404, { error: `Route ${req.method} ${pathname} not found` });
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
