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
  abort?: () => void;
};

const SR: (new () => Recognition) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

export const speechSupported = !!SR;

/**
 * Google speech recognition through the browser. Calls onFinal with what was said when the
 * owner stops or pauses. Chrome often ends a session before marking the last words final,
 * so the latest interim text counts too; otherwise a tap on "stop" would lose the sentence.
 */
export function useVoice(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef('');
  const failed = useRef(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    if (!SR) {
      setError('Voice needs Chrome on Android or a computer. You can type instead.');
      return;
    }
    rec.current?.abort?.();
    setError(null);
    setTranscript('');
    heard.current = '';
    failed.current = false;
    const r = new SR();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard.current = text.replace(/\s+/g, ' ').trim();
      setTranscript(heard.current);
    };
    r.onerror = (e) => {
      failed.current = true;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Microphone access is blocked. Allow it in the browser settings, or type instead.');
      else if (e.error === 'no-speech') setError("Didn't hear anything. Tap the mic and speak, then tap again to send.");
      else if (e.error === 'network') setError('Voice needs an internet connection. You can type instead.');
      else if (e.error !== 'aborted') setError('Could not hear that clearly. Try again, or type it.');
    };
    r.onend = () => {
      setListening(false);
      if (rec.current === r) rec.current = null;
      const text = heard.current;
      if (text) cb.current(text);
      else if (!failed.current) setError("Didn't catch that. Tap the mic, speak, then tap again to send.");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError('Could not start the microphone. Please try again.');
    }
  }, [lang]);

  useEffect(() => () => rec.current?.abort?.(), []);

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
