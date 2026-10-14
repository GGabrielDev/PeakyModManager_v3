#!/bin/bash
# Runs only inside disposable package-manager containers.
set -euo pipefail
kind=$1
package_name=$2
executable=$3
install_name=$4
export DEBIAN_FRONTEND=noninteractive
case "$kind" in
  deb) apt-get update; apt-get install -y xdg-utils desktop-file-utils ;;
  rpm) dnf --setopt=install_weak_deps=False install -y xdg-utils desktop-file-utils diffutils ;;
  arch)
    pacman -Syu --noconfirm --needed base-devel gtk3 nss libxss alsa-lib xdg-utils desktop-file-utils
    useradd -m builder
    ;;
esac
mkdir -p /root/.config/pmm-lifecycle /usr/share/applications
printf '%s\n' 'preserve user data' > /root/.config/pmm-lifecycle/user-data
printf '%s\n' '[Default Applications]' 'x-scheme-handler/peakymodmanager=unrelated.desktop;' > /root/.config/mimeapps.list
printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=Unrelated installation' 'Exec=/bin/true' 'MimeType=x-scheme-handler/peakymodmanager;' > /usr/share/applications/unrelated.desktop
cp /usr/share/applications/unrelated.desktop /tmp/unrelated.desktop
check_preserved() {
  test "$(cat /root/.config/pmm-lifecycle/user-data)" = 'preserve user data'
  cmp /usr/share/applications/unrelated.desktop /tmp/unrelated.desktop
  test "$(cat /root/.config/mimeapps.list)" = $'[Default Applications]\nx-scheme-handler/peakymodmanager=unrelated.desktop;'
}
install_version() {
  local directory=$1
  case "$kind" in
    deb) apt-get install -y "$directory"/*.deb ;;
    rpm) dnf --setopt=install_weak_deps=False install -y "$directory"/*.rpm ;;
    arch)
      rm -rf /home/builder/package
      install -d -o builder -g builder /home/builder/package
      cp "$directory/PKGBUILD" /home/builder/package/
      cp "$directory"/*.AppImage /home/builder/package/pmm.AppImage
      sed -i "s|^source=.*|source=('pmm.AppImage')|" /home/builder/package/PKGBUILD
      chown -R builder:builder /home/builder/package
      su builder -c 'cd ~/package && makepkg --nodeps --noconfirm'
      pacman -U --noconfirm /home/builder/package/*.pkg.tar.zst
      ;;
  esac
  test -x "/usr/bin/$executable"
  test -d "/opt/$install_name"
  test -f "/usr/share/applications/$executable.desktop"
  check_preserved
}
installed_version() {
  case "$kind" in
    deb) dpkg-query -W -f='${Version}' "$package_name" ;;
    rpm) rpm -q --queryformat '%{VERSION}' "$package_name" ;;
    arch) pacman -Q "$package_name" | cut -d ' ' -f2 ;;
  esac
}
install_version /previous
previous_version=$(installed_version)
install_version /next
next_version=$(installed_version)
test "$previous_version" != "$next_version"
case "$kind" in
  deb) apt-get remove -y "$package_name" ;;
  rpm) dnf remove -y "$package_name" ;;
  arch) pacman -R --noconfirm "$package_name" ;;
esac
test ! -e "/usr/bin/$executable"
test ! -L "/usr/bin/$executable"
test ! -e "/usr/share/applications/$executable.desktop"
test ! -d "/opt/$install_name"
check_preserved
printf 'Lifecycle passed: %s -> %s -> removed\n' "$previous_version" "$next_version"
