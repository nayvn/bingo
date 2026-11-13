// 놀이방 규칙. 방장 브라우저가 이 로직으로 방 상태를 관리하고,
// 각 참가자에게는 viewFor()로 만든 "자기 시점" 상태만 보낸다.
// 게임: 빙고(이 파일), 초성퀴즈(quiz.js), 그림 맞히기(draw.js)
import { MAX_WORD, OK, clean, fail, norm } from './common.js';
import * as Draw from './draw.js';
import * as Quiz from './quiz.js';

export { MAX_WORD, clean, norm };

export const GAMES = ['bingo', 'chosung', 'drawing'];
export const N = 5;
export const CELLS = N * N;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 3;
export const MAX_TOPIC = 30;
export const MAX_NAME = 10;
// 빙고: 누군가 먼저 준비를 마치면 나머지 사람에게 주는 시간. 끝나면 빈 칸을 자동으로 채워 시작한다.
export const READY_TIMER_MS = 90_000;
// 타이머가 도는 중에 새로 들어온 사람에게 최소한 주는 시간
export const JOIN_GRACE_MS = 60_000;

// 가로 5줄, 세로 5줄, 대각선 2줄
export const LINES = (() => {
  const lines = [];
  const range = [...Array(N).keys()];
  for (const r of range) lines.push(range.map((c) => r * N + c));
  for (const c of range) lines.push(range.map((r) => r * N + c));
  lines.push(range.map((i) => i * N + i));
  lines.push(range.map((i) => i * N + (N - 1 - i)));
  return lines;
})();

export function calledKeys(called) {
  return new Set(called.map((c) => norm(c.word)));
}

export function markedCells(board, keys) {
  if (!board) return [];
  return board.map((w, i) => (w && keys.has(norm(w)) ? i : -1)).filter((i) => i >= 0);
}

export function completedLines(board, keys) {
  if (!board) return [];
  return LINES.map((_, i) => i).filter((i) => LINES[i].every((c) => keys.has(norm(board[c]))));
}

export function duplicateIndexes(board) {
  const byKey = new Map();
  board.forEach((w, i) => {
    const k = norm(w);
    if (!k) return;
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  return new Set([...byKey.values()].filter((v) => v.length > 1).flat());
}

export function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== CELLS) return { error: '빙고판이 올바르지 않아요' };
  const cells = board.map((s) => clean(s, MAX_WORD));
  const empty = cells.filter((c) => !c).length;
  if (empty) return { error: `빈 칸이 ${empty}개 남았어요` };
  const seen = new Set();
  for (const c of cells) {
    const k = norm(c);
    if (seen.has(k)) return { error: `'${c}' 이(가) 두 번 들어갔어요` };
    seen.add(k);
  }
  return { cells };
}

export function createRoom(code) {
  return {
    code,
    game: 'bingo', // bingo | chosung | drawing
    gameBy: null, // 마지막으로 게임을 바꾼 사람 id
    topic: '',
    topicBy: null,
    target: 3,
    quizCat: Quiz.QUIZ_RANDOM,
    quizRounds: 10,
    drawRounds: 2,
    phase: 'lobby', // lobby | playing | ended
    players: [],
    turnId: null,
    called: [],
    winners: [],
    deadline: null, // 준비 마감 시각 (방장 시계 기준 ms)
    nextStarter: null, // 다음 판에 먼저 시작할 자리 번호
    quiz: null,
    draw: null,
  };
}

// 새로고침 후 저장해 둔 방을 되살릴 때, 예전 버전에 없던 값은 기본값으로 채운다
export function restoreRoom(saved) {
  return {
    ...createRoom(saved.code),
    ...saved,
    players: (saved.players ?? []).map((p) => ({ score: 0, lines: 0, ...p })),
  };
}

const findPlayer = (room, id) => room.players.find((p) => p.id === id);

function nextTurn(room) {
  const n = room.players.length;
  if (!n) {
    room.turnId = null;
    return;
  }
  const idx = room.players.findIndex((p) => p.id === room.turnId);
  for (let k = 1; k <= n; k++) {
    const p = room.players[(idx + k + n) % n];
    if (p.connected) {
      room.turnId = p.id;
      return;
    }
  }
}

function maybeStart(room, now) {
  if (room.phase !== 'lobby') return;
  if (room.players.length < MIN_PLAYERS) return;
  if (!room.players.every((p) => p.ready && p.connected)) return;
  room.phase = 'playing';
  room.deadline = null;
  room.called = [];
  room.winners = [];
  room.players.forEach((p) => {
    p.lines = 0;
    p.score = 0;
  });
  // 첫 판은 랜덤, 그다음부터는 시작하는 사람이 한 자리씩 돌아간다
  const n = room.players.length;
  const seat = Number.isInteger(room.nextStarter) ? room.nextStarter % n : Math.floor(Math.random() * n);
  room.nextStarter = (seat + 1) % n;
  if (room.game === 'chosung') {
    room.turnId = null;
    Quiz.startQuiz(room, now);
  } else if (room.game === 'drawing') {
    Draw.startDrawing(room, seat, now);
  } else {
    room.turnId = room.players[seat].id;
  }
}

