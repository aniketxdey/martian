/**
 * Integration catalog shared by demo and live modes: brand, logo, the company's own
 * tagline (taken from its website), category and the MCP tools Martian exposes.
 *
 * Logos: public/logos/*.svg, from the CC0 "SVG Logos" collection (gilbarbara/logos via
 * @iconify-json/logos) and Simple Icons (CC0) for NetApp, Nutanix and Proxmox. Brand
 * marks belong to their owners and are shown only to identify the integration.
 */

export type CatalogCategory = 'cloud' | 'infra' | 'obs' | 'devops' | 'data' | 'collab' | 'custom';

export type CatalogTool = { name: string; desc: string; write?: boolean };

export type CatalogEntry = {
  id: string;
  name: string;
  short: string;
  cat: CatalogCategory;
  /** Path under /public, or null for Martian's own glyph. */
  logo: string | null;
  tagline: string;
  /** What Martian does with it (shown in the configure drawer). */
  desc: string;
  /** Backend integration kind when the control plane supports it natively. */
  backendKind?: 'aws' | 'azure' | 'gcp' | 'vcenter' | 'ssh' | 'custom';
  transport: string;
  tools: CatalogTool[];
};

const T = (name: string, desc: string, write = false): CatalogTool => ({ name, desc, write });

export const CATEGORIES: { key: 'all' | CatalogCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'cloud', label: 'Cloud' },
  { key: 'infra', label: 'Infrastructure' },
  { key: 'obs', label: 'Observability' },
  { key: 'devops', label: 'DevOps' },
  { key: 'data', label: 'Data' },
  { key: 'collab', label: 'Collaboration' },
  { key: 'custom', label: 'Custom' },
];

