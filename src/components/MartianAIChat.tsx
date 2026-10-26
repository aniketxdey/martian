import React, { useEffect, useState } from 'react';
import { useMartianChat, Message } from '../state/useMartianChat';
import { PendingApproval, useChatLive } from '../state/useChatLive';
import { LIVE, timeAgo } from '../api/client';
import { RUN_STEPS } from '../data/presentation';
import { IconArrowUp, IconCheck, IconPlus, IconShield, MartianMark } from '../ui/icons';
import { Badge, cx } from '../ui/kit';

/* ------------------------------------------------------------------
 * Rendering only. The chat engine (intent analysis, responses, timing)
 * lives unchanged in state/useMartianChat.ts. Response text is never
 * edited; emoji are stripped at render time and simple patterns in the
 * text (sections with $/month, bullets, savings totals) get layout.
 * ------------------------------------------------------------------ */

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
export const clean = (s: string) => s.replace(EMOJI, '').replace(/[ \t]+/g, ' ').trim();

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'cards'; items: { title: string; desc: string }[] }
  | { kind: 'stats'; items: { label: string; value: string; main?: boolean }[] }
  | { kind: 'breakdown'; rows: { title: string; amount: string; detail: string }[] }
  | { kind: 'note'; text: string };

const STAT_LABELS: [RegExp, string, boolean?][] = [
  [/^Total Potential Monthly Savings:\s*(\$[\d,]+)/i, 'Potential monthly savings', true],
  [/^Daily Savings:\s*(\$[\d,]+)/i, 'Per day'],
  [/^Annual Savings:\s*(\$[\d,]+)/i, 'Per year'],
];
const AMOUNT_SECTION = /^(.+?):\s*(\$[\d,]+)\/month$/;
const bulletText = (l: string) => (l.startsWith('•') ? clean(l.slice(1)) : null);

