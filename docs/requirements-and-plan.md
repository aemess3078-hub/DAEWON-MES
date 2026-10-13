# 요구사항 분석 및 구현 계획: 커스터마이징 가능한 MES

> 작성일: 2026-03-25
> 버전: 1.0

---

## 1. 프로젝트 개요

### 1.1 핵심 문제 정의

기존 MES 시스템은 메뉴 추가, 공정 플로우 변경, 데이터 연결 구조 수정 등의 커스터마이징에
개발자 투입이 필수적이다. 이로 인해:

- 현장 변경 요청에 대한 반영 리드타임이 길다 (수일~수주)
- 개발 비용이 누적된다
- 현장 담당자가 원하는 것과 개발 결과물 사이에 갭이 발생한다

**목표:** 비개발자(현장 관리자, 생산 담당자)가 엑셀을 다루는 수준의 난이도로
메뉴 생성, 기준정보 연결, 공정 플로우 설계를 직접 수행할 수 있는 MES 시스템 구축.

### 1.2 핵심 가치 제안

| 가치 | 설명 |
|------|------|
| 자율 커스터마이징 | 드래그앤드롭으로 메뉴/플로우 구성, 코딩 불필요 |
| 기준정보 중심 설계 | 모든 기능 메뉴가 기준정보(Master Data)에 연결되는 일관된 구조 |
| 시뮬레이션 검증 | 변경사항을 실제 적용 전에 시뮬레이션으로 검증 |
| 점진적 확장 | 필요한 메뉴만 추가하며 시스템을 성장시킬 수 있음 |

---

## 2. 기능 요구사항

### 2.1 기준정보 관리 모듈 (Master Data Module)

#### 2.1.1 거래처 등록
- **사용자 스토리:** 관리자로서, 원자재 공급업체와 완제품 납품처를 등록하기 위해, 거래처 정보를 CRUD할 수 있다.
- **필수 필드:** 거래처코드(자동채번), 거래처명, 사업자번호, 대표자, 업태/종목, 주소, 연락처, 거래처유형(공급처/납품처/양쪽), 담당자, 사용여부
- **수용 기준:**
  - 사업자번호 중복 등록 방지
  - 거래처유형별 필터 조회
  - Excel 일괄 업로드/다운로드 지원
  - 삭제 시 연결된 거래 이력이 있으면 비활성화 처리 (논리 삭제)

#### 2.1.2 품목 등록
- **사용자 스토리:** 관리자로서, 생산에 필요한 원자재/반제품/완제품을 관리하기 위해, 품목 정보를 CRUD할 수 있다.
- **필수 필드:** 품목코드(자동채번), 품목명, 품목유형(원자재/반제품/완제품/부자재), 단위, 규격, 품목군, 안전재고, LOT관리여부, 사용여부
- **수용 기준:**
  - 품목유형별 분류 및 검색
  - 품목코드 자동채번 규칙 설정 가능 (예: RM-0001, FG-0001)
  - BOM, 재고, 생산 등 타 모듈에서 참조 시 연결 무결성 보장
  - Excel 일괄 업로드/다운로드 지원

#### 2.1.3 BOM (Bill of Materials) 관리
- **사용자 스토리:** 생산관리자로서, 완제품/반제품의 구성 원자재와 수량을 정의하기 위해, 다단계 BOM을 관리할 수 있다.
- **필수 필드:** 모품목, 자품목, 소요량, 단위, LOSS율, 유효기간(시작/종료), BOM레벨, 사용여부
- **수용 기준:**
  - 다단계 BOM 트리 구조 시각화 (최소 5단계)
  - 역전개(Where-Used) 조회 기능
  - BOM 복사 기능 (유사 제품 등록 시)
  - 순환참조 자동 감지 및 차단
  - BOM 변경 이력 관리 (유효기간 기반 버전 관리)

#### 2.1.4 공정관리
- **사용자 스토리:** 생산관리자로서, 생산에 필요한 단위 공정을 정의하기 위해, 공정 정보를 관리할 수 있다.
- **필수 필드:** 공정코드, 공정명, 공정유형(가공/조립/검사/포장 등), 표준작업시간, 작업장, 설비연결, 사용여부
- **수용 기준:**
  - 공정별 설비 매핑
  - 공정별 작업 표준서 첨부 기능
  - 공정별 검사항목 연결 가능

#### 2.1.5 공정 라우팅
- **사용자 스토리:** 생산관리자로서, 품목별 생산 공정 순서를 정의하기 위해, 공정 라우팅을 설정할 수 있다.
- **필수 필드:** 라우팅코드, 품목, 공정순서(시퀀스), 공정코드, 표준작업시간, 이동시간, 대기시간, 사용여부
- **수용 기준:**
  - 드래그앤드롭으로 공정 순서 변경
  - 분기/합류 공정 (병렬 공정) 지원
  - 라우팅 시각화 (플로우차트 형태)
  - 라우팅별 리드타임 자동 계산

#### 2.1.6 설비관리
- **사용자 스토리:** 설비관리자로서, 생산 설비의 현황과 상태를 관리하기 위해, 설비 정보를 CRUD할 수 있다.
- **필수 필드:** 설비코드, 설비명, 설비유형, 제조사, 설치일, 작업장, 상태(가동/정지/점검/고장), 사용여부
- **수용 기준:**
  - 설비별 가동/비가동 이력 조회
  - 설비-공정 매핑 관리
  - 설비 점검 이력 관리 (향후 확장 대비 구조)

