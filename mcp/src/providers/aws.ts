import { AutoScalingClient, paginateDescribeAutoScalingGroups, SetDesiredCapacityCommand } from "@aws-sdk/client-auto-scaling";
import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import {
  CreateSnapshotCommand,
  DeleteNatGatewayCommand,
  DeleteSnapshotCommand,
  DeleteVolumeCommand,
  DescribeImagesCommand,
  EC2Client,
  paginateDescribeInstances,
  paginateDescribeNatGateways,
  paginateDescribeSnapshots,
  paginateDescribeVolumes,
  StartInstancesCommand,
  StopInstancesCommand,
  waitUntilSnapshotCompleted,
} from "@aws-sdk/client-ec2";
import { DeleteLoadBalancerCommand, ElasticLoadBalancingV2Client, paginateDescribeLoadBalancers } from "@aws-sdk/client-elastic-load-balancing-v2";
import { ModifyDBInstanceCommand, paginateDescribeDBInstances, RDSClient } from "@aws-sdk/client-rds";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { z } from "zod";
import {
  ALB_MONTH, downsizeClass, ebsMonthly, ec2Monthly, NAT_MONTH, rdsMonthly, round2, SNAPSHOT_GB_MONTH,
} from "../core/pricing.js";
import type { IntegrationSpec, InventoryResult, Provider, Resource, ToolDef } from "../core/types.js";
import { avg, chunk, daysSince, log, p95, round1, tagsToRecord } from "../core/util.js";

type Account = { account_id?: string; role_arn?: string; external_id?: string };
type Ctx = { account: string; region: string; credentials?: ReturnType<typeof fromTemporaryCredentials> };

const DAY = 86_400_000;
const WINDOW_DAYS = 14;

export class AwsProvider implements Provider {
  constructor(private spec: IntegrationSpec) {}

  private accounts(): Account[] {
    const a = this.spec.config.accounts as Account[] | undefined;
    return a?.length ? a : [{}];
  }

  private regions(): string[] {
    const r = this.spec.config.regions as string[] | undefined;
    return r?.length ? r : [process.env.AWS_REGION ?? "us-east-1"];
  }

  private ctx(account: Account, region: string): Ctx {
    const credentials = account.role_arn
      ? fromTemporaryCredentials({
          params: { RoleArn: account.role_arn, ExternalId: account.external_id, RoleSessionName: "martian", DurationSeconds: 3600 },
          clientConfig: { region },
        })
      : undefined;
    return { account: account.account_id ?? "", region, credentials };
  }

  private ctxFor(region?: string, accountId?: string): Ctx {
    const account = this.accounts().find((a) => !accountId || a.account_id === accountId) ?? this.accounts()[0];
    return this.ctx(account, region ?? this.regions()[0]);
  }

  private ec2 = (c: Ctx) => new EC2Client({ region: c.region, credentials: c.credentials });
  private rds = (c: Ctx) => new RDSClient({ region: c.region, credentials: c.credentials });
  private elb = (c: Ctx) => new ElasticLoadBalancingV2Client({ region: c.region, credentials: c.credentials });
  private asg = (c: Ctx) => new AutoScalingClient({ region: c.region, credentials: c.credentials });
  private cw = (c: Ctx) => new CloudWatchClient({ region: c.region, credentials: c.credentials });

