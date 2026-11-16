import { TimeBar, Timer, useCountdown } from '../useCountdown.jsx';
import { GameLobby, GuessBar } from './parts.jsx';

const RULES = [
  '초성 두 개가 랜덤으로 나와요 (예: ㄱ ㅅ)',
  '10초 동안 그 초성의 두 글자 단어를 마구 입력! (가수, 감사, 고속…)',
  '사전(위키)에 있는 단어만 인정 · 남이 쓴 단어는 다시 못 써요',
  '많이 쓴 사람이 승리! 쓴 단어는 블럭처럼 쌓여요',
];

export default function RaceGame(props) {
  const { view, send, toast, colorOf } = props;
  const r = view.race;
  const { msLeft, secondsLeft } = useCountdown(r?.timeLeft ?? null, view);

  if (view.phase === 'lobby' || !r) {
    return (
      <GameLobby
        {...props}
        icon="⚡"
        title="초성게임"
        rules={RULES}
        settings={<span className="setting-note">⏱ 10초 동안 누가 더 많이 쓰나! 사전에 있는 두 글자 단어만</span>}
      />
    );
  }

  const counting = r.stage === 'count';
  const playing = r.stage === 'play';
  const done = r.stage === 'done';
  const counts = Object.fromEntries(view.players.map((p) => [p.id, r.words.filter((w) => w.by === p.id).length]));
  const top = Math.max(0, ...Object.values(counts));
  const last = r.words.at(-1);
  const winners = view.players.filter((p) => view.winners.includes(p.id));

  const submit = async (text) => {
    const res = await send({ type: 'race', text });
    if (!res.ok) toast(res.error);
  };

  let status = null;
  if (counting) status = <span>곧 시작해요…</span>;
  else if (playing) status = <Timer seconds={secondsLeft} soon={5} urgent={3} />;
  else if (r.stage === 'judge') status = <span>사전 확인 중…</span>;
  else status = <span>게임 끝!</span>;

  return (
    <>
      <div className="status-row">
        <span className="round-tag">⚡ 초성게임</span>
        <div className="status">{status}</div>
      </div>

      <div className={`quiz-card race-card ${counting ? 'counting' : ''}`}>
        {counting ? (
          <div className="race-count" key={secondsLeft}>
            {secondsLeft || 1}
          </div>
        ) : (
          <div className="quiz-word">
            {[...r.cho].map((ch, i) => (
              <span key={i} className="cho">
                {ch}
              </span>
            ))}
          </div>
        )}
        <TimeBar msLeft={playing ? msLeft : counting ? r.playMs : 0} total={r.playMs} />
      </div>

      <div className="stacks">
        {view.players.map((p) => {
          const mine = r.words.filter((w) => w.by === p.id);
          const leading = top > 0 && counts[p.id] === top;
          return (
            <div key={p.id} className={`stack ${colorOf(p.id)} ${leading ? 'leading' : ''}`}>
              <div className="stack-blocks">
                {mine.map((w) => (
                  <div key={w.id} className="block" title={w.desc}>
                    {w.word}
                  </div>
                ))}
              </div>
              <div className="stack-name">
                {leading && '👑 '}
                <span>{p.name}</span>
                <b>{mine.length}</b>
              </div>
            </div>
          );
        })}

        {last && !done && (
          <div className={`desc-pop ${colorOf(last.by)}`} key={last.id}>
            <b>{last.word}</b>
            <span>{last.desc}</span>
          </div>
        )}

        {done && (
          <div className="race-win">
            <div className="race-win-emoji">{winners.length ? '🏆' : '🤝'}</div>
            <strong>
              {!winners.length
                ? '무승부!'
                : winners.length > 1
                  ? `${winners.map((w) => w.name).join(', ')} 공동 우승!`
                  : `${winners[0].name}님 승리!!`}
            </strong>
            <small>{winners.length ? `${winners[0].score}개 단어를 썼어요` : '아무도 단어를 못 썼어요'}</small>
          </div>
        )}
      </div>

      {view.phase === 'playing' && (
        <footer className="footer">
          <GuessBar
            onSend={submit}
            disabled={r.stage === 'judge'}
            placeholder={counting ? '곧 시작! 입력칸을 눌러 두세요' : '두 글자 단어 입력 후 Enter'}
            autoFocus
          />
        </footer>
      )}
    </>
  );
}
