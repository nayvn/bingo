import { undoLast } from '../game/draw.js';

// 그림판 내용. 조각이 1초에 수십 개씩 오기 때문에 React 상태 대신 여기 모아 두고,
// 그림판 컴포넌트가 구독해서 바로 캔버스에 그린다.
// key는 "몇 번째 그림인지" — 바뀌면 새 그림판.
export function createInkStore() {
  let key = null;
  let segs = [];
  const subs = new Set();
  const emit = (ev) => subs.forEach((fn) => fn(ev));
  const reset = (k, list = []) => {
    key = k;
    segs = list;
    emit({ reset: true });
  };

  return {
    get: () => ({ key, segs }),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    // 화면 상태의 key와 맞추기 (다음 차례가 되면 비움)
    sync(k) {
      if (k !== key) reset(k);
    },
    apply(msg) {
      if (!msg) return;
      if (msg.full) {
        reset(msg.key, [...msg.full]);
        return;
      }
      const op = msg.op;
      if (!op) return;
      if (op.key !== key) reset(op.key);
      if (op.clear) {
        reset(key);
      } else if (op.undo) {
        undoLast(segs);
        emit({ reset: true });
      } else if (op.seg) {
        segs.push(op.seg);
        emit({ seg: op.seg });
      }
    },
  };
}
