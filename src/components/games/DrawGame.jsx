import { useEffect, useRef, useState } from 'react';
import { DRAW_ROUND_OPTIONS, ERASER_SIZE, PALETTE, PAPER, SIZES } from '../../game/draw.js';
import DrawCanvas from '../DrawCanvas.jsx';
import { TimeBar, Timer, useCountdown } from '../useCountdown.jsx';
import { Feed, GameLobby, GuessBar, Select } from './parts.jsx';

const RULES = [
  '한 명이 제시어를 그리면 나머지가 맞혀요',
  '그리는 사람은 돌아가면서 바뀌어요 · 한 번에 80초',
  '먼저 맞히면 +3점, 다음 사람은 +2점',
  '그린 사람도 맞힌 사람 1명당 +1점 · 40초 뒤엔 초성 힌트',
];

export default function DrawGame(props) {
  const { view, myId, send, run, busy, toast, colorOf, pokeButton, ink } = props;
  const d = view.draw;
  const playing = view.phase === 'playing';
  const { msLeft, secondsLeft } = useCountdown(d?.timeLeft ?? null, view);
  const [color, setColor] = useState(PALETTE[0]);
  const [size, setSize] = useState(SIZES[1]);
  const eraser = color === PAPER;

  // 그림판이 비었는지 (안내 문구용)
  const [blank, setBlank] = useState(() => !ink.store.get().segs.length);
  useEffect(() => ink.store.subscribe(() => setBlank(!ink.store.get().segs.length)), [ink.store]);

  // 새 차례(또는 제시어 변경)면 그림판 비우기
  useEffect(() => {
    if (d?.key) ink.store.sync(d.key);
  }, [d?.key, ink.store]);

  // 차례가 바뀌면 누가 그리는지 알려 주기
  const prevTurn = useRef(null);
  const drawer = view.players.find((p) => p.id === d?.drawerId);
  const isDrawer = d?.drawerId === myId;
  useEffect(() => {
    if (!d || !playing || prevTurn.current === d.turn) return;
    prevTurn.current = d.turn;
    toast(isDrawer ? '🎨 내가 그릴 차례예요! 제시어를 그려 주세요' : `🎨 ${drawer?.name ?? ''}님이 그릴 차례예요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.turn, playing]);

  if (view.phase === 'lobby' || !d) {
    return (
      <GameLobby
        {...props}
        icon="🎨"
        title="그림 맞히기"
        rules={RULES}
        settings={
          <Select
            label="그리기"
            value={view.drawRounds}
            options={DRAW_ROUND_OPTIONS.map((n) => [n, `한 사람당 ${n}번`])}
            onChange={(n) => send({ type: 'rounds', n: Number(n) })}
          />
        }
      />
    );
  }

  const drawing = playing && d.stage === 'draw';
  const guessed = d.guessed.includes(myId);
  const guess = async (text) => {
    const res = await send({ type: 'guess', text });
    if (!res.ok) toast(res.error);
  };
  const reroll = () => {
    if (ink.store.get().segs.length && !window.confirm('그린 그림이 지워져요. 제시어를 바꿀까요?')) return;
    run({ type: 'reroll' });
  };

  let word;
  if (!drawing) {
    word = (
      <>
        <span className="topic-label">정답</span>
        <b className="word">{d.word}</b>
      </>
    );
  } else if (isDrawer) {
    word = (
      <>
        <span className="topic-label">제시어</span>
        <b className="word">{d.word}</b>
        {d.rerollsLeft > 0 && (
          <button className="suggest-btn" disabled={busy} onClick={reroll} title="다른 제시어로 바꾸기">
            🔄 바꾸기 {d.rerollsLeft}
          </button>
        )}
      </>
    );
  } else {
    word = (
      <>
        <span className="topic-label">{drawer?.name ?? ''}님 그림</span>
        <b className="word hint">
          {d.hint}
          <small className="word-len">{d.length}글자</small>
        </b>
      </>
    );
  }

  let footer = null;
  if (drawing && isDrawer) {
    footer = (
      <div className="tools">
        <div className="swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'on' : ''}`}
              style={{ '--sw': c }}
              aria-label={`색 ${c}`}
              onClick={() => {
                setColor(c);
                if (size === ERASER_SIZE) setSize(SIZES[1]);
              }}
            />
          ))}
        </div>
        <div className="sizes">
          {SIZES.map((s) => (
            <button
              key={s}
              className={`size ${!eraser && s === size ? 'on' : ''}`}
              aria-label={`굵기 ${s}`}
              onClick={() => {
                setSize(s);
                if (eraser) setColor(PALETTE[0]);
              }}
            >
              <i style={{ width: 4 + s / 2.2, height: 4 + s / 2.2, background: eraser ? 'var(--text-soft)' : color }} />
            </button>
          ))}
          <button
            className={`tool ${eraser ? 'on' : ''}`}
            title="지우개"
            onClick={() => {
              setColor(PAPER);
              setSize(ERASER_SIZE);
            }}
          >
            🧽
          </button>
          <button className="tool" title="되돌리기" onClick={() => ink.send({ key: d.key, undo: true })}>
            ↩
          </button>
          <button className="tool" title="모두 지우기" onClick={() => ink.send({ key: d.key, clear: true })}>
            🗑
          </button>
        </div>
      </div>
    );
  } else if (drawing && guessed) {
    footer = <div className="turn-banner mine">🎉 맞혔어요! 다른 사람을 기다리는 중…</div>;
  } else if (playing) {
    footer = (
      <GuessBar
        onSend={guess}
        placeholder={drawing ? '정답 입력 후 Enter' : '채팅…'}
        extra={drawing ? pokeButton : null}
      />
    );
  }

  return (
    <>
      <div className={`topic-row word-bar ${isDrawer && drawing ? 'mine' : ''}`}>
        {word}
        <span className="word-turn">
          {d.turn}/{d.turns}
        </span>
        {drawing && <Timer seconds={secondsLeft} soon={20} urgent={10} />}
      </div>
      <TimeBar msLeft={drawing ? msLeft : 0} total={d.roundMs} />

      <div className="canvas-wrap">
        <DrawCanvas store={ink.store} canDraw={drawing && isDrawer} color={color} size={size} onOp={ink.send} />
        {drawing && isDrawer && blank && <p className="canvas-hint">여기에 그려요 ✏️</p>}
      </div>

      <Feed log={d.log} colorOf={colorOf} compact empty="정답을 맞혀 보세요!" />

      {footer && <footer className="footer">{footer}</footer>}
    </>
  );
}
