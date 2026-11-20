# Prueba del instalador de Windows en `windows-latest`: una función por fase; cada tarea añade la suya.
# Uso: pwsh scripts/installer-smoke-windows.ps1 -Setup <KrakenOS-Setup-x64.exe>
param([Parameter(Mandatory)][string]$Setup)
$ErrorActionPreference = 'Stop'

function Assert([bool]$Cond, [string]$Msg) {
  if (-not $Cond) { Write-Host "::error::FALLO: $Msg"; exit 1 }
  Write-Host "ok: $Msg"
}

# El agente escribe el token de setup de tres formas (`/setup?token=...`, el QR y `(token de configuración: ...)`):
# nada de eso llega al log de CI. Esta función es pura para poder probarla sin un run rojo.
function Select-SafeLines([string[]]$Lines, [string]$Secret) {
  $Lines | Where-Object { $_ -notmatch '[\u2580-\u259F]|[^\x20-\x7E]{3,}|/setup|token de config' } |
    ForEach-Object {
      $l = $_ -replace 'token=[^\s&"''<>]+', 'token=<redactado>'
      if ($Secret) { $l = $l.Replace($Secret, '<redactado>') }
      $l
    }
}

# Lee el setup-token (el smoke corre elevado), lo enmascara en el log de CI y devuelve su valor para redactarlo.
function Register-SetupToken([string[]]$Dirs) {
  foreach ($d in $Dirs) {
    $f = Join-Path $d 'setup-token'
    if (-not (Test-Path $f)) { continue }
    $v = (Get-Content $f -Raw -ErrorAction SilentlyContinue)
    if ($v) { $v = $v.Trim(); if ($v) { Write-Host "::add-mask::$v"; return $v } }
  }
  return ''
}

# Prueba de la función con las tres formas y un valor suelto; falla si sale el valor.
function Test-SelectSafeLines {
  $v = 'TOKENdePrueba0123456789abcdef'
  $muestra = @(
    "[setup] Abre http://192.168.1.5:3001/setup?token=$v",
    "algo token=$v mas",
    '[setup] O escanea: ',
    "$([char]0x2588)$([char]0x2580)$([char]0x2584)$([char]0x2588)",
    "[setup] (token de configuración: $v)",
    "[setup] (token de configuraci$([char]0xC3)$([char]0xB3)n: $v)",
    "valor suelto $v",
    'linea inocente que debe sobrevivir'
  )
  $salida = (Select-SafeLines $muestra $v) -join "`n"
  Assert (-not $salida.Contains($v)) 'el filtro del diagnóstico no deja pasar el token en ninguna de sus formas'
  # Sin el valor conocido (el diagnóstico corre antes de que exista el fichero) también tienen que caer las tres formas.
  $sinValor = (Select-SafeLines ($muestra | Where-Object { $_ -notmatch 'suelto' }) '') -join "`n"
  Assert (-not $sinValor.Contains($v)) 'el filtro quita las tres formas del token aunque no conozca su valor'
  Assert ($salida.Contains('linea inocente')) 'el filtro del diagnóstico conserva las líneas normales'
}

# Antes de volcar nada: si ya existe un setup-token, su valor se oculta en TODO el log de CI.
function Show-SafeTail([string[]]$Paths, [int]$Tail) {
  $dirs = @(Join-Path $env:ProgramData 'KrakenOS') + @($Paths | ForEach-Object { Split-Path $_ -Parent; Split-Path (Split-Path $_ -Parent) -Parent })
  $secreto = Register-SetupToken $dirs
  foreach ($f in $Paths) {
    if (-not (Test-Path $f)) { continue }
    Write-Host ("[{0}]" -f (Split-Path $f -Leaf))
    Select-SafeLines (Get-Content $f -Tail $Tail) $secreto | Out-Host
  }
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
    $e = Join-Path $d 'install-error.log'
    if (Test-Path $e) { Write-Host '--- install-error.log'; Get-Content $e | Out-Host }
    $lg = Join-Path $env:ProgramData 'KrakenOS\logs'
    if (Test-Path $lg) { Show-SafeTail @(Get-ChildItem $lg -File | ForEach-Object FullName) 20 }
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
  if (-not $listo) { Show-SafeTail @((Join-Path $datos 'out.log'), (Join-Path $datos 'err.log')) 40 }
  Stop-Process -Id $agente.Id -Force -ErrorAction SilentlyContinue
  Assert $listo '/health/ready da 200 con el agente instalado (las junctions sobreviven)'
}

