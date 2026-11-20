// Generic interaction helpers shared by the form page and search popups.
// Only selection-type actions live here: opening a list, choosing an option,
// typing a search term and picking a result. Nothing here submits a form.
(() => {
  if (globalThis.JobSeekerWidgets) return;
  const V = globalThis.JobSeekerValues;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = el => (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
  const visible = el => !!el?.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]');
  const STOP = /제출|최종|지원완료|지원하기|접수|결제|동의|약관|탈퇴|삭제|로그아웃|로그인|다음|이전|저장|임시저장|닫기|취소|submit|apply|payment|consent|delete|close|cancel|next|prev|save/i;
  const SEARCH_BUTTON = /^(검색|조회|찾기|search|go|확인검색|학교검색|전공검색|학과검색|자격증검색|기관검색|주소검색)$/i;
  const CONFIRM_BUTTON = /^(선택|선택완료|적용|등록|확인|입력|ok|select|apply)$/i;

  function deepQueryAll(root, selector) {
    const out = [...root.querySelectorAll(selector)];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) if (n.shadowRoot) out.push(...deepQueryAll(n.shadowRoot, selector));
    return out;
  }
  // Native value setter so React/Vue controlled inputs see the change.
  function setValue(el, value) {
    api.lastSynthetic = Date.now();
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    el.focus?.({ preventScroll: true });
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    const last = String(value).slice(-1) || 'a';
    for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: last, bubbles: true, composed: true }));
  }
  // Validation-on-blur handlers: dispatch the events only, focus is not moved.
  function commit(el) { el.dispatchEvent(new FocusEvent('blur', { composed: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })); }
  function key(el, name) {
    const code = { Enter: 13, Escape: 27, ArrowDown: 40 }[name];
    for (const type of ['keydown', 'keypress', 'keyup']) {
      if (type === 'keypress' && name !== 'Enter') continue;
      const ev = new KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true, composed: true });
      for (const prop of ['keyCode', 'which']) Object.defineProperty(ev, prop, { get: () => code });
      el.dispatchEvent(ev);
    }
  }
  // Many custom widgets open on mousedown/pointerdown, not click.
  function click(el) {
    api.lastSynthetic = Date.now();
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
    for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { ...init, pointerId: 1, isPrimary: true }));
    el.focus?.({ preventScroll: true });
    for (const type of ['pointerup', 'mouseup']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { ...init, pointerId: 1, isPrimary: true }));
    el.click();
  }
  function navigates(el) {
    const a = el.closest('a[href]');
    if (a && !/^(#|javascript:)/i.test(a.getAttribute('href').trim()) && a.target !== '_self') {
      // A link to another page is never a list option.
      try { if (new URL(a.href).pathname !== location.pathname || new URL(a.href).search !== location.search) return true; } catch { return true; }
    }
    const handler = ['onclick', 'onmousedown'].map(k => el.getAttribute(k) || '').join(' ');
    return /\.submit\s*\(|requestSubmit|location\s*[.=]|(?:next|submit|save)(?:step|form|page)?\s*\(/i.test(handler);
  }

  // ---- Lists that open on click ----------------------------------------
  const ITEM = '[role=option],[role=menuitem],[role=menuitemradio],[role=treeitem],li,[data-value],[class*=option],[class*=Option],[class*=item],[class*=Item]';
  const styleKey = el => (el.className?.baseVal ?? el.className ?? '') + '|' + (el.getAttribute('style') || '') + '|' + getComputedStyle(el).backgroundColor + '|' + getComputedStyle(el).color;
  const isOn = el => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || el.checked === true || /(^|\s)(on|active|selected|checked|is-active|is-selected|is-checked|current)(\s|$)/i.test(el.className?.baseVal ?? el.className ?? '');
  function snapshot() {
    const set = new Set(deepQueryAll(document, ITEM).filter(visible));
    set.leaves = new Set(deepQueryAll(document, 'div,span,li,a,p').filter(el => !el.children.length && visible(el)));
    return set;
  }
  // The options that appeared after opening a widget, grouped by their list.
  function appearedOptions(before, trigger) {
    const ids = (trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean);
    const owned = ids.map(id => (trigger.getRootNode().getElementById?.(id)) || document.getElementById(id)).filter(Boolean);
    let items = owned.length ? owned.flatMap(root => [...root.querySelectorAll('[role=option],li,[data-value]')]) : deepQueryAll(document, ITEM).filter(el => !before.has(el));
    items = items.filter(el => visible(el) && !el.contains(trigger) && text(el) && text(el).length <= 120 && !el.querySelector('input:not([type=radio]):not([type=checkbox]),select,textarea'));
    // Keep the innermost item when wrappers and their children both match.
    items = items.filter(el => !items.some(other => other !== el && el.contains(other)));
    if (!items.length && !owned.length && before.leaves) {
      // Menus built from plain divs: short text boxes that were not on screen before.
      items = deepQueryAll(document, 'div,span,li,a,p').filter(el => !before.leaves.has(el) && visible(el) && !el.children.length && text(el) && text(el).length <= 40 && !el.contains(trigger) && !trigger.contains(el));
    }
    const groups = new Map();
    for (const el of items) { const key = el.parentElement; groups.set(key, [...(groups.get(key) || []), el]); }
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
    return best.length >= 2 ? best : [];
  }
  async function choose(items, desired, { pick, label, strict, aiOnly } = {}) {
    const options = items.map(el => ({ label: text(el), value: el.getAttribute('data-value') || el.getAttribute('value') || '' }));
    const found = aiOnly ? null : V.matchOption(options, desired);
    if (found?.index >= 0 && !(strict && found.loose)) return { node: items[found.index], how: found.loose ? 'rule-loose' : 'rule' };
    if (pick) {
      const candidates = (found?.ambiguous?.length ? found.ambiguous : options.map((_, i) => i)).slice(0, 60);
      const reply = await pick({ query: desired, label, candidates: candidates.map(i => options[i].label) }).catch(() => null);
      if (reply?.index >= 0 && reply.index < candidates.length) return { node: items[candidates[reply.index]], how: 'llm' };
    }
    return { node: null, ambiguous: Boolean(found?.ambiguous) };
  }
  async function openAndChoose(trigger, desired, opts = {}) {
    const before = snapshot();
    const typeable = trigger.matches('input:not([readonly]),textarea');
    if (typeable) { setValue(trigger, opts.term || desired); } else click(trigger);
    let items = [];
    for (let i = 0; i < 14 && !items.length; i++) { await sleep(150); items = appearedOptions(before, trigger); }
    if (!items.length && typeable) { key(trigger, 'ArrowDown'); await sleep(250); items = appearedOptions(before, trigger); }
    if (!items.length) return { ok: false, message: 'The list did not open.' };
    const { node, how, ambiguous } = await choose(items, desired, opts);
    if (!node) { key(trigger, 'Escape'); return { ok: false, message: ambiguous ? 'Several options fit.' : 'No matching option.' }; }
    if (navigates(node) || STOP.test(text(node)) && !V.similar(text(node), desired)) return { ok: false, message: 'Not clicked: it may change the page.' };
    const target = node.querySelector('a,button,[role=option],input[type=radio],input[type=checkbox]') || node;
    const label = text(node);
    click(target);
    await sleep(200);
    const shown = (trigger.matches('input,textarea') ? trigger.value : text(trigger)) || '';
    const ok = V.core(shown).includes(V.core(label)) || isOn(node) || node.getAttribute('aria-selected') === 'true' || !visible(node);
    return { ok, label, how, message: ok ? 'Picked "' + label + '"' : 'Could not confirm the pick.' };
  }

  // ---- Hidden native selects behind custom UIs (select2, chosen, nice-select …) ----
  const PROXY = /select2|chosen|nice-select|selectric|bootstrap-select|selectize|choices|custom-select|selectbox|sbHolder|ui-selectmenu|dropdown|select-box|vs__|multiselect/i;
  function proxyFor(select) {
    if (visible(select)) return null;
    const near = [select.nextElementSibling, select.nextElementSibling?.nextElementSibling, select.previousElementSibling, select.parentElement].filter(Boolean);
    return near.find(el => visible(el) && (PROXY.test(el.className?.baseVal ?? el.className ?? '') || el.getAttribute('role') === 'combobox' || el.querySelector('[role=combobox],[aria-haspopup]'))) || null;
  }
  async function syncProxy(select, label) {
    const proxy = proxyFor(select);
    if (!proxy) return true;
    // Libraries that mirror the select only on their own events.
    for (const type of ['chosen:updated', 'liszt:updated', 'refresh']) select.dispatchEvent(new CustomEvent(type, { bubbles: true }));
    await sleep(120);
    if (V.core(text(proxy)).includes(V.core(label))) return true;
    const trigger = proxy.querySelector('[role=combobox],[aria-haspopup],.select2-selection,.chosen-single,a,button,span') || proxy;
    const result = await openAndChoose(trigger, label, { strict: true });
    return result.ok && select.selectedOptions[0] && V.core(text(select.selectedOptions[0])) === V.core(label);
  }

  // ---- Toggle-button groups (남/여 buttons without ARIA) -----------------
  const TOGGLE_STOP = /검색|찾기|추가|삭제|확인|저장|다음|이전|취소|닫기|조회|등록|선택|초기화|변경|수정|보기|업로드|첨부|인증|중복|전송|발송|열기/;
  function toggleGroup(el) {
    if (!el.matches('button[type=button]:not([aria-pressed]),[role=button]') || TOGGLE_STOP.test(text(el))) return null;
    const isBtn = n => n.matches('button[type=button]:not([aria-pressed]),[role=button]') && visible(n);
    // Buttons side by side, or each wrapped in its own <li>/<div> ("군필 | 미필 | 면제").
    let siblings = [...el.parentElement.children].filter(isBtn);
    if (siblings.length < 2 && el.parentElement.children.length === 1 && el.parentElement.parentElement) {
      const wrappers = [...el.parentElement.parentElement.children];
      const inner = wrappers.map(w => [...w.children].filter(isBtn));
      if (wrappers.length >= 2 && inner.every(list => list.length === 1)) siblings = inner.map(list => list[0]);
    }
    if (siblings.length < 2 || siblings.length > 8 || siblings.some(n => TOGGLE_STOP.test(text(n)) || !text(n) || text(n).length > 12)) return null;
    return siblings;
  }

  // ---- Search popups ------------------------------------------------------
  const layerCandidates = () => deepQueryAll(document, 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true],div,section,aside').filter(el => {
    if (!visible(el)) return false;
    if (el.matches('dialog,[role=dialog],[role=alertdialog],[aria-modal=true]')) return true;
    const s = getComputedStyle(el);
    if (!['fixed', 'absolute'].includes(s.position)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 180 && r.height >= 100 && el.querySelector('input[type=text],input[type=search],input:not([type])');
  });
  function layerSnapshot() { return new Set(layerCandidates()); }
  // A layer/dialog that appeared after the search button was pressed and does not hold the form field.
  function popupRoot(before, field) {
    const fresh = layerCandidates().filter(el => (!before || !before.has(el)) && !(field && el.contains(field)));
    const outer = fresh.filter(el => !fresh.some(other => other !== el && other.contains(el)));
    return outer.at(-1) || null;
  }
  function searchInput(root, topic) {
    const inputs = [...root.querySelectorAll('input[type=text],input[type=search],input:not([type])')].filter(el => visible(el) && !el.readOnly && !el.disabled);
    if (inputs.length === 1) return inputs[0];
    // The search box is the one with a search button right beside it.
    const besideButton = inputs.filter(el => [...(el.parentElement?.querySelectorAll(BUTTONS) || [])].some(b => SEARCH_BUTTON.test(V.core(buttonLabel(b)).replace(/[▸▶>›]/g, ''))));
    if (besideButton.length === 1) return besideButton[0];
    const words = { address: /주소|도로명|건물|지번|address/i, school: /학교|school/i, major: /전공|학과|major/i, credential: /자격|license|cert/i }[topic];
    const semantic = inputs.filter(el => /검색|keyword|query|search|sch|찾|명/i.test([el.placeholder, el.name, el.id, el.getAttribute('aria-label'), el.title].join(' ')) && !/상세|detail/i.test([el.placeholder, el.name, el.id].join(' ')));
    const topical = semantic.filter(el => words?.test([el.placeholder, el.name, el.id, el.getAttribute('aria-label'), el.title].join(' ')));
    return topical.length === 1 ? topical[0] : semantic.length === 1 ? semantic[0] : null;
  }
  // Buttons drawn as images ("학교검색▸", "등록") carry their name in alt/title.
  const buttonLabel = el => text(el) || el.value || el.alt || el.title || el.getAttribute('aria-label') || [...el.querySelectorAll('img')].map(i => i.alt || i.title).join('') || '';
  const BUTTONS = 'button,input[type=button],input[type=submit],input[type=image],a,[role=button],img[onclick],span[onclick]';
  function searchButton(root, input) {
    const all = [...root.querySelectorAll(BUTTONS)].filter(el => visible(el) && SEARCH_BUTTON.test(V.core(buttonLabel(el)).replace(/[▸▶>›]/g, '')) && !(el.matches('img') && el.closest('a,button')));
    if (all.length === 1) return all[0];
    const sameForm = input?.form ? all.filter(el => el.form === input.form || input.form.contains(el)) : [];
    if (sameForm.length === 1) return sameForm[0];
    const near = all.filter(el => input && el.parentElement && el.parentElement.contains(input));
    return near.length === 1 ? near[0] : null;
  }
  function resultItems(root, exclude) {
    const candidates = [...root.querySelectorAll('[role=option],li,tr,a,button,td[onclick],[onclick],label,[data-value]')].filter(el =>
      visible(el) && !exclude.some(x => x && (el === x || el.contains(x))) && !el.matches('th,thead tr') && !el.closest('thead'));
    const items = candidates.filter(el => {
      const t = text(el);
      if (!t || t.length > 160 || SEARCH_BUTTON.test(V.core(t)) || CONFIRM_BUTTON.test(V.core(t)) || /^(이전|다음|처음|마지막|[0-9]{1,3}|<|>|«|»)$/.test(t)) return false;
      if (el.matches('tr') && !el.querySelector('td')) return false;
      if (el.matches('a,button') && el.closest('nav,.paging,.pagination,[class*=pag]')) return false;
      return true;
    });
    // Prefer whole rows / list items over the links inside them so the text is complete.
    return items.filter(el => !items.some(other => other !== el && other.contains(el) && (other.matches('tr,li,[role=option]') || !el.matches('tr,li,[role=option]'))));
  }
  const fingerprint = root => text(root).length + ':' + root.querySelectorAll('*').length;
  async function waitForResults(root, exclude, before, timeout = 6000) {
    let last = fingerprint(root), stable = 0;
    for (let t = 0; t < timeout; t += 200) {
      await sleep(200);
      const now = fingerprint(root);
      if (now !== last) { last = now; stable = 0; continue; }
      if (now !== before && ++stable >= 2) break;
    }
    return resultItems(root, exclude);
  }
  // A result row "정보처리기사 | 한국산업인력공단": compare the name cell; the rest (issuer, region) breaks ties.
  // The name cell: a clickable cell if any, otherwise the first cell with text (a leading radio cell is skipped).
  const nameOf = el => text(el.matches('tr') ? (el.querySelector('td[onclick],td a,td button,td.s_tle') || [...el.querySelectorAll('td')].find(td => text(td)) || el) : el);
  // Popups that ask for more before "등록" (대학계열, 발급기관, 등록번호, 취득일자): fill empty boxes from the archive.
  function fillExtras(root, extras) {
    if (!extras) return;
    const controls = [...root.querySelectorAll('input[type=text],input:not([type]),select')].filter(el => visible(el) && !el.disabled && !el.readOnly);
    const labelFor = el => {
      const cell = el.closest('td,th'), row = cell?.parentElement, prevRow = row?.previousElementSibling;
      if (cell && prevRow && !prevRow.querySelector('input,select')) { const head = prevRow.cells[cell.cellIndex]; if (head && text(head)) return text(head); }
      for (let p = el.previousSibling; p; p = p.previousSibling) { const t = (p.textContent || '').trim(); if (t) return t; }
      return el.matches('select') ? text(el.options[0]) : (el.placeholder || el.title || '');
    };
    for (const [name, value] of Object.entries(extras)) {
      if (!value) continue;
      const hits = controls.filter(el => V.core(labelFor(el)).includes(V.core(name)) || el.matches('select') && V.core(text(el.options[0])).includes(V.core(name)));
      if (!hits.length) continue;
      if (hits.length === 1 && hits[0].matches('select')) {
        const sel = hits[0], found = V.matchOption([...sel.options].map(o => ({ label: text(o), value: o.value })), value);
        if (found?.index >= 0 && !sel.value) setValue(sel, sel.options[found.index].value);
        continue;
      }
      // Date split into 년/월/일 boxes in one cell.
      const cellBoxes = hits[0].closest('td') ? [...hits[0].closest('td').querySelectorAll('input[type=text],input:not([type])')].filter(visible) : hits;
      if (/일자|일$|날짜|date/i.test(name) && cellBoxes.length >= 2) {
        const parts = String(value).replace(/[년월일.\/]/g, '-').split('-').map(s => s.trim()).filter(Boolean);
        cellBoxes.forEach((box, i) => { if (!box.value && parts[i]) setValue(box, i ? parts[i].padStart(2, '0') : parts[i]); });
      } else if (hits.length === 1 && !hits[0].value) setValue(hits[0], value);
    }
  }
  async function pickResult(root, items, query, { pick, label, topic, matcher, detail, extras, closest = false }) {
    let node = null, how = '', review = null;
    const byDetail = list => detail && list.length > 1 ? list.filter(el => V.core(text(el)).includes(V.core(detail))) : list;
    if (matcher) {
      const hits = items.filter(el => matcher(text(el)));
      if (hits.length === 1) { node = hits[0]; how = 'rule'; }
      else if (hits.length > 1) return { ambiguous: true };
    } else {
      const exact = byDetail(items.filter(el => V.core(nameOf(el)) === V.core(query)));
      const same = byDetail(items.filter(el => V.sameEntity(nameOf(el), query) || topic === 'major' && V.sameMajor(nameOf(el), query)));
      if (exact.length === 1) { node = exact[0]; how = 'rule'; }
      else if (!exact.length && same.length === 1) { node = same[0]; how = 'rule'; }
      else {
        // Several fits, or only near-misses ("…과(야간)"): the AI may choose; otherwise the user does.
        const close = items.filter(el => V.similar(nameOf(el), query) || topic === 'major' && V.sameMajor(nameOf(el), query));
        const pool = exact.length > 1 ? exact : same.length > 1 ? same : close.length ? close : items;
        if (!pick && !closest) return { ambiguous: exact.length > 1 || same.length > 1, near: close.length > 0 };
        const r = pick ? await choose(pool, query, { pick, label: label || topic, strict: true, aiOnly: true }).catch(() => ({})) : {};
        if (r.node) { node = r.node; how = r.how; review = { picked: nameOf(r.node), how: 'AI' }; }
        else if (closest) {
          // No single exact fit: take the highest-scoring result and leave it for a human to check.
          const ranked = V.rank(byDetail(items).length ? byDetail(items) : items, query, topic, nameOf).filter(c => !navigates(c.item));
          const best = ranked[0];
          if (!best || best.score < V.AUTO_PICK(topic)) return { ambiguous: pool.length > 1 };
          node = best.item; how = 'score';
          review = { picked: best.name, score: best.score, others: ranked.slice(1, 4).map(c => c.name) };
        }
        else return { ambiguous: pool.length > 1 };
      }
    }
    if (!node || navigates(node)) return { ambiguous: false };
    const radio = node.querySelector('input[type=radio],input[type=checkbox]');
    const inner = radio || node.querySelector('a:not([href^="http"]),button,[onclick],[role=option]') || node;
    const picked = nameOf(node);
    click(inner);
    if (radio) {
      await sleep(150);
      fillExtras(root, extras);
      await sleep(100);
      const confirm = [...root.querySelectorAll(BUTTONS)].filter(el => visible(el) && CONFIRM_BUTTON.test(V.core(buttonLabel(el))) && !navigates(el) && !(el.matches('img') && el.closest('a,button')));
      if (confirm.length === 1) click(confirm[0]);
    }
    return { picked, how, review };
  }
  // Type each candidate term in turn until the result list has exactly one fitting entry.
  async function searchAndPick(root, { terms, query, topic, pick, label, matcher, field, detail, extras, isCancelled = () => false }) {
    const input = searchInput(root, topic);
    if (!input) return { ok: false, message: 'Search box not found.' };
    const button = searchButton(root, input);
    if (button && (navigates(button) && !root.ownerDocument?.defaultView?.opener) || button && field && button.form && button.form.contains(field)) return { ok: false, message: 'Unsure what the search button does; not pressed.' };
    if (input.value && !terms.includes(input.value)) return { ok: false, message: 'The search box already had text — stopped.' };
    let ambiguous = false;
    // A popup that reloaded after a server-side search already shows the results for our term.
    const resumed = terms.indexOf(input.value);
    if (resumed >= 0) {
      const items = resultItems(root, [input, button]);
      const result = items.length ? await pickResult(root, items, query, { pick, label, topic, matcher, detail, extras }) : {};
      if (result.picked) return { ok: true, term: input.value, picked: result.picked, how: result.how, message: '"' + input.value + '" → "' + result.picked + '"' };
      if (result.ambiguous) return { ok: false, message: 'Several results — pick one.' };
      terms = terms.slice(resumed + 1);
    }
    // Pass 1: rules only, every term. Pass 2: the AI judges the first term that gave near-misses.
    let deferred = null, anyResults = null, bestTerm = null, bestScore = -1;
    for (const term of terms) {
      if (isCancelled()) return { ok: false, message: 'Stopped.' };
      const items = await runSearch(root, input, button, term);
      if (isCancelled()) return { ok: false, message: 'Stopped.' };
      if (input.isConnected && input.value !== term) return { ok: false, message: 'You changed the search — stopped.' };
      if (!items.length) continue;
      // Remember which search term produced the closest result, for the fallback pick below.
      const top = V.rank(items, query, topic, nameOf)[0];
      if (top && top.score > bestScore) { bestScore = top.score; bestTerm = term; }
      const result = await pickResult(root, items, query, { label, topic, matcher, detail, extras });
      if (result.picked) return { ok: true, term, picked: result.picked, how: result.how, message: '"' + term + '" → "' + result.picked + '"' };
      if (result.ambiguous) { ambiguous = true; deferred ??= term; if (!pick) break; }
      else if (result.near) deferred ??= term;
      else anyResults ??= term;
    }
    // Nothing looked close by name: the scorer still gets one look at the first non-empty result list.
    deferred ??= anyResults;
    if (deferred && bestTerm) deferred = bestTerm;
    if (deferred && !matcher) {
      const items = input.value === deferred ? resultItems(root, [input, button]) : await runSearch(root, input, button, deferred);
      const result = items.length ? await pickResult(root, items, query, { pick, label, topic, detail, extras, closest: true }) : {};
      if (result.picked) return { ok: true, term: deferred, picked: result.picked, how: result.how, review: result.review,
        message: '"' + deferred + '" → "' + result.picked + '" ' + (result.review?.score != null ? 'picked (match ' + Math.round(result.review.score * 100) + '%) · please check' : result.how === 'llm' ? 'picked by AI · please check' : '') };
    }
    return { ok: false, message: ambiguous ? 'Several results — pick one.' : deferred ? 'Only similar results — pick one.' : 'No matching result.' };
  }
  async function runSearch(root, input, button, term) {
    const before = fingerprint(root);
    setValue(input, term);
    if (button) click(button); else key(input, 'Enter');
    return waitForResults(root, [input, button], before);
  }

  const api = globalThis.JobSeekerWidgets = { lastSynthetic: 0, styleKey, deepQueryAll, setValue, commit, key, click, navigates, isOn, openAndChoose, choose, proxyFor, syncProxy, toggleGroup, layerSnapshot, popupRoot, searchInput, searchButton, resultItems, searchAndPick, visible, text, sleep };
})();
