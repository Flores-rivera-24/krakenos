# Prueba del instalador de Windows en `windows-latest`: una función por fase; cada tarea añade la suya.
# Uso: pwsh scripts/installer-smoke-windows.ps1 -Setup <KrakenOS-Setup-x64.exe>
param([Parameter(Mandatory)][string]$Setup)
$ErrorActionPreference = 'Stop'

function Assert([bool]$Cond, [string]$Msg) {
  if (-not $Cond) { Write-Host "::error::FALLO: $Msg"; exit 1 }
  Write-Host "ok: $Msg"
}

function Get-DirMb([string]$Path) {
  [math]::Round((Get-ChildItem -LiteralPath $Path -Recurse -Force -File | Measure-Object Length -Sum).Sum / 1MB, 1)
}

# Fase 0: el hook elevado ejecuta node.exe de $INSTDIR, así que fuera de Program Files el instalador
# tiene que negarse (con `/D=` en silencio) y no dejar nada instalado.
function Phase-RejectOutsideProgramFiles {
  Write-Host "== Phase-RejectOutsideProgramFiles"
  $malos = @(
    'C:\KrakenOS-fuera\KrakenOS',
    "$($env:ProgramFiles) Evil\KrakenOS",
    "$($env:ProgramFiles)\..\KrakenOS-fuera2\KrakenOS"
  )
  foreach ($d in $malos) {
    # `/D=` va el último y sin comillas (convención de NSIS); la ruta puede llevar espacios.
    $p = Start-Process -FilePath $Setup -ArgumentList "/S /D=$d" -Wait -PassThru
    Write-Host ("  /D={0} -> exit {1}" -f $d, $p.ExitCode)
    Assert ($p.ExitCode -ne 0) "el instalador rechaza /D=$d"
    Assert (-not (Test-Path (Join-Path $d 'node\node.exe'))) "no se instaló node.exe en $d"
    Assert (-not (Test-Path (Join-Path $d 'krakenos-window.exe'))) "no se instaló la ventana en $d"
  }
  Assert (-not (Test-Path (Join-Path $env:ProgramFiles 'KrakenOS'))) 'Program Files\KrakenOS no existe tras los rechazos'
}

