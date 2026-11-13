// 초성퀴즈와 그림 맞히기가 같이 쓰는 화면 조각들
import { useEffect, useRef, useState } from 'react';
import { MAX_WORD, MIN_PLAYERS } from '../../game/logic.js';

// 채팅/정답 기록. 새 줄이 오면 맨 아래로
export function Feed({ log, colorOf, empty, compact = false }) {
  const ref = useRef(null);
  const lastId = log.at(-1)?.id;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);
  return (
    <ul className={`feed ${compact ? 'compact' : ''}`} ref={ref} aria-live="polite">
      {log.length ? (
        log.map((e) => (
          <li key={e.id} className={`feed-${e.kind} ${e.by ? colorOf(e.by) : ''}`}>
            {e.kind === 'chat' && (
              <>
                <b>{e.name}</b>
                <span>{e.text}</span>
              </>
            )}
            {e.kind === 'correct' && (
              <>
                🎉 <b>{e.name}</b>님 {e.text}
              </>
            )}
            {e.kind === 'system' && e.text}
          </li>
        ))
      ) : (
        <li className="feed-system">{empty}</li>
      )}
    </ul>
  );
}

// 정답 입력창. 한글 조합 중 Enter는 무시 (안 그러면 두 번 보내짐)
export function GuessBar({ onSend, placeholder, disabled = false, extra = null, autoFocus = false }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    setText('');
    onSend(t);
    ref.current?.focus();
  };
  return (
    <div className="guess-bar">
      <input
        ref={ref}
        className="guess-input"
        value={text}
        maxLength={MAX_WORD}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
      />
      <button className="btn primary" disabled={disabled || !text.trim()} onClick={submit}>
        보내기
      </button>
      {extra}
    </div>
  );
}

// 초성퀴즈·그림 맞히기 대기실: 설정 + 규칙 + 준비 버튼
export function GameLobby({ icon, title, rules, settings, view, me, run, busy, net, pokeButton }) {
  const readyCount = view.players.filter((p) => p.ready).length;
  const waiting = view.players.length < MIN_PLAYERS;
  return (
    <>
      <div className="topic-row setup">{settings}</div>
      <div className="status-row">
        <span className="round-tag">
          {icon} {title}
        </span>
        <div className="status">
          {net === 'reconnecting' ? (
            <span className="warn">연결 다시 시도 중…</span>
          ) : waiting ? (
            '친구를 초대해 주세요'
          ) : (
            `준비 ${readyCount}/${view.players.length}`
          )}
        </div>
      </div>
      <div className="rules">
        <div className="rules-icon">{icon}</div>
        <h3>{title}</h3>
        <ul>
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="rules-foot">{me?.ready ? '다른 사람을 기다리는 중…' : '다 같이 준비하면 바로 시작해요'}</p>
      </div>
      <footer className="footer">
        <div className="bar">
          {pokeButton}
          <button
            className={`btn grow ${me?.ready ? 'ghost' : 'primary'}`}
            disabled={busy}
            onClick={() => run({ type: me?.ready ? 'unready' : 'ready' })}
          >
            {me?.ready ? '준비 취소' : '준비 완료'}
          </button>
        </div>
      </footer>
    </>
  );
}

export function Select({ label, value, options, onChange }) {
  return (
    <label className="setting">
      <span className="topic-label">{label}</span>
      <select className="target" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
