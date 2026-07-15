# Third-Party Notices

OpenRioTrack includes or builds upon the following open-source projects. Their original copyright notices and license terms remain in effect.

## rioutil

- Project: [hjelmn/rioutil](https://github.com/hjelmn/rioutil)
- Upstream base: commit `100860355caa921f2834e75284e1c04ca6cb1dcb`
- Original authors: Nathan Hjelm, Jasper Wallace, and contributors listed in `native/rioutil/AUTHORS`
- License: the command-line program is GPL-2.0-or-later; `librioutil` is LGPL-2.1-or-later

OpenRioTrack contains a modified port for current macOS systems and the Rio 800. The complete maintained source is provided in `native/rioutil`. See `native/rioutil/COPYING`, `native/rioutil/COPYING.LESSER`, the original source headers, and `native/rioutil/MODERNIZATION.md`.

## libusb

- Project: [libusb/libusb](https://github.com/libusb/libusb)
- Version: 1.0.30
- License: LGPL-2.1-or-later

The macOS backend statically links libusb. The verified upstream source archive is provided at `native/rioutil/vendor/libusb-1.0.30.tar.bz2`; the license is also copied to `licenses/libusb/COPYING`.

## Lucide

- Project: [lucide-icons/lucide](https://github.com/lucide-icons/lucide)
- Version: 0.468.0
- License: ISC, with portions derived from Feather under the MIT License

See `licenses/lucide/LICENSE`.

## Electron

- Project: [electron/electron](https://github.com/electron/electron)
- Packaged version: 33.4.11
- License: MIT

Electron distributions include their own license file and Chromium third-party notices inside the application bundle.
