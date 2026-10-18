<#
.SYNOPSIS
  NCWatch Agent 상태를 점검한다. 읽기 전용이며 관리자 권한이 필요 없다(일부 정보는 관리자일 때만 표시).

.DESCRIPTION
  확인 항목: 예약 작업 / 프로세스 / MES 통신(하트비트·마지막 정상 전송) / NCWatch DB 조회 / 설비별 상태 / 최근 경고·오류 로그
  주의: "NCWatch DB 조회 성공"은 "설비 통신 정상"과 다릅니다. 설비 전원이 꺼져 있으면 OFFLINE(STATUS=4) 이
        조회되는 것이 정상이며, 이것만으로 통신 장애로 판단하지 않습니다.
  종료코드: 0 = 정상, 1 = 주의, 2 = 문제 있음

.PARAMETER Deep
  node check-connection.js 를 실행해 DB 조회와 MES 인증(하트비트 1회 전송)을 직접 시험한다.

.EXAMPLE
  .\check-agent.ps1
  .\check-agent.ps1 -Deep
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'DaewonNCWatchAgent',
    [switch]$Deep,
    [int]$LogLines = 10
)

$ErrorActionPreference = 'Continue'
$AgentDir = $PSScriptRoot
. (Join-Path $AgentDir 'agent-common.ps1')

$problems = 0
$warnings = 0
function Bad([string]$m)  { $script:problems++; Write-Fail $m }
function Warn2([string]$m) { $script:warnings++; Write-Warn $m }

Write-Host 'NCWatch Agent 상태 점검' -ForegroundColor White
Write-Host ("점검 시각: {0}   폴더: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $AgentDir)

# 1. 예약 작업
Write-Step '1. 자동 실행 (작업 스케줄러)'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Bad "예약 작업 '$TaskName' 이(가) 없습니다 → .\install-agent.ps1 로 설치하세요."
} else {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task.State -eq 'Disabled') { Bad '예약 작업이 비활성화되어 있습니다 (stop-agent.ps1 로 중지됨) → .\start-agent.ps1' }
    else { Write-Ok "예약 작업 상태: $($task.State)" }
    if ($info) {
        Write-Info ("마지막 실행: {0}  결과코드: {1}  (0 또는 267009=실행 중 이면 정상)" -f $info.LastRunTime, $info.LastTaskResult)
    }
}

# 2. 프로세스 / 중복 방지 잠금
Write-Step '2. 프로세스'
$lock = Test-AgentLockPort $AgentDir
$state = Read-AgentState $AgentDir
if ($lock) { Write-Ok '에이전트 실행 중 (중복 방지 잠금 확인)' } else { Bad '에이전트가 실행 중이 아닙니다.' }
$nodes = @(Get-AgentNodeProcesses $AgentDir)
$wrappers = @(Get-AgentWrapperProcesses $AgentDir)
if ($wrappers.Count -gt 1) { Warn2 "감시 래퍼가 $($wrappers.Count)개 실행 중입니다 (정상은 1개)." }
if ($nodes.Count -gt 1) { Warn2 "에이전트 프로세스가 $($nodes.Count)개 보입니다 (정상은 1개, 잠금이 중복 동작을 막습니다)." }
if ($state) { Write-Info ("pid={0}  버전={1}  시작={2}" -f $state.pid, $state.version, $state.startedAt) }

