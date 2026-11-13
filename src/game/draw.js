// 그림 맞히기: 한 명이 제시어를 그리고 나머지가 맞힌다. 그리는 사람은 돌아가며 바뀐다.
// 먼저 맞히면 +3, 다음은 +2 … 그린 사람도 맞힌 사람 1명당 +1.
import {
  MAX_WORD,
  OK,
  answerKey,
  clean,
  fail,
  finishByScore,
  logView,
  maskWord,
  pickOne,
  pushLog,
} from './common.js';
import { DRAW_WORDS } from './words.js';

export const DRAW_MS = 80_000;
export const DRAW_REVEAL_MS = 4_000;
// 40초가 지나면 초성, 60초가 지나면 첫 글자까지 힌트로 보여 준다
export const DRAW_HINT_AT = [40_000, 60_000];
export const DRAW_ROUND_OPTIONS = [1, 2, 3];
export const MAX_REROLLS = 2;
// 그리는 사람이 연결이 끊겨도 잠깐은 기다려 준다 (새로고침 등)
const DRAWER_GRACE_MS = 10_000;

// 그림 데이터: 좌표는 0~1000 정수, 획(s)마다 잘게 나눠 보낸다
export const PAPER = '#f7f6fb';
export const PALETTE = ['#25232e', '#ff5d6c', '#ff9f43', '#ffd43b', '#3ccf7a', '#3d9bff', '#9b6bff', '#8a5a3b'];
export const SIZES = [5, 12, 28];
export const ERASER_SIZE = 40;
const MAX_SEGS = 6000;
const MAX_POINTS = 400;

export function startDrawing(room, seat, now) {
  const ids = room.players.map((p) => p.id);
  const order = [...ids.slice(seat), ...ids.slice(0, seat)];
  room.draw = { order, turns: order.length * room.drawRounds, turn: -1, used: [], log: [], seq: 0, ink: [] };
  nextTurn(room, now);
}

function pickWord(d) {
  const pool = DRAW_WORDS.filter((w) => !d.used.includes(w));
  const word = pickOne(pool.length ? pool : DRAW_WORDS);
  d.used.push(word);
  return word;
}

function nextTurn(room, now) {
  const d = room.draw;
  let drawer = null;
  while (!drawer) {
    d.turn += 1;
    if (d.turn >= d.turns) {
      d.turn = d.turns - 1;
      finishByScore(room);
      return;
    }
    const p = room.players.find((x) => x.id === d.order[d.turn % d.order.length]);
    if (p?.connected) drawer = p;
  }
  d.drawerId = drawer.id;
  room.turnId = drawer.id;
  d.word = pickWord(d);
  d.rerolls = 0;
  d.stage = 'draw';
  d.guessed = [];
  d.lostAt = null;
  newCanvas(d, now);
  pushLog(d, { kind: 'system', text: `🎨 ${drawer.name}님이 그릴 차례예요` });
}

function newCanvas(d, now) {
  d.ink = [];
  d.key = `${d.turn}.${d.rerolls}`;
  d.startedAt = now;
  d.endsAt = now + DRAW_MS;
  d.hint = 0;
}

function endTurn(room, now, why) {
  const d = room.draw;
  d.stage = 'reveal';
  d.revealUntil = now + DRAW_REVEAL_MS;
  const head = { all: '모두 맞혔어요!', time: '⏰ 시간 끝!', left: '그리는 사람이 나갔어요.' }[why];
  pushLog(d, { kind: 'system', text: `${head} 정답은 '${d.word}'` });
}

const guessersLeft = (room) =>
  room.players.filter((x) => x.connected && x.id !== room.draw.drawerId && !room.draw.guessed.includes(x.id));

export function drawGuess(room, p, text, now) {
  const d = room.draw;
  const word = clean(text, MAX_WORD);
  if (!word) return fail('정답을 입력해 주세요');
  if (d.stage === 'draw') {
    if (p.id === d.drawerId) return fail('그리는 사람은 채팅할 수 없어요');
    if (d.guessed.includes(p.id)) return fail('이미 맞혔어요! 다른 사람을 기다려요');
    if (answerKey(word) === answerKey(d.word)) {
      const pts = [3, 2][d.guessed.length] ?? 1;
      p.score += pts;
      const drawer = room.players.find((x) => x.id === d.drawerId);
      if (drawer) drawer.score += 1;
      d.guessed.push(p.id);
      pushLog(d, { kind: 'correct', by: p.id, name: p.name, text: `정답! +${pts}점` });
      if (!guessersLeft(room).length) endTurn(room, now, 'all');
      return OK;
    }
  }
  pushLog(d, { kind: 'chat', by: p.id, name: p.name, text: word });
  return OK;
}

