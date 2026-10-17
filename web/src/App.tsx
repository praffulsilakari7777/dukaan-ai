import { BookUser, CheckCircle2, Home as HomeIcon, Lightbulb, Mic, Package, Plus, ScanLine, Sparkles, Store } from 'lucide-react';
import { useState } from 'react';
import { useStore } from './lib/store';
import { AddSheet } from './screens/Add';
import { AskSheet } from './screens/Ask';
import { Home } from './screens/Home';
import { Insights } from './screens/Insights';
import { Khata } from './screens/Khata';
import { SettingsSheet } from './screens/Settings';
import { Stock } from './screens/Stock';

export type Tab = 'home' | 'stock' | 'khata' | 'insights';
type Overlay = null | 'add' | 'ask' | 'ask-voice' | 'settings';

export default function App() {
  const { t, ledger, toastMsg } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const close = () => setOverlay(null);

  const navItem = (id: Tab, label: string, Icon: typeof HomeIcon, badge?: number) => (
    <button className={`nav-item${tab === id ? ' on' : ''}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
      <span className="dot">
        <Icon size={22} strokeWidth={tab === id ? 2.4 : 2} />
        {!!badge && <span className="badge num">{badge}</span>}
      </span>
      {label}
    </button>
  );

  return (
    <div className="stage">
      <aside className="aside">
        <div className="mark">
          <Store size={24} />
        </div>
        <h1>An AI employee for India’s kirana stores.</h1>
        <p>It listens, keeps the books, and helps the shop get credit.</p>
        <ul>
          <li>
            <Mic size={16} /> Speak a sale in Hinglish, Hindi or English
          </li>
          <li>
            <ScanLine size={16} /> Photograph a supplier bill to fill stock
          </li>
          <li>
            <Sparkles size={16} /> Ask Dukaan: a Gemini agent that runs your ledger
          </li>
          <li>
            <CheckCircle2 size={16} /> Nothing is saved until the owner confirms
          </li>
        </ul>
      </aside>

      <main className="app">
        {tab === 'home' && <Home go={setTab} openAdd={() => setOverlay('add')} openAsk={(v) => setOverlay(v ? 'ask-voice' : 'ask')} openSettings={() => setOverlay('settings')} />}
        {tab === 'stock' && <Stock openAdd={() => setOverlay('add')} />}
        {tab === 'khata' && <Khata />}
        {tab === 'insights' && <Insights />}

        <nav className="nav" aria-label="Main">
          {navItem('home', t.home, HomeIcon)}
          {navItem('stock', t.stock, Package, ledger.lowCount)}
          <div className="fab-wrap">
            <button className="fab" onClick={() => setOverlay('add')} aria-label={t.add}>
              <Plus size={30} strokeWidth={2.6} />
            </button>
          </div>
          {navItem('khata', t.khata, BookUser)}
          {navItem('insights', t.insights, Lightbulb)}
        </nav>

        {overlay === 'add' && <AddSheet onClose={close} />}
        {(overlay === 'ask' || overlay === 'ask-voice') && <AskSheet onClose={close} startVoice={overlay === 'ask-voice'} />}
        {overlay === 'settings' && <SettingsSheet onClose={close} />}

        {toastMsg && (
          <div className="toast" role="status">
            <CheckCircle2 size={17} /> {toastMsg}
          </div>
        )}
      </main>
    </div>
  );
}
