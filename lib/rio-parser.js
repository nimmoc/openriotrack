function parseDuration(value) {
  const parts = value.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseInfo(output) {
  const device = {
    connected: true,
    name: 'Rio 800',
    firmware: '',
    serial: '',
    memories: []
  };

  let currentMemory = null;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    let match;

    if ((match = line.match(/^Name:\s*(.+)$/))) device.name = match[1].trim();
    else if ((match = line.match(/^Serial Number:\s*([0-9a-f]+)$/i))) device.serial = match[1];
    else if ((match = line.match(/^Firmware Version:\s*(.+)$/))) device.firmware = match[1].trim();
    else if ((match = line.match(/^Memory unit\s+(\d+):\s*(.+)$/))) {
      currentMemory = {
        id: Number.parseInt(match[1], 10),
        name: match[2].trim(),
        freeMiB: 0,
        totalMiB: 0,
        usedMiB: 0,
        files: 0,
        duration: 0
      };
      device.memories.push(currentMemory);
    } else if (currentMemory && (match = line.match(/^Free:\s*([0-9.]+)\s*MiB\s*\(([0-9.]+)\s*MiB Total\)$/))) {
      currentMemory.freeMiB = Number.parseFloat(match[1]);
      currentMemory.totalMiB = Number.parseFloat(match[2]);
    } else if (currentMemory && (match = line.match(/^Used:\s*([0-9.]+)\s*MiB in\s*(\d+)\s*files$/))) {
      currentMemory.usedMiB = Number.parseFloat(match[1]);
      currentMemory.files = Number.parseInt(match[2], 10);
    } else if (currentMemory && (match = line.match(/^Total Time:\s*([0-9:]+)$/))) {
      currentMemory.duration = parseDuration(match[1]);
    }
  }

  return device;
}

function parseTracks(output, memories) {
  const machineTracks = output.split(/\r?\n/)
    .filter((line) => line.startsWith('RIOJSON:'))
    .map((line) => JSON.parse(line.slice('RIOJSON:'.length)))
    .filter((track) => track.duration > 0 || /\.(mp3|wma|wav)$/i.test(track.filename));

  if (machineTracks.length > 0) return machineTracks;

  const tracks = [];
  const memoryByName = new Map(memories.map((memory) => [memory.name, memory.id]));
  let memoryId = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.endsWith(':') && memoryByName.has(line.slice(0, -1))) {
      memoryId = memoryByName.get(line.slice(0, -1));
      continue;
    }

    const match = line.match(/^(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(\d+):(\d{2})\s+(\d+)\s+(\d+)\s+0x([0-9a-f]+)\s+(\d+)$/i);
    if (!match) continue;

    const track = {
      id: Number.parseInt(match[1], 10),
      title: match[2].trim() || match[3].trim(),
      filename: match[3].trim(),
      artist: '',
      album: '',
      duration: Number.parseInt(match[4], 10) * 60 + Number.parseInt(match[5], 10),
      sizeKiB: Number.parseInt(match[6], 10),
      bitrate: Number.parseInt(match[7], 10),
      rioNumber: Number.parseInt(match[8], 16),
      internalNumber: Number.parseInt(match[9], 10),
      memoryId
    };

    if (track.duration > 0 || /\.(mp3|wma|wav)$/i.test(track.filename)) tracks.push(track);
  }

  return tracks;
}

function parseSnapshot(output) {
  const device = parseInfo(output);
  return {
    state: 'connected',
    device,
    tracks: parseTracks(output, device.memories),
    message: ''
  };
}

function normalizeBackendError(error) {
  const text = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
  if (/no such device|no such file or directory|device not found|not found/i.test(text)) {
    return { state: 'disconnected', message: '未检测到 Rio 800。请连接 USB 后重新刷新。' };
  }
  if (/timed out|connection timed out|read_bulk\(\).*rc\s*=\s*-7/i.test(text)) {
    return {
      state: 'error',
      code: 'data-channel-timeout',
      message: 'Rio 800 数据通道超时。请断开 USB 并让播放器完全断电后再连接。',
      detail: text.trim()
    };
  }
  if (/access denied|permission denied|not permitted|busy/i.test(text)) {
    return { state: 'permission', message: '系统未允许访问 Rio 800。请检查 USB 驱动或访问权限。' };
  }
  return { state: 'error', message: '读取设备失败。请重新连接设备后再试。', detail: text.trim() };
}

function normalizeTransferError(error) {
  const text = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');

  if (/no space left|insufficient space|enospc/i.test(text)) {
    return { state: 'error', message: '当前存储空间不足。请选择另一个存储区或先释放空间。', detail: text.trim() };
  }
  if (/error getting song info|invalid (mpeg|mp3)|unsupported audio/i.test(text)) {
    return { state: 'error', message: '无法解析这个音频文件。请确认它是有效的 MP3、WMA 或 WAV 文件。', detail: text.trim() };
  }
  if (/could not stat file|not a regular file/i.test(text)) {
    return { state: 'error', message: '无法读取所选文件。它可能已被移动或没有访问权限。', detail: text.trim() };
  }
  if (/invalid argument for --memory|outside the valid range/i.test(text)) {
    return { state: 'error', message: '所选存储区不可用。请刷新设备后重试。', detail: text.trim() };
  }

  return normalizeBackendError(error);
}

module.exports = { normalizeBackendError, normalizeTransferError, parseInfo, parseSnapshot, parseTracks };