export const CATALOG: CatalogEntry[] = [
  // ---- Cloud
  {
    id: 'aws', name: 'Amazon Web Services', short: 'AWS', cat: 'cloud', logo: '/logos/aws.svg', backendKind: 'aws',
    tagline: 'Get the greatest choice of cloud and AI capabilities',
    desc: 'EC2 and RDS fleets with the volumes and load balancers around them, priced with Cost Explorer.',
    transport: 'connector · IAM role',
    tools: [
      T('aws_inventory', 'Every resource type Martian tracks, with 14-day utilization'),
      T('aws_verify_access', 'Confirm which identities Martian uses for each account'),
      T('aws_get_cpu_series', 'Hourly CPU for one resource, such as an instance or an ASG'),
      T('aws_cost_by_service', 'Unblended cost by service for the last 30 days'),
      T('aws_stop_instances', 'Stop idle instances (reversible)', true),
      T('aws_snapshot_and_delete_volumes', 'Snapshot, then delete unattached volumes', true),
      T('aws_modify_db_instance_class', 'Change an RDS instance class', true),
      T('aws_set_asg_desired_capacity', 'Set Auto Scaling desired capacity', true),
    ],
  },
  {
    id: 'azure', name: 'Microsoft Azure', short: 'Azure', cat: 'cloud', logo: '/logos/azure.svg', backendKind: 'azure',
    tagline: 'Build, run, and operate on a single integrated platform',
    desc: 'VMs and SQL databases across your subscriptions, priced with Cost Management.',
    transport: 'connector · managed identity',
    tools: [
      T('azure_inventory', 'VMs and managed disks with utilization'),
      T('azure_verify_access', 'Confirm role assignments per subscription'),
      T('azure_cost_by_resource_group', 'Spend by resource group'),
      T('azure_deallocate_vms', 'Deallocate idle VMs', true),
      T('azure_start_vms', 'Start VMs', true),
      T('azure_snapshot_and_delete_disks', 'Snapshot, then delete unattached disks', true),
    ],
  },
  {
    id: 'gcp', name: 'Google Cloud', short: 'GCP', cat: 'cloud', logo: '/logos/gcp.svg', backendKind: 'gcp',
    tagline: 'The new way to cloud',
    desc: 'Compute Engine and Cloud SQL, with utilization from Cloud Monitoring.',
    transport: 'connector · workload identity',
    tools: [
      T('gcp_inventory', 'Instances and persistent disks with utilization'),
      T('gcp_verify_access', 'Confirm the service account roles per project'),
      T('gcp_billing_export_query', 'Spend from the billing export'),
      T('gcp_stop_instances', 'Stop idle instances', true),
      T('gcp_start_instances', 'Start instances', true),
      T('gcp_snapshot_and_delete_disks', 'Snapshot, then delete unattached disks', true),
    ],
  },
  {
    id: 'oracle', name: 'Oracle Cloud Infrastructure', short: 'OCI', cat: 'cloud', logo: '/logos/oracle.svg',
    tagline: 'A Better Cloud for Every Application',
    desc: 'Compute instances, block volumes and Autonomous Database across OCI compartments.',
    transport: 'connector · API key',
    tools: [
      T('oci_inventory', 'Compute, block volumes and databases per compartment'),
      T('oci_usage_report', 'Cost and usage reports'),
      T('oci_stop_instances', 'Stop idle instances', true),
      T('oci_scale_autonomous_db', 'Scale Autonomous Database OCPUs', true),
    ],
  },
  // ---- Infrastructure
  {
    id: 'vmware', name: 'VMware vCenter', short: 'vCenter', cat: 'infra', logo: '/logos/vmware.svg', backendKind: 'vcenter',
    tagline: 'Cloud Computing for the Enterprise',
    desc: 'Every host and VM in your data centers, grouped by cluster.',
    transport: 'connector · vCenter REST',
    tools: [
      T('vcenter_inventory', 'Hosts, clusters, VMs and datastores'),
      T('vcenter_verify_access', 'Confirm the vCenter role is read-only'),
      T('vcenter_performance', 'CPU and memory over 14 days, plus ready time'),
      T('vcenter_power_off_vms', 'Power off idle VMs', true),
      T('vcenter_power_on_vms', 'Power on VMs', true),
      T('vcenter_vmotion', 'Migrate VMs to consolidate hosts', true),
    ],
  },
  {
    id: 'nutanix', name: 'Nutanix', short: 'Nutanix', cat: 'infra', logo: '/logos/nutanix.svg',
    tagline: 'One platform to run apps and data anywhere',
    desc: 'AHV clusters and their VMs, read through Prism Central.',
    transport: 'connector · Prism Central',
    tools: [
      T('nutanix_inventory', 'Clusters, hosts, VMs and storage containers'),
      T('nutanix_vm_stats', 'VM CPU, memory and IOPS'),
      T('nutanix_power_off_vms', 'Power off idle VMs', true),
    ],
  },
  {
    id: 'proxmox', name: 'Proxmox VE', short: 'Proxmox', cat: 'infra', logo: '/logos/proxmox.svg',
    tagline: 'Simplify your data center',
    desc: 'KVM guests and LXC containers on every Proxmox VE node.',
    transport: 'connector · API token',
    tools: [
      T('proxmox_inventory', 'Nodes, VMs and containers'),
      T('proxmox_rrd_stats', 'Guest CPU and memory history'),
      T('proxmox_shutdown_guests', 'Shut down idle guests', true),
    ],
  },
  {
    id: 'kubernetes', name: 'Kubernetes', short: 'Kubernetes', cat: 'infra', logo: '/logos/kubernetes.svg',
    tagline: 'Production-Grade Container Orchestration',
    desc: 'Pod requests against real usage, and how full each node pool is.',
    transport: 'connector · in-cluster',
    tools: [
      T('k8s_inventory', 'Clusters, node pools, namespaces and workloads'),
      T('k8s_requests_vs_usage', 'Requested versus used CPU and memory per workload'),
      T('k8s_rightsize_requests', 'Patch requests and limits', true),
      T('k8s_scale_node_pool', 'Resize a node pool', true),
    ],
  },
  {
    id: 'openshift', name: 'Red Hat OpenShift', short: 'OpenShift', cat: 'infra', logo: '/logos/openshift.svg',
    tagline: 'One platform, infinite flexibility',
    desc: 'Projects and machine sets on OpenShift clusters, on-premises or in the cloud.',
    transport: 'connector · in-cluster',
    tools: [
      T('openshift_inventory', 'Clusters, machine sets and projects'),
      T('openshift_quota_usage', 'Project quota versus usage'),
      T('openshift_scale_machineset', 'Scale a machine set', true),
    ],
  },
  {
    id: 'netapp', name: 'NetApp ONTAP', short: 'NetApp', cat: 'infra', logo: '/logos/netapp.svg',
    tagline: 'The intelligent data infrastructure company',
    desc: 'Volume and snapshot capacity on ONTAP arrays.',
    transport: 'connector · ONTAP REST',
    tools: [
      T('ontap_inventory', 'Aggregates, volumes and snapshot reserves'),
      T('ontap_cold_data_report', 'Cold blocks and duplicate data per volume'),
      T('ontap_delete_snapshots', 'Delete expired snapshots', true),
      T('ontap_enable_tiering', 'Tier cold data to object storage', true),
    ],
  },
  {
    id: 'ssh', name: 'Physical servers', short: 'Servers', cat: 'infra', logo: null, backendKind: 'ssh',
    tagline: 'Linux and Unix servers over SSH, managed in Settings',
    desc: 'SSH access to on-premises machines, used to find full disks and duplicate files.',
    transport: 'connector · SSH',
    tools: [
      T('ssh_inventory', 'Hosts, mounts and capacity'),
      T('ssh_verify_access', 'Check each host is reachable'),
      T('ssh_disk_usage', 'Disk usage by path'),
      T('ssh_find_duplicates', 'Duplicate files by hash'),
      T('ssh_stop_service', 'Stop an idle service', true),
    ],
  },
  // ---- Observability
  {
    id: 'datadog', name: 'Datadog', short: 'Datadog', cat: 'obs', logo: '/logos/datadog.svg',
    tagline: 'AI-Powered Observability and Security',
    desc: 'Host and APM metrics that confirm a resource is really idle before Martian touches it.',
    transport: 'remote · https',
    tools: [
      T('datadog_query_metrics', 'Query metric time series'),
      T('datadog_list_monitors', 'Monitors and their states'),
      T('datadog_host_map', 'Hosts with tags and agent status'),
      T('datadog_mute_monitor', 'Mute a monitor during a change', true),
    ],
  },
  {
    id: 'prometheus', name: 'Prometheus', short: 'Prometheus', cat: 'obs', logo: '/logos/prometheus.svg',
    tagline: 'Open source metrics and monitoring for your systems and services',
    desc: 'PromQL queries for on-premises and Kubernetes workloads.',
    transport: 'remote · https',
    tools: [T('prometheus_query', 'Instant PromQL query'), T('prometheus_query_range', 'PromQL range query'), T('prometheus_targets', 'Scrape targets and health')],
  },
  {
    id: 'grafana', name: 'Grafana', short: 'Grafana', cat: 'obs', logo: '/logos/grafana.svg',
    tagline: 'Full-stack observability for the agentic era',
    desc: 'Dashboards and annotations so every Martian change shows up next to your metrics.',
    transport: 'remote · https',
    tools: [T('grafana_search_dashboards', 'Find dashboards for a service'), T('grafana_query_datasource', 'Query a data source'), T('grafana_create_annotation', 'Annotate a change', true)],
  },
  {
    id: 'splunk', name: 'Splunk', short: 'Splunk', cat: 'obs', logo: '/logos/splunk.svg',
    tagline: 'Data Platform for Security, Observability & AI',
    desc: 'Search logs to confirm a service has no traffic before it is stopped.',
    transport: 'remote · https',
    tools: [T('splunk_search', 'Run an SPL search'), T('splunk_saved_searches', 'List saved searches'), T('splunk_index_usage', 'License usage by index')],
  },
  {
    id: 'newrelic', name: 'New Relic', short: 'New Relic', cat: 'obs', logo: '/logos/newrelic.svg',
    tagline: 'AI-powered Observability',
    desc: 'NRQL queries for APM throughput and infrastructure usage.',
    transport: 'remote · https',
    tools: [T('newrelic_nrql', 'Run an NRQL query'), T('newrelic_entities', 'Entities and their golden signals')],
  },
  {
    id: 'dynatrace', name: 'Dynatrace', short: 'Dynatrace', cat: 'obs', logo: '/logos/dynatrace.svg',
    tagline: 'Observability built for the age of AI',
    desc: 'Smartscape topology and host metrics from Dynatrace.',
    transport: 'remote · https',
    tools: [T('dynatrace_entities', 'Hosts, processes and services'), T('dynatrace_metrics', 'Metric selector queries'), T('dynatrace_problems', 'Open problems')],
  },
  {
    id: 'pagerduty', name: 'PagerDuty', short: 'PagerDuty', cat: 'obs', logo: '/logos/pagerduty.svg',
    tagline: 'The AI-First Operations Platform',
    desc: 'Checks on-call and open incidents before changes, and pages owners when something needs a person.',
    transport: 'remote · https',
    tools: [T('pagerduty_oncall', 'Who is on call for a service'), T('pagerduty_incidents', 'Open incidents'), T('pagerduty_create_incident', 'Open an incident', true)],
  },
  // ---- DevOps
  {
    id: 'terraform', name: 'Terraform', short: 'Terraform', cat: 'devops', logo: '/logos/terraform.svg',
    tagline: 'Safely and predictably create, change, and improve infrastructure',
    desc: 'Reads state to find ownership, and proposes fixes as plans instead of direct changes.',
    transport: 'remote · HCP Terraform',
    tools: [T('terraform_state_resources', 'Resources and modules from state'), T('terraform_workspaces', 'Workspaces and run status'), T('terraform_plan_change', 'Queue a speculative plan', true)],
  },
  {
    id: 'ansible', name: 'Ansible Automation Platform', short: 'Ansible', cat: 'devops', logo: '/logos/ansible.svg',
    tagline: 'Trusted automation that works in production and scales everywhere',
    desc: 'Runs approved remediation playbooks against your inventory.',
    transport: 'remote · https',
    tools: [T('ansible_inventories', 'Inventories and hosts'), T('ansible_job_templates', 'Job templates'), T('ansible_launch_job', 'Launch a job template', true)],
  },
  {
    id: 'github', name: 'GitHub', short: 'GitHub', cat: 'devops', logo: '/logos/github.svg',
    tagline: 'Change is constant. GitHub keeps you ahead.',
    desc: 'Opens pull requests against infrastructure-as-code repos.',
    transport: 'remote · https',
    tools: [T('github_search_code', 'Find where a resource is defined'), T('github_list_prs', 'Open pull requests'), T('github_open_pr', 'Open a pull request', true)],
  },
  {
    id: 'gitlab', name: 'GitLab', short: 'GitLab', cat: 'devops', logo: '/logos/gitlab.svg',
    tagline: 'Speed with control',
    desc: 'Merge requests and pipelines for infrastructure repos.',
    transport: 'remote · https',
    tools: [T('gitlab_search', 'Search projects and code'), T('gitlab_pipelines', 'Pipeline status'), T('gitlab_open_mr', 'Open a merge request', true)],
  },
  // ---- Data
  {
    id: 'snowflake', name: 'Snowflake', short: 'Snowflake', cat: 'data', logo: '/logos/snowflake.svg',
    tagline: 'Mobilize Data, Apps, and AI',
    desc: 'Credit use per warehouse, so idle warehouses and unused tables stand out.',
    transport: 'remote · https',
    tools: [T('snowflake_warehouse_usage', 'Credits by warehouse'), T('snowflake_table_storage', 'Table storage and last access'), T('snowflake_resize_warehouse', 'Resize or auto-suspend a warehouse', true)],
  },
  {
    id: 'databricks', name: 'Databricks', short: 'Databricks', cat: 'data', logo: '/logos/databricks.svg',
    tagline: 'Leading Data and AI Solutions for Enterprises',
    desc: 'Job costs and cluster utilization, including all-purpose clusters left running.',
    transport: 'remote · https',
    tools: [T('databricks_clusters', 'Clusters, policies and utilization'), T('databricks_job_costs', 'DBU cost per job'), T('databricks_terminate_cluster', 'Terminate an idle cluster', true)],
  },
  // ---- Collaboration
  {
    id: 'slack', name: 'Slack', short: 'Slack', cat: 'collab', logo: '/logos/slack.svg',
    tagline: 'The operating system for work',
    desc: 'Sends findings to owners and collects approvals in a channel.',
    transport: 'remote · https',
    tools: [T('slack_post_message', 'Post a summary to a channel', true), T('slack_request_approval', 'Ask an owner to approve a change', true), T('slack_lookup_user', 'Find a user by email')],
  },
  {
    id: 'jira', name: 'Jira', short: 'Jira', cat: 'collab', logo: '/logos/jira.svg',
    tagline: "Unlock your team's best work",
    desc: 'Opens tickets for changes that need another team.',
    transport: 'remote · https',
    tools: [T('jira_search', 'JQL search'), T('jira_create_issue', 'Create an issue', true), T('jira_transition_issue', 'Move an issue', true)],
  },
];

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