# Fase 1b: una carpeta de datos con una junction (la crea cualquiera en ProgramData) la rechaza el paso
# de datos del instalador y NO deja la marca de HKLM. Se prueba con el post-install instalado y un
# ProgramData falso solo para ese proceso: el despliegue real de la fase anterior no se toca.
function Phase-RejectPlantedDataDir {
  Write-Host "== Phase-RejectPlantedDataDir"
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  $node = Join-Path $dir 'node\node.exe'
  $script = Join-Path $dir 'installer\post-install.mjs'
  $base = Join-Path $env:RUNNER_TEMP 'pd-falso'
  $ajeno = Join-Path $env:RUNNER_TEMP 'destino-ajeno'
  Remove-Item $base, $ajeno -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force (Join-Path $base 'KrakenOS'), $ajeno | Out-Null
  $original = $env:ProgramData
  $casos = @(
    @{ Nombre = 'junction DENTRO de la carpeta'; Preparar = { New-Item -ItemType Junction -Path (Join-Path $base 'KrakenOS\logs') -Target $ajeno | Out-Null } },
    @{ Nombre = 'la carpeta ES una junction'; Preparar = { Remove-Item (Join-Path $base 'KrakenOS') -Recurse -Force; New-Item -ItemType Junction -Path (Join-Path $base 'KrakenOS') -Target $ajeno | Out-Null } }
  )
  try {
    $env:ProgramData = $base
    foreach ($c in $casos) {
      & $c.Preparar
      $salida = (& $node $script install --lang es 2>&1) -join "`n"
      $code = $LASTEXITCODE
      Write-Host $salida
      Assert ($code -ne 0) "el instalador aborta con $($c.Nombre)"
      $marca = (& reg.exe query 'HKLM\SOFTWARE\KrakenOS' /v DataDir 2>&1) -join "`n"
      Assert ($marca -notmatch [regex]::Escape($base)) "no queda la marca de HKLM para $($c.Nombre)"
      Assert (@(Get-ChildItem $ajeno -Force).Count -eq 0) "no se escribió nada a través de la junction ($($c.Nombre))"
    }
  } finally {
    $env:ProgramData = $original
    foreach ($j in (Join-Path $base 'KrakenOS\logs'), (Join-Path $base 'KrakenOS')) { if (Test-Path $j) { & cmd.exe /c rmdir "$j" 2>$null | Out-Null } }
  }
}

# Fase 2: el servicio que dejó el instalador (Task 3): datos con ACL, puerto elegido, arranque, reinicio
# tras morir y parada limpia (la aserción de Ctrl+C que midió el spike de la Task 2).
function Wait-Health([int]$Port, [int]$Segundos) {
  for ($i = 0; $i -lt $Segundos; $i++) {
    # El agente sirve solo https (el instalador deja HTTPS con la CA local, ya confiada por la máquina);
    # 127.0.0.1 está en el SAN del certificado.
    try { if ((Invoke-WebRequest -UseBasicParsing "https://127.0.0.1:$Port/health/ready").StatusCode -eq 200) { return $true } } catch { }
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

  # Actualizar encima con ACE EXPLÍCITAS de Users plantadas (raíz, tls\ y un fichero): el paso de datos
  # las quita (reset -> inheritance:r -> grant -> verificar por SID) y el servicio vuelve a arrancar.
  Stop-Service KrakenOS
  & icacls $datos /grant '*S-1-5-32-545:(OI)(CI)R' | Out-Null
  & icacls (Join-Path $datos 'tls') /grant '*S-1-5-32-545:(OI)(CI)R' | Out-Null
  & icacls (Join-Path $datos '.env') /grant '*S-1-5-32-545:R' | Out-Null
  # ca\ ya guarda la clave de la CA (primera instalación): Users y el servicio plantados en ella y en la clave.
  $ca0 = Join-Path $datos 'ca'
  Assert (Test-Path (Join-Path $ca0 'krakenos-ca-key.pem')) 'precondición: la primera instalación dejó la clave de la CA en ca\'
  & icacls $ca0 /grant '*S-1-5-32-545:(OI)(CI)R' | Out-Null
  & icacls $ca0 /grant ('*{0}:(OI)(CI)M' -f ((New-Object System.Security.Principal.NTAccount('NT SERVICE\KrakenOS')).Translate([System.Security.Principal.SecurityIdentifier]).Value)) | Out-Null
  Assert (((& icacls (Join-Path $ca0 'krakenos-ca-key.pem')) -join "`n") -match 'BUILTIN\\Users') 'precondición: Users llega a la clave de la CA'
  Assert (((& icacls $datos) -join "`n") -match 'BUILTIN\\Users') 'precondición: Users está en la raíz de datos'
  & $node (Join-Path $dir 'installer\post-install.mjs') install --lang es 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host '--- diagnóstico'
    & icacls $datos | Out-Host
    Get-ChildItem $datos -Force | ForEach-Object { Write-Host ("[{0}] {1}" -f $_.Name, $_.Attributes); & icacls $_.FullName | Out-Host }
    & whoami /groups | Select-String 'Mandatory Label' | Out-Host
  }
  Assert ($LASTEXITCODE -eq 0) 'repetir el paso de datos sobre una instalación existente sale con 0'
  foreach ($r in $datos, (Join-Path $datos 'tls'), (Join-Path $datos '.env')) {
    Assert (((& icacls $r) -join "`n") -notmatch 'BUILTIN\\Users') "Users ya no está en $r"
  }
  # ca\ y la clave de la CA: ni Users ni el servicio (lo plantado se cerró antes de volver a usar la clave).
  foreach ($r in $ca0, (Join-Path $ca0 'krakenos-ca-key.pem')) {
    Assert (((& icacls $r) -join "`n") -notmatch 'BUILTIN\\Users|KrakenOS:') "ni Users ni el servicio llegan a $r"
  }

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
  Assert ($tls -notmatch 'KrakenOS:[^\n]*\((M|F|W)\)') 'tls\ no deja al servicio escribir'
  $claveCa = (& icacls (Join-Path $datos 'ca\krakenos-ca-key.pem')) -join "`n"
  Assert ($claveCa -notmatch 'KrakenOS:|BUILTIN\\Users') 'la clave de la CA no es legible ni por el servicio ni por Users'
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
  if (-not $volvio) { Show-SafeTail @(Get-ChildItem (Join-Path $datos 'logs') -File | ForEach-Object FullName) 15 }
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

# Fase 3: HTTPS con la CA local. El oráculo (a) tiene que detectar la desconfianza: sin la CA en
# `Cert:\LocalMachine\Root` curl (schannel, almacén de la máquina) rechaza el certificado; tras reinstalar
# (misma CA, reimportada) da 200. Las dos pruebas usan el nombre `<equipo>.local` resuelto a 127.0.0.1.
function Invoke-CurlHealth([string]$Hostname, [int]$Port) {
  $out = & curl.exe -sS --max-time 15 --ssl-revoke-best-effort -o NUL -w '%{http_code}' "https://${Hostname}:${Port}/health/ready" --resolve "${Hostname}:${Port}:127.0.0.1" 2>&1
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join ' ') }
}

