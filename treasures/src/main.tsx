import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { chance, count, draw, EMPTY_STATE, remaining, replay, rewardStats,
  TREASURES, type Opening, type Treasure, type Item } from './treasure';
import { ELIMINATION_DELAY_MS, eliminationOrder, eliminationStepMs, revealTime, revealRewards,
  SPIN_UP_MS } from './spin';
import { SpinningHeroPreview, StaticHeroPreview } from './StaticHeroPreview';
import './style.css';
import './site-theme.css';
import { listingPriceCents, openingCostCents, totalOpeningCost, type Currency } from './pricing';

const HeroPreview = React.lazy(() => import('./HeroPreview').then(module => ({ default: module.HeroPreview })));
type Motion = 'focus' | 'side' | 'spin' | 'reveal';
function Model({ itemId, motion = 'focus', large = false, interactive = false }: { itemId: number; motion?: Motion; large?: boolean; interactive?: boolean }) {
  if (motion === 'spin') return <SpinningHeroPreview itemId={itemId} />;
  if (motion !== 'reveal' && !interactive) return <StaticHeroPreview itemId={itemId} />;
  return <React.Suspense fallback={<StaticHeroPreview itemId={itemId} />}>
    <HeroPreview itemId={itemId} motion={motion} large={large} />
  </React.Suspense>;
}

const LEGACY_HISTORY_KEY = 'carmine-cascade-openings-v1';
const historyKey = (id: number) => `treasure-openings-${id}-v1`;
const CURRENCY_KEY = 'treasury-currency-v1';
const moneyFormat: Record<Currency, Intl.NumberFormat> = {
  EUR: new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
};
const GALLERY = TREASURES;
const CASE_COLORS: Record<number, string> = {31200:'224,151,63',32933:'70,175,235',34332:'174,92,242',31361:'70,209,180',32609:'89,188,250',12604:'201,95,218'};
const ALL_ITEMS = TREASURES.flatMap(treasure => [...treasure.ordinary, ...treasure.bonuses]);
type Phase = 'preview' | 'spin' | 'reveal';

function loadHistories(): { histories: Record<number, Opening[]>; error: string } {
  const histories: Record<number, Opening[]> = {};
  try {
    for (const treasure of TREASURES) {
      let raw = localStorage.getItem(historyKey(treasure.id));
      if (!raw && treasure.id === 12604) raw = localStorage.getItem(LEGACY_HISTORY_KEY);
      const history = raw ? JSON.parse(raw) as Opening[] : [];
      replay(history, treasure);
      histories[treasure.id] = history;
    }
    return { histories, error: '' };
  } catch {
    return { histories, error: 'Saved opening history could not be read. Openings are disabled until the local data is repaired.' };
  }
}

function play(name: string, volume = 0.6) {
  const sound = new Audio(`/treasures/assets/${name}.wav`);
  sound.volume = volume;
  void sound.play().catch(() => {});
}

let spinMusic: HTMLAudioElement | null = null;
function startSpinMusic(onEnded: () => void) {
  spinMusic?.pause();
  spinMusic = new Audio('/treasures/assets/spin_music.wav');
  const music = spinMusic;
  music.volume = 0.8;
  music.addEventListener('ended', () => {
    if (spinMusic === music) onEnded();
  }, { once: true });
  void music.play().catch(() => {});
}
function finishSpinMusic() {
  const music = spinMusic;
  spinMusic = null;
  if (!music) return;
  if (!music.paused) {
    const started = performance.now();
    const initialVolume = music.volume;
    const fade = (now: number) => {
      const progress = Math.min(1, (now - started) / 800);
      music.volume = initialVolume * (1 - progress);
      if (progress < 1) requestAnimationFrame(fade);
      else music.pause();
    };
    requestAnimationFrame(fade);
  }
  play('spin_music_end', 0.6);
}

