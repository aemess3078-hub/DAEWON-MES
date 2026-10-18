# 대원정밀 NCWatch → MES 브리지 에이전트 (v3.0.0)

현장 PC(Windows 11)에서 NCWatch 로컬 PostgreSQL 을 **읽기 전용**으로 조회해
클라우드 MES(`https://daewon-mes.vercel.app`)의 수신 API 로 **push** 합니다.
현장 PC 에 열리는 포트는 없습니다(127.0.0.1 의 중복 실행 방지용 포트 1개 제외, 외부 접속 불가).

> 이 패키지에는 **비밀정보(운영 인증키, DB 비밀번호)가 들어 있지 않습니다.**
> 운영 인증키는 현장에서 `set-agent-key.ps1` 로 입력합니다.

| 항목 | 엔드포인트 | 주기 |
|---|---|---|
| 설비 상태 | `POST /api/lms/ncwatch/status` | 10초 (변경 없는 설비는 60초마다 1회) |
| 일간 리포트 | `POST /api/lms/ncwatch/report-daily` | 1시간 (KST 날짜) |
| 생존 신호 | `POST /api/lms/ncwatch/heartbeat` | 30초 |

대상 설비 4대: `CNC-1, CNC-8, CNC-9, MCT-6` (NCWatch 테이블 `TBL_<설비>_STATUS`).
**CNC-1 은 NCWatch↔설비 통신이 아직 연결되지 않았어도 수집 대상에 포함되어 있습니다.**
설비 연결이 완료되면 에이전트를 다시 설치하거나 수정하지 않아도 자동으로 수집됩니다.
OFFLINE(STATUS=4)은 설비 전원이 꺼져 있을 때의 정상 값이며 장애 경고로 처리하지 않습니다.

---

## 1. 사전 확인

- Windows 11, Node.js 18 이상 (확인: v24.20.0), 인터넷 연결
- NCWatch 는 현재처럼 그대로 둡니다. **NCWatch.exe 와 NCWatch 설정은 수정/삭제하지 않습니다.**
- MES 담당자에게 받을 것: **운영 인증키**(`dwk_` 로 시작). New MES 데모용 키는 사용할 수 없습니다.

## 2. 파일 복사

1. 기존 `C:\NCWatch\ncwatch-agent` 폴더가 있으면 **통째로 백업**합니다 (예: `ncwatch-agent_backup_20261018`).
2. 이 패키지의 내용을 `C:\NCWatch\ncwatch-agent` 에 복사(덮어쓰기)합니다.
   - 기존 `.env` 는 패키지에 없으므로 덮어써지지 않습니다. (`.env` 가 없다면 `.env.example` 을 `.env` 로 복사)
3. 만약 기존 에이전트가 콘솔 창으로 실행 중이면 그 창을 닫습니다(Ctrl+C).

## 3. `.env` 확인

`.env` 를 메모장으로 열어 아래만 확인합니다 (비밀번호는 화면 공유/사진 촬영 금지).

```
NCWATCH_DB_HOST=localhost
NCWATCH_DB_PORT=5433          # 기존 값 유지
NCWATCH_DB_NAME=ncwatch
NCWATCH_DB_USER=ncwatch
NCWATCH_DB_PASSWORD=...       # 기존 값 유지 (v3 는 기본 비밀번호가 없으므로 반드시 입력)
NCWATCH_MACHINES=CNC-1,CNC-8,CNC-9,MCT-6
MES_API_URL=https://daewon-mes.vercel.app
MES_AGENT_KEY=                # 다음 단계에서 입력
STATUS_INTERVAL_MS=10000
REPORT_INTERVAL_MS=3600000
HEARTBEAT_INTERVAL_MS=30000
```

## 4. 운영 인증키 입력 (관리자 PowerShell)

시작 메뉴 → PowerShell 우클릭 → **관리자 권한으로 실행**

```powershell
cd C:\NCWatch\ncwatch-agent
Set-ExecutionPolicy -Scope Process Bypass       # 이 창에서만 스크립트 실행 허용 (영구 변경 아님)
.\set-agent-key.ps1
```

