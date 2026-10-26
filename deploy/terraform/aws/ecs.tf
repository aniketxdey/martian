resource "aws_ecs_cluster" "martian" {
  name = "martian-${var.env}"
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

# Service Connect: tasks reach each other as http://gateway:8787, http://forecast:8790, http://api:8000.
resource "aws_service_discovery_http_namespace" "martian" {
  name = "martian-${var.env}.internal"
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(["api", "worker", "gateway", "forecast", "migrate"])
  name              = "/martian/${var.env}/${each.key}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.martian.arn
}

# ---------- IAM

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "martian-${var.env}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role   = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = concat(
          [for s in aws_secretsmanager_secret.generated : s.arn],
          [for s in aws_secretsmanager_secret.external : s.arn],
          [aws_db_instance.martian.master_user_secret[0].secret_arn],
        )
      },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.martian.arn] },
    ]
  })
}

# Control plane tasks: envelope-encrypt integration credentials with the KMS key.
resource "aws_iam_role" "control_plane" {
  name               = "martian-${var.env}-control-plane"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "control_plane" {
  role   = aws_iam_role.control_plane.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
      Resource = [aws_kms_key.martian.arn]
    }]
  })
}

# Gateway and forecast need no AWS permissions at all.
resource "aws_iam_role" "minimal" {
  name               = "martian-${var.env}-minimal"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ---------- task definitions

locals {
  registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
  images   = {
    control_plane = "${local.registry}/martian/control-plane:${var.image_tag}"
    forecast      = "${local.registry}/martian/forecast:${var.image_tag}"
    gateway       = "${local.registry}/martian/gateway:${var.image_tag}"
  }

  secret = { for k, s in aws_secretsmanager_secret.generated : k => s.arn }
  ext    = { for k, s in aws_secretsmanager_secret.external : k => s.arn }
  rds    = aws_db_instance.martian.master_user_secret[0].secret_arn

  control_plane_env = [
    { name = "MARTIAN_ENV", value = "production" },
    { name = "MARTIAN_DB_HOST", value = aws_db_instance.martian.address },
    { name = "MARTIAN_DB_NAME", value = "martian" },
    { name = "MARTIAN_WEB_ORIGIN", value = "https://app.${var.domain}" },
    { name = "MARTIAN_API_PUBLIC_URL", value = "https://api.${var.domain}" },
    { name = "MARTIAN_COOKIE_SECURE", value = "true" },
    { name = "MARTIAN_KMS_KEY_ID", value = aws_kms_key.martian.arn },
    { name = "MARTIAN_GATEWAY_URL", value = "http://gateway:8787" },
    { name = "MARTIAN_CONNECTOR_GATEWAY_URL", value = "wss://connect.${var.domain}/connect" },
    { name = "MARTIAN_FORECAST_URL", value = "http://forecast:8790/mcp" },
    { name = "MARTIAN_ANTHROPIC_MODEL", value = var.anthropic_model },
    { name = "AWS_REGION", value = var.region },
  ]
  control_plane_secrets = [
    { name = "MARTIAN_DB_APP_PASSWORD", valueFrom = local.secret.app_db_password },
    { name = "MARTIAN_SESSION_SECRET", valueFrom = local.secret.session_secret },
    { name = "MARTIAN_INTERNAL_TOKEN", valueFrom = local.secret.internal_token },
    { name = "ANTHROPIC_API_KEY", valueFrom = local.ext.anthropic_api_key },
    { name = "MARTIAN_WORKOS_API_KEY", valueFrom = local.ext.workos_api_key },
    { name = "MARTIAN_WORKOS_CLIENT_ID", valueFrom = local.ext.workos_client_id },
  ]

  logs = { for k, g in aws_cloudwatch_log_group.svc : k => {
    logDriver = "awslogs"
    options   = { "awslogs-group" = g.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = k }
  } }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "martian-${var.env}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.control_plane.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name             = "api"
    image            = local.images.control_plane
    command          = ["martian-api"]
    essential        = true
    portMappings     = [{ name = "api", containerPort = 8000, protocol = "tcp", appProtocol = "http" }]
    environment      = local.control_plane_env
    secrets          = local.control_plane_secrets
    logConfiguration = local.logs.api
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "martian-${var.env}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.control_plane.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name             = "worker"
    image            = local.images.control_plane
    command          = ["martian-worker"]
    essential        = true
    environment      = concat(local.control_plane_env, [{ name = "MARTIAN_WORKER_CONCURRENCY", value = "8" }])
    secrets          = local.control_plane_secrets
    logConfiguration = local.logs.worker
  }])
}

