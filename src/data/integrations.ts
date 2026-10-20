// Integration catalog fixture (front-end only).
// Each integration is modeled as an MCP server exposing named tools.

export type IntegrationStatus = 'connected' | 'auth' | 'soon';
export type PermissionMode = 'read' | 'ask' | 'auto';
export type IntegrationCategory = 'cloud' | 'infra' | 'obs' | 'collab' | 'custom';

export type Tool = { name: string; desc: string; write?: boolean };

export type Integration = {
  id: string;
  cat: IntegrationCategory;
  mono: string;
  name: string;
  transport: string;
  status: IntegrationStatus;
  desc: string;
  mode?: PermissionMode;
  sync?: string;
  f1?: string;
  v1?: string;
  f2?: string;
  scope?: string[];
  tools?: Tool[];
};

const T = (name: string, desc: string, write = false): Tool => ({ name, desc, write });

export const CATALOG: Integration[] = [
  { id: 'aws', cat: 'cloud', mono: 'AWS', name: 'Amazon Web Services', transport: 'remote · https', status: 'connected', mode: 'ask', sync: 'synced 2 min ago',
    desc: 'EC2, RDS, EBS, S3, load balancers and Cost Explorer across your accounts.', f1: 'Access key ID', v1: 'AKIA••••••••7Q2M', f2: 'Secret access key',
    scope: ['123456789012 · us-east-1', 'us-west-2'],
    tools: [ T('ec2.describe_instances', 'List instances with type, state and tags'), T('ec2.describe_volumes', 'List EBS volumes and attachments'), T('rds.describe_db_instances', 'List databases and their classes'),
      T('cloudwatch.get_metric_statistics', 'CPU, memory and I/O over time'), T('ce.get_cost_and_usage', 'Spend by service, account and tag'), T('ce.get_rightsizing_recommendation', 'AWS rightsizing suggestions'),
      T('s3.list_buckets', 'Buckets, size and last access'), T('elb.describe_load_balancers', 'Load balancers and target health'), T('tags.get_resources', 'Resource owners from tags'),
      T('iam.simulate_principal_policy', 'Verify the role is read-only'), T('compute_optimizer.get_recommendations', 'Instance and EBS recommendations'),
      T('ec2.stop_instances', 'Stop idle instances (reversible)', true), T('ec2.delete_volume', 'Delete unattached volumes after snapshot', true), T('rds.modify_db_instance', 'Change a database instance class', true) ] },
  { id: 'azure', cat: 'cloud', mono: 'AZ', name: 'Microsoft Azure', transport: 'remote · https', status: 'connected', mode: 'ask', sync: 'synced 6 min ago',
    desc: 'VMs, managed disks, SQL databases and Cost Management for your subscriptions.', f1: 'Client ID', v1: 'a1b2c3d4-••••-7890', f2: 'Client secret',
    scope: ['East US subscription'],
    tools: [ T('compute.list_vms', 'Virtual machines and sizes'), T('disks.list', 'Managed disks and attachments'), T('sql.list_databases', 'SQL databases and tiers'), T('monitor.query_metrics', 'Utilization metrics'),
      T('costmanagement.query', 'Spend by resource group'), T('advisor.list_recommendations', 'Azure Advisor cost items'), T('aks.list_clusters', 'AKS clusters and node pools'), T('network.list_gateways', 'Application gateways'), T('resources.list_tags', 'Owners from tags'),
      T('compute.deallocate_vm', 'Deallocate idle VMs', true), T('disks.delete', 'Delete unattached disks', true) ] },
  { id: 'gcp', cat: 'cloud', mono: 'GCP', name: 'Google Cloud', transport: 'remote · https', status: 'auth', mode: 'ask', sync: 'service account key expired',
    desc: 'Compute Engine, persistent disks, Cloud SQL and billing export.', f1: 'Project ID', v1: 'enterprise-project-384721', f2: 'Service account key',
    scope: ['enterprise-project-384721 · us-central1'],
    tools: [ T('compute.instances.list', 'Instances and machine types'), T('compute.disks.list', 'Persistent disks'), T('sqladmin.instances.list', 'Cloud SQL instances'), T('monitoring.timeseries.list', 'Utilization metrics'),
      T('billing.query_export', 'Spend from billing export'), T('recommender.list', 'Idle resource recommendations'), T('storage.buckets.list', 'Buckets and classes'),
      T('compute.instances.stop', 'Stop idle instances', true), T('compute.disks.delete', 'Delete unattached disks', true) ] },
  { id: 'vcenter', cat: 'infra', mono: 'VC', name: 'VMware vCenter', transport: 'remote · https', status: 'connected', mode: 'read', sync: 'synced 6 min ago',
    desc: 'Hosts, clusters, VMs and datastores in your primary data center.', f1: 'vCenter URL', v1: 'https://vcenter.corp.local', f2: 'Password',
    scope: ['Primary data center', 'Dev labs'],
    tools: [ T('vcenter.list_hosts', 'ESXi hosts and capacity'), T('vcenter.list_vms', 'VMs, power state and size'), T('vcenter.get_performance', 'CPU and memory over time'), T('vcenter.list_datastores', 'Datastores and free space'),
      T('vcenter.list_snapshots', 'Snapshots and their age'), T('vcenter.list_clusters', 'Clusters and DRS settings'), T('vcenter.get_power_usage', 'Host power draw'), T('vcenter.list_templates', 'VM templates') ] },
  { id: 'ssh', cat: 'infra', mono: 'SSH', name: 'Physical servers', transport: 'local · stdio', status: 'connected', mode: 'ask', sync: '',
    desc: 'SSH and RDP access to on-premises machines. Servers are managed in Settings.', f1: 'Default user', v1: 'admin', f2: 'Private key',
    scope: ['192.168.1.0/24'],
    tools: [ T('ssh.list_processes', 'Running processes and load'), T('ssh.disk_usage', 'Disk usage by path'), T('ssh.find_duplicates', 'Duplicate files by hash'), T('ssh.read_logs', 'Read system logs'),
      T('ssh.cleanup_path', 'Remove files under a path', true), T('ssh.stop_service', 'Stop an idle service', true) ] },
  { id: 'k8s', cat: 'infra', mono: 'K8S', name: 'Kubernetes', transport: 'remote · https', status: 'soon', desc: 'Requests, limits and node pool utilization across clusters.' },
  { id: 'terraform', cat: 'infra', mono: 'TF', name: 'Terraform', transport: 'local · stdio', status: 'soon', desc: 'Propose fixes as plans and pull requests instead of direct changes.' },
  { id: 'datadog', cat: 'obs', mono: 'DD', name: 'Datadog', transport: 'remote · https', status: 'soon', desc: 'Utilization and APM data to confirm a resource is really idle.' },
  { id: 'prometheus', cat: 'obs', mono: 'PR', name: 'Prometheus', transport: 'remote · https', status: 'soon', desc: 'Query metrics with PromQL for on-premises workloads.' },
  { id: 'slack', cat: 'collab', mono: 'SL', name: 'Slack', transport: 'remote · https', status: 'soon', desc: 'Send findings to owners and collect approvals in a channel.' },
  { id: 'jira', cat: 'collab', mono: 'JI', name: 'Jira', transport: 'remote · https', status: 'soon', desc: 'Open tickets for changes that need another team.' },
  { id: 'github', cat: 'collab', mono: 'GH', name: 'GitHub', transport: 'remote · https', status: 'soon', desc: 'Open pull requests against your infrastructure-as-code repos.' },
];

