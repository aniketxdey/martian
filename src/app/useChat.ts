/**
 * Chat with Martian. One hook for Quick Chat and the chat beside an agent session.
 * Talks to the API over SSE when live, or to the local planner in the static demo.
 * Each turn that calls tools is recorded as an agent run, which is what lights up the
 * sidebar agents panel and the Agents page while it works.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, post, stream } from '../api/client';
import { LIVE } from './env';
import type { ChatContext, ChatEvent } from './store';
import { useActions } from './store';

export type ChatMessage = {
  id: string;
  type: 'user' | 'ai';
  content: string;
  at: number;
  quickActions?: { text: string; action: string }[];
  /** Tool calls made while producing this answer (for "show tool calls"). */
  tools?: { id: string; tool: string; status: 'running' | 'done' | 'failed'; seconds?: number }[];
};
export type RunStep = { id?: string; tool: string; title: string; detail: string; status: 'pending' | 'done' | 'failed'; seconds?: number };
export type PendingApproval = { type: 'approval'; actions: { tool_call_id: string; tool: string; args: Record<string, unknown>; integration: string | null }[] };
export type ThreadSummary = { id: string; title: string; updated_at: string };

const title = (tool: string) => tool.replace(/^(aws|azure|gcp|vcenter|ssh|forecast)_/, '$1 · ').replace(/_/g, ' ');
const detail = (args: Record<string, unknown> = {}) =>
  Object.entries(args).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') || 'no arguments';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage off */ } },
};

let localThreads = 0;

/** A question another page wants Quick Chat to ask as soon as it opens. */
let prefill: string | null = null;
export const chatPrefill = {
  set: (text: string) => { prefill = text; },
  take: () => { const t = prefill; prefill = null; return t; },
};

