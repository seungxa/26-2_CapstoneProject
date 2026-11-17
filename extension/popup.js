import { api, ApiError } from "./api.js";
import { guessPosting, readPage } from "./extract.js";
import { getSettings } from "./settings.js";
import { BEADS, STORAGE_KEY, load as loadBeads, press as pressBead } from "./beads.js";
import { daysUntil, ddayText, dueOf, todayLocal } from "./schedule.js";

const $ = (id) => document.getElementById(id);
let generation = 0;
let saving = false;

function clearAccountView() {
  generation++;
  saving = false;
  for (const id of ["existing", "save-form", "not-web"]) $(id).hidden = true;
  $("recent").replaceChildren();
  $("summary").textContent = "";
  $("save").disabled = false;
  $("ex-submit").disabled = false;
  $("submitted").checked = false;
  for (const id of ["company", "position"]) $(id).value = "";
}

function handleError(error, mine) {
  if (error instanceof ApiError && error.status === 401) {
    if (mine !== generation) return;
    clearAccountView();
    $("relogin").hidden = false;
  } else if (mine !== generation) return;
  showError(error.message);
}

const STATUS_CLASS = { 합격: "good", 불합격: "bad", 진행중: "accent" };

function showError(msg) {
  $("error").textContent = msg;
  $("error").hidden = !msg;
}

async function openWeb(path) {
  const { webUrl } = await getSettings();
  await chrome.tabs.create({ url: webUrl.replace(/\/$/, "") + path });
  window.close();
}

function statusChip(el, a) {
  el.textContent = a.status === "진행중" ? `${a.stage} 진행중` : a.status;
  el.className = `chip ${STATUS_CLASS[a.status] ?? ""}`;
}

/** 팝업이 가리키는 탭. 테스트에서는 ?tab=<id>로 지정할 수 있다. */
async function targetTab() {
  const forced = new URLSearchParams(location.search).get("tab");
  if (forced) return chrome.tabs.get(Number(forced));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readTab(tab) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    return res.result;
  } catch {
    // 스크립트를 넣을 수 없는 페이지(웹 스토어 등)는 탭 정보만 쓴다
    return { url: tab.url, title: tab.title ?? "", ogTitle: "", siteName: "", h1: "" };
  }
}

function showExisting(app, justSaved = false, mine = generation) {
  if (mine !== generation) return;
  $("save-form").hidden = true;
  $("existing").hidden = false;
  $("ex-msg").textContent = justSaved ? "지원 관리에 저장했어요." : "이미 지원 관리에 있는 공고예요.";
  $("ex-name").textContent = `${app.company} · ${app.position}`;
  statusChip($("ex-status"), app);
  $("ex-open").onclick = () => openWeb(`/track/${app.id}`);
  $("ex-practice").onclick = () => openWeb(`/practice?application=${app.id}`);
  $("ex-submit").onclick = async () => {
    if (saving) return;
    saving = true;
    $("ex-submit").disabled = true;
    try {
      await api.savePosting({ ...app, submitted: true });
      if (mine !== generation) return;
      $("ex-msg").textContent = "지원 완료로 표시했어요.";
      await loadRecent(mine);
    } catch (error) { handleError(error, mine); }
    finally { if (mine === generation) { saving = false; $("ex-submit").disabled = false; } }
  };
}

async function loadPosting(mine = generation) {
  const tab = await targetTab();
  if (mine !== generation) return;
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $("not-web").hidden = false;
    return;
  }
  const [existing] = await api.applications({ url: tab.url });
  if (mine !== generation) return;
  if (existing) return showExisting(existing, false, mine);

  $("read-posting").onclick = async () => {
    const guess = guessPosting(await readTab(tab));
    if (mine !== generation) return;
    $("company").value = guess.company;
    $("position").value = guess.position;
    $("job_category").value = guess.job_category;
  };
  $("save-form").hidden = false;
  $("save-form").onsubmit = async (e) => {
    e.preventDefault();
    if (saving || mine !== generation) return;
    saving = true;
    $("save").disabled = true;
    showError("");
    try {
      const res = await api.savePosting({
        company: $("company").value.trim(),
        position: $("position").value.trim(),
        job_category: $("job_category").value,
        url: tab.url,
        submitted: $("submitted").checked,
        deadline: $("deadline").value || null,
      });
      const [app] = await api.applications({ url: tab.url });
      if (mine !== generation) return;
      if (app) showExisting(app, true, mine);
      if (res.created) await loadRecent(mine);
    } catch (err) {
      handleError(err, mine);
    } finally {
      if (mine === generation) { saving = false; $("save").disabled = false; }
    }
  };
}

async function loadRecent(mine = generation) {
  const [apps, stats] = await Promise.all([api.applications(), api.stats()]);
  if (mine !== generation) return;
  $("summary").textContent = `전체 ${stats.total} · 진행중 ${stats.status["진행중"]} · 합격 ${stats.status["합격"]}`;
  const ul = $("recent");
  ul.replaceChildren();
  if (apps.length === 0) {
    const li = document.createElement("li");
    li.className = "small muted";
    li.textContent = "아직 저장된 지원 건이 없어요.";
    ul.append(li);
    return;
  }
  for (const a of apps.slice(0, 5)) {
    const li = document.createElement("li");
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: `${a.company} · ${a.position}` });
    const chip = document.createElement("span");
    statusChip(chip, a);
    li.append(name, chip);
    li.tabIndex = 0;
    li.setAttribute("role", "link");
    li.onclick = () => openWeb(`/track/${a.id}`);
    li.onkeydown = (event) => { if (event.key === "Enter") openWeb(`/track/${a.id}`); };
    ul.append(li);
  }
}

