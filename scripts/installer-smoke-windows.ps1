# Prueba del instalador de Windows en `windows-latest`: una función por fase; cada tarea añade la suya.
# Uso: pwsh scripts/installer-smoke-windows.ps1 -Setup <KrakenOS-Setup-x64.exe> [-OldSetup <el de 0.0.1>]
param([Parameter(Mandatory)][string]$Setup, [string]$OldSetup = '')
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
  $thumbAntes = (Get-ItemProperty 'HKLM:\SOFTWARE\KrakenOS').CaThumbprint
  Assert (Test-Path "Cert:\LocalMachine\Root\$thumbAntes") 'precondición: la CA de la primera instalación está en Root'
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
  # Esa CA pudo leerse: no se adopta. Se rota (CA nueva) y la anterior sale de la confianza de la máquina.
  $thumbDespues = (Get-ItemProperty 'HKLM:\SOFTWARE\KrakenOS').CaThumbprint
  Assert ($thumbDespues -ne $thumbAntes) 'con ca\ plantada abierta la CA se rota (otro thumbprint en HKLM)'
  Assert (-not (Test-Path "Cert:\LocalMachine\Root\$thumbAntes")) 'la CA expuesta ya no está en Cert:\LocalMachine\Root'
  Assert (Test-Path "Cert:\LocalMachine\Root\$thumbDespues") 'la CA nueva está en Cert:\LocalMachine\Root'
  Assert ($null -eq (Get-ItemProperty 'HKLM:\SOFTWARE\KrakenOS').CaPendienteRotar) 'terminada la rotación no queda la marca CaPendienteRotar en HKLM'
  Assert (-not (Test-Path (Join-Path $ca0 'window.json.tmp'))) 'no queda el temporal de window.json en ca\'
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
  Assert ($raiz -match 'NT SERVICE\\KrakenOS:\(OI\)\(CI\)\(IO\)\(M\)') 'el servicio tiene Modificar sobre lo de dentro de la raíz (solo hijos)'
  Assert ($raiz -match 'NT SERVICE\\KrakenOS:\(RX,WD,AD\)') 'el servicio solo lista y crea en la propia raíz'
  Assert ($raiz -notmatch 'KrakenOS:[^\n]*\((F|DE|D|DC)\)') 'el servicio no puede borrar ni renombrar la raíz de datos'
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

  # (c) ca\ llegó vacía con la CA vieja aún en Root (la vació quien la tenía abierta): se genera otra y la
  # vieja sale de Root por el thumbprint de HKLM, sin que nadie pida rotar.
  Stop-Service KrakenOS
  foreach ($f in 'ca\krakenos-ca-key.pem', 'ca\krakenos-ca.pem', 'tls\krakenos-ca.pem', 'tls\agent-key.pem', 'tls\agent-cert.pem') {
    Remove-Item -LiteralPath (Join-Path $datos $f) -Force
  }
  & $node (Join-Path $dir 'installer\post-install.mjs') install --lang es 2>&1 | Out-Host
  Assert ($LASTEXITCODE -eq 0) 'reinstalar con ca\ vacía sale con 0'
  $thumb3 = (Get-ItemProperty 'HKLM:\SOFTWARE\KrakenOS').CaThumbprint
  Assert ($thumb3 -ne $thumb) 'con ca\ vacía se genera otra CA (otro thumbprint en HKLM)'
  Assert (-not (Test-Path "Cert:\LocalMachine\Root\$thumb")) 'la CA anterior ya no está en Cert:\LocalMachine\Root'
  Assert (Test-Path "Cert:\LocalMachine\Root\$thumb3") 'la CA nueva está en Cert:\LocalMachine\Root'
  Assert (Wait-Health $port 60) 'el agente responde por https con la CA nueva'

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

# Red de la ruta por defecto (la que ve el instalador): el runner no es una casa, así que la prueba fija su categoría.
function Get-ActiveProfile {
  $r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + (Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4).InterfaceMetric } |
    Select-Object -First 1
  Assert ($null -ne $r) 'hay una ruta por defecto IPv4'
  Get-NetConnectionProfile -InterfaceIndex $r.InterfaceIndex
}

