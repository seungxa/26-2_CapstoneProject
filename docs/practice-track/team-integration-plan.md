# 팀 Practice·Track 이식 Implementation Plan

> 실행: superpowers:executing-plans. 기존 승인·이식 문서의 범위를 유지하며 inline으로 실행하고 마지막에 독립 리뷰를 받는다. 반복 승인 없이 Commit/Push/PR까지, merge는 하지 않는다.

**Goal:** 팀 frontend를 유지한 독립 Practice/Track 기능과 API 서버를 PR로 제공한다.
**Architecture:** feature 폴더 + 단일 Router의 상대 하위 route + host Supabase session adapter + scoped CSS.
**Tech Stack:** 팀 lock React19.3.1/Router8.4.0/Vite8.3.4/TS6.0.3, 원본 FastAPI/SQLAlchemy.
**Spec:** integration-contract.md 및 원본 docs/integration/team-repository-handoff.md.

## Global Constraints
- ec7b279 팀 frontend 기준, feature/frontend 대상 PR. main/공용 feature 직접 변경 없음.
- Profile/Login/Signup/Dashboard/Apply/ProtectedRoute/Supabase singleton/공통 CSS 원문 보존.
- 원본 미커밋/DB/recordings/.env 접근 없음. Git 추적 파일만 복사.
- Framework 버전 유지, 새 Auth 우회/토큰 저장소 없음. 운영 DB 실행/유료 API0.

## Review Focus
- 늦은 getSession과 사용자 변경 이벤트가 역전되어 이전 사용자 UI가 살아나지 않아야 한다. Task2에서 시험.
- 사용자 변경/로그아웃 때 요청·측정·편집 트리가 정리되고 토큰 refresh만으로는 지워지지 않아야 한다. Task2/4.
- feature CSS가 팀 Profile/Header에 적용되지 않아야 한다. Task3/4.
- deep link/하위 route가 팀 nav와 보호 route를 유지해야 한다. Task3/4.
- 기존 버전·제출본·면접 고정 자료와 테스트 임시 녹음 격리는 그대로여야 한다. Task1/4.

### Task1: 검증 소스 이식과 구성
- [ ] Git 추적 backend/supabase/extension-track와 필요한 scripts/docs를 복사한다. API·모델·SQL 변경 없음.
- [ ] frontend/src/features/practice-track에 App/main 제외 source를 이식하고 Router import만 팀 패키지로 연결한다.
- [ ] 기존 테스트의 경로를 새 feature 위치로 옮긴다. Backend enum은 실제 새 types.ts를 대조한다.
- [ ] 누락 TS 설정 추가, 기존 lock 버전 유지+MediaPipe/Playwright 추가, backend/unit/build 검증.

### Task2: host 세션 연결
- [ ] 늦은 initial session/변경/로그아웃/refresh/해제 후 응답을 unit RED로 재현한다.
- [ ] 순수 session bridge와 팀 Supabase adapter, user revision key를 구현한다.
- [ ] GREEN, 실제 bearer 전달·본인/타인 격리는 로컬 HS256 Auth-on E2E에서 확인한다.

### Task3: route·스타일 통합
- [ ] Practice/Track wrappers와 최소 App wildcard/nav prefix를 연결한다. 단일 Router 유지.
- [ ] CSS wrapper scope·상대 feature routes·내부 nav·개발 Gaze route를 구현한다.
- [ ] 팀 header/profile와 feature mobile/deep link, 미인증 redirect를 E2E 검증한다.

### Task4: 회귀·독립 리뷰·전달
- [ ] Backend 전체·frontend build/unit·기존 전체 desktop/mobile·팀 Auth-on·PG 통합을 검증한다.
- [ ] 검증용 Auth는 local fixture임을 문서화하고 실제 cloud/장치 미검증과 구분한다.
- [ ] 보호 파일 해시·framework lock·Git 변경 범위·최신 remote 기준을 재확인한다.
- [ ] 독립 전체 리뷰, 확인된 결함만 최소 TDD 수정 후 결과 문서를 작성한다.
- [ ] 담당 변경만 명시적으로 Commit/Push하고 팀 feature/frontend 대상 PR 하나 생성한다.
