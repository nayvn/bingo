import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GuestSession } from './guest.js';
import { HOST_ROOM_KEY, HostSession, newRoomCode } from './host.js';
import { createInkStore } from './inkStore.js';
import { getPlayerId, tabStore } from './storage.js';

const SESSION_KEY = 'bingo.session';

// 화면이 쓰는 단 하나의 진입점. 방장인지 참가자인지는 여기서만 신경 쓴다.
export function useBingo() {
  const [screen, setScreen] = useState('join'); // join | connecting | room
  const [view, setView] = useState(null);
  const [net, setNet] = useState('idle'); // idle | open | reconnecting
  const [error, setError] = useState('');
  const [role, setRole] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [poke, setPoke] = useState(null); // 누가 나를 쪼았는지 { from, id }
  const sessionRef = useRef(null);
  const playerIdRef = useRef(getPlayerId());
  const inkRef = useRef(null);
  if (!inkRef.current) inkRef.current = createInkStore();

  const toast = useCallback((text) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const reset = useCallback((message = '') => {
    sessionRef.current = null;
    tabStore.remove(SESSION_KEY);
    tabStore.remove(HOST_ROOM_KEY);
    setView(null);
    setNet('idle');
    setScreen('join');
    setError(message);
  }, []);

  const begin = useCallback(
    async ({ role, name, code, savedRoom }) => {
      sessionRef.current?.destroy();
      setScreen('connecting');
      setError('');
      const handlers = {
        state: (v) => sessionRef.current === session && setView(v),
        status: (s) => sessionRef.current === session && setNet(s),
        notice: (text) => sessionRef.current === session && toast(text),
        poke: (from) => sessionRef.current === session && setPoke({ from, id: Math.random() }),
        ink: (msg) => sessionRef.current === session && inkRef.current.apply(msg),
        closed: (message) => sessionRef.current === session && reset(message),
      };
      const Session = role === 'host' ? HostSession : GuestSession;
      const session = new Session({ playerId: playerIdRef.current, name, code, savedRoom, on: handlers });
      sessionRef.current = session;
      setRole(role);
      try {
        await session.start();
        if (sessionRef.current !== session) return;
        tabStore.set(SESSION_KEY, { role, code: session.code, name });
        setScreen('room');
      } catch (e) {
        session.destroy();
        if (sessionRef.current === session) reset(e.message);
      }
    },
    [reset, toast],
  );

  const create = useCallback((name) => begin({ role: 'host', name, code: newRoomCode() }), [begin]);
  const join = useCallback((name, code) => begin({ role: 'guest', name, code: code.trim().toUpperCase() }), [begin]);

  const leave = useCallback(() => {
    sessionRef.current?.send({ type: 'leave' });
    reset();
  }, [reset]);

  const send = useCallback(
    (action) => sessionRef.current?.send(action) ?? Promise.resolve({ ok: false, error: '연결되어 있지 않아요' }),
    [],
  );

  // 그림 맞히기: 내가 그린 조각은 내 그림판에 먼저 그리고, 방으로 보낸다
  const sendInk = useCallback((op) => {
    inkRef.current.apply({ op });
    sessionRef.current?.ink(op);
  }, []);
  const ink = useMemo(() => ({ store: inkRef.current, send: sendInk }), [sendInk]);

  // 새로고침해도 같은 방으로 돌아가기
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const saved = tabStore.get(SESSION_KEY);
    if (!saved?.code) return;
    if (saved.role === 'host') {
      const room = tabStore.get(HOST_ROOM_KEY);
      if (room?.code === saved.code) begin({ role: 'host', name: saved.name, savedRoom: room });
      else tabStore.remove(SESSION_KEY);
    } else {
      begin({ role: 'guest', name: saved.name, code: saved.code });
    }
  }, [begin]);

  return {
    screen,
    view,
    net,
    error,
    toasts,
    toast,
    poke,
    create,
    join,
    leave,
    send,
    ink,
    role,
  };
}