# Antes de instalar en silencio: la red activa en Pública. El silencio no puede cambiarla.
function Set-ActiveNetworkPublic {
  Write-Host "== Set-ActiveNetworkPublic"
  $p = Get-ActiveProfile
  Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Public
  $p = Get-ActiveProfile
  Write-Host ("  red activa: {0} ({1})" -f $p.Name, $p.NetworkCategory)
  Assert ($p.NetworkCategory -eq 'Public') 'precondición: la red activa del runner está en Pública'
}

# Cortafuegos: solo perfil Privado, atado al node.exe de Program Files, y el perfil de red intacto tras el /S.
function Phase-Firewall {
  Write-Host "== Phase-Firewall"
  $node = Join-Path $env:ProgramFiles 'KrakenOS\node\node.exe'
  $envTxt = Get-Content (Join-Path $env:ProgramData 'KrakenOS\.env') -Raw
  $port = [int][regex]::Match($envTxt, '(?m)^PORT=(\d+)\s*$').Groups[1].Value
  $reglas = @(Get-NetFirewallRule -Group KrakenOS)
  Write-Host ("  reglas del grupo KrakenOS: {0}" -f $reglas.Count)
  Assert ($reglas.Count -eq 2) 'hay dos reglas (TCP del puerto y UDP 5353 del mDNS): sin duplicados tras reinstalar'
  foreach ($r in $reglas) {
    $pf = $r | Get-NetFirewallPortFilter
    $ap = $r | Get-NetFirewallApplicationFilter
    Write-Host ("  {0}: {1} {2} {3} perfil={4} programa={5}" -f $r.DisplayName, $r.Direction, $pf.Protocol, $pf.LocalPort, $r.Profile, $ap.Program)
    Assert ($r.Enabled -eq 'True') "la regla $($r.DisplayName) está activa"
    Assert ($r.Direction -eq 'Inbound' -and $r.Action -eq 'Allow') "la regla $($r.DisplayName) es de entrada y permite"
    Assert ("$($r.Profile)" -eq 'Private') "la regla $($r.DisplayName) es SOLO del perfil Private (nunca Any ni Public): $($r.Profile)"
    Assert ($ap.Program -eq $node) "la regla $($r.DisplayName) está atada al node.exe de Program Files"
  }
  $tcp = $reglas | Where-Object { ($_ | Get-NetFirewallPortFilter).Protocol -eq 'TCP' }
  Assert (($tcp | Get-NetFirewallPortFilter).LocalPort -eq "$port") "la regla TCP es la del puerto del .env ($port)"
  $udp = $reglas | Where-Object { ($_ | Get-NetFirewallPortFilter).Protocol -eq 'UDP' }
  Assert (($udp | Get-NetFirewallPortFilter).LocalPort -eq '5353') 'la regla UDP es la del 5353 (mDNS)'
  # El silencio no toca la red: sigue Pública, y el instalador lo dijo en su resumen.
  $p = Get-ActiveProfile
  Assert ($p.NetworkCategory -eq 'Public') "tras instalar en silencio la red sigue Pública ($($p.NetworkCategory))"
}