#### 2.1.7 사용자 관리
- **사용자 스토리:** 시스템 관리자로서, 시스템 접근 권한을 제어하기 위해, 사용자 및 역할을 관리할 수 있다.
- **필수 필드:** 사용자ID, 사용자명, 비밀번호(해싱), 부서, 역할(Role), 메뉴 접근권한, 사용여부
- **수용 기준:**
  - 역할 기반 접근제어(RBAC)
  - 메뉴별 읽기/쓰기/삭제 권한 세분화
  - 비밀번호 정책 (최소 8자, 영문+숫자+특수문자)
  - 로그인 이력 관리

#### 2.1.8 공통코드 관리
- **사용자 스토리:** 시스템 관리자로서, 드롭다운/선택목록의 코드값을 관리하기 위해, 공통코드를 CRUD할 수 있다.
- **필수 필드:** 그룹코드, 그룹명, 상세코드, 상세코드명, 정렬순서, 사용여부
- **수용 기준:**
  - 그룹-상세 2단계 코드 체계
  - 사용 중인 코드 삭제 시 경고
  - 다국어 지원 구조 (향후 확장 대비)

### 2.2 커스터마이징 엔진 모듈 (No-Code Builder)

#### 2.2.1 메뉴 빌더 (Menu Builder)
- **사용자 스토리:** 관리자로서, 새로운 업무 메뉴를 코딩 없이 만들기 위해, 드래그앤드롭으로 메뉴를 구성할 수 있다.
- **기능 상세:**
  - 메뉴 트리 관리 (대분류/중분류/소분류)
  - 드래그앤드롭으로 메뉴 위치 변경
  - 메뉴 추가 시 연결할 기준정보 선택 (멀티 선택 가능)
  - 메뉴 아이콘 및 색상 설정
  - 메뉴별 접근 권한(역할) 설정
- **수용 기준:**
  - 메뉴 생성 후 30초 이내에 사이드바에 반영
  - 메뉴 순서 변경 시 드래그앤드롭으로 즉시 반영
  - 최소 3단계 메뉴 깊이 지원

#### 2.2.2 화면 빌더 (Screen Builder)
- **사용자 스토리:** 관리자로서, 메뉴에 연결될 화면을 직접 디자인하기 위해, 위젯을 드래그앤드롭으로 배치할 수 있다.
- **기능 상세:**
  - 위젯 팔레트: 테이블, 입력폼, 차트, 버튼, 텍스트, 이미지, 탭, 검색조건
  - 위젯별 속성 패널 (크기, 색상, 데이터 바인딩, 유효성 검사 규칙)
  - 기준정보 필드를 위젯에 바인딩 (드래그앤드롭)
  - 레이아웃 그리드 시스템 (12컬럼 기반)
  - 반응형 레이아웃 프리뷰 (PC/태블릿)
- **수용 기준:**
  - 위젯 배치에서 화면 완성까지 5분 이내 가능 (기본 CRUD 화면 기준)
  - 프리뷰 모드에서 실제 데이터로 확인 가능
  - 화면 템플릿 저장/불러오기 지원 (자주 쓰는 레이아웃 재사용)
  - 되돌리기(Undo)/다시하기(Redo) 지원 (최소 20단계)

#### 2.2.3 데이터 바인딩 엔진 (Data Binding Engine)
- **사용자 스토리:** 관리자로서, 화면의 위젯과 기준정보를 연결하기 위해, 시각적으로 데이터 소스를 매핑할 수 있다.
- **기능 상세:**
  - 기준정보 테이블/필드 목록 트리 표시
  - 위젯 - 데이터 필드 간 드래그앤드롭 연결
  - 연결 시 자동 CRUD API 생성
  - 필터/정렬 조건 시각적 설정
  - 데이터 간 JOIN 관계 시각적 설정 (기준정보 간 연결)
- **수용 기준:**
  - 연결 설정 후 즉시 데이터 조회 가능
  - 잘못된 데이터 타입 매핑 시 경고 표시
  - 연결 구조를 다이어그램으로 시각화

#### 2.2.4 플로우 디자이너 (Flow Designer)
- **사용자 스토리:** 생산관리자로서, 업무 프로세스의 데이터 흐름을 설계하기 위해, 메뉴 간 데이터 흐름을 시각적으로 구성할 수 있다.
- **기능 상세:**
  - 캔버스 위에 메뉴 노드 배치 (드래그앤드롭)
  - 노드 간 화살표로 데이터 흐름 연결
  - 조건부 분기 노드 지원 (예: 검사 합격/불합격 분기)
  - 각 연결에 데이터 매핑 규칙 설정
  - 플로우 버전 관리 (변경 이력)
- **수용 기준:**
  - 최소 50개 노드를 배치해도 성능 저하 없음
  - 플로우 내 순환참조 자동 감지
  - 플로우를 이미지(PNG/SVG)로 내보내기

### 2.3 시뮬레이션 엔진 모듈

#### 2.3.1 플로우 시뮬레이션
- **사용자 스토리:** 관리자로서, 설계한 플로우가 올바르게 작동하는지 검증하기 위해, 시뮬레이션을 실행할 수 있다.
- **기능 상세:**
  - 시뮬레이션 모드 진입 (샌드박스 환경)
  - 테스트 데이터 자동 생성 또는 수동 입력
  - 단계별 실행 (Step-by-step) 모드
  - 데이터 흐름 애니메이션 시각화
  - 각 노드에서의 데이터 상태 확인 (디버깅)
  - 시뮬레이션 결과 리포트 생성
- **수용 기준:**
  - 시뮬레이션 실행 시 실제 운영 데이터에 영향 없음 (완전 격리)
  - 오류 발생 노드 하이라이트 표시
  - 시뮬레이션 통과 후 "적용" 버튼으로 실제 반영
  - 시뮬레이션 이력 최소 30일 보관

