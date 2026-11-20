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
  # Puerto ocupado a mano (en el PC del dueño lo ocupa la WSL): el instalador tiene que subir en 3002.
  $bloqueo = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, 3001)
  $bloqueo.Start()
  try {
    $t = Measure-Command { $p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru }
  } finally { $bloqueo.Stop() }
  Write-Host ("instalar /S: {0:N1} s, exit {1}" -f $t.TotalSeconds, $p.ExitCode)
  if ($p.ExitCode -ne 0) {
    # En silencio no se ve la salida del hook: se repite a mano para tener el motivo en el log de CI.
    $d = Join-Path $env:ProgramFiles 'KrakenOS'
    Write-Host '--- post-install.mjs install, a mano'
    & (Join-Path $d 'node\node.exe') (Join-Path $d 'installer\post-install.mjs') install --lang es 2>&1 | Out-Host
    Write-Host ("  exit {0}" -f $LASTEXITCODE)
    $lg = Join-Path $env:ProgramData 'KrakenOS\logs'
    if (Test-Path $lg) { Get-ChildItem $lg -File | ForEach-Object { Write-Host ("[{0}]" -f $_.Name); Get-Content $_.FullName -Tail 20 } }
  }
  Assert ($p.ExitCode -eq 0) 'el instalador /S sale con 0 (crea datos, servicio y lo arranca)'

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