// 빙고만: 준비한 사람과 안 한 사람이 섞여 있을 때 타이머가 돈다
function updateDeadline(room, now) {
  const waiting = room.game === 'bingo' && room.phase === 'lobby' && room.players.length >= MIN_PLAYERS;
  const anyReady = room.players.some((p) => p.ready);
  const anyNotReady = room.players.some((p) => !p.ready);
  if (waiting && anyReady && anyNotReady) {
    if (!room.deadline) room.deadline = now + READY_TIMER_MS;
  } else {
    room.deadline = null;
  }
}

function resetToLobby(room) {
  room.phase = 'lobby';
  room.deadline = null;
  room.called = [];
  room.winners = [];
  room.turnId = null;
  room.quiz = null;
  room.draw = null;
  room.players.forEach((p) => {
    p.ready = false;
    p.lines = 0;
  });
}

export function joinPlayer(room, id, name, now = Date.now()) {
  name = clean(name, MAX_NAME);
  if (!name) return fail('닉네임을 입력해 주세요');
  let p = findPlayer(room, id);
  if (!p) {
    if (room.phase !== 'lobby') return fail('이미 게임이 진행 중이에요');
    if (room.players.length >= MAX_PLAYERS) return fail(`방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명)`);
    p = { id, name, ready: false, board: null, lines: 0, score: 0, connected: true };
    room.players.push(p);
    if (room.deadline) room.deadline = Math.max(room.deadline, now + JOIN_GRACE_MS);
  }
  p.connected = true;
  if (room.phase === 'lobby') p.name = name;
  maybeStart(room, now);
  updateDeadline(room, now);
  return OK;
}

export function setDisconnected(room, id) {
  const p = findPlayer(room, id);
  if (!p) return;
  p.connected = false;
  // 그림 맞히기는 tick()에서 잠깐 기다렸다가 넘긴다
  if (room.game === 'bingo' && room.phase === 'playing' && room.turnId === id) nextTurn(room);
}

// 나간 사람 이름이 담긴 안내 문구를 돌려준다 (없으면 null)
export function removePlayer(room, id, now = Date.now()) {
  const idx = room.players.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const p = room.players[idx];
  p.connected = false;
  const bingoTurn = room.game === 'bingo' && room.phase === 'playing' && room.turnId === id;
  if (bingoTurn) nextTurn(room);
  room.players.splice(idx, 1);
  if (bingoTurn && room.turnId === id) room.turnId = room.players[0]?.id ?? null;

  let notice = `${p.name}님이 나갔어요`;
  if (room.phase === 'playing' && room.players.length < MIN_PLAYERS) {
    resetToLobby(room);
    notice += ' · 인원이 부족해 대기실로 돌아왔어요';
  }
  maybeStart(room, now);
  updateDeadline(room, now);
  return notice;
}

export function applyAction(room, id, action, now = Date.now()) {
  const p = findPlayer(room, id);
  if (!p) return fail('방에 참여하지 않았어요');
  const lobbyOnly = () => (room.phase === 'lobby' ? null : fail('게임 중에는 바꿀 수 없어요'));

  switch (action?.type) {
    case 'game': {
      const err = lobbyOnly();
      if (err) return err;
      if (!GAMES.includes(action.game)) return fail('없는 게임이에요');
      if (room.game === action.game) return OK;
      // 게임이 바뀌면 다들 다시 준비
      room.game = action.game;
      room.gameBy = p.id;
      room.players.forEach((x) => (x.ready = false));
      updateDeadline(room, now);
      return OK;
    }
    case 'topic': {
      const err = lobbyOnly();
      if (err) return err;
      room.topic = String(action.text ?? '').normalize('NFC').slice(0, MAX_TOPIC);
      room.topicBy = p.name;
      return OK;
    }
    case 'target': {
      const err = lobbyOnly();
      if (err) return err;
      const n = Math.round(Number(action.n));
      if (!(n >= 1 && n <= N)) return fail('목표 줄 수가 올바르지 않아요');
      room.target = n;
      return OK;
    }
    case 'quizCat': {
      const err = lobbyOnly();
      if (err) return err;
      const cat = String(action.cat ?? '');
      if (cat !== Quiz.QUIZ_RANDOM && !Quiz.QUIZ_CATS.includes(cat)) return fail('없는 분야예요');
      room.quizCat = cat;
      return OK;
    }
    case 'rounds': {
      const err = lobbyOnly();
      if (err) return err;
      const n = Number(action.n);
      if (room.game === 'chosung' && Quiz.QUIZ_ROUND_OPTIONS.includes(n)) room.quizRounds = n;
      else if (room.game === 'drawing' && Draw.DRAW_ROUND_OPTIONS.includes(n)) room.drawRounds = n;
      else return fail('횟수가 올바르지 않아요');
      return OK;
    }
    case 'ready': {
      const err = lobbyOnly();
      if (err) return err;
      if (room.game === 'bingo') {
        const { cells, error } = validateBoard(action.board);
        if (error) return fail(error);
        p.board = cells;
      }
      p.ready = true;
      maybeStart(room, now);
      updateDeadline(room, now);
      return OK;
    }
    case 'unready': {
      const err = lobbyOnly();
      if (err) return err;
      p.ready = false;
      updateDeadline(room, now);
      return OK;
    }
    case 'call': {
      if (room.game !== 'bingo' || room.phase !== 'playing') return fail('게임 중이 아니에요');
      if (room.turnId !== id) return fail('내 차례가 아니에요');
      const word = clean(action.word, MAX_WORD);
      if (!word) return fail('단어를 입력해 주세요');
      if (calledKeys(room.called).has(norm(word))) return fail('이미 나온 단어예요');

      room.called.push({ word, by: p.id, byName: p.name });
      const keys = calledKeys(room.called);
      room.players.forEach((x) => (x.lines = completedLines(x.board, keys).length));
      const winners = room.players.filter((x) => x.lines >= room.target);
      if (winners.length) {
        room.phase = 'ended';
        room.winners = winners.map((x) => x.id);
        room.turnId = null;
      } else {
        nextTurn(room);
      }
      return OK;
    }
    case 'guess': {
      if (room.phase !== 'playing') return fail('게임 중이 아니에요');
      if (room.game === 'chosung') return Quiz.quizGuess(room, p, action.text, now);
      if (room.game === 'drawing') return Draw.drawGuess(room, p, action.text, now);
      return fail('알 수 없는 요청이에요');
    }
    case 'reroll': {
      if (room.phase !== 'playing' || room.game !== 'drawing') return fail('지금은 바꿀 수 없어요');
      return Draw.drawReroll(room, p, now);
    }
    case 'restart': {
      if (room.phase !== 'ended') return fail('게임이 아직 안 끝났어요');
      resetToLobby(room);
      return OK;
    }
    default:
      return fail('알 수 없는 요청이에요');
  }
}