#### 2.3.2 공정 시뮬레이션
- **사용자 스토리:** 생산관리자로서, 공정 라우팅 변경의 영향을 사전에 파악하기 위해, 공정 흐름을 시뮬레이션할 수 있다.
- **기능 상세:**
  - 공정 라우팅 기반 시뮬레이션
  - 설비 가용성/용량 반영
  - 예상 리드타임 계산
  - 병목 공정 시각적 표시
  - What-If 분석 (공정 순서 변경, 설비 추가 시 영향)
- **수용 기준:**
  - 시뮬레이션 결과에 예상 총 소요시간 표시
  - 병목 공정 TOP 3 하이라이트
  - 시뮬레이션 결과 비교 기능 (변경 전 vs 변경 후)

---

## 3. 비기능 요구사항

### 3.1 성능
| 항목 | 기준 |
|------|------|
| 페이지 로딩 시간 | 2초 이내 (기준정보 1만건 기준) |
| 데이터 조회 응답시간 | 1초 이내 (1만건 기준) |
| 동시 사용자 | 최소 50명 동시 접속 |
| 화면 빌더 렌더링 | 위젯 100개 배치 시 60fps 유지 |
| 시뮬레이션 실행 | 50노드 플로우 기준 5초 이내 완료 |

### 3.2 보안
- HTTPS 필수
- JWT 기반 인증 (Access Token 30분, Refresh Token 7일)
- 역할 기반 접근제어 (RBAC) - 메뉴/화면/API 단위
- SQL Injection, XSS 방지
- 감사 로그 (누가, 언제, 무엇을 변경했는지)
- 비밀번호 bcrypt 해싱

### 3.3 유지보수성
- 모듈별 독립 배포 가능한 구조
- API 문서 자동 생성 (Swagger/OpenAPI)
- 코드 커버리지 70% 이상 목표
- 데이터베이스 마이그레이션 도구 사용

### 3.4 사용성
- 드래그앤드롭 인터랙션 지연 100ms 이내
- 모든 CRUD 화면에서 Excel 업로드/다운로드 지원
- 에러 메시지 한국어 표시
- 도움말 툴팁 제공

---

## 4. 기술 스택 추천

### 4.1 프론트엔드

| 기술 | 선정 사유 |
|------|-----------|
| **React 18+** | 컴포넌트 기반 설계로 위젯 시스템 구현에 적합, 풍부한 드래그앤드롭 라이브러리 생태계 |
| **TypeScript** | 타입 안전성으로 대규모 시스템의 안정성 확보 |
| **Ant Design 5** | 제조업 관리 시스템에 적합한 엔터프라이즈 UI 컴포넌트 (테이블, 폼, 트리 등) |
| **React Flow** | 플로우 디자이너/공정 라우팅 시각화에 최적화된 라이브러리 |
| **dnd-kit** | 메뉴 빌더/화면 빌더의 드래그앤드롭에 성능과 접근성이 우수 |
| **Zustand** | 빌더 상태 관리 (Undo/Redo 히스토리 관리 용이) |
| **React Query (TanStack Query)** | 서버 상태 관리 및 캐싱 |
| **Vite** | 빠른 빌드 및 개발 서버 |

### 4.2 백엔드

| 기술 | 선정 사유 |
|------|-----------|
| **Node.js + NestJS** | TypeScript 기반으로 프론트엔드와 타입 공유, 모듈식 아키텍처, 데코레이터 기반 API 정의 |
| **TypeORM** | TypeScript 친화적 ORM, 마이그레이션 지원, 동적 엔티티 생성 가능 |
| **Redis** | 세션 관리, 캐싱, 실시간 이벤트 |
| **Bull (BullMQ)** | 시뮬레이션 작업 큐, 비동기 작업 처리 |
| **Swagger (OpenAPI)** | API 문서 자동 생성 |

### 4.3 데이터베이스

| 기술 | 선정 사유 |
|------|-----------|
| **PostgreSQL 16** | JSON 지원 (동적 필드 저장), 고급 쿼리, 성숙한 생태계 |
| **JSONB 컬럼** | 커스텀 화면 정의, 위젯 설정 등 스키마리스 데이터 저장 |

### 4.4 인프라 및 도구

| 기술 | 용도 |
|------|------|
| **Docker + Docker Compose** | 로컬 개발 및 배포 환경 통일 |
| **Nginx** | 리버스 프록시, 정적 파일 서빙 |
| **GitHub Actions** | CI/CD 파이프라인 |
| **Jest** | 단위/통합 테스트 |
| **Playwright** | E2E 테스트 (드래그앤드롭 시나리오) |

---

## 5. 시스템 아키텍처

### 5.1 전체 구조 (레이어드 모놀리스 + 모듈식)

```
[Browser]
    |
    v
[Nginx - Reverse Proxy / Static Files]
    |
    +--> [React SPA - 프론트엔드]
    |       |-- 기준정보 화면 (기본 제공)
    |       |-- 커스터마이징 빌더 (메뉴/화면/플로우)
    |       |-- 시뮬레이션 뷰어
    |       |-- 동적 렌더링 엔진 (사용자 정의 화면 렌더링)
    |
    +--> [NestJS API Server - 백엔드]
            |
            +-- Core Module (인증, 권한, 공통)
            +-- MasterData Module (기준정보 CRUD)
            +-- Builder Module (메뉴/화면/플로우 정의 저장)
            +-- DynamicAPI Module (동적 CRUD API 생성)
            +-- Simulation Module (시뮬레이션 엔진)
            |
            +--> [PostgreSQL] - 운영 데이터
            +--> [PostgreSQL] - 시뮬레이션 데이터 (스키마 분리)
            +--> [Redis] - 세션, 캐시, 작업 큐
```

