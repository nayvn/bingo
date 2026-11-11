import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CELLS,
  MAX_TOPIC,
  MIN_PLAYERS,
  N,
  calledKeys,
  completedLines,
  duplicateIndexes,
  markedCells,
  norm,
  validateBoard,
} from '../game/logic.js';
import { tabStore } from '../net/storage.js';
import Board from './Board.jsx';

const emptyBoard = () => Array(CELLS).fill('');
const finePointer = () => window.matchMedia?.('(pointer: fine)').matches;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function RoomScreen({ view, role, net, send, leave, toast }) {
  const myId = view.me?.id;
  const me = view.players.find((p) => p.id === myId);
  const lobby = view.phase === 'lobby';
  const playing = view.phase === 'playing';
  const ended = view.phase === 'ended';
  const myTurn = playing && view.turnId === myId;
  const turnPlayer = view.players.find((p) => p.id === view.turnId);
  const colorOf = (id) => {
    const i = view.players.findIndex((p) => p.id === id);
    return i < 0 ? 'c-x' : `c-${i % 3}`;
  };

  // ── 내 빙고판 초안 (탭에만 저장, 남에게 안 보냄) ──
  const draftKey = `bingo.draft.${view.code}`;
  const [draft, setDraft] = useState(() => tabStore.get(draftKey) ?? view.me?.board ?? emptyBoard());
  useEffect(() => tabStore.set(draftKey, draft), [draftKey, draft]);

  const board = lobby ? draft : (view.me?.board ?? draft);
  const keys = useMemo(() => calledKeys(view.called), [view.called]);
  const boardKeys = useMemo(() => new Set(board.map(norm)), [board]);
  const marked = useMemo(() => new Set(lobby ? [] : markedCells(board, keys)), [lobby, board, keys]);
  const lines = useMemo(() => (lobby ? [] : completedLines(board, keys)), [lobby, board, keys]);
  const dupes = useMemo(() => (lobby ? duplicateIndexes(draft) : null), [lobby, draft]);
  const filled = draft.filter((w) => w.trim()).length;

  // ── 누가 단어를 부르면: 알림 + 내 칸이면 톡 튀는 효과 ──
  const prevCalled = useRef(null);
  const [popped, setPopped] = useState(() => new Set());
  useEffect(() => {
    const n = view.called.length;
    const prev = prevCalled.current;
    prevCalled.current = n;
    if (prev == null || n <= prev) return;
    const last = view.called[n - 1];
    const idx = board.findIndex((w) => norm(w) === norm(last.word));
    if (last.by !== myId) toast(`${last.byName}: '${last.word}'${idx >= 0 ? ' — 내 판에 있어요!' : ''}`);
    if (idx >= 0) {
      setPopped(new Set([idx]));
      setTimeout(() => setPopped(new Set()), 700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.called.length]);

  // ── 빙고 줄이 늘어나면 큰 글씨로 축하 ──
  const prevLines = useRef(null);
  const burstTimer = useRef(null);
  const [burst, setBurst] = useState(null);
  useEffect(() => {
    const n = lines.length;
    const prev = prevLines.current;
    prevLines.current = n;
    if (prev == null || n <= prev) {
      if (n === 0) setBurst(null);
      return;
    }
    setBurst(`${n}줄 빙고!`);
    try {
      navigator.vibrate?.(120);
    } catch {
      /* 진동 미지원 */
    }
    clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => setBurst(null), 1500);
  }, [lines.length]);

  // ── 주제: 누구든 수정, 모두에게 공유 ──
  const [topic, setTopic] = useState(view.topic);
  const [topicFocused, setTopicFocused] = useState(false);
  useEffect(() => {
    if (!topicFocused) setTopic(view.topic);
  }, [view.topic, topicFocused]);

  const [busy, setBusy] = useState(false);
  const run = async (action) => {
    setBusy(true);
    const res = await send(action);
    setBusy(false);
    if (!res.ok) toast(res.error);
    return res;
  };

  const toggleReady = () => {
    if (me?.ready) return run({ type: 'unready' });
    const { error } = validateBoard(draft);
    if (error) return toast(error);
    return run({ type: 'ready', board: draft });
  };

  const fillNumbers = () => {
    const used = new Set(draft.map(norm));
    const pool = shuffle([...Array(50).keys()].map((i) => String(i + 1)).filter((x) => !used.has(x)));
    setDraft((d) => d.map((w) => (w.trim() ? w : pool.pop() ?? '')));
  };

  // ── 쪼기: 준비 안 한 사람 / 내 차례 아닌데 오래 고민하는 사람 재촉 ──
  const slowpokes = lobby
    ? me?.ready
      ? view.players.filter((p) => p.id !== myId && !p.ready && p.connected)
      : []
    : playing && !myTurn && turnPlayer?.connected
      ? [turnPlayer]
      : [];
  const [pokeCooling, setPokeCooling] = useState(false);
  const pokeTimer = useRef(null);
  useEffect(() => () => clearTimeout(pokeTimer.current), []);
  const poke = async () => {
    if (pokeCooling) return;
    setPokeCooling(true);
    clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => setPokeCooling(false), 2500);
    const res = await send({ type: 'poke' });
    if (res.ok) toast(`${res.names.join(', ')}님을 쪼았어요 👉`);
    else toast(res.error);
  };
  const pokeButton = slowpokes.length > 0 && (
    <button
      className={`btn poke ${pokeCooling ? '' : 'wiggle'}`}
      disabled={pokeCooling}
      onClick={poke}
      title={`${slowpokes.map((p) => p.name).join(', ')}님 재촉하기`}
    >
      👉 쪼기
    </button>
  );

  // ── 단어 부르기: 내 차례에 빙고판 칸을 누르면 그 단어를 부른다 ──
  const pick = (i) => {
    const w = board[i];
    if (!myTurn || busy || !w) return;
    if (keys.has(norm(w))) return toast('이미 나온 단어예요');
    return run({ type: 'call', word: w });
  };

  // ── 결과 창: 줄 긋는 애니메이션을 본 뒤 띄우기 ──
  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    if (!ended) {
      setShowResult(false);
      return undefined;
    }
    const t = setTimeout(() => setShowResult(true), 1700);
    return () => clearTimeout(t);
  }, [ended]);

  // 게임 중 단어 기록은 항상 최신이 보이게
  const stripRef = useRef(null);
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [view.called.length]);

  const invite = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${view.code}`;
    try {
      if (navigator.share && !finePointer()) {
        await navigator.share({ title: '빙고 하자!', text: `방 코드 ${view.code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('초대 링크를 복사했어요');
    } catch (e) {
      if (e?.name !== 'AbortError') toast(`방 코드: ${view.code}`);
    }
  };

  const confirmLeave = () => {
    const msg = role === 'host' ? '방장이 나가면 방이 닫혀요. 나갈까요?' : '방에서 나갈까요?';
    if (window.confirm(msg)) leave();
  };

  const readyCount = view.players.filter((p) => p.ready).length;
  let status;
  if (net === 'reconnecting') status = <span className="warn">연결 다시 시도 중…</span>;
  else if (lobby)
    status =
      view.players.length < MIN_PLAYERS ? (
        <span>친구를 초대해 주세요</span>
      ) : (
        <span>
          준비 {readyCount}/{view.players.length}
        </span>
      );
  else if (myTurn) status = <span className="my-turn">내 차례! 단어를 불러요</span>;
  else if (playing) status = <span>{turnPlayer?.name ?? '…'}님 차례</span>;
  else status = <span>게임 끝!</span>;

  const winners = view.players.filter((p) => view.winners.includes(p.id));
  const iWon = view.winners.includes(myId);
  const ranking = [...view.players].sort((a, b) => b.lines - a.lines);
  const mode = lobby ? (me?.ready ? 'locked' : 'edit') : 'play';

  return (
    <section className="room">
      <header className="topbar">
        <button className="code-chip" onClick={invite} title="초대 링크 복사">
          <small>방</small>
          <b>{view.code}</b>
          <span aria-hidden>↗</span>
        </button>
        <ul className="players">
          {view.players.map((p) => (
            <li
              key={p.id}
              className={[
                'pill',
                colorOf(p.id),
                p.id === view.turnId && 'turn',
                !p.connected && 'offline',
                p.id === myId && 'me',
              ]
                .filter(Boolean)
                .join(' ')}
              title={p.connected ? p.name : `${p.name} (연결 끊김)`}
            >
              <span className="dot" />
              <span className="name">{p.name}</span>
              {lobby ? (
                <span className={`badge ${p.ready ? 'on' : ''}`}>{p.ready ? '준비' : '대기'}</span>
              ) : (
                <span className="badge on">{p.lines}줄</span>
              )}
            </li>
          ))}
        </ul>
        <button className="icon-btn" onClick={confirmLeave} aria-label="나가기">
          ✕
        </button>
      </header>

      <div className="topic-row">
        <span className="topic-label">주제</span>
        <input
          className="topic-input"
          value={topic}
          readOnly={!lobby}
          maxLength={MAX_TOPIC}
          placeholder="예) 과일, 동물, 나라…"
          onFocus={() => setTopicFocused(true)}
          onBlur={() => setTopicFocused(false)}
          onChange={(e) => {
            setTopic(e.target.value);
            send({ type: 'topic', text: e.target.value });
          }}
        />
        {lobby ? (
          <select
            className="target"
            value={view.target}
            aria-label="목표 빙고 줄 수"
            onChange={(e) => send({ type: 'target', n: Number(e.target.value) })}
          >
            {[...Array(N).keys()].map((i) => (
              <option key={i} value={i + 1}>
                {i + 1}줄
              </option>
            ))}
          </select>
        ) : (
          <span className="target-tag">{view.target}줄 빙고</span>
        )}
      </div>
      {lobby && view.topicBy && view.topic && <p className="topic-by">{view.topicBy}님이 정한 주제</p>}

      <div className="status-row">
        <div className="progress" aria-label={`내 빙고 ${lines.length}/${view.target}`}>
          {[...Array(view.target).keys()].map((i) => (
            <span key={i} className={i < lines.length ? 'on' : ''}>
              {'BINGO'[i]}
            </span>
          ))}
        </div>
        <div className="status">{status}</div>
      </div>

      <div className="board-wrap">
        <Board
          cells={board}
          mode={mode}
          marked={marked}
          popped={popped}
          lines={lines}
          dupes={dupes}
          pickable={myTurn && !busy}
          onPick={pick}
          onChange={(i, v) => setDraft((d) => d.map((w, j) => (j === i ? v : w)))}
        />
        {burst && (
          <div className="burst" key={burst}>
            {burst}
          </div>
        )}
      </div>

      <div className="called" ref={stripRef}>
        {lobby ? (
          <span className="hint">
            {me?.ready
              ? '다른 사람을 기다리는 중… (수정하려면 준비 취소)'
              : `${filled}/${CELLS}칸 채움${dupes?.size ? ' · 같은 단어가 있어요' : ''}`}
          </span>
        ) : view.called.length ? (
          view.called.map((c, i) => (
            <span key={i} className={`chip ${colorOf(c.by)} ${boardKeys.has(norm(c.word)) ? 'hit' : ''}`}>
              {c.word}
            </span>
          ))
        ) : (
          <span className="hint">첫 단어를 기다리는 중…</span>
        )}
      </div>

      <footer className="footer">
        {lobby && (
          <div className="bar">
            {!me?.ready && (
              <>
                <button className="btn ghost" onClick={fillNumbers} title="빈 칸을 숫자로 채우기">
                  🎲 숫자
                </button>
                <button className="btn ghost" onClick={() => setDraft((d) => shuffle(d))} title="칸 섞기">
                  🔀 섞기
                </button>
              </>
            )}
            {pokeButton}
            <button className={`btn grow ${me?.ready ? 'ghost' : 'primary'}`} disabled={busy} onClick={toggleReady}>
              {me?.ready ? '준비 취소' : '준비 완료'}
            </button>
          </div>
        )}
        {playing && (
          <div className="bar">
            <div className={`turn-banner ${myTurn ? 'mine' : ''}`}>
              {myTurn ? '👆 빙고판에서 부를 칸을 눌러요' : `${turnPlayer?.name ?? ''}님이 고르는 중…`}
            </div>
            {!myTurn && pokeButton}
          </div>
        )}
        {ended && (
          <div className="bar">
            <button className="btn ghost" onClick={() => setShowResult(true)}>
              결과 보기
            </button>
            <button className="btn primary grow" disabled={busy} onClick={() => run({ type: 'restart' })}>
              다시 하기
            </button>
          </div>
        )}
      </footer>

      {ended && showResult && (
        <div className="overlay" onClick={() => setShowResult(false)}>
          <div className="result" onClick={(e) => e.stopPropagation()}>
            <div className="result-emoji">{iWon ? '🎉' : '🥲'}</div>
            <h2>{iWon ? (winners.length > 1 ? '공동 우승!' : '빙고! 우승!') : '아쉬워요!'}</h2>
            <p>
              {winners.map((w) => w.name).join(', ')}님이 {view.target}줄 빙고를 먼저 완성했어요
            </p>
            <ol className="ranking">
              {ranking.map((p) => (
                <li key={p.id} className={view.winners.includes(p.id) ? 'win' : ''}>
                  <span className={`dot ${colorOf(p.id)}`} />
                  <span className="name">
                    {p.name}
                    {p.id === myId && ' (나)'}
                  </span>
                  <b>{p.lines}줄</b>
                </li>
              ))}
            </ol>
            <div className="bar">
              <button className="btn ghost" onClick={() => setShowResult(false)}>
                판 보기
              </button>
              <button className="btn primary grow" disabled={busy} onClick={() => run({ type: 'restart' })}>
                다시 하기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
