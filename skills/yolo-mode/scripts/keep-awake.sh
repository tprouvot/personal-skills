#!/usr/bin/env bash
# Keeps the computer awake while an agent session runs. Sleep is allowed again when the session ends,
# on `stop`, or after --hours (default 14), whichever comes first.
#
#   keep-awake.sh check                          platform, sleep blocker, power source, detected agent PID
#   keep-awake.sh start  [--pid N] [--hours H] [--name "agent ..."]
#   keep-awake.sh status [--pid N] [--name "agent ..."]
#   keep-awake.sh stop   [--pid N] [--name "agent ..."]
#
# N defaults to the nearest process above this shell named like an agent CLI in --name (or $YOLO_AGENT_NAMES),
# directly or as a node/bun/deno/python script. No match: only the --hours cap ends it.
# macOS: caffeinate. Linux: systemd-inhibit. Windows (Git Bash, MSYS2, Cygwin) and WSL: keep-awake.ps1.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/yolo-mode"
action=${1:-}
[ $# -gt 0 ] && shift
pid_arg="" hours=14 names=${YOLO_AGENT_NAMES:-"claude codex gemini opencode cursor-agent copilot aider goose"}
while [ $# -gt 0 ]; do
	case "$1" in
		--pid) pid_arg=${2:-}; shift 2 ;;
		--hours) hours=${2:-}; shift 2 ;;
		--name) names=${2:-}; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 64 ;;
	esac
done
names=${names//,/ }
case "$hours" in '' | *[!0-9]*) echo "--hours takes a whole number" >&2; exit 64 ;; esac

platform() {
	case "$(uname -s)" in
		Darwin) echo macos ;;
		Linux) if grep -qi microsoft /proc/version 2>/dev/null; then echo wsl; else echo linux; fi ;;
		MINGW* | MSYS* | CYGWIN*) echo windows ;;
		*) echo unknown ;;
	esac
}
os=$(platform)
# Git Bash would otherwise rewrite /PID, /FI and the like into Windows paths.
[ "$os" = windows ] && export MSYS2_ARG_CONV_EXCL='*'

win_path() {
	if command -v wslpath >/dev/null 2>&1; then wslpath -w "$1"; else cygpath -w "$1"; fi
}

ps1_cmd() {
	local bin
	bin=$(command -v powershell.exe || command -v pwsh.exe) || { echo "powershell.exe not found" >&2; exit 69; }
	PS1_CMD=("$bin" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(win_path "$here/keep-awake.ps1")")
}

win_alive() { [ -n "$1" ] && tasklist.exe /FI "PID eq $1" /NH 2>/dev/null | grep -qw "$1"; }
win_kill() { [ -n "$1" ] && taskkill.exe /PID "$1" /F >/dev/null 2>&1 || true; }

# $1 binary name, $2 command line (only read for interpreters). Shells are never matched on their arguments:
# agents' shells carry paths such as ~/.claude/shell-snapshots or ~/.codex/... in theirs.
is_agent() {
	local n
	for n in $names; do
		case "$1" in "$n" | "$n.exe") return 0 ;; esac
		[ -n "$2" ] || continue
		case "$2" in *"/$n" | *"/$n "* | *"/$n-"* | *"/$n."*) return 0 ;; esac
	done
	return 1
}

# Walks up from this script to the nearest agent process.
find_agent_pid() {
	if [ "$os" = windows ]; then
		ps1_cmd
		"${PS1_CMD[@]}" -FindAgentFrom "$(cat "/proc/$$/winpid")" -Name "$names" | tr -d '\r'
		return
	fi
	local pid=$$ comm args
	while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
		comm=$(ps -o comm= -p "$pid" 2>/dev/null) || return 1
		comm=${comm##*/}
		args=""
		case "$comm" in
			node* | bun* | deno* | python* | Python*) args=$(ps -o args= -p "$pid" 2>/dev/null || true) ;;
		esac
		if is_agent "$comm" "$args"; then
			echo "$pid"
			return 0
		fi
		pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
	done
	return 1
}

resolve_target() {
	if [ -n "$pid_arg" ]; then echo "$pid_arg"; else find_agent_pid || true; fi
}

state_file() { echo "$state_dir/${1:-timer}.env"; }

fmt_time() { date -r "$1" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$1" '+%Y-%m-%d %H:%M'; }

# Runs a command in its own session so it outlives the shell that started it; sets $!.
detach() {
	if command -v setsid >/dev/null 2>&1; then
		setsid "$@" </dev/null >/dev/null 2>&1 &
	else
		nohup "$@" </dev/null >/dev/null 2>&1 &
	fi
}

# A shell loop that ends at epoch $2, or earlier when pid $1 (optional) exits.
wait_loop() {
	if [ -n "$1" ]; then
		echo "while [ \$(date +%s) -lt $2 ] && kill -0 $1 2>/dev/null; do sleep 30; done"
	else
		echo "while [ \$(date +%s) -lt $2 ]; do sleep 30; done"
	fi
}

read_winpid() {
	local i
	for i in $(seq 1 30); do
		[ -s "$1" ] && { tr -dc '0-9' <"$1"; return 0; }
		sleep 0.5
	done
	echo "keep-awake.ps1 did not start" >&2
	exit 70
}

# nohup and setsid exec the real holder a moment after `&` returns.
wait_holder() {
	local i
	for i in $(seq 1 20); do
		ps -o comm= -p "$1" 2>/dev/null | grep -qE 'caffeinate|systemd-inhibit' && return 0
		sleep 0.1
	done
}

running() {
	[ -f "$1" ] || return 1
	local os holder watcher target until
	. "$1"
	case "$os" in
		windows | wsl) win_alive "$holder" ;;
		*) ps -o comm= -p "$holder" 2>/dev/null | grep -qE 'caffeinate|systemd-inhibit' ;;
	esac
}

