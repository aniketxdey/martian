/** Live data source: same shape as the demo source, backed by the Martian API. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, del, patch, post, timeAgo } from '../api/client';
import type { AppData } from './useMockData';
import type { Machine, Summary, Topology, UiActivity, UiFinding } from './types';

const STATE: Record<string, UiFinding['state']> = { open: 'open', approved: 'running', running: 'running', applied: 'done', failed: 'failed' };

const toFinding = (f: any): UiFinding => ({
  id: f.id, title: f.title, description: f.description, scope: f.scope, affects: f.affects,
  impact: f.status === 'applied' ? f.realized_monthly_savings || f.est_monthly_savings : f.est_monthly_savings,
  difficulty: f.effort === 'easy' ? 'easy' : 'medium', timeToImplement: f.time_to_apply, steps: f.steps ?? [],
  state: STATE[f.status] ?? 'open', automatable: f.automatable,
});

const toMachine = (s: any): Machine => ({
  id: s.id, name: s.name, ipAddress: s.ipAddress, username: s.username, password: '',
  status: s.status, description: s.description, os: s.os,
});

const AREA: Record<string, string> = { scan: 'Discovery', finding: 'Findings', action: 'Changes', connector: 'Connector', integration: 'Integrations' };

export const useLiveData = (): AppData => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [findings, setFindings] = useState<UiFinding[]>([]);
  const [activity, setActivity] = useState<UiActivity[]>([]);
  const [topology, setTopology] = useState<Topology>({ summary: [], groups: [] });
  const [physicalMachines, setPhysicalMachines] = useState<Machine[]>([]);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<any>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [currentPath, setCurrentPath] = useState('/home');
  const [files, setFiles] = useState<any[]>([]);
  const authed = useRef(false);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      authed.current = false;
      setIsAuthenticated(false);
      setCurrentView('login');
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  };

  const load = useCallback(async () => {
    try {
      const [ov, fs, act, topo, servers] = await Promise.all([
        api('/overview'), api('/findings'), api('/activity'), api('/inventory/topology'), api('/servers'),
      ]);
      setSummary({ healthScore: ov.health_score, totalResources: ov.resources, totalAccounts: ov.accounts,
        monthlyCost: ov.monthly_cost, wasteIdentified: ov.waste_identified, lastScanAt: ov.last_scan_at });
      setFindings(fs.findings.map(toFinding));
      setActivity(act.activity.map((a: any, i: number) => ({ agent: a.agent, text: a.text, when: timeAgo(a.at),
        where: AREA[a.target_type] ?? 'All', fresh: i === 0 })));
      setTopology({ summary: topo.summary, groups: topo.groups });
      setPhysicalMachines((prev) => servers.servers.map((s: any) => {
        const local = prev.find((p) => p.id === s.id);
        return { ...toMachine(s), password: local?.password ?? '' };
      }));
    } catch (e) {
      fail(e);
    }
  }, []);

  // Restore the session, then keep the console fresh while agents work.
  useEffect(() => {
    api('/auth/me').then(() => {
      authed.current = true;
      setIsAuthenticated(true);
      setCurrentView('dashboard');
      void load();
    }).catch(() => undefined);
    const t = setInterval(() => { if (authed.current) void load(); }, 8000);
    return () => clearInterval(t);
  }, [load]);

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError('');
    try {
      await post('/auth/login', { email, password });
      authed.current = true;
      setIsAuthenticated(true);
      setCurrentView('dashboard');
      await load();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Email or password is incorrect' : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    void post('/auth/logout').catch(() => undefined);
    authed.current = false;
    setIsAuthenticated(false);
    setCurrentView('login');
    setSummary(null);
  };

  const approveFinding = async (id: string) => {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, state: 'running' } : f)));
    try {
      await post(`/findings/${id}/approve`);
    } catch (e) {
      fail(e);
    }
    void load();
  };

  const runScan = async () => {
    try {
      await post('/scans');
      await new Promise((r) => setTimeout(r, 2500));
      await load();
    } catch (e) {
      fail(e);
    }
  };

  // ---- servers (same handler names as the original app)

  const updatePhysicalMachine = (machineId: any, field: string, value: string) =>
    setPhysicalMachines((ms) => ms.map((x) => (x.id === machineId ? { ...x, [field]: value } : x)));

  const addPhysicalMachine = async () => {
    try {
      const s = await post('/servers', {});
      const machine = toMachine(s);
      setPhysicalMachines((ms) => [...ms, machine]);
      setSelectedMachine(machine);
      setShowAddMachine(true);
    } catch (e) {
      fail(e);
    }
  };

  const saveMachine = async (machine: Machine) => {
    try {
      await patch(`/servers/${machine.id}`, {
        name: machine.name, os: machine.os, ipAddress: machine.ipAddress, username: machine.username,
        description: machine.description, ...(machine.password ? { password: machine.password } : {}),
      });
    } catch (e) {
      fail(e);
    }
  };

  const deletePhysicalMachine = async (machineId: any) => {
    setPhysicalMachines((ms) => ms.filter((x) => x.id !== machineId));
    try {
      await del(`/servers/${machineId}`);
    } catch (e) {
      fail(e);
    }
  };

  const connectToMachine = async (machine: Machine) => {
    updatePhysicalMachine(machine.id, 'status', 'connecting');
    try {
      const s = await post(`/servers/${machine.id}/connect`);
      updatePhysicalMachine(machine.id, 'status', s.status);
      if (s.status !== 'connected') setError(`Failed to connect to ${machine.name}: ${s.lastError ?? 'connection failed'}`);
    } catch (e) {
      updatePhysicalMachine(machine.id, 'status', 'error');
      fail(e);
    }
  };

  const listFiles = async (machine: any, path: string) => {
    try {
      const r = await api(`/servers/${machine.id}/files?path=${encodeURIComponent(path)}`);
      setFiles(r.files ?? []);
    } catch (e) {
      setFiles([]);
      fail(e);
    }
  };

  const browseFiles = (machine: Machine) => {
    if (machine.status !== 'connected') {
      setError('Please connect to the machine first');
      return;
    }
    setSelectedMachine(machine);
    setCurrentPath('/home');
    setShowFileBrowser(true);
    void listFiles(machine, '/home');
  };

  const navigateToPath = (path: string) => {
    setCurrentPath(path);
    void listFiles(selectedMachine, path);
  };

  return {
    live: true as any,
    isAuthenticated, currentView, setCurrentView, loading, error, setError,
    summary, findings, activity, topology, approveFinding, runScan, saveMachine,
    physicalMachines: physicalMachines as any, showAddMachine, setShowAddMachine, selectedMachine, setSelectedMachine,
    showFileBrowser, setShowFileBrowser, currentPath, fileSystemData: {},
    handleLogin, handleLogout, addPhysicalMachine: addPhysicalMachine as any, updatePhysicalMachine,
    deletePhysicalMachine: deletePhysicalMachine as any, connectToMachine: connectToMachine as any,
    browseFiles: browseFiles as any, navigateToPath, getCurrentFiles: () => files,
    // Demo-only fields kept for shape compatibility.
    discoveryData: summary ? { summary } : null, setDiscoveryData: () => undefined, mockData: null,
    optimizationProgress: {}, optimizeResource: approveFinding as any,
    chatQuery: '', setChatQuery: () => undefined, chatResponse: '', handleChatQuery: async () => undefined,
  } as AppData;
};
