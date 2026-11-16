#!/usr/bin/env bash
# Set up the JobSeeker practice API on an Oracle Always Free ARM server (Ubuntu 24.04 aarch64).
#   sudo git clone -b <branch> https://github.com/seungxa/26-2_CapstoneProject.git /opt/jobseeker
#   sudo /opt/jobseeker/scripts/practice-track/deploy/install.sh <name>.duckdns.org
# Running it again (after `sudo git -C /opt/jobseeker pull`) updates packages, files and services and keeps
# /etc/jobseeker/api.env as it is. Guide: docs/practice-track/deploy-oracle.md
#
# --files-only <domain>: only write the config files, under $JOBSEEKER_PREFIX (tests; no root needed).
set -euo pipefail

usage() {
  echo "usage: sudo $0 <domain>    for example: sudo $0 myname.duckdns.org" >&2
  exit 2
}

files_only=false
if [[ ${1:-} == --files-only ]]; then
  files_only=true
  shift
fi
[[ $# -eq 1 ]] || usage
domain=$1
domain_re='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
if [[ ! $domain =~ $domain_re ]]; then
  echo "Not a domain name: '$domain' (lower case, no http://)" >&2
  usage
fi

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "$here/../../.." && pwd)
venv=$repo/backend/.venv
prefix=${JOBSEEKER_PREFIX:-}
env_file=/etc/jobseeker/api.env
data=/var/lib/jobseeker

if [[ $files_only == false ]]; then
  if [[ -n $prefix ]]; then
    echo "JOBSEEKER_PREFIX is only for --files-only test runs" >&2
    exit 2
  fi
  if [[ $EUID -ne 0 ]]; then
    echo "Run as root: sudo $0 $domain" >&2
    exit 2
  fi
  if [[ $repo != /opt/jobseeker ]]; then
    echo "Clone the repository to /opt/jobseeker first (the service runs from there); this copy is in $repo" >&2
    exit 2
  fi
fi

step() { printf '\n== %s\n' "$*"; }

place_files() {
  install -d -m 0755 "$prefix/etc/caddy" "$prefix/etc/systemd/system"
  install -d -m 0750 "$prefix/etc/jobseeker"
  sed "s/@DOMAIN@/$domain/g" "$here/Caddyfile" > "$prefix/etc/caddy/Caddyfile.new"
  chmod 0644 "$prefix/etc/caddy/Caddyfile.new"
  mv "$prefix/etc/caddy/Caddyfile.new" "$prefix/etc/caddy/Caddyfile"
  install -m 0644 "$here/jobseeker-api.service" "$prefix/etc/systemd/system/jobseeker-api.service"
  if [[ ! -e $prefix$env_file ]]; then
    install -m 0640 "$here/api.env.example" "$prefix$env_file"
    echo "Created $env_file from the template"
  else
    echo "Kept the existing $env_file"
  fi
  if [[ $files_only == false ]]; then
    chown root:jobseeker /etc/jobseeker "$env_file"
  fi
}

if [[ $files_only == true ]]; then
  place_files
  exit 0
fi

install_packages() {
  step "System packages"
  export DEBIAN_FRONTEND=noninteractive
  # keep the image's firewall rules when iptables-persistent is (re)installed
  echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | debconf-set-selections
  echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | debconf-set-selections
  apt-get update -q
  apt-get install -y -q python3-venv python3-pip git curl gpg debian-keyring debian-archive-keyring \
    apt-transport-https iptables-persistent
  local keyring=/usr/share/keyrings/caddy-stable-archive-keyring.gpg list=/etc/apt/sources.list.d/caddy-stable.list
  if [[ ! -s $keyring || ! -s $list ]]; then
    # Caddy's official apt repository (https://caddyserver.com/docs/install)
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o "$keyring"
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > "$list"
    chmod o+r "$keyring" "$list"
    apt-get update -q
  fi
  apt-get install -y -q caddy
  local version
  version=$(caddy version | awk '{print $1}')
  version=${version#v}
  if ! printf '%s\n%s\n' 2.11.6 "$version" | sort -V -C; then
    echo "Caddy $version is older than 2.11.6; the Caddyfile needs the write_idle timeout" >&2
    exit 1
  fi
  if [[ $(uname -m) != aarch64 ]]; then
    echo "Note: this is $(uname -m), not the aarch64 server the guide describes. Continuing."
  fi
}

create_user() {
  step "Service user and folders"
  if ! id -u jobseeker >/dev/null 2>&1; then
    useradd --system --home-dir "$data" --no-create-home --shell /usr/sbin/nologin jobseeker
  fi
  install -d -o jobseeker -g jobseeker -m 0750 "$data" "$data/hf" "$data/recordings"
}

install_python() {
  step "Python packages"
  python3 -c 'import sys; v = sys.version_info[:2]; print("Python %d.%d" % v); sys.exit(v != (3, 12))' ||
    echo "Note: requirements-lock.txt was checked with Python 3.12; this server has another version."
  [[ -x $venv/bin/python ]] || python3 -m venv "$venv"
  "$venv/bin/pip" install -q -r "$repo/backend/requirements.txt" -c "$repo/backend/requirements-lock.txt"
  "$venv/bin/pip" install -q -r "$repo/backend/requirements-followup.txt" -c "$repo/backend/requirements-lock.txt"
  if ! "$venv/bin/python" -c 'import faster_whisper, llama_cpp'; then
    echo "The speech or follow-up library does not load on this CPU. See 'Troubleshooting' in docs/practice-track/deploy-oracle.md" >&2
    exit 1
  fi
}

start_services() {
  step "Services"
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl daemon-reload
  systemctl enable caddy jobseeker-api
  systemctl reload-or-restart caddy
}

open_port() {
  local port=$1 at
  if iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    return
  fi
  # Oracle's Ubuntu image ends INPUT with a REJECT rule: the new rule must come before it
  at=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')
  iptables -I INPUT "${at:-1}" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  echo "Opened TCP $port"
}

open_firewall() {
  step "Firewall (80, 443)"
  open_port 80
  open_port 443
  netfilter-persistent save
}

run_as_service() {
  # Same user, settings and model cache as the service
  systemd-run --quiet --wait --pipe --collect --uid=jobseeker --gid=jobseeker \
    -p WorkingDirectory="$repo/backend" -p EnvironmentFile="$env_file" \
    --setenv=HF_HOME="$data/hf" --setenv=HF_HUB_DISABLE_TELEMETRY=1 \
    "$venv/bin/python" -m "$@"
}

download_models() {
  step "Models (first time: a few minutes)"
  run_as_service app.stt download
  run_as_service app.followup_model download
}

install_packages
create_user
step "Config files"
place_files
install_python
start_services
open_firewall
download_models

step "API"
if grep -Eq '^[^#]*<' "$env_file"; then
  echo "Fill the <...> values in $env_file, then run: sudo systemctl restart jobseeker-api"
else
  systemctl restart jobseeker-api
  echo "Restarted jobseeker-api"
fi
echo "Check: python3 $here/check_server.py --domain $domain --origin <team web address>"
