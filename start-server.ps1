$ErrorActionPreference = "Stop"

$python = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "Python が見つかりません。README.md の方法で起動してください。"
  exit 1
}

Set-Location -LiteralPath $PSScriptRoot
Write-Host "HAPICHIKE を起動します。"
Write-Host "ブラウザで http://localhost:8000/ を開いてください。"
& $python -m http.server 8000
