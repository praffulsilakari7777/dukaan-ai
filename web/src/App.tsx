import { BookUser, CheckCircle2, Home as HomeIcon, Languages, Lightbulb, Package, Plus, Settings as Cog, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { health } from './lib/api';
import { useStore } from './lib/store';
import { useWide } from './lib/useWide';
import { AddSheet } from './screens/Add';
import { AskSheet } from './screens/Ask';
import { Home } from './screens/Home';
import { Insights } from './screens/Insights';
import { Khata } from './screens/Khata';
import { SettingsSheet } from './screens/Settings';
import { Stock } from './screens/Stock';

export type Tab = 'home' | 'stock' | 'khata' | 'insights';
type Overlay = null | 'add' | 'ask' | 'ask-voice' | 'settings';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <path d="M9 17.5h22l-2 13.5a2 2 0 0 1-2 1.7H13a2 2 0 0 1-2-1.7z" fill="#fff" />
      <path d="M14.5 17.5c0-4.2 2.4-7.5 5.5-7.5s5.5 3.3 5.5 7.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15.5 24.5h9M15.5 28h6" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const { t, ledger, settings, toastMsg, updateSettings } = useStore();
  const wide = useWide();
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const close = () => setOverlay(null);

  useEffect(() => {
    health().then((h) => setAi(h.gemini));
  }, []);

  // Desktop shortcuts: N for a new entry, / to ask.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (overlay || e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(el.tagName)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setOverlay('add');
      } else if (e.key === '/') {
        e.preventDefault();
        setOverlay('ask');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  const titles: Record<Tab, string> = { home: t.home, stock: t.stock, khata: t.khata, insights: t.insights };
  const icons = { home: HomeIcon, stock: Package, khata: BookUser, insights: Lightbulb };
  const badges: Partial<Record<Tab, number>> = { stock: ledger.lowCount, khata: ledger.customers.filter((c) => c.due > 0).length };

  const navItem = (id: Tab) => {
    const Icon = icons[id];
    return (
      <button key={id} className={`nav-item${tab === id ? ' on' : ''}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
        <span className="dot">
          <Icon size={wide ? 19 : 22} strokeWidth={tab === id ? 2.4 : 2} />
          {!wide && id === 'stock' && !!badges.stock && <span className="badge num">{badges.stock}</span>}
        </span>
        <span className="nav-label">{titles[id]}</span>
        {wide && !!badges[id] && <span className={`side-count num${id === 'stock' ? ' bad' : ''}`}>{badges[id]}</span>}
      </button>
    );
  };

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? t.goodMorning : hour < 17 ? t.goodAfternoon : t.goodEvening;

  return (
    <div className="shell">
      <aside className="side" aria-label="Sidebar">
        <div className="side-brand">
          <Logo />
          <div>
            <b>Dukaan AI</b>
            <span>Bookkeeping by voice</span>
          </div>
        </div>
        <button className="btn add-btn block" onClick={() => setOverlay('add')}>
          <Plus size={19} strokeWidth={2.6} /> New entry <kbd>N</kbd>
        </button>
        <nav className="side-nav" aria-label="Main">
          {(['home', 'stock', 'khata', 'insights'] as Tab[]).map(navItem)}
        </nav>
        <div className="side-foot">
          <div className="shop-card">
            <span className="shop-av">{settings.shopName.slice(0, 1)}</span>
            <div>
              <b>{settings.shopName}</b>
              <span>
                <i className={`live${ai ? ' on' : ''}`} /> {ai == null ? 'Connecting…' : ai ? t.online : t.offline}
              </span>
            </div>
          </div>
          <button className="side-link" onClick={() => setOverlay('settings')}>
            <Cog size={17} /> {t.settings}
          </button>
        </div>
      </aside>

      <main className="app-main">
        {wide && (
          <header className="topbar">
            <div className="tb-title">
              <h1>{tab === 'home' ? `${greet}, ${settings.ownerName}` : titles[tab]}</h1>
              <span>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            </div>
            <button className="tb-ask" onClick={() => setOverlay('ask')}>
              <Sparkles size={18} />
              <span>{t.askPlaceholder}</span>
              <kbd>/</kbd>
            </button>
            <button className="tb-btn" onClick={() => updateSettings({ lang: settings.lang === 'en' ? 'hi' : 'en' })} aria-label="Switch language">
              <Languages size={17} /> {settings.lang === 'en' ? 'English' : 'Hinglish'}
            </button>
          </header>
        )}

        {tab === 'home' && <Home go={setTab} openAdd={() => setOverlay('add')} openAsk={(v) => setOverlay(v ? 'ask-voice' : 'ask')} openSettings={() => setOverlay('settings')} />}
        {tab === 'stock' && <Stock openAdd={() => setOverlay('add')} />}
        {tab === 'khata' && <Khata />}
        {tab === 'insights' && <Insights />}
      </main>

      <nav className="nav" aria-label="Main">
        {navItem('home')}
        {navItem('stock')}
        <div className="fab-wrap">
          <button className="fab" onClick={() => setOverlay('add')} aria-label={t.add}>
            <Plus size={30} strokeWidth={2.6} />
          </button>
        </div>
        {navItem('khata')}
        {navItem('insights')}
      </nav>

      {overlay === 'add' && <AddSheet onClose={close} />}
      {(overlay === 'ask' || overlay === 'ask-voice') && <AskSheet onClose={close} startVoice={overlay === 'ask-voice'} />}
      {overlay === 'settings' && <SettingsSheet onClose={close} />}

      {toastMsg && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} /> {toastMsg}
        </div>
      )}
    </div>
  );
}