// 이 지원서 채우기: 사이드 패널은 사용자 클릭 안에서만 열 수 있어서, 탭은 팝업을 열 때 미리 찾아 두고
// 클릭하면 먼저 패널을 연 뒤 배경에 탭 연결(자동입력 준비)을 맡긴다
let fillTab = null;
targetTab().then((tab) => {
  fillTab = tab;
  $("fill").disabled = !(tab?.url && /^https?:/.test(tab.url));
}).catch(() => {});
$("fill").onclick = () => {
  if (!fillTab) return;
  chrome.sidePanel.open({ windowId: fillTab.windowId }).catch((error) => showError(error.message));
  chrome.runtime.sendMessage({ type: "JS_CONNECT_TAB", tabId: fillTab.id })
    .then((reply) => { if (reply?.error) showError(reply.error); else window.close(); })
    .catch((error) => showError(error.message));
};

$("open-track").onclick = () => openWeb("/track");
$("open-practice").onclick = () => openWeb("/practice");

$("relogin").onclick = async () => {
  const { loginUrl } = await getSettings();
  if (!loginUrl) return showError("설정에서 팀 로그인 주소를 입력하세요. 로그인 담당자의 토큰 연결이 필요합니다.");
  await chrome.tabs.create({ url: loginUrl });
  window.close();
};
/** 앞으로 7일 안의 마감일·다음 일정(D-day 순 최대 5건). 오늘·내일은 "오늘 할 일"로 따로 보인다 */
async function loadUpcoming(mine = generation) {
  const apps = await api.upcoming();
  if (mine !== generation) return;
  const today = todayLocal();
  const items = apps.map((a) => ({ a, due: dueOf(a, today) }))
    .filter(({ due }) => due && daysUntil(due.date, today) >= 0 && daysUntil(due.date, today) <= 7)
    .sort((x, y) => x.due.date.localeCompare(y.due.date)).slice(0, 5);
  const row = ({ a, due }) => {
    const li = document.createElement("li");
    const what = due.kind === "deadline" ? "마감" : (a.next_step || "다음 일정");
    const open = Object.assign(document.createElement("button"), { className: "due-open", type: "button" });
    open.append(Object.assign(document.createElement("span"), { className: "chip due", textContent: ddayText(due.date, today) }),
      Object.assign(document.createElement("span"), { className: "name", textContent: `${a.company} · ${what}` }));
    open.onclick = () => openWeb(`/track/${a.id}`);
    li.append(open);
    return li;
  };
  const urgent = items.filter(({ due }) => daysUntil(due.date, today) <= 1);
  $("today-list").replaceChildren(...urgent.map(row));
  const later = items.filter(({ due }) => daysUntil(due.date, today) > 1);
  $("soon-list").replaceChildren(...later.map(row));
  $("today-box").hidden = urgent.length === 0;
  $("soon-box").hidden = later.length === 0;
}

function loadAccount() {
  const mine = generation;
  Promise.all([loadPosting(mine), loadRecent(mine), loadUpcoming(mine)]).catch((e) => handleError(e, mine));
}

// ───────── 사이버 염주 ─────────
const beadEls = Array.from({ length: BEADS }, (_, i) => {
  const el = document.createElement("span");
  el.className = "bead";
  el.style.setProperty("--i", i);
  return el;
});
document.querySelector(".beads").append(...beadEls);
let beads = loadBeads(null, todayLocal());
function drawBeads(lit = -1) {
  $("beads-count").textContent = `오늘 ${beads.today}번 · 모두 ${beads.total}번`;
  beadEls.forEach((el, i) => el.classList.toggle("lit", i === lit));
}
chrome.storage.local.get(STORAGE_KEY).then((saved) => {
  beads = loadBeads(saved[STORAGE_KEY], todayLocal());
  $("beads-box").open = beads.open;
  drawBeads(beads.today ? (beads.today - 1) % BEADS : -1);
}).catch(() => drawBeads());
$("beads-box").addEventListener("toggle", () => {
  beads = { ...beads, open: $("beads-box").open };
  chrome.storage.local.set({ [STORAGE_KEY]: beads }).catch(() => {});
});
$("bead").onclick = () => {
  const result = pressBead(beads, todayLocal());
  beads = result.state;
  drawBeads(result.bead);
  chrome.storage.local.set({ [STORAGE_KEY]: beads }).catch(() => {});
  if (result.milestone) {
    $("beads-cheer").hidden = false;
    setTimeout(() => { $("beads-cheer").hidden = true; }, 2000);
  }
};
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== "session" || !changes.accessToken) return;
  clearAccountView();
  showError(changes.accessToken.newValue ? "" : "로그인 세션이 종료되었습니다. 다시 로그인하세요.");
  $("relogin").hidden = !!changes.accessToken.newValue;
  if (changes.accessToken.newValue) loadAccount();
});
loadAccount();