키는 화면에 표시되지 않는 입력창에 붙여 넣습니다. 키는 로그/콘솔/보고서에 출력되지 않으며,
교체 전 `.env` 는 `.env.bak-날짜시각` 으로 백업됩니다(확인 후 삭제).
키 파일로 받았다면 `.\set-agent-key.ps1 -KeyFile D:\키파일.txt -DeleteKeyFile`.

## 5. 연결 점검 (선택, 권장)

```powershell
node check-connection.js            # DB 조회 + MES 하트비트 인증 (하트비트 1회 전송)
node check-connection.js --no-mes   # DB 조회만
```

`[PASS]` 가 4개 설비 모두에 나와야 합니다. 4대가 모두 `OFFLINE` 이면 전원이 꺼진 상태에서는 정상입니다.

## 6. 자동 실행 설치 (관리자 PowerShell)

```powershell
.\install-agent.ps1 -WhatIf      # 변경 없이 영향도만 확인
.\install-agent.ps1              # 영향도를 보여 주고 y 확인 후 설치
```

설치 내용: 작업 스케줄러 `DaewonNCWatchAgent` (SYSTEM 계정 · 부팅 30초 후 시작 · 5분마다 감시 · 비정상 종료 시 10초 후 재시작),
`.env` 접근권한을 SYSTEM/Administrators 로 제한. 로그인 없이 실행되며 PC 재부팅 후 자동으로 시작됩니다.

## 7. 확인

```powershell
.\check-agent.ps1          # 읽기 전용 상태 점검 (관리자 불필요)
.\check-agent.ps1 -Deep    # DB 조회 + MES 하트비트 인증까지 직접 시험
```

MES 화면에서도 확인합니다.
- **게이트웨이 관리**: `NCWatch Agent` 가 온라인, 마지막 통신 시각이 갱신됨
- **설비연결설정 > NCWatch Agent 매핑**: 4대의 마지막 수신 시각/상태
- **설비 모니터링**: 4대가 표시됨 (전원 OFF 일 때는 오프라인)

### 설치 후 시험 (권장)
1. **재부팅 시험**: PC 를 재부팅하고 로그인하지 않은 상태에서 2~3분 뒤 `check-agent.ps1` → 정상이어야 함
2. **인터넷 단절 시험**: 랜선을 뽑고 1분 뒤 `check-agent.ps1` → MES 통신 오류(주의)로 표시, 프로세스는 계속 실행. 다시 연결하면 자동으로 전송 재개(로그에 "MES 통신 복구")
3. **비정상 종료 시험**: 작업 관리자에서 `node.exe` 종료 → 10초 안에 새 프로세스가 자동 시작
4. **DB 중단 시험**: NCWatch PostgreSQL 서비스를 잠시 중지 → 에이전트는 종료되지 않고 "NCWatch DB 조회 실패" 로그, 서비스 복구 시 자동 재개 (**NCWatch 운영 시간 외에** 시험)

## 8. 중지 / 재시작 / 제거 (관리자 PowerShell)

| 목적 | 명령 | 영향 |
|---|---|---|
| 중지(자동 실행도 끔) | `.\stop-agent.ps1` | MES 전송 중단. NCWatch/DB 영향 없음 |
| 다시 시작 | `.\start-agent.ps1` | 자동 실행 재활성화 후 시작 |
| 화면에서 직접 실행(시험용) | `.\start-agent.ps1 -Foreground` | Ctrl+C 로 종료 |
| 제거 | `.\uninstall-agent.ps1` | 예약 작업/프로세스 제거. `.env`·소스 유지 |
| 인증키 교체 | `.\set-agent-key.ps1 -Restart` | 잠시 전송 끊김 |

모든 스크립트는 `-WhatIf` 로 사전 확인할 수 있고, 변경 전에 영향도를 출력한 뒤 확인(y)을 받습니다.

## 9. 로그와 상태

- `logs\agent-YYYYMMDD.log` : 일자별(KST) 로그, 30일 보관. 시작/종료, DB 조회 실패, MES 호출 실패, 인증 실패,
  설비별 상태 변경·MES 처리 결과, 10분마다 "마지막 정상 전송 시각" 요약. **키/비밀번호는 기록되지 않습니다.**
