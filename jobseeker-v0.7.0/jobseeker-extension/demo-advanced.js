window.stageActions=0;
for(const id of ['next','save','confirm'])document.getElementById(id).onclick=()=>{window.stageActions++;document.getElementById('trace').textContent='사용자가 테스트 버튼을 직접 눌렀습니다.';};
document.getElementById('application').onsubmit=event=>{event.preventDefault();window.stageActions++;};
document.getElementById('custom-gender').onclick=()=>document.getElementById('gender-options').hidden=false;
for(const option of document.querySelectorAll('#gender-options [role=option]'))option.onclick=()=>{document.getElementById('custom-gender').textContent=option.textContent;document.getElementById('gender-options').hidden=true;};
document.getElementById('address-search').onclick=()=>window.open('demo-address.html','jobseeker-demo-address','width=650,height=500');