# 3. MES 통신 / DB
Write-Step '3. 데이터 전송 상태'
if (-not $state) {
    Bad '상태 파일(state\agent-status.json)이 없습니다 — 에이전트가 한 번도 정상 시작하지 못했습니다. logs\ 를 확인하세요.'
} else {
    $hb = ConvertTo-AgeSeconds $state.lastHeartbeatOkAt
    $st = ConvertTo-AgeSeconds $state.lastStatusOkAt
    $chk = ConvertTo-AgeSeconds $state.lastStatusCheckAt
    if ($null -eq $hb) { Bad '하트비트 성공 기록이 없습니다 (인증키/인터넷 확인).' }
    elseif ($hb -gt 120) { Bad "마지막 하트비트 성공: $(Format-Age $hb) (30초 주기인데 2분 넘게 없음 → 인터넷/인증키 확인)" }
    else { Write-Ok "마지막 하트비트 성공: $(Format-Age $hb)" }

    if ($null -eq $st) { Warn2 '아직 STATUS 전송 기록이 없습니다.' }
    elseif ($st -gt 180) { Warn2 "마지막 STATUS 정상 전송: $(Format-Age $st) (변경 없는 설비도 60초마다 재전송됩니다)" }
    else { Write-Ok "마지막 STATUS 정상 전송: $(Format-Age $st)" }
    if ($chk -ne $null) { Write-Info "마지막 NCWatch DB 조회: $(Format-Age $chk)" }

    if ($state.dbReachable -eq $false) { Bad 'NCWatch DB 조회 실패 중 (PostgreSQL 서비스/.env 확인)' }
    elseif ($state.dbReachable -eq $true) { Write-Ok 'NCWatch DB 조회 정상' }

    if ($state.mesReachable -eq $false -and $state.lastMesError) {
        $e = $state.lastMesError
        if ($e.kind -eq 'auth') { Bad "MES 인증 실패 — 운영 인증키를 확인하세요 (set-agent-key.ps1). $($e.message)" }
        else { Warn2 "MES 통신 오류 [$($e.kind)] $($e.message) — 인터넷 복구 시 자동 재개됩니다." }
    }
    if ($state.lastReportOkAt) { Write-Info "마지막 일간 리포트 전송: $(Format-Age (ConvertTo-AgeSeconds $state.lastReportOkAt))" }
}

# 4. 설비별
Write-Step '4. 설비별 최신 상태 (NCWatch DB 기준)'
if ($state -and $state.machines) {
    foreach ($name in $state.machineNames) {
        $m = $state.machines.$name
        if (-not $m) { Warn2 "${name}: 아직 조회 기록 없음"; continue }
        if ($m.dbOk -eq $false) { Bad "${name}: STATUS 조회 실패 (테이블 TBL_${name}_STATUS 확인)"; continue }
        $sent = Format-Age (ConvertTo-AgeSeconds $m.lastSentAt)
        $line = "${name}: $($m.statusLabel)(STATUS=$($m.statusCode))  NCWatch 행 시각=$($m.rowTimestamp)  MES 전송=$sent  MES 결과=$($m.lastResult)"
        if ($m.lastResult -eq 'UNMAPPED') { Warn2 "$line  → MES 설비 매핑 필요" }
        elseif ($m.lastResult -eq 'ERROR') { Bad "$line  $($m.lastResultMessage)" }
        else { Write-Ok $line }
        if ($m.statusCode -eq 4) { Write-Info "   OFFLINE: 설비 전원 꺼짐 또는 NCWatch↔설비 미연결이면 정상입니다 (장애로 단정하지 마세요)." }
    }
} else { Write-Info '(설비별 기록 없음)' }

# 5. 최근 경고/오류 로그
Write-Step "5. 최근 경고/오류 로그 (최대 $LogLines 줄)"
$logDir = Join-Path $AgentDir 'logs'
$latestLog = if (Test-Path -LiteralPath $logDir) { Get-ChildItem -LiteralPath $logDir -Filter 'agent-*.log' | Sort-Object Name -Descending | Select-Object -First 1 } else { $null }
if ($latestLog) {
    $lines = Get-Content -LiteralPath $latestLog.FullName -Tail 400 -Encoding UTF8 | Where-Object { $_ -match '\[(WARN|ERROR)\]' } | Select-Object -Last $LogLines
    if ($lines) { $lines | ForEach-Object { Write-Info $_ } } else { Write-Ok "$($latestLog.Name): 경고/오류 없음" }
    Write-Info "로그 파일: $($latestLog.FullName)"
} else { Write-Info '(로그 파일 없음)' }

# 6. 심층 점검
if ($Deep) {
    Write-Step '6. 심층 점검 (DB 조회 + MES 하트비트 인증)'
    $node = Find-NodeExe $null
    if (-not $node) { Bad 'node.exe 를 찾을 수 없습니다.' }
    else {
        Push-Location $AgentDir
        try { & $node 'check-connection.js' | ForEach-Object { Write-Info $_ }; if ($LASTEXITCODE -ne 0) { Bad '심층 점검에 실패한 항목이 있습니다.' } }
        finally { Pop-Location }
    }
}

Write-Host ''
if ($problems -gt 0) { Write-Host "결과: 문제 ${problems}건 / 주의 ${warnings}건" -ForegroundColor Red; exit 2 }
elseif ($warnings -gt 0) { Write-Host "결과: 주의 ${warnings}건" -ForegroundColor Yellow; exit 1 }
else { Write-Host '결과: 정상' -ForegroundColor Green; exit 0 }