export function drawReroll(room, p, now) {
  const d = room.draw;
  if (d.stage !== 'draw' || d.drawerId !== p.id) return fail('지금은 바꿀 수 없어요');
  if (d.guessed.length) return fail('벌써 맞힌 사람이 있어요');
  if (d.rerolls >= MAX_REROLLS) return fail('더는 바꿀 수 없어요');
  d.rerolls += 1;
  d.word = pickWord(d);
  newCanvas(d, now);
  return OK;
}

export function drawTick(room, now) {
  const d = room.draw;
  if (!d) return false;
  if (d.stage === 'draw') {
    const drawer = room.players.find((x) => x.id === d.drawerId);
    if (!drawer?.connected) {
      d.lostAt ??= now;
      if (!drawer || now - d.lostAt >= DRAWER_GRACE_MS) {
        endTurn(room, now, 'left');
        return true;
      }
    } else {
      d.lostAt = null;
    }
    if (now >= d.endsAt) {
      endTurn(room, now, 'time');
      return true;
    }
    // 아직 못 맞힌 사람이 다 나가 버린 경우
    if (d.guessed.length && !guessersLeft(room).length) {
      endTurn(room, now, 'all');
      return true;
    }
    const hint = DRAW_HINT_AT.filter((t) => now - d.startedAt >= t).length;
    if (hint !== d.hint) {
      d.hint = hint;
      return true;
    }
    return false;
  }
  if (now >= d.revealUntil) {
    nextTurn(room, now);
    return true;
  }
  return false;
}

// 같은 획의 조각들을 한 번에 지운다 (되돌리기)
export function undoLast(segs) {
  const s = segs.at(-1)?.s;
  while (segs.length && segs.at(-1).s === s) segs.pop();
}

const validPoint = (n) => Number.isFinite(n) && n >= -50 && n <= 1050;

/** 그리는 사람이 보낸 그림 조각을 검사해서 방에 쌓고, 다른 사람에게 보낼 내용을 돌려준다 */
export function applyInk(room, id, op) {
  const d = room.draw;
  if (room.phase !== 'playing' || !d || d.stage !== 'draw' || d.drawerId !== id) return null;
  if (!op || op.key !== d.key) return null;
  if (op.clear) {
    d.ink = [];
    return { key: d.key, clear: true };
  }
  if (op.undo) {
    undoLast(d.ink);
    return { key: d.key, undo: true };
  }
  const seg = op.seg;
  if (!seg || !Number.isInteger(seg.s) || d.ink.length >= MAX_SEGS) return null;
  if (!(PALETTE.includes(seg.c) || seg.c === PAPER)) return null;
  if (!(SIZES.includes(seg.w) || seg.w === ERASER_SIZE)) return null;
  const p = seg.p;
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 || p.length > MAX_POINTS * 2 || !p.every(validPoint)) return null;
  const clean = { s: seg.s, c: seg.c, w: seg.w, p: p.map(Math.round) };
  d.ink.push(clean);
  return { key: d.key, seg: clean };
}

export function drawView(room, id, now) {
  const d = room.draw;
  if (!d) return null;
  const shown = d.stage === 'reveal' || room.phase === 'ended';
  const isDrawer = id === d.drawerId;
  return {
    turn: d.turn + 1,
    turns: d.turns,
    drawerId: d.drawerId,
    stage: shown ? 'reveal' : 'draw',
    // 그리는 사람에게만 제시어를 보낸다
    word: shown || isDrawer ? d.word : null,
    hint: shown ? d.word : maskWord(d.word, d.hint >= 2 ? [0] : [], d.hint >= 1 ? 'cho' : 'blank'),
    length: [...d.word].length,
    timeLeft: !shown && room.phase === 'playing' ? Math.max(0, d.endsAt - now) : null,
    roundMs: DRAW_MS,
    guessed: [...d.guessed],
    key: d.key,
    rerollsLeft: isDrawer && !shown && !d.guessed.length ? MAX_REROLLS - d.rerolls : 0,
    log: logView(d.log),
  };
}
