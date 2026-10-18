# run-agent.ps1 — 작업 스케줄러가 호출하는 감시(래퍼) 스크립트. 직접 실행할 필요 없음.
# 에이전트(node index.js)가 비정상 종료하면 자동으로 다시 시작한다.
#   종료코드 0 = 정상 중지  → 재시작 안 함
#   종료코드 3 = 이미 실행 중 → 재시작 안 함 (중복 방지)
#   종료코드 2 = .env 설정 오류 → 60초 후 재시도 (.env 를 고치면 자동 반영)
#   그 외      = 예기치 않은 종료 → 10초 후 재시작
param(
    [string]$NodePath
)

$ErrorActionPreference = 'Continue'
$AgentDir = $PSScriptRoot
Set-Location -LiteralPath $AgentDir

$LogDir = Join-Path $AgentDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WrapperLog = Join-Path $LogDir 'wrapper.log'

function Write-Wrapper([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    try {
        # 1MB 를 넘으면 한 번 비운다(래퍼 로그는 재시작 이력만 담는다)
        if ((Test-Path -LiteralPath $WrapperLog) -and ((Get-Item -LiteralPath $WrapperLog).Length -gt 1MB)) {
            Move-Item -LiteralPath $WrapperLog -Destination ($WrapperLog + '.old') -Force
        }
        Add-Content -LiteralPath $WrapperLog -Value $line -Encoding UTF8
    } catch { }
}

function Resolve-Node {
    if ($NodePath -and (Test-Path -LiteralPath $NodePath)) { return $NodePath }
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

Write-Wrapper "래퍼 시작 (pid=$PID)"

while ($true) {
    $node = Resolve-Node
    if (-not $node) {
        Write-Wrapper 'node.exe 를 찾을 수 없습니다. 60초 후 다시 확인합니다.'
        Start-Sleep -Seconds 60
        continue
    }

    Write-Wrapper "에이전트 시작: $node index.js"
    $proc = Start-Process -FilePath $node -ArgumentList 'index.js' -WorkingDirectory $AgentDir `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput (Join-Path $LogDir 'last-stdout.log') `
        -RedirectStandardError (Join-Path $LogDir 'last-stderr.log')
    $code = if ($proc) { $proc.ExitCode } else { -1 }
    Write-Wrapper "에이전트 종료 (exit=$code)"

    switch ($code) {
        0 { Write-Wrapper '정상 종료 — 재시작하지 않습니다.'; exit 0 }
        3 { Write-Wrapper '이미 다른 에이전트가 실행 중 — 재시작하지 않습니다.'; exit 3 }
        2 { Start-Sleep -Seconds 60 }
        default { Start-Sleep -Seconds 10 }
    }
}
