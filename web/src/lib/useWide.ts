import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px)';

/** True on laptop and desktop widths, where the app uses its website layout. */
export function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}
