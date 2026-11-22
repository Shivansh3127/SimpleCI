# ============================================================
#  SimpleCI — Fire a test webhook (simulates GitHub push)
#  Run from: d:\Projects\SimpleCI
#  Usage:    .\test-webhook.ps1
# ============================================================

$BACKEND = "http://localhost:3000"
$SECRET  = ""   # Must match GITHUB_WEBHOOK_SECRET in .env (empty = default)

# GitHub push event payload
$PAYLOAD = @{
  ref = "refs/heads/main"
  repository = @{
    name      = "SimpleCI"
    clone_url = "https://github.com/Shivansh3127/SimpleCI.git"
    owner     = @{ login = "Shivansh3127" }
  }
  head_commit = @{
    id      = "abc1234567890abcdef1234567890abcdef123456"
    message = "test: trigger pipeline via test-webhook script"
    author  = @{ name = "Shivansh"; email = "test@example.com" }
  }
  pusher = @{ name = "Shivansh3127" }
} | ConvertTo-Json -Depth 5

$BODY_BYTES = [System.Text.Encoding]::UTF8.GetBytes($PAYLOAD)

# Compute HMAC-SHA256 signature
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($SECRET)
$HASH = $hmac.ComputeHash($BODY_BYTES)
$SIG  = "sha256=" + (($HASH | ForEach-Object { $_.ToString("x2") }) -join "")

Write-Host "Payload:   $($PAYLOAD.Substring(0, [Math]::Min(120, $PAYLOAD.Length)))..." -ForegroundColor Gray
Write-Host "Signature: $SIG" -ForegroundColor Yellow
Write-Host ""
Write-Host "Firing webhook to $BACKEND/webhook/github ..." -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest `
        -Uri "$BACKEND/webhook/github" `
        -Method POST `
        -Body $BODY_BYTES `
        -ContentType "application/json" `
        -Headers @{
            "X-GitHub-Event"       = "push"
            "X-Hub-Signature-256"  = $SIG
            "X-GitHub-Delivery"    = [System.Guid]::NewGuid().ToString()
        } `
        -UseBasicParsing

    Write-Host "Response ($($response.StatusCode)):" -ForegroundColor Green
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Body: $($reader.ReadToEnd())" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Now check the dashboard: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Or poll the API:" -ForegroundColor Cyan
Write-Host "  Invoke-WebRequest http://localhost:3000/runs -UseBasicParsing | Select-Object -ExpandProperty Content" -ForegroundColor White
