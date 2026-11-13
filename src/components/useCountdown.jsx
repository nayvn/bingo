import { useEffect, useState } from 'react';

// 방장이 보낸 "남은 시간"을 받아 내 시계로 센다 (기기마다 시계가 달라서 마감 시각은 안 씀).
// stamp가 바뀔 때마다(=새 상태를 받을 때마다) 다시 맞춘다.
export function useCountdown(timeLeft, stamp) {
  const [deadlineAt, setDeadlineAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = Date.now();
    setNow(t);
    setDeadlineAt(timeLeft == null ? null : t + timeLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  useEffect(() => {
    if (!deadlineAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadlineAt]);
  const msLeft = deadlineAt ? Math.max(0, deadlineAt - now) : null;
  return { deadlineAt, msLeft, secondsLeft: msLeft == null ? null : Math.ceil(msLeft / 1000) };
}

export function Timer({ seconds, soon, urgent, clock = false }) {
  if (seconds == null) return null;
  const text = clock ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}초`;
  return <span className={`timer ${seconds <= urgent ? 'urgent' : seconds <= soon ? 'soon' : ''}`}>⏱ {text}</span>;
}

export function TimeBar({ msLeft, total }) {
  const pct = msLeft == null ? 0 : Math.max(0, Math.min(100, (msLeft / total) * 100));
  return (
    <div className="timebar" aria-hidden>
      <i style={{ width: `${pct}%` }} className={pct < 20 ? 'low' : ''} />
    </div>
  );
}
