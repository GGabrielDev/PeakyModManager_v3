# Packaged Linux validation

`node scripts/smoke/linux-runtime.mjs /absolute/path/to/packaged/executable` runs actual packaged Electron IPC, rendered-window launch, bundled archive extraction, real archive import/library persistence, and cold/running URL handoff against an isolated loopback fixture server. It sets temporary XDG/user-data paths; no user library or desktop handler is intentionally changed. Results record revision, version, binary hash, architecture and stderr in `smoke-results/linux-runtime.json`. Failure is a nonzero exit, suitable for required CI; the script leaves failed fixture directories for diagnosis. Use Node 24 and Python 3.12.

Headless Linux needs Xvfb and Electron's runtime libraries. Run `xvfb-run -a node scripts/smoke/linux-runtime.mjs dist/linux-unpacked/peakymodmanager-v3`. If the packaged setuid sandbox is required, set root ownership and mode 4755 on that exact `chrome-sandbox` binary in the disposable runner. This is narrowly scoped runner setup; no global AppArmor disablement or unrestricted `--no-sandbox` is prescribed. AppImage mount/FUSE behavior is distinct from unpacked runtime proof.

| Check                            | Automation                                                      | Remaining evidence                                             |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Packaged window/preload/IPC      | Included                                                        | Real GNOME/KDE and Wayland/X11 focus                           |
| Bundled ZIP/7z/RAR/TAR           | Included, Unicode/spaces, payload and Unix file/directory modes | Host filesystem permission matrix                              |
| Archive import and persistence   | Included, actual IPC/files/process restart                      | External drives and overwrite/recovery                         |
| Cold/running URL import          | Included, actual executable and local HTTP                      | Real browser/portal handoff                                    |
| Startup races/multiple URLs      | Not yet proven                                                  | Queue implementation #5 and consumer-ready tests               |
| N→N+1 update                     | Pending                                                         | Staged update/recovery implementation #2                       |
| Native install/upgrade/uninstall | Package-manager containers in package-lifecycle.cjs             | Disposable distro hosts and desktop gate #13                   |
| Apply/runtime INI safety         | Existing source regression tests                                | Packaged filesystem matrix after #6/#7                         |
| Steam discovery                  | Pending implementation #14                                      | Native ZZZ/ZZMI layout/ambiguity fixtures and human game proof |

The CI workflow in #12 consumes this entry point and always uploads its diagnostics. It must not substitute source tests for packaged results or mark missing coverage as passed. Issue #13 owns native/confined browser, desktop, drag/drop, external drive, Wine/Proton and game validation. This is a staged, bounded gate, not a support certification.

Preflight revision/hash failures also write failed machine-readable evidence. URL success requires payload bytes, executable/restricted modes and loaded library metadata; both imports are verified again after a final process restart. Archive fixtures exercise modes 0751, 0750 and 0640 for ZIP, 7z, TAR and Unix RAR.
