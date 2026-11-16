// 초성게임 단어 확인: 위키낱말사전(한국어 항목) → 없으면 한국어 위키백과.
// 둘 다 브라우저에서 바로 부를 수 있다 (origin=* 로 CORS 허용). 나무위키는 공개 API가 없어 못 씀.
// 요청 제한에 안 걸리게 낱말사전을 먼저 보고, 없을 때만 위키백과를 본다. 같은 단어는 다시 안 묻는다.

const WIKTIONARY = 'https://ko.wiktionary.org/w/api.php';
const WIKIPEDIA = 'https://ko.wikipedia.org/w/api.php';
const EACH_TIMEOUT_MS = 1400;
const MAX_DESC = 60;

const cut = (s) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_DESC ? `${t.slice(0, MAX_DESC - 1)}…` : t;
};

const SKIP_LINE = /^(어원|파생어|합성어|유의어|반의어|참고|관련|준말|본말|동사:|형용사:|부사:|명사:|속담|관용구|높임말|낮춤말|번역|이표기)/;
// 뜻풀이가 들어 있는 제목 (명사, 명사 1, 동사 …). 발음·어원·번역 아래 줄은 건너뛴다
const POS_HEADING = /^(명사|동사|형용사|부사|대명사|수사|감탄사|관형사|의존 명사|고유 명사)/;

/** 위키낱말사전 본문에서 한국어 항목의 첫 뜻풀이 한 줄. 한국어 항목이 없으면 null */
export function wiktionaryDesc(extract, word = '') {
  const text = String(extract ?? '');
  const start = text.indexOf('== 한국어 ==');
  if (start < 0) return null;
  const rest = text.slice(start + '== 한국어 =='.length);
  const end = rest.search(/\n== [^=]/);
  const section = end < 0 ? rest : rest.slice(0, end);
  let inPos = false;
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^=+\s*(.+?)\s*=+$/);
    if (heading) {
      inPos = POS_HEADING.test(heading[1]);
      continue;
    }
    if (!inPos || SKIP_LINE.test(line) || /IPA|발음:/.test(line)) continue;
    // 표제어 줄: "야구 (yagu) (한자 野球)"
    if (word && line.startsWith(word) && (line.length === word.length || /^\S+\s*\(/.test(line))) continue;
    const def = line
      .replace(/^(\([^)]*\)\s*)+/, '') // (스포츠), (비유) 같은 분류 표시
      .replace(/『[^』]*』\s*/g, '')
      .replace(/\s*=\s*[^=]+$/, '')
      .trim();
    if (def) return cut(def);
  }
  return '한국어 낱말이에요';
}

/** 위키백과 첫 문장 (괄호 속 한자·영어는 뺌) */
export function wikipediaDesc(extract) {
  let t = String(extract ?? '');
  for (let i = 0; i < 3; i++) t = t.replace(/\s*\([^()]*\)/g, '');
  const first = t.split(/(?<=다\.)\s/)[0] ?? t;
  return first.trim() ? cut(first) : '위키백과에 있는 말이에요';
}

async function query(base, word, extra) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EACH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', redirects: '1', titles: word, ...extra });
    const res = await fetch(`${base}?${params}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const page = Object.values(json?.query?.pages ?? {})[0];
    if (!page) throw new Error('bad response');
    return page;
  } finally {
    clearTimeout(timer);
  }
}

const cache = new Map();

/**
 * 사전에 있으면 { desc, source }, 없으면 null.
 * 두 곳 다 응답이 없으면(네트워크·요청 제한) 에러를 던진다 — 없는 단어로 치지 않기 위해.
 */
export async function lookupWord(word) {
  if (cache.has(word)) return cache.get(word);
  let failures = 0;
  let result = null;

  try {
    const page = await query(WIKTIONARY, word, { prop: 'extracts', explaintext: '1', exchars: '600' });
    if (!('missing' in page)) {
      const desc = wiktionaryDesc(page.extract, word);
      if (desc) result = { desc, source: '위키낱말사전' };
    }
  } catch {
    failures += 1;
  }

  if (!result) {
    try {
      const page = await query(WIKIPEDIA, word, {
        prop: 'extracts|pageprops',
        exintro: '1',
        explaintext: '1',
        exsentences: '2',
        ppprop: 'disambiguation',
      });
      if (!('missing' in page)) {
        const disamb = page.pageprops && 'disambiguation' in page.pageprops;
        result = { desc: disamb ? '여러 뜻이 있는 말이에요' : wikipediaDesc(page.extract), source: '위키백과' };
      }
    } catch {
      failures += 1;
    }
  }

  if (!result && failures) throw new Error('lookup failed');
  cache.set(word, result);
  return result;
}