function Phase-Tls {
  Write-Host "== Phase-Tls"
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  $node = Join-Path $dir 'node\node.exe'
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  $envTxt = Get-Content (Join-Path $datos '.env') -Raw
  $port = [int][regex]::Match($envTxt, '(?m)^PORT=(\d+)\s*$').Groups[1].Value
  $origin = [regex]::Match($envTxt, '(?m)^WEB_ORIGIN=(\S+)\s*$').Groups[1].Value
  $hostName = ([uri]$origin).Host
  Assert ($port -eq 3002) "el puerto sale del .env (PORT=$port), no es un 3001 fijo"
  Assert ($origin -eq "https://${hostName}:3002") "WEB_ORIGIN es https://<equipo>.local:<puerto> (sin :443): $origin"
  Assert ($envTxt -match '(?m)^HTTPS_ENABLED=true\s*$') 'el .env activa HTTPS'
  Assert ($envTxt -match [regex]::Escape("WEBAUTHN_ORIGIN=$origin")) 'WEBAUTHN_ORIGIN coincide con WEB_ORIGIN'

  # La CA que se importó es la de ca\ (ver el thumbprint de HKLM); se la quita del almacén para el oráculo.
  $thumb = (Get-ItemProperty 'HKLM:\SOFTWARE\KrakenOS').CaThumbprint
  Assert ($thumb -match '^[0-9A-F]{40}$') "el thumbprint SHA-1 está en HKLM\Software\KrakenOS ($thumb)"
  $caPem = Join-Path $datos 'ca\krakenos-ca.pem'
  $real = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($caPem)).Thumbprint
  Assert ($real -eq $thumb) 'el thumbprint de HKLM es el de la CA de ca\'
  Assert (Test-Path "Cert:\LocalMachine\Root\$thumb") 'la CA está en Cert:\LocalMachine\Root'

  # (a) sin la CA confiada, el oráculo detecta: falla por el certificado (no por conexión ni tiempo).
  & certutil -delstore Root $thumb | Out-Null
  Assert (-not (Test-Path "Cert:\LocalMachine\Root\$thumb")) 'precondición: la CA ya no está en Root'
  $sin = Invoke-CurlHealth $hostName $port
  Write-Host ("  sin CA: curl exit {0} {1}" -f $sin.Code, $sin.Out)
  Assert (($sin.Code -ne 0) -and ($sin.Code -notin 7, 28) -and ($sin.Out -ne '200')) 'sin la CA confiada, https falla por el certificado'

  # Reinstalar (servicio parado como hace el hook): reimporta la MISMA CA.
  Stop-Service KrakenOS
  & $node (Join-Path $dir 'installer\post-install.mjs') install --lang es 2>&1 | Out-Host
  Assert ($LASTEXITCODE -eq 0) 'reinstalar sale con 0'
  $thumb2 = (Get-ItemProperty 'HKLM:\SOFTWARE\KrakenOS').CaThumbprint
  Assert ($thumb2 -eq $thumb) 'reinstalar con datos conservados reimporta la misma CA (mismo thumbprint)'
  Assert (Test-Path "Cert:\LocalMachine\Root\$thumb") 'la CA vuelve a estar en Cert:\LocalMachine\Root'

  # (b) con la CA confiada, el mismo comando da 200.
  Assert (Wait-Health $port 60) 'el agente responde por https tras reinstalar'
  $con = Invoke-CurlHealth $hostName $port
  Write-Host ("  con CA: curl exit {0} {1}" -f $con.Code, $con.Out)
  Assert (($con.Code -eq 0) -and ($con.Out -eq '200')) 'con la CA confiada, curl (schannel) da 200 en https://<equipo>.local:<puerto>'

  # window.json: solo ese fichero legible por Users, sin herencia, sin token ni claves.
  $wj = Join-Path $datos 'window.json'
  $acl = (& icacls $wj) -join "`n"
  Write-Host $acl
  Assert ($acl -match 'BUILTIN\\Users:\(R\)') 'Users lee window.json'
  Assert ($acl -notmatch 'KrakenOS:|Everyone') 'el servicio no puede reescribir window.json'
  Assert ((Get-Content $wj -Raw | ConvertFrom-Json).origin -eq $origin) 'window.json trae el origen'
  Assert ((Get-Content $wj -Raw) -notmatch 'token|PRIVATE|key') 'window.json no lleva token ni claves'
  Assert (((& icacls $datos) -join "`n") -notmatch 'BUILTIN\\Users') 'la carpeta de datos sigue sin listarse para Users'

  # (d) la tarea de renovación: SYSTEM, y su acción es un .mjs de Program Files.
  $xml = [xml]((& schtasks /Query /TN '\KrakenOS\RenovarTLS' /XML) -join "`n")
  $accion = $xml.Task.Actions.Exec
  Write-Host ("  tarea: {0} {1}" -f $accion.Command, $accion.Arguments)
  Assert ($accion.Command.Trim('"') -eq $node) 'la tarea ejecuta el node.exe de Program Files'
  Assert ($accion.Arguments -match [regex]::Escape((Join-Path $dir 'installer\renew-tls.mjs'))) 'la tarea ejecuta renew-tls.mjs de Program Files'
  Assert ($xml.Task.Principals.Principal.UserId -eq 'S-1-5-18') 'la tarea corre como SYSTEM'
  # Y funciona de verdad: se lanza y termina con 0.
  Start-ScheduledTask -TaskPath '\KrakenOS\' -TaskName 'RenovarTLS'
  $fin = $false
  for ($i = 0; $i -lt 60 -and -not $fin; $i++) {
    Start-Sleep -Seconds 1
    $info = Get-ScheduledTaskInfo -TaskPath '\KrakenOS\' -TaskName 'RenovarTLS'
    $fin = ((Get-ScheduledTask -TaskPath '\KrakenOS\' -TaskName 'RenovarTLS').State -eq 'Ready') -and ($info.LastRunTime -gt (Get-Date).AddMinutes(-2))
  }
  Assert ($fin -and $info.LastTaskResult -eq 0) "la tarea de renovación corre como SYSTEM y termina con 0 (resultado $($info.LastTaskResult))"

  # (e) ACL de ca\ y tls\.
  $ca = (& icacls (Join-Path $datos 'ca')) -join "`n"
  Assert ($ca -notmatch 'KrakenOS:|BUILTIN\\Users') 'icacls ca no lista al servicio ni a Users'
  $tls = (& icacls (Join-Path $datos 'tls')) -join "`n"
  Assert (($tls -match 'KrakenOS:\(OI\)\(CI\)\(RX\)') -and ($tls -notmatch 'KrakenOS:[^\n]*\(M\)')) 'icacls tls lista al servicio con (RX), no (M)'
}

Test-SelectSafeLines
Phase-RejectOutsideProgramFiles
Phase-Install
Phase-RejectPlantedDataDir
Phase-Service
Phase-Tls
Write-Host 'Todas las fases en verde'
