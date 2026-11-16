import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { MINE_LEVELS, MINE_STUN_MS, neighbors } from '../../game/mines.js';
import { tabStore } from '../../net/storage.js';
import { useCountdown } from '../useCountdown.jsx';
import { GameLobby, Select } from './parts.jsx';

const RULES = [
  '모두 똑같은 판으로 동시에 시작해요',
  '지뢰가 아닌 칸을 먼저 다 연 사람이 승리!',
  '숫자는 주변 8칸의 지뢰 수 · 깃발: 우클릭 / 길게 누르기 / 🚩 모드',
  '지뢰를 밟으면 3초 동안 기절 (게임은 계속)',
];
const LONG_PRESS_MS = 380;
const PROGRESS_EVERY_MS = 250;

export default function MinesGame(props) {
  const { view, send, run, busy, toast, colorOf } = props;
  const g = view.mines;

  if (view.phase === 'lobby' || !g) {
    return (
      <GameLobby
        {...props}
        icon="💣"
        title="지뢰찾기 대결"
        rules={RULES}
        settings={
          <Select
            label="난이도"
            value={view.mineLevel}
            options={Object.entries(MINE_LEVELS).map(([k, v]) => [k, `${v.name} (${v.w}×${v.h}, 지뢰 ${v.m}개)`])}
            onChange={(level) => send({ type: 'mineLevel', level })}
          />
        }
      />
    );
  }
  return <MinesBoard {...props} g={g} run={run} busy={busy} toast={toast} colorOf={colorOf} />;
}

