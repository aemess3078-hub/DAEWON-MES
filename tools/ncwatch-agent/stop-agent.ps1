<#
.SYNOPSIS
  NCWatch Agent 를 중지한다. (관리자 권한 필요)

.DESCRIPTION
  기본 동작: 예약 작업을 중지하고 "비활성화"한다.
    → 5분 감시 트리거나 재부팅으로 다시 켜지지 않는다. 다시 켜려면 start-agent.ps1.
  -KeepEnabled: 지금 실행 중인 프로세스만 종료하고 자동 실행은 유지한다.
    → 5분 이내에 감시 트리거가 에이전트를 다시 시작한다 (재시작 시험용).
  영향: 중지 동안 MES 로 설비 데이터가 전송되지 않는다 (NCWatch 자체와 NCWatch DB 는 영향 없음).

.EXAMPLE
  .\stop-agent.ps1 -WhatIf
  .\stop-agent.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = 'DaewonNCWatchAgent',
    [switch]$KeepEnabled,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
. (Join-Path $AgentDir 'agent-common.ps1')

Assert-Admin 'stop-agent.ps1'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$wrappers = @(Get-AgentWrapperProcesses $AgentDir)
$nodes = @(Get-AgentNodeProcesses $AgentDir)

Write-Step '영향도'
Write-Info "예약 작업: $(if ($task) { $task.State } else { '없음' }) / 실행 중 래퍼 $($wrappers.Count)개, 에이전트 $($nodes.Count)개"
Write-Info 'MES 로 설비 데이터 전송이 중단됩니다 (NCWatch 와 NCWatch DB 는 영향 없음).'
if ($KeepEnabled) { Write-Info '자동 실행은 유지됩니다 → 5분 이내 감시 트리거가 다시 시작합니다.' }
else { Write-Info '자동 실행도 비활성화됩니다 → start-agent.ps1 을 실행하기 전까지 재부팅 후에도 시작되지 않습니다.' }

if ($WhatIfPreference) { Write-Host '-WhatIf: 변경 없이 종료합니다.' -ForegroundColor Yellow; exit 0 }
if (-not $task -and $wrappers.Count -eq 0 -and $nodes.Count -eq 0) { Write-Host '실행 중인 항목이 없습니다.'; exit 0 }
if (-not (Confirm-Proceed -Yes:$Yes -Question '중지하시겠습니까?')) { Write-Host '취소했습니다.'; exit 0 }

if ($task -and -not $KeepEnabled) {
    Disable-ScheduledTask -TaskName $TaskName | Out-Null   # 먼저 비활성화해 재시작 트리거를 막는다
    Write-Ok '자동 실행 비활성화'
}
if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
Stop-AgentProcesses $AgentDir

Start-Sleep -Seconds 2
if (Test-AgentLockPort $AgentDir) { Write-Warn '에이전트가 아직 종료되지 않았습니다. 잠시 후 .\check-agent.ps1 로 확인하세요.' }
else { Write-Ok '에이전트가 중지되었습니다.' }
