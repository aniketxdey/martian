import React, { useCallback, useState } from 'react';
import { useMartian } from './state/useMartian';
import { AppShell, TopBarTools, ViewKey, WastePill } from './shell/AppShell';
import { Login } from './views/Login';
import { Overview } from './views/Overview';
import { Infrastructure } from './views/Infrastructure';
import { AskMartian } from './views/AskMartian';
import { Settings } from './views/Settings';
import { Integrations } from './views/Integrations';

const TITLES: Record<ViewKey, string> = {
  dashboard: 'Overview',
  infrastructure: 'Infrastructure',
  chat: 'Ask Martian',
  integrations: 'Integrations',
  setup: 'Settings',
};

const MartianAIEnterprise = () => {
  const m = useMartian();

  // UI-only: lets Infrastructure pre-fill a question, and "New conversation" reset the chat.
  const [chatKey, setChatKey] = useState(0);
  const [chatPrefill, setChatPrefill] = useState<string | undefined>();

  const navigate = useCallback((v: ViewKey) => {
    if (v !== 'chat') setChatPrefill(undefined);
    m.setCurrentView(v);
  }, [m.setCurrentView]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m.isAuthenticated || m.currentView === 'login') {
    return <Login onLogin={m.handleLogin} loading={m.loading} error={m.error} />;
  }

  const view = (TITLES[m.currentView as ViewKey] ? m.currentView : 'dashboard') as ViewKey;
  const waste = m.discoveryData?.summary?.wasteIdentified ?? 0;
  const dismissError = () => m.setError('');

  if (view === 'chat') {
    return (
      <AskMartian
        key={chatKey}
        prefill={chatPrefill}
        onNewConversation={() => { setChatPrefill(undefined); setChatKey((k) => k + 1); }}
        onNavigate={navigate}
        onLogout={m.handleLogout}
        error={m.error}
        onDismissError={dismissError}
      />
    );
  }

  const askAbout = (system: string) => {
    setChatPrefill(`What can I optimize in ${system}?`);
    setChatKey((k) => k + 1);
    m.setCurrentView('chat');
  };

  return (
    <AppShell
      current={view}
      onNavigate={navigate}
      onLogout={m.handleLogout}
      title={TITLES[view]}
      actions={view === 'dashboard' || view === 'infrastructure'
        ? <TopBarTools waste={waste} onAsk={() => navigate('chat')} />
        : <WastePill amount={waste} />}
      error={m.error}
      onDismissError={dismissError}
    >
      {view === 'dashboard' && <Overview m={m} onAsk={() => navigate('chat')} />}
      {view === 'infrastructure' && <Infrastructure onAskAbout={askAbout} />}
      {view === 'integrations' && <Integrations machines={m.physicalMachines} onOpenSettings={() => navigate('setup')} />}
      {view === 'setup' && <Settings m={m} onOpenIntegrations={() => navigate('integrations')} />}
    </AppShell>
  );
};

export default MartianAIEnterprise;
