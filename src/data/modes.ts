/** Permission modes an integration can run in. */
export type PermissionMode = 'read' | 'ask' | 'auto';

export const MODES: { key: PermissionMode; label: string; help: string }[] = [
  { key: 'read', label: 'Read-only', help: 'Agents can look but never change anything.' },
  { key: 'ask', label: 'Ask before writes', help: 'Every write waits for a person to approve it.' },
  { key: 'auto', label: 'Auto-approve small writes', help: 'Changes under $1,000/mo run on their own. Bigger ones still ask.' },
];

export const MODE_LABEL: Record<PermissionMode, string> = { read: 'Read-only', ask: 'Ask before writes', auto: 'Auto-approve small writes' };