export function parseContent(content: string): Block[] {
  const lines = content.split('\n').map(clean);
  const blocks: Block[] = [];
  let stats: Extract<Block, { kind: 'stats' }> | null = null;
  let threeYear = '';
  let breakEven = '';

  const statFrom = (text: string) => {
    for (const [re, label, main] of STAT_LABELS) {
      const mm = text.match(re);
      if (mm) {
        if (!stats) { stats = { kind: 'stats', items: [] }; blocks.push(stats); }
        stats.items.push({ label, value: mm[1], main });
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const b = bulletText(line);
    const plain = b ?? line;

    if (statFrom(plain)) continue;
    const ty = plain.match(/^3-Year Savings:\s*(\$[\d,]+)/i);
    if (ty) { threeYear = ty[1]; continue; }
    if (/^Break-even:/i.test(plain)) { breakEven = plain; continue; }

    if (b === null) {
      const sec = line.match(AMOUNT_SECTION);
      if (sec) {
        const details: string[] = [];
        while (i + 1 < lines.length && bulletText(lines[i + 1]) !== null) details.push(bulletText(lines[++i])!);
        const last = blocks[blocks.length - 1];
        const row = { title: sec[1], amount: sec[2], detail: details.join(' · ') };
        if (last && last.kind === 'breakdown') last.rows.push(row); else blocks.push({ kind: 'breakdown', rows: [row] });
        continue;
      }
      if (line.endsWith(':')) {
        // Skip a heading whose content becomes structured layout.
        let j = i + 1; while (j < lines.length && !lines[j]) j++;
        const next = lines[j] ?? '';
        const nextPlain = bulletText(next) ?? next;
        if (AMOUNT_SECTION.test(next) || /^(Annual Savings|3-Year Savings|Break-even)/i.test(nextPlain)) continue;
        blocks.push({ kind: 'h', text: line.slice(0, -1) });
        continue;
      }
      blocks.push({ kind: 'p', text: line });
      continue;
    }

    // A run of bullets.
    const items: string[] = [b];
    while (i + 1 < lines.length && bulletText(lines[i + 1]) !== null) items.push(bulletText(lines[++i])!);
    const pairs = items.map((t) => t.match(/^(.+?)\s+-\s+(.+)$/));
    if (items.length > 1 && pairs.every(Boolean)) {
      blocks.push({ kind: 'cards', items: pairs.map((p) => ({ title: p![1], desc: p![2] })) });
    } else {
      blocks.push({ kind: 'list', items });
    }
  }
  if (threeYear || breakEven) {
    const parts = [];
    if (threeYear) parts.push(`Three-year savings: ${threeYear}.`);
    if (/immediate/i.test(breakEven)) parts.push('No upfront cost, so break-even is immediate.');
    else if (breakEven) parts.push(breakEven + '.');
    blocks.push({ kind: 'note', text: parts.join(' ') });
  }
  return blocks;
}

const Rich = ({ content }: { content: string }) => (
  <>
    {parseContent(content).map((bl, i) => {
      switch (bl.kind) {
        case 'p': return <p key={i} className="m-0">{bl.text}</p>;
        case 'h': return <h4 key={i} className="m-0 text-sm font-semibold text-fg">{bl.text}</h4>;
        case 'list': return (
          <ul key={i} className="m-0 flex list-disc flex-col gap-1 pl-5 marker:text-[#A9ACB2]">
            {bl.items.map((t, j) => <li key={j}>{t}</li>)}
          </ul>
        );
        case 'cards': return (
          <ul key={i} className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2 p-0">
            {bl.items.map((c, j) => (
              <li key={j} className="flex flex-col gap-0.5 rounded-[10px] border border-line px-3.5 py-3">
                <span className="font-medium text-fg">{c.title}</span>
                <span className="text-[13px] text-fg-muted">{c.desc}</span>
              </li>
            ))}
          </ul>
        );
        case 'stats': return (
          <div key={i} className="flex flex-wrap gap-3">
            {bl.items.map((s, j) => (
              <div key={j} className={cx('flex flex-[1_1_160px] flex-col gap-0.5 rounded-xl px-[18px] py-4', s.main ? 'flex-[1_1_200px] bg-accent-wash' : 'bg-canvas')}>
                <span className={cx('text-[13px]', s.main ? 'text-accent-ink' : 'text-fg-muted')}>{s.label}</span>
                <span className={cx('font-mono text-[28px] font-medium tracking-[-0.02em]', s.main && 'text-accent-link')}>{s.value}</span>
              </div>
            ))}
          </div>
        );
        case 'breakdown': return (
          <div key={i} className="overflow-hidden rounded-xl border border-line">
            {bl.rows.map((r, j) => (
              <div key={j} className={cx('flex justify-between gap-4 px-4 py-3.5', j < bl.rows.length - 1 && 'border-b border-line-soft')}>
                <div className="flex flex-col gap-[3px]">
                  <span className="font-medium text-fg">{r.title}</span>
                  {r.detail && <span className="text-[13px] text-fg-muted">{r.detail}</span>}
                </div>
                <span className="whitespace-nowrap font-mono font-medium">{r.amount}</span>
              </div>
            ))}
          </div>
        );
        case 'note': return <p key={i} className="m-0 text-sm text-fg-body">{bl.text}</p>;
      }
    })}
  </>
);

const AgentAvatar = () => (
  <span className="relative h-8 w-8 flex-none overflow-hidden rounded-[9px] bg-ink">
    <img src="/martian-logo.png" alt="" className="absolute max-w-none" style={{ width: 52, height: 52, left: -10, top: -10 }} />
  </span>
);

const MessageView = ({ msg, onQuickAction }: { msg: Message; onQuickAction: (a: string) => void }) => {
  if (msg.type === 'user') {
    return (
      <div className="max-w-[78%] self-end rounded-[14px_14px_4px_14px] bg-chip px-4 py-3 text-[15px] leading-[1.55]">{msg.content}</div>
    );
  }
  return (
    <div className="flex items-start gap-3.5">
      <AgentAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 text-[15px] leading-[1.6] text-fg-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-fg">Martian</span>
          <span className="font-mono text-xs text-fg-faint">{msg.timestamp}</span>
          {msg.urgent && <Badge tone="warn">Needs attention</Badge>}
        </div>
        <Rich content={msg.content} />
        {msg.quickActions && msg.quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {msg.quickActions.map((a, j) => (
              <button
                key={j}
                type="button"
                onClick={() => onQuickAction(a.action)}
                className="min-h-9 rounded-full border border-line-strong bg-white px-3.5 text-[13px] font-medium text-fg-2 hover:border-fg-faint"
              >
                {clean(a.text)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SUGGESTIONS = ['Analyze my costs', 'Security assessment', 'Optimize performance', 'Find duplicate data'];
const LIVE_SUGGESTIONS = ['Analyze my costs', 'Which VMs are idle?', "Forecast next week's demand", 'Find duplicate data'];

// Chosen once per build: the LangGraph agent over SSE when live, the scripted demo otherwise.
const useChat = LIVE ? useChatLive : useMartianChat;
type LiveChat = ReturnType<typeof useChatLive>;

/** A write tool call paused at the approval gate. Nothing runs until someone decides. */
function ApprovalCard({ pending, onDecide, busy }: { pending: PendingApproval; onDecide: (ok: boolean) => void; busy: boolean }) {
  return (
    <div role="group" aria-label="Approval needed" className="ml-[50px] flex flex-col gap-3 rounded-xl border-[1.5px] border-accent bg-accent-wash p-4 max-sm:ml-0">
      <div className="flex items-center gap-2">
        <Badge tone="accent">Needs your approval</Badge>
        <span className="text-[13px] text-fg-body">Martian wants to make {pending.actions.length === 1 ? 'a change' : `${pending.actions.length} changes`}.</span>
      </div>
      {pending.actions.map((a) => (
        <div key={a.tool_call_id} className="flex flex-col gap-1 rounded-[10px] border border-line bg-white px-3.5 py-3">
          <span className="font-mono text-[13px] text-fg">{a.tool}</span>
          {a.integration && <span className="text-xs text-fg-muted">on {a.integration}</span>}
          <code className="whitespace-pre-wrap break-all font-mono text-xs text-fg-body">{JSON.stringify(a.args)}</code>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => onDecide(true)} className="h-[38px] rounded-lg border-0 bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-60">Approve and run</button>
        <button type="button" disabled={busy} onClick={() => onDecide(false)} className="h-[38px] rounded-lg border border-line-strong bg-white px-4 text-[13px] text-fg-2 disabled:opacity-60">Decline</button>
      </div>
    </div>
  );
}

/**
 * Ask Martian view model: returns the header controls and the page body,
 * so the page can place them inside the app shell.
 */
export const useMartianChatView = ({
  prefill, onNewConversation, onOpenIntegrations,
}: { prefill?: string; onNewConversation: () => void; onOpenIntegrations: () => void }) => {
  const chat = useChat(true);
  const live = LIVE ? (chat as LiveChat) : null;
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => { if (prefill) chat.setInputValue(prefill); }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasRun = chat.messages.some((m) => m.type === 'user');

  return {
    header: (
      <button type="button" onClick={() => { live?.reset(); onNewConversation(); }} className="flex h-[38px] items-center gap-2 rounded-lg border border-line-strong bg-white px-3 text-[13px] text-fg-2">
        <IconPlus size={14} />New conversation
      </button>
    ),
    panelToggle: (
      <button type="button" aria-pressed={panelOpen} onClick={() => setPanelOpen((v) => !v)} className="h-[38px] rounded-lg border border-line-strong bg-white px-3 text-[13px] text-fg-2">
        Agent run panel
      </button>
    ),
    body: (
      <div className="flex flex-1 flex-wrap items-stretch lg:h-[calc(100vh-64px)] lg:min-h-0 lg:flex-none lg:flex-nowrap lg:overflow-hidden">
        {/* Conversation */}
        <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-[999_1_520px] flex-col">
          <div className="min-h-0 flex-1 lg:overflow-y-auto">
          <div className="mx-auto box-border flex w-full max-w-[860px] flex-col gap-7 px-10 pb-4 pt-8 max-sm:px-4">
            {chat.messages.map((msg) => <MessageView key={msg.id} msg={msg} onQuickAction={chat.handleQuickAction} />)}
            {live?.pending && <ApprovalCard pending={live.pending} busy={chat.isTyping} onDecide={(ok) => void live.decide(ok)} />}
            {live?.error && <p role="alert" className="m-0 ml-[50px] rounded-[10px] border border-danger-soft bg-white px-3.5 py-3 text-[13px] text-danger max-sm:ml-0">{live.error}</p>}
            {chat.isTyping && (
              <div className="flex items-center gap-3.5 text-sm text-fg-muted"><AgentAvatar />Martian is thinking · dispatching agents</div>
            )}
            <div ref={chat.messagesEndRef} />
          </div>
          </div>

          {/* Composer */}
          <div className="box-border border-t border-line px-10 pb-6 pt-4 max-sm:px-4">
            <form className="mx-auto flex max-w-[780px] flex-col gap-2.5" onSubmit={chat.handleSubmit}>
              <div className="flex flex-col gap-2.5 rounded-[14px] border border-line-strong bg-white py-3 pl-4 pr-3 shadow-composer">
                <label htmlFor="ask" className="sr-only-clip">Ask Martian</label>
                <textarea
                  id="ask"
                  rows={2}
                  value={chat.inputValue}
                  onChange={(e) => chat.setInputValue(e.target.value)}
                  onKeyDown={chat.handleKeyPress}
                  placeholder="Ask about costs, security, performance or a specific system…"
                  className="w-full resize-none border-0 bg-transparent text-[15px] leading-normal text-fg outline-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="rounded-md bg-chip px-2 py-1 font-mono text-xs text-fg-body">Scope: All environments · {live ? 'writes need approval' : 'read-only'}</span>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs text-fg-faint">↵ to send</span>
                    <button type="submit" aria-label="Send" disabled={chat.isTyping} className="flex h-10 w-10 items-center justify-center rounded-[10px] border-0 bg-accent text-white disabled:opacity-60">
                      <IconArrowUp />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {(live ? LIVE_SUGGESTIONS : SUGGESTIONS).map((s) => (
                  <button key={s} type="button" onClick={() => chat.setInputValue(s)} className="min-h-[34px] rounded-full border border-line bg-canvas px-3 text-[13px] text-fg-body">
                    {s}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </section>

        {/* Agent run panel */}
        {panelOpen && (
          <aside aria-label="Agent run" className="box-border flex min-w-0 max-w-full flex-[1_1_320px] flex-col gap-5 border-l border-line bg-canvas p-6 lg:w-[340px] lg:flex-none lg:overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-[15px] font-semibold">Agent run</h2>
              {chat.isTyping ? <Badge tone="accent">Running</Badge>
                : live?.pending ? <Badge tone="accent">Waiting for approval</Badge>
                : hasRun ? <Badge tone="ok">Completed{live ? (live.runSeconds != null ? ` · ${live.runSeconds}s` : '') : ' · 11s'}</Badge> : <Badge tone="neutral">Idle</Badge>}
            </div>
            {live && hasRun ? (
              live.run.length === 0 ? (
                <p className="m-0 text-sm leading-normal text-fg-muted">{chat.isTyping ? 'Planning…' : 'Answered without calling tools.'}</p>
              ) : (
                <ol className="m-0 flex list-none flex-col p-0">
                  {live.run.map((s, i) => (
                    <li key={s.id ?? `${s.tool}-${i}`} className="flex gap-3 py-2.5">
                      <span className={cx('mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full text-white', s.status === 'done' ? 'bg-ok' : s.status === 'failed' ? 'bg-danger' : 'bg-[#C9CBD0]')}>
                        <IconCheck size={12} strokeWidth={3} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium">{s.title}</span>
                        <span className="break-all font-mono text-xs text-fg-muted">{s.detail}</span>
                      </div>
                      <span className="font-mono text-xs text-fg-faint">{s.status === 'pending' ? '…' : s.seconds != null ? `${s.seconds}s` : s.status}</span>
                    </li>
                  ))}
                </ol>
              )
            ) : hasRun ? (
              <ol className="m-0 flex list-none flex-col p-0">
                {RUN_STEPS.map((s) => (
                  <li key={s.title} className="flex gap-3 py-2.5">
                    <span className={cx('mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full text-white', chat.isTyping ? 'bg-[#C9CBD0]' : 'bg-ok')}>
                      <IconCheck size={12} strokeWidth={3} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{s.title}</span>
                      <span className="font-mono text-xs text-fg-muted">{s.detail}</span>
                    </div>
                    <span className="font-mono text-xs text-fg-faint">{chat.isTyping ? '…' : s.t}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 text-sm leading-normal text-fg-muted">Ask a question and Martian will show each agent step here as it runs.</p>
            )}
            <div className="flex flex-col gap-2.5">
              <h3 className="m-0 text-[13px] font-semibold text-fg-body">Integrations used</h3>
              <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                {(live ? [...new Set(live.run.map((s) => s.tool.split('_')[0]).filter((x) => ['aws', 'azure', 'gcp', 'vcenter', 'ssh', 'forecast'].includes(x)))] : ['aws', 'azure', 'gcp', 'vcenter']).map((x) => (
                  <button key={x} type="button" onClick={onOpenIntegrations} className="rounded-md border border-line bg-white px-2 py-[5px] text-fg-2">{x}</button>
                ))}
              </div>
            </div>
            {live && live.threads.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <h3 className="m-0 text-[13px] font-semibold text-fg-body">Recent conversations</h3>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {live.threads.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        aria-current={t.id === live.activeThread ? 'true' : undefined}
                        disabled={chat.isTyping}
                        onClick={() => void live.openThread(t.id)}
                        className={cx(
                          'flex w-full items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left text-[13px] disabled:opacity-60',
                          t.id === live.activeThread ? 'border-line-strong bg-white text-fg' : 'border-transparent text-fg-2 hover:bg-white',
                        )}
                      >
                        <span className="min-w-0 truncate">{t.title}</span>
                        <span className="flex-none font-mono text-xs text-fg-faint">{timeAgo(t.updated_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="m-0 flex gap-2.5 rounded-[10px] border border-line bg-white px-3.5 py-3 text-[13px] leading-normal text-fg-body">
              <IconShield size={16} color="#15803D" className="mt-0.5 flex-none" />
              {live ? 'Write tools pause for approval. Every call is recorded in the audit log.' : 'Read-only run. No resources were changed.'}
            </p>
          </aside>
        )}
      </div>
    ),
  };
};