status() {
	local file=${1:-}
	[ -n "$file" ] || file=$(state_file "$(resolve_target)")
	if ! running "$file"; then
		rm -f "$file"
		echo "keep-awake: not running"
		return 1
	fi
	local os holder watcher target until
	. "$file"
	echo "keep-awake: active on $os, holder pid $holder${target:+, ends with pid $target}, $(fmt_time "$until") at the latest"
	case "$os" in
		macos) pmset -g assertions | grep -F "pid $holder(" || true ;;
		linux) systemd-inhibit --list --no-pager 2>/dev/null | grep yolo-mode || true ;;
	esac
}

start() {
	local target file holder="" watcher="" secs=$((hours * 3600)) until pidfile
	target=$(resolve_target)
	file=$(state_file "$target")
	if running "$file"; then
		status "$file"
		return
	fi
	mkdir -p "$state_dir"
	until=$(($(date +%s) + secs))
	[ -n "$target" ] || echo "No agent process found: keeping awake for $hours h instead of until the session ends." >&2
	case "$os" in
		macos)
			# -s only holds on AC power; on battery macOS can still sleep.
			nohup /usr/bin/caffeinate -dims -t "$secs" ${target:+-w "$target"} </dev/null >/dev/null 2>&1 &
			holder=$! ;;
		linux)
			command -v systemd-inhibit >/dev/null || {
				echo "systemd-inhibit not found: set the power settings to never sleep for this run instead." >&2
				exit 69
			}
			detach systemd-inhibit --what=idle:sleep --who=yolo-mode --why="Unattended agent run" --mode=block \
				sh -c "$(wait_loop "$target" "$until")"
			holder=$! ;;
		windows)
			ps1_cmd
			pidfile="${file%.env}.winpid"
			rm -f "$pidfile"
			nohup "${PS1_CMD[@]}" -Hours "$hours" ${target:+-WatchPid "$target"} -PidFile "$(win_path "$pidfile")" \
				</dev/null >/dev/null 2>&1 &
			holder=$(read_winpid "$pidfile") ;;
		wsl)
			# Windows can't see Linux PIDs, so a Linux-side loop ends the Windows process with the session.
			ps1_cmd
			pidfile="${file%.env}.winpid"
			rm -f "$pidfile"
			detach "${PS1_CMD[@]}" -Hours "$hours" -PidFile "$(win_path "$pidfile")"
			holder=$(read_winpid "$pidfile")
			if [ -n "$target" ]; then
				detach sh -c "$(wait_loop "$target" "$until"); taskkill.exe /PID $holder /F >/dev/null 2>&1"
				watcher=$!
			fi ;;
		*)
			echo "No sleep blocker for $(uname -s): set the power settings to never sleep for this run instead." >&2
			exit 69 ;;
	esac
	case "$os" in macos | linux) wait_holder "$holder" ;; esac
	printf 'os=%s\nholder=%s\nwatcher=%s\ntarget=%s\nuntil=%s\n' "$os" "$holder" "$watcher" "$target" "$until" >"$file"
	status "$file"
}

stop() {
	local file
	file=$(state_file "$(resolve_target)")
	# Declared after resolve_target, which reads the global $os.
	local os holder watcher target until
	if [ ! -f "$file" ]; then
		echo "keep-awake: not running"
		return 0
	fi
	. "$file"
	case "$os" in
		windows | wsl) win_kill "$holder" ;;
		# setsid made the holder a group leader: end its wait loop too.
		linux) kill -- "-$holder" 2>/dev/null || kill "$holder" 2>/dev/null || true ;;
		*) kill "$holder" 2>/dev/null || true ;;
	esac
	if [ -n "$watcher" ]; then kill -- "-$watcher" 2>/dev/null || kill "$watcher" 2>/dev/null || true; fi
	rm -f "$file" "${file%.env}.winpid"
	echo "keep-awake: stopped"
}

check() {
	local target f
	echo "platform: $os"
	case "$os" in
		macos)
			echo "sleep blocker: /usr/bin/caffeinate"
			echo "power: $(pmset -g batt | head -1)" ;;
		linux)
			if command -v systemd-inhibit >/dev/null; then echo "sleep blocker: systemd-inhibit"; else echo "sleep blocker: none (no systemd-inhibit)"; fi
			for f in /sys/class/power_supply/*; do
				[ "$(cat "$f/type" 2>/dev/null)" = Mains ] && echo "power: on AC $(cat "$f/online")"
			done ;;
		windows | wsl)
			ps1_cmd
			echo "sleep blocker: ${PS1_CMD[0]} running keep-awake.ps1" ;;
		*) echo "sleep blocker: none for $(uname -s)" ;;
	esac
	target=$(resolve_target)
	if [ -z "$target" ]; then
		echo "agent: none of [$names] above this shell (IDE agents have no process of their own): pass --pid or --name, or rely on --hours"
	elif [ "$os" = windows ]; then
		echo "agent: pid $target"
	else
		echo "agent: pid $target ($(ps -o comm= -p "$target" | sed 's#.*/##'))"
	fi
}

case "$action" in
	check) check ;;
	start) start ;;
	status) status ;;
	stop) stop ;;
	*) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
esac
