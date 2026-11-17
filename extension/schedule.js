// 팝업의 D-day. 웹(frontend/src/features/practice-track/components/track/dday.ts)과 같은 규칙이다.

/** 사용자 기기의 오늘 날짜(YYYY-MM-DD, UTC가 아님) */
export function todayLocal(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export const daysUntil = (date, today) => Math.round(dayNumber(date) - dayNumber(today));

/** "D-day", "D-3", 지난 날짜는 "Closed" */
export function ddayText(date, today) {
  const days = daysUntil(date, today);
  return days < 0 ? 'Closed' : days === 0 ? 'D-day' : `D-${days}`;
}

/** 지원 건이 기다리는 날짜. 지원 전: 마감일·다음 일정 중 다가오는 이른 것(없으면 지난 마감일).
 *  지원 뒤: 다가오는 다음 일정만. 결과가 난 건은 없음 */
export function dueOf(app, today) {
  if (app.status === '합격' || app.status === '불합격') return null;
  const before = !app.applied_at;
  const upcoming = [];
  if (before && app.deadline && app.deadline >= today) upcoming.push({ date: app.deadline, kind: 'deadline' });
  if (app.next_step_on && app.next_step_on >= today) upcoming.push({ date: app.next_step_on, kind: 'next_step' });
  if (upcoming.length) return upcoming.sort((a, b) => a.date.localeCompare(b.date))[0];
  if (before && app.deadline) return { date: app.deadline, kind: 'deadline' };
  return null;
}