# One-shot: CI runs this with `aws ecs run-task` before rolling the services.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "martian-${var.env}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.control_plane.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name        = "migrate"
    image       = local.images.control_plane
    command     = ["martian-migrate"]
    essential   = true
    environment = concat(local.control_plane_env, [{ name = "MARTIAN_DB_OWNER_USER", value = "martian_owner" }])
    secrets     = concat(local.control_plane_secrets, [
      { name = "MARTIAN_DB_OWNER_PASSWORD", valueFrom = "${local.rds}:password::" },
    ])
    logConfiguration = local.logs.migrate
  }])
}

resource "aws_ecs_task_definition" "gateway" {
  family                   = "martian-${var.env}-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.minimal.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name         = "gateway"
    image        = local.images.gateway
    command      = ["node", "dist/gateway.js"]
    essential    = true
    portMappings = [{ name = "gateway", containerPort = 8787, protocol = "tcp", appProtocol = "http" }]
    environment  = [
      { name = "PORT", value = "8787" },
      { name = "MARTIAN_API_URL", value = "http://api:8000" },
    ]
    secrets                = [{ name = "MARTIAN_INTERNAL_TOKEN", valueFrom = local.secret.internal_token }]
    logConfiguration       = local.logs.gateway
    readonlyRootFilesystem = true
  }])
}

resource "aws_ecs_task_definition" "forecast" {
  family                   = "martian-${var.env}-forecast"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 3072
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.minimal.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name             = "forecast"
    image            = local.images.forecast
    command          = ["martian-forecast"]
    essential        = true
    portMappings     = [{ name = "forecast", containerPort = 8790, protocol = "tcp", appProtocol = "http" }]
    secrets          = [{ name = "MARTIAN_INTERNAL_TOKEN", valueFrom = local.secret.internal_token }]
    logConfiguration = local.logs.forecast
  }])
}

# ---------- services

locals {
  services = {
    api      = { td = aws_ecs_task_definition.api.arn, count = var.api_count, port = "api", tg = aws_lb_target_group.api.arn, container_port = 8000 }
    gateway  = { td = aws_ecs_task_definition.gateway.arn, count = var.gateway_count, port = "gateway", tg = aws_lb_target_group.gateway.arn, container_port = 8787 }
    forecast = { td = aws_ecs_task_definition.forecast.arn, count = 1, port = "forecast", tg = null, container_port = 8790 }
    worker   = { td = aws_ecs_task_definition.worker.arn, count = var.worker_count, port = null, tg = null, container_port = null }
  }
}

resource "aws_ecs_service" "svc" {
  for_each        = local.services
  name            = each.key
  cluster         = aws_ecs_cluster.martian.id
  task_definition = each.value.td
  desired_count   = each.value.count
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  # The gateway holds connector WebSockets: replace rather than run two at once.
  deployment_minimum_healthy_percent = each.key == "gateway" ? 0 : 100
  deployment_maximum_percent         = each.key == "gateway" ? 100 : 200

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.services.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = each.value.tg == null ? [] : [1]
    content {
      target_group_arn = each.value.tg
      container_name   = each.key
      container_port   = each.value.container_port
    }
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.martian.arn
    dynamic "service" {
      for_each = each.value.port == null ? [] : [1]
      content {
        port_name = each.value.port
        client_alias {
          port     = each.value.container_port
          dns_name = each.key
        }
        # SSE and long tool calls.
        timeout {
          idle_timeout_seconds        = 600
          per_request_timeout_seconds = 600
        }
      }
    }
  }

  lifecycle { ignore_changes = [desired_count] }
  depends_on = [aws_lb_listener.https]
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.martian.name}/${aws_ecs_service.svc["api"].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_count
  max_capacity       = var.api_count * 4
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "cpu"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}
