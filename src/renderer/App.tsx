import React from 'react';
import { useSession } from './lib/session';
import { SetupWizard } from './modules/wizard/SetupWizard';
import { LoginScreen } from './modules/login/Login';
import { Shell } from './modules/shell/Shell';

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(1200px 600px at 20% 0%, #e7f2ed 0%, transparent 60%), radial-gradient(1000px 500px at 90% 100%, #e3edf5 0%, transparent 55%), var(--c-bg)'
      }}
    >
      {children}
    </div>
  );
}

function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: 'linear-gradient(135deg, #10312a, #0f7a5c)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 800,
        fontSize: size * 0.42,
        boxShadow: 'var(--shadow-md)'
      }}
    >
      M
    </div>
  );
}

export { BrandMark, FullScreen };

export default function App() {
  const { user, business, ready } = useSession();

  if (!ready) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <BrandMark size={52} />
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!business) return <FullScreen><SetupWizard /></FullScreen>;
  if (!user) return <FullScreen><LoginScreen /></FullScreen>;
  return <Shell />;
}
