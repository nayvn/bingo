import { describe, expect, it } from 'vitest';
import { chosung, maskWord } from './common.js';
import { DRAW_HINT_AT, DRAW_MS, DRAW_REVEAL_MS, PALETTE, SIZES } from './draw.js';
import { applyAction, applyInk, createRoom, joinPlayer, removePlayer, setDisconnected, tick, viewFor } from './logic.js';
import { QUIZ_HINT_MS, QUIZ_REVEAL_MS, QUIZ_ROUND_MS, isQuizAnswer } from './quiz.js';

function room3(game, now = 0) {
  const room = createRoom('ABCD');
  ['a', 'b', 'c'].forEach((id) => joinPlayer(room, id, id.toUpperCase(), now));
  expect(applyAction(room, 'a', { type: 'game', game }, now).ok).toBe(true);
  return room;
}
const readyAll = (room, now = 0) => room.players.forEach((p) => applyAction(room, p.id, { type: 'ready' }, now));

describe('helpers', () => {
  it('extracts chosung and masks words', () => {
    expect(chosung('고양이')).toBe('ㄱㅇㅇ');
    expect(chosung('짜장면 2')).toBe('ㅉㅈㅁ 2');
    expect(maskWord('고양이', [0])).toBe('고ㅇㅇ');
    expect(maskWord('고양이', [], 'blank')).toBe('○○○');
  });
});

describe('game select', () => {
  it('switches game only in the lobby and makes everyone ready again', () => {
    const room = createRoom('ABCD');
    joinPlayer(room, 'a', 'A');
    joinPlayer(room, 'b', 'B');
    applyAction(room, 'a', { type: 'ready', board: Array.from({ length: 25 }, (_, i) => `w${i}`) });
    expect(room.deadline).not.toBeNull(); // 빙고 준비 타이머
    applyAction(room, 'b', { type: 'game', game: 'chosung' });
    expect(room.game).toBe('chosung');
    expect(room.players.every((p) => !p.ready)).toBe(true);
    expect(room.deadline).toBeNull();
    expect(applyAction(room, 'a', { type: 'game', game: 'nope' }).ok).toBe(false);
  });

  it('starts quiz and drawing without a board', () => {
    const room = room3('drawing');
    readyAll(room);
    expect(room.phase).toBe('playing');
    expect(applyAction(room, 'a', { type: 'game', game: 'bingo' }).ok).toBe(false);
  });
});

describe('초성퀴즈', () => {
  it('hides the answer, opens hints over time, and gives points to the first right guess', () => {
    const room = room3('chosung');
    applyAction(room, 'a', { type: 'rounds', n: 5 }, 0);
    readyAll(room, 0);
    const answer = room.quiz.deck[0].word;
    const v = viewFor(room, 'b', 0);
    expect(JSON.stringify(v)).not.toContain(answer);
    expect(v.quiz.hint).toBe(chosung(answer));
    expect(v.quiz.total).toBe(5);

    expect(tick(room, QUIZ_HINT_MS)).toBe(true);
    expect(viewFor(room, 'b', QUIZ_HINT_MS).quiz.hint[0]).toBe([...answer][0]);

    applyAction(room, 'b', { type: 'guess', text: '틀린답' }, QUIZ_HINT_MS + 1);
    expect(applyAction(room, 'c', { type: 'guess', text: ` ${answer}! ` }, QUIZ_HINT_MS + 2).ok).toBe(true);
    const c = room.players.find((p) => p.id === 'c');
    expect(c.score).toBe(2); // 힌트 하나 열린 뒤라 2점
    expect(room.quiz.stage).toBe('reveal');
    // 이미 풀린 문제를 또 맞혀도 점수 없음
    applyAction(room, 'b', { type: 'guess', text: answer }, QUIZ_HINT_MS + 3);
    expect(room.players.find((p) => p.id === 'b').score).toBe(0);
    expect(viewFor(room, 'b').quiz.log.map((e) => e.kind)).toEqual(['chat', 'correct', 'chat']);

    tick(room, QUIZ_HINT_MS + 2 + QUIZ_REVEAL_MS);
    expect(room.quiz.index).toBe(1);
  });

  it('accepts another word of the same category with the same chosung', () => {
    expect(isQuizAnswer({ cat: '동물', word: '사자' }, '사자')).toBe(true);
    expect(isQuizAnswer({ cat: '과일·채소', word: '감자' }, '가지')).toBe(true); // 둘 다 ㄱㅈ
    expect(isQuizAnswer({ cat: '동물', word: '사자' }, '사장')).toBe(false); // 분야 단어가 아님
    expect(isQuizAnswer({ cat: '스포츠', word: '족구' }, '축구')).toBe(false);
  });

  it('moves on when time runs out and ends with the top scorer', () => {
    const room = room3('chosung');
    applyAction(room, 'a', { type: 'rounds', n: 5 }, 0);
    readyAll(room, 0);
    let now = 0;
    for (let i = 0; i < 5; i++) {
      if (i === 0) applyAction(room, 'a', { type: 'guess', text: room.quiz.deck[0].word }, now);
      else {
        now = room.quiz.endsAt;
        tick(room, now);
      }
      now = room.quiz.revealUntil;
      tick(room, now);
    }
    expect(room.phase).toBe('ended');
    expect(room.winners).toEqual(['a']);
    expect(viewFor(room, 'a').quiz.answer).toBeTruthy();
  });
});

