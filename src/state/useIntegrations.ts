// Integrations state (front-end only, local React state).
// When a real backend exists, this hook is the only file to swap.
import { useMemo, useState } from 'react';
import { CATALOG, DISCOVERED_TOOLS, Integration, PermissionMode, TOOL_LOG } from '../data/integrations';

export type Transport = 'http' | 'stdio';

export const useIntegrations = () => {
  const [custom, setCustom] = useState<Integration[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CATALOG.map((c) => [c.id, c.status !== 'soon'])));
  const [toolOn, setToolOn] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    CATALOG.forEach((c) => (c.tools ?? []).forEach((t) => { m[`${c.id}.${t.name}`] = true; }));
    return m;
  });
  const [modes, setModes] = useState<Record<string, PermissionMode>>({});

  const all = useMemo(() => [...CATALOG, ...custom], [custom]);

  const modeOf = (c: Integration): PermissionMode => modes[c.id] ?? c.mode ?? 'read';
  const toolsOf = (c: Integration) => (c.tools ?? []).map((t) => ({ ...t, on: !!toolOn[`${c.id}.${t.name}`] }));
  const isOn = (c: Integration) => c.status !== 'soon' && !!enabled[c.id];

  const toggleIntegration = (id: string) => setEnabled((s) => ({ ...s, [id]: !s[id] }));
  const disconnect = (id: string) => setEnabled((s) => ({ ...s, [id]: false }));
  const toggleTool = (id: string, tool: string) => setToolOn((s) => ({ ...s, [`${id}.${tool}`]: !s[`${id}.${tool}`] }));
  const setMode = (id: string, mode: PermissionMode) => setModes((s) => ({ ...s, [id]: mode }));
  const turnOffWrites = (c: Integration) => setToolOn((s) => {
    const next = { ...s };
    (c.tools ?? []).forEach((t) => { if (t.write) next[`${c.id}.${t.name}`] = false; });
    return next;
  });

  /** Adds a custom MCP server in "Needs auth", then mock-discovers three tools. */
  const addCustom = (name: string, transport: Transport, _url = '', _authorization = '') => {
    const id = `custom-${Date.now()}`;
    const item: Integration = {
      id, cat: 'custom', mono: 'MCP', name: name.trim() || 'Custom MCP server',
      transport: transport === 'http' ? 'remote · https' : 'local · stdio', status: 'auth', mode: 'read',
      sync: 'discovering tools…', desc: 'Custom MCP server added by admin@company.com.',
      f1: 'Server URL', v1: '', f2: 'Authorization header', scope: ['All environments'], tools: [],
    };
    setCustom((s) => [...s, item]);
    setEnabled((s) => ({ ...s, [id]: true }));
    setTimeout(() => {
      setCustom((s) => s.map((x) => (x.id === id ? { ...x, tools: DISCOVERED_TOOLS, sync: 'discovered 3 tools' } : x)));
    }, 1500);
    return id;
  };

  const live = all.filter((c) => c.status !== 'soon');
  const summary = {
    connected: live.filter((c) => c.status === 'connected' && enabled[c.id]).length,
    attention: live.filter((c) => c.status === 'auth').length,
    tools: live.filter((c) => enabled[c.id]).reduce((n, c) => n + toolsOf(c).filter((t) => t.on).length, 0),
    writes: live.filter((c) => enabled[c.id] && modeOf(c) !== 'read')
      .reduce((n, c) => n + toolsOf(c).filter((t) => t.on && t.write).length, 0),
  };

  const saveConnection = async (_c: Integration, _values: Record<string, string>) => undefined;
  const test = (_id: string) => new Promise<{ ok: boolean; error: string | null }>((r) => setTimeout(() => r({ ok: true, error: null }), 1500));
  const recentCalls = async (id: string) => TOOL_LOG[id] ?? TOOL_LOG.other;

  return {
    live: false as boolean, all, summary, modeOf, toolsOf, isOn, toggleIntegration, disconnect, toggleTool, setMode, turnOffWrites, addCustom,
    saveConnection, test, recentCalls,
  };
};
