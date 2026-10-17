import { Database, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Sheet } from '../components/ui';
import { health } from '../lib/api';
import { LANGS, VOICE_LANGS } from '../lib/i18n';
import type { Lang } from '../lib/types';
import { useSetLanguage } from '../components/LanguagePicker';
import { useStore } from '../lib/store';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { t, settings, updateSettings, loadDemo, reset, toast } = useStore();
  const setLang = useSetLanguage();
  const [ai, setAi] = useState<{ gemini: boolean; model?: string } | null>(null);
  useEffect(() => {
    health().then(setAi);
  }, []);

  return (
    <Sheet title={t.settings} onClose={onClose} full>
      <div className="status-line">
        <i className={ai?.gemini ? 'on' : ''} />
        {t.aiStatus}: {ai == null ? 'checking…' : ai.gemini ? t.online : t.offline}
        <small>{ai?.gemini ? ai.model : 'built-in parser'}</small>
      </div>

      <label className="field">
        <span>{t.shopName}</span>
        <input className="input" value={settings.shopName} onChange={(e) => updateSettings({ shopName: e.target.value })} />
      </label>
      <label className="field">
        <span>{t.ownerName}</span>
        <input className="input" value={settings.ownerName} onChange={(e) => updateSettings({ ownerName: e.target.value })} />
      </label>
      <label className="field">
        <span>{t.language}</span>
        <select className="input" value={settings.lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native} · {l.english}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t.voiceLang}</span>
        <select className="input" value={settings.voiceLang} onChange={(e) => updateSettings({ voiceLang: e.target.value })}>
          {VOICE_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="label-sm">Data</div>
      <div className="row-inline">
        <button
          className="btn ghost"
          style={{ flex: 1 }}
          onClick={() => {
            loadDemo();
            toast('Demo data loaded');
            onClose();
          }}
        >
          <Database size={17} /> {t.loadDemo}
        </button>
        <button
          className="btn danger"
          style={{ flex: 1 }}
          onClick={() => {
            if (window.confirm('Delete every entry on this phone? This cannot be undone.')) {
              reset();
              toast('All data cleared');
              onClose();
            }
          }}
        >
          <RotateCcw size={17} /> {t.reset}
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '16px 2px 0' }}>
        Your ledger stays on this phone. Only the words you speak, bill photos and summaries are sent to Gemini to be understood.
      </p>
    </Sheet>
  );
}
