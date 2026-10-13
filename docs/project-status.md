# 프로젝트 현황 (Project Status)

> 기준일: 2026-05-20  
> 기준 브랜치: `main` (HEAD: `353a04c`)  
> 이 브랜치: `claude/document-project-status-rvmUi` (main + 15 커밋 ahead)

---

## 완료된 작업

### 1. 로그인 / 인증 시스템
- Supabase Auth 의존성 제거 → **커스텀 JWT 세션** 기반 인증으로 전환
- `UserCredential` 모델 추가 (bcrypt 해시 비밀번호 저장)
- `LoginHistory` 모델 추가 (로그인 이력 추적)
- **강제 비밀번호 변경** 플로우 구현 (최초 로그인 시)
- 로그인 ID 대소문자 무관 처리 (case-insensitive)
- JWT 미들웨어 기반 세션 보호 (`src/middleware.ts`)

**제약사항:** 인증 관련 코드 수정 금지
- `src/lib/auth.ts`, `src/lib/jwt.ts`, `src/middleware.ts`
- `src/app/api/auth/**`, `src/app/(auth)/**`

---

### 2. InventoryBalance LOT 구조 개선
- `InventoryBalance` unique 키 재구성: 동일 품목이라도 **LOT 별로 재고를 분리** 관리
- Migration: `20260520000000_fix_inventory_balance_lot_unique`
- LOT 관리 품목은 `lotId` 포함, 비LOT 품목은 `lotId = null`로 구분

**제약사항:** `InventoryBalance` / LOT 로직 수정 금지

---

### 3. 자재출고 LOT 선택 UI
- 자재출고 폼(`issue-form-dialog.tsx`)에 LOT 선택 UI 추가
- LOT 관리 품목 출고 시 반드시 LOT을 선택해야 출고 가능 (서버 액션 검증 포함)
- `src/lib/actions/material-issue.actions.ts` 에 LOT 필수 검증 로직

---

### 4. TagCurrentValue 아키텍처
- `TagCurrentValue` 모델 추가: 설비 태그의 **실시간 최신값** 저장 (upsert 패턴)
- `TagSnapshot` (이력 저장)과 분리된 별도 모델로 조회 성능 최적화
- Migration: `20260520000001_add_tag_current_value`
- `src/lib/actions/tag-current-value.actions.ts` 에 upsert/조회 서버 액션

**제약사항:** `TagSnapshot` / `TagCurrentValue` 수정 금지

---

### 5. MES / LMS 메뉴 정합성 (사업계획서 기준)
- `src/lib/nav-config.ts` 전면 정비
- MES 메뉴: 기준정보관리 / 생산관리 / 재고관리 / 자재관리 / KPI / 품질관리 / 영업관리 / 사용자관리
- LMS 메뉴: 설비관리 / 모니터링 / 통계 / 검사
- `comingSoon` 플래그로 미구현 메뉴 표시

---

### 6. LMS 설비관리 + 모니터링 + 검사 (main 브랜치)
- LMS 설비관리 페이지 구현 (점검현황, 고장이력, 수리완료, 설비파라미터 등)
- LMS 모니터링: 생산현황 실시간 대시보드
- 초중종검사 페이지 구현
- FeatureDefinition 및 시드 업데이트로 LMS 메뉴 활성화

---

### 7. 생산현황 대시보드 KPI 연동 (main 브랜치)
- 대시보드에 실제 DB 데이터 기반 KPI 연동
- `comingSoon` 제거 → 실제 데이터 표시

---

## 현재 main 브랜치 상태

```
main HEAD: 353a04c  (fix(features): LMS/모니터링/검사 메뉴 활성화)
이 브랜치:  e289c86  (feat(menu): align MES and LMS menus with project proposal)
공통 조상: 353a04c  → 이 브랜치는 main의 모든 커밋을 포함 + 15개 추가 커밋
```

---

## 절대 수정 금지 영역

| 영역 | 이유 |
|------|------|
| `prisma/schema.prisma` — `UserCredential`, `LoginHistory` | 인증 DB 스키마 |
| `src/lib/auth.ts`, `src/lib/jwt.ts`, `src/middleware.ts` | 인증 핵심 로직 |
| `src/app/api/auth/**`, `src/app/(auth)/**` | 인증 API/페이지 |
| `InventoryBalance` unique 제약 / LOT 관련 로직 | 재고 무결성 |
| `TagSnapshot` / `TagCurrentValue` 모델 및 액션 | 설비 태그 아키텍처 |
| `prisma db pull` / `prisma db push` 실행 | DB 스키마 충돌 위험 |

---

## 다음 세션 시작 가이드

1. 브랜치 확인: `git log --oneline -5`
2. 기준 브랜치: `main` (또는 이 브랜치에서 작업 계속)
3. 작업 전 반드시 이 문서와 `CLAUDE.md` 확인
4. Prisma 변경 필요 시: `prisma migrate dev` 사용 (`db push` / `db pull` 금지)

---

## 기술 스택

| 항목 | 버전/선택 |
|------|-----------|
| Framework | Next.js 14 (App Router) |
| DB | PostgreSQL (Supabase 호스팅) |
| ORM | Prisma 5.x |
| Auth | 커스텀 JWT (jose 라이브러리) |
| UI | Tailwind CSS + shadcn/ui |
| 언어 | TypeScript 5.x |
