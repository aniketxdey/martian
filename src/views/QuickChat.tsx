import React, { useEffect, useMemo, useState } from 'react';
import { LIVE } from '../app/env';
import { Link } from '../app/router';
import { useApp } from '../app/store';
import { ChatMessage, chatPrefill, useChat } from '../app/useChat';
import { ago, IntegrationLogo, StatusPill } from '../components/bits';
import { Composer, Conversation } from '../components/chat/ChatPanel';
import { integrationOfTool } from '../state/chatRuns';
import { PageHeader } from '../shell/AppShell';
import { IconArrowRight, IconCheck, IconPlus, IconShield } from '../ui/icons';
import { cx } from '../ui/kit';

const SUGGESTIONS = ['Where are we wasting money?', 'Which servers are idle?', 'Forecast the next 24 hours', 'Start a duplicate data sweep'];

const welcome = (org: string): ChatMessage => ({
  id: 'welcome', type: 'ai', at: Date.now(),
  content: `I can see everything ${org} has connected to Martian. Ask where the money goes or what a service will need tomorrow, and I'll send agents to check before I answer.\n\nI won't change anything without asking you first.`,
  quickActions: [{ text: 'Where are we wasting money?', action: 'Where are we wasting money?' }, { text: 'What do we run?', action: 'What do we run?' }],
});

function RunPanel({ chat }: { chat: ReturnType<typeof useChat> }) {
  const session = useApp((s) => (chat.runSession ? s.sessions.find((x) => x.id === chat.runSession) ?? null : null));
  const now = useApp((s) => Math.floor(s.now / 10000) * 10000);
  const used = [...new Set(chat.run.map((r) => integrationOfTool(r.tool)).filter((x): x is string => !!x))];
  const hasRun = chat.messages.some((m) => m.type === 'user');
  return (
    <aside aria-label="Agent run" className="box-border flex min-w-0 max-w-full flex-[1_1_320px] flex-col gap-5 border-l border-line bg-canvas p-6 lg:w-[340px] lg:flex-none lg:overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-15 font-semibold">This run</h2>
        {chat.isTyping ? <StatusPill status="running" /> : chat.pending ? <StatusPill status="waiting" /> : hasRun ? <StatusPill status="completed" /> : <span className="text-xs text-fg-faint">Idle</span>}
      </div>
      {hasRun ? (
        chat.run.length === 0 ? (
          <p className="m-0 text-sm leading-normal text-fg-muted">{chat.isTyping ? 'Planning which agents to send…' : 'Answered from what Martian already knew. No tools needed.'}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {chat.run.map((s, i) => (
              <li key={s.id ?? `${s.tool}-${i}`} className="flex animate-fade-up gap-3 py-2.5">
                <span className={cx('mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full text-white', s.status === 'done' ? 'bg-ok' : s.status === 'failed' ? 'bg-danger' : 'animate-pulse bg-idle')}>
                  <IconCheck size={12} strokeWidth={3} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="break-all font-mono text-xs text-fg-muted">{s.detail}</span>
                </div>
                <span className="font-mono text-xs text-fg-faint">{s.status === 'pending' ? '…' : s.seconds != null ? `${s.seconds}s` : ''}</span>
              </li>
            ))}
          </ol>
        )
      ) : (
        <p className="m-0 text-sm leading-normal text-fg-muted">Each tool call an agent makes shows up here while it works, so you can see how an answer was put together.</p>
      )}
      {session && (
        <Link to={`/agents/${session.id}`} className="group flex items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-13 font-medium text-fg-2 no-underline hover:border-accent">
          Open the full trace and map
          <IconArrowRight size={15} className="text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
        </Link>
      )}
      {used.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="m-0 text-13 font-semibold text-fg-body">Integrations it used</h3>
          <div className="flex flex-wrap gap-2">
            {used.map((x) => <Link key={x} to="/integrations" className="no-underline"><IntegrationLogo id={x} size={30} /></Link>)}
          </div>
        </div>
      )}
      {LIVE && chat.threads.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="m-0 text-13 font-semibold text-fg-body">Recent conversations</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {chat.threads.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-current={t.id === chat.activeThread ? 'true' : undefined}
                  disabled={chat.isTyping}
                  onClick={() => void chat.openThread(t.id)}
                  className={cx('flex w-full items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left text-13 disabled:opacity-60', t.id === chat.activeThread ? 'border-line-strong bg-surface text-fg' : 'border-transparent text-fg-2 hover:bg-surface')}
                >
                  <span className="min-w-0 truncate">{t.title}</span>
                  <span className="flex-none font-mono text-xs text-fg-faint">{ago(now, new Date(t.updated_at).getTime())}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="m-0 mt-auto flex gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-13 leading-normal text-fg-body">
        <IconShield size={16} className="mt-0.5 flex-none text-ok" />
        Anything that changes infrastructure stops and waits for your approval, and every call lands in the audit log.
      </p>
    </aside>
  );
}

export const QuickChat = () => {
  const org = useApp((s) => s.user.org);
  const welcomeMsg = useMemo(() => welcome(org), [org]);
  // "Ask about this" on other pages lands here with the question ready to go.
  const [ask] = useState(() => chatPrefill.take());
  const chat = useChat({ persistKey: 'martian.chat.thread', context: { kind: 'quick' }, welcome: welcomeMsg, restore: !ask });
  const [panel, setPanel] = useState(true);
  useEffect(() => {
    if (ask) void chat.handleSendMessage(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        title="Quick Chat"
        meta={<span className="font-mono text-xs text-fg-muted max-sm:hidden">{org}</span>}
        actions={<>
          <button type="button" onClick={chat.reset} className="flex h-[38px] items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-13 text-fg-2 hover:border-fg-faint"><IconPlus size={14} />New chat</button>
          <button type="button" aria-pressed={panel} onClick={() => setPanel((v) => !v)} className={cx('h-[38px] rounded-lg border px-3 text-13', panel ? 'border-fg-faint bg-chip text-fg' : 'border-line-strong bg-surface text-fg-2')}>Run panel</button>
        </>}
      />
      <div className="flex flex-1 flex-wrap items-stretch bg-surface lg-app-h lg:flex-none lg:flex-nowrap">
        <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-[999_1_520px] flex-col">
          <div className="min-h-0 flex-1 scrollbar-thin lg:overflow-y-auto">
            <Conversation chat={chat} />
          </div>
          <div className="box-border border-t border-line px-10 pb-6 pt-4 max-sm:px-4">
            <Composer chat={chat} placeholder="Ask about spend or tomorrow's load…" scope="All environments · changes need approval" suggestions={SUGGESTIONS} autoFocus />
          </div>
        </section>
        {panel && <RunPanel chat={chat} />}
      </div>
    </>
  );
};
