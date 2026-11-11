import { useState } from 'react';
import { MAX_NAME } from '../game/logic.js';
import { deviceStore } from '../net/storage.js';

const initialCode = () => {
  try {
    return (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase().slice(0, 4);
  } catch {
    return '';
  }
};

export default function JoinScreen({ busy, error, onCreate, onJoin }) {
  const [name, setName] = useState(() => deviceStore.get('bingo.name', ''));
  const [code, setCode] = useState(initialCode);
  const [localError, setLocalError] = useState('');

  const checkName = () => {
    const n = name.trim();
    if (!n) {
      setLocalError('닉네임을 먼저 입력해 주세요');
      return null;
    }
    deviceStore.set('bingo.name', n);
    setLocalError('');
    return n;
  };

  const create = () => {
    const n = checkName();
    if (n) onCreate(n);
  };
  const join = () => {
    const n = checkName();
    if (!n) return;
    if (code.trim().length !== 4) {
      setLocalError('방 코드 4자리를 입력해 주세요');
      return;
    }
    onJoin(n, code);
  };

  const invited = code.length === 4;

  return (
    <section className="join">
      <div className="logo" aria-label="BINGO">
        {'BINGO'.split('').map((ch, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.08}s` }}>
            {ch}
          </span>
        ))}
      </div>
      <p className="tagline">주제 하나, 빙고판은 각자. 2~3명이 함께해요</p>

      <div className="join-card">
        <label className="field">
          <span>닉네임</span>
          <input
            value={name}
            maxLength={MAX_NAME}
            placeholder="예) 민수"
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) (invited ? join : create)();
            }}
          />
        </label>

        {!invited && (
          <>
            <button className="btn primary big" disabled={busy} onClick={create}>
              {busy ? '연결하는 중…' : '새 방 만들기'}
            </button>
            <div className="divider">
              <span>또는 코드로 입장</span>
            </div>
          </>
        )}

        <div className="code-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button className={`btn ${invited ? 'primary' : ''}`} disabled={busy} onClick={join}>
            {busy && invited ? '입장 중…' : '입장'}
          </button>
        </div>

        {invited && (
          <button className="link-btn" disabled={busy} onClick={() => setCode('')}>
            새 방을 만들래요
          </button>
        )}

        <p className="error" role="alert">
          {localError || error}
        </p>
      </div>
    </section>
  );
}
