/** Live integrations: the same interface as useIntegrations, backed by /integrations. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, del, patch, post, timeAgo } from '../api/client';
import type { Integration, PermissionMode } from '../data/integrations';
import type { Transport } from './useIntegrations';

type ApiTool = { name: string; description: string; write: boolean; enabled: boolean };
type ApiIntegration = {
  id: string; kind: string; name: string; mono: string; cat: Integration['cat']; desc: string; status: string;
  enabled: boolean; mode: PermissionMode; transport: string; config: Record<string, unknown>; has_secrets: boolean;
  external_id: string | null; tools: ApiTool[]; last_sync_at: string | null; last_error: string | null; connector: Integration['connector'];
};
type CatalogItem = { kind: string; config_fields?: { key: string; label: string; type: 'text' | 'list' | 'secret' }[] };
export type ToolCall = { t: string; agent: string; tool: string; res: string };

const STATUS: Record<string, Integration['status']> = {
  connected: 'connected', auth: 'auth', pending: 'pending', error: 'error', offline: 'offline', disabled: 'disabled',
};

/** AWS accounts are stored as {account_id, role_arn}; the form edits them as text. */
const accountText = (a: any) => (typeof a === 'object' && a ? a.role_arn ?? a.account_id ?? '' : String(a));
const parseAccount = (v: string) => (v.startsWith('arn:') ? { role_arn: v, account_id: v.split(':')[4] ?? '' } : { account_id: v });
const fieldText = (v: unknown) => (Array.isArray(v) ? v.map(accountText).join(', ') : v == null ? '' : String(v));

const scopeOf = (i: ApiIntegration): string[] => {
  const c = i.config as Record<string, any>;
  const list = (v: any) => (Array.isArray(v) ? v.map(String) : []);
  if (i.kind === 'aws') return [...(c.accounts ?? []).map((a: any) => (typeof a === 'object' ? a.account_id : String(a))), ...list(c.regions)];
  if (i.kind === 'azure') return list(c.subscription_ids);
  if (i.kind === 'gcp') return list(c.project_ids);
  if (c.url) return [String(c.url)];
  return i.connector ? [i.connector.name] : [];
};

