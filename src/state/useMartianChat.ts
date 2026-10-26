// Chat engine moved verbatim from components/MartianAIChat.tsx.
// Intent analysis, responses and timing are unchanged; only the JSX was replaced.
import React, { useState, useEffect, useRef } from 'react';

export interface Message {
  id: number | string;
  type: 'user' | 'ai';
  content: string;
  timestamp: string;
  quickActions?: QuickAction[];
  urgent?: boolean;
  showCredentialForm?: string;
  showChart?: boolean;
  showNavigation?: boolean;
  isNavigation?: boolean;
}

export interface QuickAction {
  text: string;
  action: string;
}

export interface HistoryItem {
  step: string;
  context: any;
  timestamp: number;
}

export interface CostAnalysisData {
  dailySavings: number;
  monthlyPotential: number;
  cloudCosts: { aws: number; azure: number; gcp: number };
  onPremiseCosts: number;
  duplicatedDataCosts: number;
  vmOptimization: number;
  hasAnalyzedCosts: boolean;
}

export interface ConversationContext {
  infrastructureType: 'cloud' | 'onpremise' | 'hybrid' | null;
  cloudProvider: 'aws' | 'azure' | 'gcp' | 'multicloud' | null;
  connectedSystems: string[];
  analysisGoals: string[];
  currentStep: string;
  conversationHistory: HistoryItem[];
  costAnalysis: CostAnalysisData;
      sampleData: any;
}

