#!/usr/bin/env bash
#
# One-time host preparation for douyin-prod-01 (Ubuntu 24.04 LTS, e2-medium).
#
#   curl -fsSL .../bootstrap.sh -o bootstrap.sh   # or scp it
#   sudo bash bootstrap.sh
#
# Idempotent: safe to re-run. Every step checks for its own result first.
#
# What it does NOT do, deliberately:
#   - install MongoDB, Redis or Node on the host. Those run in containers; a
#     second copy on the host would bind a public port and shadow the container.
#   - enable the Ops Agent or Cloud Logging (billable, and switched off by
#     request). Container logs are capped by the compose logging driver instead.
#   - create any Google Cloud resource. Nothing here can incur a charge.
#   - touch the firewall rules in the GCP console. HTTP/HTTPS are already
#     allowed there; this script only configures the host firewall to match.

set -euo pipefail

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

# The account that invoked sudo — the one that must keep SSH access.
ADMIN_USER="${SUDO_USER:-}"
if [[ -z "$ADMIN_USER" || "$ADMIN_USER" == "root" ]]; then
  warn "Could not determine the non-root login user from SUDO_USER."
  warn "SSH hardening will be SKIPPED rather than risk locking you out."
  ADMIN_USER=""
fi

# ---------------------------------------------------------------------- swap
#
# 2 GB. This is a burst margin, not capacity: the compose limits are sized to
# fit in RAM, and anything that routinely swaps mongod is an outage in slow
# motion. `swappiness=10` keeps the kernel from reaching for it early.
log "Swap"
if swapon --show | grep -q '/swapfile'; then
  echo "swapfile already active: $(swapon --show --bytes | awk '/swapfile/{print $3}') bytes"
else
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "created 2G swapfile"
fi
sysctl -qw vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.d/99-douyin.conf 2>/dev/null \
  || echo 'vm.swappiness=10' >> /etc/sysctl.d/99-douyin.conf

# --------------------------------------------------------------------- docker
log "Docker Engine + Compose plugin"
if command -v docker >/dev/null 2>&1; then
  echo "docker already installed: $(docker --version)"
else
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi

# Daemon-level log caps, so a container started without the compose logging
# options still cannot fill the disk.
log "Docker daemon log rotation"
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
  systemctl restart docker
else
  echo "/etc/docker/daemon.json exists — leaving it alone"
fi

systemctl enable --now docker

if [[ -n "$ADMIN_USER" ]] && ! id -nG "$ADMIN_USER" | grep -qw docker; then
  usermod -aG docker "$ADMIN_USER"
  warn "Added $ADMIN_USER to the docker group. Log out and back in for it to apply."
  warn "Note: docker group membership is equivalent to root on this host."
fi

# ---------------------------------------------------------------------- nginx
log "nginx + certbot"
apt-get install -y -qq nginx certbot python3-certbot-nginx
systemctl enable --now nginx

# ------------------------------------------------------------------- firewall
#
# Host firewall mirroring the GCP rules. Belt and braces: the GCP firewall is
# the outer boundary, ufw stops anything that gets past it or originates
# in-VPC. 22 is allowed BEFORE enabling, or enabling ends the session.
log "Host firewall (ufw)"
if ufw status | grep -q "Status: active"; then
  echo "ufw already active"
else
  ufw --force reset >/dev/null
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp   comment 'SSH'
  ufw allow 80/tcp   comment 'HTTP (ACME + redirect)'
  ufw allow 443/tcp  comment 'HTTPS'
  ufw --force enable
fi
ufw status verbose

# ------------------------------------------------------------------------ SSH
#
# HARDENING THAT CANNOT LOCK YOU OUT.
#
# Every change is written to a drop-in, `sshd -t` validates the whole config,
# and the running daemon is only reloaded (never restarted) after it passes.
# A reload keeps existing sessions alive, so if something is still wrong the
# terminal that ran this script is still connected and can undo it.
#
# PasswordAuthentication is disabled only when at least one authorized key is
# already present — on GCE, keys are managed by the metadata server or OS Login,
# and disabling passwords with no key present would be irreversible.
log "SSH hardening"
if [[ -z "$ADMIN_USER" ]]; then
  warn "Skipped: no non-root user identified."
else
  KEYFILE="/home/${ADMIN_USER}/.ssh/authorized_keys"
  OS_LOGIN="$(curl -s -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/project/attributes/enable-oslogin' 2>/dev/null || true)"

  HAS_KEY=no
  [[ -s "$KEYFILE" ]] && HAS_KEY=yes
  [[ "${OS_LOGIN,,}" == "true" ]] && HAS_KEY=yes

  if [[ "$HAS_KEY" == "no" ]]; then
    warn "No authorized_keys for ${ADMIN_USER} and OS Login is not enabled."
    warn "Refusing to disable password authentication — that would lock you out."
    warn "SSH-in-browser will still work; re-run after a key is in place."
  else
    cat > /etc/ssh/sshd_config.d/60-douyin-hardening.conf <<'CONF'
# Managed by deploy/gce/bootstrap.sh. Delete this file and `systemctl reload ssh`
# to revert every setting below.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
CONF

    if sshd -t; then
      # reload, NOT restart: existing sessions survive, so a mistake here is
      # still recoverable from the terminal that made it.
      systemctl reload ssh || systemctl reload sshd
      echo "SSH hardened (config validated, daemon reloaded, sessions preserved)."
      warn "Before closing this session, open a SECOND SSH session to confirm access."
    else
      rm -f /etc/ssh/sshd_config.d/60-douyin-hardening.conf
      warn "sshd config failed validation — hardening reverted, nothing changed."
    fi
  fi
fi

# ------------------------------------------------------------ unattended security updates
log "Unattended security upgrades"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

log "Done"
cat <<SUMMARY

  swap        $(swapon --show --noheadings --bytes | awk '{printf "%.1fG ", $3/1073741824}')
  docker      $(docker --version 2>/dev/null || echo 'not installed')
  compose     $(docker compose version --short 2>/dev/null || echo 'not installed')
  nginx       $(nginx -v 2>&1)
  memory      $(free -h | awk '/^Mem:/{print $2" total, "$7" available"}')
  disk        $(df -h / | awk 'NR==2{print $4" available of "$2}')

Next:
  1. Open a SECOND SSH session now and confirm you can still get in.
  2. Copy the repo to this VM and create deploy/.env (chmod 600).
  3. Install the nginx site from deploy/nginx/, then run certbot.
  4. docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

SUMMARY
