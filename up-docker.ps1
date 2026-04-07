$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Building and recreating server (required to see client changes)..."
docker compose up -d --build --force-recreate server
Write-Host ""
Write-Host "Open http://localhost:3000 - rotlands-server:latest and :local now share the same image ID."
Write-Host "If that timestamp never changes after code edits, run this script again."
docker compose ps
