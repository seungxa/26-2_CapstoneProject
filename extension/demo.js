const $ = id => document.getElementById(id);
$('category').onclick = () => { $('category-options').hidden = false; $('category').setAttribute('aria-expanded', 'true'); };
for (const option of document.querySelectorAll('[role=option]')) option.onclick = () => {
  $('category').textContent = option.textContent; $('category-options').hidden = true; $('category').setAttribute('aria-expanded', 'false');
};
$('open-school').onclick = () => $('school-dialog').showModal();
$('close-dialog').onclick = () => $('school-dialog').close();
$('school-search').onclick = () => {
  $('school-results').replaceChildren();
  for (const school of ['예시대학교 서울캠퍼스', '예시대학교 수원캠퍼스'].filter(x => x.includes($('school-query').value))) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = school;
    button.onclick = () => { $('school').value = school; $('school-dialog').close(); };
    $('school-results').append(button);
  }
};
$('add-experience').onclick = () => {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend'); legend.textContent = '경력'; fieldset.append(legend);
  for (const title of ['회사명', '부서', '직무', '담당업무']) {
    const label = document.createElement('label'); label.textContent = title;
    label.append(document.createElement('input')); fieldset.append(label);
  }
  $('experience').append(fieldset);
};
document.querySelector('form').onsubmit = event => { event.preventDefault(); $('submitted').textContent = '테스트 제출 버튼을 직접 눌렀습니다. 전송되지 않았습니다.'; };
