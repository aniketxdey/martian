/**
 * Five complete demo companies. Each has its own enabled integrations, infrastructure
 * map (clusters → services, with dependencies) and waste hints. Findings, agent
 * sessions and traces are generated from these maps (see world.ts and sessions.ts),
 * and the seed randomizes every number on top.
 */
import type { Env, ServiceType } from '../state/types';
import type { PermissionMode } from '../data/modes';

export type WasteHint =
  | 'idle' | 'oversized' | 'dup' | 'unattached' | 'snapshots' | 'nat' | 'requests'
  | 'suspend' | 'consolidate' | 'gpu-idle' | 'dr' | 'forecast' | 'cold' | 'egress';

export type ServiceSpec = {
  id: string;
  name: string;
  type: ServiceType;
  /** Integration that sees it, when different from the cluster's. */
  integration?: string;
  count: [number, number];
  unit: string;
  /** Monthly cost per unit, USD. */
  unitCost: [number, number];
  /** Baseline CPU / utilization %, null when not meaningful. */
  cpu: [number, number] | null;
  deps?: string[];
  waste?: WasteHint[];
  tags?: string[];
};

export type ClusterSpec = {
  id: string;
  name: string;
  integration: string;
  env: Env;
  location: string;
  services: ServiceSpec[];
};

export type IntegrationSpec = { id: string; status?: 'connected' | 'auth' | 'error'; mode?: PermissionMode; scope: string[] };

export type Variant = {
  key: string;
  org: { name: string; short: string; industry: string; hq: string; domain: string };
  admin: { name: string; email: string };
  integrations: IntegrationSpec[];
  clusters: ClusterSpec[];
  servers: { name: string; ip: string; os: string; description: string; user: string }[];
};

const S = (id: string, name: string, type: ServiceType, count: [number, number], unit: string, unitCost: [number, number], cpu: [number, number] | null, rest: Partial<ServiceSpec> = {}): ServiceSpec =>
  ({ id, name, type, count, unit, unitCost, cpu, ...rest });

