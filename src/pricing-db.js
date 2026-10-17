/**
 * PerfOps Infracost Cloud Resource Pricing Database
 * Covers AWS, GCP, and Hostinger VPS resources with hourly/monthly USD and RUB rates.
 */

export const HOURS_PER_MONTH = 730;
export const DEFAULT_USD_TO_RUB = 96.5;

export const PRICING_TABLE = {
  // AWS Resources
  aws_instance: {
    provider: 'aws',
    category: 'compute',
    defaultSku: 't3.medium',
    skus: {
      't3.micro': { hourlyUsd: 0.0104, monthlyUsd: 7.59, vcpu: 2, ramGb: 1 },
      't3.small': { hourlyUsd: 0.0208, monthlyUsd: 15.18, vcpu: 2, ramGb: 2 },
      't3.medium': { hourlyUsd: 0.0416, monthlyUsd: 30.37, vcpu: 2, ramGb: 4 },
      't3.large': { hourlyUsd: 0.0832, monthlyUsd: 60.74, vcpu: 2, ramGb: 8 },
      'm6i.large': { hourlyUsd: 0.096, monthlyUsd: 70.08, vcpu: 2, ramGb: 8 },
      'm6i.xlarge': { hourlyUsd: 0.192, monthlyUsd: 140.16, vcpu: 4, ramGb: 16 },
      'c6i.2xlarge': { hourlyUsd: 0.34, monthlyUsd: 248.2, vcpu: 8, ramGb: 16 },
    },
  },
  aws_db_instance: {
    provider: 'aws',
    category: 'database',
    defaultSku: 'db.t3.medium',
    skus: {
      'db.t3.micro': { hourlyUsd: 0.017, monthlyUsd: 12.41, vcpu: 2, ramGb: 1 },
      'db.t3.small': { hourlyUsd: 0.034, monthlyUsd: 24.82, vcpu: 2, ramGb: 2 },
      'db.t3.medium': { hourlyUsd: 0.068, monthlyUsd: 49.64, vcpu: 2, ramGb: 4 },
      'db.m6i.large': { hourlyUsd: 0.171, monthlyUsd: 124.83, vcpu: 2, ramGb: 8 },
      'db.r6i.xlarge': { hourlyUsd: 0.48, monthlyUsd: 350.4, vcpu: 4, ramGb: 32 },
    },
    storageGbMonthlyUsd: 0.115,
  },
  aws_nat_gateway: {
    provider: 'aws',
    category: 'network',
    defaultSku: 'standard',
    skus: {
      standard: { hourlyUsd: 0.045, monthlyUsd: 32.85 },
    },
    perGbProcessedUsd: 0.045,
  },
  aws_lb: {
    provider: 'aws',
    category: 'network',
    defaultSku: 'application',
    skus: {
      application: { hourlyUsd: 0.0225, monthlyUsd: 16.43 },
      network: { hourlyUsd: 0.0225, monthlyUsd: 16.43 },
    },
  },
  aws_ebs_volume: {
    provider: 'aws',
    category: 'storage',
    defaultSku: 'gp3',
    skus: {
      gp2: { hourlyUsd: 0.000137, monthlyUsd: 0.1, perGbMonthlyUsd: 0.1 },
      gp3: { hourlyUsd: 0.00011, monthlyUsd: 0.08, perGbMonthlyUsd: 0.08 },
      io2: { hourlyUsd: 0.000171, monthlyUsd: 0.125, perGbMonthlyUsd: 0.125 },
    },
    defaultSizeGb: 50,
  },

  // GCP Resources
  google_compute_instance: {
    provider: 'gcp',
    category: 'compute',
    defaultSku: 'e2-standard-2',
    skus: {
      'e2-micro': { hourlyUsd: 0.0084, monthlyUsd: 6.13, vcpu: 2, ramGb: 1 },
      'e2-small': { hourlyUsd: 0.0168, monthlyUsd: 12.26, vcpu: 2, ramGb: 2 },
      'e2-medium': { hourlyUsd: 0.0335, monthlyUsd: 24.46, vcpu: 2, ramGb: 4 },
      'e2-standard-2': { hourlyUsd: 0.067, monthlyUsd: 48.91, vcpu: 2, ramGb: 8 },
      'e2-standard-4': { hourlyUsd: 0.134, monthlyUsd: 97.82, vcpu: 4, ramGb: 16 },
      'n2-standard-4': { hourlyUsd: 0.1942, monthlyUsd: 141.77, vcpu: 4, ramGb: 16 },
    },
  },
  google_container_cluster: {
    provider: 'gcp',
    category: 'kubernetes',
    defaultSku: 'standard',
    skus: {
      autopilot: { hourlyUsd: 0.1, monthlyUsd: 73.0 },
      standard: { hourlyUsd: 0.1, monthlyUsd: 73.0 },
      zonal_free: { hourlyUsd: 0.0, monthlyUsd: 0.0 },
    },
  },
  google_sql_database_instance: {
    provider: 'gcp',
    category: 'database',
    defaultSku: 'db-custom-2-7680',
    skus: {
      'db-f1-micro': { hourlyUsd: 0.015, monthlyUsd: 10.95, vcpu: 1, ramGb: 0.6 },
      'db-g1-small': { hourlyUsd: 0.05, monthlyUsd: 36.5, vcpu: 1, ramGb: 1.7 },
      'db-custom-2-7680': { hourlyUsd: 0.1325, monthlyUsd: 96.73, vcpu: 2, ramGb: 7.5 },
      'db-custom-4-15360': { hourlyUsd: 0.265, monthlyUsd: 193.45, vcpu: 4, ramGb: 15 },
    },
    storageGbMonthlyUsd: 0.17,
  },

  // Hostinger VPS Resources (PerfOps & Globex Estate)
  hostinger_vps_kvm1: {
    provider: 'hostinger',
    category: 'vps',
    defaultSku: 'kvm1',
    skus: {
      kvm1: { hourlyUsd: 0.0082, monthlyUsd: 5.99, vcpu: 1, ramGb: 4, nvmeGb: 50 },
    },
  },
  hostinger_vps_kvm2: {
    provider: 'hostinger',
    category: 'vps',
    defaultSku: 'kvm2',
    skus: {
      kvm2: { hourlyUsd: 0.0123, monthlyUsd: 8.99, vcpu: 2, ramGb: 8, nvmeGb: 100 },
    },
  },
  hostinger_vps_kvm4: {
    provider: 'hostinger',
    category: 'vps',
    defaultSku: 'kvm4',
    skus: {
      kvm4: { hourlyUsd: 0.0219, monthlyUsd: 15.99, vcpu: 4, ramGb: 16, nvmeGb: 200 },
    },
  },
};

