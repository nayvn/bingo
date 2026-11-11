import Peer from 'peerjs';
import * as L from '../game/logic.js';
import { tabStore } from './storage.js';

// PeerJS 공용 서버에서 다른 앱과 ID가 겹치지 않게 붙이는 접두어
export const PEER_PREFIX = 'nayvn-bingo-v1-';
export const HOST_ROOM_KEY = 'bingo.hostRoom';
const REMOVE_AFTER_MS = 60_000;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode() {
  return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

export function peerErrorText(err) {
  switch (err?.type) {
    case 'browser-incompatible':
      return '이 브라우저는 P2P 연결을 지원하지 않아요';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return '연결 서버에 접속할 수 없어요. 네트워크를 확인해 주세요';
    default:
      return '연결 중 문제가 생겼어요';
  }
}

// 방장: 방 상태를 들고 있고, 참가자들의 요청을 받아 규칙대로 처리한 뒤 상태를 뿌린다.
export class HostSession {
  constructor({ playerId, name, code, savedRoom, on }) {
    this.role = 'host';
    this.playerId = playerId;
    this.name = name;
    this.on = on;
    this.fresh = !savedRoom;
    this.room = savedRoom ?? L.createRoom(code);
    this.code = this.room.code;
    this.conns = new Map(); // playerId -> DataConnection
    this.timers = new Map();
    this.destroyed = false;
    this.started = false;
    this.attempts = 0;
  }

  start() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._openPeer();
    });
  }

  _openPeer() {
    const peer = new Peer(PEER_PREFIX + this.code, { debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      this.on.status('open');
      if (this.started) return;
      this.started = true;
      if (this.fresh) {
        L.joinPlayer(this.room, this.playerId, this.name);
      } else {
        // 새로고침 후 복구: 참가자들은 다시 접속할 때까지 연결 끊김 상태
        for (const p of this.room.players) {
          if (p.id === this.playerId) continue;
          L.setDisconnected(this.room, p.id);
          this._armRemoval(p.id);
        }
      }
      this._broadcast();
      this._resolve();
    });

    peer.on('connection', (conn) => this._onConnection(conn));

    peer.on('disconnected', () => {
      if (this.destroyed || !this.started) return;
      this.on.status('reconnecting');
      setTimeout(() => {
        if (!this.destroyed && !peer.destroyed) peer.reconnect();
      }, 1000);
    });

    peer.on('error', (err) => {
      if (this.started) {
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          this.on.status('reconnecting');
        }
        return;
      }
      peer.destroy();
      this.attempts += 1;
      if (err.type === 'unavailable-id' && this.attempts < 8) {
        if (this.fresh) {
          // 코드가 겹침 → 새 코드로 다시
          this.code = newRoomCode();
          this.room.code = this.code;
          this._openPeer();
        } else {
          // 새로고침 직후엔 이전 연결이 잠깐 ID를 잡고 있을 수 있음
          setTimeout(() => !this.destroyed && this._openPeer(), 1500);
        }
        return;
      }
      this._reject(new Error(err.type === 'unavailable-id' ? '방을 다시 열 수 없어요' : peerErrorText(err)));
    });
  }

  _onConnection(conn) {
    conn.on('data', (msg) => this._onMessage(conn, msg));
    conn.on('close', () => this._onClose(conn));
    conn.on('error', () => this._onClose(conn));
  }

  _onMessage(conn, msg) {
    if (!msg || msg.t !== 'req') return;
    const { id, action } = msg;
    let res;
    let notice = null;

    if (action?.type === 'join') {
      const pid = L.clean(action.playerId, 64);
      if (!pid || pid === this.playerId) {
        res = { ok: false, error: '잘못된 접속이에요' };
      } else {
        res = L.joinPlayer(this.room, pid, action.name);
        if (res.ok) {
          const old = this.conns.get(pid);
          if (old && old !== conn) {
            old.replaced = true;
            old.close();
          }
          this.conns.set(pid, conn);
          conn.playerId = pid;
          this._clearRemoval(pid);
        }
      }
    } else if (!conn.playerId) {
      res = { ok: false, error: '먼저 방에 참여해 주세요' };
    } else if (action?.type === 'leave') {
      notice = L.removePlayer(this.room, conn.playerId);
      this._clearRemoval(conn.playerId);
      this.conns.delete(conn.playerId);
      conn.replaced = true;
      res = { ok: true };
    } else {
      res = L.applyAction(this.room, conn.playerId, action);
    }

    if (conn.open) conn.send({ t: 'res', id, ok: res.ok, error: res.error });
    if (res.ok) this._broadcast();
    if (notice) this._notify(notice);
  }

  _onClose(conn) {
    const pid = conn.playerId;
    if (!pid || conn.replaced || this.conns.get(pid) !== conn) return;
    this.conns.delete(pid);
    L.setDisconnected(this.room, pid);
    this._armRemoval(pid);
    this._broadcast();
  }

  _armRemoval(pid) {
    this._clearRemoval(pid);
    this.timers.set(
      pid,
      setTimeout(() => {
        this.timers.delete(pid);
        if (this.destroyed) return;
        const notice = L.removePlayer(this.room, pid);
        this._broadcast();
        if (notice) this._notify(notice);
      }, REMOVE_AFTER_MS),
    );
  }

  _clearRemoval(pid) {
    clearTimeout(this.timers.get(pid));
    this.timers.delete(pid);
  }

  _broadcast() {
    if (this.destroyed) return;
    tabStore.set(HOST_ROOM_KEY, this.room);
    for (const p of this.room.players) {
      const view = L.viewFor(this.room, p.id);
      if (p.id === this.playerId) {
        this.on.state(view);
      } else {
        const conn = this.conns.get(p.id);
        if (conn?.open) conn.send({ t: 'state', state: view });
      }
    }
  }

  _notify(text) {
    this.on.notice(text);
    for (const conn of this.conns.values()) if (conn.open) conn.send({ t: 'notice', text });
  }

  send(action) {
    if (action?.type === 'leave') {
      this.closeRoom();
      return Promise.resolve({ ok: true });
    }
    const res = L.applyAction(this.room, this.playerId, action);
    if (res.ok) this._broadcast();
    return Promise.resolve(res);
  }

  // 방장이 나가면 방이 닫힌다
  closeRoom() {
    for (const conn of this.conns.values()) if (conn.open) conn.send({ t: 'closed' });
    tabStore.remove(HOST_ROOM_KEY);
    const peer = this.peer;
    this.destroyed = true;
    this.timers.forEach(clearTimeout);
    setTimeout(() => peer?.destroy(), 300);
  }

  destroy() {
    this.destroyed = true;
    this.timers.forEach(clearTimeout);
    this.peer?.destroy();
  }
}
