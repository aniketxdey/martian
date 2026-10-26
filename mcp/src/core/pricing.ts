/**
 * On-demand list prices (USD, Linux, us-east-1 / East US / us-central1) used to
 * estimate monthly cost per resource when billing data isn't broken down per
 * resource. Cost Explorer / Cost Management totals are reported alongside.
 * Unknown sizes fall back to a per-vCPU estimate so findings are never zero.
 */

export const HOURS_PER_MONTH = 730;

const EC2_HOURLY: Record<string, number> = {
  "t3.micro": 0.0104, "t3.small": 0.0208, "t3.medium": 0.0416, "t3.large": 0.0832, "t3.xlarge": 0.1664,
  "t3.2xlarge": 0.3328, "m5.large": 0.096, "m5.xlarge": 0.192, "m5.2xlarge": 0.384, "m5.4xlarge": 0.768,
  "m6i.large": 0.096, "m6i.xlarge": 0.192, "m6i.2xlarge": 0.384, "c5.large": 0.085, "c5.xlarge": 0.17,
  "c5.2xlarge": 0.34, "c5.4xlarge": 0.68, "r5.large": 0.126, "r5.xlarge": 0.252, "r5.2xlarge": 0.504,
  "r5.4xlarge": 1.008, "p3.2xlarge": 3.06, "g4dn.xlarge": 0.526,
};

const RDS_HOURLY: Record<string, number> = {
  "db.t3.medium": 0.068, "db.t3.large": 0.136, "db.m5.large": 0.171, "db.m5.xlarge": 0.342,
  "db.m5.2xlarge": 0.684, "db.r5.large": 0.24, "db.r5.xlarge": 0.48, "db.r5.2xlarge": 0.96,
  "db.r5.4xlarge": 1.92,
};

/** One size down within the same family, for right-sizing recommendations. */
export function downsizeClass(cls: string): string | null {
  const order = ["micro", "small", "medium", "large", "xlarge", "2xlarge", "4xlarge", "8xlarge"];
  const m = cls.match(/^(db\.)?([a-z0-9]+)\.([a-z0-9]+)$/);
  if (!m) return null;
  const i = order.indexOf(m[3]);
  if (i <= 0) return null;
  return `${m[1] ?? ""}${m[2]}.${order[i - 1]}`;
}

const EBS_GB_MONTH: Record<string, number> = { gp2: 0.1, gp3: 0.08, io1: 0.125, io2: 0.125, st1: 0.045, sc1: 0.015, standard: 0.05 };

const AZURE_VM_HOURLY: Record<string, number> = {
  Standard_B2s: 0.0416, Standard_D2s_v3: 0.096, Standard_D4s_v3: 0.192, Standard_D8s_v3: 0.384,
  Standard_E4s_v3: 0.252, Standard_F4s_v2: 0.169,
};

const GCP_VM_HOURLY: Record<string, number> = {
  "e2-standard-2": 0.067, "e2-standard-4": 0.134, "n2-standard-2": 0.097, "n2-standard-4": 0.194,
  "n2-standard-8": 0.388, "n1-standard-4": 0.19,
};

export const SNAPSHOT_GB_MONTH = 0.05;
export const ALB_MONTH = 16.43 + 5.84; // hourly charge + one LCU
export const NAT_MONTH = 32.85;

const vcpuGuess = (size: string): number => {
  const m = size.match(/(\d+)x?large/);
  if (size.includes("xlarge")) return m ? Number(m[1]) * 4 : 4;
  if (size.includes("large")) return 2;
  const n = size.match(/(\d+)/);
  return n ? Number(n[1]) : 2;
};

export const ec2Monthly = (type: string) => (EC2_HOURLY[type] ?? vcpuGuess(type) * 0.048) * HOURS_PER_MONTH;
export const rdsMonthly = (cls: string) => (RDS_HOURLY[cls] ?? vcpuGuess(cls) * 0.12) * HOURS_PER_MONTH;
export const ebsMonthly = (type: string, gb: number) => (EBS_GB_MONTH[type] ?? 0.1) * gb;
export const azureVmMonthly = (size: string) => (AZURE_VM_HOURLY[size] ?? vcpuGuess(size) * 0.048) * HOURS_PER_MONTH;
export const gcpVmMonthly = (type: string) => (GCP_VM_HOURLY[type] ?? vcpuGuess(type) * 0.048) * HOURS_PER_MONTH;
export const diskMonthly = (gb: number, premium = false) => gb * (premium ? 0.135 : 0.05);

export const round2 = (v: number) => Math.round(v * 100) / 100;
