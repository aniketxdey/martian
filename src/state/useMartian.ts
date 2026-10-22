// All app state and handlers, moved verbatim from App.tsx.
// Behavior is unchanged; views receive these values via useMartian().
import { useState } from 'react';
import { mockData, mockFileSystem } from '../data/mockData';

export const useMartian = () => {
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

  return {
    isAuthenticated, currentView, setCurrentView, loading, error, setError,
    discoveryData, optimizationProgress, chatQuery, setChatQuery, chatResponse,
    physicalMachines, showAddMachine, setShowAddMachine, selectedMachine, setSelectedMachine,
    showFileBrowser, setShowFileBrowser, currentPath, fileSystemData,
    handleLogin, handleLogout, optimizeResource, handleChatQuery,
    addPhysicalMachine, updatePhysicalMachine, deletePhysicalMachine,
    connectToMachine, browseFiles, navigateToPath, getCurrentFiles,
    setDiscoveryData, mockData,
  };
};

export type Martian = ReturnType<typeof useMartian>;
