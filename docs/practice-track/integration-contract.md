# Practice·Track 팀 이식 계약

사용자 승인: 팀 저장소에 담당 Practice/Track/관련 백엔드만, 다른 팀원 작업과 겹치지 않게 별도 브랜치/PR로 올린다. 이전의 반복 승인 생략·사용자 데이터 보호 조건을 유지한다.

기준: 팀 feature/frontend ec7b279eda87b5dd49beadff453947aa32309e62, 원본 leejw0010/Jobseeker codex/practical-validation 34222d281a18a7e3bf60d0e33c51e5658b6a960e. 팀 main/chrome-extension은 README만 있는28b9b01이다. PR base는 feature/frontend이며 공용 브랜치 병합/직접 Push는 수행하지 않는다.

팀 frontend·단일 Router·로그인·프로필(archive)·Dashboard·Apply·공통 CSS와 Supabase singleton을 유지한다. 기존 Practice/Track placeholder와 최소 route 연결만 수정하고 기능 페이지·계산·API·스타일은 src/features/practice-track 아래에 둔다. 원본 App/main은 복사하지 않는다. 백엔드·SQL·Track 확장은 현재 없는 별도 디렉터리로 추가하며 Apply 자동입력을 만들지 않는다.

단일 host Supabase 세션에서 토큰을 받아 FastAPI로 전달한다. 로그아웃/사용자 변경은 요청·측정·편집 트리를 초기화하되 녹음 삭제와 연결하지 않는다. 실제 Supabase/Auth/Storage/운영 데이터는 읽거나 변경하지 않는다. 자동 검증은 로컬 Auth 대역·임시 DB/녹음만, 유료 API0회다. Gaze는 개발 전용 route와 flag로 유지한다.

팀 React19/Router8/Vite8/TS6 lock 버전을 유지한다. MediaPipe와 테스트 runner만 추가한다. 기준선은 tsconfig 누락으로 빌드 실패이므로 누락 설정만 추가한다. CSS는 기능 wrapper로 한정하고 팀 CSS 파일을 수정하지 않는다. API/업무 로직을 재구현하지 않고 검증된 소스에서 이식한다.

실제 서명 설정·profiles.archive DDL/RLS·Cloud Storage·실제 장치/Chrome/AI 품질은 자동 대역 결과와 구분한다. SQL은 검토용으로만 추가하며 운영 실행은 하지 않는다.