export function useChat(opts: { persistKey?: string; context?: ChatContext; welcome?: ChatMessage | null; restore?: boolean } = {}) {
  const actions = useActions();
  const bridge = actions.chat;
  const welcome = opts.welcome ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>(welcome ? [welcome] : []);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [run, setRun] = useState<RunStep[]>([]);
  const [runSeconds, setRunSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runSession, setRunSession] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(() => (opts.persistKey && LIVE && opts.restore !== false ? store.get(opts.persistKey) : null));
  const threadId = useRef<string | null>(activeThread);
  const runId = useRef<string | null>(null);
  const runRef = useRef<RunStep[]>([]);
  runRef.current = run;
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const context = useRef(opts.context);
  context.current = opts.context;

  useEffect(() => { messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages, isTyping, pending]);

  const setThread = (id: string | null) => {
    threadId.current = id;
    setActiveThread(id);
    if (opts.persistKey && LIVE) store.set(opts.persistKey, id);
  };

  const applyView = useCallback((view: { messages: any[]; pending_approval: PendingApproval | null; run: RunStep[] }, prevRun: RunStep[] = []) => {
    setMessages((cur) => {
      const toolsById = new Map(cur.filter((m) => m.tools).map((m) => [m.content, m.tools]));
      return [
        ...(welcome ? [welcome] : []),
        ...view.messages.map((m: any) => ({
          id: String(m.id), type: m.type, content: m.content, at: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          quickActions: m.quickActions, tools: toolsById.get(m.content),
        })),
      ];
    });
    setPending(view.pending_approval);
    setRun(view.run.map((s, i) => ({ ...s, title: title(s.tool), seconds: prevRun[i]?.seconds ?? s.seconds })));
  }, [welcome]);

  const refreshThreads = useCallback(async () => {
    if (!LIVE || !opts.persistKey) return;
    try { setThreads((await api<{ threads: ThreadSummary[] }>('/chat/threads')).threads); } catch { /* best effort */ }
  }, [opts.persistKey]);

  const openThread = useCallback(async (id: string) => {
    if (!LIVE) return;
    setError(null);
    setRunSeconds(null);
    try {
      applyView(await api(`/chat/threads/${id}`));
      setThread(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setThread(null); void refreshThreads(); } else setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyView, refreshThreads]);

  useEffect(() => {
    if (threadId.current) void openThread(threadId.current);
    void refreshThreads();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setThread(null);
    setMessages(welcome ? [welcome] : []);
    setPending(null);
    setRun([]);
    setRunSeconds(null);
    setError(null);
    setRunSession(null);
  };

  /** Run one turn: consume chat events and mirror them into the agent run. */
  const consume = async (events: AsyncIterable<ChatEvent>, runTitle: string, resuming = false) => {
    const started = Date.now();
    let draftId = `draft-${started}`;
    let answer = '';
    const tools: NonNullable<ChatMessage['tools']> = [];
    setIsTyping(true);
    setError(null);
    if (!resuming || !runId.current) runId.current = bridge.beginRun(runTitle, threadId.current ?? undefined);
    const rid = runId.current;
    setRunSession(rid);
    let waiting = false;
    let failed = false;
    try {
      for await (const e of events) {
        if (e.event === 'token') {
          answer += e.data.text;
          const id = draftId;
          setMessages((ms) => {
            const last = ms[ms.length - 1];
            if (last?.id === id) return [...ms.slice(0, -1), { ...last, content: last.content + e.data.text }];
            return [...ms, { id, type: 'ai', content: e.data.text, at: Date.now(), tools: [...tools] }];
          });
        } else if (e.event === 'tool_start') {
          draftId = `draft-${started}-${e.data.id}`;
          tools.push({ id: e.data.id, tool: e.data.tool, status: 'running' });
          bridge.toolStart(rid, e.data);
          setRun((r) => (r.some((s) => s.id === e.data.id) ? r : [...r, { id: e.data.id, tool: e.data.tool, title: title(e.data.tool), detail: detail(e.data.args), status: 'pending' }]));
        } else if (e.event === 'tool_end') {
          const t = tools.find((x) => x.id === e.data.id);
          if (t) { t.status = e.data.ok ? 'done' : 'failed'; t.seconds = e.data.seconds; }
          bridge.toolEnd(rid, e.data, threadId.current ?? undefined);
          setRun((r) => r.map((s) => (s.id === e.data.id ? { ...s, status: e.data.ok ? 'done' : 'failed', seconds: e.data.seconds } : s)));
        } else if (e.event === 'interrupt') {
          waiting = true;
          setPending(e.data);
        } else if (e.event === 'error') {
          failed = true;
          setError(e.data.message);
        } else if (e.event === 'done') {
          waiting = !!e.data.pending_approval;
          applyView(e.data, runRef.current);
          // Keep the tool list on the final answer.
          setMessages((ms) => {
            const i = [...ms].reverse().findIndex((m) => m.type === 'ai');
            if (i < 0 || !tools.length) return ms;
            const k = ms.length - 1 - i;
            return ms.map((m, j) => (j === k ? { ...m, tools: [...tools] } : m));
          });
        }
      }
    } catch (e) {
      failed = true;
      setError(e instanceof ApiError && e.status === 403 ? 'Your role can’t approve changes. Ask an approver or an admin.' : (e as Error).message);
    } finally {
      setIsTyping(false);
      setRunSeconds(Math.round((Date.now() - started) / 1000));
      bridge.endRun(rid, { summary: answer || undefined, failed, waiting });
      if (!waiting) runId.current = null;
      void refreshThreads();
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isTyping) return;
    if (pending) setPending(null);
    setMessages((ms) => [...ms, { id: `u-${Date.now()}`, type: 'user', content: message, at: Date.now() }]);
    setInputValue('');
    setRun([]);
    try {
      if (!threadId.current) {
        setThread(LIVE ? (await post<{ id: string }>('/chat/threads', context.current ? { context: context.current } : {})).id : `local-${++localThreads}`);
      }
      await bridge.beforeSend();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const tid = threadId.current!;
    const events = LIVE ? (stream(`/chat/threads/${tid}/messages`, { content: message }) as AsyncIterable<ChatEvent>) : bridge.local!.send(tid, message, context.current);
    await consume(events, message);
  };

  /** Approve or decline the write tool calls the agent is waiting on. */
  const decide = async (approved: boolean, comment?: string) => {
    if (!threadId.current || !pending) return;
    setPending(null);
    await bridge.beforeSend();
    const tid = threadId.current;
    const events = LIVE ? (stream(`/chat/threads/${tid}/resume`, { approved, comment }) as AsyncIterable<ChatEvent>) : bridge.local!.resume(tid, approved);
    await consume(events, 'Approval', true);
  };

  const handleQuickAction = (action: string) => void handleSendMessage(action);

  return {
    messages, inputValue, setInputValue, isTyping, messagesEndRef, handleQuickAction, handleSendMessage,
    pending, decide, run, runSeconds, error, threads, activeThread, openThread, reset, runSession,
  };
}

export type Chat = ReturnType<typeof useChat>;
