/** A static two-message chat that follows the current chat settings (Settings → Appearance). */
import React from 'react';
import { fmtTime, usePrefs } from '../../app/prefs';
import { cx } from '../../ui/kit';
import { Markdown } from '../Markdown';
import { AgentAvatar } from './ChatPanel';

const ANSWER = `Three idle VMs in **AWS prod** cost **$1,840/mo**. All three sat under 3% CPU for 14 days.

| Instance | Avg CPU | Monthly |
|---|--:|--:|
| batch-07 | 1.8% | $620 |
| batch-11 | 2.4% | $610 |

Want me to stop them? You can start them again any time.`;

export function ChatPreview() {
  const { prefs } = usePrefs();
  const at = new Date(2026, 9, 26, 14, 5);
  return (
    <div aria-label="Chat preview" className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-4">
      <div className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-chip px-3.5 py-2.5 font-chat text-chat leading-[1.55] text-fg">Which VMs are idle?</div>
      <div className="flex items-start gap-3">
        <AgentAvatar size={28} />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 font-chat text-chat leading-[1.62] text-fg-2">
          <div className="flex items-baseline gap-2 font-sans">
            <span className="text-sm font-semibold text-fg">Martian</span>
            <span className="font-mono text-xs text-fg-faint">{fmtTime(at, prefs.clock)}</span>
          </div>
          {prefs.showToolCalls && (
            <div className="flex flex-wrap gap-1.5 font-sans">
              {['aws_inventory · 1.2s', 'aws_get_cpu_series · 0.6s'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 font-mono text-11 text-fg-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" />{t}
                </span>
              ))}
            </div>
          )}
          <Markdown content={ANSWER} />
          {prefs.showSuggestions && (
            <div className="flex flex-wrap gap-2 font-sans">
              {['Stop all three', 'Show the CPU history'].map((t) => (
                <span key={t} className={cx('inline-flex min-h-8 items-center rounded-full border border-line-strong bg-surface px-3 text-13 font-medium text-fg-2')}>{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="m-0 border-t border-line pt-3 font-mono text-xs text-fg-faint">{prefs.enterToSend ? '↵ sends · Shift + ↵ adds a line' : '⌘/Ctrl + ↵ sends · ↵ adds a line'}</p>
    </div>
  );
}
