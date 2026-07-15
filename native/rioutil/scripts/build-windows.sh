#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build-windows"
LIBUSB_SRC="$BUILD_DIR/libusb-win-src"
ZIG="${ZIG:-zig}"

mkdir -p "$LIBUSB_SRC"

if [[ ! -f "$LIBUSB_SRC/config.h" ]]; then
  tar -xf "$ROOT_DIR/vendor/libusb-1.0.30.tar.bz2" --strip-components=1 -C "$LIBUSB_SRC"

  (
    cd "$LIBUSB_SRC"
    CC="$ZIG cc -target x86_64-windows-gnu" \
    CXX="$ZIG c++ -target x86_64-windows-gnu" \
    AR="$ZIG ar" \
    RANLIB="$ZIG ranlib" \
      ./configure \
        --host=x86_64-w64-mingw32 \
        --disable-shared \
        --enable-static \
        --disable-udev
  )
fi

make -C "$ROOT_DIR" -f Makefile.windows ZIG="$ZIG"
