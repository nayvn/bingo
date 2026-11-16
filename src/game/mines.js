// 지뢰찾기 대결: 모두 똑같은 판으로 동시에 시작해서, 지뢰 아닌 칸을 먼저 다 연 사람이 승리.
// 판은 각자 화면에서 바로 열고(빠르게), 방장에게는 진행률만 알린다.
// 지뢰를 밟으면 게임이 끝나는 대신 잠깐 기절(못 누름)하고 계속한다.
import { OK, fail, finishByScore } from './common.js';

export const MINE_LEVELS = {
  easy: { name: '쉬움', w: 9, h: 9, m: 10 },
  normal: { name: '보통', w: 12, h: 12, m: 24 },
  hard: { name: '어려움', w: 14, h: 14, m: 38 },
};
export const MINE_COUNT_MS = 3_000;
export const MINE_STUN_MS = 3_000;

export function neighbors(i, w, h) {
  const x = i % w;
  const y = Math.floor(i / w);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
  }
  return out;
}

/** 시작 칸 주변 3x3은 비워서, 모두 같은 자리에서 한 번에 넓게 열리며 시작한다 */
export function makeField(levelKey, rand = Math.random) {
  const { w, h, m } = MINE_LEVELS[levelKey] ?? MINE_LEVELS.easy;
  // 가장자리를 피한 시작 칸
  const sx = 1 + Math.floor(rand() * (w - 2));
  const sy = 1 + Math.floor(rand() * (h - 2));
  const start = sy * w + sx;
  const safe = new Set([start, ...neighbors(start, w, h)]);
  const pool = [...Array(w * h).keys()].filter((i) => !safe.has(i));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { w, h, mines: pool.slice(0, m).sort((a, b) => a - b), start };
}

export function startMines(room, now) {
  const field = makeField(room.mineLevel);
  room.mines = {
    ...field,
    level: room.mineLevel,
    safe: field.w * field.h - field.mines.length,
    playAt: now + MINE_COUNT_MS,
    stage: 'count',
    progress: Object.fromEntries(room.players.map((p) => [p.id, { opened: 0, booms: 0 }])),
    doneMs: null,
  };
}

const percent = (opened, safe) => Math.min(100, Math.floor((opened / safe) * 100));

export function mineProgress(room, p, action, now) {
  const g = room.mines;
  if (now < g.playAt) return fail('아직 시작 전이에요');
  g.stage = 'play';
  const opened = Math.max(0, Math.min(g.safe, Math.floor(Number(action.opened) || 0)));
  const booms = Math.max(0, Math.floor(Number(action.booms) || 0));
  g.progress[p.id] = { opened, booms };
  // 다 열었는데 진행률만 왔다면 마지막 칸 직전 99%로 둔다 (완료는 done으로만)
  p.score = Math.min(99, percent(opened, g.safe));
  return OK;
}

export function mineDone(room, p, now) {
  const g = room.mines;
  if (now < g.playAt) return fail('아직 시작 전이에요');
  g.stage = 'play';
  g.progress[p.id] = { ...(g.progress[p.id] ?? { booms: 0 }), opened: g.safe };
  p.score = 100;
  g.doneMs = now - g.playAt;
  finishByScore(room);
  return OK;
}

export function minesTick(room, now) {
  const g = room.mines;
  if (g?.stage === 'count' && now >= g.playAt) {
    g.stage = 'play';
    return true;
  }
  return false;
}

export function minesView(room, now) {
  const g = room.mines;
  if (!g) return null;
  const started = g.stage !== 'count';
  return {
    stage: room.phase === 'ended' ? 'done' : g.stage, // count | play | done
    level: g.level,
    w: g.w,
    h: g.h,
    count: g.mines.length,
    // 판은 시작할 때 모두에게 동시에 보낸다
    mines: started ? [...g.mines] : null,
    start: started ? g.start : null,
    playAt: g.playAt, // 같은 판인지 알아보는 표시로만 씀
    timeLeft: started ? null : Math.max(0, g.playAt - now),
    safe: g.safe,
    progress: Object.fromEntries(Object.entries(g.progress).map(([id, v]) => [id, { ...v }])),
    doneMs: g.doneMs,
  };
}
