// 브라우저 저장소는 막혀 있을 수 있어서(사파리 사생활 보호 등) 항상 try/catch로 감싼다.
function safe(store) {
  return {
    get(key, fallback = null) {
      try {
        const raw = store().getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        store().setItem(key, JSON.stringify(value));
      } catch {
        /* 저장 실패는 무시 */
      }
    },
    remove(key) {
      try {
        store().removeItem(key);
      } catch {
        /* 무시 */
      }
    },
  };
}

// sessionStorage: 탭마다 따로. 같은 PC에서 탭 두 개로 2인 테스트가 가능하다.
export const tabStore = safe(() => window.sessionStorage);
export const deviceStore = safe(() => window.localStorage);

export function getPlayerId() {
  let id = tabStore.get('bingo.pid');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    tabStore.set('bingo.pid', id);
  }
  return id;
}
