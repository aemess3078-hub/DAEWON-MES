<#
.SYNOPSIS
  NCWatch Agent 를 Windows 작업 스케줄러에 등록해 PC 부팅 시 자동 실행되도록 설치한다. (관리자 권한 필요)

.DESCRIPTION
  실행 전에 영향도를 점검/출력하고, 확인(y)을 받은 뒤에만 변경한다.

  변경하는 것
    - 예약 작업 'DaewonNCWatchAgent' 1개 등록 (SYSTEM 계정, 부팅 30초 후 시작 + 5분마다 감시 트리거)
    - 필요 시 이 폴더에서 'npm install --omit=dev' (pg 라이브러리가 없을 때만)
    - 이 폴더의 .env 파일 접근권한을 SYSTEM/Administrators 로 제한
    - 이 폴더 아래 logs\, state\ 폴더에 로그/상태 파일 생성

  변경하지 않는 것
    - NCWatch.exe, NCWatch 설정, NCWatch PostgreSQL 데이터 (읽기 전용 SELECT 만 수행)
    - .env 의 내용 (비밀번호/키를 읽어 출력하거나 수정하지 않음)
    - 다른 예약 작업/서비스

.PARAMETER Force
  같은 이름의 예약 작업이 이미 있으면 교체한다. (없으면 불필요)
.PARAMETER Yes
  확인 질문 없이 진행한다.
.PARAMETER NodePath
  node.exe 경로를 직접 지정한다. 생략하면 PATH 에서 찾는다.
.PARAMETER SkipDbCheck
  설치 전 NCWatch DB 조회 점검을 건너뛴다.

.EXAMPLE
  .\install-agent.ps1 -WhatIf     # 변경 없이 무엇을 할지만 출력
  .\install-agent.ps1             # 영향도 확인 후 설치
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = 'DaewonNCWatchAgent',
    [string]$NodePath,
    [switch]$Force,
    [switch]$Yes,
    [switch]$SkipDbCheck
)

$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
. (Join-Path $AgentDir 'agent-common.ps1')

Assert-Admin 'install-agent.ps1'
Write-Host 'NCWatch Agent 설치 (작업 스케줄러 등록)' -ForegroundColor White
Write-Host "에이전트 폴더: $AgentDir"

# ── 1. 사전 점검 (읽기 전용) ───────────────────────────────────────────────
Write-Step '1. 사전 점검'
$blockers = @()

$node = Find-NodeExe $NodePath
if (-not $node) {
    $blockers += 'node.exe 를 찾을 수 없습니다 (Node.js 18 이상 설치 필요). -NodePath 로 경로를 지정하세요.'
} else {
    $verText = (& $node --version) 2>$null
    $major = 0
    if ($verText -match '^v(\d+)\.') { $major = [int]$Matches[1] }
    if ($major -lt 18) { $blockers += "Node.js 18 이상이 필요합니다 (현재 $verText)." }
    else { Write-Ok "Node.js $verText ($node)" }
    if ($node -like "$env:SystemDrive\Users\*") {
        Write-Warn 'node.exe 가 사용자 프로필 안에 있습니다. SYSTEM 계정으로 실행되는 작업이 접근하지 못할 수 있습니다. 가능하면 C:\Program Files\nodejs 설치본을 사용하세요.'
    }
}

foreach ($f in @('index.js', 'package.json', 'run-agent.ps1', 'src\agent.js', 'src\config.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $AgentDir $f))) { $blockers += "필수 파일 없음: $f (패키지가 일부만 복사되었습니다)" }
}

$envFile = Join-Path $AgentDir '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    $blockers += ".env 파일이 없습니다. .env.example 을 .env 로 복사해 NCWATCH_DB_PASSWORD 등을 채우고, set-agent-key.ps1 로 운영 인증키를 입력하세요."
} elseif ($node) {
    Push-Location $AgentDir
    try {
        $cfgOut = & $node 'check-connection.js' '--config-only' 2>&1
        if ($LASTEXITCODE -ne 0) {
            $cfgOut | ForEach-Object { Write-Info $_ }
            $blockers += '.env 설정이 올바르지 않습니다 (위 항목 참고). 운영 인증키는 set-agent-key.ps1 로 입력하세요.'
        } else { Write-Ok '.env 설정 검증 통과 (값은 출력하지 않음)' }
    } finally { Pop-Location }
}

$hasPg = Test-Path -LiteralPath (Join-Path $AgentDir 'node_modules\pg\package.json')
if ($hasPg) { Write-Ok 'pg 라이브러리 확인됨' } else { Write-Warn 'node_modules\pg 가 없습니다 → 설치 단계에서 npm install --omit=dev 를 실행합니다 (인터넷 필요).' }

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    if ($Force) { Write-Warn "예약 작업 '$TaskName' 이(가) 이미 있습니다 → -Force 로 교체합니다." }
    else { $blockers += "예약 작업 '$TaskName' 이(가) 이미 있습니다. 교체하려면 -Force 를 붙이세요. (제거는 uninstall-agent.ps1)" }
}

$running = @(Get-AgentNodeProcesses $AgentDir)
if ($running.Count -gt 0 -and -not $existingTask) {
    Write-Warn "이 폴더의 에이전트가 수동 실행 중입니다 (pid=$($running.ProcessId -join ',')). 예약 작업이 시작하려면 먼저 해당 창을 닫으세요. (중복 방지 잠금이 두 번째 실행을 막습니다)"
}

