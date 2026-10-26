data "aws_route53_zone" "zone" { name = var.domain }

resource "aws_acm_certificate" "alb" {
  domain_name               = "api.${var.domain}"
  subject_alternative_names = ["connect.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "alb_validation" {
  for_each = { for o in aws_acm_certificate.alb.domain_validation_options : o.domain_name => o }
  zone_id  = data.aws_route53_zone.zone.zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 300
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.alb_validation : r.fqdn]
}

resource "aws_s3_bucket" "alb_logs" {
  bucket_prefix = "martian-${var.env}-alb-logs-"
  force_destroy = var.env != "prod"
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.alb_logs.arn}/*"
    }]
  })
}

resource "aws_lb" "martian" {
  name                       = "martian-${var.env}"
  load_balancer_type         = "application"
  subnets                    = module.vpc.public_subnets
  security_groups            = [aws_security_group.alb.id]
  idle_timeout               = 300 # SSE streams and connector WebSockets (connector pings every 25s)
  drop_invalid_header_fields = true
  enable_deletion_protection = var.env == "prod"
  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    enabled = true
  }
  depends_on = [aws_s3_bucket_policy.alb_logs]
}

resource "aws_lb_target_group" "api" {
  name        = "martian-${var.env}-api"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = module.vpc.vpc_id
  health_check {
    path    = "/readyz"
    matcher = "200"
  }
  deregistration_delay = 30
}

resource "aws_lb_target_group" "gateway" {
  name        = "martian-${var.env}-gateway"
  port        = 8787
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = module.vpc.vpc_id
  health_check {
    path    = "/healthz"
    matcher = "200"
  }
  deregistration_delay = 10
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.martian.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.martian.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"detail\":\"not found\"}"
      status_code  = "404"
    }
  }
}

# /internal/* is service-to-service only (gateway → api over Service Connect) and is
# also guarded by the internal token; never route it from the internet.
resource "aws_lb_listener_rule" "api_internal_deny" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 5
  condition {
    host_header { values = ["api.${var.domain}"] }
  }
  condition {
    path_pattern { values = ["/internal/*", "/internal"] }
  }
  action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"detail\":\"not found\"}"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    host_header { values = ["api.${var.domain}"] }
  }
  dynamic "condition" {
    for_each = length(var.allowed_admin_cidrs) > 0 ? [1] : []
    content {
      source_ip { values = var.allowed_admin_cidrs }
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# Only the connector WebSocket is public on the gateway; /mcp/* stays internal.
resource "aws_lb_listener_rule" "connect" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  condition {
    host_header { values = ["connect.${var.domain}"] }
  }
  condition {
    path_pattern { values = ["/connect"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

resource "aws_route53_record" "alb" {
  for_each = toset(["api", "connect"])
  zone_id  = data.aws_route53_zone.zone.zone_id
  name     = "${each.key}.${var.domain}"
  type     = "A"
  alias {
    name                   = aws_lb.martian.dns_name
    zone_id                = aws_lb.martian.zone_id
    evaluate_target_health = true
  }
}

resource "aws_wafv2_web_acl" "api" {
  name  = "martian-${var.env}"
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  rule {
    name     = "aws-common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Chat messages and integration configs legitimately exceed 8 KB bodies.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }
  rule {
    name     = "login-rate-limit"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/auth/login"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "login-rate-limit"
      sampled_requests_enabled   = true
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "martian"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.martian.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}