function image(id: number) { return `/treasures/assets/${id}.png`; }
function itemById(id: number, treasure: Treasure) { return [...treasure.ordinary, ...treasure.bonuses].find(item => item.id === id)!; }
function preloadHero(itemId: number) {
  void import('./HeroPreview').then(module => module.preloadHero(itemId)).catch(() => {});
}
function rarityTier(rarity?: string) { return rarity === 'Rare' ? 0 : rarity === 'Very Rare' ? 1 : rarity === 'Cosmically Rare' ? 3 : 2; }
function odds(value: number) {
  const n = 1 / value;
  return `1 : ${n > 20 ? Math.ceil(Math.fround(n)) : n.toFixed(1)}`;
}
function percentChance(value: number) {
  const percent = value * 100;
  const digits = percent >= 1 ? 2 : percent >= 0.01 ? 3 : 4;
  return `${percent.toFixed(digits).replace(/\.?0+$/, '')}%`;
}
function ordinal(value: number) {
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th';
  return `${value}${suffix}`;
}

function App() {
  const [view, setView] = useState<'gallery' | 'treasure'>('gallery');
  const [selectedTreasureId, setSelectedTreasureId] = useState(TREASURES[0].id);
  const treasure = TREASURES.find(entry => entry.id === selectedTreasureId)!;
  const allItems = [...treasure.ordinary, ...treasure.bonuses];
  const [galleryNotice, setGalleryNotice] = useState('');
  const [initial] = useState(loadHistories);
  const [histories, setHistories] = useState(initial.histories);
  const history = histories[treasure.id] ?? [];
  const state = replay(history, treasure);
  const [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<Phase>('preview');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [panelTab, setPanelTab] = useState<'stats' | 'odds'>('stats');
  const [oddsIndex, setOddsIndex] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency>(() => {
    try { return localStorage.getItem(CURRENCY_KEY) === 'USD' ? 'USD' : 'EUR'; }
    catch { return 'EUR'; }
  });
  const keyCost = (openings: number) => {
    const cents = openingCostCents(treasure.id, openings, currency);
    return cents === null ? 'Price unavailable' : moneyFormat[currency].format(cents / 100);
  };
  function chooseCurrency(value: Currency) {
    setCurrency(value);
    try { localStorage.setItem(CURRENCY_KEY, value); } catch { /* preference remains active until reload */ }
  }
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [selected, setSelected] = useState<number>(TREASURES[0].ordinary[0].id);
  const [interactiveId, setInteractiveId] = useState<number | null>(null);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  const timers = useRef<number[]>([]);
  const autoStartFirst = useRef(false);
  const galleryScrollY = useRef(0);
  useLayoutEffect(() => {
    window.scrollTo(0, view === 'gallery' ? galleryScrollY.current : 0);
  }, [view]);
  const previewRef = useRef<HTMLDivElement>(null);
  const [spinStep, setSpinStep] = useState(0);
  const [spinMode, setSpinMode] = useState<'windup' | 'eliminating'>('windup');
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!resetConfirm && oddsIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setResetConfirm(false); setOddsIndex(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetConfirm, oddsIndex]);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (view !== 'gallery') return;
    const idle = window.requestIdleCallback(() => {
      preloadHero(TREASURES[0].ordinary[0].id);
    }, { timeout: 2500 });
    return () => window.cancelIdleCallback(idle);
  }, [view]);
  useEffect(() => {
    if (view !== 'treasure') return;
    for (const item of allItems) {
      const image = new Image();
      image.src = `/treasures/assets/hero-turntables/${item.id}.webp?v=orbs3`;
    }
  }, [view, treasure.id]);
  useEffect(() => {
    if (!autoStartFirst.current || view !== 'treasure' || phase !== 'preview') return;
    if (selected !== treasure.ordinary[0].id) { autoStartFirst.current = false; return; }
    const timer = window.setTimeout(() => {
      autoStartFirst.current = false;
      setInteractiveId(treasure.ordinary[0].id);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [view, phase, selected, treasure.id]);

  const fullMask = (1 << treasure.ordinary.length) - 1;
  const seen = state.seen === fullMask ? 0 : state.seen;
  const cycle = Math.floor(state.opened / treasure.ordinary.length) + 1;
  const inCycle = state.opened % treasure.ordinary.length;
  const selectedItem = itemById(selected, treasure);
  const selectedIndex = allItems.findIndex(item => item.id === selected);
  const selectedBonusIndex = selectedIndex - treasure.ordinary.length;
  const selectedBonus = selectedBonusIndex >= 0 ? treasure.bonuses[selectedBonusIndex] : null;
  const selectedCount = count(history, selected);
  const selectedStats = rewardStats(history, selected, treasure);
  const browse = useCallback((direction: number) => {
    setInteractiveId(null);
    setSelected(previous => {
      const items = [...treasure.ordinary, ...treasure.bonuses];
      const index = items.findIndex(item => item.id === previous);
      return items[Math.max(0, Math.min(items.length - 1, index + direction))].id;
    });
  }, [treasure.id]);
  useEffect(() => {
    if (view !== 'treasure' || phase !== 'preview' || resetConfirm) return;
    let lastKey = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey ||
          !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
          (event.target instanceof HTMLElement &&
            (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)))) return;
      event.preventDefault();
      const now = performance.now();
      if (event.repeat && now - lastKey < 140) return;
      lastKey = now;
      browse(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, phase, resetConfirm, browse]);
  useEffect(() => {
    if (view !== 'treasure' || phase !== 'preview') return;
    const element = previewRef.current;
    if (!element) return;
    let lastWheel = 0;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 2) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheel < 300) return;
      lastWheel = now;
      browse(delta > 0 ? 1 : -1);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [view, phase, browse]);

  function open() {
    if (phase !== 'preview' || error) return;
    try {
      const result = draw(state, Date.now(), treasure);
      const nextHistory = [...history, result];
      // Save before the animation, matching the native simulator's commitment rule.
      localStorage.setItem(historyKey(treasure.id), JSON.stringify(nextHistory));
      setHistories(previous => ({ ...previous, [treasure.id]: nextHistory }));
      setOpening(result);
      setRevealIndex(0);
      setSpinStep(0);
      setSpinMode('windup');
      setPhase('spin');
      play('spin', 1);
      timers.current.forEach(clearTimeout);
      timers.current = [];
      const order = eliminationOrder(result, treasure);
      const stepMs = eliminationStepMs(order.length);
      let finished = false;
      const showResult = () => {
        if (finished) return;
        finished = true;
        timers.current.forEach(clearTimeout);
        timers.current = [];
        finishSpinMusic();
        setPhase('reveal');
        setSelected(revealRewards(result, treasure)[0]);
        play('reveal', 0.16);
      };
      startSpinMusic(showResult);
      timers.current.push(window.setTimeout(() => setSpinMode('eliminating'), SPIN_UP_MS));
      for (let i = 1; i <= order.length; i++) {
        timers.current.push(window.setTimeout(() => {
          setSpinStep(i);
          play('remove', 1);
        }, SPIN_UP_MS + ELIMINATION_DELAY_MS + i * stepMs));
      }
      timers.current.push(window.setTimeout(() => {
        if (!spinMusic || spinMusic.paused || spinMusic.ended) showResult();
      }, revealTime(result, treasure) + 150));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Opening could not be saved.');
    }
  }

  function closeReveal() {
    if (opening) {
      const rewards = revealRewards(opening, treasure);
      if (revealIndex + 1 < rewards.length) {
        setRevealIndex(revealIndex + 1);
        setSelected(rewards[revealIndex + 1]);
        play('reveal', 0.16);
        return;
      }
    }
    setPhase('preview'); setOpening(null); setInteractiveId(null);
  }
  function resetHistory() {
    try {
      for (const entry of TREASURES) localStorage.removeItem(historyKey(entry.id));
      localStorage.removeItem(LEGACY_HISTORY_KEY);
    } catch {
      setError('Opening history could not be cleared from this browser.');
      setResetConfirm(false);
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    spinMusic?.pause();
    spinMusic = null;
    autoStartFirst.current = false;
    setHistories(Object.fromEntries(TREASURES.map(entry => [entry.id, []])));
    setOpening(null);
    setSpinStep(0);
    setSpinMode('windup');
    setPhase('preview');
    setSelected(treasure.ordinary[0].id);
    setInteractiveId(null);
    setError('');
    setResetConfirm(false);
  }
  function skipOpening() {
    if (phase !== 'spin' || !opening) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    finishSpinMusic();
    setPhase('reveal');
    setSelected(revealRewards(opening, treasure)[0]);
    play('reveal', 0.16);
  }
  const cyclePool = remaining(state, treasure);
  const revealItems = opening ? revealRewards(opening, treasure) : [];
  const featured = opening ? itemById(revealItems[revealIndex], treasure) : selectedItem;
  const revealRarity = featured.rarity?.toLowerCase().replaceAll(' ', '-') ?? 'regular';
  const featuredStats = rewardStats(history, featured.id, treasure);
  const elimination = opening ? eliminationOrder(opening, treasure) : [];
  const eliminated = new Set(elimination.slice(0, spinStep));
  const winning = opening ? new Set([revealItems[0]]) : new Set<number>();
  const lastEliminatedIndex = spinStep > 0 ? allItems.findIndex(item => item.id === elimination[spinStep - 1]) : -1;
  const totalCost = totalOpeningCost(histories, currency);
  const totalSpend = moneyFormat[currency].format(totalCost.cents / 100);

  return <div className={`app ${view === 'gallery' ? 'gallery-view' : 'detail-view'} ${phase !== 'preview' ? 'opening-active' : ''}`}>
    <header className="topbar">
      <div className="site-identity"><a className="brand" href="/"><img src="/logo-64.webp" width="30" height="30" alt="" /><span>Dota <b>Translator</b></span></a><span className="site-section">Treasures</span></div>
      <div className="topbar-controls">
        {view === 'gallery' && <div className="top-actions"><span className="status-dot" /> {TREASURES.length} treasures available</div>}
        <div className="global-spend" aria-label={`${totalCost.unpricedOpenings ? 'Known spending subtotal' : 'Total spent across all treasures'}: ${totalSpend}`}><span>{totalCost.unpricedOpenings ? 'KNOWN SPENDING' : 'TOTAL SPENT'}</span><strong>{totalSpend}</strong>{totalCost.unpricedOpenings > 0 && <small>+ {totalCost.unpricedOpenings} openings awaiting prices</small>}</div>
        <div className="currency-switch" role="group" aria-label="Display currency" title="USD prices use Dota 2 screenshots where available; others use the standard $2.99 price. Some chests need a separate key."><button className={currency === 'EUR' ? 'active' : ''} onClick={() => chooseCurrency('EUR')} aria-pressed={currency === 'EUR'}>EUR</button><button className={currency === 'USD' ? 'active' : ''} onClick={() => chooseCurrency('USD')} aria-pressed={currency === 'USD'}>USD</button></div>
        <button className="reset-history-button" onClick={() => setResetConfirm(true)}>RESET HISTORY</button>
      </div>
    </header>
    {view === 'gallery' ? <main className="gallery-main">
      <div className="gallery-embers" />
      <div className="gallery-intro"><p className="eyebrow">DOTA 2 TREASURE OPENING SIMULATOR</p><h1>Choose a <span>treasure.</span></h1><p>Experience realistic openings across {TREASURES.length} treasures, with authentic rewards and odds based on Dota 2's in-game data. Each keeps its own opening history.</p></div>
      <div className="gallery-row">{GALLERY.map((entry, i) => {
        const price = listingPriceCents(entry.id, currency);
        const openingPrice = openingCostCents(entry.id, 1, currency);
        return <button key={entry.id} className="gallery-case available"
        title={price !== null && openingPrice !== null && price !== openingPrice ? `Chest ${moneyFormat[currency].format(price / 100)}; key included in ${moneyFormat[currency].format(openingPrice / 100)} opening cost` : undefined}
        onPointerEnter={() => preloadHero(entry.ordinary[0].id)} onFocus={() => preloadHero(entry.ordinary[0].id)} onClick={() => {
          galleryScrollY.current = window.scrollY;
          preloadHero(entry.ordinary[0].id);
          setSelectedTreasureId(entry.id);
          autoStartFirst.current = true;
          setSelected(entry.ordinary[0].id);
          setInteractiveId(null);
          setPhase('preview');
          setOpening(null);
          setView('treasure');
      }} style={{ '--case-index': i, '--case-rgb': CASE_COLORS[entry.id] ?? '120,170,220' } as React.CSSProperties}>
        <div className="case-glow" /><img src={image(entry.id)} alt="" /><span className="case-year">{entry.year}</span><strong>{entry.name}</strong><span className="case-state">VIEW TREASURE  ›</span>
        <span className={`case-price${price === null ? ' case-price-unavailable' : ''}`}>
          {price === null ? 'Price unavailable' : moneyFormat[currency].format(price / 100)}
        </span>
      </button>})}</div>
      <div className="gallery-notice" role="status">{galleryNotice || 'Select a treasure to preview its contents.'}</div>
      <div className="gallery-foot"><a href="/">Dota Translator</a> · LOCAL SIMULATION · NO ITEMS ARE GRANTED TO YOUR DOTA ACCOUNT</div>
    </main> : <main className="shell">
      <button className="gallery-back page-back" onClick={() => setView('gallery')}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M10 5 3 12l7 7M4 12h17" /></svg>
        <span>All treasures</span>
      </button>
      <div className="title-row"><div><p className="eyebrow">{treasure.kind} · {treasure.year}</p><h1>{treasure.name}</h1></div><div className="opened"><strong>{state.opened}</strong><span>TREASURES OPENED</span><em>{keyCost(state.opened)} spent</em></div></div>
      <div className="content">
        <section className={`stage-panel phase-${phase}`} aria-label="Treasure opening">
          <div className="stage-glow" />
          <div className="stage-label">{phase === 'preview' ? 'TREASURE CONTENTS' : phase === 'spin' ? 'OPENING TREASURE' : 'YOUR REWARD'}</div>
          <div className={`stage ${phase} ${phase === 'preview' && selectedBonus ? `preview-rarity-${rarityTier(selectedBonus.rarity)}` : ''} ${phase === 'reveal' ? `reveal-rarity-${revealRarity}` : ''}`}>
            {phase === 'spin' ? <div className={`spin-lineup ${spinMode}`}
              style={{ '--spin-transition': `${Math.min(700, Math.round(eliminationStepMs(elimination.length) * 0.85))}ms` } as React.CSSProperties}>
              <div className="spin-lineup-glow" />
              {allItems.map(item => {
                const index = allItems.findIndex(entry => entry.id === item.id);
                const offset = index - (allItems.length - 1) / 2;
                const isFinalHero = item.id === revealItems[0] && spinStep === elimination.length;
                return <div className={`spin-item model-item ${eliminated.has(item.id) ? 'eliminated' : ''} ${winning.has(item.id) && spinStep === elimination.length ? 'winner' : ''}`} key={item.id}
                  style={{ left: isFinalHero ? '50%' : `calc(50% + ${offset * 8.7}vw)`, '--stagger': `${index * -95}ms` } as React.CSSProperties}>
                  <Model itemId={item.id} motion="spin" />
                </div>;
              })}
              {lastEliminatedIndex >= 0 && <div className="spin-smoke-puff" key={spinStep}
                style={{ left: `calc(50% + ${(lastEliminatedIndex - (allItems.length - 1) / 2) * 8.7}vw)` }} />}
              <div className="spin-floor" />
              <div className="spin-control"><strong>OPEN TREASURE</strong><p>{spinMode === 'windup' ? 'The rewards are gathering…' : 'Revealing the contents…'}</p><div className="spin-control-progress"><i style={{ width: `${spinStep / elimination.length * 100}%` }} /></div><button onClick={skipOpening}>SKIP</button></div>
            </div> : phase === 'preview' ? <div className="preview-lineup" ref={previewRef} aria-label="Treasure rewards; use left and right arrow keys or scroll to browse">
              <button className="preview-arrow arrow-left" onClick={() => browse(-1)} aria-label="Previous reward" disabled={selectedIndex === 0}>‹</button>
              {allItems.map((item, i) => {
                const offset = i - selectedIndex;
                return <button className={`preview-item model-preview-item ${offset === 0 ? 'focused' : ''}`} key={item.id} onClick={() => {
                  if (selected === item.id) setInteractiveId(item.id);
                  else { setSelected(item.id); setInteractiveId(null); }
                }}
                  tabIndex={Math.abs(offset) > 2 ? -1 : 0} aria-label={`Preview ${item.hero}: ${item.name}`}
                  style={{ left: `calc(50% + ${offset * 170}px)`, zIndex: 12 - Math.abs(offset) }}>
                  {Math.abs(offset) <= (viewportWidth < 600 ? 2 : 3) &&
                    <Model itemId={item.id} motion={offset === 0 ? 'focus' : 'side'} interactive={interactiveId === item.id} />}
                </button>;
              })}
              <div className={`reward-identity ${selectedBonus ? `reward-identity-rare tier-${rarityTier(selectedBonus.rarity)}` : ''}`}>
                <div className="reward-identity-main">
                  <div className="reward-identity-icons" aria-hidden="true">✦ ◆ ✧</div>
                  <div className="reward-identity-status">{selectedCount > 0 ? <>RECEIVED {selectedCount > 1 ? `×${selectedCount}` : ''}<b>✓</b></> : 'REWARD PREVIEW'}</div>
                  <div className="reward-identity-text"><strong>{selectedItem.hero}</strong><span>{selectedItem.name}</span></div>
                </div>
                {selectedBonus && <button className="reward-identity-rarity rarity-odds-button" aria-haspopup="dialog" aria-label={`Show odds for ${selectedBonus.name}`} onClick={() => setOddsIndex(selectedBonusIndex)}><span>BONUS REWARD</span><strong>{selectedBonus.rarity} ↗</strong></button>}
                <small className="reward-identity-hint">DRAG HERO TO ROTATE</small>
              </div>
              <button className="preview-arrow arrow-right" onClick={() => browse(1)} aria-label="Next reward" disabled={selectedIndex === allItems.length - 1}>›</button>
            </div> : <>
              <div className="art-halo" /><Model itemId={featured.id} motion="reveal" large />
              {phase === 'reveal' && <div className="reveal-plate">{featured.rarity && <div className="reveal-rarity-banner">✦ {featured.rarity.toUpperCase()} BONUS REWARD ✦</div>}<div className="reward-identity-status">RECEIVED <b>✓</b></div><div className="reward-identity-text"><strong>{featured.hero}</strong><span>{featured.name}</span></div></div>}
              <div className="reveal-control"><strong>{featured.rarity ? `${featured.rarity.toUpperCase()} REWARD` : 'REWARD RECEIVED'}</strong><p>{featured.name}</p>{revealItems.length > 1 && <p className="reveal-award-count">Reward {revealIndex + 1} of {revealItems.length} · Same treasure</p>}<div className="reveal-spend"><span>{featuredStats.copies === 1 ? 'FIRST RECEIVED' : `COPY ${featuredStats.copies}`}</span><b>Opening #{state.opened}</b><small>{featuredStats.firstOpening === state.opened ? `${keyCost(state.opened)} spent to find it` : `First found on opening #${featuredStats.firstOpening}`}</small></div><button onClick={closeReveal}>{revealIndex + 1 < revealItems.length ? 'NEXT REWARD' : 'DONE'}</button></div>
            </>}
          </div>
          {phase === 'reveal' && opening && !!opening.bonuses && <div className="bonus-reveal">BONUS REWARDS · {treasure.bonuses.filter((_, i) => opening.bonuses & (1 << i)).map(item => `${item.rarity.toUpperCase()} — ${item.name}`).join(' · ')}</div>}
          {phase === 'preview' && <div className="stage-footer"><button className="open-button" onClick={open} disabled={!!error || state.opened >= 10000}>OPEN TREASURE <span>›</span></button></div>}
        </section>
        <aside className="side-panel">
          <div className="panel-tabs" role="tablist" aria-label="Treasure information"><button role="tab" aria-selected={panelTab === 'stats'} className={panelTab === 'stats' ? 'active' : ''} onClick={() => setPanelTab('stats')}>REWARD STATS</button><button role="tab" aria-selected={panelTab === 'odds'} className={panelTab === 'odds' ? 'active' : ''} onClick={() => setPanelTab('odds')}>ODDS</button></div>
          {panelTab === 'stats' ? <div className="reward-stats" role="tabpanel">
            <span className="stats-eyebrow">SELECTED REWARD</span><strong className="stats-name">{selectedItem.name}</strong><span className="stats-hero">{selectedItem.hero}</span>
            <div className="stats-grid"><div><span>FIRST RECEIVED</span><strong>{selectedStats.firstOpening ? `#${selectedStats.firstOpening}` : '—'}</strong></div><div><span>COST TO FIRST</span><strong>{selectedStats.firstOpening ? keyCost(selectedStats.firstOpening) : '—'}</strong></div><div><span>TOTAL COPIES</span><strong>{selectedStats.copies}</strong></div><div><span>DUPLICATES</span><strong>{selectedStats.duplicates}</strong></div></div>
            <p className="stats-note">{selectedStats.lastOpening ? `Last received on opening #${selectedStats.lastOpening}` : `Not yet received after ${state.opened} ${state.opened === 1 ? 'opening' : 'openings'}`}</p>
            <div className="stats-total"><span>THIS TREASURE</span><strong>{state.opened}</strong><span>PER OPENING</span><strong>{keyCost(1)}</strong></div>
            {history.length > 0 && <button className="review-last-opening" onClick={() => {
              const last = history[history.length - 1];
              setOpening(last); setRevealIndex(0); setPhase('reveal');
              setSelected(revealRewards(last, treasure)[0]);
            }}>VIEW LAST OPENING</button>}
          </div> : <div role="tabpanel">
            <div className="section-heading"><span>OPENING PROGRESS</span><b>CYCLE {cycle}</b></div>
            <div className="progress-track"><div style={{ width: `${inCycle / treasure.ordinary.length * 100}%` }} /></div>
            <p className="progress-note">{inCycle} of {treasure.ordinary.length} regular rewards received this cycle. Each appears once before the pool resets.</p>
            <div className="section-heading odds-heading"><span>{treasure.bonuses.length ? 'NEXT OPENING ODDS' : 'BONUS REWARDS'}</span></div>
            {treasure.bonuses.length ? treasure.bonuses.map((item, i) => <button className={`odds-line bonus-${rarityTier(item.rarity)}`} key={item.id} onClick={() => setOddsIndex(i)} aria-haspopup="dialog" aria-label={`Show odds for ${item.name}`}><span>{item.name}<small>{item.rarity} · VIEW ODDS</small></span><b>{odds(chance(i, state.misses[i], treasure.bonuses))}</b></button>)
              : <p className="progress-note">This treasure has no bonus drops. Each opening awards one standard reward.</p>}
          </div>}
        </aside>
      </div>
      <section className="rewards"><div className="section-heading"><span>TREASURE CONTENTS</span><b>{cyclePool.length} regular rewards remain this cycle</b></div>
        <div className="reward-grid">{allItems.map((item: Item, i) => {
          const ordinaryIndex = treasure.ordinary.findIndex(entry => entry.id === item.id);
          const received = ordinaryIndex >= 0 ? !!(seen & (1 << ordinaryIndex)) : count(history, item.id) > 0;
          const bonusIndex = i - treasure.ordinary.length;
          return <button className={`reward-card ${selected === item.id ? 'active' : ''} ${count(history, item.id) > 0 ? 'received' : ''} ${bonusIndex >= 0 ? `rare-${rarityTier(item.rarity)}` : ''}`} key={item.id} onClick={() => { setSelected(item.id); setInteractiveId(null); }} disabled={phase === 'spin'}>
            <div className="card-art"><img src={image(item.id)} alt="" />{received && <span className="received-mark">RECEIVED</span>}</div>
            <div className="card-copy"><small>{bonusIndex < 0 ? 'REGULAR SET' : treasure.bonuses[bonusIndex].rarity.toUpperCase()}</small><strong>{item.name}</strong><span>{count(history, item.id)} opened</span></div>
          </button>;
        })}</div>
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      <footer>LOCAL SIMULATION · RESULTS STAY IN THIS BROWSER · NO STEAM INVENTORY CHANGES</footer>
    </main>}
    {oddsIndex !== null && treasure.bonuses[oddsIndex] && <div className="odds-modal-backdrop" onClick={() => setOddsIndex(null)}>
      <section className="odds-modal" role="dialog" aria-modal="true" aria-labelledby="odds-modal-title" onClick={event => event.stopPropagation()}>
        <header className={`odds-modal-title tier-${rarityTier(treasure.bonuses[oddsIndex].rarity)}`}>
          <div><span>{treasure.bonuses[oddsIndex].curve === 'fixed' ? 'FIXED ODDS FOR' : 'ESCALATING ODDS INFORMATION FOR'}</span><strong id="odds-modal-title">{treasure.bonuses[oddsIndex].rarity.toUpperCase()} ITEMS</strong></div>
          <button autoFocus onClick={() => setOddsIndex(null)} aria-label="Close odds table">×</button>
        </header>
        <div className="odds-table-head"><span>TREASURE OPENING</span><span>TREASURE ODDS</span><span>CHANCE</span></div>
        <div className="odds-table-body" role="table" aria-label={`${treasure.bonuses[oddsIndex].rarity} odds`}>
          {Array.from({ length: treasure.bonuses[oddsIndex].curve === 'fixed' ? 1 : 50 }, (_, row) => {
            const attempt = row + 1;
            // Keep the displayed ladder anchored at opening 1, as Dota does;
            // the miss streak only moves the NEXT marker along that fixed table.
            const probability = chance(oddsIndex, row, treasure.bonuses);
            const fixed = treasure.bonuses[oddsIndex].curve === 'fixed';
            const isNext = fixed || row === state.misses[oddsIndex];
            return <div className={`odds-table-row ${isNext ? 'next-attempt' : ''}`} role="row" key={attempt} aria-current={isNext ? 'step' : undefined}>
              <span role="cell">{fixed ? 'EACH OPENING' : ordinal(attempt)}{isNext && !fixed && <small>NEXT</small>}</span>
              <span role="cell">{odds(probability)}</span>
              <span role="cell">{percentChance(probability)}</span>
            </div>;
          })}
        </div>
      </section>
    </div>}
    {resetConfirm && <div className="reset-backdrop" onClick={() => setResetConfirm(false)}>
      <div className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-history-title" aria-describedby="reset-history-description" onClick={event => event.stopPropagation()}>
        <h2 id="reset-history-title">Reset opening history?</h2>
        <p id="reset-history-description">This removes every locally saved opening and reward count for all {TREASURES.length} treasures from this browser. It cannot be undone.</p>
        <div className="reset-dialog-actions">
          <button className="reset-cancel" onClick={() => setResetConfirm(false)} autoFocus>CANCEL</button>
          <button className="reset-confirm" onClick={resetHistory}>RESET HISTORY</button>
        </div>
      </div>
    </div>}
  </div>;
}

function offerPreviewDownload(root: HTMLElement, exportPromise: Promise<{ id: number; dataUrl: string }[]>, filename: string, label: string) {
  exportPromise.then(entries => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = 'font:700 18px Arial;padding:18px 28px;margin:32px;background:#335d50;color:white;border:1px solid #80ad92;cursor:pointer';
    button.onclick = () => {
      const blob = new Blob([JSON.stringify(entries)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    if (filename === 'treasure-stills.json' && entries.length === 1) {
      const preview = document.createElement('img');
      preview.src = entries[0].dataUrl;
      preview.alt = `Generated preview for reward ${entries[0].id}`;
      preview.style.cssText = 'display:block;width:320px;height:400px;object-fit:contain;margin:0 32px;background:#1b2630';
      root.replaceChildren(button, preview);
    } else root.replaceChildren(button);
  }).catch(error => { root.textContent = `Export failed: ${String(error)}`; });
}

const previewExportQuery = new URLSearchParams(window.location.search);
const requestedPreviewIds = previewExportQuery.get('ids');
const previewExportIds = [...new Set(requestedPreviewIds
  ? requestedPreviewIds.split(',').map(value => Number(value))
  : ALL_ITEMS.map(item => item.id))];
if (requestedPreviewIds && previewExportIds.some(id => !Number.isSafeInteger(id) || !ALL_ITEMS.some(item => item.id === id))) {
  document.getElementById('root')!.textContent = 'Preview export contains an unknown reward ID.';
} else if (previewExportQuery.has('exportHeroTurntables')) {
  const root = document.getElementById('root')!;
  root.textContent = 'Generating hero turntables…';
  const exportPromise = import('./HeroPreview').then(module => module.generateHeroTurntables(previewExportIds,
    (done, total) => { root.textContent = `Generating hero turntables: ${done} / ${total}`; }));
  (window as Window & { __heroTurntableExport?: Promise<{ id: number; dataUrl: string }[]> }).__heroTurntableExport = exportPromise;
  offerPreviewDownload(root, exportPromise, 'treasure-turntables.json', 'Download generated turntables');
} else if (new URLSearchParams(window.location.search).has('exportHeroStills')) {
  const root = document.getElementById('root')!;
  root.textContent = 'Generating hero stills…';
  const exportPromise = import('./HeroPreview').then(module => module.generateHeroStills(previewExportIds,
    (done, total) => { root.textContent = `Generating hero stills: ${done} / ${total}`; }));
  (window as Window & { __heroStillExport?: Promise<{ id: number; dataUrl: string }[]> }).__heroStillExport = exportPromise;
  offerPreviewDownload(root, exportPromise, 'treasure-stills.json', 'Download generated hero stills');
} else {
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}
