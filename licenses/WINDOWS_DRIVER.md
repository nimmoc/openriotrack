# Windows 11 驱动说明

OpenRioTrack 通过 WinUSB 访问 Rio 800。Windows 11 首次使用时，需要将设备绑定到 WinUSB 驱动。

设备标识：`USB\VID_045A&PID_5002`

安装前请确认：

1. Rio 800 已通过 USB 连接并正常供电。
2. 使用经过签名的 WinUSB 驱动包，或在测试环境中启用测试签名后安装测试驱动。
3. 驱动安装完成后，重新打开 OpenRioTrack。

旧版 `RIOUNIV.sys` 是 32 位 Windows XP 驱动，不能直接安装到 64 位 Windows 11。
