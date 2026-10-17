import { Check } from 'lucide-react';
import { LANGS, langInfo } from '../lib/i18n';
import { useStore } from '../lib/store';
import type { Lang } from '../lib/types';
import { Sheet } from './ui';

/** Picks the app language; voice input follows it, so the owner never sets two things. */
export function useSetLanguage() {
  const { updateSettings } = useStore();
  return (code: Lang) => updateSettings({ lang: code, voiceLang: langInfo(code).bcp });
}

export function LanguagePicker({ onClose }: { onClose: () => void }) {
  const { settings, t } = useStore();
  const setLang = useSetLanguage();
  return (
    <Sheet title={t.chooseLanguage} onClose={onClose}>
      <div className="lang-grid">
        {LANGS.map((l) => (
          <button
            key={l.code}
            lang={l.bcp}
            className={`lang-opt${settings.lang === l.code ? ' on' : ''}`}
            onClick={() => {
              setLang(l.code);
              onClose();
            }}
          >
            <b>{l.native}</b>
            <span>{l.english}</span>
            {settings.lang === l.code && <Check size={16} className="lang-check" />}
          </button>
        ))}
      </div>
      <p className="disclaimer" style={{ marginTop: 14 }}>
        Voice input, Ask Dukaan answers, briefings, offers and loan advice all switch to this language.
      </p>
    </Sheet>
  );
}
