import { describe, expect, it } from 'vitest';
import {
  LINES,
  applyAction,
  createRoom,
  joinPlayer,
  removePlayer,
  setDisconnected,
  viewFor,
} from './logic.js';

const board = (prefix) => Array.from({ length: 25 }, (_, i) => `${prefix}${i}`);

function readyRoom() {
  const room = createRoom('ABCD');
  joinPlayer(room, 'a', '철수');
  joinPlayer(room, 'b', '영희');
  // 두 사람 판의 첫 줄(0~4)은 같은 단어
  const a = board('x');
  const b = board('y');
  for (let i = 0; i < 5; i++) a[i] = b[i] = `공통${i}`;
  applyAction(room, 'a', { type: 'ready', board: a });
  applyAction(room, 'b', { type: 'ready', board: b });
  return room;
}

describe('bingo logic', () => {
  it('has 12 lines', () => {
    expect(LINES).toHaveLength(12);
  });

  it('limits players to 3 and blocks joining mid-game', () => {
    const room = createRoom('ABCD');
    expect(joinPlayer(room, 'a', 'A').ok).toBe(true);
    expect(joinPlayer(room, 'b', 'B').ok).toBe(true);
    expect(joinPlayer(room, 'c', 'C').ok).toBe(true);
    expect(joinPlayer(room, 'd', 'D').ok).toBe(false);
  });

  it('rejects empty or duplicate cells', () => {
    const room = createRoom('ABCD');
    joinPlayer(room, 'a', 'A');
    const b = board('w');
    b[3] = '';
    expect(applyAction(room, 'a', { type: 'ready', board: b }).ok).toBe(false);
    b[3] = ' W 0 ';
    expect(applyAction(room, 'a', { type: 'ready', board: b }).ok).toBe(false);
  });

  it('starts only when everyone is ready, and ready can be cancelled', () => {
    const room = createRoom('ABCD');
    joinPlayer(room, 'a', 'A');
    joinPlayer(room, 'b', 'B');
    applyAction(room, 'a', { type: 'ready', board: board('a') });
    applyAction(room, 'a', { type: 'unready' });
    applyAction(room, 'b', { type: 'ready', board: board('b') });
    expect(room.phase).toBe('lobby');
    applyAction(room, 'a', { type: 'ready', board: board('a') });
    expect(room.phase).toBe('playing');
    expect(['a', 'b']).toContain(room.turnId);
  });

  it('shares the topic but never another player board', () => {
    const room = readyRoom();
    const v = viewFor(room, 'a');
    expect(v.me.board[5]).toBe('x5');
    expect(JSON.stringify(v)).not.toContain('y5');
  });

  it('returns a fresh copy every time so the host UI sees changes', () => {
    const room = readyRoom();
    const before = viewFor(room, 'a');
    applyAction(room, room.turnId, { type: 'call', word: '공통0' });
    expect(before.called).toHaveLength(0);
    expect(viewFor(room, 'a').called).toHaveLength(1);
  });

  it('enforces turns, rejects repeats, and finds the winner', () => {
    const room = readyRoom();
    room.target = 1;
    const first = room.turnId;
    const second = first === 'a' ? 'b' : 'a';
    expect(applyAction(room, second, { type: 'call', word: '공통0' }).ok).toBe(false);
    expect(applyAction(room, first, { type: 'call', word: '공통0' }).ok).toBe(true);
    expect(room.turnId).toBe(second);
    expect(applyAction(room, second, { type: 'call', word: '공 통 0' }).ok).toBe(false);
    let turn = second;
    for (let i = 1; i < 5; i++) {
      expect(applyAction(room, turn, { type: 'call', word: `공통${i}` }).ok).toBe(true);
      turn = turn === 'a' ? 'b' : 'a';
    }
    expect(room.phase).toBe('ended');
    expect(room.winners.sort()).toEqual(['a', 'b']);
    applyAction(room, 'a', { type: 'restart' });
    expect(room.phase).toBe('lobby');
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  it('skips a disconnected player and returns to lobby when too few remain', () => {
    const room = readyRoom();
    const first = room.turnId;
    setDisconnected(room, first);
    expect(room.turnId).not.toBe(first);
    expect(removePlayer(room, first)).toContain('대기실');
    expect(room.phase).toBe('lobby');
  });
});