# Fase 2: el servicio que dejó el instalador (Task 3): datos con ACL, puerto elegido, arranque, reinicio
# tras morir y parada limpia (la aserción de Ctrl+C que midió el spike de la Task 2).
function Wait-Health([int]$Port, [int]$Segundos) {
  for ($i = 0; $i -lt $Segundos; $i++) {
    try { if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health/ready").StatusCode -eq 200) { return $true } } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Get-AgentNode([string]$Node) {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $Node })
}

function Get-LogText([string]$Datos) {
  $logs = Join-Path $Datos 'logs'
  if (-not (Test-Path $logs)) { return '' }
  (Get-ChildItem $logs -File | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
}

function Phase-Service {
  Write-Host "== Phase-Service"
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  $node = Join-Path $dir 'node\node.exe'
  $datos = Join-Path $env:ProgramData 'KrakenOS'

  # Puerto: 3001 estaba ocupado al instalar, así que el .env y el XML dicen 3002.
  $port = [int](Select-String -Path (Join-Path $datos '.env') -Pattern '^PORT=(\d+)\s*$').Matches.Groups[1].Value
  Assert ($port -eq 3002) "con 3001 ocupado el instalador eligió el 3002 (.env: PORT=$port)"
  Assert ((Get-Content (Join-Path $dir 'service\KrakenOS-service.xml') -Raw) -match 'name="PORT" value="3002"') 'el XML del servicio lleva PORT=3002'
  Assert ((Select-String -Path (Join-Path $datos '.env') -Pattern '^HOST=0\.0\.0\.0\s*$').Matches.Count -eq 1) 'el .env abre HOST a la LAN'

  $svc = Get-Service KrakenOS
  Assert ($svc.Status -eq 'Running') 'el servicio KrakenOS está Running'
  Assert ($svc.StartType -eq 'Automatic') 'StartType Automatic'
  Assert ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\KrakenOS').DelayedAutostart -eq 1) 'arranque automático retrasado'
  $fail = (& sc.exe qfailure KrakenOS) -join "`n"
  Write-Host $fail
  Assert ($fail -match 'RESTART') 'sc qfailure muestra la acción restart'
  Assert (Wait-Health $port 5) "/health/ready da 200 en el puerto $port"

  # Cuenta virtual: el SID calculado por el instalador es el que Windows le da al servicio.
  $real = (New-Object System.Security.Principal.NTAccount('NT SERVICE\KrakenOS')).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $calc = & $node -e "import('node:url').then(u => import(u.pathToFileURL(process.argv[1]).href)).then(m => console.log(m.virtualAccountSid('KrakenOS')))" (Join-Path $dir 'installer\steps.mjs')
  Assert ($calc -eq $real) "el SID calculado ($calc) es el del servicio ($real)"
  $o = Get-AgentNode $node | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName GetOwner }
  Assert (($o | Where-Object { $_.User -eq 'KrakenOS' }).Count -ge 1) 'node.exe corre como NT SERVICE\KrakenOS'

  # ACL leída de vuelta.
  $raiz = (& icacls $datos) -join "`n"
  Write-Host $raiz
  Assert ($raiz -notmatch 'BUILTIN\\Users|Everyone|Authenticated Users') 'Users/Everyone sin acceso a la raíz de datos'
  Assert ($raiz -match 'NT SERVICE\\KrakenOS:\(OI\)\(CI\)\(M\)') 'el servicio tiene Modificar en la raíz'
  Assert ($raiz -match 'NT AUTHORITY\\SYSTEM:\(OI\)\(CI\)\(F\)') 'SYSTEM tiene Control total'
  Assert ($raiz -match 'BUILTIN\\Administrators:\(OI\)\(CI\)\(F\)') 'Administradores tienen Control total'
  $ca = (& icacls (Join-Path $datos 'ca')) -join "`n"
  Write-Host $ca
  Assert ($ca -notmatch 'KrakenOS:|Users') 'ca\ solo para SYSTEM y Administradores'
  $tls = (& icacls (Join-Path $datos 'tls')) -join "`n"
  Write-Host $tls
  Assert ($tls -match 'NT SERVICE\\KrakenOS:\(OI\)\(CI\)\(RX\)') 'tls\ da al servicio solo lectura y ejecución'
  foreach ($f in '.env', 'keys\jwt-private.pem', 'setup-token') {
    $r = Join-Path $datos $f
    if (Test-Path $r) {
      $a = (& icacls $r) -join "`n"
      Assert ($a -notmatch 'BUILTIN\\Users|Everyone|Authenticated Users') "$f no es legible por Users"
    } else { Write-Host "(sin ${f}: no aplica)" }
  }

  # Matar el node.exe del servicio: vuelve a Running en menos de 60 s.
  $viejo = (Get-AgentNode $node)[0].ProcessId
  & taskkill /F /PID $viejo | Out-Host
  $t = [Diagnostics.Stopwatch]::StartNew()
  $volvio = $false
  while ($t.Elapsed.TotalSeconds -lt 60 -and -not $volvio) {
    Start-Sleep -Seconds 2
    $n = @(Get-AgentNode $node)
    $volvio = ((Get-Service KrakenOS).Status -eq 'Running') -and $n.Count -gt 0 -and $n[0].ProcessId -ne $viejo -and (Wait-Health $port 1)
  }
  Write-Host ("reinicio tras matar node.exe: {0:N1} s" -f $t.Elapsed.TotalSeconds)
  if (-not $volvio) { (Get-ChildItem (Join-Path $datos 'logs') -File | ForEach-Object { Get-Content $_.FullName -Tail 15 }) }
  Assert $volvio 'matado node.exe, el servicio vuelve a Running con /health/ready en menos de 60 s'

  Restart-Service KrakenOS
  Assert ((Get-Service KrakenOS).Status -eq 'Running') 'Restart-Service deja Running'
  Assert (Wait-Health $port 60) '/health/ready tras Restart-Service'

  # Parada limpia: SIGINT en el log, salida dentro de stoptimeout (20 s), sin node.exe ni -wal/-shm.
  $antes = ([regex]::Matches((Get-LogText $datos), 'Recibido SIGINT')).Count
  $t = Measure-Command { Stop-Service KrakenOS }
  Write-Host ("Stop-Service: {0:N1} s" -f $t.TotalSeconds)
  Assert ((Get-Service KrakenOS).Status -eq 'Stopped') 'Stop-Service deja Stopped'
  Assert ($t.TotalSeconds -lt 20) 'el servicio sale dentro de stoptimeout (20 s)'
  Start-Sleep -Seconds 1
  Assert ((Get-AgentNode $node).Count -eq 0) 'no queda ningún node.exe del servicio'
  $despues = ([regex]::Matches((Get-LogText $datos), 'Recibido SIGINT')).Count
  Assert ($despues -gt $antes) 'el log del agente trae «Recibido SIGINT» de esta parada'
  $wal = @(Get-ChildItem $datos -Recurse -Force -File | Where-Object { $_.Name -match '-(wal|shm)$' })
  Assert ($wal.Count -eq 0) 'sin ficheros -wal/-shm tras parar'

  Start-Service KrakenOS
  Assert (Wait-Health $port 60) 'el servicio vuelve a arrancar tras la parada'
}

Phase-RejectOutsideProgramFiles
Phase-Install
Phase-Service
Write-Host 'Todas las fases en verde'
