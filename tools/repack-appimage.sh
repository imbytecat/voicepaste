#!/usr/bin/env bash
# Repack the AppImage without the Wayland libraries linuxdeploy-plugin-gtk drags in.
#
# libwayland-{client,cursor,egl,server} are on the AppImage excludelist because the
# host owns them: AppRun puts $APPDIR/usr/lib first on LD_LIBRARY_PATH, so a bundled
# Ubuntu libwayland shadows the host copy, glvnd can no longer load libEGL_mesa, and
# WebKit aborts with "Could not create default EGL display: EGL_BAD_PARAMETER" on
# every distribution whose Wayland/Mesa pair differs from the build machine's.
#
# Tauri has no hook between linuxdeploy and the AppImage packing step, so the AppDir
# is cleaned up and repacked here, then re-signed because the file changed.
set -euo pipefail

bundle_dir="src-tauri/target/release/bundle/appimage"
appdir="$(find "$bundle_dir" -maxdepth 1 -name '*.AppDir' -print -quit)"
appimage="$(find "$bundle_dir" -maxdepth 1 -name '*.AppImage' -print -quit)"

if [ -z "$appdir" ] || [ -z "$appimage" ]; then
  echo "找不到 AppDir 或 AppImage，$bundle_dir 里没有可修复的产物" >&2
  exit 1
fi

removed=0
for library in libwayland-client.so.0 libwayland-cursor.so.0 libwayland-egl.so.1 libwayland-server.so.0; do
  if [ -e "$appdir/usr/lib/$library" ]; then
    rm -f "$appdir/usr/lib/$library"
    removed=$((removed + 1))
  fi
done
echo "从 AppDir 移除 $removed 个宿主自带的 Wayland 库"

packer="$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage"
if [ ! -x "$packer" ]; then
  packer="$(mktemp -d)/appimagetool.AppImage"
  curl -fsSL -o "$packer" \
    https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$packer"
fi

rm -f "$appimage" "$appimage.sig"
env OUTPUT="$appimage" ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 \
  "$packer" --appimage-extract-and-run --appdir "$appdir"
test -f "$appimage"

pnpm tauri signer sign "$appimage"
test -f "$appimage.sig"
echo "已重新打包并签名 $appimage"
