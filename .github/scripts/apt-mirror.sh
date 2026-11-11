#!/bin/bash
# Make sure apt can reach an Ubuntu package mirror. GitHub's machines use
# Ubuntu's usual servers; when those don't answer (it happened on 11 Nov 2026),
# this switches to another official mirror so installs still work.
#   .github/scripts/apt-mirror.sh
set -u
codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
works() {
  local out
  out=$(sudo apt-get update 2>&1)
  ! grep -qE "Failed to fetch|Temporary failure resolving|Could not resolve|Unable to connect|Could not connect" <<<"$out"
}
if works; then echo "apt: Ubuntu's usual servers answer"; exit 0; fi
for m in http://azure.archive.ubuntu.com/ubuntu http://archive.ubuntu.com/ubuntu http://us.archive.ubuntu.com/ubuntu http://mirrors.edge.kernel.org/ubuntu; do
  sudo mkdir -p /etc/apt/sources-off
  sudo find /etc/apt/sources.list.d -maxdepth 1 -name '*.sources' -exec mv {} /etc/apt/sources-off/ \; 2>/dev/null
  [ -f /etc/apt/sources.list ] && sudo mv /etc/apt/sources.list /etc/apt/sources-off/ 2>/dev/null
  printf 'deb %s %s main restricted universe multiverse\ndeb %s %s-updates main restricted universe multiverse\ndeb %s %s-security main restricted universe multiverse\n' \
    "$m" "$codename" "$m" "$codename" "$m" "$codename" | sudo tee /etc/apt/sources.list.d/mirror.list >/dev/null
  if works; then echo "apt: Ubuntu's usual servers didn't answer; using $m"; exit 0; fi
done
echo "::warning::No Ubuntu package mirror answered"
exit 0
