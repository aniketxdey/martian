// Moved verbatim from App.tsx (values unchanged).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Infrastructure summary data
export const mockData: any = {
  summary: {
    healthScore: 67,
    totalResources: 1247,
    totalAccounts: 3,
    monthlyCost: 156000,
    wasteIdentified: 47300
  },
  optimizations: [
    {
      id: 'unused-ec2',
      title: 'Unused EC2 Instances',
      description: '47 EC2 instances with <5% CPU utilization',
      impact: 12400,
      type: 'compute',
      difficulty: 'easy',
      timeToImplement: '< 5 minutes'
    },
    {
      id: 'rightsize-rds',
      title: 'Over-provisioned RDS Instances',
      description: '12 database instances running at <15% capacity',
      impact: 8900,
      type: 'database',
      difficulty: 'medium',
      timeToImplement: '15 minutes'
    },
    // Added for the redesign (same shape); figures match the app's
    // "Optimization Opportunities" screen used on the marketing site.
    {
      id: 'network-costs',
      title: 'Network Cost Optimization',
      description: 'Inter-region data transfer and NAT gateway optimization',
      impact: 5600,
      type: 'network',
      difficulty: 'medium',
      timeToImplement: '20 minutes'
    },
    {
      id: 'unused-ebs',
      title: 'Unused Storage Volumes',
      description: '23 unattached EBS volumes and orphaned snapshots',
      impact: 3400,
      type: 'storage',
      difficulty: 'easy',
      timeToImplement: '< 3 minutes'
    }
  ]
};

// Mock file system data for physical machines
export const mockFileSystem: any = {
  '/home/admin': {
    type: 'directory',
    files: [
      { name: '..', type: 'directory', path: '/home' },
      { name: 'documents', type: 'directory', path: '/home/admin/documents', size: '4.0K', modified: '2024-01-15 10:30' },
      { name: 'scripts', type: 'directory', path: '/home/admin/scripts', size: '4.0K', modified: '2024-01-14 16:45' },
      { name: 'logs', type: 'directory', path: '/home/admin/logs', size: '4.0K', modified: '2024-01-16 09:15' },
      { name: '.bashrc', type: 'file', path: '/home/admin/.bashrc', size: '3.2K', modified: '2024-01-10 14:20' },
      { name: '.ssh', type: 'directory', path: '/home/admin/.ssh', size: '4.0K', modified: '2024-01-12 11:30' },
      { name: 'backup.tar.gz', type: 'file', path: '/home/admin/backup.tar.gz', size: '1.2G', modified: '2024-01-16 02:00' },
      { name: 'system_report.txt', type: 'file', path: '/home/admin/system_report.txt', size: '45K', modified: '2024-01-16 08:30' }
    ]
  },
  '/home/admin/documents': {
    type: 'directory',
    files: [
      { name: '..', type: 'directory', path: '/home/admin' },
      { name: 'server_config.md', type: 'file', path: '/home/admin/documents/server_config.md', size: '12K', modified: '2024-01-15 10:30' },
      { name: 'deployment_guide.pdf', type: 'file', path: '/home/admin/documents/deployment_guide.pdf', size: '2.1M', modified: '2024-01-14 15:20' },
      { name: 'network_diagram.png', type: 'file', path: '/home/admin/documents/network_diagram.png', size: '890K', modified: '2024-01-13 12:45' }
    ]
  },
  '/home/admin/scripts': {
    type: 'directory',
    files: [
      { name: '..', type: 'directory', path: '/home/admin' },
      { name: 'backup.sh', type: 'file', path: '/home/admin/scripts/backup.sh', size: '2.1K', modified: '2024-01-14 16:45' },
      { name: 'monitoring.py', type: 'file', path: '/home/admin/scripts/monitoring.py', size: '8.4K', modified: '2024-01-14 14:20' },
      { name: 'cleanup.sh', type: 'file', path: '/home/admin/scripts/cleanup.sh', size: '1.5K', modified: '2024-01-12 09:30' }
    ]
  },
  '/home/admin/logs': {
    type: 'directory',
    files: [
      { name: '..', type: 'directory', path: '/home/admin' },
      { name: 'system.log', type: 'file', path: '/home/admin/logs/system.log', size: '156K', modified: '2024-01-16 09:15' },
      { name: 'error.log', type: 'file', path: '/home/admin/logs/error.log', size: '23K', modified: '2024-01-16 08:45' },
      { name: 'access.log', type: 'file', path: '/home/admin/logs/access.log', size: '890K', modified: '2024-01-16 09:10' }
    ]
  }
};