/**
 * Resolves the SKU and monthly/hourly cost for a single Terraform resource descriptor.
 * @param {object} resource - { type, name, sku, instance_type, machine_type, tier, size, allocated_storage, count, multi_az, ... }
 * @param {number} [usdToRub=DEFAULT_USD_TO_RUB]
 */
export function lookupResourcePrice(resource = {}, usdToRub = DEFAULT_USD_TO_RUB) {
  const type = resource.type || resource.resource_type;
  const entry = PRICING_TABLE[type];
  if (!entry) {
    return {
      type: type || 'unknown',
      provider: 'unknown',
      sku: 'unrecognized',
      hourlyUsd: 0,
      monthlyUsd: 0,
      monthlyRub: 0,
      supported: false,
    };
  }

  const rawSku =
    resource.sku ||
    resource.instance_type ||
    resource.instance_class ||
    resource.machine_type ||
    resource.tier ||
    resource.load_balancer_type ||
    resource.volume_type ||
    entry.defaultSku;

  const skuInfo = entry.skus[rawSku] || entry.skus[entry.defaultSku];
  const resolvedSku = entry.skus[rawSku] ? rawSku : entry.defaultSku;
  const count = Number.isFinite(Number(resource.count)) && Number(resource.count) > 0 ? Number(resource.count) : 1;

  let baseMonthlyUsd = skuInfo.monthlyUsd;

  if (type === 'aws_ebs_volume') {
    const sizeGb = Number(resource.size || resource.size_gb || entry.defaultSizeGb || 50);
    const perGb = skuInfo.perGbMonthlyUsd || 0.08;
    baseMonthlyUsd = sizeGb * perGb;
  } else if (type === 'aws_db_instance' || type === 'google_sql_database_instance') {
    const storageGb = Number(resource.allocated_storage || resource.disk_size || 0);
    if (storageGb > 0 && entry.storageGbMonthlyUsd) {
      baseMonthlyUsd += storageGb * entry.storageGbMonthlyUsd;
    }
    if (resource.multi_az === true || resource.availability_type === 'REGIONAL') {
      baseMonthlyUsd *= 2;
    }
  } else if (type === 'aws_nat_gateway') {
    const dataGb = Number(resource.monthly_data_gb || 0);
    if (dataGb > 0 && entry.perGbProcessedUsd) {
      baseMonthlyUsd += dataGb * entry.perGbProcessedUsd;
    }
  }

  const totalMonthlyUsd = Number((baseMonthlyUsd * count).toFixed(2));
  const totalHourlyUsd = Number((totalMonthlyUsd / HOURS_PER_MONTH).toFixed(4));
  const totalMonthlyRub = Number((totalMonthlyUsd * usdToRub).toFixed(2));

  return {
    type,
    name: resource.name || resource.address || type,
    provider: entry.provider,
    category: entry.category,
    sku: resolvedSku,
    count,
    hourlyUsd: totalHourlyUsd,
    monthlyUsd: totalMonthlyUsd,
    monthlyRub: totalMonthlyRub,
    supported: true,
  };
}