### 5.2 핵심 아키텍처 패턴

**메타데이터 기반 동적 시스템:**
- 사용자가 빌더에서 만든 메뉴/화면/플로우 정의는 JSON 메타데이터로 저장
- 프론트엔드의 "동적 렌더링 엔진"이 이 메타데이터를 해석하여 실제 화면을 렌더링
- 백엔드의 "동적 API 모듈"이 메타데이터를 기반으로 CRUD API를 자동 생성

```
[사용자가 빌더에서 화면 설계]
    |
    v
[메타데이터 JSON 저장] --> DB에 저장
    |
    v
[동적 렌더링 엔진] --> JSON을 해석하여 실제 화면 렌더링
[동적 API 모듈] --> JSON을 해석하여 CRUD API 자동 제공
```

### 5.3 모듈 간 의존성

```
Core Module (인증, 권한, 공통코드)
    ^
    |
MasterData Module (기준정보 CRUD)
    ^
    |
Builder Module (메뉴/화면/플로우 정의)
    ^
    |
DynamicAPI Module (동적 API 생성)
    ^
    |
Simulation Module (시뮬레이션 엔진)
```

---

## 6. 데이터 모델 설계

### 6.1 기준정보 테이블

```sql
-- 거래처
CREATE TABLE partners (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_code    VARCHAR(20) UNIQUE NOT NULL,
    partner_name    VARCHAR(100) NOT NULL,
    biz_no          VARCHAR(12),          -- 사업자번호
    ceo_name        VARCHAR(50),
    biz_type        VARCHAR(50),          -- 업태
    biz_item        VARCHAR(50),          -- 종목
    address         TEXT,
    phone           VARCHAR(20),
    partner_type    VARCHAR(10) NOT NULL,  -- SUPPLIER / CUSTOMER / BOTH
    manager_name    VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id)
);

-- 품목
CREATE TABLE items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code       VARCHAR(30) UNIQUE NOT NULL,
    item_name       VARCHAR(100) NOT NULL,
    item_type       VARCHAR(20) NOT NULL,  -- RAW / SEMI / FINISHED / SUB
    unit            VARCHAR(10) NOT NULL,
    spec            VARCHAR(200),
    item_group      VARCHAR(50),
    safety_stock    DECIMAL(15,3) DEFAULT 0,
    lot_managed     BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    extra_fields    JSONB DEFAULT '{}',    -- 커스텀 필드 확장용
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id)
);

-- BOM
CREATE TABLE bom (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_item_id  UUID NOT NULL REFERENCES items(id),
    child_item_id   UUID NOT NULL REFERENCES items(id),
    quantity        DECIMAL(15,5) NOT NULL,
    unit            VARCHAR(10) NOT NULL,
    loss_rate       DECIMAL(5,2) DEFAULT 0,
    bom_level       INTEGER NOT NULL,
    valid_from      DATE NOT NULL,
    valid_to        DATE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT bom_no_self_ref CHECK (parent_item_id != child_item_id)
);

-- 공정
CREATE TABLE processes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_code    VARCHAR(20) UNIQUE NOT NULL,
    process_name    VARCHAR(100) NOT NULL,
    process_type    VARCHAR(20) NOT NULL,  -- 공통코드 참조
    std_work_time   DECIMAL(10,2),         -- 분 단위
    work_center     VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 공정 라우팅
CREATE TABLE routings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    routing_code    VARCHAR(20) UNIQUE NOT NULL,
    item_id         UUID NOT NULL REFERENCES items(id),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE routing_steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    routing_id      UUID NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    process_id      UUID NOT NULL REFERENCES processes(id),
    equipment_id    UUID REFERENCES equipment(id),
    std_work_time   DECIMAL(10,2),
    move_time       DECIMAL(10,2) DEFAULT 0,
    wait_time       DECIMAL(10,2) DEFAULT 0,
    is_parallel     BOOLEAN DEFAULT FALSE,  -- 병렬 공정 여부
    parallel_group  VARCHAR(20),            -- 병렬 그룹 식별자
    UNIQUE (routing_id, sequence)
);

-- 설비
CREATE TABLE equipment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equip_code      VARCHAR(20) UNIQUE NOT NULL,
    equip_name      VARCHAR(100) NOT NULL,
    equip_type      VARCHAR(20) NOT NULL,
    manufacturer    VARCHAR(100),
    install_date    DATE,
    work_center     VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'IDLE',  -- RUNNING / IDLE / MAINT / BROKEN
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 사용자
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(50) UNIQUE NOT NULL,
    user_name       VARCHAR(50) NOT NULL,
    password_hash   VARCHAR(200) NOT NULL,
    department      VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code       VARCHAR(20) UNIQUE NOT NULL,
    role_name       VARCHAR(50) NOT NULL,
    description     TEXT
);

CREATE TABLE user_roles (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- 공통코드
CREATE TABLE common_code_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code      VARCHAR(20) UNIQUE NOT NULL,
    group_name      VARCHAR(50) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE common_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES common_code_groups(id),
    detail_code     VARCHAR(20) NOT NULL,
    detail_name     VARCHAR(50) NOT NULL,
    sort_order      INTEGER DEFAULT 0,
    extra_value1    VARCHAR(100),
    extra_value2    VARCHAR(100),
    is_active       BOOLEAN DEFAULT TRUE,
    UNIQUE (group_id, detail_code)
);
```

### 6.2 커스터마이징 엔진 테이블

