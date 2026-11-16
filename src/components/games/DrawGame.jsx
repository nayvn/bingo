import { useEffect, useRef, useState } from 'react';
import { pickOne } from '../../game/common.js';
import { ERASER_SIZE, MAX_DRAW_WORD, PALETTE, PAPER, SIZES } from '../../game/draw.js';
import { DRAW_WORDS } from '../../game/words.js';
import DrawCanvas from '../DrawCanvas.jsx';
import { TimeBar, Timer, useCountdown } from '../useCountdown.jsx';
import { Feed, GameLobby, GuessBar } from './parts.jsx';

const RULES = [
  '내 차례가 오면 그릴 단어를 직접 정해요 (40초, 안 정하면 랜덤)',
  '다른 사람은 글자 수만 보고 그림을 맞혀요 · 한 번에 80초',
  '돌아가면서 계속 그려요 · 누구든 종료를 누르면 끝',
  '먼저 맞히면 +3점, 다음 사람은 +2점',
  '그린 사람도 맞힌 사람 1명당 +1점 · 40초 뒤엔 초성 힌트',
];

// 그릴 단어 정하기: 직접 입력하거나 🎲로 아무 단어나
function PickBar({ onPick, busy }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const submit = () => {
    if (text.trim() && !busy) onPick(text.trim());
  };
  return (
    <div className="guess-bar">
      <input
        ref={ref}
        className="guess-input"
        value={text}
        maxLength={MAX_DRAW_WORD}
        placeholder="그릴 단어 입력 (남들은 몰라요)"
        autoFocus
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
      />
      <button
        className="btn ghost"
        title="아무 단어나 넣기"
        onClick={() => {
          setText(pickOne(DRAW_WORDS));
          ref.current?.focus();
        }}
      >
        🎲
      </button>
      <button className="btn primary" disabled={busy || !text.trim()} onClick={submit}>
        그리기 시작
      </button>
    </div>
  );
}

export default function DrawGame(props) {
  const { view, myId, send, run, busy, toast, colorOf, ink } = props;
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
    toast(isDrawer ? '🎨 내 차례! 그릴 단어를 정해 주세요' : `🎨 ${drawer?.name ?? ''}님이 그릴 차례예요`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.turn, playing]);

  if (view.phase === 'lobby' || !d) {
    return (
      <GameLobby
        {...props}
        icon="🎨"
        title="그림 맞히기"
        rules={RULES}
        settings={<span className="setting-note">🔁 라운드 제한 없이, 누가 종료할 때까지 계속 이어져요</span>}
      />
    );
  }

  const picking = playing && d.stage === 'pick';
  const drawing = playing && d.stage === 'draw';
  const guessed = d.guessed.includes(myId);
  const guess = async (text) => {
    const res = await send({ type: 'guess', text });
    if (!res.ok) toast(res.error);
  };
  const pick = (text) => run({ type: 'pick', text });
  const stop = () => {
    if (window.confirm('게임을 끝낼까요? 지금까지 점수로 순위가 정해져요')) run({ type: 'stop' });
  };

  let word;
  if (picking) {
    word = (
      <>
        <span className="topic-label">{isDrawer ? '내 차례' : `${drawer?.name ?? ''}님`}</span>
        <b className="word waiting">{isDrawer ? '그릴 단어를 정해 주세요' : '그릴 단어 고르는 중…'}</b>
      </>
    );
  } else if (!drawing) {
    word = (
      <>
        <span className="topic-label">정답</span>
        <b className="word">{d.word ?? '—'}</b>
      </>
    );
  } else if (isDrawer) {
    word = (
      <>
        <span className="topic-label">제시어</span>
        <b className="word">
          {d.word}
          <small className="word-len">{d.length}글자</small>
        </b>
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
  if (picking && isDrawer) {
    footer = <PickBar onPick={pick} busy={busy} />;
  } else if (drawing && isDrawer) {
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
      />
    );
  }

  return (
    <>
      <div className={`topic-row word-bar ${isDrawer && (drawing || picking) ? 'mine' : ''}`}>
        {word}
        <span className="word-turn">{d.turn}번째</span>
        {drawing && <Timer seconds={secondsLeft} soon={20} urgent={10} />}
        {picking && <Timer seconds={secondsLeft} soon={10} urgent={5} />}
        {playing && (
          <button className="stop-btn" disabled={busy} onClick={stop} title="게임 끝내기">
            종료
          </button>
        )}
      </div>
      <TimeBar msLeft={drawing || picking ? msLeft : 0} total={d.roundMs} />

      <div className="canvas-wrap">
        <DrawCanvas store={ink.store} canDraw={drawing && isDrawer} color={color} size={size} onOp={ink.send} />
        {drawing && isDrawer && blank && <p className="canvas-hint">여기에 그려요 ✏️</p>}
        {picking && (
          <p className="canvas-hint">{isDrawer ? '단어를 정하면 그릴 수 있어요' : '곧 그림이 시작돼요 👀'}</p>
        )}
      </div>

      <Feed log={d.log} colorOf={colorOf} compact empty="정답을 맞혀 보세요!" />

      {footer && <footer className="footer">{footer}</footer>}
    </>
  );
}
