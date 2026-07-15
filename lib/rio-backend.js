const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readAudioMetadata } = require('./id3-metadata');
const { normalizeBackendError, normalizeTransferError, parseSnapshot } = require('./rio-parser');

const DEMO_SNAPSHOT = {
  state: 'connected',
  message: '',
  device: {
    connected: true,
    name: 'Rio 800',
    firmware: '2.15',
    serial: '00112233445566778899aabbccddeeff',
    memories: [
      { id: 0, name: 'Internal memory', freeMiB: 38.4, totalMiB: 64, usedMiB: 25.6, files: 5, duration: 1131 },
      { id: 1, name: 'External memory', freeMiB: 21.2, totalMiB: 32, usedMiB: 10.8, files: 2, duration: 455 }
    ]
  },
  tracks: [
    { id: 1, title: 'Teardrop', filename: 'teardrop.mp3', artist: 'Massive Attack', album: 'Mezzanine', duration: 331, sizeKiB: 5190, bitrate: 128, memoryId: 0 },
    { id: 2, title: 'Such Great Heights', filename: 'greatheights.mp3', artist: 'The Postal Service', album: 'Give Up', duration: 266, sizeKiB: 4210, bitrate: 128, memoryId: 0 },
    { id: 3, title: 'Roads', filename: 'roads.mp3', artist: 'Portishead', album: 'Dummy', duration: 303, sizeKiB: 4798, bitrate: 128, memoryId: 0 },
    { id: 4, title: 'Playground Love', filename: 'playground.mp3', artist: 'Air', album: 'The Virgin Suicides', duration: 212, sizeKiB: 3374, bitrate: 128, memoryId: 0 },
    { id: 5, title: 'Cherry-coloured Funk', filename: 'cherry.mp3', artist: 'Cocteau Twins', album: 'Heaven or Las Vegas', duration: 192, sizeKiB: 3049, bitrate: 128, memoryId: 0 },
    { id: 1, title: 'Svefn-g-englar', filename: 'svefn.mp3', artist: 'Sigur Ros', album: 'Agaetis byrjun', duration: 407, sizeKiB: 6472, bitrate: 128, memoryId: 1 },
    { id: 2, title: 'Avril 14th', filename: 'avril14.mp3', artist: 'Aphex Twin', album: 'Drukqs', duration: 128, sizeKiB: 2035, bitrate: 128, memoryId: 1 }
  ]
};

class RioBackend {
  constructor({ rootDir, resourcesDir, isPackaged, demo = false, dataDir = null }) {
    this.rootDir = rootDir;
    this.resourcesDir = resourcesDir;
    this.isPackaged = isPackaged;
    this.demo = demo;
    this.activeProcess = null;
    this.operationRunning = false;
    this.probeCooldownUntil = 0;
    this.commandQueue = Promise.resolve();
    this.dataChannelFault = null;
    this.dataDir = dataDir;
    this.metadataPath = dataDir ? path.join(dataDir, 'metadata-cache.json') : null;
    this.metadataCache = this.loadMetadataCache();
    this.deviceSerial = '';
  }

  loadMetadataCache() {
    if (!this.metadataPath) return {};
    try {
      const cache = JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
      return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
    } catch {
      return {};
    }
  }

  async saveMetadataCache() {
    if (!this.metadataPath) return;
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await fs.promises.writeFile(this.metadataPath, JSON.stringify(this.metadataCache, null, 2));
  }

  async saveBackendDiagnostic(operation, error) {
    if (!this.dataDir) return;
    const details = [
      `time: ${new Date().toISOString()}`,
      `operation: ${operation}`,
      `exit: ${error.code ?? error.signal ?? 'unknown'}`,
      '',
      'stdout:',
      error.stdout || '',
      '',
      'stderr:',
      error.stderr || '',
      '',
      'error:',
      error.message || String(error)
    ].join('\n');

    try {
      await fs.promises.mkdir(this.dataDir, { recursive: true });
      await fs.promises.writeFile(path.join(this.dataDir, 'last-backend-error.log'), details);
    } catch {
      // Diagnostics must never replace the original device error.
    }
  }

  normalizeAndRememberError(error) {
    const normalized = normalizeBackendError(error);
    if (normalized.code === 'data-channel-timeout') {
      this.dataChannelFault = normalized;
    }
    return normalized;
  }

  currentDataChannelFault() {
    return this.dataChannelFault ? { ...this.dataChannelFault } : null;
  }

  metadataKey(serial, track) {
    return [
      serial || 'rio800',
      track.memoryId,
      String(track.filename || '').normalize('NFC').toLowerCase(),
      track.sizeKiB || 0,
      track.duration || 0
    ].join('|');
  }

  applyCachedMetadata(snapshot) {
    if (!snapshot || snapshot.state !== 'connected' || !snapshot.device) return snapshot;
    this.deviceSerial = snapshot.device.serial || this.deviceSerial;
    for (const track of snapshot.tracks || []) {
      const metadata = this.metadataCache[this.metadataKey(this.deviceSerial, track)];
      if (!metadata) continue;
      if (!track.artist) track.artist = metadata.artist || '';
      if (!track.album) track.album = metadata.album || '';
    }
    return snapshot;
  }