```sql
-- 메뉴 정의
CREATE TABLE menu_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_code       VARCHAR(30) UNIQUE NOT NULL,
    menu_name       VARCHAR(100) NOT NULL,
    parent_id       UUID REFERENCES menu_definitions(id),
    menu_level      INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER DEFAULT 0,
    icon            VARCHAR(50),
    color           VARCHAR(7),            -- HEX color
    menu_type       VARCHAR(20) NOT NULL,  -- BUILT_IN / CUSTOM
    screen_def_id   UUID REFERENCES screen_definitions(id),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 메뉴별 역할 접근권한
CREATE TABLE menu_permissions (
    menu_id         UUID REFERENCES menu_definitions(id) ON DELETE CASCADE,
    role_id         UUID REFERENCES roles(id) ON DELETE CASCADE,
    can_read        BOOLEAN DEFAULT TRUE,
    can_write       BOOLEAN DEFAULT FALSE,
    can_delete      BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (menu_id, role_id)
);

-- 화면 정의 (빌더로 생성된 화면)
CREATE TABLE screen_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_code     VARCHAR(30) UNIQUE NOT NULL,
    screen_name     VARCHAR(100) NOT NULL,
    layout          JSONB NOT NULL,        -- 화면 레이아웃 정의
    -- layout 예시:
    -- {
    --   "columns": 12,
    --   "widgets": [
    --     {
    --       "id": "w1",
    --       "type": "data-table",
    --       "position": {"x": 0, "y": 0, "w": 12, "h": 6},
    --       "props": {
    --         "dataSource": "items",
    --         "columns": ["item_code", "item_name", "item_type"],
    --         "filters": [...],
    --         "sortable": true,
    --         "pagination": true
    --       }
    --     },
    --     {
    --       "id": "w2",
    --       "type": "input-form",
    --       "position": {"x": 0, "y": 6, "w": 6, "h": 4},
    --       "props": {
    --         "dataSource": "items",
    --         "fields": [...]
    --       }
    --     }
    --   ]
    -- }
    version         INTEGER DEFAULT 1,
    is_template     BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 데이터 바인딩 정의 (메뉴와 기준정보 간 연결)
CREATE TABLE data_bindings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_def_id   UUID NOT NULL REFERENCES screen_definitions(id),
    binding_name    VARCHAR(50) NOT NULL,
    source_table    VARCHAR(100) NOT NULL,    -- 연결된 기준정보 테이블
    source_fields   JSONB NOT NULL,           -- 사용할 필드 목록
    join_config     JSONB,                    -- 다른 테이블 조인 설정
    filter_config   JSONB,                    -- 기본 필터 조건
    sort_config     JSONB,                    -- 기본 정렬 조건
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 플로우 정의
CREATE TABLE flow_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_code       VARCHAR(30) UNIQUE NOT NULL,
    flow_name       VARCHAR(100) NOT NULL,
    flow_type       VARCHAR(20) NOT NULL,     -- MENU_FLOW / PROCESS_FLOW
    definition      JSONB NOT NULL,
    -- definition 예시:
    -- {
    --   "nodes": [
    --     {"id": "n1", "type": "menu", "menuId": "...", "position": {"x": 100, "y": 100}},
    --     {"id": "n2", "type": "menu", "menuId": "...", "position": {"x": 300, "y": 100}},
    --     {"id": "n3", "type": "condition", "condition": "qty > 0", "position": {"x": 200, "y": 200}}
    --   ],
    --   "edges": [
    --     {"id": "e1", "source": "n1", "target": "n3", "dataMapping": {...}},
    --     {"id": "e2", "source": "n3", "target": "n2", "label": "true"}
    --   ]
    -- }
    version         INTEGER DEFAULT 1,
    status          VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT / SIMULATED / ACTIVE
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 시뮬레이션 이력
CREATE TABLE simulation_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_def_id     UUID NOT NULL REFERENCES flow_definitions(id),
    flow_version    INTEGER NOT NULL,
    status          VARCHAR(20) NOT NULL,     -- RUNNING / SUCCESS / FAILED
    input_data      JSONB,
    result_data     JSONB,
    error_log       JSONB,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    executed_by     UUID REFERENCES users(id)
);

-- 감사 로그
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name      VARCHAR(100) NOT NULL,
    record_id       UUID NOT NULL,
    action          VARCHAR(10) NOT NULL,     -- INSERT / UPDATE / DELETE
    old_data        JSONB,
    new_data        JSONB,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.3 데이터 모델 관계도 (핵심)

```
[users] --< [user_roles] >-- [roles]
                                |
                    [menu_permissions]
                                |
[menu_definitions] ---- [screen_definitions]
        |                       |
        |               [data_bindings] --> 기준정보 테이블 참조
        |
[flow_definitions] ---- [simulation_runs]

[items] --< [bom] (parent/child)
   |
[routings] --< [routing_steps] >-- [processes]
                                       |
                               [equipment]

[partners]    [common_code_groups] --< [common_codes]
```

---

## 7. 시뮬레이션 엔진 설계

### 7.1 설계 원칙

1. **샌드박스 격리:** 시뮬레이션은 별도 DB 스키마(simulation_sandbox)에서 실행. 운영 데이터를 복제하여 사용.
2. **이벤트 기반 실행:** 플로우의 각 노드를 이벤트로 모델링. 노드 실행 -> 결과 이벤트 발생 -> 다음 노드 트리거.
3. **단계별 실행 지원:** 전체 실행과 단계별(step-by-step) 실행 모두 지원.

### 7.2 아키텍처

```
[플로우 정의 JSON]
    |
    v
[Flow Parser] -- 노드/엣지 그래프 구성, 유효성 검증
    |
    v
[Execution Planner] -- 실행 순서 결정 (위상정렬, 병렬 그룹 식별)
    |
    v
[Sandbox Manager] -- DB 스키마 복제, 테스트 데이터 준비
    |
    v