export const useIntegrationsLive = () => {
  const [rows, setRows] = useState<ApiIntegration[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [soon, setSoon] = useState<Integration[]>([]);

  const refresh = useCallback(async () => {
    const r = await api('/integrations');
    setRows(r.integrations);
    setCatalog(r.available);
    setSoon(r.coming_soon.map((c: any) => ({ id: c.kind, cat: c.cat, mono: c.mono, name: c.name, desc: c.desc, transport: 'remote · https', status: 'soon' as const })));
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const t = setInterval(() => void refresh().catch(() => undefined), 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const all: Integration[] = useMemo(() => {
    const live = rows.map((i): Integration => {
      const fields = (catalog.find((c) => c.kind === i.kind)?.config_fields ?? []).map((f) => {
        const v = i.config[f.key];
        return { ...f, value: f.type === 'secret' ? '' : fieldText(v) };
      });
      return {
        id: i.id, cat: i.cat, mono: i.mono, name: i.name, desc: i.desc, transport: i.transport,
        status: STATUS[i.status] ?? 'pending', mode: i.mode, scope: scopeOf(i), fields, lastError: i.last_error,
        connector: i.connector, externalId: i.external_id,
        sync: i.last_error ? i.last_error.slice(0, 60) : i.last_sync_at ? `synced ${timeAgo(i.last_sync_at)}` : 'waiting for first sync',
        tools: i.tools.map((t) => ({ name: t.name, desc: t.description, write: t.write })),
      };
    });
    return [...live, ...soon];
  }, [rows, catalog, soon]);

  const row = (id: string) => rows.find((r) => r.id === id);
  const update = async (id: string, body: Record<string, unknown>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...body } as ApiIntegration : r)));
    await patch(`/integrations/${id}`, body);
    await refresh();
  };

  const modeOf = (c: Integration): PermissionMode => row(c.id)?.mode ?? c.mode ?? 'read';
  const toolsOf = (c: Integration) =>
    (row(c.id)?.tools ?? []).map((t) => ({ name: t.name, desc: t.description, write: t.write, on: t.enabled }));
  const isOn = (c: Integration) => c.status !== 'soon' && !!row(c.id)?.enabled;
  const disabledTools = (id: string) => (row(id)?.tools ?? []).filter((t) => !t.enabled).map((t) => t.name);

  const toggleIntegration = (id: string) => void update(id, { enabled: !row(id)?.enabled });
  const disconnect = (id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    void del(`/integrations/${id}`).then(refresh);
  };
  const toggleTool = (id: string, tool: string) => {
    const off = new Set(disabledTools(id));
    if (off.has(tool)) off.delete(tool); else off.add(tool);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, tools: r.tools.map((t) => ({ ...t, enabled: !off.has(t.name) })) } : r)));
    void patch(`/integrations/${id}`, { disabled_tools: [...off] }).then(refresh);
  };
  const setMode = (id: string, mode: PermissionMode) => void update(id, { mode });
  const turnOffWrites = (c: Integration) => {
    const off = new Set([...disabledTools(c.id), ...(row(c.id)?.tools ?? []).filter((t) => t.write).map((t) => t.name)]);
    setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, tools: r.tools.map((t) => ({ ...t, enabled: !off.has(t.name) })) } : r)));
    void patch(`/integrations/${c.id}`, { disabled_tools: [...off] }).then(refresh);
  };

  /** Saves connection fields: lists become arrays, secrets go to the encrypted store. */
  const saveConnection = async (c: Integration, values: Record<string, string>) => {
    const config: Record<string, unknown> = { ...(row(c.id)?.config ?? {}) };
    const secrets: Record<string, string> = {};
    for (const f of c.fields ?? []) {
      const v = values[f.key];
      if (v === undefined) continue;
      if (f.type === 'secret') { if (v) secrets[f.key] = v; } else if (f.type === 'list') {
        const items = v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
        config[f.key] = f.key === 'accounts' ? items.map(parseAccount) : items;
      }
      else config[f.key] = v.trim();
    }
    await patch(`/integrations/${c.id}`, { config, ...(Object.keys(secrets).length ? { secrets } : {}) });
    await refresh();
  };

  const test = async (id: string): Promise<{ ok: boolean; error: string | null }> => {
    const r = await post(`/integrations/${id}/test`);
    await refresh();
    return r;
  };

  const recentCalls = async (id: string): Promise<ToolCall[]> => {
    const r = await api(`/integrations/${id}`);
    return r.recent_calls.map((x: any) => ({
      t: new Date(x.at).toLocaleTimeString([], { hour12: false }), agent: x.agent, tool: x.tool, res: x.status,
    }));
  };

  const addCustom = (name: string, transport: Transport, url = '', authorization = '') => {
    void post('/integrations', {
      kind: 'custom', name: name.trim() || 'Custom MCP server', mode: 'read',
      config: transport === 'http' ? { url } : { transport: 'stdio', command: url },
      secrets: authorization ? { authorization } : {},
    }).then(async (i) => { await refresh(); if (transport === 'http' && url) await test(i.id).catch(() => undefined); });
    return '';
  };

  const active = all.filter((c) => c.status !== 'soon');
  const summary = {
    connected: active.filter((c) => c.status === 'connected' && isOn(c)).length,
    attention: active.filter((c) => ['auth', 'error', 'offline'].includes(c.status)).length,
    tools: active.filter(isOn).reduce((n, c) => n + toolsOf(c).filter((t) => t.on).length, 0),
    writes: active.filter((c) => isOn(c) && modeOf(c) !== 'read').reduce((n, c) => n + toolsOf(c).filter((t) => t.on && t.write).length, 0),
  };

  return {
    live: true as const, all, summary, modeOf, toolsOf, isOn, toggleIntegration, disconnect, toggleTool, setMode,
    turnOffWrites, addCustom, saveConnection, test, recentCalls,
  };
};
