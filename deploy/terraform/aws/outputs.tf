output "console_url" { value = "https://app.${var.domain}" }
output "api_url" { value = "https://api.${var.domain}" }
output "connector_gateway_url" {
  description = "MARTIAN_GATEWAY_URL for customer connectors"
  value       = "wss://connect.${var.domain}/connect"
}
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.repo : k => r.repository_url } }
output "web_bucket" { value = aws_s3_bucket.web.id }
output "cloudfront_distribution_id" { value = aws_cloudfront_distribution.web.id }
output "ecs_cluster" { value = aws_ecs_cluster.martian.name }
output "migrate_task_definition" { value = aws_ecs_task_definition.migrate.family }
output "private_subnets" { value = module.vpc.private_subnets }
output "service_security_group" { value = aws_security_group.services.id }
output "operator_secrets" {
  description = "Set these in Secrets Manager after the first apply (value 'unset' disables the feature)."
  value       = { for k, s in aws_secretsmanager_secret.external : k => s.name }
}