/** Map a backend integration kind (or catalog id) to its catalog entry. */
export const catalogFor = (kindOrId: string | undefined | null): CatalogEntry | undefined => {
  if (!kindOrId) return undefined;
  if (CATALOG_BY_ID[kindOrId]) return CATALOG_BY_ID[kindOrId];
  return CATALOG.find((c) => c.backendKind === kindOrId);
};

/** The integration a tool name belongs to (by MCP prefix), for traces and graphs. */
const PREFIX: Record<string, string> = {
  aws: 'aws', azure: 'azure', gcp: 'gcp', oci: 'oracle', vcenter: 'vmware', nutanix: 'nutanix', proxmox: 'proxmox',
  k8s: 'kubernetes', openshift: 'openshift', ontap: 'netapp', ssh: 'ssh', datadog: 'datadog', prometheus: 'prometheus',
  grafana: 'grafana', splunk: 'splunk', newrelic: 'newrelic', dynatrace: 'dynatrace', pagerduty: 'pagerduty',
  terraform: 'terraform', ansible: 'ansible', github: 'github', gitlab: 'gitlab', snowflake: 'snowflake',
  databricks: 'databricks', slack: 'slack', jira: 'jira',
};
export const integrationForTool = (tool: string): string | null => PREFIX[tool.split('_')[0]] ?? null;