/**
 * Returns full catalog metadata for GET /api/v1/prices
 */
export function getFullPricingCatalog(usdToRub = DEFAULT_USD_TO_RUB) {
  return {
    currency: 'USD',
    secondaryCurrency: 'RUB',
    usdToRubRate: usdToRub,
    hoursPerMonth: HOURS_PER_MONTH,
    resourceTypes: Object.keys(PRICING_TABLE),
    catalog: PRICING_TABLE,
  };
}

/**
 * Returns the Globex & PerfOps production topology cost breakdown preset.
 */
export function getGlobexInfraPreset(usdToRub = DEFAULT_USD_TO_RUB) {
  const topologyResources = [
    {
      type: 'hostinger_vps_kvm4',
      name: 'perfops-prod-vps-72-62-71-140',
      sku: 'kvm4',
      role: 'Primary Docker Host (Globex Portal, ACO FinOps, Prometheus, Grafana, cAdvisor)',
    },
    {
      type: 'hostinger_vps_kvm2',
      name: 'perfops-edge-gateway-vps',
      sku: 'kvm2',
      role: 'Edge Reverse Proxy & Canary Load Generator',
    },
    {
      type: 'aws_db_instance',
      name: 'globex-rds-replica-standby',
      instance_class: 'db.t3.small',
      allocated_storage: 40,
      role: 'Managed DR Standby PostgreSQL Replica',
    },
    {
      type: 'aws_ebs_volume',
      name: 'perfops-backups-ebs',
      volume_type: 'gp3',
      size: 100,
      role: 'Encrypted Snapshot & Telemetry Cold Storage',
    },
  ];

  const breakdown = topologyResources.map((item) => ({
    ...lookupResourcePrice(item, usdToRub),
    role: item.role,
  }));

  const totalMonthlyUsd = Number(
    breakdown.reduce((acc, r) => acc + r.monthlyUsd, 0).toFixed(2)
  );
  const totalHourlyUsd = Number((totalMonthlyUsd / HOURS_PER_MONTH).toFixed(4));
  const totalMonthlyRub = Number((totalMonthlyUsd * usdToRub).toFixed(2));

  return {
    preset: 'globex-infra',
    description: 'Globex & PerfOps Production Topology (Hostinger KVM VPS + AWS DR Backup)',
    integrations: {
      finopsCostAgent: 'https://aco.perfops.shop/api/v1/ingest/infracost',
      globexPortal: 'https://globex.perfops.tech',
    },
    summary: {
      resourceCount: breakdown.length,
      hourlyUsd: totalHourlyUsd,
      monthlyUsd: totalMonthlyUsd,
      monthlyRub: totalMonthlyRub,
      usdToRubRate: usdToRub,
    },
    resources: breakdown,
  };
}
