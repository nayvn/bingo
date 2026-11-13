import { useEffect, useRef } from 'react';
import { isCho } from '../../game/common.js';
import { QUIZ_CATS, QUIZ_RANDOM, QUIZ_ROUND_OPTIONS } from '../../game/quiz.js';
import { TimeBar, Timer, useCountdown } from '../useCountdown.jsx';
import { Feed, GameLobby, GuessBar, Select } from './parts.jsx';

const RULES = [
  '분야와 초성을 보고 단어를 맞혀요 (예: 동물 · ㄱㅇㅇ)',
  '가장 먼저 맞힌 사람만 점수! 바로 다음 문제로 넘어가요',
  '10초마다 글자가 하나씩 열려요 · 점수는 3 → 2 → 1점',
  '같은 분야에 초성이 같은 단어가 있으면 그것도 정답',
];

export default function QuizGame(props) {
  const { view, send, toast, colorOf } = props;
  const q = view.quiz;
  const playing = view.phase === 'playing';
  const { msLeft, secondsLeft } = useCountdown(q?.timeLeft ?? null, view);

  // 다른 사람이 맞히면 살짝 진동
  const solvedRound = useRef(null);
  useEffect(() => {
    if (!q?.solved || solvedRound.current === q.round) return;
    solvedRound.current = q.round;
    try {
      navigator.vibrate?.(60);
    } catch {
      /* 진동 미지원 */
    }
  }, [q?.solved, q?.round]);

  if (view.phase === 'lobby' || !q) {
    return (
      <GameLobby
        {...props}
        icon="🔤"
        title="초성퀴즈"
        rules={RULES}
        settings={
          <>
            <Select
              label="분야"
              value={view.quizCat}
              options={[[QUIZ_RANDOM, '랜덤 (섞어서)'], ...QUIZ_CATS.map((c) => [c, c])]}
              onChange={(cat) => send({ type: 'quizCat', cat })}
            />
            <Select
              label="문제"
              value={view.quizRounds}
              options={QUIZ_ROUND_OPTIONS.map((n) => [n, `${n}문제`])}
              onChange={(n) => send({ type: 'rounds', n: Number(n) })}
            />
          </>
        }
      />
    );
  }

  const reveal = q.stage === 'reveal';
  const letters = [...(reveal ? q.answer : q.hint)];
  const guess = async (text) => {
    const res = await send({ type: 'guess', text });
    if (!res.ok) toast(res.error);
  };

  return (
    <>
      <div className="status-row">
        <span className="round-tag">
          문제 {q.round}/{q.total}
        </span>
        <div className="status">
          {reveal ? (
            <span>{playing ? '다음 문제 준비 중…' : '게임 끝!'}</span>
          ) : (
            <span className="lobby-status">
              <span className="my-turn">지금 맞히면 +{3 - q.hintLevel}점</span>
              <Timer seconds={secondsLeft} soon={10} urgent={5} />
            </span>
          )}
        </div>
      </div>

      <div className={`quiz-card ${reveal ? 'reveal' : ''}`}>
        <span className="quiz-cat">{q.cat}</span>
        <div className="quiz-word" key={`${q.round}-${reveal ? 'a' : q.hintLevel}`}>
          {letters.map((ch, i) => (
            <span key={i} className={isCho(ch) ? 'cho' : 'open'}>
              {ch}
            </span>
          ))}
        </div>
        {reveal ? (
          <p className="quiz-result">
            {q.solved ? (
              <>
                🎉 <b>{q.solved.name}</b>님 정답! +{q.solved.pts}점
                {q.solved.word.replace(/\s/g, '') !== q.answer && ` ('${q.solved.word}'도 인정)`}
              </>
            ) : (
              '⏰ 아무도 못 맞혔어요'
            )}
          </p>
        ) : (
          <TimeBar msLeft={msLeft} total={q.roundMs} />
        )}
      </div>

      <Feed log={q.log} colorOf={colorOf} empty="떠오르는 단어를 마구 던져 보세요!" />

      {playing && (
        <footer className="footer">
          <GuessBar onSend={guess} placeholder={reveal ? '채팅…' : '정답 입력 후 Enter'} autoFocus />
        </footer>
      )}
    </>
  );
}
