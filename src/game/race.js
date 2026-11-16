// 초성게임: 랜덤 초성 두 개가 나오면 10초 동안 그 초성의 두 글자 단어를 최대한 많이.
// 사전(위키)에 있는 단어만 인정, 한 번 나온 단어는 누구도 다시 못 씀. 많이 쓴 사람이 승리.
import { OK, chosung, fail, finishByScore, isSyllable, pickOne } from './common.js';

export const RACE_COUNT_MS = 3_000; // 3, 2, 1
export const RACE_PLAY_MS = 10_000;
// 시간이 끝난 직후 아직 사전 확인 중인 단어를 기다려 주는 시간
export const RACE_JUDGE_MS = 3_000;

// 두 글자 단어가 충분히 많은 초성 조합만
export const RACE_PAIRS = [
  'ㄱㅅ', 'ㄱㅈ', 'ㄱㅇ', 'ㄱㄱ', 'ㄱㅂ', 'ㄱㄹ', 'ㄱㅁ', 'ㄴㅁ', 'ㄷㄱ', 'ㄷㅅ', 'ㄷㅈ',
  'ㅁㄹ', 'ㅁㅈ', 'ㅂㄱ', 'ㅂㄷ', 'ㅂㅅ', 'ㅂㅈ', 'ㅅㄱ', 'ㅅㄹ', 'ㅅㅈ', 'ㅅㅇ', 'ㅇㄱ',
  'ㅇㄹ', 'ㅇㅅ', 'ㅇㅈ', 'ㅈㄱ', 'ㅈㅅ', 'ㅈㅇ', 'ㅊㄱ', 'ㅎㄱ', 'ㅎㅅ', 'ㅎㅈ',
];

export function startRace(room, now) {
  room.race = {
    cho: pickOne(RACE_PAIRS),
    stage: 'count', // count | play | judge
    playAt: now + RACE_COUNT_MS,
    endsAt: now + RACE_COUNT_MS + RACE_PLAY_MS,
    judgeUntil: now + RACE_COUNT_MS + RACE_PLAY_MS + RACE_JUDGE_MS,
    words: [],
    seq: 0,
  };
}

export const raceWordKey = (text) => String(text ?? '').normalize('NFC').replace(/\s+/g, '');

/** 사전 확인 전에 할 수 있는 검사 (시간, 두 글자, 초성, 중복) */
export function raceCheck(room, id, text, now) {
  const r = room.race;
  if (room.phase !== 'playing' || room.game !== 'race' || !r) return fail('게임 중이 아니에요');
  if (!room.players.some((p) => p.id === id)) return fail('방에 참여하지 않았어요');
  if (now < r.playAt) return fail('아직 시작 전이에요');
  if (now > r.endsAt) return fail('시간이 끝났어요');
  const word = raceWordKey(text);
  if (!word) return fail('단어를 입력해 주세요');
  if ([...word].length !== 2 || ![...word].every(isSyllable)) return fail('두 글자 한글 단어만 돼요');
  if (chosung(word) !== r.cho) return fail(`초성이 ${[...r.cho].join(' ')}이 아니에요`);
  if (r.words.some((w) => w.word === word)) return fail(`'${word}'은(는) 이미 나왔어요`);
  return { ok: true, word };
}

/** 사전 확인을 통과한 단어를 쌓는다. at = 방장이 단어를 받은 시각 */
export function raceAdd(room, id, word, desc, at) {
  const r = room.race;
  if (room.phase !== 'playing' || room.game !== 'race' || !r) return fail('게임이 끝났어요');
  if (at > r.endsAt) return fail('시간이 끝났어요');
  if (r.words.some((w) => w.word === word)) return fail(`'${word}'은(는) 이미 나왔어요`);
  const p = room.players.find((x) => x.id === id);
  if (!p) return fail('방에 참여하지 않았어요');
  p.score += 1;
  r.seq += 1;
  r.words.push({ id: r.seq, by: p.id, name: p.name, word, desc });
  return OK;
}

export function raceTick(room, now) {
  const r = room.race;
  if (!r) return false;
  if (r.stage === 'count' && now >= r.playAt) {
    r.stage = 'play';
    return true;
  }
  if (r.stage === 'play' && now >= r.endsAt) {
    r.stage = 'judge';
    return true;
  }
  if (r.stage === 'judge' && now >= r.judgeUntil) {
    finishByScore(room);
    return true;
  }
  return false;
}

export function raceView(room, now) {
  const r = room.race;
  if (!r) return null;
  const stage = room.phase === 'ended' ? 'done' : r.stage;
  let timeLeft = null;
  if (stage === 'count') timeLeft = Math.max(0, r.playAt - now);
  if (stage === 'play') timeLeft = Math.max(0, r.endsAt - now);
  return {
    stage, // count | play | judge | done
    cho: stage === 'count' ? null : r.cho, // 시작 전엔 안 보여 줌
    timeLeft,
    playMs: RACE_PLAY_MS,
    words: r.words.map((w) => ({ ...w })),
  };
}