# Fase 6 (Task 6): el token de setup sigue cerrado a Users (un usuario local sin privilegios no lo lee ni lista
# los datos) y `window.json`, lo único que lee la ventana sin elevar, sí; y en /S no hay ventana. Nunca se
# imprime el token: el proceso del usuario de prueba solo devuelve palabras (DENIED/OK).
function Phase-Token {
  Write-Host "== Phase-Token"
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  $f = Join-Path $datos 'setup-token'
  $null = Register-SetupToken @($datos)
  Assert (Test-Path $f) 'con el agente recién arrancado existe <datos>\setup-token'
  Assert (@(Get-Process -Name 'krakenos-window' -ErrorAction SilentlyContinue).Count -eq 0) 'en /S no queda ningún krakenos-window.exe (no hay sesión que abrir)'

  $nombre = 'krsmoke'
  $clave = [guid]::NewGuid().ToString('N') + 'aA1!'
  $pw = ConvertTo-SecureString $clave -AsPlainText -Force
  $salida = Join-Path $env:RUNNER_TEMP 'krsmoke-out'
  Remove-LocalUser -Name $nombre -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $salida | Out-Null
  try {
    New-LocalUser -Name $nombre -Password $pw -PasswordNeverExpires | Out-Null
    # Su carpeta de salida (el usuario no tiene otro sitio donde escribir).
    & icacls $salida /grant "${nombre}:(OI)(CI)(M)" | Out-Null
    $script = Join-Path $salida 'prueba.ps1'
    @"
`$ErrorActionPreference = 'Stop'
function Probar([scriptblock]`$b) { try { & `$b | Out-Null; 'OK' } catch { 'DENIED' } }
`$r = @(
  'TOKEN:' + (Probar { Get-Content -LiteralPath '$f' -Raw }),
  'LISTA:' + (Probar { Get-ChildItem -LiteralPath '$datos' -Force }),
  'JSON:' + (Probar { Get-Content -LiteralPath '$(Join-Path $datos 'window.json')' -Raw })
)
`$r | Set-Content -LiteralPath '$(Join-Path $salida 'resultado.txt')'
"@ | Set-Content -LiteralPath $script
    & icacls $script /grant "${nombre}:(R)" | Out-Null
    $cred = [pscredential]::new(".\$nombre", $pw)
    $p = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
      -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script `
      -Credential $cred -WorkingDirectory "$env:SystemRoot\System32" -LoadUserProfile -Wait -PassThru -WindowStyle Hidden
    Write-Host "proceso del usuario sin privilegios: exit $($p.ExitCode)"
    $res = Join-Path $salida 'resultado.txt'
    Assert (Test-Path $res) 'el proceso del usuario sin privilegios llegó a ejecutarse y dejó su resultado'
    $txt = (Get-Content $res) -join ' '
    Write-Host $txt
    Assert ($txt -match 'TOKEN:DENIED') 'un usuario local sin privilegios NO puede leer setup-token (acceso denegado)'
    Assert ($txt -match 'LISTA:DENIED') 'un usuario local sin privilegios NO puede listar la carpeta de datos'
    Assert ($txt -match 'JSON:OK') 'un usuario local sin privilegios SÍ lee window.json'
  } finally {
    Remove-LocalUser -Name $nombre -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $salida -Recurse -Force -ErrorAction SilentlyContinue
  }
  # El subcomando que usa el instalador devuelve el token solo por stdout y es el valor real del fichero.
  $node = Join-Path $env:ProgramFiles 'KrakenOS\node\node.exe'
  $sub = (& $node (Join-Path $env:ProgramFiles 'KrakenOS\installer\post-install.mjs') setup-token) -join ''
  $real = (Get-Content $f -Raw).Trim()
  Assert ($sub -ceq $real) 'el subcomando setup-token (elevado) entrega el token del fichero, y solo eso por stdout'
}

# Fases 7 y 8 (Task 7): desinstalar sin residuos y actualizar encima. Cada residuo se lista por nombre y la fase falla con la lista.
$KrakenKey = 'HKLM:\SOFTWARE\KrakenOS'
$UninstKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\KrakenOS'

# Lo que el instalador crea y el desinstalador tiene que quitar. `-Conservar`: se conservan los datos (y con ellos
# `DataDir`/`CaPendienteRotar` en HKLM, que los identifican como de KrakenOS); `-Permitir`: ficheros que pueden quedar
# (uninstall.exe, que en modo `_?=` no puede borrarse a sí mismo).
function Get-Residuos([string[]]$Thumbs, [switch]$Conservar, [string[]]$Permitir = @()) {
  $r = [System.Collections.Generic.List[string]]::new()
  if (Get-Service KrakenOS -ErrorAction SilentlyContinue) { $r.Add('servicio KrakenOS') }
  foreach ($x in @(Get-NetFirewallRule -Group KrakenOS -ErrorAction SilentlyContinue)) { $r.Add("regla del cortafuegos $($x.DisplayName)") }
  foreach ($t in $Thumbs) { if ($t -and (Test-Path "Cert:\LocalMachine\Root\$t")) { $r.Add("CA $t en Cert:\LocalMachine\Root") } }
  foreach ($c in @(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'KrakenOS' })) { $r.Add("certificado '$($c.Subject)' en Root") }
  $sch = New-Object -ComObject Schedule.Service; $sch.Connect()
  try { $null = $sch.GetFolder('\KrakenOS'); $r.Add('carpeta \KrakenOS\ del programador de tareas') } catch { }
  if (Test-Path $KrakenKey) {
    $permitidos = if ($Conservar) { @('DataDir', 'CaPendienteRotar') } else { @() }
    $valores = @((Get-Item $KrakenKey).Property | Where-Object { $_ -notin $permitidos })
    if (-not $Conservar) { $r.Add('clave HKLM\SOFTWARE\KrakenOS') }
    elseif ($valores.Count -gt 0) { $r.Add("valores en HKLM\SOFTWARE\KrakenOS: $($valores -join ', ')") }
  }
  if (Test-Path $UninstKey) { $r.Add('entrada de Agregar o quitar programas (HKLM\...\Uninstall\KrakenOS)') }
  if ((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).KrakenOS) { $r.Add('HKCU\...\Run\KrakenOS') }
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  if (Test-Path $dir) {
    foreach ($f in @(Get-ChildItem $dir -Force -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notin ($Permitir | ForEach-Object { Join-Path $dir $_ }) })) { $r.Add("fichero $($f.FullName)") }
    if (-not $Permitir) { $r.Add("carpeta $dir") }
  }
  foreach ($base in $env:ProgramFiles, $env:ProgramData) {
    foreach ($e in @(Get-ChildItem $base -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'kraken' -and $_.Name -notin $Script:Antes })) {
      # Con -Permitir la carpeta de Program Files sigue existiendo (aloja uninstall.exe): sus ficheros ya se miraron arriba.
      if ($Permitir -and $e.FullName -eq $dir) { continue }
      if (-not ($Conservar -and $e.FullName -eq (Join-Path $env:ProgramData 'KrakenOS'))) { $r.Add("entrada nueva $($e.FullName)") }
    }
  }
  foreach ($lnk in (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\KrakenOS.lnk'), 'C:\Users\Public\Desktop\KrakenOS.lnk') {
    if (Test-Path $lnk) { $r.Add("acceso directo $lnk") }
  }
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='krakenos-window.exe'" | Where-Object { $_.ExecutablePath -like "$dir\*" })) { $r.Add("proceso vivo $($p.ExecutablePath)") }
  return ,$r.ToArray()
}

