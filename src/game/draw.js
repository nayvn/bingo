// 그림 맞히기: 그리는 사람이 직접 단어를 정해서 그리고, 나머지가 맞힌다.
// 그리는 사람은 돌아가며 바뀐다. 먼저 맞히면 +3, 다음은 +2 … 그린 사람도 맞힌 사람 1명당 +1.
import {
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

// 단어 정하는 시간. 안 정하면 랜덤 단어로 시작
export const DRAW_PICK_MS = 20_000;
export const DRAW_MS = 80_000;
export const DRAW_REVEAL_MS = 4_000;
// 40초가 지나면 초성, 60초가 지나면 첫 글자까지 힌트로 보여 준다
export const DRAW_HINT_AT = [40_000, 60_000];
export const DRAW_ROUND_OPTIONS = [1, 2, 3];
export const MAX_DRAW_WORD = 12;
// 그리는 사람이 연결이 끊겨도 잠깐은 기다려 준다 (새로고침 등)
const DRAWER_GRACE_MS = 10_000;

// 그림 데이터: 좌표는 0~1000 정수, 획(s)마다 잘게 나눠 보낸다
export const PAPER = '#f7f6fb';
export const PALETTE = ['#25232e', '#ff5d6c', '#ff9f43', '#ffd43b', '#3ccf7a', '#3d9bff', '#9b6bff', '#8a5a3b'];
export const SIZES = [5, 12, 28];
export const ERASER_SIZE = 40;
const MAX_SEGS = 6000;
const MAX_POINTS = 400;

// 글자 수: 띄어쓰기는 빼고 센다
export const letterCount = (word) => [...String(word ?? '').replace(/\s/g, '')].length;

export function startDrawing(room, seat, now) {
  const ids = room.players.map((p) => p.id);
  const order = [...ids.slice(seat), ...ids.slice(0, seat)];
  room.draw = { order, turns: order.length * room.drawRounds, turn: -1, log: [], seq: 0, ink: [] };
  nextTurn(room, now);
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
  d.word = null;
  d.stage = 'pick';
  d.pickEndsAt = now + DRAW_PICK_MS;
  d.guessed = [];
  d.lostAt = null;
  d.hint = 0;
  d.ink = [];
  d.key = String(d.turn);
  pushLog(d, { kind: 'system', text: `🎨 ${drawer.name}님이 그릴 단어를 고르는 중…` });
}

function startDraw(room, word, now, random = false) {
  const d = room.draw;
  d.word = word;
  d.stage = 'draw';
  d.startedAt = now;
  d.endsAt = now + DRAW_MS;
  d.hint = 0;
  const name = room.players.find((x) => x.id === d.drawerId)?.name ?? '';
  pushLog(d, {
    kind: 'system',
    text: random ? `⏰ ${name}님이 안 골라서 랜덤 단어로 시작해요` : `✏️ ${name}님이 그리기 시작! (${letterCount(word)}글자)`,
  });
}

function endTurn(room, now, why) {
  const d = room.draw;
  const picked = !!d.word;
  d.stage = 'reveal';
  d.revealUntil = now + DRAW_REVEAL_MS;
  if (!picked) {
    // 단어를 정하기 전에 나가 버림
    pushLog(d, { kind: 'system', text: '그리는 사람이 나가서 다음 차례로 넘어가요' });
    return;
  }
  const head = { all: '모두 맞혔어요!', time: '⏰ 시간 끝!', left: '그리는 사람이 나갔어요.' }[why];
  pushLog(d, { kind: 'system', text: `${head} 정답은 '${d.word}'` });
}

const guessersLeft = (room) =>
  room.players.filter((x) => x.connected && x.id !== room.draw.drawerId && !room.draw.guessed.includes(x.id));

/** 그리는 사람이 그릴 단어를 정한다 */
export function drawPick(room, p, text, now) {
  const d = room.draw;
  if (d.stage !== 'pick' || d.drawerId !== p.id) return fail('지금은 단어를 정할 수 없어요');
  const word = clean(text, MAX_DRAW_WORD).replace(/\s+/g, ' ');
  if (!answerKey(word)) return fail('그릴 단어를 입력해 주세요');
  startDraw(room, word, now);
  return OK;
}

export function drawGuess(room, p, text, now) {
  const d = room.draw;
  const word = clean(text, 20);
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

export function drawTick(room, now) {
  const d = room.draw;
  if (!d) return false;
  if (d.stage === 'pick' || d.stage === 'draw') {
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
  }
  if (d.stage === 'pick') {
    if (now >= d.pickEndsAt) {
      startDraw(room, pickOne(DRAW_WORDS), now, true);
      return true;
    }
    return false;
  }
  if (d.stage === 'draw') {
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
  const ended = room.phase === 'ended';
  const stage = d.stage === 'reveal' || ended ? 'reveal' : d.stage;
  const isDrawer = id === d.drawerId;
  const live = room.phase === 'playing';
  let timeLeft = null;
  if (live && stage === 'pick') timeLeft = Math.max(0, d.pickEndsAt - now);
  if (live && stage === 'draw') timeLeft = Math.max(0, d.endsAt - now);
  return {
    turn: d.turn + 1,
    turns: d.turns,
    drawerId: d.drawerId,
    stage, // pick | draw | reveal
    // 단어는 그리는 사람에게만 (다 끝나면 모두에게)
    word: stage === 'reveal' || isDrawer ? d.word : null,
    hint: !d.word ? null : stage === 'reveal' ? d.word : maskWord(d.word, d.hint >= 2 ? [0] : [], d.hint >= 1 ? 'cho' : 'blank'),
    length: d.word ? letterCount(d.word) : null,
    timeLeft,
    roundMs: stage === 'pick' ? DRAW_PICK_MS : DRAW_MS,
    guessed: [...d.guessed],
    key: d.key,
    log: logView(d.log),
  };
}
