import { describe, expect, it } from 'vitest';
import { wikipediaDesc, wiktionaryDesc } from './dict.js';
import { applyAction, createRoom, joinPlayer, raceAdd, raceCheck, tick, viewFor } from './logic.js';
import { MINE_LEVELS, makeField, neighbors } from './mines.js';
import { RACE_COUNT_MS, RACE_JUDGE_MS, RACE_PLAY_MS } from './race.js';

function start(game, now = 0) {
  const room = createRoom('ABCD');
  ['a', 'b', 'c'].forEach((id) => joinPlayer(room, id, id.toUpperCase(), now));
  applyAction(room, 'a', { type: 'game', game }, now);
  room.players.forEach((p) => applyAction(room, p.id, { type: 'ready' }, now));
  expect(room.phase).toBe('playing');
  return room;
}

describe('초성게임', () => {
  it('hides the chosung during the countdown, then checks words', () => {
    const room = start('race');
    room.race.cho = 'ㄱㅅ';
    expect(viewFor(room, 'a', 0).race.cho).toBeNull();
    expect(raceCheck(room, 'a', '가수', 100).ok).toBe(false); // 시작 전
    tick(room, RACE_COUNT_MS);
    const t = RACE_COUNT_MS + 1;
    expect(viewFor(room, 'a', t).race.cho).toBe('ㄱㅅ');
    expect(raceCheck(room, 'a', ' 가 수 ', t)).toEqual({ ok: true, word: '가수' });
    expect(raceCheck(room, 'a', '가수님', t).ok).toBe(false); // 두 글자만
    expect(raceCheck(room, 'a', '사과', t).ok).toBe(false); // 초성 다름
    expect(raceCheck(room, 'a', 'gs', t).ok).toBe(false);
  });

  it('stacks verified words, blocks repeats, and lets the most words win', () => {
    const room = start('race');
    room.race.cho = 'ㄱㅅ';
    tick(room, RACE_COUNT_MS);
    const t = RACE_COUNT_MS + 1000;
    expect(raceAdd(room, 'a', '가수', '노래하는 사람', t).ok).toBe(true);
    expect(raceAdd(room, 'b', '가수', '노래하는 사람', t).ok).toBe(false); // 이미 나옴
    expect(raceCheck(room, 'b', '가수', t).ok).toBe(false);
    raceAdd(room, 'a', '감사', '고마움', t);
    raceAdd(room, 'b', '검사', '조사함', t);
    const end = RACE_COUNT_MS + RACE_PLAY_MS;
    // 시간 안에 받은 단어는 사전 확인이 늦게 끝나도 인정, 시간 뒤에 받은 건 안 됨
    tick(room, end);
    expect(raceAdd(room, 'b', '기상', '날씨', end - 10).ok).toBe(true);
    expect(raceAdd(room, 'b', '거실', '방', end + 10).ok).toBe(false);
    expect(raceCheck(room, 'b', '고사', end + 10).ok).toBe(false);
    const v = viewFor(room, 'c', end);
    expect(v.race.words.map((w) => [w.name, w.word])).toEqual([
      ['A', '가수'],
      ['A', '감사'],
      ['B', '검사'],
      ['B', '기상'],
    ]);
    tick(room, end + RACE_JUDGE_MS);
    expect(room.phase).toBe('ended');
    expect(room.winners.sort()).toEqual(['a', 'b']); // 2개씩 동점
  });

  it('reads short definitions from wiki text', () => {
    const wk = '\n== 한국어 ==\n(표준어/서울) IPA(표기): [ka̠sʰu]발음: [가수]\n\n\n=== 명사 ===\n어원: 한자 歌手\n노래 부르는 일을 직업으로 삼는 사람.\n예문';
    expect(wiktionaryDesc(wk)).toBe('노래 부르는 일을 직업으로 삼는 사람.');
    expect(wiktionaryDesc('\n== 일본어 ==\n뜻')).toBeNull();
    expect(wiktionaryDesc('== 한국어 ==\n=== 명사 ===\n『동물』 어류를 이르는 말 = 물고기')).toBe('어류를 이르는 말');
    const yagu = `
== 한국어 ==


=== 발음 ===
(표준어/서울) IPA(표기): [ja̠ɡu]발음: [야구]


=== 명사 ===
야구 (yagu) (한자 野球)

(스포츠) 아홉 명의 선수로 짜인 두 편이 겨루는 경기.
예문`;
    expect(wiktionaryDesc(yagu, '야구')).toBe('아홉 명의 선수로 짜인 두 편이 겨루는 경기.');
    const akgi = `
== 한국어 ==


=== 어원 ===
한자어 ‘樂器, 樂 + 器’에서 유래.


=== 명사 ===
악기 (akgi) (한자 樂器)

연주에 쓰는 기구.`;
    expect(wiktionaryDesc(akgi, '악기')).toBe('연주에 쓰는 기구.');
    const yeongi = `
== 한국어 ==

=== 명사 ===


==== 명사 1 ====
어원: 延期(연기).
무엇을 나중으로 미룸.
예문`;
    expect(wiktionaryDesc(yeongi, '연기')).toBe('무엇을 나중으로 미룸.');
    expect(wikipediaDesc('사과(沙果)는 과일로 널리 재배되는 열매다. 평과라고도 한다.')).toBe('사과는 과일로 널리 재배되는 열매다.');
  });
});

describe('지뢰찾기', () => {
  it('makes a field with the right mine count and a safe opening around the start', () => {
    for (const key of Object.keys(MINE_LEVELS)) {
      const f = makeField(key);
      const { w, h, m } = MINE_LEVELS[key];
      expect(f.mines).toHaveLength(m);
      expect(new Set(f.mines).size).toBe(m);
      for (const i of [f.start, ...neighbors(f.start, w, h)]) expect(f.mines).not.toContain(i);
      expect(f.mines.every((i) => i >= 0 && i < w * h)).toBe(true);
    }
  });

  it('sends the same board to everyone only after the countdown, and the first to finish wins', () => {
    const room = start('mines');
    expect(viewFor(room, 'a', 0).mines.mines).toBeNull();
    expect(applyAction(room, 'a', { type: 'mineProgress', opened: 5, booms: 0 }, 100).ok).toBe(false);
    tick(room, 3000);
    const va = viewFor(room, 'a', 3000).mines;
    expect(va.mines).toEqual(viewFor(room, 'b', 3000).mines.mines);
    expect(applyAction(room, 'b', { type: 'mineProgress', opened: va.safe, booms: 1 }, 4000).ok).toBe(true);
    expect(room.players.find((p) => p.id === 'b').score).toBe(99); // 완료 신호 전엔 100이 아님
    expect(applyAction(room, 'c', { type: 'mineDone' }, 9000).ok).toBe(true);
    expect(room.phase).toBe('ended');
    expect(room.winners).toEqual(['c']);
    expect(viewFor(room, 'a').mines.doneMs).toBe(6000);
    expect(applyAction(room, 'b', { type: 'mineDone' }, 9100).ok).toBe(false); // 이미 끝남
  });

  it('can be stopped by anyone', () => {
    const room = start('mines');
    tick(room, 3000);
    applyAction(room, 'a', { type: 'mineProgress', opened: 10 }, 4000);
    expect(applyAction(room, 'b', { type: 'stop' }, 5000).ok).toBe(true);
    expect(room.winners).toEqual(['a']);
  });
});
