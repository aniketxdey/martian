/**
 * Small Markdown renderer for chat answers: headings, paragraphs, bold, italic,
 * inline code, fenced code, lists (nested by indent), tables, quotes, rules and links.
 * Builds React elements directly (no HTML strings), so model output can't inject markup.
 */
import React from 'react';
import { cx } from '../ui/kit';

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { t: 'table'; head: string[]; align: ('left' | 'right' | 'center')[]; rows: string[][] }
  | { t: 'quote'; text: string }
  | { t: 'hr' };

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```(\w+)?/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2].replace(/\s*#+\s*$/, '') }); i++; continue; }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left')) as ('left' | 'right' | 'center')[];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push({ t: 'table', head, align, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: body.join(' ') });
      continue;
    }
    const li = line.match(LIST);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m) { items.push({ text: m[3], depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2) }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^(#{1,6}\s|\s*```|\s*>)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]))) para.push(lines[i++].trim());
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}

/* ---------- inline ---------- */

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;

export function inline(text: string, key = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    const [tok] = m;
    if (m[1]) out.push(<code key={k} className="rounded bg-chip px-1 py-px font-mono text-[0.88em] text-fg">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k} className="font-semibold text-fg">{inline(tok.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    else if (m[4]) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = /^(https?:|#|\/)/.test(mm[2]) ? mm[2] : '#';
      out.push(<a key={k} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="font-medium text-accent-link underline decoration-accent/30 underline-offset-2 hover:decoration-accent">{inline(mm[1], k)}</a>);
    } else if (m[5]) out.push(<a key={k} href={tok} target="_blank" rel="noreferrer" className="text-accent-link underline underline-offset-2">{tok}</a>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------- render ---------- */

export function Markdown({ content, className }: { content: string; className?: string }) {
  const blocks = parseMarkdown(content);
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'h': {
            const size = b.level <= 2 ? 'text-17' : b.level === 3 ? 'text-15' : 'text-sm';
            return <p key={k} role="heading" aria-level={b.level + 1} className={cx('m-0 mt-1 font-semibold tracking-[-0.01em] text-fg', size)}>{inline(b.text, k)}</p>;
          }
          case 'p': return <p key={k} className="m-0">{inline(b.text, k)}</p>;
          case 'code': return (
            <pre key={k} className="m-0 overflow-x-auto rounded-lg border border-line bg-canvas px-3.5 py-3 font-mono text-13 leading-relaxed text-fg-2 scrollbar-thin">
              <code>{b.text}</code>
            </pre>
          );
          case 'quote': return <blockquote key={k} className="m-0 border-l-2 border-accent/50 pl-3.5 text-fg-body">{inline(b.text, k)}</blockquote>;
          case 'hr': return <hr key={k} className="m-0 border-0 border-t border-line" />;
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={k} className={cx('m-0 flex flex-col gap-1.5 pl-5', b.ordered ? 'list-decimal' : 'list-disc', 'marker:text-fg-faint')}>
                {b.items.map((it, j) => <li key={j} style={{ marginLeft: it.depth * 16 }} className="pl-0.5">{inline(it.text, `${k}-${j}`)}</li>)}
              </Tag>
            );
          }
          case 'table': return (
            <div key={k} className="overflow-x-auto rounded-xl border border-line scrollbar-thin">
              <table className="w-full border-collapse text-13">
                <thead>
                  <tr className="bg-canvas">
                    {b.head.map((h, j) => <th key={j} scope="col" className="border-b border-line px-3 py-2 text-left font-medium text-fg-muted" style={{ textAlign: b.align[j] }}>{inline(h, `${k}h${j}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b border-line-soft last:border-b-0">
                      {b.head.map((_, c) => <td key={c} className={cx('px-3 py-2 align-top text-fg-2', /^[$\d.,%+\-–→ ]+$/.test(r[c] ?? '') && 'whitespace-nowrap font-mono')} style={{ textAlign: b.align[c] }}>{inline(r[c] ?? '', `${k}r${j}c${c}`)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
      })}
    </div>
  );
}