- `logs\wrapper.log` : 감시 스크립트의 재시작 이력
- `logs\last-stderr.log` : 마지막 실행의 오류 출력(비정상 종료 원인)
- `state\agent-status.json` : `check-agent.ps1` 이 읽는 현재 상태(비밀값 없음)

반복되는 장애 로그는 2~30분 간격으로 한 번만 기록해 로그가 폭주하지 않습니다.

## 10. 동작 방식 (운영 안정성)

| 항목 | 동작 |
|---|---|
| HTTP 제한시간 | MES 요청 15초(`MES_REQUEST_TIMEOUT_MS`) 초과 시 중단 후 다음 주기에 재시도 |
| 중복 실행 방지 | 이전 요청이 끝나기 전에는 같은 작업을 다시 실행하지 않음. 에이전트 자체도 127.0.0.1 포트 잠금으로 2개 실행 불가 |
| 네트워크 장애 | 프로세스는 종료되지 않음. 실패 시 10→20→40→60초 간격으로 재시도, 복구되면 즉시 정상 주기로 복귀 |
| 자동 복구 | 인터넷/DB 복구 시 자동 재개. MES 인증키 교체는 `.env` 를 다시 읽어 재시작 없이 반영 |
| 변경 감지 | 값이 그대로인 설비는 60초마다만 재전송(`STATUS_FORCE_SEND_MS`), 변경은 다음 10초 주기에 즉시 전송 |
| 날짜 | REPORT_DAILY 는 KST 기준. 자정 직후(0~2시)에는 전날 최종치도 함께 전송 |
| 시각 해석 | NCWatch 의 타임존 없는 시각은 KST 로 전송·해석 (PC 타임존 설정과 무관) |
| DB | 읽기 전용 SELECT, 질의 제한시간 10초, 연결이 끊겨도 풀이 자동 재연결 |

## 11. 문제 해결

| 증상 | 확인/조치 |
|---|---|
| `check-agent` 에 "MES 인증 실패" | 운영 인증키 확인 → `.\set-agent-key.ps1`. 데모 키는 사용 불가 |
| "NCWatch DB 조회 실패" | PostgreSQL 서비스 실행 여부, `.env` 의 DB 포트/비밀번호, 설비명(`node list-machines.js`) |
| "MES 연결 실패 [network/timeout]" | 인터넷 연결·방화벽(443 아웃바운드). 복구되면 자동 재개 |
| 전부 "UNMAPPED" | MES 설비연결설정에서 설비명↔MES 설비 매핑이 필요 (MES 담당자) |
| 4대 모두 OFFLINE | 설비 전원 OFF/비가동 시간대면 정상. 가동 중인데 OFFLINE 이면 NCWatch↔설비 통신 점검 |
| `node.exe` 를 찾을 수 없음 | Node.js 를 `C:\Program Files\nodejs` 에 설치하거나 `-NodePath` 지정 |
| 스크립트 실행 차단 | 같은 창에서 `Set-ExecutionPolicy -Scope Process Bypass` 후 재실행 |

## 12. 아직 검증되지 않은 사항 (현장에서 확인 필요)

- STATUS 코드의 의미는 **4=OFFLINE 만 실측으로 확인**(RUN=0, MESSAGE=202 와 일치). 0·1·2·3·5·6 의미와 MODE/RUN 값은 설비 가동 후 샘플 확인 필요
- `REPORT_DAILY` 의 `DATA_1~12` 컬럼 의미(가동률·수량 등)는 가동 실측 데이터로 확인 전까지 미검증
- `PARTCOUNT` 는 MES 생산실적(ProductionResult)으로 **자동 등록하지 않습니다**. 설비 태그의 참고값일 뿐이며 실적은 POP 에서 입력합니다
- CNC-1 은 NCWatch↔설비 통신 연결 후 `ALIVECOUNT`/STATUS 변화를 확인해야 실제 통신 정상으로 판단할 수 있습니다
