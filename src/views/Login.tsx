import React, { useState } from 'react';
import { API_URL } from '../api/client';
import { LIVE } from '../app/env';
import { useActions, useApp } from '../app/store';
import { IconCheck, MartianMark } from '../ui/icons';
import { fieldInput } from '../ui/kit';

const POINTS = [
  'Read-only until someone approves a change',
  'Covers every major cloud as well as VMware and the servers in your own racks',
  'Forecasts tomorrow’s load before it resizes anything',
  'Logs every agent step next to the name of whoever approved it',
];

export const Login = () => {
  const auth = useApp((s) => s.auth);
  const demo = useApp((s) => s.mode.demo && !s.mode.live);
  const org = useApp((s) => s.user.org);
  const { login } = useActions();
  const [email, setEmail] = useState(auth.defaultEmail);
  const [password, setPassword] = useState(auth.defaultPassword);

  return (
    <div className="flex min-h-screen w-full flex-wrap bg-surface">
      <section className="ambient-glow flex min-h-[420px] flex-[1_1_520px] flex-col justify-between gap-10 bg-ink px-14 py-12 text-white max-sm:px-6">
        <div className="flex items-center gap-2.5 text-xl font-semibold">
          <MartianMark box={30} />
          Martian
        </div>
        <div className="flex max-w-[520px] flex-col gap-6">
          <h1 className="m-0 text-[clamp(2.1rem,4vw,3.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Agents That Eliminate <span className="text-accent-soft">Your Infrastructure Waste</span>
          </h1>
          <p className="m-0 max-w-[460px] text-17 leading-relaxed text-side-muted">
            Martian finds the machines and storage you pay for but don't use, and once you've seen the evidence and said yes, it cleans them up.
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-15 text-[#D9DBDF]">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3"><IconCheck className="text-accent-soft" />{p}</li>
            ))}
          </ul>
        </div>
        <p className="m-0 text-13 text-side-dim">martian-ai.com</p>
      </section>

      <section className="flex flex-[1_1_440px] items-center justify-center px-8 py-12 max-sm:px-5">
        <form
          className="flex w-full max-w-[380px] flex-col gap-5"
          onSubmit={(e) => { e.preventDefault(); void login(email, password); }}
        >
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-26 font-semibold tracking-[-0.02em]">Sign in</h2>
            <p className="m-0 text-sm text-fg-muted">
              {demo ? <>This is a demo for <b className="font-medium text-fg">{org}</b> with sample data. The fields are filled in for you.</> : 'Use your work email.'}
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-13 font-medium" htmlFor="email">
            Email
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={`${fieldInput} h-11`} />
          </label>
          <label className="flex flex-col gap-1.5 text-13 font-medium" htmlFor="password">
            Password
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldInput} h-11`} />
          </label>
          {auth.error && <p role="alert" className="m-0 rounded-lg bg-danger-wash px-3 py-2.5 text-13 text-danger">{auth.error}</p>}
          <button type="submit" disabled={auth.loading} className="ix-btn-primary h-11 rounded-lg border-0 bg-accent text-15 font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60">
            {auth.loading ? 'Signing in…' : 'Sign in'}
          </button>
          {LIVE && (
            <>
              <div className="flex items-center gap-3 text-xs text-fg-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
              <a href={`${API_URL ?? ''}/auth/sso/start?email=${encodeURIComponent(email)}`} className="flex h-11 items-center justify-center rounded-lg border border-line-strong text-sm font-medium text-fg no-underline hover:border-fg-faint">
                Sign in with SSO
              </a>
            </>
          )}
        </form>
      </section>
    </div>
  );
};
