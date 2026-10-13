#!/bin/bash
# RPM passes the remaining installation count; dpkg passes a removal action.
# An old version's post-uninstall hook must not unregister its replacement.
case "$1" in
  0|remove|purge) ;;
  *) exit 0 ;;
esac

if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
elif [ "$(readlink '/usr/bin/${executable}')" = '/opt/${sanitizedProductName}/${executable}' ]; then
  rm -f '/usr/bin/${executable}'
fi
