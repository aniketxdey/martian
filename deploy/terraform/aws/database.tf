resource "aws_db_parameter_group" "pg16" {
  name   = "martian-${var.env}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "martian" {
  identifier     = "martian-${var.env}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "martian"
  username = "martian_owner"
  # RDS generates and rotates the owner password in Secrets Manager.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.martian.key_id

  allocated_storage     = 50
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.martian.arn

  multi_az               = var.env == "prod"
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.pg16.name
  publicly_accessible    = false

  backup_retention_period         = 14
  deletion_protection             = var.env == "prod"
  skip_final_snapshot             = var.env != "prod"
  final_snapshot_identifier       = "martian-${var.env}-final"
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.martian.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  auto_minor_version_upgrade      = true
}
