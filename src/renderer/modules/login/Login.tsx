import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { BrandMark } from '../../App';
import { Button, Field, TextInput } from '../../ui';
import { useSession } from '../../lib/session';
import { errMsg } from '../../lib/api';

export function LoginScreen() {
  const { business, login } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!business) return;
    setBusy(true);
    setError(null);
    try {
      await login(business.id, username, password);
    } catch (err) {
      setError(errMsg(err, 'লগইন করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card fade-up">
      <BrandMark size={46} />
      <h1>{business?.name}</h1>
      <p className="sub">চালিয়ে যেতে লগইন করুন</p>
      <form onSubmit={submit} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="login-error">{error}</div>}
        <Field label="ইউজারনেম">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ইউজারনেম লিখুন" autoFocus autoComplete="username" />
        </Field>
        <Field label="পাসওয়ার্ড">
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="পাসওয়ার্ড লিখুন" autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" size="lg" icon={<LogIn size={17} />} loading={busy} disabled={!username || !password}>
          লগইন
        </Button>
      </form>
      <p style={{ marginTop: 18, fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)', textAlign: 'center' }}>
        MERQO — সম্পূর্ণ অফলাইন, আপনার ডেটা আপনার হাতে
      </p>
    </div>
  );
}
