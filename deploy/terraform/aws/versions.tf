terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Configure remote state per environment, e.g.:
  # backend "s3" { bucket = "acme-tfstate" key = "martian/prod.tfstate" region = "us-east-1" use_lockfile = true }
}

provider "aws" {
  region = var.region
  default_tags { tags = { app = "martian", env = var.env } }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = { app = "martian", env = var.env } }
}
