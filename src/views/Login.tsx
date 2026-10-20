import React, { useState } from 'react';
import { IconCheck, MartianMark } from '../ui/icons';

const PROOF = ['Read-only access by default', 'Credentials encrypted with AES-256', 'Your approval before every change'];
const PLATFORMS = ['AWS', 'Azure', 'Google Cloud', 'VMware', 'On-premises'];

const inputCls = 'box-border h-[46px] w-full rounded-lg border border-line-strong px-3.5 text-[15px] text-fg outline-none';

export const Login = ({
  onLogin, loading, error,
}: { onLogin: (email: string, password: string) => void; loading: boolean; error: string }) => {
  const [email, setEmail] = useState('admin@company.com');
  const [password, setPassword] = useState('admin123');

  return (
    <div className="flex min-h-screen w-full flex-wrap bg-white">
      {/* Brand panel */}
      <section className="box-border flex min-w-0 flex-[1_1_520px] flex-col justify-between gap-14 bg-ink px-14 py-10 text-white max-sm:px-6">
        <div className="flex items-center gap-2 text-[19px] font-semibold">
          <MartianMark box={30} img={56} offset={-13} />
          Martian
        </div>
        <div className="flex max-w-[520px] flex-col gap-7">
          <h1 className="m-0 text-[clamp(36px,3.6vw,52px)] font-semibold leading-[1.05] tracking-[-0.035em]">
            AI agents that eliminate <span className="text-accent-soft">infrastructure waste.</span>
          </h1>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-base text-[#C9CBD0]">
            {PROOF.map((p) => (
              <li key={p} className="flex items-center gap-3"><IconCheck color="#FF6B3D" />{p}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs text-side-dim">
          {PLATFORMS.map((p) => <span key={p}>{p}</span>)}
        </div>
      </section>

      {/* Form panel */}
      <section className="box-border flex min-w-0 flex-[1_1_520px] items-center justify-center px-6 py-14">
        <form
          className="flex w-full max-w-[400px] flex-col gap-[22px]"
          onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}
        >
          <div className="flex flex-col gap-2">
            <span className="self-start rounded-full bg-accent-wash px-2.5 py-1 font-mono text-xs text-accent-ink">Demo account</span>
            <h2 className="m-0 text-[30px] font-semibold tracking-[-0.025em]">Sign in to Martian</h2>
            <p className="m-0 text-[15px] leading-normal text-fg-muted">Use your work email to open your organization's workspace.</p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium text-fg-2">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} autoComplete="username" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <label htmlFor="password" className="text-sm font-medium text-fg-2">Password</label>
              <a href="#forgot" className="text-[13px] text-fg-muted no-underline">Forgot password?</a>
            </div>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="current-password" />
          </div>
          {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border-0 bg-accent text-[15px] font-semibold text-white disabled:opacity-80"
          >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="flex items-center gap-3 text-[13px] text-side-dim">
            <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" className="flex h-12 items-center justify-center rounded-lg border border-line-strong bg-white text-[15px] font-medium text-fg">
            Continue with SSO
          </button>
          <p className="m-0 text-center text-sm text-fg-muted">
            New to Martian? <a href="https://www.martian-ai.com/#demo" className="font-medium text-accent-link no-underline">Get a demo</a>
          </p>
        </form>
      </section>
    </div>
  );
};
