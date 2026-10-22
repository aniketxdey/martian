variable "env" {
  type    = string
  default = "prod"
}
variable "region" {
  type    = string
  default = "us-east-1"
}
variable "domain" {
  description = "Apex domain in Route 53, e.g. martian-ai.com. Creates app., api. and connect. records."
  type        = string
}
variable "image_tag" {
  description = "Tag pushed to the ECR repositories by CI (usually the git SHA)."
  type        = string
}
variable "anthropic_model" {
  type    = string
  default = "claude-sonnet-5-5"
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "api_count" {
  type    = number
  default = 2
}
variable "worker_count" {
  type    = number
  default = 2
}
variable "gateway_count" {
  description = "Connectors pin to one gateway task per WebSocket; >1 needs sticky routing of /mcp calls (see docs)."
  type        = number
  default     = 1
}
variable "allowed_admin_cidrs" {
  description = "Optional allow-list for the console and API. Empty = public (behind auth)."
  type        = list(string)
  default     = []
}
