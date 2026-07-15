#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD_DIR=${BUILD_DIR:-"$ROOT/build"}
MACOSX_DEPLOYMENT_TARGET=${MACOSX_DEPLOYMENT_TARGET:-11.0}
export MACOSX_DEPLOYMENT_TARGET
LIBUSB_VERSION=1.0.30
LIBUSB_ARCHIVE="libusb-${LIBUSB_VERSION}.tar.bz2"
LIBUSB_SHA256=fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf
LIBUSB_URL="https://github.com/libusb/libusb/releases/download/v${LIBUSB_VERSION}/${LIBUSB_ARCHIVE}"
DEPS_DIR="$BUILD_DIR/deps"
SOURCE_DIR="$DEPS_DIR/libusb-source-macos-${MACOSX_DEPLOYMENT_TARGET}"
LIBUSB_BUILD_DIR="$DEPS_DIR/libusb-build-macos-${MACOSX_DEPLOYMENT_TARGET}"
PREFIX_DIR="$DEPS_DIR/libusb-macos-${MACOSX_DEPLOYMENT_TARGET}"

mkdir -p "$DEPS_DIR"

if [ ! -f "$DEPS_DIR/$LIBUSB_ARCHIVE" ]; then
  if [ -f "$ROOT/vendor/$LIBUSB_ARCHIVE" ]; then
    cp "$ROOT/vendor/$LIBUSB_ARCHIVE" "$DEPS_DIR/$LIBUSB_ARCHIVE"
  else
    curl -fL "$LIBUSB_URL" -o "$DEPS_DIR/$LIBUSB_ARCHIVE"
  fi
fi

printf '%s  %s\n' "$LIBUSB_SHA256" "$DEPS_DIR/$LIBUSB_ARCHIVE" | shasum -a 256 -c -

if [ ! -d "$SOURCE_DIR" ]; then
  mkdir -p "$SOURCE_DIR"
  tar -xjf "$DEPS_DIR/$LIBUSB_ARCHIVE" --strip-components=1 -C "$SOURCE_DIR"
fi

if [ ! -f "$PREFIX_DIR/lib/libusb-1.0.a" ]; then
  mkdir -p "$LIBUSB_BUILD_DIR"
  (
    cd "$LIBUSB_BUILD_DIR"
    "$SOURCE_DIR/configure" --prefix="$PREFIX_DIR" --enable-static --disable-shared
    make -j"$(sysctl -n hw.logicalcpu)"
    make install
  )
fi

make -f "$ROOT/Makefile.macos" -C "$ROOT" \
  BUILD_DIR="$BUILD_DIR" \
  LIBUSB_PREFIX="$PREFIX_DIR" \
  MACOSX_DEPLOYMENT_TARGET="$MACOSX_DEPLOYMENT_TARGET"

echo "Built $BUILD_DIR/rioutil"
