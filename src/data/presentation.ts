// Front-end-only presentation details for the redesign.
// These never change app behavior; they decorate existing mock data.

export type FindingDetail = { scope: string; count: string; steps: string[] };

/** Extra copy for each optimization id in mockData.optimizations. */
export const FINDING_DETAILS: Record<string, FindingDetail> = {
  'unused-ec2': {
    scope: 'AWS · us-east-1', count: '47 VMs',
    steps: ['Confirm owners from resource tags and notify them', 'Snapshot attached volumes', 'Stop the 47 instances (reversible)', 'Report realized savings after 24 hours'],
  },
  'rightsize-rds': {
    scope: 'AWS · us-east-1', count: '12 DBs',
    steps: ['Pick a smaller instance class from 30 days of load', 'Schedule changes in each maintenance window', 'Resize and watch latency for 1 hour'],
  },
  'network-costs': {
    scope: 'AWS · multi-region', count: 'NAT + transfer',
    steps: ['Route same-region traffic through VPC endpoints', 'Consolidate idle NAT gateways', 'Compare transfer costs after 7 days'],
  },
  'unused-ebs': {
    scope: 'AWS · us-east-1', count: '23 volumes',
    steps: ['Take a final snapshot of each volume', 'Delete the 23 unattached volumes', 'Remove orphaned snapshots older than 90 days'],
  },
};

export const AGENT_ACTIVITY = [
  { agent: 'Martian 3', text: 'found 23 unattached EBS volumes and orphaned snapshots', when: '2 min ago', where: 'AWS', fresh: true },
  { agent: 'Martian 2', text: 'mapped 312 VMs across 45 physical servers in vCenter', when: '6 min ago', where: 'VMware' },
  { agent: 'Martian 3', text: 'flagged 12 RDS instances under 15% capacity', when: '9 min ago', where: 'AWS' },
  { agent: 'Martian 1', text: 'verified read-only access to AWS, Azure and vCenter', when: '14 min ago', where: 'Access' },
  { agent: 'Martian 4', text: 'started 24/7 monitoring for new idle resources', when: '15 min ago', where: 'All' },
];

/** Infrastructure topology, lifted from the old InfrastructureMapView markup (values identical). */
export type EnvKey = 'cloud' | 'dc' | 'labs' | 'edge';
export const INFRA_SUMMARY = [
  { value: '847', label: 'Virtual machines' },
  { value: '156', label: 'Physical servers' },
  { value: '25', label: 'Cloud accounts' },
  { value: '$158K', label: 'Monthly cost', accent: true },
  { value: '12', label: 'Lab environments' },
  { value: '98.7%', label: 'Uptime SLA' },
];
export const INFRA_GROUPS: { key: EnvKey; name: string; where: string; cost: string; systems: { name: string; a: string; b: string; util: number }[] }[] = [
  { key: 'cloud', name: 'Cloud infrastructure', where: 'AWS · Azure · Google Cloud', cost: '$45K', systems: [
    { name: 'AWS Production', a: 'Web servers · 15× t3.large', b: 'RDS PostgreSQL · Multi-AZ', util: 67 },
    { name: 'Azure Production', a: 'App VMs · 8× D4s_v3', b: 'AKS cluster · 12 nodes', util: 78 },
    { name: 'Google Cloud', a: 'Compute VMs · 6× n2-standard-4', b: 'us-central1', util: 34 } ] },
  { key: 'dc', name: 'Primary data center', where: 'VMware · Dell · HPE · NetApp', cost: '$78K', systems: [
    { name: 'Rack 1 · Production', a: 'Dell R750 · 128 GB RAM', b: 'VMware · 24 VMs', util: 89 },
    { name: 'Database cluster', a: 'HPE DL380 · 256 GB RAM', b: 'Oracle RAC · HA cluster', util: 67 },
    { name: 'Storage', a: 'NetApp FAS8300', b: '50 TB', util: 72 } ] },
  { key: 'labs', name: 'Development labs', where: 'AI/ML · DevOps · Security', cost: '$23K', systems: [
    { name: 'AI/ML research', a: 'NVIDIA DGX · 8× A100', b: 'Jupyter VMs · 15 active', util: 92 },
    { name: 'DevOps testing', a: 'Kubernetes · 6 nodes', b: 'Jenkins · 8 agents', util: 45 },
    { name: 'Security and QA', a: 'Pen-test VMs · 12 isolated', b: 'QA suites · 20 VMs', util: 56 } ] },
  { key: 'edge', name: 'Edge and remote sites', where: 'Branch · IoT · CDN · VDI', cost: '$12K', systems: [
    { name: 'Branch office NYC', a: 'Micro DC · NUC cluster', b: 'Local apps · 6 VMs', util: 78 },
    { name: 'IoT and CDN', a: 'IoT gateways · 25 devices', b: 'CDN nodes · 12 locations', util: 67 },
    { name: 'Remote work', a: 'VDI · 150 desktops', b: 'DR storage · 100 TB', util: 82 } ] },
];

/** Steps shown in the Ask Martian run panel. */
export const RUN_STEPS = [
  { title: 'Understood request', detail: 'cost analysis · all environments', t: '0.4s' },
  { title: 'Queried AWS', detail: '123456789012 · us-east-1', t: '3.1s' },
  { title: 'Queried Azure', detail: 'East US subscription', t: '2.4s' },
  { title: 'Queried Google Cloud', detail: 'enterprise-project-384721', t: '2.2s' },
  { title: 'Analyzed vCenter', detail: '45 servers · 312 VMs', t: '1.8s' },
  { title: 'Calculated savings and ROI', detail: '4 categories', t: '0.6s' },
];
