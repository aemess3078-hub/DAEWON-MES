<#
.SYNOPSIS
  현장 PC 로 복사할 배포 패키지(zip)를 만든다. 개발 PC 에서 실행 (관리자 권한 불필요).

.DESCRIPTION
  포함: 소스, *.ps1, .env.example, README, node_modules(pg, 운영 의존성만)
  제외: .env 및 .env.bak*, logs\, state\, dist\, 개발용 test\  → 비밀정보/로컬 상태가 들어가지 않는다.
  마지막에 패키지 안을 검사해 키/비밀번호 형태의 문자열이 있으면 실패 처리한다.

.EXAMPLE
  .\make-package.ps1
#>
[CmdletBinding()]
param(
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $AgentDir 'dist' }
$pkg = Get-Content -LiteralPath (Join-Path $AgentDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$name = "ncwatch-agent-v$($pkg.version)"

$stage = Join-Path ([IO.Path]::GetTempPath()) ("$name-" + [Guid]::NewGuid().ToString('N'))
$target = Join-Path $stage 'ncwatch-agent'
New-Item -ItemType Directory -Force -Path $target | Out-Null

try {
    # 운영 의존성만 설치된 node_modules 를 스테이징에서 새로 만든다(개발 PC 의 잔여물 방지).
    $items = @('index.js', 'check-connection.js', 'list-machines.js', 'package.json', 'package-lock.json', 'README.md', '.env.example') +
        (Get-ChildItem -LiteralPath $AgentDir -Filter '*.ps1' | Where-Object { $_.Name -ne 'make-package.ps1' } | ForEach-Object { $_.Name })
    foreach ($i in $items) {
        $src = Join-Path $AgentDir $i
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $target }
    }
    Copy-Item -LiteralPath (Join-Path $AgentDir 'src') -Destination $target -Recurse

    Push-Location $target
    try {
        & npm.cmd install --omit=dev --no-audit --no-fund | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'npm install 실패' }
    } finally { Pop-Location }

    # 비밀정보 검사
    $bad = @()
    Get-ChildItem -LiteralPath $target -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' } | ForEach-Object {
        if ($_.Name -eq '.env' -or $_.Name -like '.env.bak*') { $bad += "비밀 파일: $($_.FullName)" }
        $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
        if ($text -match 'dwk_[A-Za-z0-9_-]{20,}' -or $text -match 'ncwatch!') { $bad += "비밀 형태 문자열: $($_.Name)" }
    }
    if ($bad.Count -gt 0) { $bad | ForEach-Object { Write-Host $_ -ForegroundColor Red }; throw '패키지에 비밀정보가 포함되어 중단했습니다.' }

    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $zip = Join-Path $OutDir "$name.zip"
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    # 항목 이름을 슬래시(/)로 직접 지정해 표준 zip 을 만든다 (Compress-Archive/ZipFile 은 5.1 환경에서 역슬래시 경로를 만들 수 있다)
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $fileStream = [IO.File]::Open($zip, [IO.FileMode]::Create)
    $archive = New-Object IO.Compression.ZipArchive($fileStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object {
            $entryName = $_.FullName.Substring($stage.Length + 1).Replace([string][char]92, '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $archive.Dispose(); $fileStream.Dispose() }
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    Write-Host "패키지 생성: $zip"
    Write-Host "SHA256   : $hash"
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
