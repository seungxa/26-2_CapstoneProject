window.stageActions = 0;
for (const id of ['next', 'submit']) document.getElementById(id).addEventListener('click', () => window.stageActions++);
document.getElementById('apply').addEventListener('submit', () => window.stageActions++);

// Open shadow DOM component (web-component based forms).
customElements.define('name-box', class extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<label>영문 이름 <input id="en"></label>'; }
});

// Toggle buttons without ARIA: state lives in the "on" class.
for (const b of document.querySelectorAll('.tg')) b.onclick = () => { document.querySelectorAll('.tg').forEach(x => x.classList.remove('on')); b.classList.add('on'); };

// select2-like: hidden native select mirrored by a span; list opens on mousedown.
const branch = document.getElementById('branch'), branchUI = document.getElementById('branch-ui');
branch.addEventListener('change', () => { branchUI.textContent = branch.selectedOptions[0].textContent; });
branchUI.addEventListener('mousedown', () => {
  const ul = document.createElement('ul'); ul.className = 'select2-results';
  for (const o of [...branch.options].slice(1)) { const li = document.createElement('li'); li.textContent = o.textContent; li.onmouseup = () => { branch.value = o.value; branch.dispatchEvent(new Event('change')); ul.remove(); }; ul.append(li); }
  branchUI.after(ul);
});

// Plain div dropdown, no ARIA, no native select.
const svc = document.getElementById('svc');
svc.addEventListener('click', () => {
  if (document.querySelector('.opts')) return;
  const ul = document.createElement('ul'); ul.className = 'opts';
  for (const t of ['군필', '미필', '면제', '해당없음']) { const li = document.createElement('li'); li.textContent = t; li.onclick = e => { e.stopPropagation(); svc.querySelector('.txt').textContent = t; document.getElementById('svc-value').value = t; ul.remove(); }; ul.append(li); }
  svc.after(ul);
});

// In-page search layer for school / major.
const DB = { school: ['예시대학교(본교)', '예시대학교(제2캠퍼스)', '예시과학대학교', '한국대학교'], major: ['컴퓨터공학', '컴퓨터공학과(야간)', '컴퓨터·소프트웨어공학', '전기전자공학'] };
let target = null, topic = null;
const layer = document.getElementById('layer');
function open(kind, input) { topic = kind; target = input; document.getElementById('layer-title').textContent = kind === 'school' ? '학교 검색' : '전공 검색'; document.getElementById('layer-q').value = ''; document.getElementById('layer-list').replaceChildren(); layer.hidden = false; }
document.getElementById('uni-find').onclick = () => open('school', document.getElementById('uni'));
document.getElementById('major-find').onclick = () => open('major', document.getElementById('major'));
document.getElementById('layer-close').onclick = () => layer.hidden = true;
window.searchLog = [];
document.getElementById('layer-go').onclick = () => {
  const q = document.getElementById('layer-q').value.trim(); window.searchLog.push(topic + ':' + q);
  setTimeout(() => {
    const list = document.getElementById('layer-list'); list.replaceChildren();
    for (const name of DB[topic].filter(n => n.includes(q))) { const li = document.createElement('li'); li.innerHTML = '<a href="#">' + name + '</a>'; li.onclick = e => { e.preventDefault(); target.value = name; layer.hidden = true; }; list.append(li); }
  }, 200);
};
