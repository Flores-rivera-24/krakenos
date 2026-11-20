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

Phase-RejectOutsideProgramFiles
Phase-Install
Write-Host 'Todas las fases en verde'
