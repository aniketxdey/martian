import React, { useState } from 'react';
import { 
  Cloud, 
  Cpu, 
  HardDrive, 
  DollarSign, 
  Zap, 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp, 
  Server, 
  Database,
  Target,


  Eye,
  BarChart3,
  Copy,
  Trash2,
  FileText,
  Image,
  Video,
  Layers,
  Settings,
  Shield,
  Key,
  RefreshCw,
  Loader,
  X,
  Plus
} from 'lucide-react';
import MartianAIChat from './components/MartianAIChat';

// Custom Martian Alien Face Icon (👽 style)
const AlienFace = ({ className }) => (
  <svg 
    className={className}
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Alien head - upside down teardrop shape */}
    <path 
      d="M12 2.5C6.5 2.5 2.5 6.5 2.5 11C2.5 15 4 18 6 20C7.5 21.5 9 22.5 10.5 23C11 23.2 11.5 23.3 12 23.3C12.5 23.3 13 23.2 13.5 23C15 22.5 16.5 21.5 18 20C20 18 21.5 15 21.5 11C21.5 6.5 17.5 2.5 12 2.5Z" 
      fill="currentColor" 
      opacity="0.2"
    />
    <path 
      d="M12 2.5C6.5 2.5 2.5 6.5 2.5 11C2.5 15 4 18 6 20C7.5 21.5 9 22.5 10.5 23C11 23.2 11.5 23.3 12 23.3C12.5 23.3 13 23.2 13.5 23C15 22.5 16.5 21.5 18 20C20 18 21.5 15 21.5 11C21.5 6.5 17.5 2.5 12 2.5Z" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      fill="none"
    />
    
    {/* Large alien eyes - spaced out, moved down, more tilted inward */}
    <path d="M5.5 9C5.5 7 6.5 6 8 6C9.5 6 10.5 7 10.5 9C10.5 10.5 10 12 9.5 13C9 13.8 8.5 14.2 8 14.2C7.5 14.2 7 13.8 6.5 13C6 12 5.5 10.5 5.5 9Z" fill="currentColor"/>
    <path d="M13.5 9C13.5 7 14.5 6 16 6C17.5 6 18.5 7 18.5 9C18.5 10.5 18 12 17.5 13C17 13.8 16.5 14.2 16 14.2C15.5 14.2 15 13.8 14.5 13C14 12 13.5 10.5 13.5 9Z" fill="currentColor"/>
    
    {/* Eye pupils */}
    <circle cx="8" cy="10" r="1" fill="white"/>
    <circle cx="16" cy="10" r="1" fill="white"/>
  </svg>
);