export const useMartianChat = (showWelcome: boolean = true) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [conversationContext, setConversationContext] = useState<ConversationContext>({
    infrastructureType: null,
    cloudProvider: null,
    connectedSystems: [],
    analysisGoals: [],
    currentStep: 'discovery',
    conversationHistory: [],
    costAnalysis: {
      dailySavings: 0,
      monthlyPotential: 0,
      cloudCosts: { aws: 0, azure: 0, gcp: 0 },
      onPremiseCosts: 0,
      duplicatedDataCosts: 0,
      vmOptimization: 0,
      hasAnalyzedCosts: false
    },
    sampleData: {
      aws: {
        accountId: '123456789012',
        region: 'us-east-1',
        monthlyBill: 28500,
        resources: {
          ec2Instances: 156,
          unusedInstances: 47,
          ebsVolumes: 89,
          unattachedVolumes: 23,
          rdsInstances: 12,
          overProvisionedRds: 8,
          loadBalancers: 15,
          idleLoadBalancers: 5,
          s3Buckets: 34,
          unusedBuckets: 7
        }
      },
      azure: {
        subscriptionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        region: 'East US',
        monthlyBill: 22300,
        resources: {
          virtualMachines: 98,
          idleVms: 28,
          disks: 145,
          unattachedDisks: 34,
          sqlDatabases: 8,
          overProvisionedSql: 5,
          appGateways: 6,
          unusedGateways: 2,
          storageAccounts: 18,
          redundantStorage: 6
        }
      },
      gcp: {
        projectId: 'enterprise-project-384721',
        region: 'us-central1',
        monthlyBill: 19800,
        resources: {
          computeInstances: 73,
          stoppedInstances: 19,
          persistentDisks: 112,
          unattachedDisks: 27,
          cloudSqlInstances: 6,
          underutilizedSql: 4,
          loadBalancers: 8,
          unusedBalancers: 3,
          storageBuckets: 25,
          duplicateStorage: 8
        }
      },
      onPremise: {
        physicalServers: 45,
        totalVms: 312,
        avgCpuUtilization: 35,
        avgMemoryUtilization: 42,
        powerCostPerMonth: 8500,
        maintenanceCostPerMonth: 12000,
        underutilizedServers: 18,
        vmDensityOptimization: 85
      }
    }
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (showWelcome) {
      // Enterprise welcome message
      const initialMessage: Message = {
        id: 1,
        type: 'ai',
        content: `🤖 Hello! I'm Martian, your intelligent infrastructure optimization assistant.

I can help you with:
• 💰 Cost optimization - Find wasteful spending and calculate savings
• 🔒 Security analysis - Assess your infrastructure security posture  
• ⚡ Performance optimization - Improve resource utilization
• 📊 Compliance assessment - Check against industry standards

What would you like me to help you with today?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        quickActions: [
          { text: '💰 Reduce infrastructure costs', action: 'cost-optimization' },
          { text: '🔒 Improve security posture', action: 'security-analysis' },
          { text: '⚡ Optimize performance', action: 'performance-optimization' },
          { text: '📊 Compliance assessment', action: 'compliance-check' }
        ]
      };
      setMessages([initialMessage]);
    }
  }, [showWelcome]);

  const updateContext = (updates: Partial<ConversationContext>) => {
    setConversationContext(prev => ({
      ...prev,
      ...updates,
      conversationHistory: [...prev.conversationHistory, { 
        step: prev.currentStep, 
        context: { ...prev },
        timestamp: Date.now()
      }]
    }));
  };

  const analyzeUserIntent = (message: string) => {
    const lowerMessage = message.toLowerCase();
    
    // Intent analysis patterns
    const intents = {
      cost: ['cost', 'save', 'money', 'budget', 'expense', 'bill', 'waste', 'optimize', 'reduce'],
      security: ['security', 'secure', 'vulnerability', 'compliance', 'audit', 'breach', 'risk'],
      performance: ['performance', 'slow', 'latency', 'speed', 'optimize', 'improve', 'fast'],
      monitoring: ['monitor', 'alert', 'dashboard', 'metrics', 'observability'],
      migration: ['migrate', 'move', 'transfer', 'cloud', 'modernize'],
      infrastructure: ['infrastructure', 'server', 'network', 'database', 'storage']
    };

    const cloudProviders = {
      aws: ['aws', 'amazon', 'ec2', 's3', 'lambda'],
      azure: ['azure', 'microsoft', 'vm', 'blob', 'functions'],
      gcp: ['gcp', 'google', 'compute', 'storage', 'cloud functions'],
      multicloud: ['multi', 'multiple', 'hybrid', 'all providers']
    };

    const infraTypes = {
      cloud: ['cloud', 'aws', 'azure', 'gcp', 'saas'],
      onpremise: ['on-premise', 'physical', 'bare metal', 'datacenter', 'server room'],
      hybrid: ['hybrid', 'mixed', 'both', 'combination']
    };

    // Detect primary intent
    let primaryIntent: string | null = null;
    let maxMatches = 0;
    
    Object.entries(intents).forEach(([intent, keywords]) => {
      const matches = keywords.filter(keyword => lowerMessage.includes(keyword)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        primaryIntent = intent;
      }
    });

    // Detect infrastructure type
    let infraType: string | null = null;
    Object.entries(infraTypes).forEach(([type, keywords]) => {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        infraType = type;
      }
    });

    // Detect cloud provider
    let cloudProvider: string | null = null;
    Object.entries(cloudProviders).forEach(([provider, keywords]) => {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        cloudProvider = provider;
      }
    });

    return { primaryIntent, infraType, cloudProvider };
  };

  const generateCostAnalysisResponse = (context: ConversationContext) => {
    const { sampleData } = context;
    
    // Calculate realistic savings based on infrastructure analysis
    let savings = {
      cloudOptimization: 0,
      vmConsolidation: 0,
      dataDuplication: 0,
      onPremiseEfficiency: 0
    };
    
    // AWS Savings Calculation
          const aws = sampleData.aws;
    savings.cloudOptimization += 
      (aws.resources.unusedInstances * 120) + // $120/month per unused instance
      (aws.resources.unattachedVolumes * 25) + // $25/month per unattached volume  
      (aws.resources.overProvisionedRds * 350) + // $350/month per over-provisioned RDS
      (aws.resources.idleLoadBalancers * 18); // $18/month per idle load balancer
    
    // Azure Savings Calculation  
          const azure = sampleData.azure;
    savings.cloudOptimization += 
      (azure.resources.idleVms * 95) + // $95/month per idle VM
      (azure.resources.unattachedDisks * 30) + // $30/month per unattached disk
      (azure.resources.overProvisionedSql * 280) + // $280/month per over-provisioned SQL
      (azure.resources.unusedGateways * 25); // $25/month per unused gateway
    
    // GCP Savings Calculation
          const gcp = sampleData.gcp;
    savings.cloudOptimization += 
      (gcp.resources.stoppedInstances * 85) + // $85/month per stopped instance
      (gcp.resources.unattachedDisks * 20) + // $20/month per unattached disk
      (gcp.resources.underutilizedSql * 200) + // $200/month per underutilized SQL
      (gcp.resources.unusedBalancers * 15); // $15/month per unused balancer
    
    // On-Premises VM Consolidation
          const onPrem = sampleData.onPremise;
    savings.vmConsolidation = 
      (onPrem.underutilizedServers * 450) + // $450/month per underutilized server
      (onPrem.vmDensityOptimization * 25) + // $25/month per VM consolidation opportunity
      (onPrem.powerCostPerMonth * 0.15); // 15% power savings through consolidation
    
    // Data Duplication
    savings.dataDuplication = 3200 + 1800 + 2400; // Database backups, analytics data, dev/test data
    
    // On-Premises Efficiency
    savings.onPremiseEfficiency = 
              (sampleData.onPremise.maintenanceCostPerMonth * 0.20) + // 20% maintenance optimization
        (sampleData.onPremise.powerCostPerMonth * 0.25); // 25% power optimization
    
    const totalMonthlySavings = Math.floor(Object.values(savings).reduce((sum, val) => sum + val, 0));
    const dailySavings = Math.floor(totalMonthlySavings / 30);
    
    return {
      content: `📊 Infrastructure Cost Analysis Complete

🎯 Total Potential Monthly Savings: $${totalMonthlySavings.toLocaleString()}
💰 Daily Savings: $${dailySavings.toLocaleString()}

Key Optimization Opportunities:

☁️ Multi-Cloud Optimization: $${Math.floor(savings.cloudOptimization).toLocaleString()}/month
• ${aws.resources.unusedInstances} unused AWS EC2 instances: $${aws.resources.unusedInstances * 120}/month
• ${azure.resources.idleVms} idle Azure VMs: $${azure.resources.idleVms * 95}/month  
• ${gcp.resources.stoppedInstances} stopped GCP instances: $${gcp.resources.stoppedInstances * 85}/month

🖥️ VM Consolidation: $${Math.floor(savings.vmConsolidation).toLocaleString()}/month
• ${onPrem.underutilizedServers} underutilized physical servers
• ${onPrem.vmDensityOptimization} VMs can be consolidated
• 15% power consumption reduction potential

📁 Data Duplication Elimination: $${Math.floor(savings.dataDuplication).toLocaleString()}/month
• Duplicate backups across cloud environments
• Redundant development datasets
• Multiple file copies across storage systems

🏢 Infrastructure Efficiency: $${Math.floor(savings.onPremiseEfficiency).toLocaleString()}/month
• Maintenance contract optimization (20% savings)
• Energy efficiency improvements (25% reduction)

ROI Analysis:
• Annual Savings: $${(totalMonthlySavings * 12).toLocaleString()}
• 3-Year Savings: $${(totalMonthlySavings * 36).toLocaleString()}
• Break-even: Immediate (no upfront costs)`,
      quickActions: [
                  { text: '⚡ Start Cloud Optimization', action: 'optimize-cloud' },
        { text: '🖥️ Plan VM Consolidation', action: 'consolidate-vms' },
        { text: '📁 Remove Duplicate Data', action: 'deduplicate-data' },
        { text: '📋 Generate Executive Report', action: 'executive-report' }
      ],
      urgent: false
    };
  };

  const getAIResponse = (userMessage: string) => {
    const analysis = analyzeUserIntent(userMessage);
    const lowerMessage = userMessage.toLowerCase();
    
    // Context updates based on user response
    let contextUpdates: Partial<ConversationContext> = {};
    
    if (analysis.primaryIntent) {
      if (!conversationContext.analysisGoals.includes(analysis.primaryIntent)) {
        contextUpdates.analysisGoals = [...conversationContext.analysisGoals, analysis.primaryIntent];
      }
    }
    
    if (analysis.infraType) {
      contextUpdates.infrastructureType = analysis.infraType as any;
    }
    
    if (analysis.cloudProvider) {
      contextUpdates.cloudProvider = analysis.cloudProvider as any;
    }
    
    updateContext(contextUpdates);
    
    // Generate responses based on intent
    if (analysis.primaryIntent === 'cost' || lowerMessage.includes('cost') || lowerMessage.includes('save') || lowerMessage.includes('money')) {
      return generateCostAnalysisResponse(conversationContext);
    }
    
    if (analysis.primaryIntent === 'security' || lowerMessage.includes('security')) {
      return {
        content: `🔒 Security Assessment Results

Critical Issues Found:
• 12 instances with SSH open to 0.0.0.0/0 (High Risk)
• 3 S3 buckets with public read access (Medium Risk)  
• 8 IAM users with admin privileges unused for 90+ days (Medium Risk)
• Outdated security groups allowing unrestricted access (High Risk)

Compliance Status:
• SOC 2: ⚠️ 3 violations found
• PCI DSS: ✅ Compliant  
• GDPR: ⚠️ 1 violation found
• HIPAA: ❌ 5 violations found

Security Score: 6.2/10

Recommended Actions:
• Close unnecessary ports and services
• Implement least-privilege access policies
• Enable multi-factor authentication
• Update security group configurations`,
        urgent: true,
        quickActions: [
          { text: '🔧 Auto-fix Critical Issues', action: 'fix-security' },
          { text: '📄 Generate Compliance Report', action: 'compliance-report' },
          { text: '🛡️ Implement Security Baseline', action: 'security-baseline' }
        ]
      };
    }
    
    if (analysis.primaryIntent === 'performance') {
      return {
        content: `⚡ Performance Analysis Complete

Infrastructure Performance Overview:
• Average CPU Utilization: 35% (Target: 70-80%)
• Memory Utilization: 42% (Target: 75-85%)  
• Storage IOPS: Below 60% capacity
• Network Latency: Within acceptable ranges

Optimization Opportunities:
• Right-size over-provisioned instances
• Implement auto-scaling policies
• Optimize database performance
• Consolidate underutilized resources

Performance Score: 7.1/10`,
        quickActions: [
          { text: '📈 Optimize Resource Sizing', action: 'optimize-sizing' },
          { text: '🔄 Enable Auto-Scaling', action: 'enable-autoscaling' },
          { text: '💾 Optimize Database Performance', action: 'optimize-database' }
        ],
        urgent: false
      };
    }
    
    // Default response
    return {
      content: `I understand you're asking about "${userMessage}". 

I can help you with:
• Cost optimization - Identify wasteful spending and calculate potential savings
• Security analysis - Assess your infrastructure security and compliance  
• Performance optimization - Improve resource utilization and response times
• Infrastructure planning - Strategic recommendations for growth

What specific area would you like me to focus on?`,
      quickActions: [
        { text: '💰 Analyze Costs', action: 'cost-optimization' },
        { text: '🔒 Check Security', action: 'security-analysis' },
        { text: '⚡ Optimize Performance', action: 'performance-optimization' }
      ],
      urgent: false
    };
  };

  const handleQuickAction = (action: string) => {
    const actionMap: { [key: string]: string } = {
      'cost-optimization': 'I want to reduce infrastructure costs and find savings opportunities',
      'security-analysis': 'I need to improve my infrastructure security posture',
      'performance-optimization': 'Help me optimize my infrastructure performance',
      'compliance-check': 'I need a compliance assessment for my infrastructure',
      'optimize-cloud': 'Start optimizing my cloud resources to reduce costs',
      'consolidate-vms': 'Help me plan VM consolidation to improve efficiency',
      'deduplicate-data': 'Find and remove duplicate data across my systems',
      'executive-report': 'Generate an executive summary report of optimization opportunities',
      'fix-security': 'Auto-fix the critical security issues you identified',
      'compliance-report': 'Generate a detailed compliance assessment report',
      'security-baseline': 'Help me implement a security baseline for my infrastructure',
      'optimize-sizing': 'Help me right-size my infrastructure resources',
      'enable-autoscaling': 'Set up auto-scaling policies for my resources',
      'optimize-database': 'Optimize my database performance and configuration'
    };
    
    handleSendMessage(actionMap[action] || action);
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;
    
    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      content: message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);
    
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const aiResponse = getAIResponse(message);
    const aiMessage: Message = {
      id: Date.now() + 1,
      type: 'ai',
      content: aiResponse.content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quickActions: aiResponse.quickActions,
      urgent: aiResponse.urgent
    };
    
    setIsTyping(false);
    setMessages(prev => [...prev, aiMessage]);
  };

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e) e.preventDefault();
    handleSendMessage(inputValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return {
    messages, inputValue, setInputValue, isTyping, messagesEndRef,
    handleQuickAction, handleSendMessage, handleSubmit, handleKeyPress,
  };
};