  /** Hourly series for many metrics in as few GetMetricData calls as possible. */
  private async series(c: Ctx, queries: { id: string; ns: string; metric: string; dim: string; value: string; stat?: string }[]) {
    const out = new Map<string, number[]>();
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * DAY);
    for (const batch of chunk(queries, 500)) {
      const mdq: MetricDataQuery[] = batch.map((q) => ({
        Id: q.id,
        MetricStat: {
          Metric: { Namespace: q.ns, MetricName: q.metric, Dimensions: [{ Name: q.dim, Value: q.value }] },
          Period: 3600,
          Stat: q.stat ?? "Average",
        },
      }));
      let token: string | undefined;
      do {
        const r = await this.cw(c).send(new GetMetricDataCommand({ MetricDataQueries: mdq, StartTime: start, EndTime: end, NextToken: token, ScanBy: "TimestampAscending" }));
        for (const res of r.MetricDataResults ?? []) {
          out.set(res.Id!, [...(out.get(res.Id!) ?? []), ...((res.Values ?? []) as number[])]);
        }
        token = r.NextToken;
      } while (token);
    }
    return out;
  }

  async inventory(): Promise<InventoryResult> {
    const resources: Resource[] = [];
    const warnings: string[] = [];
    for (const account of this.accounts()) {
      let accountId = account.account_id ?? "";
      for (const region of this.regions()) {
        const c = this.ctx(account, region);
        if (!accountId) {
          const id = await new STSClient({ region, credentials: c.credentials }).send(new GetCallerIdentityCommand({}));
          accountId = id.Account ?? "";
        }
        c.account = accountId;
        try {
          resources.push(...(await this.regionInventory(c)));
        } catch (e) {
          warnings.push(`${accountId}/${region}: ${(e as Error).message}`);
          log.warn({ err: e, region }, "aws region inventory failed");
        }
      }
    }
    return { integration: "aws", resources, warnings };
  }

  private async regionInventory(c: Ctx): Promise<Resource[]> {
    const ec2 = this.ec2(c);
    const base = { account: c.account, region: c.region, environment: "cloud" as const };
    const out: Resource[] = [];

    const instances = [];
    for await (const page of paginateDescribeInstances({ client: ec2 }, {})) {
      for (const r of page.Reservations ?? []) instances.push(...(r.Instances ?? []));
    }
    const volumes = [];
    for await (const page of paginateDescribeVolumes({ client: ec2 }, {})) volumes.push(...(page.Volumes ?? []));
    const snapshots = [];
    for await (const page of paginateDescribeSnapshots({ client: ec2 }, { OwnerIds: ["self"] })) snapshots.push(...(page.Snapshots ?? []));
    const images = await ec2.send(new DescribeImagesCommand({ Owners: ["self"] }));
    const imageSnaps = new Set(
      (images.Images ?? []).flatMap((i) => (i.BlockDeviceMappings ?? []).map((b) => b.Ebs?.SnapshotId).filter(Boolean)),
    );
    const dbs = [];
    for await (const page of paginateDescribeDBInstances({ client: this.rds(c) }, {})) dbs.push(...(page.DBInstances ?? []));
    const lbs = [];
    for await (const page of paginateDescribeLoadBalancers({ client: this.elb(c) }, {})) lbs.push(...(page.LoadBalancers ?? []));
    const nats = [];
    for await (const page of paginateDescribeNatGateways({ client: ec2 }, {})) nats.push(...(page.NatGateways ?? []));
    const groups = [];
    for await (const page of paginateDescribeAutoScalingGroups({ client: this.asg(c) }, {})) groups.push(...(page.AutoScalingGroups ?? []));

    const q: Parameters<AwsProvider["series"]>[1] = [];
    instances.forEach((i, n) => q.push({ id: `i${n}`, ns: "AWS/EC2", metric: "CPUUtilization", dim: "InstanceId", value: i.InstanceId! }));
    dbs.forEach((d, n) => q.push({ id: `d${n}`, ns: "AWS/RDS", metric: "CPUUtilization", dim: "DBInstanceIdentifier", value: d.DBInstanceIdentifier! }));
    lbs.forEach((l, n) => {
      const dim = l.LoadBalancerArn!.split(":loadbalancer/")[1] ?? "";
      const ns = l.Type === "network" ? "AWS/NetworkELB" : "AWS/ApplicationELB";
      q.push({ id: `l${n}`, ns, metric: l.Type === "network" ? "NewFlowCount" : "RequestCount", dim: "LoadBalancer", value: dim, stat: "Sum" });
    });
    nats.forEach((g, n) => q.push({ id: `n${n}`, ns: "AWS/NATGateway", metric: "BytesOutToDestination", dim: "NatGatewayId", value: g.NatGatewayId!, stat: "Sum" }));
    groups.forEach((g, n) => q.push({ id: `a${n}`, ns: "AWS/EC2", metric: "CPUUtilization", dim: "AutoScalingGroupName", value: g.AutoScalingGroupName! }));
    const m = q.length ? await this.series(c, q) : new Map<string, number[]>();
    const cpu = (id: string) => {
      const s = m.get(id) ?? [];
      return s.length ? { cpu_avg_14d: round1(avg(s)), cpu_p95_14d: round1(p95(s)), datapoints: s.length } : {};
    };

    instances.forEach((i, n) => {
      const tags = tagsToRecord(i.Tags);
      const type = i.InstanceType ?? "";
      out.push({
        ...base,
        resource_id: i.InstanceId!,
        resource_type: "vm",
        name: tags.Name ?? i.InstanceId!,
        state: i.State?.Name ?? "",
        monthly_cost: i.State?.Name === "running" ? round2(ec2Monthly(type)) : 0,
        attributes: { instance_type: type, launch_time: i.LaunchTime, platform: i.PlatformDetails, asg: tags["aws:autoscaling:groupName"], system: tags.System ?? tags.Application },
        tags,
        metrics: cpu(`i${n}`),
      });
    });
    for (const v of volumes) {
      const attached = (v.Attachments ?? []).length > 0;
      out.push({
        ...base,
        resource_id: v.VolumeId!,
        resource_type: "volume",
        name: tagsToRecord(v.Tags).Name ?? v.VolumeId!,
        state: v.State ?? "",
        monthly_cost: round2(ebsMonthly(v.VolumeType ?? "gp2", v.Size ?? 0)),
        // AWS doesn't record detach time; creation time is an upper bound for never-attached volumes.
        attributes: { size_gb: v.Size, volume_type: v.VolumeType, attached, unattached_days: attached ? 0 : daysSince(v.CreateTime), encrypted: v.Encrypted },
        tags: tagsToRecord(v.Tags),
        metrics: {},
      });
    }
    for (const s of snapshots) {
      out.push({
        ...base,
        resource_id: s.SnapshotId!,
        resource_type: "snapshot",
        name: tagsToRecord(s.Tags).Name ?? s.SnapshotId!,
        state: s.State ?? "",
        monthly_cost: round2((s.VolumeSize ?? 0) * SNAPSHOT_GB_MONTH),
        attributes: { size_gb: s.VolumeSize, age_days: daysSince(s.StartTime), in_use_by_image: imageSnaps.has(s.SnapshotId), volume_id: s.VolumeId },
        tags: tagsToRecord(s.Tags),
        metrics: {},
      });
    }
    dbs.forEach((d, n) => {
      const cls = d.DBInstanceClass ?? "";
      out.push({
        ...base,
        resource_id: d.DBInstanceIdentifier!,
        resource_type: "database",
        name: d.DBInstanceIdentifier!,
        state: d.DBInstanceStatus ?? "",
        monthly_cost: round2(rdsMonthly(cls) * (d.MultiAZ ? 2 : 1)),
        attributes: { instance_class: cls, downsize_to: downsizeClass(cls), engine: d.Engine, multi_az: d.MultiAZ },
        tags: tagsToRecord(d.TagList),
        metrics: cpu(`d${n}`),
      });
    });
    lbs.forEach((l, n) => {
      const s = m.get(`l${n}`) ?? [];
      out.push({
        ...base,
        resource_id: l.LoadBalancerArn!,
        resource_type: "load_balancer",
        name: l.LoadBalancerName ?? "",
        state: l.State?.Code ?? "",
        monthly_cost: ALB_MONTH,
        attributes: { type: l.Type, scheme: l.Scheme, age_days: daysSince(l.CreatedTime) },
        tags: {},
        // Only claim "no traffic" when CloudWatch has a full window of data.
        metrics: daysSince(l.CreatedTime) >= WINDOW_DAYS ? { traffic_14d: s.reduce((a, b) => a + b, 0) } : {},
      });
    });
    nats.forEach((g, n) => {
      if (g.State !== "available") return;
      const s = m.get(`n${n}`) ?? [];
      out.push({
        ...base,
        resource_id: g.NatGatewayId!,
        resource_type: "nat_gateway",
        name: tagsToRecord(g.Tags).Name ?? g.NatGatewayId!,
        state: g.State ?? "",
        monthly_cost: NAT_MONTH,
        attributes: { vpc_id: g.VpcId, age_days: daysSince(g.CreateTime) },
        tags: tagsToRecord(g.Tags),
        metrics: daysSince(g.CreateTime) >= WINDOW_DAYS ? { traffic_14d: s.reduce((a, b) => a + b, 0) } : {},
      });
    });
    groups.forEach((g, n) => {
      const types = (g.Instances ?? []).map((i) => i.InstanceType ?? "");
      const series = m.get(`a${n}`) ?? [];
      out.push({
        ...base,
        resource_id: g.AutoScalingGroupName!,
        resource_type: "asg",
        name: g.AutoScalingGroupName!,
        state: g.Status ?? "active",
        monthly_cost: round2(types.reduce((a, t) => a + ec2Monthly(t), 0)),
        attributes: { desired: g.DesiredCapacity, min: g.MinSize, max: g.MaxSize, instance_types: [...new Set(types)] },
        tags: tagsToRecord(g.Tags as any),
        metrics: { ...(series.length ? { cpu_avg_14d: round1(avg(series)), cpu_p95_14d: round1(p95(series)) } : {}), cpu_series: series.map(round1) },
      });
    });
    return out;
  }

  tools(): ToolDef[] {
    const region = z.string().describe("AWS region, e.g. us-east-1").optional();
    const account = z.string().describe("Account ID (when several accounts are connected)").optional();
    return [
      {
        name: "aws_inventory",
        title: "AWS inventory",
        description: "All EC2 instances, EBS volumes, snapshots, RDS databases, load balancers, NAT gateways and Auto Scaling groups with 14-day utilization and estimated monthly cost.",
        write: false,
        input: {},
        run: () => this.inventory(),
      },
      {
        name: "aws_verify_access",
        title: "Verify access",
        description: "Confirms which AWS identities Martian uses for each connected account.",
        write: false,
        input: {},
        run: async () => {
          const out = [];
          for (const a of this.accounts()) {
            const c = this.ctx(a, this.regions()[0]);
            const id = await new STSClient({ region: c.region, credentials: c.credentials }).send(new GetCallerIdentityCommand({}));
            out.push({ account: id.Account, arn: id.Arn });
          }
          return { ok: true, identities: out };
        },
      },
      {
        name: "aws_get_cpu_series",
        title: "CPU history",
        description: "Hourly average CPU utilization for the last 14 days for an EC2 instance, RDS database or Auto Scaling group.",
        write: false,
        input: { resource_type: z.enum(["instance", "database", "asg"]), resource_id: z.string(), region, account },
        run: async (a: { resource_type: string; resource_id: string; region?: string; account?: string }) => {
          const c = this.ctxFor(a.region, a.account);
          const dim = { instance: ["AWS/EC2", "InstanceId"], database: ["AWS/RDS", "DBInstanceIdentifier"], asg: ["AWS/EC2", "AutoScalingGroupName"] }[a.resource_type]!;
          const m = await this.series(c, [{ id: "s", ns: dim[0], metric: "CPUUtilization", dim: dim[1], value: a.resource_id }]);
          return { resource_id: a.resource_id, period_seconds: 3600, series: (m.get("s") ?? []).map(round1) };
        },
      },
      {
        name: "aws_cost_by_service",
        title: "Cost by service",
        description: "Actual unblended cost by AWS service for the last 30 days (Cost Explorer).",
        write: false,
        input: { account },
        run: async (a: { account?: string }) => {
          const c = this.ctxFor("us-east-1", a.account);
          const end = new Date();
          const start = new Date(end.getTime() - 30 * DAY);
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          const r = await new CostExplorerClient({ region: "us-east-1", credentials: c.credentials }).send(
            new GetCostAndUsageCommand({ TimePeriod: { Start: fmt(start), End: fmt(end) }, Granularity: "MONTHLY", Metrics: ["UnblendedCost"], GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }] }),
          );
          const totals = new Map<string, number>();
          for (const t of r.ResultsByTime ?? []) for (const g of t.Groups ?? []) {
            const k = g.Keys?.[0] ?? "Other";
            totals.set(k, (totals.get(k) ?? 0) + Number(g.Metrics?.UnblendedCost?.Amount ?? 0));
          }
          return { period_days: 30, services: [...totals].map(([service, cost]) => ({ service, cost: round2(cost) })).sort((x, y) => y.cost - x.cost) };
        },
      },
      {
        name: "aws_stop_instances",
        title: "Stop EC2 instances",
        description: "Stops running EC2 instances. Reversible with aws_start_instances; EBS data is kept.",
        write: true,
        input: { region, account, instance_ids: z.array(z.string()).min(1).max(200) },
        run: async (a: { region?: string; account?: string; instance_ids: string[] }) => {
          const r = await this.ec2(this.ctxFor(a.region, a.account)).send(new StopInstancesCommand({ InstanceIds: a.instance_ids }));
          return { ok: true, changed: (r.StoppingInstances ?? []).map((i) => ({ id: i.InstanceId, from: i.PreviousState?.Name, to: i.CurrentState?.Name })) };
        },
      },
      {
        name: "aws_start_instances",
        title: "Start EC2 instances",
        description: "Starts stopped EC2 instances (used to roll back aws_stop_instances).",
        write: true,
        input: { region, account, instance_ids: z.array(z.string()).min(1).max(200) },
        run: async (a: { region?: string; account?: string; instance_ids: string[] }) => {
          const r = await this.ec2(this.ctxFor(a.region, a.account)).send(new StartInstancesCommand({ InstanceIds: a.instance_ids }));
          return { ok: true, changed: (r.StartingInstances ?? []).map((i) => ({ id: i.InstanceId, to: i.CurrentState?.Name })) };
        },
      },
      {
        name: "aws_snapshot_and_delete_volumes",
        title: "Snapshot and delete volumes",
        description: "Takes a final snapshot of each unattached EBS volume, waits for it to complete, then deletes the volume.",
        write: true,
        input: { region, account, volume_ids: z.array(z.string()).min(1).max(100) },
        run: async (a: { region?: string; account?: string; volume_ids: string[] }) => {
          const ec2 = this.ec2(this.ctxFor(a.region, a.account));
          const results = [];
          for (const id of a.volume_ids) {
            const snap = await ec2.send(new CreateSnapshotCommand({ VolumeId: id, Description: `Martian final snapshot of ${id}`, TagSpecifications: [{ ResourceType: "snapshot", Tags: [{ Key: "martian:source-volume", Value: id }] }] }));
            await waitUntilSnapshotCompleted({ client: ec2, maxWaitTime: 1800 }, { SnapshotIds: [snap.SnapshotId!] });
            await ec2.send(new DeleteVolumeCommand({ VolumeId: id }));
            results.push({ volume_id: id, snapshot_id: snap.SnapshotId });
          }
          return { ok: true, deleted: results, restore_hint: "Create a volume from the listed snapshot to restore." };
        },
      },
      {
        name: "aws_delete_snapshots",
        title: "Delete snapshots",
        description: "Deletes EBS snapshots that no AMI uses. Not reversible.",
        write: true,
        input: { region, account, snapshot_ids: z.array(z.string()).min(1).max(200) },
        run: async (a: { region?: string; account?: string; snapshot_ids: string[] }) => {
          const ec2 = this.ec2(this.ctxFor(a.region, a.account));
          for (const id of a.snapshot_ids) await ec2.send(new DeleteSnapshotCommand({ SnapshotId: id }));
          return { ok: true, deleted: a.snapshot_ids };
        },
      },
      {
        name: "aws_modify_db_instance_class",
        title: "Resize RDS instance",
        description: "Changes an RDS instance class. Applied in the next maintenance window unless apply_immediately is true.",
        write: true,
        input: { region, account, db_instance_id: z.string(), target_class: z.string(), apply_immediately: z.boolean().default(false) },
        run: async (a: { region?: string; account?: string; db_instance_id: string; target_class: string; apply_immediately?: boolean }) => {
          const r = await this.rds(this.ctxFor(a.region, a.account)).send(
            new ModifyDBInstanceCommand({ DBInstanceIdentifier: a.db_instance_id, DBInstanceClass: a.target_class, ApplyImmediately: a.apply_immediately ?? false }),
          );
          return { ok: true, db_instance_id: a.db_instance_id, pending: r.DBInstance?.PendingModifiedValues };
        },
      },
      {
        name: "aws_delete_load_balancers",
        title: "Delete load balancers",
        description: "Deletes load balancers that served no traffic. Not reversible.",
        write: true,
        input: { region, account, load_balancer_arns: z.array(z.string()).min(1).max(50) },
        run: async (a: { region?: string; account?: string; load_balancer_arns: string[] }) => {
          const elb = this.elb(this.ctxFor(a.region, a.account));
          for (const arn of a.load_balancer_arns) await elb.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: arn }));
          return { ok: true, deleted: a.load_balancer_arns };
        },
      },
      {
        name: "aws_delete_nat_gateways",
        title: "Delete NAT gateways",
        description: "Deletes NAT gateways that carried no traffic. Not reversible.",
        write: true,
        input: { region, account, nat_gateway_ids: z.array(z.string()).min(1).max(50) },
        run: async (a: { region?: string; account?: string; nat_gateway_ids: string[] }) => {
          const ec2 = this.ec2(this.ctxFor(a.region, a.account));
          for (const id of a.nat_gateway_ids) await ec2.send(new DeleteNatGatewayCommand({ NatGatewayId: id }));
          return { ok: true, deleted: a.nat_gateway_ids };
        },
      },
      {
        name: "aws_set_asg_desired_capacity",
        title: "Set Auto Scaling capacity",
        description: "Sets the desired capacity of an Auto Scaling group (within its min and max).",
        write: true,
        input: { region, account, asg_name: z.string(), desired: z.number().int().min(0) },
        run: async (a: { region?: string; account?: string; asg_name: string; desired: number }) => {
          await this.asg(this.ctxFor(a.region, a.account)).send(new SetDesiredCapacityCommand({ AutoScalingGroupName: a.asg_name, DesiredCapacity: a.desired, HonorCooldown: false }));
          return { ok: true, asg_name: a.asg_name, desired: a.desired };
        },
      },
    ];
  }
}
