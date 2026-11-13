// 여러 게임이 같이 쓰는 작은 도구들

export const MAX_WORD = 20;

// 비교용 키: 공백 무시, 대소문자 무시
export const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
export const clean = (s, max) => String(s ?? '').normalize('NFC').trim().slice(0, max);
// 정답 비교용: 공백·문장부호까지 무시 ("고양이?" == "고양이")
export const answerKey = (s) => norm(s).replace(/[^\p{L}\p{N}]/gu, '');

export const OK = { ok: true };
export const fail = (error) => ({ ok: false, error });

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const syllable = (ch) => {
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 ? c : -1;
};
export const choOf = (ch) => {
  const c = syllable(ch);
  return c < 0 ? ch : CHO[Math.floor(c / 588)];
};
export const chosung = (s) => [...String(s ?? '')].map(choOf).join('');
export const isCho = (ch) => CHO.includes(ch);

/**
 * 힌트용으로 단어를 가린다. open에 든 자리는 그대로 보여 주고,
 * 나머지는 초성(hideAs='cho') 또는 동그라미(hideAs='blank')로.
 */
export function maskWord(word, open = [], hideAs = 'cho') {
  return [...word]
    .map((ch, i) => {
      if (ch === ' ' || open.includes(i)) return ch;
      return hideAs === 'blank' ? '○' : choOf(ch);
    })
    .join('');
}

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// 채팅/정답 기록. 너무 길어지지 않게 최근 것만 남긴다
const LOG_KEEP = 40;
export function pushLog(state, entry) {
  state.seq = (state.seq ?? 0) + 1;
  state.log.push({ id: state.seq, ...entry });
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}
export const logView = (log) => log.slice(-30).map((e) => ({ ...e }));

// 점수 게임 끝: 최고점인 사람(들)이 우승. 모두 0점이면 우승자 없음
export function finishByScore(room) {
  room.phase = 'ended';
  room.turnId = null;
  const top = Math.max(0, ...room.players.map((p) => p.score ?? 0));
  room.winners = top > 0 ? room.players.filter((p) => p.score === top).map((p) => p.id) : [];
}
