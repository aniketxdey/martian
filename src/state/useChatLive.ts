/**
 * Live Ask Martian: the same interface as useMartianChat, backed by the LangGraph
 * agent over SSE. Adds the pending approval (a write tool call paused for a person)
 * and the tool steps of the latest run for the agent run panel.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, post, stream } from '../api/client';
import type { Message } from './useMartianChat';

export type RunStep = { id?: string; tool: string; title: string; detail: string; status: 'pending' | 'done' | 'failed'; seconds?: number };
export type PendingApproval = {
  type: 'approval';
  actions: { tool_call_id: string; tool: string; args: Record<string, unknown>; integration: string | null }[];
};
export type ThreadSummary = { id: string; title: string; updated_at: string };

// The open conversation survives navigation and reloads; "New conversation" clears it.
const THREAD_KEY = 'martian.chat.thread';
const storedThread = () => { try { return localStorage.getItem(THREAD_KEY); } catch { return null; } };
const storeThread = (id: string | null) => {
  try { if (id) localStorage.setItem(THREAD_KEY, id); else localStorage.removeItem(THREAD_KEY); } catch { /* storage disabled */ }
};

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtTs = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : now());
const title = (tool: string) => tool.replace(/^(aws|azure|gcp|vcenter|ssh|forecast)_/, '$1 · ').replace(/_/g, ' ');
const detail = (args: Record<string, unknown> = {}) =>
  Object.entries(args).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') || 'no arguments';

const WELCOME: Message = {
  id: 'welcome', type: 'ai', timestamp: now(),
  content: "I'm Martian. I can read your connected clouds and data centers, explain where money is going, forecast demand, and prepare changes for your approval. Nothing changes without a person saying yes unless an integration is set to auto-approve low-risk writes.",
  quickActions: [{ text: 'Analyze my costs', action: 'Analyze my costs' }, { text: 'Forecast next week', action: "Forecast next week's demand for my autoscaling groups" }],
};

export const useChatLive = (showWelcome = true) => {
  const [messages, setMessages] = useState<Message[]>(showWelcome ? [WELCOME] : []);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [run, setRun] = useState<RunStep[]>([]);
  const [runSeconds, setRunSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(storedThread);
  const threadId = useRef<string | null>(activeThread);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const runRef = useRef<RunStep[]>(run);
  runRef.current = run;

  useEffect(() => { messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages, isTyping, pending]);

  const setThread = (id: string | null) => {
    threadId.current = id;
    setActiveThread(id);
    storeThread(id);
  };

  const applyView = (view: { messages: any[]; pending_approval: PendingApproval | null; run: RunStep[] }, prevRun: RunStep[] = []) => {
    setMessages([...(showWelcome ? [WELCOME] : []), ...view.messages.map((m: any) => ({ ...m, timestamp: fmtTs(m.timestamp) }))]);
    setPending(view.pending_approval);
    setRun(view.run.map((s, i) => ({ ...s, title: title(s.tool), seconds: prevRun[i]?.seconds })));
  };

  const refreshThreads = useCallback(async () => {
    try { setThreads((await api<{ threads: ThreadSummary[] }>('/chat/threads')).threads); } catch { /* list is best-effort */ }
  }, []);

  /** Load a saved conversation into the chat. */
  const openThread = async (id: string) => {
    if (isTyping) return;
    setError(null);
    setRunSeconds(null);
    try {
      applyView(await api(`/chat/threads/${id}`));
      setThread(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setThread(null);
        void refreshThreads();
      } else {
        setError((e as Error).message);
      }
    }
  };

  useEffect(() => {
    if (threadId.current) void openThread(threadId.current);
    void refreshThreads();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Start a fresh conversation; earlier ones stay in the thread list. */
  const reset = () => setThread(null);

  const consume = async (path: string, body: unknown) => {
    const started = Date.now();
    let draftId = `draft-${started}`;
    setIsTyping(true);
    setError(null);
    try {
      for await (const e of stream(path, body)) {
        if (e.event === 'token') {
          const id = draftId;
          setMessages((ms) => {
            const last = ms[ms.length - 1];
            if (last?.id === id) return [...ms.slice(0, -1), { ...last, content: last.content + e.data.text }];
            return [...ms, { id, type: 'ai', content: e.data.text, timestamp: now() }];
          });
        } else if (e.event === 'tool_start') {
          // Text streamed before a tool call stays in the chat; anything after it starts a new message.
          draftId = `draft-${started}-${e.data.id}`;
          setRun((r) => (r.some((s) => s.id === e.data.id) ? r : [...r, { id: e.data.id, tool: e.data.tool, title: title(e.data.tool), detail: detail(e.data.args), status: 'pending' }]));
        } else if (e.event === 'tool_end') {
          setRun((r) => r.map((s) => (s.id === e.data.id ? { ...s, status: e.data.ok ? 'done' : 'failed', seconds: e.data.seconds } : s)));
        } else if (e.event === 'interrupt') {
          setPending(e.data);
        } else if (e.event === 'error') {
          setError(e.data.message);
        } else if (e.event === 'done') {
          applyView(e.data, runRef.current);
        }
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Your role cannot approve changes. Ask an approver or admin.' : (e as Error).message);
    } finally {
      setIsTyping(false);
      setRunSeconds(Math.round((Date.now() - started) / 1000));
      void refreshThreads();
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isTyping) return;
    setMessages((ms) => [...ms, { id: `u-${Date.now()}`, type: 'user', content: message, timestamp: now() }]);
    setInputValue('');
    setRun([]);
    try {
      if (!threadId.current) setThread((await post('/chat/threads')).id);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    await consume(`/chat/threads/${threadId.current}/messages`, { content: message });
  };

  /** Approve or decline the write tool calls the agent is waiting on. */
  const decide = async (approved: boolean, comment?: string) => {
    if (!threadId.current || !pending) return;
    setPending(null);
    await consume(`/chat/threads/${threadId.current}/resume`, { approved, comment });
  };

  const handleQuickAction = (action: string) => void handleSendMessage(action);
  const handleSubmit = (e?: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLTextAreaElement>) => {
    e?.preventDefault();
    void handleSendMessage(inputValue);
  };
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e);
  };

  return {
    messages, inputValue, setInputValue, isTyping, messagesEndRef,
    handleQuickAction, handleSendMessage, handleSubmit, handleKeyPress,
    pending, decide, run, runSeconds, error,
    threads, activeThread, openThread, reset,
  };
};