export const CATEGORIES: { key: 'all' | IntegrationCategory; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'cloud', label: 'Cloud' }, { key: 'infra', label: 'Infrastructure' },
  { key: 'obs', label: 'Observability' }, { key: 'collab', label: 'Collaboration' }, { key: 'custom', label: 'Custom' },
];

export const MODES: { key: PermissionMode; label: string; help: string }[] = [
  { key: 'read', label: 'Read-only', help: 'Agents can look but never change anything.' },
  { key: 'ask', label: 'Ask before writes', help: 'Every write tool call waits for a person to approve it.' },
  { key: 'auto', label: 'Auto-approve low-risk writes', help: 'Quick wins under $1,000/mo run on their own; the rest still ask.' },
];
export const MODE_LABEL: Record<PermissionMode, string> = { read: 'Read-only', ask: 'Ask before writes', auto: 'Auto-approve low-risk' };

export const TOOL_LOG: Record<string, { t: string; agent: string; tool: string; res: string }[]> = {
  aws: [
    { t: '19:47:12', agent: 'martian-3', tool: 'ce.get_cost_and_usage', res: 'ok · 412ms' },
    { t: '19:47:09', agent: 'martian-3', tool: 'ec2.describe_volumes', res: 'ok · 280ms' },
    { t: '19:46:58', agent: 'martian-2', tool: 'ec2.describe_instances', res: 'ok · 1.2s' },
    { t: '19:33:40', agent: 'martian-1', tool: 'iam.simulate_principal_policy', res: 'ok · read-only' },
  ],
  other: [
    { t: '19:41:05', agent: 'martian-2', tool: 'inventory scan', res: 'ok · 2.4s' },
    { t: '19:33:40', agent: 'martian-1', tool: 'access check', res: 'ok · read-only' },
  ],
};

export const DISCOVERED_TOOLS: Tool[] = [
  T('lookup_service', 'Find a service by name'), T('get_owner', 'Owner and team for a resource'), T('get_cost_center', 'Cost center for a resource'),
];