export const VARIANTS: Variant[] = [
  /* 1 ─────────────────────────────────────────────────────────────── */
  {
    key: 'northwind',
    org: { name: 'Northwind Commerce', short: 'Northwind', industry: 'Retail & e-commerce', hq: 'Seattle, WA', domain: 'northwind.co' },
    admin: { name: 'Priya Raman', email: 'priya.raman@northwind.co' },
    integrations: [
      { id: 'aws', mode: 'ask', scope: ['412983007231 · us-east-1', '412983007231 · us-west-2', '771206548812 · us-west-2'] },
      { id: 'kubernetes', mode: 'ask', scope: ['eks/storefront-prod', 'eks/platform-dev'] },
      { id: 'datadog', mode: 'read', scope: ['datadoghq.com · org northwind'] },
      { id: 'snowflake', mode: 'ask', scope: ['NORTHWIND.us-west-2.aws'] },
      { id: 'terraform', mode: 'read', scope: ['northwind/infra-live'] },
      { id: 'github', mode: 'ask', scope: ['northwind-co/infra-live', 'northwind-co/k8s-manifests'] },
      { id: 'pagerduty', mode: 'read', scope: ['Storefront', 'Fulfillment'] },
      { id: 'slack', mode: 'ask', scope: ['#cloud-costs', '#platform-oncall'] },
      { id: 'ssh', mode: 'ask', scope: ['10.40.0.0/16 · Reno DC'] },
      { id: 'gcp', status: 'auth', mode: 'read', scope: ['northwind-ml-sandbox'] },
    ],
    clusters: [
      {
        id: 'aws-prod', name: 'AWS prod', integration: 'aws', env: 'cloud', location: 'us-east-1',
        services: [
          S('storefront-web', 'Storefront web fleet', 'vm-fleet', [56, 72], 'instances', [118, 164], [38, 52], { deps: ['checkout', 'media-s3', 'sessions'], waste: ['forecast'], tags: ['asg', 'm6i.xlarge'] }),
          S('orders-db', 'Orders Aurora cluster', 'database', [5, 7], 'instances', [980, 1420], [11, 17], { deps: ['analytics-wh'], waste: ['oversized'], tags: ['db.r6g.4xlarge'] }),
          S('sessions', 'Session cache', 'cache', [6, 6], 'nodes', [210, 260], [22, 31], { tags: ['cache.r6g.large'] }),
          S('media-s3', 'Product media', 'object-store', [180, 240], 'TB', [21, 23], null, { waste: ['cold'], tags: ['S3 Standard'] }),
          S('nat-prod', 'NAT gateways', 'network', [6, 8], 'gateways', [36, 44], [2, 6], { waste: ['nat', 'egress'] }),
        ],
      },
      {
        id: 'eks-storefront', name: 'EKS storefront-prod', integration: 'kubernetes', env: 'cloud', location: 'us-east-1',
        services: [
          S('checkout', 'Checkout service', 'k8s', [36, 48], 'pods', [62, 80], [24, 34], { deps: ['orders-db', 'sessions', 'payments-gw'], waste: ['requests'], tags: ['ns/checkout'] }),
          S('catalog', 'Catalog API', 'k8s', [24, 32], 'pods', [48, 66], [18, 26], { deps: ['orders-db', 'search'], waste: ['requests'], tags: ['ns/catalog'] }),
          S('search', 'Search (OpenSearch)', 'analytics', [6, 9], 'nodes', [520, 690], [41, 55], { integration: 'aws', tags: ['r6g.2xlarge.search'] }),
          S('payments-gw', 'Payments gateway', 'k8s', [8, 12], 'pods', [70, 90], [46, 58], { tags: ['ns/payments'] }),
        ],
      },
      {
        id: 'aws-dev', name: 'AWS dev & CI', integration: 'aws', env: 'labs', location: 'us-west-2',
        services: [
          S('dev-fleet', 'Developer environments', 'vm-fleet', [140, 180], 'instances', [72, 96], [2, 4], { waste: ['idle'], tags: ['t3.large', 'env=dev'] }),
          S('ci-runners', 'CI runners', 'vm-fleet', [40, 56], 'instances', [88, 120], [9, 16], { waste: ['forecast'], tags: ['c6i.2xlarge'] }),
          S('dev-db', 'Dev RDS instances', 'database', [14, 22], 'instances', [210, 340], [1, 4], { waste: ['idle'] }),
          S('dev-ebs', 'EBS volumes', 'storage', [90, 130], 'volumes', [12, 22], null, { waste: ['unattached', 'snapshots'] }),
        ],
      },
      {
        id: 'snowflake', name: 'Snowflake analytics', integration: 'snowflake', env: 'saas', location: 'us-west-2',
        services: [
          S('analytics-wh', 'BI and load warehouses', 'warehouse', [6, 8], 'warehouses', [1400, 2600], [12, 24], { waste: ['suspend'], tags: ['LOAD_WH', 'BI_WH', 'DS_WH'] }),
          S('raw-tables', 'Raw event tables', 'storage', [60, 90], 'TB', [23, 23], null, { waste: ['cold'] }),
        ],
      },
      {
        id: 'reno-dc', name: 'Reno fulfillment DC', integration: 'ssh', env: 'dc', location: 'Reno, NV',
        services: [
          S('wms', 'Warehouse management servers', 'host-cluster', [14, 18], 'servers', [420, 610], [9, 15], { deps: ['orders-db'], waste: ['consolidate'], tags: ['Dell R650'] }),
          S('label-shares', 'Label and invoice shares', 'storage', [38, 52], 'TB', [42, 58], null, { waste: ['dup'], tags: ['NFS'] }),
        ],
      },
      {
        id: 'stores', name: 'Store edge', integration: 'aws', env: 'edge', location: '214 stores',
        services: [
          S('pos-gw', 'POS gateways', 'vm-fleet', [214, 214], 'gateways', [38, 46], [14, 22], { deps: ['checkout'], tags: ['Outposts servers'] }),
        ],
      },
    ],
    servers: [
      { name: 'reno-wms-01', ip: '10.40.12.21', os: 'Ubuntu 22.04 LTS', description: 'WMS primary', user: 'martian' },
      { name: 'reno-wms-07', ip: '10.40.12.27', os: 'Ubuntu 22.04 LTS', description: 'WMS batch jobs', user: 'martian' },
      { name: 'reno-files-02', ip: '10.40.20.12', os: 'RHEL 9.4', description: 'Label and invoice shares', user: 'martian' },
    ],
  },

  /* 2 ─────────────────────────────────────────────────────────────── */
  {
    key: 'helix',
    org: { name: 'Helix Biosciences', short: 'Helix', industry: 'Biotech research', hq: 'Cambridge, MA', domain: 'helixbio.com' },
    admin: { name: 'Daniel Okafor', email: 'd.okafor@helixbio.com' },
    integrations: [
      { id: 'vmware', mode: 'ask', scope: ['vcsa-bos01.helix.local', 'vcsa-wal01.helix.local'] },
      { id: 'netapp', mode: 'ask', scope: ['aff-a400-bos (3 nodes)'] },
      { id: 'ssh', mode: 'ask', scope: ['10.12.0.0/16 · HPC'] },
      { id: 'azure', mode: 'ask', scope: ['research-prod', 'research-dev'] },
      { id: 'databricks', mode: 'ask', scope: ['helix-lakehouse (Azure)'] },
      { id: 'prometheus', mode: 'read', scope: ['prom.hpc.helix.local'] },
      { id: 'grafana', mode: 'read', scope: ['grafana.helix.local'] },
      { id: 'jira', mode: 'ask', scope: ['RESIT', 'HPC'] },
      { id: 'slack', mode: 'ask', scope: ['#research-it'] },
      { id: 'aws', status: 'auth', mode: 'read', scope: ['helix-collab (pending role)'] },
    ],
    clusters: [
      {
        id: 'bos-dc', name: 'Boston primary DC', integration: 'vmware', env: 'dc', location: 'Boston, MA',
        services: [
          S('esxi-bos', 'ESXi hosts', 'host-cluster', [32, 40], 'hosts', [690, 840], [14, 22], { waste: ['consolidate'], tags: ['vSAN', 'PowerEdge R750'] }),
          S('lims', 'LIMS application VMs', 'vm-fleet', [22, 30], 'VMs', [160, 220], [28, 41], { deps: ['lims-db', 'seq-raw'] }),
          S('lims-db', 'LIMS Oracle database', 'database', [2, 2], 'instances', [3100, 3900], [36, 48], { tags: ['Oracle 19c RAC'] }),
          S('research-vms', 'Researcher workstations', 'vm-fleet', [110, 150], 'VMs', [95, 140], [2, 5], { waste: ['idle'] }),
        ],
      },
      {
        id: 'hpc', name: 'HPC genomics cluster', integration: 'ssh', env: 'labs', location: 'Boston, MA',
        services: [
          S('gpu-nodes', 'GPU nodes (A100)', 'gpu', [20, 28], 'nodes', [2600, 3400], [21, 38], { deps: ['scratch', 'seq-raw'], waste: ['gpu-idle', 'forecast'], tags: ['Slurm partition gpu'] }),
          S('cpu-nodes', 'CPU compute nodes', 'host-cluster', [64, 88], 'nodes', [310, 420], [44, 62], { deps: ['scratch'] }),
          S('scratch', 'Parallel scratch (Lustre)', 'storage', [700, 900], 'TB', [18, 26], null, { waste: ['cold'] }),
        ],
      },
      {
        id: 'netapp-bos', name: 'NetApp AFF arrays', integration: 'netapp', env: 'dc', location: 'Boston, MA',
        services: [
          S('seq-raw', 'Sequencer raw data', 'storage', [1100, 1500], 'TB', [14, 19], null, { deps: ['lakehouse'], waste: ['dup', 'snapshots'] }),
          S('home-shares', 'Home and lab shares', 'storage', [180, 240], 'TB', [16, 22], null, { waste: ['dup'] }),
        ],
      },
      {
        id: 'azure-research', name: 'Azure research-prod', integration: 'azure', env: 'cloud', location: 'East US',
        services: [
          S('eln', 'Electronic lab notebook', 'vm-fleet', [8, 12], 'VMs', [240, 330], [18, 27], { deps: ['eln-sql'] }),
          S('eln-sql', 'Azure SQL (ELN)', 'database', [3, 4], 'databases', [1200, 1800], [8, 14], { waste: ['oversized'] }),
          S('research-blob', 'Research blob storage', 'object-store', [300, 420], 'TB', [18, 21], null, { waste: ['cold'] }),
          S('dev-disks', 'Managed disks (dev)', 'storage', [60, 90], 'disks', [22, 40], null, { waste: ['unattached'] }),
        ],
      },
      {
        id: 'lakehouse', name: 'Databricks lakehouse', integration: 'databricks', env: 'saas', location: 'Azure East US',
        services: [
          S('lakehouse', 'All-purpose clusters', 'analytics', [12, 18], 'clusters', [900, 1600], [6, 14], { waste: ['suspend'] }),
          S('dbx-jobs', 'Variant-calling jobs', 'analytics', [40, 60], 'jobs/day', [60, 90], [55, 70], { waste: ['forecast'] }),
        ],
      },
      {
        id: 'wal-labs', name: 'Waltham dev labs', integration: 'vmware', env: 'labs', location: 'Waltham, MA',
        services: [
          S('sandbox', 'Sandbox VMs', 'vm-fleet', [70, 96], 'VMs', [80, 120], [1, 3], { waste: ['idle', 'snapshots'] }),
        ],
      },
    ],
    servers: [
      { name: 'hpc-head-01', ip: '10.12.0.10', os: 'Rocky Linux 9.4', description: 'Slurm controller', user: 'svc-martian' },
      { name: 'hpc-gpu-14', ip: '10.12.4.14', os: 'Rocky Linux 9.4', description: 'A100 node', user: 'svc-martian' },
      { name: 'lab-nas-gw', ip: '10.12.8.2', os: 'Ubuntu 22.04 LTS', description: 'NFS gateway for lab shares', user: 'svc-martian' },
    ],
  },

  /* 3 ─────────────────────────────────────────────────────────────── */
  {
    key: 'atlas',
    org: { name: 'Atlas Financial Group', short: 'Atlas', industry: 'Banking & payments', hq: 'Charlotte, NC', domain: 'atlasfg.com' },
    admin: { name: 'Marcus Bell', email: 'marcus.bell@atlasfg.com' },
    integrations: [
      { id: 'azure', mode: 'ask', scope: ['core-banking-prod', 'core-banking-dr', 'digital-dev'] },
      { id: 'vmware', mode: 'ask', scope: ['vcenter-clt.atlasfg.net'] },
      { id: 'nutanix', mode: 'read', scope: ['Prism Central · 48 branch clusters'] },
      { id: 'oracle', mode: 'read', scope: ['atlas-exadata (us-ashburn-1)'] },
      { id: 'splunk', mode: 'read', scope: ['atlas.splunkcloud.com'] },
      { id: 'dynatrace', mode: 'read', scope: ['atlas.live.dynatrace.com'] },
      { id: 'ansible', mode: 'ask', scope: ['aap.atlasfg.net'] },
      { id: 'jira', mode: 'ask', scope: ['CLOUDOPS', 'CHG'] },
      { id: 'pagerduty', mode: 'read', scope: ['Payments', 'Core banking'] },
      { id: 'ssh', mode: 'read', scope: ['172.20.0.0/16 · Charlotte DC'] },
    ],
    clusters: [
      {
        id: 'az-prod', name: 'Azure core-banking-prod', integration: 'azure', env: 'cloud', location: 'East US 2',
        services: [
          S('api-gw', 'API gateway VMs', 'vm-fleet', [18, 24], 'VMs', [310, 380], [31, 44], { deps: ['payments', 'sqlmi'], waste: ['forecast'] }),
          S('payments', 'Payments (AKS)', 'k8s', [60, 84], 'pods', [70, 95], [26, 38], { deps: ['sqlmi', 'exadata', 'bus'], waste: ['requests'] }),
          S('sqlmi', 'SQL Managed Instance', 'database', [4, 6], 'instances', [2800, 3600], [17, 26], { deps: ['dr-sql'], waste: ['oversized'] }),
          S('bus', 'Service Bus premium', 'queue', [4, 4], 'messaging units', [670, 690], [12, 20]),
        ],
      },
      {
        id: 'az-dr', name: 'Azure core-banking-dr', integration: 'azure', env: 'cloud', location: 'Central US',
        services: [
          S('dr-vms', 'Warm standby VMs', 'vm-fleet', [40, 52], 'VMs', [290, 360], [1, 3], { waste: ['dr'] }),
          S('dr-sql', 'Geo-replicas', 'database', [4, 6], 'instances', [2400, 3100], [3, 6], { waste: ['dr'] }),
        ],
      },
      {
        id: 'clt-dc', name: 'Charlotte Tier III DC', integration: 'vmware', env: 'dc', location: 'Charlotte, NC',
        services: [
          S('esxi-clt', 'ESXi hosts', 'host-cluster', [44, 56], 'hosts', [720, 880], [18, 27], { waste: ['consolidate'] }),
          S('sql-farm', 'SQL Server farm', 'database', [24, 30], 'VMs', [610, 820], [9, 16], { waste: ['oversized'] }),
          S('batch', 'Overnight batch VMs', 'vm-fleet', [60, 80], 'VMs', [150, 210], [6, 12], { deps: ['sql-farm', 'exadata'], waste: ['forecast', 'idle'] }),
          S('clt-shares', 'Statement archives', 'storage', [220, 300], 'TB', [24, 30], null, { waste: ['dup', 'cold'] }),
        ],
      },
      {
        id: 'branches', name: 'Branch clusters', integration: 'nutanix', env: 'edge', location: '48 branches',
        services: [
          S('vdi', 'Teller VDI', 'vm-fleet', [1100, 1300], 'desktops', [28, 36], [7, 13], { deps: ['api-gw'], waste: ['idle'] }),
          S('branch-files', 'Branch file servers', 'storage', [90, 120], 'TB', [30, 38], null, { waste: ['dup'] }),
        ],
      },
      {
        id: 'oci', name: 'OCI Exadata', integration: 'oracle', env: 'cloud', location: 'us-ashburn-1',
        services: [
          S('exadata', 'Exadata Cloud Service', 'database', [2, 2], 'racks', [19000, 23000], [34, 46], { waste: ['oversized'] }),
          S('oci-backup', 'Object storage backups', 'object-store', [400, 560], 'TB', [24, 26], null, { waste: ['snapshots'] }),
        ],
      },
      {
        id: 'az-dev', name: 'Azure digital-dev', integration: 'azure', env: 'labs', location: 'East US',
        services: [
          S('dev-vms', 'Dev and test VMs', 'vm-fleet', [90, 130], 'VMs', [110, 170], [2, 5], { waste: ['idle'] }),
          S('dev-disks', 'Managed disks', 'storage', [140, 190], 'disks', [18, 34], null, { waste: ['unattached', 'snapshots'] }),
        ],
      },
    ],
    servers: [
      { name: 'clt-batch-ctl01', ip: '172.20.14.11', os: 'RHEL 8.10', description: 'Batch scheduler (Control-M)', user: 'svc_martian' },
      { name: 'clt-archive-03', ip: '172.20.30.13', os: 'Windows Server 2022', description: 'Statement archive share', user: 'svc_martian' },
    ],
  },

  /* 4 ─────────────────────────────────────────────────────────────── */
  {
    key: 'lumen',
    org: { name: 'Lumen Media', short: 'Lumen', industry: 'Streaming media', hq: 'Los Angeles, CA', domain: 'lumen.tv' },
    admin: { name: 'Sofia Alvarez', email: 'sofia@lumen.tv' },
    integrations: [
      { id: 'gcp', mode: 'ask', scope: ['lumen-prod', 'lumen-eu', 'lumen-staging'] },
      { id: 'kubernetes', mode: 'ask', scope: ['gke/prod-us', 'gke/transcode', 'gke/prod-eu'] },
      { id: 'aws', mode: 'ask', scope: ['508812774021 · us-east-1 (archive)'] },
      { id: 'prometheus', mode: 'read', scope: ['prometheus.prod-us', 'prometheus.transcode'] },
      { id: 'grafana', mode: 'read', scope: ['lumen.grafana.net'] },
      { id: 'newrelic', mode: 'read', scope: ['Lumen (US)'] },
      { id: 'gitlab', mode: 'ask', scope: ['platform/infra', 'platform/helm-charts'] },
      { id: 'databricks', mode: 'ask', scope: ['lumen-analytics (GCP)'] },
      { id: 'slack', mode: 'ask', scope: ['#finops', '#sre'] },
    ],
    clusters: [
      {
        id: 'gke-prod', name: 'GKE prod-us', integration: 'kubernetes', env: 'cloud', location: 'us-central1',
        services: [
          S('playback-api', 'Playback API', 'k8s', [80, 110], 'pods', [44, 58], [33, 47], { deps: ['catalog-sql', 'memstore', 'media-gcs'], waste: ['forecast', 'requests'] }),
          S('recs', 'Recommendations', 'k8s', [40, 56], 'pods', [70, 92], [11, 19], { deps: ['feature-store'], waste: ['requests'] }),
          S('memstore', 'Memorystore Redis', 'cache', [8, 10], 'nodes', [260, 320], [36, 49], { integration: 'gcp' }),
        ],
      },
      {
        id: 'gke-transcode', name: 'GKE transcode', integration: 'kubernetes', env: 'cloud', location: 'us-central1',
        services: [
          S('gpu-pool', 'GPU encoders (L4)', 'gpu', [24, 36], 'nodes', [520, 690], [18, 36], { deps: ['media-gcs'], waste: ['gpu-idle', 'forecast'] }),
          S('cpu-encoders', 'CPU encoder workers', 'k8s', [120, 160], 'pods', [36, 50], [52, 68]),
        ],
      },
      {
        id: 'gcp-prod', name: 'GCP lumen-prod', integration: 'gcp', env: 'cloud', location: 'us-central1',
        services: [
          S('catalog-sql', 'Cloud SQL (catalog)', 'database', [3, 4], 'instances', [1500, 2200], [12, 19], { deps: ['analytics'], waste: ['oversized'] }),
          S('media-gcs', 'Media library (GCS)', 'object-store', [2400, 3200], 'TB', [16, 21], null, { deps: ['cdn'], waste: ['cold'] }),
          S('cdn', 'Media CDN egress', 'cdn', [900, 1300], 'TB/mo', [18, 24], null, { waste: ['egress'] }),
          S('feature-store', 'Feature store (Bigtable)', 'database', [9, 12], 'nodes', [470, 520], [21, 30]),
        ],
      },
      {
        id: 'gke-eu', name: 'GKE prod-eu', integration: 'kubernetes', env: 'cloud', location: 'europe-west1',
        services: [
          S('playback-eu', 'Playback API (EU)', 'k8s', [40, 56], 'pods', [46, 60], [19, 28], { deps: ['catalog-sql'], waste: ['requests'] }),
        ],
      },
      {
        id: 'aws-archive', name: 'AWS archive', integration: 'aws', env: 'cloud', location: 'us-east-1',
        services: [
          S('legacy-ec2', 'Legacy origin servers', 'vm-fleet', [24, 34], 'instances', [190, 260], [1, 3], { waste: ['idle'] }),
          S('glacier', 'Masters archive (S3)', 'object-store', [5200, 6400], 'TB', [3, 5], null, { waste: ['snapshots'] }),
          S('archive-ebs', 'EBS volumes', 'storage', [70, 110], 'volumes', [24, 44], null, { waste: ['unattached'] }),
        ],
      },
      {
        id: 'analytics', name: 'Databricks analytics', integration: 'databricks', env: 'saas', location: 'GCP us-central1',
        services: [
          S('analytics', 'Viewing analytics clusters', 'analytics', [10, 14], 'clusters', [1100, 1700], [8, 15], { waste: ['suspend'] }),
        ],
      },
    ],
    servers: [
      { name: 'ingest-01.la', ip: '10.8.1.21', os: 'Ubuntu 24.04 LTS', description: 'Studio ingest server', user: 'martian' },
      { name: 'ingest-02.la', ip: '10.8.1.22', os: 'Ubuntu 24.04 LTS', description: 'Studio ingest server', user: 'martian' },
    ],
  },

  /* 5 ─────────────────────────────────────────────────────────────── */
  {
    key: 'vertex',
    org: { name: 'Vertex Manufacturing', short: 'Vertex', industry: 'Industrial manufacturing', hq: 'Detroit, MI', domain: 'vertexmfg.com' },
    admin: { name: 'Elena Kowalski', email: 'ekowalski@vertexmfg.com' },
    integrations: [
      { id: 'vmware', mode: 'ask', scope: ['vc-det-01.vertex.corp'] },
      { id: 'aws', mode: 'ask', scope: ['301477265190 · us-east-2', '301477265190 · eu-central-1', '913552047711 · us-east-2 (sandbox)'] },
      { id: 'proxmox', mode: 'ask', scope: ['9 plant clusters'] },
      { id: 'openshift', mode: 'ask', scope: ['ocp-mfg-apps'] },
      { id: 'ssh', mode: 'ask', scope: ['10.60.0.0/14 · plants and DC'] },
      { id: 'datadog', mode: 'read', scope: ['datadoghq.eu · org vertex'] },
      { id: 'terraform', mode: 'read', scope: ['vertex/platform', 'vertex/plants'] },
      { id: 'gitlab', mode: 'ask', scope: ['it/infrastructure'] },
      { id: 'jira', mode: 'ask', scope: ['ITOPS', 'PLANTIT'] },
      { id: 'slack', mode: 'ask', scope: ['#it-infra'] },
    ],
    clusters: [
      {
        id: 'det-dc', name: 'Detroit DC', integration: 'vmware', env: 'dc', location: 'Detroit, MI',
        services: [
          S('sap-hana', 'SAP S/4HANA database', 'database', [2, 3], 'nodes', [7800, 9600], [38, 52], { tags: ['6 TB RAM'] }),
          S('sap-app', 'SAP application servers', 'vm-fleet', [14, 18], 'VMs', [420, 560], [21, 33], { deps: ['sap-hana'], waste: ['forecast'] }),
          S('esxi-det', 'ESXi hosts', 'host-cluster', [26, 34], 'hosts', [700, 860], [16, 24], { waste: ['consolidate'] }),
          S('cad-shares', 'CAD and PLM shares', 'storage', [320, 420], 'TB', [26, 32], null, { waste: ['dup', 'cold'] }),
        ],
      },
      {
        id: 'plants', name: 'Plant edge', integration: 'proxmox', env: 'edge', location: '9 plants',
        services: [
          S('mes', 'MES servers', 'vm-fleet', [54, 72], 'VMs', [90, 130], [17, 29], { deps: ['sap-app', 'iot-ingest'] }),
          S('historian', 'SCADA historians', 'database', [9, 9], 'instances', [380, 470], [8, 14], { deps: ['iot-ingest'], waste: ['oversized'] }),
          S('plant-idle', 'Retired line controllers', 'vm-fleet', [30, 46], 'VMs', [60, 90], [0, 2], { waste: ['idle', 'snapshots'] }),
        ],
      },
      {
        id: 'ocp', name: 'OpenShift mfg-apps', integration: 'openshift', env: 'dc', location: 'Detroit, MI',
        services: [
          S('quality-ai', 'Visual quality inspection', 'gpu', [8, 12], 'GPU nodes', [1900, 2500], [24, 41], { deps: ['data-lake'], waste: ['gpu-idle'] }),
          S('mes-api', 'MES APIs', 'k8s', [40, 60], 'pods', [40, 55], [14, 22], { deps: ['sap-app'], waste: ['requests'] }),
        ],
      },
      {
        id: 'aws-prod', name: 'AWS vertex-prod', integration: 'aws', env: 'cloud', location: 'us-east-2',
        services: [
          S('iot-ingest', 'IoT ingest (Kinesis + Lambda)', 'queue', [24, 32], 'shards', [80, 110], [31, 45], { deps: ['data-lake'], waste: ['forecast'] }),
          S('data-lake', 'Sensor data lake (S3)', 'object-store', [900, 1200], 'TB', [21, 23], null, { deps: ['emr'], waste: ['cold'] }),
          S('emr', 'EMR analytics', 'analytics', [20, 30], 'nodes', [310, 420], [9, 17], { waste: ['suspend'] }),
          S('nat-mfg', 'NAT gateways', 'network', [4, 6], 'gateways', [36, 44], [3, 8], { waste: ['nat'] }),
        ],
      },
      {
        id: 'aws-sandbox', name: 'AWS sandbox', integration: 'aws', env: 'labs', location: 'us-east-2',
        services: [
          S('sandbox-ec2', 'Engineering sandbox', 'vm-fleet', [60, 90], 'instances', [80, 140], [1, 4], { waste: ['idle'] }),
          S('sandbox-ebs', 'EBS volumes and snapshots', 'storage', [110, 160], 'volumes', [10, 26], null, { waste: ['unattached', 'snapshots'] }),
        ],
      },
    ],
    servers: [
      { name: 'det-plm-fs01', ip: '10.60.4.21', os: 'Windows Server 2019', description: 'PLM file server', user: 'svc-martian' },
      { name: 'plant3-mes-02', ip: '10.62.3.12', os: 'Ubuntu 20.04 LTS', description: 'Plant 3 MES', user: 'svc-martian' },
      { name: 'plant7-hist-01', ip: '10.62.7.31', os: 'Windows Server 2016', description: 'Plant 7 historian', user: 'svc-martian' },
    ],
  },
];
