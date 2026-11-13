// 초성퀴즈: 분야와 초성을 보고 먼저 맞히는 사람이 점수.
// 10초마다 글자가 하나씩 열리고, 늦게 맞힐수록 점수가 줄어든다 (3 → 2 → 1점).
import { MAX_WORD, OK, answerKey, chosung, clean, fail, finishByScore, logView, maskWord, pushLog, shuffle } from './common.js';
import { QUIZ_WORDS } from './words.js';

export const QUIZ_ROUND_MS = 30_000;
export const QUIZ_HINT_MS = 10_000;
export const QUIZ_REVEAL_MS = 3_500;
export const QUIZ_RANDOM = '랜덤';
export const QUIZ_CATS = Object.keys(QUIZ_WORDS);
export const QUIZ_ROUND_OPTIONS = [5, 10, 15];
const MAX_HINT = 2;

function buildDeck(cat, total) {
  if (QUIZ_WORDS[cat]) return shuffle(QUIZ_WORDS[cat]).slice(0, total).map((word) => ({ cat, word }));
  // 랜덤: 분야가 고루 섞이도록 분야를 한 바퀴씩 돌며 뽑는다
  const pools = Object.fromEntries(QUIZ_CATS.map((c) => [c, shuffle(QUIZ_WORDS[c])]));
  const deck = [];
  let cats = [];
  while (deck.length < total && QUIZ_CATS.some((c) => pools[c].length)) {
    if (!cats.length) cats = shuffle(QUIZ_CATS);
    const c = cats.pop();
    const word = pools[c].pop();
    if (word) deck.push({ cat: c, word });
  }
  return deck;
}

// 힌트 단계별로 열리는 글자 자리: 1단계 첫 글자, 2단계 마지막 글자까지 (두 글자 단어는 첫 글자만)
const openAt = (word, level) => {
  const n = [...word].length;
  if (level <= 0) return [];
  if (level === 1 || n < 3) return [0];
  return [0, n - 1];
};

// 같은 분야에 초성이 똑같은 다른 단어가 있으면 그것도 정답으로 쳐 준다
export function isQuizAnswer(item, guess) {
  const g = answerKey(guess);
  if (!g) return false;
  if (g === answerKey(item.word)) return true;
  if (chosung(g) !== chosung(answerKey(item.word))) return false;
  return QUIZ_WORDS[item.cat]?.some((w) => answerKey(w) === g) ?? false;
}

export function startQuiz(room, now) {
  const deck = buildDeck(room.quizCat, room.quizRounds);
  room.quiz = { deck, total: deck.length, index: -1, stage: 'ask', log: [], seq: 0 };
  nextQuestion(room, now);
}

function nextQuestion(room, now) {
  const q = room.quiz;
  if (q.index + 1 >= q.total) {
    finishByScore(room);
    return;
  }
  q.index += 1;
  q.stage = 'ask';
  q.startedAt = now;
  q.endsAt = now + QUIZ_ROUND_MS;
  q.hint = 0;
  q.solved = null;
}

function reveal(room, now) {
  const q = room.quiz;
  q.stage = 'reveal';
  q.revealUntil = now + QUIZ_REVEAL_MS;
}

export function quizGuess(room, p, text, now) {
  const q = room.quiz;
  const word = clean(text, MAX_WORD);
  if (!word) return fail('정답을 입력해 주세요');
  const item = q.deck[q.index];
  if (q.stage === 'ask' && isQuizAnswer(item, word)) {
    const pts = 3 - q.hint;
    p.score += pts;
    q.solved = { id: p.id, name: p.name, word, pts };
    pushLog(q, { kind: 'correct', by: p.id, name: p.name, text: `정답! +${pts}점` });
    reveal(room, now);
    return OK;
  }
  pushLog(q, { kind: 'chat', by: p.id, name: p.name, text: word });
  return OK;
}

// 시간 흐름 처리. 상태가 바뀌었으면 true (방장이 다시 뿌림)
export function quizTick(room, now) {
  const q = room.quiz;
  if (!q) return false;
  if (q.stage === 'ask') {
    if (now >= q.endsAt) {
      pushLog(q, { kind: 'system', text: `⏰ 시간 끝! 정답은 '${q.deck[q.index].word}'` });
      reveal(room, now);
      return true;
    }
    const hint = Math.min(MAX_HINT, Math.floor((now - q.startedAt) / QUIZ_HINT_MS));
    if (hint !== q.hint) {
      q.hint = hint;
      return true;
    }
    return false;
  }
  if (now >= q.revealUntil) {
    nextQuestion(room, now);
    return true;
  }
  return false;
}

export function quizView(room, now) {
  const q = room.quiz;
  if (!q) return null;
  const item = q.deck[q.index];
  const shown = q.stage === 'reveal' || room.phase === 'ended';
  return {
    round: q.index + 1,
    total: q.total,
    cat: item.cat,
    stage: shown ? 'reveal' : 'ask',
    hint: maskWord(item.word, openAt(item.word, q.hint)),
    hintLevel: q.hint,
    answer: shown ? item.word : null, // 맞히기 전에는 정답을 보내지 않는다
    solved: q.solved ? { ...q.solved } : null,
    timeLeft: !shown && room.phase === 'playing' ? Math.max(0, q.endsAt - now) : null,
    roundMs: QUIZ_ROUND_MS,
    log: logView(q.log),
  };
}
