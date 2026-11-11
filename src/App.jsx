import { useEffect, useState } from 'react';
import JoinScreen from './components/JoinScreen.jsx';
import PokeStorm from './components/PokeStorm.jsx';
import RoomScreen from './components/RoomScreen.jsx';
import { useBingo } from './net/useBingo.js';

export default function App() {
  const bingo = useBingo();
  const inRoom = bingo.screen === 'room';

  // 쪼이면 화면이 부르르 떨림
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (!bingo.poke) return undefined;
    setShake(false);
    const start = requestAnimationFrame(() => setShake(true));
    const stop = setTimeout(() => setShake(false), 700);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(stop);
    };
  }, [bingo.poke]);

  return (
    <div className={`app ${shake ? 'shake' : ''}`}>
      {inRoom && bingo.view?.me ? (
        <RoomScreen
          key={bingo.view.code}
          view={bingo.view}
          role={bingo.role}
          net={bingo.net}
          send={bingo.send}
          leave={bingo.leave}
          toast={bingo.toast}
        />
      ) : inRoom ? (
        <div className="loading">방에 들어가는 중…</div>
      ) : (
        <JoinScreen
          busy={bingo.screen === 'connecting'}
          error={bingo.error}
          onCreate={bingo.create}
          onJoin={bingo.join}
        />
      )}
      <PokeStorm poke={bingo.poke} />
      <div className="toasts" aria-live="polite">
        {bingo.toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