// 시간이 흐르며 바뀌는 것(문제 시간, 힌트, 다음 차례). 바뀐 게 있으면 true
export function tick(room, now = Date.now()) {
  if (room.phase !== 'playing') return false;
  if (room.game === 'chosung') return Quiz.quizTick(room, now);
  if (room.game === 'drawing') return Draw.drawTick(room, now);
  return false;
}

export function applyInk(room, id, op) {
  return room.game === 'drawing' ? Draw.applyInk(room, id, op) : null;
}

// 쪼기: 대기실에선 (내가 준비됐을 때) 아직 준비 안 한 사람들, 게임 중엔 지금 차례인 사람
export function pokeTargets(room, fromId) {
  const me = findPlayer(room, fromId);
  if (!me) return { error: '방에 참여하지 않았어요' };
  if (room.phase === 'lobby') {
    if (!me.ready) return { error: '나부터 준비해야 쪼을 수 있어요' };
    const targets = room.players.filter((p) => p.id !== fromId && !p.ready && p.connected);
    if (!targets.length) return { error: '쪼을 사람이 없어요' };
    return { targets: targets.map((p) => p.id) };
  }
  const hasTurn = room.game === 'bingo' || (room.game === 'drawing' && room.draw?.stage === 'draw');
  if (room.phase === 'playing' && hasTurn) {
    if (room.turnId === fromId) return { error: '지금은 내 차례예요' };
    const t = findPlayer(room, room.turnId);
    if (!t?.connected) return { error: '쪼을 사람이 없어요' };
    return { targets: [t.id] };
  }
  return { error: '지금은 쪼을 수 없어요' };
}

// 참가자 한 명에게 보낼 상태. 다른 사람의 빙고판·정답·제시어는 포함하지 않는다.
// 방장 화면도 이 값을 그대로 쓰므로, 방 상태와 배열을 공유하지 않게 복사본을 만든다.
export function viewFor(room, id, now = Date.now()) {
  const me = findPlayer(room, id);
  return {
    code: room.code,
    game: room.game,
    gameBy: room.gameBy,
    topic: room.topic,
    topicBy: room.topicBy,
    target: room.target,
    quizCat: room.quizCat,
    quizRounds: room.quizRounds,
    drawRounds: room.drawRounds,
    phase: room.phase,
    turnId: room.turnId,
    called: room.called.map((c) => ({ ...c })),
    winners: [...room.winners],
    // 기기마다 시계가 달라서 마감 시각 대신 "남은 시간"을 보낸다
    timeLeft: room.deadline ? Math.max(0, room.deadline - now) : null,
    players: room.players.map(({ id, name, ready, connected, lines, score }) => ({
      id,
      name,
      ready,
      connected,
      lines,
      score: score ?? 0,
    })),
    me: me ? { id: me.id, board: me.board ? [...me.board] : null, ready: me.ready } : null,
    quiz: room.game === 'chosung' ? Quiz.quizView(room, now) : null,
    draw: room.game === 'drawing' ? Draw.drawView(room, id, now) : null,
  };
}
