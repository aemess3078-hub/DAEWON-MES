<#
.SYNOPSIS
  NCWatch Agent 자동 실행을 제거한다. (관리자 권한 필요)

.DESCRIPTION
  제거하는 것: 예약 작업 'DaewonNCWatchAgent', 실행 중인 이 폴더의 에이전트/래퍼 프로세스
  유지하는 것: .env (비밀번호/키), 에이전트 소스, logs\ , state\ (옵션으로 삭제 가능)
  건드리지 않는 것: NCWatch.exe / NCWatch 설정 / NCWatch DB / 다른 예약 작업

.PARAMETER RemoveLogs
  logs\ 폴더도 삭제한다.
.PARAMETER RemoveState
  state\ 폴더도 삭제한다.
.PARAMETER Yes
  확인 질문 없이 진행한다.

.EXAMPLE
  .\uninstall-agent.ps1 -WhatIf
  .\uninstall-agent.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = 'DaewonNCWatchAgent',
    [switch]$RemoveLogs,
    [switch]$RemoveState,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
. (Join-Path $AgentDir 'agent-common.ps1')

Assert-Admin 'uninstall-agent.ps1'
Write-Host 'NCWatch Agent 제거' -ForegroundColor White

Write-Step '1. 현재 상태 (읽기 전용)'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Write-Info "예약 작업 '$TaskName' : $($task.State)" } else { Write-Info "예약 작업 '$TaskName' : 없음" }
$wrappers = @(Get-AgentWrapperProcesses $AgentDir)
$nodes = @(Get-AgentNodeProcesses $AgentDir)
Write-Info "실행 중 래퍼 $($wrappers.Count)개 / 에이전트 $($nodes.Count)개"

Write-Step '2. 영향도'
Write-Info '[중지/제거] 예약 작업, 실행 중인 에이전트 → 이후 MES 로 데이터 전송이 중단되고 Gateway 는 몇 분 뒤 오프라인으로 표시됩니다.'
if ($RemoveLogs)  { Write-Info '[삭제] logs\ 폴더' }
if ($RemoveState) { Write-Info '[삭제] state\ 폴더' }
Write-Info '[유지] .env, 에이전트 소스 / [변경 없음] NCWatch.exe, NCWatch 설정, NCWatch DB'

if ($WhatIfPreference) { Write-Host '-WhatIf: 변경 없이 종료합니다.' -ForegroundColor Yellow; exit 0 }
if (-not $task -and $wrappers.Count -eq 0 -and $nodes.Count -eq 0 -and -not $RemoveLogs -and -not $RemoveState) {
    Write-Host '제거할 항목이 없습니다.'; exit 0
}
if (-not (Confirm-Proceed -Yes:$Yes -Question '제거하시겠습니까?')) { Write-Host '취소했습니다.'; exit 0 }

Write-Step '3. 제거'
if ($task) {
    if ($PSCmdlet.ShouldProcess($TaskName, '예약 작업 중지 및 삭제')) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok "예약 작업 '$TaskName' 삭제"
    }
}
Stop-AgentProcesses $AgentDir
Write-Ok '실행 중인 에이전트 프로세스 종료'

if ($RemoveLogs)  { Remove-Item -LiteralPath (Join-Path $AgentDir 'logs')  -Recurse -Force -ErrorAction SilentlyContinue; Write-Ok 'logs\ 삭제' }
if ($RemoveState) { Remove-Item -LiteralPath (Join-Path $AgentDir 'state') -Recurse -Force -ErrorAction SilentlyContinue; Write-Ok 'state\ 삭제' }

Write-Host ''
Write-Host '제거 완료. 다시 설치하려면 .\install-agent.ps1 을 실행하세요.' -ForegroundColor White