describe('그림 맞히기', () => {
  const start = () => {
    const room = room3('drawing');
    applyAction(room, 'a', { type: 'rounds', n: 1 }, 0);
    readyAll(room, 0);
    return room;
  };

  it('shows the word only to the drawer', () => {
    const room = start();
    const d = room.draw;
    const others = room.players.filter((p) => p.id !== d.drawerId);
    expect(viewFor(room, d.drawerId).draw.word).toBe(d.word);
    for (const o of others) {
      const v = viewFor(room, o.id);
      expect(v.draw.word).toBeNull();
      expect(JSON.stringify(v)).not.toContain(d.word);
    }
    expect(room.turnId).toBe(d.drawerId);
  });

  it('scores guessers by order, pays the drawer, and rotates the drawer', () => {
    const room = start();
    const d = room.draw;
    const drawer = d.drawerId;
    const [g1, g2] = room.players.filter((p) => p.id !== drawer).map((p) => p.id);
    expect(applyAction(room, drawer, { type: 'guess', text: '힌트' }).ok).toBe(false);
    applyAction(room, g1, { type: 'guess', text: d.word }, 1000);
    expect(applyAction(room, g1, { type: 'guess', text: 'ㅋㅋ' }).ok).toBe(false);
    applyAction(room, g2, { type: 'guess', text: d.word }, 2000);
    const score = (id) => room.players.find((p) => p.id === id).score;
    expect([score(g1), score(g2), score(drawer)]).toEqual([3, 2, 2]);
    expect(d.stage).toBe('reveal');

    tick(room, 2000 + DRAW_REVEAL_MS);
    expect(room.draw.drawerId).not.toBe(drawer);
    expect(room.draw.turn).toBe(1);
  });

  it('gives hints over time and ends the turn when time is up', () => {
    const room = start();
    const g = room.players.find((p) => p.id !== room.draw.drawerId).id;
    expect(viewFor(room, g, 0).draw.hint).toMatch(/^○+$/);
    tick(room, DRAW_HINT_AT[0]);
    expect(viewFor(room, g, DRAW_HINT_AT[0]).draw.hint).toBe(chosung(room.draw.word));
    tick(room, DRAW_MS);
    expect(room.draw.stage).toBe('reveal');
    expect(viewFor(room, g).draw.word).toBe(room.draw.word);
  });

  it('only accepts ink from the drawer for the current canvas, and supports undo/clear', () => {
    const room = start();
    const d = room.draw;
    const g = room.players.find((p) => p.id !== d.drawerId).id;
    const seg = (s) => ({ key: d.key, seg: { s, c: PALETTE[0], w: SIZES[0], p: [10, 10, 20, 20.4] } });
    expect(applyInk(room, g, seg(1))).toBeNull();
    expect(applyInk(room, d.drawerId, { ...seg(1), key: 'old' })).toBeNull();
    expect(applyInk(room, d.drawerId, { key: d.key, seg: { s: 1, c: 'red', w: 5, p: [1, 1] } })).toBeNull();
    expect(applyInk(room, d.drawerId, seg(1)).seg.p).toEqual([10, 10, 20, 20]);
    applyInk(room, d.drawerId, seg(1));
    applyInk(room, d.drawerId, seg(2));
    applyInk(room, d.drawerId, { key: d.key, undo: true });
    expect(d.ink.map((x) => x.s)).toEqual([1, 1]);
    applyInk(room, d.drawerId, { key: d.key, clear: true });
    expect(d.ink).toHaveLength(0);
    // 제시어를 바꾸면 새 그림판
    const before = d.key;
    expect(applyAction(room, d.drawerId, { type: 'reroll' }).ok).toBe(true);
    expect(room.draw.key).not.toBe(before);
  });

  it('skips a drawer who stays disconnected, and finishes after everyone drew', () => {
    const room = start();
    const first = room.draw.drawerId;
    setDisconnected(room, first);
    expect(tick(room, 1000)).toBe(false); // 잠깐은 기다려 줌
    tick(room, 11_000);
    expect(room.draw.stage).toBe('reveal');
    tick(room, 11_000 + DRAW_REVEAL_MS);
    expect(room.draw.drawerId).not.toBe(first);
    let now = 11_000 + DRAW_REVEAL_MS;
    while (room.phase === 'playing') {
      now = room.draw.stage === 'draw' ? room.draw.endsAt : room.draw.revealUntil;
      tick(room, now);
    }
    expect(room.phase).toBe('ended');
    expect(room.winners).toEqual([]); // 아무도 못 맞힘
  });

  it('goes back to the lobby when too few players remain', () => {
    const room = start();
    removePlayer(room, 'a');
    removePlayer(room, 'b');
    expect(room.phase).toBe('lobby');
    expect(room.draw).toBeNull();
  });
});
