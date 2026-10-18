<#
.SYNOPSIS
  NCWatch Agent 를 시작한다. (관리자 권한 필요)

.DESCRIPTION
  기본: 예약 작업을 (비활성화되어 있으면 다시 활성화한 뒤) 시작한다.
  -Foreground: 예약 작업 없이 이 창에서 직접 실행한다 (시험/진단용, Ctrl+C 로 종료).
  이미 실행 중이면(중복 방지) 새로 시작하지 않는다.

.EXAMPLE
  .\start-agent.ps1
  .\start-agent.ps1 -Foreground
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'DaewonNCWatchAgent',
    [switch]$Foreground,
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
. (Join-Path $AgentDir 'agent-common.ps1')

Assert-Admin 'start-agent.ps1'

if (Test-AgentLockPort $AgentDir) {
    Write-Warn '에이전트가 이미 실행 중입니다 (중복 실행 방지). 새로 시작하지 않습니다.'
    Write-Info '상태 확인: .\check-agent.ps1   |   재시작: .\stop-agent.ps1 후 .\start-agent.ps1'
    exit 0
}

if ($Foreground) {
    $node = Find-NodeExe $NodePath
    if (-not $node) { Write-Fail 'node.exe 를 찾을 수 없습니다.'; exit 1 }
    Write-Host '에이전트를 이 창에서 직접 실행합니다. 종료: Ctrl+C' -ForegroundColor White
    Push-Location $AgentDir
    try { & $node 'index.js' } finally { Pop-Location }
    exit $LASTEXITCODE
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Fail "예약 작업 '$TaskName' 이(가) 없습니다. 먼저 .\install-agent.ps1 을 실행하세요."
    exit 1
}
if ($task.State -eq 'Disabled') {
    Enable-ScheduledTask -TaskName $TaskName | Out-Null
    Write-Ok '자동 실행을 다시 활성화했습니다.'
}
Start-ScheduledTask -TaskName $TaskName
Write-Ok "예약 작업 '$TaskName' 시작 요청 완료. 잠시 후 .\check-agent.ps1 로 상태를 확인하세요."