function MinesBoard({ view, myId, send, run, busy, g, colorOf }) {
  const boardKey = g.mines ? `${view.code}.${g.playAt}` : null;
  const ended = view.phase === 'ended';
  const { secondsLeft } = useCountdown(g.timeLeft, view);

  const mineSet = useMemo(() => new Set(g.mines ?? []), [boardKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const around = useMemo(() => {
    const n = g.w * g.h;
    return Array.from({ length: n }, (_, i) => neighbors(i, g.w, g.h).filter((j) => mineSet.has(j)).length);
  }, [mineSet, g.w, g.h]);

  // 내 판 상태: 자주 바뀌니 ref에 두고 다시 그리기만 요청
  const st = useRef(null);
  const [, redraw] = useReducer((x) => x + 1, 0);
  const [now, setNow] = useState(() => Date.now());
  const [flagMode, setFlagMode] = useState(false);

  const storeKey = `mines.${view.code}`;
  const save = () => {
    const s = st.current;
    if (s) tabStore.set(storeKey, { key: s.key, opened: [...s.opened], flags: [...s.flags], boomed: [...s.boomed], startedAt: s.startedAt });
  };

  const flood = (s, from) => {
    const queue = [from];
    while (queue.length) {
      const i = queue.pop();
      if (s.opened.has(i) || s.flags.has(i) || mineSet.has(i)) continue;
      s.opened.add(i);
      if (around[i] === 0) queue.push(...neighbors(i, g.w, g.h));
    }
  };

  // 새 판이 오면 초기화 (새로고침이면 이어서)
  if (boardKey && st.current?.key !== boardKey) {
    const saved = tabStore.get(storeKey);
    if (saved?.key === boardKey) {
      st.current = {
        key: boardKey,
        opened: new Set(saved.opened),
        flags: new Set(saved.flags),
        boomed: new Set(saved.boomed),
        stunUntil: 0,
        startedAt: saved.startedAt,
        done: false,
      };
    } else {
      st.current = { key: boardKey, opened: new Set(), flags: new Set(), boomed: new Set(), stunUntil: 0, startedAt: Date.now(), done: false };
      flood(st.current, g.start);
    }
  }
  const s = boardKey ? st.current : null;

  // 진행률은 모아서 보내기
  const progressTimer = useRef(null);
  const reportSoon = () => {
    if (progressTimer.current) return;
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null;
      const cur = st.current;
      if (cur && !cur.done) send({ type: 'mineProgress', opened: cur.opened.size, booms: cur.boomed.size });
    }, PROGRESS_EVERY_MS);
  };
  useEffect(() => () => clearTimeout(progressTimer.current), []);
  useEffect(() => {
    if (s) reportSoon(); // 시작 칸이 열린 만큼 바로 알림
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  // 시계 (경과 시간, 기절 남은 시간)
  useEffect(() => {
    if (!s || ended) return undefined;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [s, ended]);

  const afterChange = () => {
    save();
    redraw();
    if (s.opened.size >= g.safe && !s.done) {
      s.done = true;
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
      send({ type: 'mineDone' });
    } else {
      reportSoon();
    }
  };

  const stunned = s && now < s.stunUntil;
  const canPlay = s && !ended && !s.done;

  const openCell = (i) => {
    if (s.opened.has(i) || s.flags.has(i) || s.boomed.has(i)) return;
    if (mineSet.has(i)) {
      s.boomed.add(i);
      s.stunUntil = Date.now() + MINE_STUN_MS;
      setNow(Date.now());
      try {
        navigator.vibrate?.([80, 40, 120]);
      } catch {
        /* 진동 미지원 */
      }
      return;
    }
    flood(s, i);
  };

  const toggleFlag = (i) => {
    if (!canPlay || s.opened.has(i) || s.boomed.has(i)) return;
    if (s.flags.has(i)) s.flags.delete(i);
    else s.flags.add(i);
    afterChange();
  };

  const press = (i) => {
    if (!canPlay || Date.now() < s.stunUntil) return;
    if (flagMode && !s.opened.has(i)) return toggleFlag(i);
    if (s.opened.has(i)) {
      // 숫자 칸: 주변 깃발 수가 맞으면 나머지를 한 번에 연다
      const nb = neighbors(i, g.w, g.h);
      const marked = nb.filter((j) => s.flags.has(j) || s.boomed.has(j)).length;
      if (around[i] > 0 && marked === around[i]) nb.forEach((j) => !s.flags.has(j) && openCell(j));
    } else {
      openCell(i);
    }
    afterChange();
  };

  // 터치 길게 누르기 = 깃발. 우클릭도 깃발 (안드로이드는 길게 누르면 contextmenu도 와서 한 번만 처리)
  const pressRef = useRef({ timer: null, long: false, at: 0 });
  const onDown = (i, e) => {
    if (e.button === 2) return;
    const pr = pressRef.current;
    pr.long = false;
    clearTimeout(pr.timer);
    if (e.pointerType !== 'mouse') {
      pr.timer = setTimeout(() => {
        pr.long = true;
        pr.at = Date.now();
        toggleFlag(i);
        try {
          navigator.vibrate?.(25);
        } catch {
          /* 진동 미지원 */
        }
      }, LONG_PRESS_MS);
    }
  };
  const onUp = (i, e) => {
    if (e.button === 2) return;
    const pr = pressRef.current;
    clearTimeout(pr.timer);
    if (!pr.long) press(i);
  };
  const onCancel = () => clearTimeout(pressRef.current.timer);
  const onContext = (i, e) => {
    e.preventDefault();
    const pr = pressRef.current;
    if (Date.now() - pr.at < 600) return;
    pr.at = Date.now();
    toggleFlag(i);
  };

  const stop = () => {
    if (window.confirm('게임을 끝낼까요? 지금까지 연 칸 비율로 순위가 정해져요')) run({ type: 'stop' });
  };

  const left = g.count - (s ? s.flags.size + s.boomed.size : 0);
  const elapsed = s ? ((s.done || ended ? (g.doneMs ?? now - s.startedAt) : now - s.startedAt) / 1000).toFixed(1) : '0.0';
  const myPct = s ? Math.floor((s.opened.size / g.safe) * 100) : 0;

  return (
    <>
      <div className="status-row">
        <span className="round-tag">
          💣 {left} · {MINE_LEVELS[g.level]?.name}
        </span>
        <div className="status">
          {g.stage === 'count' ? <span>곧 시작해요…</span> : <span className="timer">⏱ {elapsed}초</span>}
        </div>
      </div>

      <div className="mine-race">
        {view.players.map((p) => {
          const pr = g.progress[p.id] ?? { opened: 0, booms: 0 };
          const pct = p.id === myId && s ? myPct : Math.floor((pr.opened / g.safe) * 100);
          return (
            <div key={p.id} className={`mine-runner ${colorOf(p.id)} ${view.winners.includes(p.id) ? 'win' : ''}`}>
              <span className="name">
                {view.winners.includes(p.id) && '🏆 '}
                {p.name}
              </span>
              <div className="bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <span className="pct">
                {pct}%{pr.booms ? ` 💥${pr.booms}` : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mine-wrap">
        <div
          className={`mine-board ${stunned ? 'stunned' : ''} ${flagMode ? 'flag-mode' : ''}`}
          style={{ '--w': g.w, '--h': g.h }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {Array.from({ length: g.w * g.h }, (_, i) => {
            if (!s) return <span key={i} className="mc covered" />;
            const open = s.opened.has(i);
            const boom = s.boomed.has(i);
            const flag = s.flags.has(i);
            const showMine = ended && mineSet.has(i) && !flag && !boom;
            let cls = 'mc';
            let content = '';
            if (open) {
              cls += ` open n${around[i]}`;
              content = around[i] || '';
            } else if (boom) {
              cls += ' boom';
              content = '💥';
            } else if (flag) {
              cls += ' covered flag';
              content = '🚩';
            } else if (showMine) {
              cls += ' covered reveal';
              content = '💣';
            } else {
              cls += ' covered';
            }
            return (
              <button
                key={i}
                className={cls}
                tabIndex={-1}
                onPointerDown={(e) => onDown(i, e)}
                onPointerUp={(e) => onUp(i, e)}
                onPointerLeave={onCancel}
                onPointerCancel={onCancel}
                onContextMenu={(e) => onContext(i, e)}
              >
                {content}
              </button>
            );
          })}
          {g.stage === 'count' && (
            <div className="mine-overlay">
              <b key={secondsLeft}>{secondsLeft || 1}</b>
            </div>
          )}
          {stunned && (
            <div className="mine-overlay stun">
              <b>💥 펑!</b>
              <small>{Math.ceil((s.stunUntil - now) / 1000)}초 기절</small>
            </div>
          )}
          {s?.done && !ended && (
            <div className="mine-overlay">
              <b>🎉 다 찾았다!</b>
            </div>
          )}
        </div>
      </div>

      {!ended && (
        <footer className="footer">
          <div className="bar">
            <div className="mode-toggle" role="group" aria-label="누르면">
              <button className={!flagMode ? 'on' : ''} onClick={() => setFlagMode(false)}>
                ⛏️ 열기
              </button>
              <button className={flagMode ? 'on' : ''} onClick={() => setFlagMode(true)}>
                🚩 깃발
              </button>
            </div>
            <button className="btn ghost" disabled={busy} onClick={stop}>
              종료
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
