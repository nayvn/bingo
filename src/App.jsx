import JoinScreen from './components/JoinScreen.jsx';
import RoomScreen from './components/RoomScreen.jsx';
import { useBingo } from './net/useBingo.js';

export default function App() {
  const bingo = useBingo();
  const inRoom = bingo.screen === 'room';

  return (
    <div className="app">
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
