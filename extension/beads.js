// 사이버 염주: 팝업 속 장난감. 누를 때마다 구슬 12알 중 다음 알이 밝아지고, 오늘 수와 전체 수를 센다.
// 순수 함수만 둔다(저장은 popup.js가 chrome.storage.local 키 STORAGE_KEY로 한다).
export const BEADS = 12;
export const MILESTONE = 108;
export const STORAGE_KEY = 'jobseeker.beads.v1';

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** 저장값을 읽는다. 날짜가 오늘이 아니면 오늘 수는 0, 이상한 값도 0으로 본다 */
export function load(raw, today) {
  const saved = raw && typeof raw === 'object' ? raw : {};
  return {
    date: today,
    today: saved.date === today ? count(saved.today) : 0,
    total: count(saved.total),
    open: typeof saved.open === 'boolean' ? saved.open : true,
  };
}

/** 한 알 넘긴다: 새 상태, 밝아질 구슬 번호(0~11), 오늘 몇 바퀴째인지, 108번째인지 */
export function press(state, today) {
  const current = load(state, today);
  const next = { ...current, today: current.today + 1, total: current.total + 1 };
  return {
    state: next,
    bead: (next.today - 1) % BEADS,
    lap: Math.floor(next.today / BEADS),
    milestone: next.today % MILESTONE === 0,
  };
}
