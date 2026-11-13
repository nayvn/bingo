import { useCallback, useEffect, useRef, useState } from 'react';
import BingoGame from './games/BingoGame.jsx';
import DrawGame from './games/DrawGame.jsx';
import QuizGame from './games/QuizGame.jsx';
import { GAME_INFO, GAME_LIST } from './games/meta.js';

const finePointer = () => window.matchMedia?.('(pointer: fine)').matches;
const GAMES = { bingo: BingoGame, chosung: QuizGame, drawing: DrawGame };

// 방 화면 뼈대: 위쪽 참가자 줄 + 게임 고르기 탭 + 게임 화면 + 결과 창
export default function RoomScreen({ view, role, net, send, leave, toast, ink }) {
  const myId = view.me?.id;
  const me = view.players.find((p) => p.id === myId);
  const lobby = view.phase === 'lobby';
  const playing = view.phase === 'playing';
  const ended = view.phase === 'ended';
  const bingo = view.game === 'bingo';
  const myTurn = playing && view.turnId === myId;
  const turnPlayer = view.players.find((p) => p.id === view.turnId);
  const colorOf = useCallback(
    (id) => {
      const i = view.players.findIndex((p) => p.id === id);
      return i < 0 ? 'c-x' : `c-${i % 3}`;
    },
    [view.players],
  );

  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action) => {
      setBusy(true);
      const res = await send(action);
      setBusy(false);
      if (!res.ok) toast(res.error);
      return res;
    },
    [send, toast],
  );

  // ── 누가 게임을 바꾸면 알림 ──
  const prevGame = useRef(view.game);
  useEffect(() => {
    if (prevGame.current === view.game) return;
    prevGame.current = view.game;
    const by = view.players.find((p) => p.id === view.gameBy);
    const info = GAME_INFO[view.game];
    if (by && by.id !== myId) toast(`${by.name}님이 ${info.icon} ${info.name}(으)로 바꿨어요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.game]);

  // ── 게임이 시작되면 알림 (그림 맞히기는 차례마다 게임 화면에서 알려 줌) ──
  const prevPhase = useRef(view.phase);
  useEffect(() => {
    const started = prevPhase.current === 'lobby' && view.phase === 'playing';
    prevPhase.current = view.phase;
    if (!started) return;
    if (view.game === 'chosung') toast('🔤 초성퀴즈 시작! 먼저 맞히는 사람이 점수를 가져가요');
    else if (bingo && turnPlayer)
      toast(turnPlayer.id === myId ? '🎬 이번 판은 내가 먼저 시작해요!' : `🎬 이번 판은 ${turnPlayer.name}님부터 시작해요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase]);

  // ── 쪼기: 준비 안 한 사람 / 내 차례 아닌데 오래 고민하는(그리는) 사람 재촉 ──
  const hasTurn = bingo || (view.game === 'drawing' && view.draw?.stage === 'draw');
  const slowpokes = lobby
    ? me?.ready
      ? view.players.filter((p) => p.id !== myId && !p.ready && p.connected)
      : []
    : playing && hasTurn && !myTurn && turnPlayer?.connected
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

  // ── 결과 창: 빙고는 줄 긋는 애니메이션을 본 뒤 띄우기 ──
  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    if (!ended) {
      setShowResult(false);
      return undefined;
    }
    const t = setTimeout(() => setShowResult(true), bingo ? 1700 : 1000);
    return () => clearTimeout(t);
  }, [ended, bingo]);

  const invite = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${view.code}`;
    try {
      if (navigator.share && !finePointer()) {
        await navigator.share({ title: '같이 게임하자!', text: `방 코드 ${view.code}`, url });
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

  // 게임 바꾸기: 대기실에서 누구나. 바꾸면 다들 다시 준비해야 해요
  const pickGame = (game) => {
    if (!lobby || game === view.game || busy) return;
    run({ type: 'game', game });
  };

  const score = (p) => (bingo ? p.lines : p.score);
  const unit = bingo ? '줄' : '점';
  const badge = (p) => {
    if (lobby) return <span className={`badge ${p.ready ? 'on' : ''}`}>{p.ready ? '준비' : '대기'}</span>;
    const got = view.draw?.stage === 'draw' && view.draw.guessed.includes(p.id);
    return (
      <span className="badge on">
        {got && '✓ '}
        {score(p)}
        {unit}
      </span>
    );
  };

  const winners = view.players.filter((p) => view.winners.includes(p.id));
  const iWon = view.winners.includes(myId);
  const ranking = [...view.players].sort((a, b) => score(b) - score(a));
  let resultTitle;
  let resultText;
  if (bingo) {
    resultTitle = iWon ? (winners.length > 1 ? '공동 우승!' : '빙고! 우승!') : '아쉬워요!';
    resultText = `${winners.map((w) => w.name).join(', ')}님이 ${view.target}줄 빙고를 먼저 완성했어요`;
  } else if (!winners.length) {
    resultTitle = '무승부!';
    resultText = '아무도 점수를 못 냈어요';
  } else {
    resultTitle = iWon ? (winners.length > 1 ? '공동 우승!' : '우승!') : '아쉬워요!';
    resultText = `${winners.map((w) => w.name).join(', ')}님이 ${winners[0].score}점으로 1등이에요`;
  }

  const Game = GAMES[view.game] ?? BingoGame;

  return (
    <section className={`room game-${view.game}`}>
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
              {badge(p)}
            </li>
          ))}
        </ul>
        <button className="icon-btn" onClick={confirmLeave} aria-label="나가기">
          ✕
        </button>
      </header>

      <nav className="game-tabs" aria-label="게임 고르기">
        {GAME_LIST.map((g) => (
          <button
            key={g}
            className={`tab ${view.game === g ? 'on' : ''}`}
            aria-pressed={view.game === g}
            disabled={!lobby && view.game !== g}
            onClick={() => pickGame(g)}
          >
            <span aria-hidden>{GAME_INFO[g].icon}</span>
            {GAME_INFO[g].name}
          </button>
        ))}
      </nav>

      <Game
        key={view.game}
        view={view}
        me={me}
        myId={myId}
        send={send}
        run={run}
        busy={busy}
        toast={toast}
        net={net}
        ink={ink}
        pokeButton={pokeButton}
        colorOf={colorOf}
        myTurn={myTurn}
        turnPlayer={turnPlayer}
      />

      {ended && (
        <footer className="footer">
          <div className="bar">
            <button className="btn ghost" onClick={() => setShowResult(true)}>
              결과 보기
            </button>
            <button className="btn primary grow" disabled={busy} onClick={() => run({ type: 'restart' })}>
              다시 하기
            </button>
          </div>
        </footer>
      )}

      {ended && showResult && (
        <div className="overlay" onClick={() => setShowResult(false)}>
          <div className="result" onClick={(e) => e.stopPropagation()}>
            <div className="result-emoji">{iWon ? '🎉' : winners.length ? '🥲' : '🤝'}</div>
            <h2>{resultTitle}</h2>
            <p>{resultText}</p>
            <ol className="ranking">
              {ranking.map((p) => (
                <li key={p.id} className={view.winners.includes(p.id) ? 'win' : ''}>
                  <span className={`dot ${colorOf(p.id)}`} />
                  <span className="name">
                    {p.name}
                    {p.id === myId && ' (나)'}
                  </span>
                  <b>
                    {score(p)}
                    {unit}
                  </b>
                </li>
              ))}
            </ol>
            <div className="bar">
              <button className="btn ghost" onClick={() => setShowResult(false)}>
                {bingo ? '판 보기' : '닫기'}
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
