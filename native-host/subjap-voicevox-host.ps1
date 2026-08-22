param(
  [Parameter(Mandatory = $true)]
  [string]$VoicevoxPath
)

$ErrorActionPreference = "Stop"
$inputStream = [Console]::OpenStandardInput()
$outputStream = [Console]::OpenStandardOutput()

function Read-ExactBytes([System.IO.Stream]$stream, [int]$count) {
  $bytes = New-Object byte[] $count
  $offset = 0
  while ($offset -lt $count) {
    $read = $stream.Read($bytes, $offset, $count - $offset)
    if ($read -le 0) { return $null }
    $offset += $read
  }
  return ,$bytes
}

function Read-NativeMessage {
  $lengthBytes = Read-ExactBytes $inputStream 4
  if ($null -eq $lengthBytes) { return $null }
  $length = [BitConverter]::ToInt32($lengthBytes, 0)
  if ($length -le 0 -or $length -gt 1048576) {
    throw "Invalid native message length: $length"
  }
  $payload = Read-ExactBytes $inputStream $length
  if ($null -eq $payload) { return $null }
  return [Text.Encoding]::UTF8.GetString($payload) | ConvertFrom-Json
}

function Write-NativeMessage($value) {
  $json = $value | ConvertTo-Json -Compress -Depth 5
  $payload = [Text.Encoding]::UTF8.GetBytes($json)
  $length = [BitConverter]::GetBytes([int]$payload.Length)
  $outputStream.Write($length, 0, 4)
  $outputStream.Write($payload, 0, $payload.Length)
  $outputStream.Flush()
}

function Test-Voicevox {
  try {
    $null = Invoke-WebRequest `
      -Uri "http://127.0.0.1:50021/version" `
      -UseBasicParsing `
      -TimeoutSec 1
    return $true
  } catch {
    return $false
  }
}

function Ensure-Voicevox {
  if (-not (Test-Voicevox)) {
    if (-not (Test-Path -LiteralPath $VoicevoxPath -PathType Leaf)) {
      throw "VOICEVOX engine not found: $VoicevoxPath"
    }
    Start-Process -FilePath $VoicevoxPath -WindowStyle Hidden | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
      if (Test-Voicevox) { return }
      Start-Sleep -Milliseconds 250
    }
    throw "VOICEVOX did not become ready on http://127.0.0.1:50021"
  }
}

while ($true) {
  $message = Read-NativeMessage
  if ($null -eq $message) { break }

  try {
    if ($message.action -eq "ensure-running") {
      Ensure-Voicevox
      Write-NativeMessage @{ ok = $true }
    } else {
      throw "Unknown action: $($message.action)"
    }
  } catch {
    Write-NativeMessage @{ ok = $false; error = $_.Exception.Message }
  }
}
