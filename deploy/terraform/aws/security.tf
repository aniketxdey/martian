# One customer-managed key encrypts the database, secrets, logs and integration
# credentials (envelope encryption in martian.security.crypto).
resource "aws_kms_key" "martian" {
  description             = "Martian ${var.env}"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "martian" {
  name          = "alias/martian-${var.env}"
  target_key_id = aws_kms_key.martian.key_id
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "AccountAdmin"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudWatchLogs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
  }
}

resource "random_password" "session_secret" {
  length  = 64
  special = false
}
resource "random_password" "internal_token" {
  length  = 48
  special = false
}
resource "random_password" "app_db" {
  length  = 40
  special = false
}

locals {
  generated_secrets = {
    session_secret  = random_password.session_secret.result
    internal_token  = random_password.internal_token.result
    app_db_password = random_password.app_db.result
  }
}

resource "aws_secretsmanager_secret" "generated" {
  for_each   = local.generated_secrets
  name       = "martian/${var.env}/${each.key}"
  kms_key_id = aws_kms_key.martian.arn
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each      = local.generated_secrets
  secret_id     = aws_secretsmanager_secret.generated[each.key].id
  secret_string = each.value
}

# Filled in by an operator (console or CLI) after apply; never stored in Terraform state.
resource "aws_secretsmanager_secret" "external" {
  for_each   = toset(["anthropic_api_key", "workos_api_key", "workos_client_id"])
  name       = "martian/${var.env}/${each.key}"
  kms_key_id = aws_kms_key.martian.arn
}

# ECS refuses to start a task whose secret has no value, so seed a placeholder the
# app treats as "not configured". Operators overwrite it; Terraform ignores the change.
resource "aws_secretsmanager_secret_version" "external" {
  for_each      = aws_secretsmanager_secret.external
  secret_id     = each.value.id
  secret_string = "unset"
  lifecycle { ignore_changes = [secret_string] }
}
