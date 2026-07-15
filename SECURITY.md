# Security Policy

## Supported version

OpenRioTrack 1.0 is the currently supported release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature in the repository Security tab. Do not publish device-destructive test cases, private data, or working exploits in a public issue.

## Runtime model

OpenRioTrack loads its interface from files bundled with the application and does not require remote web content. The renderer runs with Electron sandboxing and context isolation enabled, Node.js integration disabled, external navigation and new windows blocked, and browser permission requests denied. Rio USB access is handled by the bundled native backend rather than WebUSB.

## Electron and macOS 11

The macOS 1.0 release uses Electron 33.4.11 because Electron 38 and later no longer support macOS 11 Big Sur. This preserves the stated macOS 11 minimum but means some upstream Electron advisories cannot be resolved without raising the operating-system requirement. The application minimizes exposure by using only bundled local content and the restrictions listed above. Production npm dependencies currently report no known vulnerabilities.

Future releases may raise the minimum macOS version to adopt a newer supported Electron line.
