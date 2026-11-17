# 0.7.0 검증

- npm test: 31/31 통과 (tests/values-adapt.test.js, tests/llm.test.js 신규)
- PW_CHANNEL=chromium node tests/stage-browser.cjs: 4/4 통과
- node tests/advanced-browser.cjs: 3/3 통과
- PW_CHANNEL=chromium node tests/generic-browser.cjs: 2/2 통과 (규칙만 / AI 모의 서버)

generic-browser는 표 없는 div 레이아웃, 열린 Shadow DOM, 토글 버튼, 숨긴 라디오, select2형 숨김 select, ARIA 없는 div 드롭다운, 페이지 내 검색 레이어(재검색·캠퍼스 동률), iframe 경력란, 인쇄된 '고등학교' 어미, AI 추론 선택지·약칭·미보유 항목을 확인합니다.
AI는 로컬 모의 서버로 응답을 흉내 냈으며 실제 모델 호출은 하지 않았습니다. 실제 채용 사이트 검증은 별도로 필요합니다.