const MartianAIEnterprise = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [discoveryData, setDiscoveryData] = useState<any>(null);
  const [optimizationProgress, setOptimizationProgress] = useState({});
  const [chatQuery, setChatQuery] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [physicalMachines, setPhysicalMachines] = useState([
    {
      id: 1,
      name: 'Production Server 01',
      ipAddress: '192.168.1.100',
      username: 'admin',
      password: '',
      status: 'disconnected',
      description: 'Main production server',
      os: 'Ubuntu 20.04 LTS'
    }
  ]);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [currentPath, setCurrentPath] = useState('/home/admin');
  const [fileSystemData, setFileSystemData] = useState({});

  // Infrastructure summary data
  const mockData = {
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
      }
    ]
  };

  // Mock file system data for physical machines
  const mockFileSystem = {
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

  const handleLogin = async (email, password) => {
    try {
      setLoading(true);
      setError('');
      
      if (!email || !email.includes('@')) {
        throw new Error('Please enter a valid email address');
      }
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setIsAuthenticated(true);
      setDiscoveryData(mockData);
      setCurrentView('dashboard');
      
    } catch (error) {
      setError(error.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentView('login');
    setDiscoveryData(null);
  };

  const optimizeResource = async (optimizationId) => {
    try {
      setOptimizationProgress(prev => ({ ...prev, [optimizationId]: true }));
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      if (discoveryData) {
        const updatedOptimizations = discoveryData.optimizations.filter(opt => opt.id !== optimizationId);
        setDiscoveryData(prev => ({
          ...prev,
          optimizations: updatedOptimizations,
          summary: {
            ...prev.summary,
            wasteIdentified: prev.summary.wasteIdentified - (discoveryData.optimizations.find(opt => opt.id === optimizationId)?.impact || 0)
          }
        }));
      }
      
    } catch (error) {
      setError(`Optimization failed: ${error.message}`);
    } finally {
      setOptimizationProgress(prev => ({ ...prev, [optimizationId]: false }));
    }
  };

  const handleChatQuery = async () => {
    try {
      setLoading(true);
      
      const responses = {
        "duplicate": "I found 2.3TB of duplicate files across your infrastructure costing $15.6K/month. The biggest waste is marketing videos duplicated 47 times across AWS S3 and Azure Blob storage.",
        "cost": "Your infrastructure costs $156K/month with $47K in identified waste. The biggest savings come from 47 unused EC2 instances costing $12.4K/month.",
        "health": "Your infrastructure health score is 67/100. Main issues: unused resources and duplicate files across multiple cloud platforms."
      };
      
      const query = chatQuery.toLowerCase();
      let response = "I can help you understand your infrastructure costs, duplicate files, and optimization opportunities.";
      
      for (const [key, value] of Object.entries(responses)) {
        if (query.includes(key)) {
          response = value;
          break;
        }
      }
      
      setChatResponse(response);
    } catch (error) {
      setChatResponse('Sorry, I encountered an error processing your request.');
    } finally {
      setLoading(false);
    }
  };

  // Physical Machine Management Functions
  const addPhysicalMachine = () => {
    const newMachine = {
      id: Date.now(),
      name: `Server ${physicalMachines.length + 1}`,
      ipAddress: '',
      username: 'admin',
      password: '',
      status: 'disconnected',
      description: '',
      os: 'Ubuntu 20.04 LTS'
    };
    setPhysicalMachines([...physicalMachines, newMachine]);
    setSelectedMachine(newMachine);
    setShowAddMachine(true);
  };

  const updatePhysicalMachine = (machineId, field, value) => {
    setPhysicalMachines(machines => 
      machines.map(machine => 
        machine.id === machineId 
          ? { ...machine, [field]: value }
          : machine
      )
    );
  };

  const deletePhysicalMachine = (machineId) => {
    setPhysicalMachines(machines => machines.filter(machine => machine.id !== machineId));
    if (selectedMachine?.id === machineId) {
      setSelectedMachine(null);
      setShowAddMachine(false);
    }
  };

  const connectToMachine = async (machine) => {
    try {
      updatePhysicalMachine(machine.id, 'status', 'connecting');
      
      // Simulate SSH connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Authenticate user credentials
      const success = machine.password.length > 0;
      updatePhysicalMachine(machine.id, 'status', success ? 'connected' : 'error');
      
      if (!success) {
        setError(`Failed to connect to ${machine.name}: Authentication failed`);
      } else {
        // Initialize file system data for this machine
        setFileSystemData(prev => ({ ...prev, [machine.id]: mockFileSystem }));
      }
    } catch (error) {
      updatePhysicalMachine(machine.id, 'status', 'error');
      setError(`Connection failed for ${machine.name}`);
    }
  };

  const browseFiles = (machine) => {
    if (machine.status !== 'connected') {
      setError('Please connect to the machine first');
      return;
    }
    setSelectedMachine(machine);
    setCurrentPath('/home/admin');
    setShowFileBrowser(true);
  };

  const navigateToPath = (path) => {
    setCurrentPath(path);
  };

  const getCurrentFiles = () => {
    if (!selectedMachine || !fileSystemData[selectedMachine.id]) return [];
    return fileSystemData[selectedMachine.id][currentPath]?.files || [];
  };

  // Health Score Gauge Component
  const HealthScoreGauge = ({ score }) => {
    const size = 80;
    const strokeWidth = 6;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const strokeDasharray = `${circumference} ${circumference}`;
    const strokeDashoffset = circumference - (score / 100) * circumference;
    
    const getColor = (score) => {
      if (score >= 80) return '#10B981'; // green
      if (score >= 60) return '#F59E0B'; // yellow/orange
      return '#EF4444'; // red
    };

    return (
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg 
          className="transform -rotate-90" 
          width={size} 
          height={size}
        >
          {/* Background circle */}
          <circle
            stroke="#E5E7EB"
            fill="transparent"
            strokeWidth={strokeWidth}
            r={radius}
            cx={size / 2}
            cy={size / 2}
          />
          {/* Progress circle */}
          <circle
            stroke={getColor(score)}
            fill="transparent"
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            r={radius}
            cx={size / 2}
            cy={size / 2}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-xl font-bold text-gray-900">{score}</div>
            <div className="text-xs text-gray-500 leading-none">Health</div>
          </div>
        </div>
      </div>
    );
  };

  // File Browser Component
  const FileBrowser = () => {
    const files = getCurrentFiles();
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 max-w-4xl w-full mx-4 max-h-96 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                File Browser - {selectedMachine?.name}
              </h3>
              <p className="text-sm text-gray-600">
                {selectedMachine?.ipAddress} - {currentPath}
              </p>
            </div>
            <button
              onClick={() => setShowFileBrowser(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <div className="grid grid-cols-12 gap-4 text-sm font-medium text-gray-700">
                <div className="col-span-6">Name</div>
                <div className="col-span-2">Size</div>
                <div className="col-span-4">Modified</div>
              </div>
            </div>
            
            <div className="max-h-60 overflow-y-auto">
              {files.map((file, index) => (
                <div 
                  key={index}
                  className="px-4 py-3 border-b hover:bg-gray-50 cursor-pointer grid grid-cols-12 gap-4 items-center"
                  onClick={() => {
                    if (file.type === 'directory' && file.path) {
                      navigateToPath(file.path);
                    }
                  }}
                >
                  <div className="col-span-6 flex items-center space-x-2">
                    {file.type === 'directory' ? (
                      <HardDrive className="w-4 h-4 text-blue-500" />
                    ) : (
                      <FileText className="w-4 h-4 text-gray-500" />
                    )}
                    <span className="text-sm text-gray-900">{file.name}</span>
                  </div>
                  <div className="col-span-2 text-sm text-gray-600">
                    {file.size || '-'}
                  </div>
                  <div className="col-span-4 text-sm text-gray-600">
                    {file.modified || '-'}
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-4 flex justify-end space-x-3">
            <button
              onClick={() => setShowFileBrowser(false)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Login View
  const LoginView = () => {
    const [email, setEmail] = useState('admin@company.com');
    const [password, setPassword] = useState('admin123');

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-500 via-orange-500 to-red-600 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-r from-red-500 to-orange-500 rounded-full mx-auto mb-4"></div>
            <h1 className="text-3xl font-bold text-gray-900">Martian</h1>
            <p className="text-gray-600">Infrastructure Intelligence from Another World</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={(e) => {
            e.preventDefault();
            handleLogin(email, password);
          }}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="admin@company.com"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Enter your password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-red-500 to-orange-500 text-white py-3 rounded-lg hover:from-red-600 hover:to-orange-600 transition-all disabled:opacity-50 font-semibold"
              >
                {loading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </div>
                ) : 'Sign In'}
              </button>
            </div>
          </form>


        </div>
      </div>
    );
  };

  // Dashboard View
  const DashboardView = () => {
    if (!discoveryData) {
      return (
        <div className="text-center py-12">
          <Server className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">No Infrastructure Data</h3>
          <p className="text-gray-600 mb-6">Start by scanning your infrastructure to see optimization opportunities</p>
          <button
            onClick={() => setCurrentView('setup')}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-lg hover:from-red-600 hover:to-orange-600 transition-all"
          >
            Start Infrastructure Scan
          </button>
        </div>
      );
    }

    const summary = discoveryData.summary;
    const opportunities = discoveryData.optimizations || [];

    return (
      <div className="space-y-6">
        {/* Hero Section */}
        <div className="bg-gradient-to-r from-red-500 via-orange-500 to-red-600 text-white p-8 rounded-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Infrastructure Overview</h1>
              <p className="text-lg opacity-90">Real-time analysis of your enterprise infrastructure</p>
            </div>
            <div className="flex items-center space-x-4">
              <AlienFace className="w-12 h-12 opacity-80" />
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Infrastructure Health</p>
                <p className="text-2xl font-bold text-gray-900">{summary.healthScore}/100</p>
              </div>
              <HealthScoreGauge score={summary.healthScore} />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Monthly Costs</p>
                <p className="text-2xl font-bold text-gray-900">${(summary.monthlyCost/1000).toFixed(0)}K</p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Waste Identified</p>
                <p className="text-2xl font-bold text-red-600">${(summary.wasteIdentified/1000).toFixed(0)}K</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Resources</p>
                <p className="text-2xl font-bold text-gray-900">{summary.totalResources.toLocaleString()}</p>
              </div>
              <Server className="w-8 h-8 text-green-500" />
            </div>
          </div>
        </div>

        {/* Optimization Opportunities */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Optimization Opportunities</h2>
              <div className="flex items-center space-x-2">
                <Target className="w-5 h-5 text-orange-500" />
                <span className="text-sm text-gray-600">{opportunities.length} opportunities found</span>
              </div>
            </div>
            
            <div className="space-y-4">
              {opportunities.map((opportunity) => (
                <div key={opportunity.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        {opportunity.type === 'compute' && <Cpu className="w-5 h-5 text-blue-500" />}
                        {opportunity.type === 'storage' && <HardDrive className="w-5 h-5 text-green-500" />}
                        {opportunity.type === 'database' && <Database className="w-5 h-5 text-purple-500" />}
                        <h3 className="font-semibold text-gray-900">{opportunity.title}</h3>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          opportunity.difficulty === 'easy' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {opportunity.difficulty === 'easy' ? 'Quick Win' : 'Review Needed'}
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm mb-2">{opportunity.description}</p>
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>💰 ${opportunity.impact.toLocaleString()}/month savings</span>
                        <span>⏱️ {opportunity.timeToImplement}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => optimizeResource(opportunity.id)}
                      disabled={optimizationProgress[opportunity.id]}
                      className="ml-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {optimizationProgress[opportunity.id] ? (
                        <div className="flex items-center space-x-2">
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>Optimizing...</span>
                        </div>
                      ) : 'Optimize Now'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Infrastructure Map View
  const InfrastructureMapView = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Infrastructure Topology</h2>
          <p className="text-gray-600">Complete view of physical machines, virtual environments, cloud resources, and laboratory systems</p>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-96">
            {/* Cloud Infrastructure */}
            <div className="relative bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 border-2 border-red-200">
              <div className="bg-gradient-to-r from-red-500 to-red-600 text-white p-3 rounded-lg mb-4 text-center font-bold">
                ☁️ Cloud Infrastructure
              </div>
              <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs font-bold">
                $45K/mo
              </div>
              
              <div className="space-y-3">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">AWS Production</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Cpu className="w-4 h-4 mr-2 text-blue-500"/>Web Servers</span>
                      <span className="text-blue-600">15x t3.large</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Database className="w-4 h-4 mr-2 text-purple-500"/>RDS PostgreSQL</span>
                      <span className="text-green-600">Multi-AZ</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{width: '67%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Azure Production</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Server className="w-4 h-4 mr-2 text-blue-500"/>App VMs</span>
                      <span className="text-blue-600">8x D4s_v3</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Layers className="w-4 h-4 mr-2 text-red-500"/>AKS Cluster</span>
                      <span className="text-green-600">12 nodes</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-orange-500 h-2 rounded-full" style={{width: '78%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Google Cloud</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Cpu className="w-4 h-4 mr-2 text-blue-500"/>Compute VMs</span>
                      <span className="text-blue-600">6x n2-standard-4</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{width: '34%'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Data Center Infrastructure */}
            <div className="relative bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border-2 border-green-200">
              <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-3 rounded-lg mb-4 text-center font-bold">
                🏭 Primary Data Center
              </div>
              <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded-full text-xs font-bold">
                $78K/mo
              </div>
              
              <div className="space-y-3">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Rack 1 - Production</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Server className="w-4 h-4 mr-2 text-green-500"/>Dell R750</span>
                      <span className="text-blue-600">128GB RAM</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Cpu className="w-4 h-4 mr-2 text-blue-500"/>VMware VMs</span>
                      <span className="text-green-600">24 VMs</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-red-500 h-2 rounded-full" style={{width: '89%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Database Cluster</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Server className="w-4 h-4 mr-2 text-green-500"/>HPE DL380</span>
                      <span className="text-blue-600">256GB RAM</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Database className="w-4 h-4 mr-2 text-purple-500"/>Oracle RAC</span>
                      <span className="text-green-600">HA Cluster</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-yellow-500 h-2 rounded-full" style={{width: '67%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Storage</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><HardDrive className="w-4 h-4 mr-2 text-purple-500"/>NetApp FAS8300</span>
                      <span className="text-blue-600">50TB</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-purple-500 h-2 rounded-full" style={{width: '73%'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Development Labs */}
            <div className="relative bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border-2 border-orange-200">
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-3 rounded-lg mb-4 text-center font-bold">
                🧪 Development Labs
              </div>
              <div className="absolute top-2 right-2 bg-orange-500 text-white px-2 py-1 rounded-full text-xs font-bold">
                $23K/mo
              </div>
              
              <div className="space-y-3">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">AI/ML Research</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Zap className="w-4 h-4 mr-2 text-yellow-500"/>NVIDIA DGX</span>
                      <span className="text-blue-600">8x A100</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><AlienFace className="w-4 h-4 mr-2 text-red-500"/>Jupyter VMs</span>
                      <span className="text-green-600">15 active</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-red-500 h-2 rounded-full" style={{width: '92%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">DevOps Testing</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Layers className="w-4 h-4 mr-2 text-red-500"/>K8s Cluster</span>
                      <span className="text-blue-600">6 nodes</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Settings className="w-4 h-4 mr-2 text-gray-500"/>Jenkins</span>
                      <span className="text-green-600">8 agents</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-yellow-500 h-2 rounded-full" style={{width: '45%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Security & QA</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Shield className="w-4 h-4 mr-2 text-red-500"/>Pen Test VMs</span>
                      <span className="text-blue-600">12 isolated</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><CheckCircle className="w-4 h-4 mr-2 text-green-500"/>QA Suites</span>
                      <span className="text-green-600">20 VMs</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{width: '56%'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Edge Computing */}
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border-2 border-purple-200">
              <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-3 rounded-lg mb-4 text-center font-bold">
                🌐 Edge & Remote Sites
              </div>
              <div className="absolute top-2 right-2 bg-purple-500 text-white px-2 py-1 rounded-full text-xs font-bold">
                $12K/mo
              </div>
              
              <div className="space-y-3">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Branch Office NYC</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Server className="w-4 h-4 mr-2 text-green-500"/>Micro DC</span>
                      <span className="text-blue-600">NUC cluster</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Cpu className="w-4 h-4 mr-2 text-blue-500"/>Local Apps</span>
                      <span className="text-green-600">6 VMs</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{width: '78%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">IoT & CDN</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Zap className="w-4 h-4 mr-2 text-yellow-500"/>IoT Gateways</span>
                      <span className="text-blue-600">25 devices</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Cloud className="w-4 h-4 mr-2 text-blue-500"/>CDN Nodes</span>
                      <span className="text-green-600">12 locations</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-purple-500 h-2 rounded-full" style={{width: '67%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <h4 className="font-semibold text-gray-800 mb-2">Remote Work</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><Eye className="w-4 h-4 mr-2 text-blue-500"/>VDI</span>
                      <span className="text-blue-600">150 desktops</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center"><HardDrive className="w-4 h-4 mr-2 text-purple-500"/>DR Storage</span>
                      <span className="text-green-600">100TB</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{width: '82%'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Infrastructure Statistics */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white p-6 rounded-xl mt-6">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-6 text-center">
              <div>
                <div className="text-3xl font-bold text-blue-400">847</div>
                <div className="text-sm text-gray-300">Total VMs</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-400">156</div>
                <div className="text-sm text-gray-300">Physical Servers</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-400">25</div>
                <div className="text-sm text-gray-300">Cloud Accounts</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-red-400">$158K</div>
                <div className="text-sm text-gray-300">Monthly Cost</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-purple-400">12</div>
                <div className="text-sm text-gray-300">Lab Environments</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-yellow-400">98.7%</div>
                <div className="text-sm text-gray-300">Uptime SLA</div>
              </div>
            </div>
          </div>
          
          {/* Legend */}
          <div className="flex justify-center gap-6 mt-6 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-sm">Virtual Machines</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-500 rounded"></div>
              <span className="text-sm">Physical Servers</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-500 rounded"></div>
              <span className="text-sm">Containers/K8s</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-orange-500 rounded"></div>
              <span className="text-sm">Network Equipment</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-purple-500 rounded"></div>
              <span className="text-sm">Storage Systems</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-teal-500 rounded"></div>
              <span className="text-sm">Databases</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Chat View - Full Screen AI Chat Interface  
  const ChatView = () => (
    <div className="h-full bg-gray-50">
      <MartianAIChat 
        className="h-full w-full"
        showWelcome={true}
      />
    </div>
  );

  // Setup View
  const SetupView = () => (
    <div className="space-y-6">
      {/* Cloud Infrastructure Setup */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Cloud Infrastructure Setup</h2>
        <p className="text-gray-600 mb-6">Connect your cloud platforms for infrastructure analysis</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded-lg p-4">
            <div className="flex items-center mb-4">
              <Cloud className="w-6 h-6 text-orange-500 mr-3" />
              <h3 className="font-semibold text-gray-900">AWS</h3>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Access Key ID"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <input
                type="password"
                placeholder="Secret Access Key"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <button className="w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors">
                Connect AWS
              </button>
            </div>
          </div>
          
          <div className="border rounded-lg p-4">
            <div className="flex items-center mb-4">
              <Cloud className="w-6 h-6 text-blue-500 mr-3" />
              <h3 className="font-semibold text-gray-900">Azure</h3>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Client ID"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <input
                type="password"
                placeholder="Client Secret"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <button className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                Connect Azure
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Physical Infrastructure Setup */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Server className="w-6 h-6 text-green-500 mr-3" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Physical Infrastructure Setup</h2>
              <p className="text-gray-600">Connect to your physical servers and on-premises infrastructure</p>
            </div>
          </div>
          <button
            onClick={addPhysicalMachine}
            className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Server</span>
          </button>
        </div>

        {/* Physical Machines List */}
        <div className="space-y-4">
          {physicalMachines.map((machine) => (
            <div key={machine.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-semibold text-gray-900">{machine.name}</h4>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        machine.status === 'connected' ? 'bg-green-100 text-green-800' :
                        machine.status === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
                        machine.status === 'error' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {machine.status === 'connected' ? '🟢 Connected' :
                         machine.status === 'connecting' ? '🟡 Connecting...' :
                         machine.status === 'error' ? '🔴 Error' :
                         '⚪ Disconnected'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mb-2">
                    <div>
                      <span className="font-medium">IP:</span> {machine.ipAddress || 'Not set'}
                    </div>
                    <div>
                      <span className="font-medium">User:</span> {machine.username}
                    </div>
                    <div>
                      <span className="font-medium">OS:</span> {machine.os}
                    </div>
                  </div>
                  
                  {machine.description && (
                    <p className="text-sm text-gray-500">{machine.description}</p>
                  )}
                  
                  {!machine.ipAddress && (
                    <p className="text-sm text-amber-600">⚠️ IP address and credentials required</p>
                  )}
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setSelectedMachine(machine);
                      setShowAddMachine(true);
                    }}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-sm"
                  >
                    <Settings className="w-4 h-4 inline mr-1" />
                    Configure
                  </button>
                  
                  {machine.ipAddress && machine.password && (
                    <button
                      onClick={() => connectToMachine(machine)}
                      disabled={machine.status === 'connecting'}
                      className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors text-sm disabled:opacity-50"
                    >
                      {machine.status === 'connecting' ? (
                        <Loader className="w-4 h-4 animate-spin" />
                      ) : (
                        'Connect'
                      )}
                    </button>
                  )}
                  
                  {machine.status === 'connected' && (
                    <button
                      onClick={() => browseFiles(machine)}
                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm"
                    >
                      <Eye className="w-4 h-4 inline mr-1" />
                      Browse
                    </button>
                  )}
                  
                  {physicalMachines.length > 1 && (
                    <button
                      onClick={() => deletePhysicalMachine(machine.id)}
                      className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors text-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Physical Machine Summary */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{physicalMachines.length}</p>
              <p className="text-sm text-gray-600">Total Servers</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">
                {physicalMachines.filter(machine => machine.status === 'connected').length}
              </p>
              <p className="text-sm text-gray-600">Connected</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">
                {physicalMachines.filter(machine => !machine.ipAddress || !machine.password).length}
              </p>
              <p className="text-sm text-gray-600">Need Setup</p>
            </div>
          </div>
        </div>
      </div>

      {/* Machine Configuration Modal */}
      {showAddMachine && selectedMachine && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">
                Configure Server: {selectedMachine.name}
              </h3>
              <button
                onClick={() => {
                  setShowAddMachine(false);
                  setSelectedMachine(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={selectedMachine.name}
                    onChange={(e) => updatePhysicalMachine(selectedMachine.id, 'name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="e.g., Production Server 01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Operating System
                  </label>
                  <select
                    value={selectedMachine.os}
                    onChange={(e) => updatePhysicalMachine(selectedMachine.id, 'os', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="Ubuntu 20.04 LTS">Ubuntu 20.04 LTS</option>
                    <option value="Ubuntu 22.04 LTS">Ubuntu 22.04 LTS</option>
                    <option value="CentOS 7">CentOS 7</option>
                    <option value="CentOS 8">CentOS 8</option>
                    <option value="Red Hat Enterprise Linux 8">Red Hat Enterprise Linux 8</option>
                    <option value="Windows Server 2019">Windows Server 2019</option>
                    <option value="Windows Server 2022">Windows Server 2022</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <input
                  type="text"
                  value={selectedMachine.description}
                  onChange={(e) => updatePhysicalMachine(selectedMachine.id, 'description', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Brief description of this server"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    IP Address
                  </label>
                  <input
                    type="text"
                    value={selectedMachine.ipAddress}
                    onChange={(e) => updatePhysicalMachine(selectedMachine.id, 'ipAddress', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="192.168.1.100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={selectedMachine.username}
                    onChange={(e) => updatePhysicalMachine(selectedMachine.id, 'username', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="admin"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={selectedMachine.password}
                  onChange={(e) => updatePhysicalMachine(selectedMachine.id, 'password', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Enter SSH/RDP password"
                />
              </div>
              
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">Security Notes:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>🔐 Credentials are stored securely with encryption</li>
                  <li>🛡️ Production systems should use SSH keys or certificates</li>
                  <li>🔒 Enable firewall and restrict access to management ports</li>
                </ul>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowAddMachine(false);
                    setSelectedMachine(null);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (selectedMachine.ipAddress && selectedMachine.password) {
                      connectToMachine(selectedMachine);
                    }
                    setShowAddMachine(false);
                    setSelectedMachine(null);
                  }}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  Save & Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Browser Modal */}
      {showFileBrowser && <FileBrowser />}
        
      <div className="mt-6 text-center">
        <button
          onClick={() => {
            setDiscoveryData(mockData);
            setCurrentView('dashboard');
          }}
          className="px-6 py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-lg hover:from-red-600 hover:to-orange-600 transition-all"
        >
                        Skip Setup (Use Sample Data)
        </button>
      </div>
    </div>
  );

  // Main App Navigation
  if (!isAuthenticated) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-red-500 to-orange-500 rounded-full"></div>
              <span className="text-xl font-bold text-gray-900">Martian</span>
              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full">ENTERPRISE</span>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setCurrentView('dashboard')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  currentView === 'dashboard' 
                    ? 'bg-red-100 text-red-800' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="w-4 h-4 inline mr-2" />
                Dashboard
              </button>
              <button
                onClick={() => setCurrentView('infrastructure')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  currentView === 'infrastructure' 
                    ? 'bg-red-100 text-red-800' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Server className="w-4 h-4 inline mr-2" />
                Infrastructure
              </button>
              <button
                onClick={() => setCurrentView('chat')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  currentView === 'chat' 
                    ? 'bg-red-100 text-red-800' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <AlienFace className="w-4 h-4 inline mr-2" />
                Ask AI
              </button>
              <button
                onClick={() => setCurrentView('setup')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  currentView === 'setup' 
                    ? 'bg-red-100 text-red-800' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Settings className="w-4 h-4 inline mr-2" />
                Setup
              </button>
              <button
                onClick={handleLogout}
                className="text-gray-600 hover:text-gray-900"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className={currentView === 'chat' ? 'h-full' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}>
        {error && currentView !== 'chat' && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {currentView === 'dashboard' && <DashboardView />}
        {currentView === 'infrastructure' && <InfrastructureMapView />}
        {currentView === 'setup' && <SetupView />}
        {currentView === 'chat' && <ChatView />}
      </main>
    </div>
  );
};

export default MartianAIEnterprise;