function Assert-SinResiduos([string]$Que, [string[]]$Thumbs, [switch]$Conservar, [string[]]$Permitir = @()) {
  $r = Get-Residuos $Thumbs -Conservar:$Conservar -Permitir $Permitir
  if ($r.Count -gt 0) { $r | ForEach-Object { Write-Host "  residuo: $_" } }
  Assert ($r.Count -eq 0) "${Que}: no queda ningún residuo (lista de residuos vacía)"
}

# Marcas de los datos de un usuario: la clave JWT, el .env (con una línea propia) y un fichero de data\.
function Get-Marcas {
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  [ordered]@{
    clave = (Get-FileHash (Join-Path $datos 'keys\jwt-private.pem') -Algorithm SHA256).Hash
    env   = (Get-FileHash (Join-Path $datos '.env') -Algorithm SHA256).Hash
    data  = (Get-FileHash (Join-Path $datos 'data\marca.txt') -Algorithm SHA256).Hash
    ca    = (Get-FileHash (Join-Path $datos 'ca\krakenos-ca.pem') -Algorithm SHA256).Hash
  }
}

function Set-Marcas {
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  Add-Content (Join-Path $datos '.env') '# marca-de-prueba: este .env lo editó el usuario'
  New-Item -ItemType Directory -Force (Join-Path $datos 'data') | Out-Null
  Set-Content (Join-Path $datos 'data\marca.txt') 'no me borres'
}

function Assert-MarcasIguales($Antes, [string]$Que) {
  $ahora = Get-Marcas
  foreach ($k in $Antes.Keys) { Assert ($ahora[$k] -eq $Antes[$k]) "${Que}: la marca '$k' (suma SHA256) es idéntica" }
  Assert ((Get-Content (Join-Path $env:ProgramData 'KrakenOS\.env')) -contains '# marca-de-prueba: este .env lo editó el usuario') "${Que}: el .env conserva la línea propia"
}

function Get-PuertoDatos {
  [int][regex]::Match((Get-Content (Join-Path $env:ProgramData 'KrakenOS\.env') -Raw), '(?m)^PORT=(\d+)\s*$').Groups[1].Value
}

