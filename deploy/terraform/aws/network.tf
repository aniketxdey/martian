data "aws_availability_zones" "available" { state = "available" }

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = "martian-${var.env}"
  cidr = "10.40.0.0/16"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)

  public_subnets   = ["10.40.0.0/22", "10.40.4.0/22", "10.40.8.0/22"]
  private_subnets  = ["10.40.16.0/20", "10.40.32.0/20", "10.40.48.0/20"]
  database_subnets = ["10.40.64.0/24", "10.40.65.0/24", "10.40.66.0/24"]

  enable_nat_gateway     = true
  one_nat_gateway_per_az = var.env == "prod"
  single_nat_gateway     = var.env != "prod"

  create_database_subnet_group         = true
  enable_flow_log                      = true
  create_flow_log_cloudwatch_iam_role  = true
  create_flow_log_cloudwatch_log_group = true
}

resource "aws_security_group" "alb" {
  name   = "martian-${var.env}-alb"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # connectors dial in from customer networks
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "services" {
  name   = "martian-${var.env}-services"
  vpc_id = module.vpc.vpc_id
  ingress {
    description     = "ALB to api and gateway"
    from_port       = 8000
    to_port         = 8790
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description = "Service Connect between tasks"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    self        = true
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"] # Anthropic API, WorkOS, AWS APIs, custom MCP servers
  }
}

resource "aws_security_group" "db" {
  name   = "martian-${var.env}-db"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.services.id]
  }
}
