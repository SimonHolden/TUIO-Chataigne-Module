# Send fake TUIO 1.1 from two "frames" to test the Chataigne TUIO module.
#   powershell -ExecutionPolicy Bypass -File send_test_tuio.ps1 [host] [port]
# Ctrl+C to stop.

param(
  [string]$TargetHost = "127.0.0.1",
  [int]$Port = 3333
)

$udp = New-Object System.Net.Sockets.UdpClient
$udp.Connect($TargetHost, $Port)

function Pad([byte[]]$b) {
  $len = $b.Length + (4 - ($b.Length % 4))
  $out = New-Object byte[] $len
  [Array]::Copy($b, $out, $b.Length)
  return ,$out
}

function BE([byte[]]$b) {
  if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($b) }
  return ,$b
}

function Osc-Message([string]$addr, [object[]]$oscArgs) {
  $tags = ","
  $body = New-Object System.IO.MemoryStream
  foreach ($a in $oscArgs) {
    if ($a -is [string]) {
      $tags += "s"; $b = Pad ([Text.Encoding]::ASCII.GetBytes($a))
    } elseif ($a -is [int]) {
      $tags += "i"; $b = BE ([BitConverter]::GetBytes([int32]$a))
    } else {
      $tags += "f"; $b = BE ([BitConverter]::GetBytes([single]$a))
    }
    $body.Write($b, 0, $b.Length)
  }
  $ms = New-Object System.IO.MemoryStream
  $p = Pad ([Text.Encoding]::ASCII.GetBytes($addr)); $ms.Write($p, 0, $p.Length)
  $p = Pad ([Text.Encoding]::ASCII.GetBytes($tags)); $ms.Write($p, 0, $p.Length)
  $bb = $body.ToArray(); $ms.Write($bb, 0, $bb.Length)
  return ,$ms.ToArray()
}

function Send-Bundle([object[]]$messages) {
  $ms = New-Object System.IO.MemoryStream
  $h = Pad ([Text.Encoding]::ASCII.GetBytes("#bundle")); $ms.Write($h, 0, $h.Length)
  $tt = BE ([BitConverter]::GetBytes([uint64]1)); $ms.Write($tt, 0, 8)
  foreach ($m in $messages) {
    $len = BE ([BitConverter]::GetBytes([int32]$m.Length)); $ms.Write($len, 0, 4)
    $ms.Write($m, 0, $m.Length)
  }
  $data = $ms.ToArray()
  [void]$udp.Send($data, $data.Length)
}

Write-Host "Sending TUIO 1.1 to ${TargetHost}:${Port}, Ctrl+C to stop"
$names = @("LeftBar", "RightBar")
$sids = @($null, $null)
$nextSid = 1
$fseq = 0
$sw = [Diagnostics.Stopwatch]::StartNew()

try {
  while ($true) {
    $t = $sw.Elapsed.TotalSeconds
    for ($i = 0; $i -lt 2; $i++) {
      $down = (($t + $i * 1.7) % 4) -lt 2.8
      if ($down -and $sids[$i] -eq $null) { $sids[$i] = $nextSid; $nextSid++ }
      if (-not $down) { $sids[$i] = $null }
      $fseq++
      $msgs = @()
      $msgs += ,(Osc-Message "/tuio/2Dcur" @("source", "$($names[$i])@$TargetHost"))
      if ($sids[$i] -eq $null) {
        $msgs += ,(Osc-Message "/tuio/2Dcur" @("alive"))
      } else {
        $a = $t * (1.0 + $i * 0.4)
        $x = [single](0.5 + 0.35 * [Math]::Cos($a)); $y = [single](0.5 + 0.35 * [Math]::Sin($a))
        $vx = [single](-0.35 * [Math]::Sin($a)); $vy = [single](0.35 * [Math]::Cos($a))
        $msgs += ,(Osc-Message "/tuio/2Dcur" @("alive", [int]$sids[$i]))
        $msgs += ,(Osc-Message "/tuio/2Dcur" @("set", [int]$sids[$i], $x, $y, $vx, $vy, [single]0))
      }
      $msgs += ,(Osc-Message "/tuio/2Dcur" @("fseq", [int]$fseq))
      Send-Bundle $msgs
    }
    Start-Sleep -Milliseconds 33
  }
}
finally {
  $udp.Close()
}
