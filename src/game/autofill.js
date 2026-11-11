// 시간 안에 빙고판을 못 채웠을 때, 주제에 맞는 단어를 위키에서 가져와 빈 칸을 채운다.
// 서버 없이 브라우저에서 바로 호출한다 (두 API 모두 origin=* 로 CORS 허용).
//
// 1) 위키데이터: "주제의 한 종류"인 항목들을 유명한 순(위키 문서가 많은 순)으로
// 2) 부족하면 한국어 위키백과의 같은 이름 분류에 속한 문서들
// 3) 그래도 모자라면 숫자
import { CELLS, norm } from './logic.js';

// 주제 추천 목록. 위키에서 단어가 잘 나오는 것만 골라 둠 (자동 채우기와 같이 쓰기 좋게)
export const SUGGESTED_TOPICS = [
  '과일', '나라', '채소', '스포츠', '색', '음료', '빵',
  '치즈', '칵테일', '개', '고양이', '보석', '별자리', '나무', '향신료',
  '허브', '요리', '보드게임', '언어', '술', '커피', '과자', '악기',
];

export function suggestTopic(current) {
  const pool = SUGGESTED_TOPICS.filter((t) => norm(t) !== norm(current));
  return pool[Math.floor(Math.random() * pool.length)];
}

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const WIKIPEDIA = 'https://ko.wikipedia.org/w/api.php';
const MAX_LEN = 8;
const ENOUGH = 30;
const FETCH_TIMEOUT_MS = 9000;
const SPARQL_TIMEOUT_MS = 6000;

// 위키백과 분류에는 개념/기관/목록 문서가 섞여 있어서 더 엄격하게 거른다
const CATEGORY_BAD =
  /목록|분류|협회|연합|위원회|협의회|재단|기관|회사|산업|사업|정책|제도|역사|문화|축제|박물관|연구|학회|대회|선수권|리그|시리즈|에피소드|프로그램|주의$|학$|론$|법$/;

export function cleanLabel(label, topic) {
  let t = String(label ?? '')
    .replace(/^분류:/, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
  if (t.length >= 2 && t.endsWith('속')) t = t.slice(0, -1); // 귤속 → 귤
  if (!t || t.length > MAX_LEN) return null;
  if (norm(t) === norm(topic)) return null;
  if (/[,:·/]|\d{2,}|[A-Za-z]{2,}/.test(t)) return null;
  if (t.split(' ').length > 2) return null;
  return t;
}

const getJson = async (url, signal) => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

async function wikidataWords(topic, signal) {
  const search = await getJson(
    `${WIKIDATA}?${new URLSearchParams({
      action: 'wbsearchentities',
      search: topic,
      language: 'ko',
      uselang: 'ko',
      type: 'item',
      limit: '5',
      format: 'json',
      origin: '*',
    })}`,
    signal,
  );
  const hits = search?.search ?? [];
  // 이름이 주제와 똑같은 항목 우선 (예: '직업'은 두 개라 둘 다)
  const exact = hits.filter((h) => norm(h.label) === norm(topic));
  const ids = (exact.length ? exact : hits).slice(0, 2).map((h) => h.id);
  if (!ids.length) return [];

  // 항목마다 따로 조회: 너무 큰 항목(예: 직업)은 느릴 수 있어서, 늦는 쪽은 버리고 빠른 쪽만 쓴다
  const results = await Promise.allSettled(ids.map((id) => classMembers(id, signal)));
  return results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.links - a.links)
    .map((r) => r.label);
}

async function classMembers(id, outerSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SPARQL_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  outerSignal?.addEventListener('abort', onAbort);
  const query = `SELECT ?label (MAX(?sl) AS ?links) WHERE {
    { ?item wdt:P31 wd:${id} } UNION { ?item wdt:P279 wd:${id} }
    ?item wikibase:sitelinks ?sl FILTER(?sl > 2)
    ?item rdfs:label ?label FILTER(LANG(?label) = "ko")
  } GROUP BY ?label ORDER BY DESC(?links) LIMIT 80`;
  try {
    const json = await getJson(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`, ctrl.signal);
    return (json?.results?.bindings ?? []).map((b) => ({ label: b.label.value, links: Number(b.links.value) }));
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onAbort);
  }
}

async function categoryWords(topic, signal) {
  const json = await getJson(
    `${WIKIPEDIA}?${new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `분류:${topic}`,
      cmlimit: '200',
      format: 'json',
      origin: '*',
    })}`,
    signal,
  );
  return (json?.query?.categorymembers ?? []).map((m) => m.title).filter((t) => !CATEGORY_BAD.test(t));
}

const cache = new Map();

export async function topicWords(topic, signal) {
  topic = String(topic ?? '').trim();
  const key = norm(topic);
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);

  const seen = new Set([key]);
  const words = [];
  const add = (labels) => {
    for (const label of labels) {
      const w = cleanLabel(label, topic);
      if (w && !seen.has(norm(w))) {
        seen.add(norm(w));
        words.push(w);
      }
    }
  };

  add(await wikidataWords(topic, signal).catch(() => []));
  if (words.length < ENOUGH) add(await categoryWords(topic, signal).catch(() => []));

  if (words.length) cache.set(key, words);
  return words;
}

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * 빈 칸만 채운 새 판을 돌려준다.
 * 유명한 단어일수록 다른 사람 판과 겹칠 확률이 높아서 빙고가 잘 나오도록 상위 40개 안에서 고른다.
 * @returns {Promise<{ board: string[], fromWiki: number, fromNumbers: number }>}
 */
export async function autofillBoard(draft, topic) {
  const board = Array.from({ length: CELLS }, (_, i) => String(draft?.[i] ?? '').trim());
  const used = new Set(board.filter(Boolean).map(norm));
  const empty = board.map((w, i) => (w ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return { board, fromWiki: 0, fromNumbers: 0 };

  let words = [];
  if (topic?.trim()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      words = await topicWords(topic, ctrl.signal);
    } catch {
      words = [];
    } finally {
      clearTimeout(timer);
    }
  }

  const fresh = words.filter((w) => !used.has(norm(w)));
  const pool = shuffle(fresh.slice(0, Math.max(40, empty.length)));
  const numbers = shuffle([...Array(99).keys()].map((i) => String(i + 1)).filter((n) => !used.has(n)));
  let fromWiki = 0;
  let fromNumbers = 0;
  for (const i of empty) {
    if (pool.length) {
      board[i] = pool.pop();
      fromWiki += 1;
    } else {
      board[i] = numbers.pop();
      fromNumbers += 1;
    }
  }
  return { board, fromWiki, fromNumbers };
}
