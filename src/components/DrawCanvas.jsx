import { useEffect, useRef } from 'react';

const FLUSH_MS = 40; // 이 간격마다 그린 조각을 모아 보낸다
const MIN_STEP = 3; // 너무 촘촘한 점은 건너뜀 (0~1000 좌표 기준)
const PAPER_RGB = [0xf7, 0xf6, 0xfb]; // 캔버스 배경색 (투명한 곳은 이 색으로 본다)
const FILL_TOLERANCE = 60; // 이만큼 비슷한 색까지 같은 영역으로 (선 가장자리 번짐 때문)

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 페인트 통 채우기: (x, y)와 이어진 비슷한 색 영역을 color로. 선 가장자리 번짐까지 1px 더 덮는다 */
function floodFill(ctx, x, y, color) {
  const { width: w, height: h } = ctx.canvas;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  // 투명도를 배경색과 섞어서 눈에 보이는 색으로 비교
  const seen = (i) => {
    const a = px[i + 3] / 255;
    return [0, 1, 2].map((k) => px[i + k] * a + PAPER_RGB[k] * (1 - a));
  };
  const start = (y * w + x) * 4;
  const [tr, tg, tb] = seen(start);
  const [fr, fg, fb] = hexRgb(color);
  const near = (i) => {
    const [r, g, b] = seen(i);
    return Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb) <= FILL_TOLERANCE;
  };
  if (Math.abs(fr - tr) + Math.abs(fg - tg) + Math.abs(fb - tb) <= 6) return; // 이미 같은 색
  const mark = new Uint8Array(w * h); // 1 = 채울 곳
  const stack = [y * w + x];
  mark[y * w + x] = 1;
  while (stack.length) {
    const p = stack.pop();
    const cx = p % w;
    const cy = (p - cx) / w;
    const next = [cx > 0 && p - 1, cx < w - 1 && p + 1, cy > 0 && p - w, cy < h - 1 && p + w];
    for (const q of next) {
      if (q === false || mark[q]) continue;
      if (near(q * 4)) {
        mark[q] = 1;
        stack.push(q);
      }
    }
  }
  const paintPx = (p) => {
    const i = p * 4;
    px[i] = fr;
    px[i + 1] = fg;
    px[i + 2] = fb;
    px[i + 3] = 255;
  };
  for (let p = 0; p < w * h; p++) {
    if (mark[p] !== 1) continue;
    paintPx(p);
    const cx = p % w;
    // 가장자리 1px 넓히기 (선과 사이 틈 없애기)
    for (const q of [cx > 0 ? p - 1 : -1, cx < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q >= 0 && q < w * h && !mark[q]) {
        mark[q] = 2;
        paintPx(q);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// 그림판. 좌표는 0~1000으로 보내서 화면 크기가 달라도 똑같이 보인다.
export default function DrawCanvas({ store, canDraw, color, size, fill = false, onOp }) {
  const canvasRef = useRef(null);
  const strokeRef = useRef(null);
  const lastIdRef = useRef(0);
  const drawRef = useRef({ canDraw, color, size, fill, onOp });
  drawRef.current = { canDraw, color, size, fill, onOp };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let scale = 1;

    const paint = (seg) => {
      const p = seg.p;
      if (seg.f) {
        floodFill(ctx, p[0] * scale, p[1] * scale, seg.c);
        return;
      }
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
      if (drawRef.current.fill) {
        // 채우기는 누른 한 점만 보낸다 (내 그림판에도 같은 조각으로 칠해짐)
        const [x, y] = pointAt(e);
        drawRef.current.onOp({ key: store.get().key, seg: { s: id, c, w: 0, f: 1, p: [x, y] } });
        return;
      }
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

  return <canvas ref={canvasRef} className={`draw-canvas ${canDraw ? 'can-draw' : ''} ${canDraw && fill ? 'fill' : ''}`} />;
}
