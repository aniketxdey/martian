import React, { useState, useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';

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

// Define types for better TypeScript support
interface Message {
  id: number;
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

interface QuickAction {
  text: string;
  action: string;
}

interface HistoryItem {
  step: string;
  context: any;
  timestamp: number;
}

interface CostAnalysisData {
  dailySavings: number;
  monthlyPotential: number;
  cloudCosts: { aws: number; azure: number; gcp: number };
  onPremiseCosts: number;
  duplicatedDataCosts: number;
  vmOptimization: number;
  hasAnalyzedCosts: boolean;
}

interface ConversationContext {
  infrastructureType: 'cloud' | 'onpremise' | 'hybrid' | null;
  cloudProvider: 'aws' | 'azure' | 'gcp' | 'multicloud' | null;
  connectedSystems: string[];
  analysisGoals: string[];
  currentStep: string;
  conversationHistory: HistoryItem[];
  costAnalysis: CostAnalysisData;
      sampleData: any;
}

interface MartianAIChatProps {
  className?: string;
  showWelcome?: boolean;
}

const MartianAIChat: React.FC<MartianAIChatProps> = ({ 
  className = "", 
  showWelcome = true 
}) => {
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

  return (
    <div className={`bg-white flex flex-col h-full ${className}`}>
      {/* Chat Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="max-w-4xl mx-auto flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-r from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
                                <AlienFace className="w-5 h-5 text-white" />
          </div>
          <div>
                                  <h2 className="text-lg font-bold text-gray-900">Martian</h2>
            <p className="text-sm text-gray-600">Infrastructure Optimization Assistant</p>
          </div>
          <div className="ml-auto flex items-center text-green-500 text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
            AI Active
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.type === 'ai' && (
                <div className="flex items-start space-x-4 max-w-full">
                  <div className="w-8 h-8 bg-gradient-to-r from-red-500 to-orange-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <AlienFace className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 max-w-none">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="font-semibold text-gray-900 text-sm">Martian</span>
                      <span className="text-xs text-gray-500">{message.timestamp}</span>
                      {message.urgent && (
                        <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
                          🚨 Urgent
                        </span>
                      )}
                    </div>
                    
                    <div className="whitespace-pre-line text-gray-700 text-sm leading-relaxed mb-3">
                      {message.content}
                    </div>
                    
                    {message.quickActions && (
                      <div className="flex flex-wrap gap-2">
                        {message.quickActions.map((action, index) => (
                          <button
                            key={index}
                            onClick={() => handleQuickAction(action.action)}
                            className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs transition-colors"
                          >
                            {action.text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {message.type === 'user' && (
                <div className="max-w-sm">
                  <div className="bg-red-500 text-white rounded-lg p-3 text-sm">
                    {message.content}
                  </div>
                  <div className="text-right text-xs text-gray-500 mt-1">
                    You • {message.timestamp}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {isTyping && (
            <div className="flex justify-start">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-gradient-to-r from-red-500 to-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                                          <AlienFace className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 max-w-none">
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    <span className="text-gray-600 text-sm">AI is analyzing...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="flex space-x-3">
            <div className="flex-1 relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me anything about your infrastructure..."
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
                disabled={isTyping}
                rows={1}
              />
            </div>
            <button
              onClick={() => handleSubmit()}
              disabled={isTyping || !inputValue.trim()}
              className="bg-red-500 hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl transition-colors flex items-center justify-center text-sm font-medium"
            >
              <Zap className="w-4 h-4" />
            </button>
          </div>
          
          {/* Quick suggestions */}
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            {[
              'Analyze my costs',
              'Security assessment', 
              'Optimize performance',
              'Find duplicate data'
            ].map((suggestion, index) => (
              <button
                key={index}
                onClick={() => setInputValue(suggestion)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs px-3 py-1 rounded-full border transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MartianAIChat; 