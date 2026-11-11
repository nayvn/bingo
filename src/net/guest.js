import Peer from 'peerjs';
import { PEER_PREFIX, peerErrorText } from './host.js';

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 40; // 1.5초 간격 → 약 1분 동안 재접속 시도

// 참가자: 방장에게 요청을 보내고, 방장이 보내주는 내 시점 상태를 받는다.
export class GuestSession {
  constructor({ playerId, name, code, on }) {
    this.role = 'guest';
    this.playerId = playerId;
    this.name = name;
    this.code = code;
    this.on = on;
    this.pending = new Map();
    this.seq = 0;
    this.joined = false;
    this.retries = 0;
    this.destroyed = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._openPeer();
    });
  }

  _openPeer() {
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      if (!this.conn?.open) this._connect();
    });
    peer.on('disconnected', () => {
      if (this.destroyed) return;
      setTimeout(() => {
        if (!this.destroyed && !peer.destroyed) peer.reconnect();
      }, 1000);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'peer-unavailable') {
        this._connectFailed('방을 찾을 수 없어요. 코드를 확인해 주세요');
      } else if (!this.joined) {
        this._fail(peerErrorText(err));
      } else {
        this.on.status('reconnecting');
      }
    });
  }

  _connect() {
    if (this.destroyed) return;
    clearTimeout(this.connTimer);
    // 중계 서버와 끊긴 동안엔 연결을 만들 수 없음 → 재접속되면 peer 'open'에서 다시 시도
    if (!this.peer.open) return;
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = conn;
    this.connTimer = setTimeout(() => {
      if (this.conn === conn && !conn.open) this._connectFailed('방장과 연결하지 못했어요');
    }, CONNECT_TIMEOUT_MS);

    conn.on('open', async () => {
      clearTimeout(this.connTimer);
      const res = await this._request({ type: 'join', playerId: this.playerId, name: this.name });
      if (this.conn !== conn) return;
      if (!res.ok) {
        this._fail(res.error);
        return;
      }
      this.joined = true;
      this.retries = 0;
      this.on.status('open');
      this._resolve?.();
      this._resolve = this._reject = null;
    });
    conn.on('data', (msg) => this._onMessage(msg));
    const onLost = () => {
      if (this.conn === conn && !this.destroyed) this._lost();
    };
    conn.on('close', onLost);
    conn.on('error', onLost);
  }

  _connectFailed(message) {
    const conn = this.conn;
    this.conn = null;
    clearTimeout(this.connTimer);
    conn?.close();
    if (this.joined) this._lost(true);
    else this._fail(message);
  }

  _lost(alreadyDetached = false) {
    if (!alreadyDetached) this.conn = null;
    for (const resolve of this.pending.values()) resolve({ ok: false, error: '연결이 끊겼어요' });
    this.pending.clear();
    this.on.status('reconnecting');
    this.retries += 1;
    if (this.retries > MAX_RETRIES) {
      this._fail('방장과 연결이 끊겼어요');
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._connect(), 1500);
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.t === 'res') {
      const resolve = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve?.({ ok: msg.ok, error: msg.error });
    } else if (msg.t === 'state') {
      this.on.state(msg.state);
    } else if (msg.t === 'notice') {
      this.on.notice(msg.text);
    } else if (msg.t === 'closed') {
      this.destroy();
      this.on.closed('방장이 방을 닫았어요');
    }
  }

  _request(action) {
    return new Promise((resolve) => {
      const conn = this.conn;
      if (!conn?.open) {
        resolve({ ok: false, error: '연결 중이에요. 잠시 후 다시 시도해 주세요' });
        return;
      }
      const id = ++this.seq;
      this.pending.set(id, resolve);
      conn.send({ t: 'req', id, action });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        resolve({ ok: false, error: '응답이 없어요' });
      }, REQUEST_TIMEOUT_MS);
    });
  }

  _fail(message) {
    const reject = this._reject;
    this._resolve = this._reject = null;
    this.destroy();
    if (reject) reject(new Error(message));
    else this.on.closed(message);
  }

  send(action) {
    if (action?.type === 'leave') {
      this._request(action);
      setTimeout(() => this.destroy(), 300);
      return Promise.resolve({ ok: true });
    }
    return this._request(action);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.connTimer);
    clearTimeout(this.retryTimer);
    this.peer?.destroy();
  }
}
