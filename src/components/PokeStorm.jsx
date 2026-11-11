import { useEffect, useRef, useState } from 'react';

const TAUNTS = [
  '빨리해라..',
  '느려터졌네',
  '자니?',
  '거북이세요? 🐢',
  '기다리다 늙겠다',
  '아직이야??',
  '하품 나온다 🥱',
  '손가락 묶였어?',
  '오늘 안에 끝나냐',
  '빨리빨리!!',
  '나 집에 갈래',
  '고민 그만~',
  '시간은 금이다 ⏰',
  '똑똑, 계세요?',
  '다들 기다린다~',
  '숨은 쉬고 있지?',
  '이러다 해 지겠다 🌙',
  '얼른얼른!!',
];

const COLORS = ['c-0', 'c-1', 'c-2', 'c-y'];
const PER_POKE = 7;
const LIFETIME_MS = 2600;

const pickSome = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);
const rand = (min, max) => min + Math.random() * (max - min);

// 누가 나를 쪼면 화면 곳곳에 재촉하는 말풍선이 우르르 뜬다
export default function PokeStorm({ poke }) {
  const [items, setItems] = useState([]);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!poke) return;
    const head = {
      key: `${poke.id}-head`,
      text: `👉 ${poke.from}님이 쪼았어요!`,
      head: true,
      x: 50,
      y: 16,
      rot: rand(-4, 4),
      delay: 0,
      color: 'c-y',
    };
    const taunts = pickSome(TAUNTS, PER_POKE - 1).map((text, i) => ({
      key: `${poke.id}-${i}`,
      text,
      x: rand(24, 76),
      y: rand(28, 86),
      rot: rand(-16, 16),
      size: rand(17, 26),
      delay: 0.12 + i * 0.13,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
    const batch = [head, ...taunts];
    setItems((cur) => [...cur, ...batch]);
    try {
      navigator.vibrate?.([90, 50, 90, 50, 160]);
    } catch {
      /* 진동 미지원 */
    }
    const keys = new Set(batch.map((b) => b.key));
    timers.current.push(
      setTimeout(() => setItems((cur) => cur.filter((it) => !keys.has(it.key))), LIFETIME_MS + PER_POKE * 130),
    );
  }, [poke]);

  if (!items.length) return null;
  return (
    <div className="poke-storm" aria-live="assertive">
      {items.map((it) => (
        <div
          key={it.key}
          className={`poke-bubble ${it.color} ${it.head ? 'head' : ''}`}
          style={{
            left: `${it.x}%`,
            top: `${it.y}%`,
            '--rot': `${it.rot}deg`,
            fontSize: it.size ? `${it.size}px` : undefined,
            animationDelay: `${it.delay}s`,
          }}
        >
          {it.text}
        </div>
      ))}
    </div>
  );
}