function Get-RootKraken { @(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'KrakenOS' }) }

# Espera a que el desinstalador sin `_?=` (que se copia a %TEMP% y devuelve el control al instante) termine de verdad.
function Wait-Desinstalador([string]$Dir, [int]$Segundos) {
  for ($i = 0; $i -lt $Segundos; $i++) {
    if (-not (Get-Process -Name 'Au_' -ErrorAction SilentlyContinue) -and -not (Test-Path $Dir)) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Show-InstallErrorLog {
  $e = Join-Path $env:ProgramFiles 'KrakenOS\install-error.log'
  if (Test-Path $e) { Write-Host '--- install-error.log'; Get-Content $e -Tail 30 | Out-Host }
}

# Fase 7: desinstalar. Servicio parado y dos veces seguidas; una junction plantada hacia una carpeta de fuera no se
# sigue (el RMDir /r de NSIS); los datos se conservan intactos; reinstalar encima vuelve a arrancar con la MISMA CA;
# y `/S /PURGEDATA` (el desinstalador normal, que se copia a %TEMP%) borra también los datos.
function Phase-Uninstall {
  Write-Host "== Phase-Uninstall"
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  $un = Join-Path $dir 'uninstall.exe'
  Assert (Test-Path $un) 'precondición: existe uninstall.exe'
  Assert ($null -ne (Get-Service KrakenOS -ErrorAction SilentlyContinue)) 'precondición: el servicio está registrado'
  Assert (@(Get-NetFirewallRule -Group KrakenOS -ErrorAction SilentlyContinue).Count -gt 0) 'precondición: hay reglas del cortafuegos'
  $thumb = (Get-ItemProperty $KrakenKey).CaThumbprint
  Assert (Test-Path "Cert:\LocalMachine\Root\$thumb") 'precondición: la CA está en Root'
  $tarea = $null -ne (Get-ScheduledTask -TaskPath '\KrakenOS\' -TaskName 'RenovarTLS' -ErrorAction SilentlyContinue)
  Assert $tarea 'precondición: existe la tarea \KrakenOS\RenovarTLS'
  Set-Marcas
  $marcas = Get-Marcas

  # Plantados: una junction dentro de Program Files hacia una carpeta de fuera con un fichero (NSIS no debe seguirla)
  # y el autoarranque de la ventana (HKCU del usuario que desinstala).
  $canario = Join-Path ([IO.Path]::GetTempPath()) 'krakenos-canario'
  New-Item -ItemType Directory -Force $canario | Out-Null
  Set-Content (Join-Path $canario 'no-me-borres.txt') 'canario'
  New-Item -ItemType Junction -Path (Join-Path $dir 'junction-plantada') -Target $canario | Out-Null
  Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name KrakenOS -Value ('"{0}" --autostarted' -f (Join-Path $dir 'krakenos-window.exe'))

  # Servicio ya parado. `_?=` (ruta sin comillas, la última): el desinstalador corre en sitio y devuelve su código.
  Stop-Service KrakenOS
  # Un fallo real de `uninstall` (manifiesto de enlaces ilegible) debe abortar con código != 0 y conservar el
  # desinstalador, el Node y el log; reparado el motivo, repetir la desinstalación termina bien (es idempotente).
  $links = Join-Path $dir 'app\links.json'
  $copiaLinks = Join-Path ([IO.Path]::GetTempPath()) 'krakenos-links.json.bak'
  Copy-Item -LiteralPath $links -Destination $copiaLinks -Force
  Set-Content -LiteralPath $links '{esto no es json'
  $p = Start-Process -FilePath $un -ArgumentList "/S _?=$dir" -Wait -PassThru
  Assert ($p.ExitCode -ne 0) "si la desinstalación falla, uninstall.exe /S sale con código distinto de 0 ($($p.ExitCode))"
  Assert (Test-Path (Join-Path $dir 'install-error.log')) 'tras el fallo sigue install-error.log (el único rastro del motivo)'
  Assert (Test-Path $un) 'tras el fallo sigue uninstall.exe, para poder reintentar'
  Assert (Test-Path (Join-Path $dir 'node\node.exe')) 'tras el fallo sigue node.exe, para poder reintentar'
  Copy-Item -LiteralPath $copiaLinks -Destination $links -Force
  Remove-Item -LiteralPath $copiaLinks -Force
  $p = Start-Process -FilePath $un -ArgumentList "/S _?=$dir" -Wait -PassThru
  if ($p.ExitCode -ne 0) { Show-InstallErrorLog }
  Assert ($p.ExitCode -eq 0) 'uninstall.exe /S (servicio parado; reintento tras el fallo) sale con 0'
  $p = Start-Process -FilePath $un -ArgumentList "/S _?=$dir" -Wait -PassThru
  Assert ($p.ExitCode -eq 0) 'un segundo uninstall.exe /S (ya sin nada que quitar) sale con 0'
  Assert (Test-Path (Join-Path $canario 'no-me-borres.txt')) 'el fichero de fuera de Program Files sigue existiendo tras desinstalar (la junction plantada no se siguió)'
  Remove-Item -LiteralPath (Join-Path $dir 'junction-plantada') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $canario -Recurse -Force -ErrorAction SilentlyContinue
  # En sitio el desinstalador no puede borrarse a sí mismo: ese es el único resto admitido; se retira como hace Tauri.
  Assert-SinResiduos 'tras desinstalar con los datos conservados' @($thumb) -Conservar -Permitir @('uninstall.exe')
  Remove-Item -LiteralPath $un -Force
  Remove-Item -LiteralPath $dir -Force
  Assert (Test-Path $datos) 'los datos (%ProgramData%\KrakenOS) se conservan'
  Assert-MarcasIguales $marcas 'tras desinstalar'
  Assert ((Get-ItemProperty $KrakenKey).DataDir -eq $datos) 'con los datos conservados queda en HKLM la marca DataDir que los reconoce como de KrakenOS'

  # Reinstalar encima de los datos conservados: arranca y reimporta la MISMA CA.
  $p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Show-InstallErrorLog }
  Assert ($p.ExitCode -eq 0) 'reinstalar sobre los datos conservados sale con 0'
  Assert (Wait-Health (Get-PuertoDatos) 90) 'el agente arranca sobre los datos conservados'
  Assert ((Get-ItemProperty $KrakenKey).CaThumbprint -eq $thumb) 'reinstalar reimporta la misma CA (mismo thumbprint en HKLM)'
  Assert ((Get-RootKraken).Count -eq 1 -and (Get-RootKraken)[0].Thumbprint -eq $thumb) 'hay una sola CA de KrakenOS en Root y es la misma'
  Assert-MarcasIguales $marcas 'tras reinstalar'

  # Canarios en <datos> (que el servicio puede escribir): una junction normal y otra con destino por volumen
  # (`\\?\Volume{GUID}\…`), que Node puede no ver como enlace. `/PURGEDATA` no debe borrar lo de fuera.
  $canDatos = Join-Path ([IO.Path]::GetTempPath()) 'krakenos-canario-datos'
  $canVol = Join-Path ([IO.Path]::GetTempPath()) 'krakenos-canario-volumen'
  foreach ($c in $canDatos, $canVol) { New-Item -ItemType Directory -Force $c | Out-Null; Set-Content (Join-Path $c 'no-me-borres.txt') 'canario' }
  New-Item -ItemType Junction -Path (Join-Path $datos 'junction-plantada') -Target $canDatos | Out-Null
  $volPlantada = $false
  try {
    $unico = (Get-Volume -DriveLetter $env:SystemDrive.TrimEnd(':') -ErrorAction Stop).UniqueId
    New-Item -ItemType Junction -Path (Join-Path $datos 'junction-volumen') -Target ($unico + $canVol.Substring(3)) -ErrorAction Stop | Out-Null
    $volPlantada = $true
  } catch { Write-Host "::warning::no se pudo plantar la junction por volumen: $($_.Exception.Message)" }
  Write-Host "junction por volumen plantada: $volPlantada"

  # El desinstalador normal (sin `_?=`): se copia a %TEMP% y el original sale al momento; se espera a la copia.
  $p = Start-Process -FilePath $un -ArgumentList '/S /PURGEDATA' -Wait -PassThru
  Assert ($p.ExitCode -eq 0) 'uninstall.exe /S /PURGEDATA sale con 0'
  if (-not (Wait-Desinstalador $dir 180)) {
    Show-InstallErrorLog
    Write-Host '--- lo que queda en <datos>'
    Get-ChildItem -LiteralPath $datos -Force -ErrorAction SilentlyContinue | Format-List Name, Attributes, LinkType, Target | Out-Host
    Write-Host "canario datos existe: $(Test-Path (Join-Path $canDatos 'no-me-borres.txt')); canario volumen existe: $(Test-Path (Join-Path $canVol 'no-me-borres.txt'))"
  }
  Assert (Wait-Desinstalador $dir 1) 'el desinstalador termina y Program Files\KrakenOS desaparece del todo'
  Assert (-not (Test-Path $datos)) '/PURGEDATA borra también %ProgramData%\KrakenOS'
  Assert (Test-Path (Join-Path $canDatos 'no-me-borres.txt')) '/PURGEDATA no sigue una junction plantada en <datos>: el fichero de fuera sigue existiendo'
  if ($volPlantada) { Assert (Test-Path (Join-Path $canVol 'no-me-borres.txt')) '/PURGEDATA no sigue una junction por volumen plantada en <datos>: el fichero de fuera sigue existiendo' }
  Remove-Item -LiteralPath $canDatos, $canVol -Recurse -Force -ErrorAction SilentlyContinue
  Assert-SinResiduos 'tras desinstalar con /PURGEDATA' @($thumb)
}

# Fase 8: actualizar encima. Se instala 0.0.1 (el mismo paquete con otra versión), se ponen marcas, se instala la
# versión real encima con /S y todo sigue: marcas idénticas, servicio Running, la misma CA (una sola), una regla y una
# tarea; y la misma versión otra vez no cambia nada. El servicio se reinstala con el XML nuevo (acciones ante fallo).
function Phase-Upgrade {
  Write-Host "== Phase-Upgrade"
  if (-not $OldSetup) { Write-Host '  sin -OldSetup: se omite la actualización'; return }
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  $datos = Join-Path $env:ProgramData 'KrakenOS'
  Assert (-not (Test-Path $dir) -and -not (Test-Path $datos)) 'precondición: máquina limpia (Fase 7 purgó todo)'
  $versionReal = [regex]::Match((Split-Path $Setup -Leaf), 'Setup-(.+)-x64').Groups[1].Value
  $p = Start-Process -FilePath $OldSetup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Show-InstallErrorLog }
  Assert ($p.ExitCode -eq 0) 'instalar 0.0.1 con /S sale con 0'
  Assert ((Get-ItemProperty $UninstKey).DisplayVersion -eq '0.0.1') 'la versión instalada es 0.0.1'
  Assert (Wait-Health (Get-PuertoDatos) 90) 'el agente 0.0.1 arranca'
  Set-Marcas
  $marcas = Get-Marcas
  $thumb = (Get-ItemProperty $KrakenKey).CaThumbprint
  $reglas = @(Get-NetFirewallRule -Group KrakenOS).Count
  # Se borran las acciones ante fallo del servicio: si la actualización lo reinstala con el XML, vuelven.
  & sc.exe failure KrakenOS reset= 0 actions= none/0/none/0/none/0 | Out-Null
  Assert (((& sc.exe qfailure KrakenOS) -join "`n") -notmatch 'RESTART') 'precondición: el servicio ya no reinicia ante fallos'

  $t = Measure-Command { $p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru }
  Write-Host ("actualizar encima /S: {0:N1} s, exit {1}" -f $t.TotalSeconds, $p.ExitCode)
  if ($p.ExitCode -ne 0) { Show-InstallErrorLog }
  Assert ($p.ExitCode -eq 0) "instalar $versionReal encima de 0.0.1 con /S sale con 0"
  Assert ((Get-ItemProperty $UninstKey).DisplayVersion -eq $versionReal) "la versión instalada ahora es $versionReal"
  Assert-MarcasIguales $marcas 'tras actualizar'
  Assert ((Get-Service KrakenOS).Status -eq 'Running') 'el servicio está Running tras actualizar'
  Assert (Wait-Health (Get-PuertoDatos) 90) '/health/ready da 200 tras actualizar'
  Assert ((Get-ItemProperty $KrakenKey).CaThumbprint -eq $thumb) 'la CA es la misma (mismo thumbprint en HKLM)'
  Assert ((Get-RootKraken).Count -eq 1 -and (Get-RootKraken)[0].Thumbprint -eq $thumb) 'hay una sola CA de KrakenOS en Root'
  Assert (@(Get-NetFirewallRule -Group KrakenOS).Count -eq $reglas) "las reglas del cortafuegos no se duplican ($reglas)"
  Assert (@(Get-ScheduledTask -TaskPath '\KrakenOS\').Count -eq 1) 'hay una sola tarea programada'
  Assert (((& sc.exe qfailure KrakenOS) -join "`n") -match 'RESTART') 'la actualización reinstaló el servicio: vuelven las acciones ante fallo del XML'
  $nm = Join-Path $dir 'app\agent\node_modules'
  $rotos = @(Get-ChildItem $nm -Force -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.LinkType -and -not (Test-Path -LiteralPath $_.FullName) })
  Write-Host ("enlaces rotos en app\agent\node_modules: {0}" -f $rotos.Count)
  $rotos | ForEach-Object { Write-Host ("  roto: {0} -> {1}" -f $_.FullName, ($_.Target -join ',')) }

  # La misma versión otra vez: sin cambios ni error.
  $p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Show-InstallErrorLog }
  Assert ($p.ExitCode -eq 0) 'reinstalar la misma versión con /S sale con 0'
  Assert-MarcasIguales $marcas 'tras reinstalar la misma versión'
  Assert ((Get-Service KrakenOS).Status -eq 'Running') 'el servicio sigue Running tras reinstalar la misma versión'
  Assert (Wait-Health (Get-PuertoDatos) 90) '/health/ready da 200 tras reinstalar la misma versión'
  Assert ((Get-RootKraken).Count -eq 1 -and (Get-RootKraken)[0].Thumbprint -eq $thumb) 'sigue habiendo una sola CA, la misma'
  Assert (@(Get-NetFirewallRule -Group KrakenOS).Count -eq $reglas) 'las reglas no se duplican al reinstalar la misma versión'
  Assert (@(Get-ScheduledTask -TaskPath '\KrakenOS\').Count -eq 1) 'sigue habiendo una sola tarea programada'
}

# Lo que ya había en Program Files y ProgramData con «kraken» en el nombre (nada, en un runner limpio).
$Script:Antes = @($env:ProgramFiles, $env:ProgramData | ForEach-Object { Get-ChildItem $_ -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'kraken' } | ForEach-Object Name })

# Fase final: la instalación que dejó la actualización se desinstala con /S /PURGEDATA y no queda nada.
function Phase-FinalUninstall {
  Write-Host "== Phase-FinalUninstall"
  $dir = Join-Path $env:ProgramFiles 'KrakenOS'
  if (-not (Test-Path $dir)) { Write-Host '  sin instalación que quitar (no hubo actualización)'; return }
  $thumb = (Get-ItemProperty $KrakenKey).CaThumbprint
  Assert ((Get-Service KrakenOS).Status -eq 'Running') 'precondición: el servicio actualizado sigue Running'
  $p = Start-Process -FilePath (Join-Path $dir 'uninstall.exe') -ArgumentList '/S /PURGEDATA' -Wait -PassThru
  Assert ($p.ExitCode -eq 0) 'uninstall.exe /S /PURGEDATA sobre la instalación actualizada sale con 0'
  Assert (Wait-Desinstalador $dir 180) 'el desinstalador termina y Program Files\KrakenOS desaparece'
  Assert (-not (Test-Path (Join-Path $env:ProgramData 'KrakenOS'))) '/PURGEDATA borra %ProgramData%\KrakenOS'
  Assert-SinResiduos 'tras actualizar y desinstalar' @($thumb)
}

Test-SelectSafeLines
Phase-RejectOutsideProgramFiles
Set-ActiveNetworkPublic
Phase-Install
Phase-RejectPlantedDataDir
Phase-Service
Phase-Tls
Phase-Firewall
Phase-Token
Phase-Uninstall
Phase-Upgrade
Phase-FinalUninstall
Write-Host 'Todas las fases en verde'
