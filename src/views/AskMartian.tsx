import React from 'react';
import { useMartianChatView } from '../components/MartianAIChat';
import { AppShell, ViewKey } from '../shell/AppShell';

export const AskMartian = ({
  prefill, onNewConversation, onNavigate, onLogout, error, onDismissError,
}: {
  prefill?: string; onNewConversation: () => void; onNavigate: (v: ViewKey) => void; onLogout: () => void;
  error?: string; onDismissError?: () => void;
}) => {
  const view = useMartianChatView({ prefill, onNewConversation, onOpenIntegrations: () => onNavigate('integrations') });
  return (
    <AppShell
      current="chat"
      onNavigate={onNavigate}
      onLogout={onLogout}
      title="Ask Martian"
      titleMeta={<span className="font-mono text-xs text-fg-muted">Conversation · today</span>}
      actions={<>{view.header}{view.panelToggle}</>}
      error={error}
      onDismissError={onDismissError}
      background="white"
    >
      {view.body}
    </AppShell>
  );
};
