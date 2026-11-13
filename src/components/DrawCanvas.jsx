import { useEffect, useRef } from 'react';

const FLUSH_MS = 40; // 이 간격마다 그린 조각을 모아 보낸다
const MIN_STEP = 3; // 너무 촘촘한 점은 건너뜀 (0~1000 좌표 기준)

// 그림판. 좌표는 0~1000으로 보내서 화면 크기가 달라도 똑같이 보인다.
export default function DrawCanvas({ store, canDraw, color, size, onOp }) {
  const canvasRef = useRef(null);
  const strokeRef = useRef(null);
  const lastIdRef = useRef(0);
  const drawRef = useRef({ canDraw, color, size, onOp });
  drawRef.current = { canDraw, color, size, onOp };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let scale = 1;

    const paint = (seg) => {
      const p = seg.p;
      ctx.strokeStyle = seg.c;
      ctx.fillStyle = seg.c;
      ctx.lineWidth = seg.w * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (p.length === 2) {
        ctx.beginPath();
        ctx.arc(p[0] * scale, p[1] * scale, (seg.w * scale) / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(p[0] * scale, p[1] * scale);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * scale, p[i + 1] * scale);
      ctx.stroke();
    };
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      store.get().segs.forEach(paint);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.max(1, Math.round(rect.width * dpr));
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      scale = px / 1000;
      redraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const unsub = store.subscribe((ev) => (ev.seg ? paint(ev.seg) : redraw()));

    // ── 그리기 ──
    const pointAt = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.height) * 1000)];
    };
    const flush = (final) => {
      const st = strokeRef.current;
      if (!st) return;
      const pts = st.pts.slice(st.sent * 2);
      st.lastFlush = performance.now();
      // 앞 조각과 이어지도록 마지막으로 보낸 점부터 다시 포함
      const fromPrev = st.sent > 0 ? st.pts.slice((st.sent - 1) * 2, st.sent * 2) : [];
      const p = [...fromPrev, ...pts];
      if (p.length >= 4 || (final && st.sent === 0 && p.length === 2)) {
        drawRef.current.onOp({ key: store.get().key, seg: { s: st.id, c: st.c, w: st.w, p } });
        st.sent = st.pts.length / 2;
      }
    };
    const down = (e) => {
      if (!drawRef.current.canDraw || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      const { color: c, size: w } = drawRef.current;
      const lastSeg = store.get().segs.at(-1)?.s ?? 0;
      const id = Math.max(lastSeg, lastIdRef.current) + 1;
      lastIdRef.current = id;
      strokeRef.current = { id, c, w, pts: pointAt(e), sent: 0, lastFlush: performance.now(), pointer: e.pointerId };
    };
    const move = (e) => {
      const st = strokeRef.current;
      if (!st || st.pointer !== e.pointerId) return;
      e.preventDefault();
      const [x, y] = pointAt(e);
      const lx = st.pts.at(-2);
      const ly = st.pts.at(-1);
      if (Math.hypot(x - lx, y - ly) < MIN_STEP) return;
      st.pts.push(x, y);
      // 내 화면엔 바로 그리기 (보내는 건 조금씩 모아서)
      paint({ c: st.c, w: st.w, p: [lx, ly, x, y] });
      if (performance.now() - st.lastFlush >= FLUSH_MS) flush(false);
    };
    const up = (e) => {
      const st = strokeRef.current;
      if (!st || st.pointer !== e.pointerId) return;
      flush(true);
      strokeRef.current = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      ro.disconnect();
      unsub();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [store]);

  return <canvas ref={canvasRef} className={`draw-canvas ${canDraw ? 'can-draw' : ''}`} />;
}