# Fase 1: instalar en silencio y comprobar que el paquete (con sus junctions de pnpm) sobrevive.
function Phase-Install {
  Write-Host "== Phase-Install"
  Write-Host ("instalador: {0} MB" -f [math]::Round((Get-Item $Setup).Length / 1MB, 1))
  $t = Measure-Command { $p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru }
  Write-Host ("instalar /S: {0:N1} s, exit {1}" -f $t.TotalSeconds, $p.ExitCode)
  Assert ($p.ExitCode -eq 0) 'el instalador /S sale con 0'

  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  Get-ChildItem $dir -Force | ForEach-Object { Write-Host ("  {0}" -f $_.Name) }
  Write-Host ("Program Files\KrakenOS: {0} MB" -f (Get-DirMb $dir))
  Assert (Test-Path (Join-Path $dir 'krakenos-window.exe')) 'existe krakenos-window.exe'
  Assert (Test-Path (Join-Path $dir 'node\node.exe')) 'existe node\node.exe'
  Assert (Test-Path (Join-Path $dir 'app\agent\dist\index.js')) 'existe app\agent\dist\index.js'

  # Medida: ¿qué son los enlaces de node_modules tras instalar? (junction que sigue vivo o copia)
  $nm = Join-Path $dir 'app\agent\node_modules'
  $enlaces = @(Get-ChildItem $nm -Force -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.LinkType })
  Write-Host ("enlaces (junction/symlink) en app\agent\node_modules: {0}" -f $enlaces.Count)
  $enlaces | Select-Object -First 3 | ForEach-Object { Write-Host ("  {0} -> {1} [{2}]" -f $_.FullName, ($_.Target -join ','), $_.LinkType) }

  $nmTop = Get-ChildItem $nm -Force | ForEach-Object { $_.Name }
  Write-Host ("node_modules de primer nivel instalado: {0}" -f ($nmTop -join ' '))
  Assert ($enlaces.Count -gt 0) 'el hook POSTINSTALL rehízo los enlaces de node_modules'
  Assert (Test-Path (Join-Path $nm 'better-sqlite3')) 'node_modules\better-sqlite3 existe tras instalar'
  $largo = (Get-ChildItem $dir -Recurse -Force -File | ForEach-Object { $_.FullName.Length } | Measure-Object -Maximum).Maximum
  Write-Host ("ruta instalada más larga: {0} caracteres (límite 259)" -f $largo)
  Assert ($largo -le 259) 'ninguna ruta instalada pasa de MAX_PATH'
  Push-Location (Join-Path $dir 'app\agent')
  try { & (Join-Path $dir 'node\node.exe') -e "require('better-sqlite3'); console.log('better-sqlite3 carga')" }
  finally { Pop-Location }
  Assert ($LASTEXITCODE -eq 0) "require('better-sqlite3') con el Node instalado"

  # Arranque a mano como krakenos.cmd (primer arranque y agente), con datos temporales.
  $datos = Join-Path $env:RUNNER_TEMP 'krakenos-datos'
  New-Item -ItemType Directory -Force $datos | Out-Null
  $env:KRAKENOS_DATA_DIR = $datos
  $env:KRAKENOS_APP_DIR = Join-Path $dir 'app\agent'
  $env:KRAKENOS_DEPLOY_MODE = 'package'
  $env:NODE_ENV = 'production'
  $env:PORT = '3011'
  $env:HOST = '127.0.0.1'
  $node = Join-Path $dir 'node\node.exe'
  Push-Location $datos
  try {
    & $node (Join-Path $dir 'app\first-run.mjs')
    Assert ($LASTEXITCODE -eq 0) 'first-run.mjs sale con 0'
    $agente = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f (Join-Path $dir 'app\agent\dist\index.js')) `
      -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $datos 'out.log') -RedirectStandardError (Join-Path $datos 'err.log')
  } finally { Pop-Location }
  $listo = $false
  for ($i = 0; $i -lt 60 -and -not $listo; $i++) {
    Start-Sleep -Seconds 1
    try { $listo = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3011/health/ready').StatusCode -eq 200 } catch { }
  }
  if (-not $listo) { Get-Content (Join-Path $datos 'out.log'), (Join-Path $datos 'err.log') -Tail 40 }
  Stop-Process -Id $agente.Id -Force -ErrorAction SilentlyContinue
  Assert $listo '/health/ready da 200 con el agente instalado (las junctions sobreviven)'
}

# Fase 2 (spike de la Task 2): ¿con qué cuenta corre el servicio y llega Ctrl+C al agente al pararlo?
# Mide, no afirma: el resultado decide la Task 3 y va a «Resultados del spike» del plan. Solo la
# arrancada (`/health/ready`) es una aserción; lo demás se imprime con el prefijo SPIKE.
$script:Spike = @()
function Note([string]$Cuenta, [string]$Clave, $Valor) {
  Write-Host ("SPIKE [{0}] {1}: {2}" -f $Cuenta, $Clave, $Valor)
  $script:Spike += [pscustomobject]@{ Cuenta = $Cuenta; Clave = $Clave; Valor = "$Valor" }
}

function Test-ServiceAccount([string]$Cuenta, [string]$Servicio = 'KrakenOS') {
  Write-Host "== Test-ServiceAccount $Cuenta"
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  $exe = Join-Path $dir 'service\KrakenOS-service.exe'
  $node = Join-Path $dir 'node\node.exe'
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  Assert (Test-Path $exe) 'existe service\KrakenOS-service.exe en la instalación'
  Assert (Test-Path (Join-Path $dir 'service\KrakenOS-service.xml')) 'existe service\KrakenOS-service.xml'

  foreach ($v in 'KRAKENOS_DATA_DIR', 'KRAKENOS_APP_DIR', 'KRAKENOS_DEPLOY_MODE', 'NODE_ENV', 'PORT', 'HOST') { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
  Remove-Item $datos -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $datos | Out-Null
  $env:KRAKENOS_DATA_DIR = $datos
  $env:KRAKENOS_APP_DIR = Join-Path $dir 'app\agent'
  $env:NODE_ENV = 'production'
  Push-Location $datos
  try { & $node (Join-Path $dir 'app\first-run.mjs') | Out-Host } finally { Pop-Location }
  Assert ($LASTEXITCODE -eq 0) 'first-run.mjs prepara los datos del servicio'

  $listo = $false
  & $exe install | Out-Host
  Assert ($LASTEXITCODE -eq 0) 'WinSW instala el servicio'
  try {
    & sc.exe config $Servicio obj= $Cuenta | Out-Host
    Note $Cuenta 'sc config obj' $LASTEXITCODE
    & sc.exe sidtype $Servicio unrestricted | Out-Host
    Note $Cuenta 'sc sidtype unrestricted' $LASTEXITCODE
    & icacls $datos /grant "${Cuenta}:(OI)(CI)M" | Out-Host
    Note $Cuenta 'icacls grant Modificar' $LASTEXITCODE
    & sc.exe qc $Servicio | Out-Host

    & sc.exe start $Servicio | Out-Host
    for ($i = 0; $i -lt 60 -and -not $listo; $i++) {
      Start-Sleep -Seconds 1
      try { $listo = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3001/health/ready').StatusCode -eq 200 } catch { }
    }
    Note $Cuenta 'arranca (/health/ready 200)' $listo
    $proc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node }
    foreach ($pr in $proc) {
      $o = Invoke-CimMethod -InputObject $pr -MethodName GetOwner
      Note $Cuenta 'propietario de node.exe' ("{0}\{1}" -f $o.Domain, $o.User)
    }
    Get-ChildItem $datos -Recurse -Force -File | ForEach-Object { Write-Host ("  datos: {0}" -f $_.FullName.Substring($datos.Length)) }

    if ($listo) {
      $t = Measure-Command {
        & sc.exe stop $Servicio | Out-Host
        for ($i = 0; $i -lt 60; $i++) {
          $st = (Get-Service $Servicio).Status
          if ($st -eq 'Stopped') { break }
          Start-Sleep -Milliseconds 250
        }
      }
      Note $Cuenta 'estado tras parar' (Get-Service $Servicio).Status
      Note $Cuenta 'segundos en parar' ([math]::Round($t.TotalSeconds, 1))
      Start-Sleep -Seconds 1
      $vivo = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node })
      Note $Cuenta 'node.exe vivo tras parar' $vivo.Count
      $logs = Join-Path $datos 'logs'
      if (Test-Path $logs) { Get-ChildItem $logs | ForEach-Object { Write-Host ("  log: {0} ({1} B)" -f $_.Name, $_.Length) } }
      $texto = ''
      if (Test-Path $logs) { $texto = (Get-ChildItem $logs -File | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n" }
      Note $Cuenta 'log dice "Recibido SIGINT"' ($texto -match 'Recibido SIGINT')
      Note $Cuenta 'log dice "Recibido SIG..."' (([regex]::Matches($texto, 'Recibido SIG\w+')).Value -join ',')
      $wal = @(Get-ChildItem $datos -Recurse -Force -File | Where-Object { $_.Name -match '-(wal|shm)$' })
      Note $Cuenta 'ficheros -wal/-shm tras parar' $wal.Count
      Write-Host '--- cola de los logs'
      if (Test-Path $logs) { Get-ChildItem $logs -File | ForEach-Object { Write-Host ("[{0}]" -f $_.Name); Get-Content $_.FullName -Tail 12 } }
    } else {
      if (Test-Path (Join-Path $datos 'logs')) { Get-ChildItem (Join-Path $datos 'logs') -File | ForEach-Object { Write-Host ("[{0}]" -f $_.Name); Get-Content $_.FullName -Tail 30 } }
      Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager' } -MaxEvents 6 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_.Message }
    }
  } finally {
    & sc.exe stop $Servicio 2>$null | Out-Null
    Start-Sleep -Seconds 2
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    & $exe uninstall | Out-Host
  }
  $script:Listo = $listo
}

function Phase-ServiceAccountSpike {
  Write-Host "== Phase-ServiceAccountSpike"
  Test-ServiceAccount 'NT SERVICE\KrakenOS'; $virtual = $script:Listo
  Test-ServiceAccount 'NT AUTHORITY\LocalService'; $local = $script:Listo
  Write-Host '=== SPIKE RESUMEN'
  $script:Spike | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
  Assert ($virtual -or $local) 'el servicio arranca con al menos una de las dos cuentas'
  Remove-Item (Join-Path $env:ProgramData 'KrakenOS') -Recurse -Force -ErrorAction SilentlyContinue
}

Phase-RejectOutsideProgramFiles
Phase-Install
Phase-ServiceAccountSpike
Write-Host 'Todas las fases en verde'
