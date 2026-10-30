# Windows side of keep-awake.sh, also usable on its own from PowerShell:
#   powershell -File keep-awake.ps1 -Hours 14 -WatchPid <agent pid>
# Holds a "system and display required" power request until the watched process exits, -Hours pass, or this
# process is killed. With -FindAgentFrom, prints the PID of the nearest agent process above the given one instead.
param(
	[int]$Hours = 14,
	[int]$WatchPid = 0,
	[string]$PidFile = "",
	[int]$FindAgentFrom = 0,
	[string]$Name = "claude codex gemini opencode cursor-agent copilot aider goose"
)

if ($FindAgentFrom) {
	$names = $Name -split '[,\s]+' | Where-Object { $_ }
	$p = Get-CimInstance Win32_Process -Filter "ProcessId=$FindAgentFrom"
	while ($p) {
		$exe = [IO.Path]::GetFileNameWithoutExtension($p.Name)
		$script = $exe -match '^(node|bun|deno|pythonw?)' -and
			($names | Where-Object { $p.CommandLine -match "[\\/]$([regex]::Escape($_))([\\/ .`"-]|$)" })
		if ($exe -in $names -or $script) {
			$p.ProcessId
			exit 0
		}
		if (-not $p.ParentProcessId -or $p.ParentProcessId -eq $p.ProcessId) { break }
		$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
	}
	exit 1
}

if ($PidFile) { Set-Content -Path $PidFile -Value $PID }
$power = Add-Type -Name Power -Namespace YoloMode -PassThru -MemberDefinition `
	'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED (0x80000003)
[void]$power::SetThreadExecutionState([uint32]2147483651)
$end = (Get-Date).AddHours($Hours)
while ((Get-Date) -lt $end) {
	if ($WatchPid -and -not (Get-Process -Id $WatchPid -ErrorAction SilentlyContinue)) { break }
	Start-Sleep -Seconds 30
}
