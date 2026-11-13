import { useEffect, useMemo, useRef, useState } from 'react';
import { autofillBoard, suggestTopic, topicWords } from '../../game/autofill.js';
import { shuffle } from '../../game/common.js';
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
} from '../../game/logic.js';
import { tabStore } from '../../net/storage.js';
import Board from '../Board.jsx';
import { Timer, useCountdown } from '../useCountdown.jsx';

const emptyBoard = () => Array(CELLS).fill('');

export default function BingoGame({ view, me, myId, send, run, busy, toast, net, pokeButton, colorOf, myTurn, turnPlayer }) {
  const lobby = view.phase === 'lobby';
  const playing = view.phase === 'playing';

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
  const changeTopic = (text) => {
    setTopic(text);
    send({ type: 'topic', text });
  };
  const recommendTopic = () => changeTopic(suggestTopic(topic));

  // 주제가 정해지면 미리 단어를 받아 둬서, 자동 채우기가 바로 되게
  useEffect(() => {
    if (!lobby || !view.topic.trim()) return undefined;
    const t = setTimeout(() => topicWords(view.topic).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [lobby, view.topic]);

  const toggleReady = () => {
    if (me?.ready) return run({ type: 'unready' });
    const { error } = validateBoard(draft);
    if (error) return toast(error);
    return run({ type: 'ready', board: draft });
  };

  const clearBoard = () => {
    if (filled && window.confirm('빙고판을 모두 지울까요?')) setDraft(emptyBoard());
  };

  // ── 자동 채우기: 주제 단어를 위키에서 가져와 빈 칸에 (없으면 숫자) ──
  const [filling, setFilling] = useState(false);
  const autoFill = async () => {
    if (filling) return null;
    setFilling(true);
    // 같은 단어가 두 번 들어간 칸은 뒤쪽을 비우고 새로 채운다
    const seen = new Set();
    const base = draft.map((w) => {
      const k = norm(w);
      if (!k || seen.has(k)) return '';
      seen.add(k);
      return w;
    });
    const result = await autofillBoard(base, view.topic);
    setFilling(false);
    setDraft(result.board);
    return result;
  };
  const fillText = ({ fromWiki, fromNumbers }) => {
    if (!fromWiki && !fromNumbers) return '이미 다 채워져 있어요';
    if (!view.topic.trim()) return `주제가 없어서 ${fromNumbers}칸을 숫자로 채웠어요`;
    if (!fromWiki) return `'${view.topic}' 단어를 못 찾아서 ${fromNumbers}칸을 숫자로 채웠어요`;
    return `'${view.topic}' 단어로 ${fromWiki}칸 채웠어요${fromNumbers ? ` · 나머지 ${fromNumbers}칸은 숫자` : ''}`;
  };
  const onAutoFill = async () => {
    const result = await autoFill();
    if (result) toast(fillText(result));
  };

  // ── 준비 타이머: 누가 먼저 준비하면 1분 30초. 끝나면 빈 칸 자동 채우고 바로 준비 ──
  const { deadlineAt, secondsLeft } = useCountdown(view.timeLeft, view);
  const timeUpHandled = useRef(null);
  useEffect(() => {
    if (!lobby || me?.ready || secondsLeft !== 0 || timeUpHandled.current === deadlineAt) return;
    timeUpHandled.current = deadlineAt;
    (async () => {
      const result = await autoFill();
      if (!result) return;
      const empty = result.fromWiki + result.fromNumbers;
      toast(empty ? `⏰ 시간 끝! 빈 칸 ${empty}개를 자동으로 채웠어요` : '⏰ 시간 끝! 바로 준비할게요');
      run({ type: 'ready', board: result.board });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, lobby, me?.ready, deadlineAt]);

  // ── 단어 부르기: 내 차례에 빙고판 칸을 누르면 그 단어를 부른다 ──
  const pick = (i) => {
    const w = board[i];
    if (!myTurn || busy || !w) return;
    if (keys.has(norm(w))) return toast('이미 나온 단어예요');
    return run({ type: 'call', word: w });
  };

  // 게임 중 단어 기록은 항상 최신이 보이게
  const stripRef = useRef(null);
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [view.called.length]);

  const readyCount = view.players.filter((p) => p.ready).length;
  let status;
  if (net === 'reconnecting') status = <span className="warn">연결 다시 시도 중…</span>;
  else if (lobby)
    status =
      view.players.length < MIN_PLAYERS ? (
        <span>친구를 초대해 주세요</span>
      ) : (
        <span className="lobby-status">
          준비 {readyCount}/{view.players.length}
          <Timer seconds={secondsLeft} soon={30} urgent={10} clock />
        </span>
      );
  else if (myTurn) status = <span className="my-turn">내 차례! 단어를 불러요</span>;
  else if (playing) status = <span>{turnPlayer?.name ?? '…'}님 차례</span>;
  else status = <span>게임 끝!</span>;

  const mode = lobby ? (me?.ready ? 'locked' : 'edit') : 'play';

  return (
    <>
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
          onChange={(e) => changeTopic(e.target.value)}
        />
        {lobby && (
          <button className="suggest-btn" onClick={recommendTopic} title="주제 자동 추천">
            🎲 추천
          </button>
        )}
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
              : secondsLeft != null
                ? `${filled}/${CELLS}칸 · 시간이 끝나면 빈 칸은 자동으로 채워져요`
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

      {lobby && (
        <footer className="footer">
          <div className="bar">
            {!me?.ready && (
              <>
                <button className="btn ghost" onClick={onAutoFill} disabled={filling} title="주제에 맞는 단어로 빈 칸 채우기">
                  {filling ? '채우는 중…' : '✨ 자동'}
                </button>
                <button className="btn ghost" onClick={() => setDraft((d) => shuffle(d))} title="칸 섞기">
                  🔀 섞기
                </button>
                <button className="btn ghost" onClick={clearBoard} disabled={!filled} title="빙고판 비우기">
                  🧹 비우기
                </button>
              </>
            )}
            {pokeButton}
            <button className={`btn grow ${me?.ready ? 'ghost' : 'primary'}`} disabled={busy} onClick={toggleReady}>
              {me?.ready ? '준비 취소' : '준비 완료'}
            </button>
          </div>
        </footer>
      )}
      {playing && (
        <footer className="footer">
          <div className="bar">
            <div className={`turn-banner ${myTurn ? 'mine' : ''}`}>
              {myTurn ? '👆 빙고판에서 부를 칸을 눌러요' : `${turnPlayer?.name ?? ''}님이 고르는 중…`}
            </div>
            {!myTurn && pokeButton}
          </div>
        </footer>
      )}
    </>
  );
}