[Step Executor] -- 각 노드 실행
    |   |-- DataNode: CRUD 실행 (샌드박스 DB 대상)
    |   |-- ConditionNode: 조건 평가, 분기 결정
    |   |-- TransformNode: 데이터 변환/매핑
    |
    v
[Result Collector] -- 각 단계 결과 수집, 에러 감지
    |
    v
[Report Generator] -- 시뮬레이션 결과 리포트
```

### 7.3 공정 시뮬레이션 특화 기능

```
[라우팅 + BOM 데이터]
    |
    v
[공정 그래프 생성] -- 순차/병렬 공정 그래프
    |
    v
[자원 할당 시뮬레이터]
    |-- 설비 가용성 확인
    |-- 작업 스케줄링 (FIFO 기본)
    |-- 대기시간/이동시간 반영
    |
    v
[결과 분석]
    |-- 총 리드타임 계산
    |-- 각 공정별 소요시간 Gantt 차트
    |-- 병목 공정 식별 (가동률 80% 이상 공정)
    |-- 설비 이용률 차트
```

### 7.4 시뮬레이션 데이터 격리 전략

| 단계 | 행위 |
|------|------|
| 시뮬레이션 시작 | `simulation_sandbox` 스키마 생성, 운영 테이블 구조 복제, 샘플 데이터 복사 |
| 시뮬레이션 실행 | 모든 CRUD가 sandbox 스키마 대상으로 실행 |
| 시뮬레이션 종료 | 결과 저장 후 sandbox 스키마 삭제 (or 보관 기간 후 삭제) |
| 적용 | 플로우 정의의 status를 ACTIVE로 변경, 메뉴/화면에 반영 |

---

## 8. 구현 계획 (단계별)

### Phase 0: 프로젝트 기반 구축 (2주)

**목표:** 개발 환경 설정 및 프로젝트 스캐폴딩

| 작업 | 상세 | 기간 |
|------|------|------|
| 프로젝트 초기화 | NestJS 프로젝트 생성, React+Vite 프로젝트 생성 | 1일 |
| Docker 환경 구성 | PostgreSQL, Redis, Nginx Docker Compose | 1일 |
| DB 스키마 생성 | TypeORM 엔티티 정의, 마이그레이션 초기 실행 | 2일 |
| 인증/인가 기본 구현 | JWT 로그인, RBAC 미들웨어 | 2일 |
| 프론트엔드 기본 구조 | 라우팅, 레이아웃, Ant Design 테마 설정 | 2일 |
| CI/CD 파이프라인 | GitHub Actions (lint, test, build) | 1일 |
| 코딩 규칙 및 문서화 | ESLint, Prettier, 커밋 컨벤션, API 규격 정의 | 1일 |

**산출물:** 로그인/로그아웃이 되는 빈 껍데기 애플리케이션, Docker로 원클릭 실행 가능

**완료 기준:** `docker-compose up` 으로 전체 시스템이 기동되고 로그인 화면이 표시됨

---

### Phase 1: 기준정보 CRUD (3주)

**목표:** 8개 기준정보 메뉴의 완전한 CRUD 기능 구현

| 작업 | 상세 | 기간 |
|------|------|------|
| 공통코드 관리 | 그룹/상세 코드 CRUD, 다른 모듈에서 참조할 수 있도록 우선 구현 | 2일 |
| 사용자 관리 | CRUD + 역할 매핑 + 비밀번호 정책 | 2일 |
| 거래처 등록 | CRUD + 사업자번호 중복체크 + Excel 업로드/다운로드 | 2일 |
| 품목 등록 | CRUD + 자동채번 + Excel 업로드/다운로드 | 2일 |
| BOM 관리 | 다단계 트리 CRUD + 순환참조 감지 + 역전개 | 3일 |
| 공정관리 | CRUD + 설비 매핑 | 2일 |
| 설비관리 | CRUD + 상태 관리 | 2일 |
| 공정 라우팅 | 라우팅 CRUD + 순서 드래그앤드롭 + 시각화 | 3일 |
| 공통 기능 | 검색/필터/페이지네이션/정렬 공통 컴포넌트 | 2일 |

**산출물:** 8개 기준정보 메뉴가 모두 동작하는 시스템

**완료 기준:** 모든 기준정보에 대해 등록/조회/수정/삭제가 가능하고, BOM 트리가 시각화됨

---

### Phase 2: 커스터마이징 엔진 - 메뉴 빌더 (2주)

**목표:** 드래그앤드롭으로 메뉴를 생성/편집/삭제할 수 있는 메뉴 빌더

| 작업 | 상세 | 기간 |
|------|------|------|
| 메뉴 트리 컴포넌트 | 3단계 트리 + 드래그앤드롭 순서/위치 변경 | 3일 |
| 메뉴 생성 다이얼로그 | 이름, 아이콘, 색상, 상위메뉴 선택 | 1일 |
| 기준정보 연결 설정 | 메뉴 생성 시 연결할 기준정보 폴더/테이블 선택 UI | 2일 |
| 메뉴 권한 설정 | 역할별 읽기/쓰기/삭제 권한 체크박스 | 1일 |
| 동적 사이드바 | 메뉴 정의 테이블 기반으로 사이드바 동적 렌더링 | 2일 |
| 메뉴 빌더 API | 메뉴 CRUD + 순서 변경 + 권한 설정 API | 1일 |

**산출물:** 메뉴 빌더 화면에서 새 메뉴를 만들면 사이드바에 즉시 반영

**완료 기준:** 비개발자가 3분 이내에 새 메뉴를 생성하고 사이드바에서 확인할 수 있음

---

### Phase 3: 커스터마이징 엔진 - 화면 빌더 (4주)

**목표:** 드래그앤드롭으로 CRUD 화면을 디자인할 수 있는 화면 빌더

| 작업 | 상세 | 기간 |
|------|------|------|
| 위젯 팔레트 구현 | 테이블, 폼, 차트, 버튼, 텍스트, 검색조건 위젯 | 4일 |
| 캔버스 + 그리드 시스템 | 12컬럼 그리드, 위젯 배치, 리사이즈, 스냅 | 4일 |
| 위젯 속성 패널 | 위젯 선택 시 우측에 속성 편집 패널 | 3일 |
| 데이터 바인딩 UI | 기준정보 필드를 위젯에 드래그앤드롭 연결 | 4일 |
| 동적 렌더링 엔진 | 저장된 화면 정의 JSON을 실제 화면으로 렌더링 | 4일 |
| 동적 CRUD API | 데이터 바인딩 설정 기반 자동 CRUD API 생성 | 3일 |
| Undo/Redo | 편집 이력 관리 (Zustand 미들웨어) | 1일 |
| 프리뷰 모드 | 실제 데이터로 화면 프리뷰 | 1일 |

**산출물:** 화면 빌더에서 위젯을 배치하고 데이터를 연결하면 실제 동작하는 화면이 생성됨

**완료 기준:** 기본 CRUD 화면(테이블+폼)을 5분 이내에 만들 수 있고, 데이터 조회/등록이 가능함

---

### Phase 4: 플로우 디자이너 + 시뮬레이션 (4주)

**목표:** 메뉴 간 데이터 흐름 설계 및 시뮬레이션 엔진

| 작업 | 상세 | 기간 |
|------|------|------|
| 플로우 캔버스 (React Flow) | 노드 배치, 엣지 연결, 줌/팬 | 3일 |
| 노드 유형 구현 | 메뉴노드, 조건노드, 변환노드, 시작/종료 노드 | 3일 |
| 데이터 매핑 설정 | 노드 간 연결 시 데이터 필드 매핑 UI | 3일 |
| 플로우 유효성 검증 | 순환참조, 미연결 노드, 타입 불일치 검사 | 2일 |
| 시뮬레이션 엔진 (백엔드) | Flow Parser + Execution Planner + Step Executor | 5일 |
| 샌드박스 매니저 | DB 스키마 복제, 테스트 데이터 관리 | 2일 |
| 시뮬레이션 UI | 단계별 실행, 데이터 상태 확인, 애니메이션 | 3일 |
| 시뮬레이션 결과/리포트 | 성공/실패 표시, 에러 로그, 결과 비교 | 2일|
| 적용 기능 | 시뮬레이션 통과 후 ACTIVE 상태로 전환 | 1일 |

**산출물:** 플로우를 시각적으로 설계하고, 시뮬레이션으로 검증한 후 적용할 수 있는 완전한 파이프라인

**완료 기준:** 플로우 설계 -> 시뮬레이션 실행 -> 결과 확인 -> 적용의 전체 사이클이 동작함

---

### Phase 5: 공정 시뮬레이션 + 고도화 (3주)

**목표:** 공정 라우팅 기반 시뮬레이션 및 시스템 고도화

| 작업 | 상세 | 기간 |
|------|------|------|
| 공정 시뮬레이션 엔진 | 라우팅 기반 스케줄링, 설비 가용성 반영 | 4일 |
| Gantt 차트 | 공정별 소요시간 시각화 | 2일 |
| 병목 분석 | 병목 공정 식별 및 하이라이트 | 2일 |
| What-If 분석 | 매개변수 변경 후 결과 비교 | 2일 |
| 화면 템플릿 시스템 | 자주 쓰는 화면 레이아웃 저장/불러오기 | 2일 |
| 감사 로그 UI | 변경 이력 조회 화면 | 2일 |
| Excel 일괄 처리 강화 | 대량 데이터 업로드 최적화, 에러 리포트 | 1일 |

**산출물:** 공정 시뮬레이션이 동작하고, 시스템 전반의 완성도가 높아진 상태

**완료 기준:** 공정 라우팅을 변경하면 시뮬레이션으로 리드타임 변화를 확인할 수 있음

---

### Phase 6: 테스트 및 안정화 (2주)

**목표:** 전체 시스템 통합 테스트 및 안정화

| 작업 | 상세 | 기간 |
|------|------|------|
| 통합 테스트 | 모듈 간 연동 시나리오 테스트 | 3일 |
| E2E 테스트 | Playwright 드래그앤드롭 시나리오 | 3일 |
| 성능 테스트 | 동시 사용자 50명, 데이터 1만건 기준 | 2일 |
| 보안 점검 | OWASP Top 10 체크리스트 | 1일 |
| 버그 수정 및 UX 개선 | 발견된 이슈 수정 | 3일 |

**산출물:** 안정적으로 동작하는 시스템

---

### 전체 타임라인 요약

| Phase | 내용 | 기간 | 누적 |
|-------|------|------|------|
| Phase 0 | 프로젝트 기반 구축 | 2주 | 2주 |
| Phase 1 | 기준정보 CRUD | 3주 | 5주 |
| Phase 2 | 메뉴 빌더 | 2주 | 7주 |
| Phase 3 | 화면 빌더 | 4주 | 11주 |
| Phase 4 | 플로우 디자이너 + 시뮬레이션 | 4주 | 15주 |
| Phase 5 | 공정 시뮬레이션 + 고도화 | 3주 | 18주 |
| Phase 6 | 테스트 및 안정화 | 2주 | 20주 |
| **총합** | | **약 20주 (5개월)** | |

> 위 일정은 풀타임 개발자 1~2명 기준. 팀 규모에 따라 조정 필요.

---

## 9. 위험 요소 및 대응 방안

| # | 위험 | 영향도 | 발생확률 | 대응 방안 |
|---|------|--------|----------|-----------|
| 1 | 동적 API 생성의 보안 취약점 | 높음 | 중간 | 데이터 바인딩 시 허용 테이블/필드 화이트리스트 적용, SQL 파라미터 바인딩 강제 |
| 2 | 화면 빌더 성능 저하 (위젯 과다) | 중간 | 중간 | 위젯 가상화(virtualization), 최대 위젯 수 제한(화면당 200개), 캔버스 최적화 |
| 3 | 시뮬레이션 샌드박스 데이터 격리 실패 | 높음 | 낮음 | DB 스키마 레벨 격리, 시뮬레이션 전용 DB 커넥션 풀 분리, 자동화 테스트 |
| 4 | 비개발자 사용성 목표 미달 | 높음 | 중간 | Phase별 사용성 테스트(실제 현장 담당자 대상), 온보딩 가이드/튜토리얼 내장 |
| 5 | JSONB 기반 메타데이터의 마이그레이션 복잡성 | 중간 | 중간 | JSON 스키마 버전 관리, 마이그레이션 스크립트 자동화, 하위 호환성 유지 정책 |

---

## 10. 제약 조건 및 범위

### In Scope (포함)
- 8개 기준정보 모듈 CRUD
- 메뉴 빌더 (드래그앤드롭 메뉴 생성/편집)
- 화면 빌더 (드래그앤드롭 위젯 배치, 데이터 바인딩)
- 플로우 디자이너 (메뉴 간 데이터 흐름 설계)
- 시뮬레이션 엔진 (플로우 검증 + 공정 시뮬레이션)
- 역할 기반 접근제어 (RBAC)
- 감사 로그

### Out of Scope (미포함)
- 실시간 생산 모니터링 (MES 실행 계층)
- 바코드/QR 코드 스캐닝
- ERP/SCM 등 외부 시스템 연동
- 모바일 앱 (반응형 웹까지만 지원)
- 다국어 지원 (한국어 우선, 구조만 확장 가능하게)
- 알림/메시징 시스템

### 향후 고려사항
- 생산실적 등록/조회 모듈
- 품질관리(QC) 모듈
- 재고관리/수불 모듈
- 대시보드/KPI 모듈
- 외부 시스템 연동 (ERP, PLC, IoT)
- 다중 공장/사업장 지원

---

## 11. 성공 지표

| 지표 | 목표값 | 측정 방법 |
|------|--------|-----------|
| 메뉴 생성 소요시간 | 3분 이내 | 비개발자 대상 태스크 테스트 |
| CRUD 화면 생성 소요시간 | 5분 이내 | 비개발자 대상 태스크 테스트 |
| 플로우 설계 -> 적용 사이클 | 30분 이내 | 10노드 규모 플로우 기준 |
| 시뮬레이션 정확도 | 실제 결과 대비 90% 이상 일치 | 공정 시뮬레이션 결과 vs 실제 리드타임 |
| 시스템 응답시간 | 95th percentile 2초 이내 | 성능 모니터링 |
| 사용자 만족도 | 4.0/5.0 이상 | 사용성 설문조사 |

---

## 12. 프로젝트 디렉토리 구조 (권장)

```
New MES/
├── docker-compose.yml
├── .github/
│   └── workflows/
│       └── ci.yml
├── packages/
│   ├── backend/                    # NestJS 백엔드
│   │   ├── src/
│   │   │   ├── core/              # 인증, 권한, 공통
│   │   │   │   ├── auth/
│   │   │   │   ├── rbac/
│   │   │   │   └── common/
│   │   │   ├── master-data/       # 기준정보 모듈
│   │   │   │   ├── partner/
│   │   │   │   ├── item/
│   │   │   │   ├── bom/
│   │   │   │   ├── process/
│   │   │   │   ├── routing/
│   │   │   │   ├── equipment/
│   │   │   │   ├── user/
│   │   │   │   └── common-code/
│   │   │   ├── builder/           # 커스터마이징 빌더
│   │   │   │   ├── menu/
│   │   │   │   ├── screen/
│   │   │   │   ├── data-binding/
│   │   │   │   └── flow/
│   │   │   ├── dynamic-api/       # 동적 CRUD API
│   │   │   └── simulation/        # 시뮬레이션 엔진
│   │   │       ├── flow-simulator/
│   │   │       ├── process-simulator/
│   │   │       └── sandbox/
│   │   ├── database/
│   │   │   └── migrations/
│   │   └── test/
│   │
│   └── frontend/                   # React 프론트엔드
│       ├── src/
│       │   ├── components/        # 공통 컴포넌트
│       │   │   ├── layout/
│       │   │   ├── table/
│       │   │   ├── form/
│       │   │   └── common/
│       │   ├── pages/
│       │   │   ├── master-data/   # 기준정보 화면
│       │   │   ├── builder/       # 빌더 화면
│       │   │   │   ├── menu-builder/
│       │   │   │   ├── screen-builder/
│       │   │   │   └── flow-designer/
│       │   │   ├── simulation/    # 시뮬레이션 화면
│       │   │   └── system/        # 시스템 관리
│       │   ├── engine/            # 동적 렌더링 엔진
│       │   │   ├── widget-renderer/
│       │   │   └── screen-renderer/
│       │   ├── stores/            # Zustand 스토어
│       │   ├── hooks/
│       │   ├── services/          # API 호출
│       │   └── utils/
│       └── test/
│
├── docs/                           # 문서
│   ├── requirements-and-plan.md
│   ├── api-spec/
│   └── data-model/
│
└── scripts/                        # 유틸리티 스크립트
    ├── seed-data.ts
    └── generate-migration.sh
```
