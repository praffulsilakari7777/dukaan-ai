import { useCallback, useEffect, useRef, useState } from 'react';
import { langInfo } from './i18n';
import type { Lang } from './types';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const SR: (new () => Recognition) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

export const speechSupported = !!SR;

/** Google speech recognition through the browser. Calls onFinal with the full transcript when the owner stops. */
export function useVoice(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef('');
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    if (!SR) {
      setError('Voice needs Chrome on Android or desktop. You can type instead.');
      return;
    }
    setError(null);
    setTranscript('');
    finalText.current = '';
    const r = new SR();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let interim = '';
      let fin = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t;
        else interim += t;
      }
      finalText.current = fin;
      setTranscript((fin + ' ' + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') setError('Microphone permission is blocked. Allow it in the browser, or type instead.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('Could not hear that. Try again, or type it.');
    };
    r.onend = () => {
      setListening(false);
      const text = finalText.current.trim();
      if (text) cb.current(text);
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, [lang]);

  useEffect(() => () => rec.current?.stop(), []);

  return { listening, transcript, error, start, stop, toggle: () => (listening ? stop() : start()) };
}

/** Reads text aloud with the device's Indian voice when one exists. */
export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false);
  const speak = useCallback((text: string, lang: Lang) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/₹/g, 'rupees ').replace(/[•*_#]/g, ''));
    const want = langInfo(lang).bcp;
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === want) ?? voices.find((v) => v.lang.startsWith(want.slice(0, 2))) ?? null;
    u.lang = want;
    u.rate = 0.98;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, []);
  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return { speaking, speak, stop };
}
