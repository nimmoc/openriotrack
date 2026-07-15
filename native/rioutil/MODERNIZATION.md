# Rio 800 modern macOS port

This branch keeps the original `rioutil` protocol implementation and replaces
the obsolete platform assumptions needed for current macOS systems.

## Build

Run:

```sh
./scripts/build-macos.sh
```

The script downloads the official libusb 1.0.30 source archive, verifies its
SHA-256 digest, builds it statically, and writes a self-contained executable to
`build/rioutil`. The default deployment target is macOS 11.0 and can be
overridden with `MACOSX_DEPLOYMENT_TARGET`.

### Windows 11 x64 backend

Install Zig 0.14 or newer, then run:

```sh
ZIG=/path/to/zig ./scripts/build-windows.sh
```

This produces `build-windows/rioutil.exe`. The executable statically includes
libusb's Windows backend. A Rio 800 (`045A:5002`) must be bound to WinUSB before
the executable can access it on Windows 11.

## Safe first test

Connect and power on the Rio 800, then run only these read operations first:

```sh
./build/rioutil --info
./build/rioutil --list
```

Do not use `--format` or `--update` until device identification, storage
information, and track listing have all succeeded. Test uploading with one
disposable MP3 before transferring a library.

## Device identity

The Rio 800 is USB vendor `045a`, product `5002`. It uses bulk endpoint 2 for
both input and output and the generation-3 Rio transfer protocol.

## Licensing

The command-line program remains GPL-2.0-or-later. The `librioutil` library and
libusb are distributed under their respective LGPL licenses. See `COPYING` and
`COPYING.LESSER`.
