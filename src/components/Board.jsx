import { useLayoutEffect, useRef, useState } from 'react';
import { LINES, MAX_WORD, N } from '../game/logic.js';

const sizeClass = (text) => {
  const len = [...(text ?? '')].length;
  if (len > 8) return 'xs';
  if (len > 5) return 'sm';
  return '';
};

/**
 * mode: 'edit'(입력 가능) | 'locked'(준비 완료, 수정 불가) | 'play'(게임 중)
 */
export default function Board({ cells, mode, marked, popped, lines, dupes, onChange }) {
  const boardRef = useRef(null);
  const cellRefs = useRef([]);
  const [segs, setSegs] = useState([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // 줄 위치는 실제 칸 위치를 재서 그린다 (화면 크기가 바뀌면 다시 계산)
  const lineKey = lines.join(',');
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    const measure = () => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
      setSegs(
        lines.map((li) => {
          const a = cellRefs.current[LINES[li][0]];
          const b = cellRefs.current[LINES[li][N - 1]];
          const ax = a.offsetLeft + a.offsetWidth / 2;
          const ay = a.offsetTop + a.offsetHeight / 2;
          const bx = b.offsetLeft + b.offsetWidth / 2;
          const by = b.offsetTop + b.offsetHeight / 2;
          const d = Math.hypot(bx - ax, by - ay) || 1;
          const ext = (a.offsetWidth * 0.36) / d; // 양 끝을 칸 가장자리까지 살짝 늘림
          const x1 = ax - (bx - ax) * ext;
          const y1 = ay - (by - ay) * ext;
          const x2 = bx + (bx - ax) * ext;
          const y2 = by + (by - ay) * ext;
          return { li, x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1) };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey]);

  // 한 번에 여러 줄이 생기면 순서대로 조금씩 늦게 그어지게 (줄마다 처음 본 순간 한 번만 정함)
  const delayRef = useRef(new Map());
  const delays = delayRef.current;
  for (const li of [...delays.keys()]) if (!lines.includes(li)) delays.delete(li);
  let freshCount = 0;
  for (const li of lines) if (!delays.has(li)) delays.set(li, freshCount++ * 0.28);

  const focusCell = (i) => cellRefs.current[i]?.querySelector('textarea')?.focus();

  // 입력칸 높이를 글자 줄 수에 맞춰서, 칸 안에서 세로 가운데 정렬되게
  const fitKey = `${mode}|${cells.join('\u0000')}|${box.w}`;
  useLayoutEffect(() => {
    for (const cell of cellRefs.current) {
      const ta = cell?.querySelector('textarea');
      if (!ta) continue;
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, cell.clientHeight)}px`;
    }
  }, [fitKey]);

  return (
    <div className={`board mode-${mode}`} ref={boardRef}>
      {cells.map((text, i) => {
        const isMarked = mode === 'play' && marked.has(i);
        const cls = [
          'cell',
          sizeClass(text),
          isMarked && 'marked',
          popped?.has(i) && 'pop',
          dupes?.has(i) && 'dupe',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={i}
            className={cls}
            ref={(el) => (cellRefs.current[i] = el)}
            onClick={(e) => mode === 'edit' && e.target === e.currentTarget && focusCell(i)}
          >
            {mode === 'play' ? (
              <span>{text}</span>
            ) : (
              <textarea
                value={text}
                rows={1}
                maxLength={MAX_WORD}
                disabled={mode === 'locked'}
                enterKeyHint={i === cells.length - 1 ? 'done' : 'next'}
                aria-label={`${Math.floor(i / N) + 1}행 ${(i % N) + 1}열`}
                onChange={(e) => onChange(i, e.target.value.replace(/[\r\n]+/g, ' '))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (i < cells.length - 1) focusCell(i + 1);
                  else e.currentTarget.blur();
                }}
              />
            )}
          </div>
        );
      })}
      <svg className="lines" width={box.w} height={box.h} viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} aria-hidden>
        {segs.map((s) => {
          const style = { '--len': s.len, animationDelay: `${delays.get(s.li) ?? 0}s` };
          return (
            <g key={s.li}>
              <line className="bingo-line outline" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} style={style} />
              <line className="bingo-line core" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} style={style} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
