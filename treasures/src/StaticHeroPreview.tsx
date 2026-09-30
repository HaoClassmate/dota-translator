import { useEffect, useState } from 'react';

export function StaticHeroPreview({ itemId }: { itemId: number }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => setMissing(false), [itemId]);
  return <div className="hero-3d">
    <img className="hero-3d-still" src={missing ? `/treasures/assets/${itemId}.png` : `/treasures/assets/hero-stills/${itemId}.webp?v=orbs3`}
      onError={() => setMissing(true)} alt="Hero reward" />
  </div>;
}

export function SpinningHeroPreview({ itemId }: { itemId: number }) {
  const [turntable, setTurntable] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [stillMissing, setStillMissing] = useState(false);
  useEffect(() => {
    setTurntable('loading');
    setStillMissing(false);
    const image = new Image();
    image.onload = () => setTurntable('ready');
    image.onerror = () => setTurntable('fallback');
    image.src = `/treasures/assets/hero-turntables/${itemId}.webp?v=orbs3`;
    return () => { image.onload = null; image.onerror = null; };
  }, [itemId]);
  return <div className="hero-3d spin-turntable" role="img" aria-label="Turning 3D hero reward">
    {turntable === 'ready' ? <div className="spin-turntable-frames" style={{ backgroundImage: `url(/treasures/assets/hero-turntables/${itemId}.webp?v=orbs3)` }} />
      : <img className="hero-3d-still" src={turntable === 'fallback' && stillMissing ? `/treasures/assets/${itemId}.png` : `/treasures/assets/hero-stills/${itemId}.webp?v=orbs3`}
        onError={() => setStillMissing(true)} alt="Hero reward" />}
  </div>;
}
