param([int]$TargetPid)
Add-Type -Namespace W -Name K -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint p);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(System.IntPtr h, bool add);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);
'@
[W.K]::FreeConsole() | Out-Null
if (-not [W.K]::AttachConsole($TargetPid)) { Write-Output "AttachConsole fallo: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 2 }
[W.K]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
$ok = [W.K]::GenerateConsoleCtrlEvent(0, 0)
Start-Sleep -Seconds 1
[W.K]::FreeConsole() | Out-Null
Write-Output "CtrlC enviado: $ok"
