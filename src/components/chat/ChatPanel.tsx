import React from 'react';
import { asset } from '../../app/env';
import { fmtTime, usePrefs } from '../../app/prefs';
import type { Chat, ChatMessage, PendingApproval } from '../../app/useChat';
import { IconArrowUp } from '../../ui/icons';
import { Badge, cx } from '../../ui/kit';
import { Markdown } from '../Markdown';

export const AgentAvatar = ({ size = 32 }: { size?: number }) => (
  <span className="relative flex-none overflow-hidden rounded-[9px] bg-ink" style={{ width: size, height: size }}>
    <img src={asset('martian-logo.png')} alt="" className="absolute max-w-none" style={{ width: size * 1.62, height: size * 1.62, left: -size * 0.31, top: -size * 0.31 }} />
  </span>
);

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const clean = (s: string) => s.replace(EMOJI, '').trim();

function MessageView({ msg, onQuickAction, compact }: { msg: ChatMessage; onQuickAction: (a: string) => void; compact?: boolean }) {
  const { prefs } = usePrefs();
  if (msg.type === 'user') {
    return (
      <div className="max-w-[82%] animate-fade-up self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-chip px-4 py-3 font-chat text-chat leading-[1.55] text-fg">{msg.content}</div>
    );
  }
  return (
    <div className="flex animate-fade-up items-start gap-3.5">
      {!compact && <AgentAvatar />}
      <div className="flex min-w-0 flex-1 flex-col gap-3 font-chat text-chat leading-[1.62] text-fg-2">
        <div className="flex items-baseline gap-2 font-sans">
          <span className="font-semibold text-fg">Martian</span>
          <span className="font-mono text-xs text-fg-faint">{fmtTime(msg.at, prefs.clock)}</span>
        </div>
        {prefs.showToolCalls && msg.tools && msg.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5 font-sans">
            {msg.tools.map((t) => (
              <span key={t.id} className={cx('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-11', t.status === 'failed' ? 'border-danger-line text-danger' : 'border-line text-fg-muted')}>
                <span className={cx('h-1.5 w-1.5 rounded-full', t.status === 'running' ? 'animate-pulse bg-accent' : t.status === 'failed' ? 'bg-danger' : 'bg-ok')} />
                {t.tool}{t.seconds != null ? ` · ${t.seconds}s` : ''}
              </span>
            ))}
          </div>
        )}
        <Markdown content={clean(msg.content)} />
        {prefs.showSuggestions && msg.quickActions && msg.quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2 font-sans">
            {msg.quickActions.map((a, j) => (
              <button key={j} type="button" onClick={() => onQuickAction(a.action)} className="min-h-9 rounded-full border border-line-strong bg-surface px-3.5 text-13 font-medium text-fg-2 transition-colors hover:border-accent hover:text-accent-ink">
                {clean(a.text)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A write tool call paused at the approval gate. Nothing runs until someone decides. */
export function ApprovalCard({ pending, onDecide, busy, compact }: { pending: PendingApproval; onDecide: (ok: boolean) => void; busy: boolean; compact?: boolean }) {
  return (
    <div role="group" aria-label="Approval needed" className={cx('flex animate-fade-up flex-col gap-3 rounded-xl border-[1.5px] border-accent bg-accent-wash p-4', !compact && 'ml-[50px] max-sm:ml-0')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Waiting for you</Badge>
        <span className="text-13 text-fg-body">Martian wants to make {pending.actions.length === 1 ? 'a change' : `${pending.actions.length} changes`}. Nothing happens until you decide.</span>
      </div>
      {pending.actions.map((a) => (
        <div key={a.tool_call_id} className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-3.5 py-3">
          <span className="font-mono text-13 text-fg">{a.tool}</span>
          {a.integration && <span className="text-xs text-fg-muted">on {a.integration}</span>}
          <code className="whitespace-pre-wrap break-all font-mono text-xs text-fg-body">{JSON.stringify(a.args)}</code>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => onDecide(true)} className="h-[38px] rounded-lg border-0 bg-accent px-4 text-13 font-semibold text-white disabled:opacity-60">Approve and run</button>
        <button type="button" disabled={busy} onClick={() => onDecide(false)} className="h-[38px] rounded-lg border border-line-strong bg-surface px-4 text-13 text-fg-2 disabled:opacity-60">Decline</button>
      </div>
    </div>
  );
}

export function Composer({ chat, placeholder, scope, suggestions, compact, autoFocus }: {
  chat: Chat; placeholder: string; scope?: string; suggestions?: string[]; compact?: boolean; autoFocus?: boolean;
}) {
  const { prefs } = usePrefs();
  const send = () => void chat.handleSendMessage(chat.inputValue);
  return (
    <form className={cx('mx-auto flex w-full flex-col gap-2.5', !compact && 'max-w-[780px]')} onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-line-strong bg-surface py-3 pl-4 pr-3 shadow-composer transition-colors focus-within:border-fg-faint">
        <label htmlFor={compact ? 'ask-session' : 'ask'} className="sr-only-clip">Message Martian</label>
        <textarea
          id={compact ? 'ask-session' : 'ask'}
          rows={compact ? 2 : 2}
          autoFocus={autoFocus}
          value={chat.inputValue}
          onChange={(e) => chat.setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const mod = e.metaKey || e.ctrlKey;
            if ((prefs.enterToSend && !e.shiftKey && !mod) || (!prefs.enterToSend && mod)) { e.preventDefault(); send(); }
          }}
          placeholder={placeholder}
          className="w-full resize-none border-0 bg-transparent font-chat text-chat leading-normal text-fg outline-none placeholder:text-fg-faint"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {scope ? <span className="rounded-md bg-chip px-2 py-1 font-mono text-xs text-fg-body">{scope}</span> : <span />}
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-fg-faint">{prefs.enterToSend ? '↵ to send' : '⌘↵ to send'}</span>
            <button type="submit" aria-label="Send" disabled={chat.isTyping || !chat.inputValue.trim()} className="flex h-10 w-10 items-center justify-center rounded-[10px] border-0 bg-accent text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-50">
              <IconArrowUp />
            </button>
          </div>
        </div>
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => chat.setInputValue(s)} className="min-h-[34px] rounded-full border border-line bg-canvas px-3 text-13 text-fg-body transition-colors hover:border-fg-faint">
              {s}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

export function Conversation({ chat, compact, empty }: { chat: Chat; compact?: boolean; empty?: React.ReactNode }) {
  const hasUser = chat.messages.some((m) => m.type === 'user');
  return (
    <div className={cx('mx-auto box-border flex w-full flex-col gap-7', compact ? 'px-5 pb-4 pt-5' : 'max-w-[860px] px-10 pb-4 pt-8 max-sm:px-4')} aria-live="polite">
      {!hasUser && empty}
      {chat.messages.map((msg) => <MessageView key={msg.id} msg={msg} compact={compact} onQuickAction={chat.handleQuickAction} />)}
      {chat.pending && <ApprovalCard pending={chat.pending} compact={compact} busy={chat.isTyping} onDecide={(ok) => void chat.decide(ok)} />}
      {chat.error && <p role="alert" className={cx('m-0 rounded-[10px] border border-danger-soft bg-surface px-3.5 py-3 text-13 text-danger', !compact && 'ml-[50px] max-sm:ml-0')}>{chat.error}</p>}
      {chat.isTyping && (
        <div className="flex items-center gap-3.5 text-sm text-fg-muted">
          {!compact && <AgentAvatar />}
          <span className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
            {chat.run.some((r) => r.status === 'pending') ? `Working: ${chat.run.filter((r) => r.status === 'pending').slice(-1)[0]?.title}` : 'Thinking'}
          </span>
        </div>
      )}
      <div ref={chat.messagesEndRef} />
    </div>
  );
}