  async rememberUploads(snapshot, memoryId, sources) {
    if (!snapshot || snapshot.state !== 'connected') return;
    this.deviceSerial = snapshot.device.serial || this.deviceSerial;
    const candidates = (snapshot.tracks || [])
      .filter((track) => track.memoryId === memoryId)
      .sort((left, right) => right.id - left.id);
    const used = new Set();

    for (const source of sources) {
      const filename = path.basename(source.file).normalize('NFC').toLowerCase();
      const track = candidates.find((candidate) => !used.has(candidate)
        && String(candidate.filename || '').normalize('NFC').toLowerCase() === filename
        && Math.abs((candidate.sizeKiB || 0) - source.sizeKiB) <= 4);
      if (!track) continue;
      used.add(track);
      this.metadataCache[this.metadataKey(this.deviceSerial, track)] = source.metadata;
    }
    await this.saveMetadataCache();
  }

  executablePath() {
    const platformDir = process.platform === 'win32' ? 'win32-x64' : 'macos-arm64';
    const filename = process.platform === 'win32' ? 'rioutil.exe' : 'rioutil';
    const base = this.isPackaged
      ? path.join(this.resourcesDir, 'backend')
      : path.join(this.rootDir, 'backend');
    return path.join(base, platformDir, filename);
  }

  run(args, options = {}) {
    const execute = () => this.runNow(args, options);
    const result = this.commandQueue.then(execute, execute);
    this.commandQueue = result.catch(() => {});
    return result;
  }

