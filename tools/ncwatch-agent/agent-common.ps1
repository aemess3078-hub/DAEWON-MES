# agent-common.ps1 — install/uninstall/start/stop/check 스크립트가 공유하는 함수 (직접 실행하지 않음)

$script:TaskNameDefault = 'DaewonNCWatchAgent'

# -WhatIf 로 실행해도 모듈 자동 로드 시 "별칭 설정" 안내가 쏟아지지 않도록, WhatIf 를 잠시 끄고 필요한 모듈을 미리 불러온다.
$script:SavedWhatIf = $WhatIfPreference
$WhatIfPreference = $false
Import-Module CimCmdlets -ErrorAction SilentlyContinue
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
$WhatIfPreference = $script:SavedWhatIf

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin([string]$ScriptName) {
    if (-not (Test-IsAdmin)) {
        Write-Host "[오류] $ScriptName 는 관리자 권한이 필요합니다." -ForegroundColor Red
        Write-Host '       PowerShell 을 "관리자 권한으로 실행" 한 뒤 다시 실행하세요.' -ForegroundColor Red
        exit 1
    }
}

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "  [주의] $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "  [실패] $Text" -ForegroundColor Red }
function Write-Info([string]$Text) { Write-Host "         $Text" }

function Confirm-Proceed([switch]$Yes, [string]$Question = '진행하시겠습니까?') {
    if ($Yes) { return $true }
    $answer = Read-Host "$Question (y/N)"
    return ($answer -match '^(y|yes|예|ㅛ)$')
}

function Find-NodeExe([string]$Preferred) {
    if ($Preferred) {
        if (Test-Path -LiteralPath $Preferred) { return (Resolve-Path -LiteralPath $Preferred).Path }
        return $null
    }
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    return $null
}

# 이 에이전트 폴더의 index.js 를 실행 중인 node.exe 프로세스 목록 (다른 폴더의 node 는 건드리지 않는다)
# 판별: 명령줄에 이 폴더가 있거나, 부모(래퍼 run-agent.ps1)의 명령줄에 이 폴더가 있는 node.exe + index.js
function Get-AgentNodeProcesses([string]$AgentDir) {
    $needle = $AgentDir.TrimEnd('\').ToLowerInvariant()
    $result = @()
    try {
        $all = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop
    } catch { return @() }
    foreach ($p in $all) {
        $cmd = ([string]$p.CommandLine).ToLowerInvariant()
        if (-not $cmd.Contains('index.js')) { continue }
        $parentCmd = ''
        try {
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction Stop
            if ($parent) { $parentCmd = ([string]$parent.CommandLine).ToLowerInvariant() }
        } catch { }
        if ($cmd.Contains($needle) -or $parentCmd.Contains($needle)) { $result += $p }
    }
    return $result
}

# 에이전트가 쥐고 있는 중복 방지 잠금 포트(127.0.0.1)가 열려 있으면 어딘가에서 에이전트가 실행 중이다.
function Test-AgentLockPort([string]$AgentDir) {
    $port = 47831
    $envFile = Join-Path $AgentDir '.env'
    if (Test-Path -LiteralPath $envFile) {
        $line = Select-String -LiteralPath $envFile -Pattern '^\s*AGENT_LOCK_PORT\s*=\s*(\d+)' | Select-Object -First 1
        if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
    }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(500) -and $client.Connected) { return $true }
        return $false
    } catch { return $false } finally { $client.Close() }
}

# 이 에이전트 폴더의 run-agent.ps1 래퍼 프로세스 목록
function Get-AgentWrapperProcesses([string]$AgentDir) {
    $needle = (Join-Path $AgentDir 'run-agent.ps1').ToLowerInvariant()
    $result = @()
    try {
        $all = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
    } catch { return @() }
    foreach ($p in $all) {
        if (([string]$p.CommandLine).ToLowerInvariant().Contains($needle)) { $result += $p }
    }
    return $result
}

function Stop-AgentProcesses([string]$AgentDir) {
    # 래퍼를 먼저 종료해 재시작을 막고, 그 다음 node 를 종료한다.
    foreach ($p in (Get-AgentWrapperProcesses $AgentDir)) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Info "래퍼 종료 (pid=$($p.ProcessId))" } catch { }
    }
    foreach ($p in (Get-AgentNodeProcesses $AgentDir)) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Info "에이전트 종료 (pid=$($p.ProcessId))" } catch { }
    }
}

function Read-AgentState([string]$AgentDir) {
    $file = Join-Path $AgentDir 'state\agent-status.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# ConvertFrom-Json(5.1) 이 ISO 문자열을 DateTime 으로 바꾸는 경우와 문자열로 남는 경우를 모두 처리
function ConvertTo-AgeSeconds($Value) {
    if (-not $Value) { return $null }
    try {
        if ($Value -is [DateTime]) { $utc = $Value.ToUniversalTime() }
        else { $utc = ([DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)).UtcDateTime }
        return [int]((Get-Date).ToUniversalTime() - $utc).TotalSeconds
    } catch { return $null }
}

function Format-Age($Seconds) {
    if ($null -eq $Seconds) { return '-' }
    if ($Seconds -lt 120) { return "${Seconds}초 전" }
    if ($Seconds -lt 7200) { return "$([int]($Seconds / 60))분 전" }
    return "$([int]($Seconds / 3600))시간 전"
}