if ($blockers.Count -gt 0) {
    Write-Host ''
    $blockers | ForEach-Object { Write-Fail $_ }
    Write-Host ''
    Write-Host '위 문제를 해결한 뒤 다시 실행하세요. (아무것도 변경하지 않았습니다)' -ForegroundColor Red
    exit 1
}

if (-not $SkipDbCheck) {
    Push-Location $AgentDir
    try {
        Write-Info 'NCWatch DB 읽기 전용 점검 (SELECT 만 수행)...'
        $dbOut = & $node 'check-connection.js' '--no-mes' 2>&1
        $dbOut | ForEach-Object { Write-Info $_ }
        if ($LASTEXITCODE -ne 0) { Write-Warn 'DB 점검에 실패한 항목이 있습니다. 에이전트는 DB 가 복구되면 자동으로 수집을 재개하지만, 설치 전에 원인을 확인하는 것이 좋습니다.' }
    } finally { Pop-Location }
}

# ── 2. 영향도 요약 ─────────────────────────────────────────────────────────
Write-Step '2. 변경 예정 사항 (영향도)'
Write-Info "[생성] 예약 작업 '$TaskName' : SYSTEM 계정 / 부팅 30초 후 시작 / 5분마다 감시(이미 실행 중이면 무시)"
Write-Info '[생성] logs\ , state\ 폴더 (로그/상태 파일)'
Write-Info '[변경] .env 접근권한: SYSTEM 및 Administrators 만 읽기/쓰기'
if (-not $hasPg) { Write-Info '[설치] npm install --omit=dev (이 폴더 node_modules\)' }
Write-Info '[유지] NCWatch.exe / NCWatch 설정 / NCWatch DB 데이터 — 변경 없음 (읽기 전용 조회만)'
Write-Info '[영향] 설치 직후 에이전트가 시작되어 MES 로 하트비트/상태를 전송합니다 (이미 수동 실행 중이면 먼저 종료하세요)'

if ($WhatIfPreference) {
    Write-Host ''
    Write-Host '-WhatIf: 변경 없이 종료합니다.' -ForegroundColor Yellow
    exit 0
}
if (-not (Confirm-Proceed -Yes:$Yes -Question '위 내용으로 설치하시겠습니까?')) {
    Write-Host '취소했습니다. 아무것도 변경하지 않았습니다.'
    exit 0
}

# ── 3. 설치 ────────────────────────────────────────────────────────────────
Write-Step '3. 설치'
New-Item -ItemType Directory -Force -Path (Join-Path $AgentDir 'logs'), (Join-Path $AgentDir 'state') | Out-Null

# .env 접근 제한 (SID 사용: 시스템 언어와 무관) — 내용은 읽지 않는다.
& icacls.exe $envFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Ok '.env 접근권한 제한 완료 (SYSTEM, Administrators)' } else { Write-Warn '.env 접근권한 설정에 실패했습니다 (계속 진행)' }

if (-not $hasPg) {
    $npm = Join-Path (Split-Path $node) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) { throw "npm.cmd 를 찾을 수 없습니다: $npm" }
    Push-Location $AgentDir
    try {
        & $npm install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install 실패 — 인터넷 연결을 확인하세요.' }
    } finally { Pop-Location }
    Write-Ok 'pg 라이브러리 설치 완료'
}

$runScript = Join-Path $AgentDir 'run-agent.ps1'
$arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NodePath "{1}"' -f $runScript, $node
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $AgentDir

$bootTrigger = New-ScheduledTaskTrigger -AtStartup
$bootTrigger.Delay = 'PT30S'
$watchTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

if ($existingTask) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-AgentProcesses $AgentDir
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

if ($PSCmdlet.ShouldProcess($TaskName, '예약 작업 등록')) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($bootTrigger, $watchTrigger) `
        -Principal $principal -Settings $settings `
        -Description '대원정밀 NCWatch → MES 데이터 전송 에이전트 (부팅 시 자동 실행, 비정상 종료 시 자동 재시작)' | Out-Null
    Write-Ok "예약 작업 '$TaskName' 등록 완료"
}

# ── 4. 시작 및 확인 ────────────────────────────────────────────────────────
Write-Step '4. 시작 및 확인'
$startedAt = Get-Date
Start-ScheduledTask -TaskName $TaskName
Write-Info '에이전트 시작 대기 (최대 40초)...'
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    $st = Read-AgentState $AgentDir
    $sinceStart = ConvertTo-AgeSeconds $st.startedAt
    $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
    if ($st -and $st.running -and $null -ne $sinceStart -and $sinceStart -le ($elapsed + 5) -and $st.lastHeartbeatOkAt) { $ok = $true; break }
}
if ($ok) {
    Write-Ok "에이전트 실행 확인 (pid=$($st.pid), v$($st.version)) — MES 하트비트 성공"
} else {
    Write-Warn '40초 안에 하트비트 성공을 확인하지 못했습니다. check-agent.ps1 로 상태를 확인하세요 (인증키/인터넷/DB 점검).'
}

Write-Host ''
Write-Host '설치가 끝났습니다. 상태 확인: .\check-agent.ps1   |   중지: .\stop-agent.ps1   |   제거: .\uninstall-agent.ps1' -ForegroundColor White
