// 빙고 게임 규칙. 방장 브라우저가 이 로직으로 방 상태를 관리하고,
// 각 참가자에게는 viewFor()로 만든 "자기 시점" 상태만 보낸다.

export const N = 5;
export const CELLS = N * N;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 3;
export const MAX_WORD = 20;
export const MAX_TOPIC = 30;
export const MAX_NAME = 10;

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

// 비교용 키: 공백 무시, 대소문자 무시
export const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
export const clean = (s, max) => String(s ?? '').normalize('NFC').trim().slice(0, max);

const OK = { ok: true };
const fail = (error) => ({ ok: false, error });

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
    topic: '',
    topicBy: null,
    target: 3,
    phase: 'lobby', // lobby | playing | ended
    players: [],
    turnId: null,
    called: [],
    winners: [],
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

function maybeStart(room) {
  if (room.phase !== 'lobby') return;
  if (room.players.length < MIN_PLAYERS) return;
  if (!room.players.every((p) => p.ready && p.connected)) return;
  room.phase = 'playing';
  room.called = [];
  room.winners = [];
  room.players.forEach((p) => (p.lines = 0));
  room.turnId = room.players[Math.floor(Math.random() * room.players.length)].id;
}

function resetToLobby(room) {
  room.phase = 'lobby';
  room.called = [];
  room.winners = [];
  room.turnId = null;
  room.players.forEach((p) => {
    p.ready = false;
    p.lines = 0;
  });
}

export function joinPlayer(room, id, name) {
  name = clean(name, MAX_NAME);
  if (!name) return fail('닉네임을 입력해 주세요');
  let p = findPlayer(room, id);
  if (!p) {
    if (room.phase !== 'lobby') return fail('이미 게임이 진행 중이에요');
    if (room.players.length >= MAX_PLAYERS) return fail(`방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명)`);
    p = { id, name, ready: false, board: null, lines: 0, connected: true };
    room.players.push(p);
  }
  p.connected = true;
  if (room.phase === 'lobby') p.name = name;
  maybeStart(room);
  return OK;
}

export function setDisconnected(room, id) {
  const p = findPlayer(room, id);
  if (!p) return;
  p.connected = false;
  if (room.phase === 'playing' && room.turnId === id) nextTurn(room);
}

// 나간 사람 이름이 담긴 안내 문구를 돌려준다 (없으면 null)
export function removePlayer(room, id) {
  const idx = room.players.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const p = room.players[idx];
  p.connected = false;
  if (room.phase === 'playing' && room.turnId === id) nextTurn(room);
  room.players.splice(idx, 1);
  if (room.turnId === id) room.turnId = room.players[0]?.id ?? null;

  let notice = `${p.name}님이 나갔어요`;
  if (room.phase === 'playing' && room.players.length < MIN_PLAYERS) {
    resetToLobby(room);
    notice += ' · 인원이 부족해 대기실로 돌아왔어요';
  }
  maybeStart(room);
  return notice;
}

export function applyAction(room, id, action) {
  const p = findPlayer(room, id);
  if (!p) return fail('방에 참여하지 않았어요');
  const lobbyOnly = () => (room.phase === 'lobby' ? null : fail('게임 중에는 바꿀 수 없어요'));

  switch (action?.type) {
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
    case 'ready': {
      const err = lobbyOnly();
      if (err) return err;
      const { cells, error } = validateBoard(action.board);
      if (error) return fail(error);
      p.board = cells;
      p.ready = true;
      maybeStart(room);
      return OK;
    }
    case 'unready': {
      const err = lobbyOnly();
      if (err) return err;
      p.ready = false;
      return OK;
    }
    case 'call': {
      if (room.phase !== 'playing') return fail('게임 중이 아니에요');
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
    case 'restart': {
      if (room.phase !== 'ended') return fail('게임이 아직 안 끝났어요');
      resetToLobby(room);
      return OK;
    }
    default:
      return fail('알 수 없는 요청이에요');
  }
}

// 참가자 한 명에게 보낼 상태. 다른 사람의 빙고판은 포함하지 않는다.
// 방장 화면도 이 값을 그대로 쓰므로, 방 상태와 배열을 공유하지 않게 복사본을 만든다.
export function viewFor(room, id) {
  const me = findPlayer(room, id);
  return {
    code: room.code,
    topic: room.topic,
    topicBy: room.topicBy,
    target: room.target,
    phase: room.phase,
    turnId: room.turnId,
    called: room.called.map((c) => ({ ...c })),
    winners: [...room.winners],
    players: room.players.map(({ id, name, ready, connected, lines }) => ({ id, name, ready, connected, lines })),
    me: me ? { id: me.id, board: me.board ? [...me.board] : null, ready: me.ready } : null,
  };
}