  runNow(args, { machine = false, env = {}, onStdout = null } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executablePath(), args, {
        env: { ...process.env, ...(machine ? { RIOUTIL_MACHINE: '1' } : {}), ...env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.activeProcess = child;

      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (onStdout) onStdout(chunk);
      });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('error', (error) => {
        this.activeProcess = null;
        reject(Object.assign(error, { stdout, stderr }));
      });

      child.on('close', (code, signal) => {
        this.activeProcess = null;
        if (code === 0) resolve({ stdout, stderr });
        else reject(Object.assign(new Error(`rioutil exited with ${code ?? signal}`), { code, signal, stdout, stderr }));
      });
    });
  }

  async getSnapshot({ force = false } = {}) {
    if (this.demo) return structuredClone(DEMO_SNAPSHOT);
    if (this.operationRunning) return { state: 'busy', message: '设备正在处理传输任务。' };
    if (this.dataChannelFault && !force) return this.currentDataChannelFault();

    try {
      const { stdout } = await this.run(['--nocolor', '--info', '--list'], { machine: true });
      this.dataChannelFault = null;
      return this.applyCachedMetadata(parseSnapshot(stdout));
    } catch (error) {
      await this.saveBackendDiagnostic('snapshot', error);
      return this.normalizeAndRememberError(error);
    }
  }

  async probe() {
    if (this.demo) return { state: 'connected' };
    if (this.operationRunning) return { state: 'busy' };
    if (Date.now() < this.probeCooldownUntil) return { state: 'busy' };

    try {
      await this.run(['--nocolor', '--probe']);
      if (this.dataChannelFault) return this.currentDataChannelFault();
      return { state: 'connected' };
    } catch (error) {
      const normalized = normalizeBackendError(error);
      if (normalized.state === 'disconnected') this.dataChannelFault = null;
      else if (normalized.code === 'data-channel-timeout') this.dataChannelFault = normalized;
      return normalized;
    }
  }

  async upload({ files, memoryId = 0 }, notify = () => {}) {
    if (!Array.isArray(files) || files.length === 0) return { ok: false, message: '没有选择音乐文件。' };
    if (this.operationRunning) return { ok: false, message: '已有任务正在进行。' };
    if (this.dataChannelFault) return { ok: false, message: this.dataChannelFault.message };

    const sources = [];
    for (const file of files) {
      if (!/\.(mp3|wma|wav)$/i.test(file)) {
        return { ok: false, message: '请选择 MP3、WMA 或 WAV 音频文件。' };
      }
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) return { ok: false, message: '所选项目不是普通文件。' };
        let metadata = { title: '', artist: '', album: '' };
        try {
          metadata = await readAudioMetadata(file);
        } catch {
          // Metadata is optional; the transfer backend still validates the audio itself.
        }
        sources.push({ file, sizeKiB: Math.floor(stat.size / 1024), metadata });
      } catch {
        return { ok: false, message: '无法读取所选文件。它可能已被移动或没有访问权限。' };
      }
    }

    this.operationRunning = true;

    try {
      notify({ type: 'upload', index: 0, total: files.length, file: path.basename(files[0]), status: 'running' });

      if (!this.demo) {
        const args = ['--nocolor', '--memory', String(memoryId)];
        files.forEach((file) => args.push('--upload', file));
        let progressBuffer = '';
        let currentFile = -1;
        const emitProgress = (index) => notify({
          type: 'upload',
          index: Math.min(files.length, Math.max(0, index)),
          total: files.length,
          file: path.basename(files[Math.max(0, currentFile)] || files[0]),
          status: 'running'
        });
        const onStdout = (chunk) => {
          progressBuffer += chunk;
          let newline;

          while ((newline = progressBuffer.indexOf('\n')) !== -1) {
            const line = progressBuffer.slice(0, newline).trim();
            progressBuffer = progressBuffer.slice(newline + 1);

            if (line === 'RIOFILEBEGIN') {
              currentFile = Math.min(currentFile + 1, files.length - 1);
              continue;
            }

            const progress = /^RIOPROGRESS:(\d+):(\d+)$/.exec(line);
            if (progress) {
              if (currentFile < 0) currentFile = 0;
              const current = Number.parseInt(progress[1], 10);
              const total = Number.parseInt(progress[2], 10);
              emitProgress(currentFile + (total > 0 ? current / total : 0));
              continue;
            }

            const end = /^RIOFILEEND:(-?\d+)$/.exec(line);
            if (end && Number.parseInt(end[1], 10) === 0) {
              if (currentFile < 0) currentFile = 0;
              emitProgress(currentFile + 1);
            }
          }
        };
        const { stdout } = await this.run(args, {
          machine: true,
          env: {
            RIOUTIL_AFTER_UPLOAD_SNAPSHOT: '1',
            RIOUTIL_MACHINE_PROGRESS: '1'
          },
          onStdout
        });
        const snapshot = parseSnapshot(stdout);
        await this.rememberUploads(snapshot, memoryId, sources);
        this.applyCachedMetadata(snapshot);
        this.dataChannelFault = null;
        notify({ type: 'upload', index: files.length, total: files.length, status: 'complete' });
        return { ok: true, snapshot };
      }

      for (let index = 0; index < files.length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        notify({ type: 'upload', index: index + 1, total: files.length, file: path.basename(files[index]), status: 'running' });
      }
      notify({ type: 'upload', index: files.length, total: files.length, status: 'complete' });
      return { ok: true, snapshot: structuredClone(DEMO_SNAPSHOT) };
    } catch (error) {
      await this.saveBackendDiagnostic('upload', error);
      this.normalizeAndRememberError(error);
      const normalized = normalizeTransferError(error);
      notify({ type: 'upload', status: 'error', message: normalized.message });
      return { ok: false, message: normalized.message };
    } finally {
      this.operationRunning = false;
    }
  }

  async deleteTracks({ tracks }, notify) {
    if (!Array.isArray(tracks) || tracks.length === 0) return { ok: false, message: '没有选择歌曲。' };
    if (this.operationRunning) return { ok: false, message: '已有任务正在进行。' };
    if (this.dataChannelFault) return { ok: false, message: this.dataChannelFault.message };
    notify = notify || (() => {});
    this.operationRunning = true;

    try {
      const deletionOrder = [...tracks].sort((left, right) =>
        left.memoryId - right.memoryId || right.id - left.id);
      const groups = [];

      for (const track of deletionOrder) {
        const currentGroup = groups.at(-1);
        if (!currentGroup || currentGroup.memoryId !== track.memoryId) {
          groups.push({ memoryId: track.memoryId, tracks: [track] });
        } else {
          currentGroup.tracks.push(track);
        }
      }

      let deleted = 0;
      let snapshot = null;
      for (const group of groups) {
        notify({
          type: 'delete',
          index: deleted,
          total: deletionOrder.length,
          file: group.tracks[0].title,
          status: 'running'
        });

        if (!this.demo) {
          const ids = group.tracks.map((track) => track.id).join(' ');
          const result = await this.run(
            ['--nocolor', '--memory', String(group.memoryId), '--delete', ids],
            {
              machine: true,
              env: { RIOUTIL_AFTER_DELETE_SNAPSHOT: '1' }
            }
          );
          snapshot = this.applyCachedMetadata(parseSnapshot(result.stdout));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 300 * group.tracks.length));
          snapshot = structuredClone(DEMO_SNAPSHOT);
        }

        deleted += group.tracks.length;
      }
      this.probeCooldownUntil = Date.now() + 5000;
      this.dataChannelFault = null;
      notify({ type: 'delete', index: deletionOrder.length, total: deletionOrder.length, status: 'complete' });
      return { ok: true, snapshot };
    } catch (error) {
      await this.saveBackendDiagnostic('delete', error);
      const normalized = this.normalizeAndRememberError(error);
      notify({ type: 'delete', status: 'error', message: normalized.message });
      return { ok: false, message: normalized.message };
    } finally {
      this.operationRunning = false;
    }
  }

  cancel() {
    if (!this.activeProcess) return false;
    this.activeProcess.kill('SIGTERM');
    this.activeProcess = null;
    this.operationRunning = false;
    return true;
  }
}

module.exports = { RioBackend };
