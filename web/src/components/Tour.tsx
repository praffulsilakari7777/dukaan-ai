import { Mic, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../lib/store';

const KEY = 'dukaan-ai:tour';

export const tourSeen = () => {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return true;
  }
};

/** Three cards that explain the whole product before a judge or new owner starts tapping. */
export function Tour({ onClose }: { onClose: () => void }) {
  const { t } = useStore();
  const [i, setI] = useState(0);
  const steps = [
    { icon: Mic, title: t.tour1Title, body: t.tour1Body },
    { icon: Sparkles, title: t.tour2Title, body: t.tour2Body },
    { icon: TrendingUp, title: t.tour3Title, body: t.tour3Body },
  ];
  const done = () => {
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      /* private mode: show again next time */
    }
    onClose();
  };
  const S = steps[i];
  return (
    <>
      <div className="scrim" onClick={done} />
      <section className="tour" role="dialog" aria-modal="true" aria-label={S.title}>
        <div className="tour-art" aria-hidden>
          <S.icon size={40} strokeWidth={1.8} />
        </div>
        <span className="tour-step num">
          {i + 1} / {steps.length}
        </span>
        <h2>{S.title}</h2>
        <p>{S.body}</p>
        <div className="tour-dots" aria-hidden>
          {steps.map((_, k) => (
            <i key={k} className={k === i ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="btn ghost" onClick={done}>
            {t.skip}
          </button>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => (i < steps.length - 1 ? setI(i + 1) : done())}>
            {i < steps.length - 1 ? t.next : t.getStarted}
          </button>
        </div>
      </section>
    </>
  );
}
