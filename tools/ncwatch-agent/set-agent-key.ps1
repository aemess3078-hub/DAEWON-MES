<#
.SYNOPSIS
  운영 인증키(MES_AGENT_KEY)를 .env 에 안전하게 입력/교체한다. (관리자 권한 필요)

.DESCRIPTION
  - 키는 화면에 표시되지 않는 입력창(또는 -KeyFile)으로만 받고, 콘솔/로그에 출력하지 않는다.
  - 교체 전 .env 를 .env.bak-날짜시각 으로 백업한다 (같은 접근권한: SYSTEM/Administrators).
  - 에이전트는 인증 실패 시 .env 를 다시 읽어 새 키를 반영하므로 대부분 재시작이 필요 없다.
    바로 반영하려면 -Restart 를 사용한다 (잠시 전송이 끊긴다).
  - 데모 키(gw-api-key-demo-001)와 형식이 맞지 않는 값(dwk_ 로 시작, 32자 이상)은 거부한다.

.PARAMETER KeyFile
  키가 한 줄로 들어있는 파일. 입력 후 파일 삭제를 권장하며 -DeleteKeyFile 로 자동 삭제할 수 있다.
.PARAMETER Restart
  입력 후 에이전트를 재시작한다.

.EXAMPLE
  .\set-agent-key.ps1
  .\set-agent-key.ps1 -KeyFile D:\agent-key.txt -DeleteKeyFile -Restart
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = 'DaewonNCWatchAgent',
    [string]$KeyFile,
    [switch]$DeleteKeyFile,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
. (Join-Path $AgentDir 'agent-common.ps1')

Assert-Admin 'set-agent-key.ps1'

$envFile = Join-Path $AgentDir '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Fail '.env 파일이 없습니다. .env.example 을 .env 로 복사한 뒤 다시 실행하세요.'
    exit 1
}

# 키 입력 (화면 비표시)
$plain = $null
if ($KeyFile) {
    if (-not (Test-Path -LiteralPath $KeyFile)) { Write-Fail "키 파일을 찾을 수 없습니다: $KeyFile"; exit 1 }
    $plain = (Get-Content -LiteralPath $KeyFile -Raw -Encoding UTF8).Trim()
} else {
    $secure = Read-Host '운영 인증키(MES_AGENT_KEY)를 입력하세요 (입력 내용은 보이지 않습니다)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not $plain -or $plain.Length -lt 32 -or -not $plain.StartsWith('dwk_') -or $plain -match '\s') {
    Write-Fail '키 형식이 올바르지 않습니다 (dwk_ 로 시작하는 32자 이상 문자열). 데모 키는 사용할 수 없습니다.'
    exit 1
}

if (-not $PSCmdlet.ShouldProcess($envFile, 'MES_AGENT_KEY 갱신')) { exit 0 }

# 백업 (키/비밀번호가 들어 있으므로 동일한 접근 제한 적용)
$backup = "$envFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $envFile -Destination $backup
& icacls.exe $backup /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null

# 갱신 (키 줄만 교체, 없으면 추가). 키 값은 출력하지 않는다.
$raw = Get-Content -LiteralPath $envFile -Raw -Encoding UTF8
$newLine = "MES_AGENT_KEY=$plain"
if ($raw -match '(?m)^\s*MES_AGENT_KEY\s*=.*$') {
    $updated = [regex]::Replace($raw, '(?m)^\s*MES_AGENT_KEY\s*=.*$', { param($m) $newLine })
} else {
    $updated = $raw.TrimEnd() + "`r`n" + $newLine + "`r`n"
}
[IO.File]::WriteAllText($envFile, $updated, (New-Object Text.UTF8Encoding($false)))
$plain = $null

Write-Ok 'MES_AGENT_KEY 를 갱신했습니다 (값은 표시하지 않음).'
Write-Info "이전 .env 백업: $backup  (이전 키/비밀번호가 들어 있으니 확인 후 삭제하세요)"

if ($KeyFile -and $DeleteKeyFile) {
    Remove-Item -LiteralPath $KeyFile -Force
    Write-Ok '키 파일을 삭제했습니다.'
} elseif ($KeyFile) {
    Write-Warn "키 파일이 남아 있습니다: $KeyFile — 안전한 곳으로 옮기거나 삭제하세요."
}

if ($Restart) {
    Write-Info '에이전트를 재시작합니다...'
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    Stop-AgentProcesses $AgentDir
    Start-Sleep -Seconds 2
    if ($task) {
        if ($task.State -eq 'Disabled') { Enable-ScheduledTask -TaskName $TaskName | Out-Null }
        Start-ScheduledTask -TaskName $TaskName
        Write-Ok '재시작 요청 완료. .\check-agent.ps1 로 확인하세요.'
    } else { Write-Warn '예약 작업이 없습니다. .\install-agent.ps1 후 사용하세요.' }
} else {
    Write-Info '실행 중인 에이전트는 인증 실패 시 새 키를 자동으로 다시 읽습니다. 즉시 반영하려면 -Restart 로 다시 실행하세요.'
}
