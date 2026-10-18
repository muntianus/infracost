/**
 * Pure Terraform plan normalization helpers.
 * Deliberately preserves the historical interpretation of plan actions and
 * optional attributes so the refactor changes structure, not pricing rules.
 */
export function normalizeTfValues(type, name, values) {
  if (!values || typeof values !== 'object') {
    return null;
  }

  return {
    type,
    name,
    sku: values.sku,
    instance_type: values.instance_type,
    instance_class: values.instance_class,
    machine_type: values.machine_type,
    tier: values.tier,
    load_balancer_type: values.load_balancer_type,
    volume_type: values.volume_type || values.type,
    size: values.size || values.size_gb,
    allocated_storage: values.allocated_storage || values.disk_size,
    multi_az: values.multi_az,
    availability_type: values.availability_type,
    monthly_data_gb: values.monthly_data_gb,
    count: values.count || 1,
  };
}

export function normalizeTfAction(actions = ['create']) {
  if (actions.includes('create') && actions.includes('delete')) {
    return 'replace';
  }
  if (actions.includes('create')) {
    return 'create';
  }
  if (actions.includes('delete')) {
    return 'delete';
  }
  if (actions.includes('update')) {
    return 'update';
  }
  return 'no-op';
}
