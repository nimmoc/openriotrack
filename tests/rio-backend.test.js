const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { RioBackend } = require('../lib/rio-backend');

test('uploads a selected file to the requested memory unit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rio800-upload-'));
  const file = path.join(directory, 'song.mp3');
  await fs.writeFile(file, 'fixture');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  const calls = [];
  backend.run = async (args, options) => {
    calls.push({ args, options });
    return { stdout: 'Name: Rio 800\nMemory units: 0\n', stderr: '' };
  };

  const result = await backend.upload({ files: [file], memoryId: 1 }, () => {});

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, ['--nocolor', '--memory', '1', '--upload', file]);
  assert.equal(calls[0].options.machine, true);
  assert.deepEqual(calls[0].options.env, {
    RIOUTIL_AFTER_UPLOAD_SNAPSHOT: '1',
    RIOUTIL_MACHINE_PROGRESS: '1'
  });
  assert.equal(typeof calls[0].options.onStdout, 'function');
});

test('streams split backend progress records during an upload', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rio800-progress-'));
  const file = path.join(directory, 'song.mp3');
  await fs.writeFile(file, 'fixture');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  backend.run = async (_args, options) => {
    options.onStdout('RIOFILEBE');
    options.onStdout('GIN\nRIOPROGRESS:25:100\nRIOPRO');
    options.onStdout('GRESS:75:100\nRIOFILEEND:0\n');
    return { stdout: 'Name: Rio 800\nMemory units: 0\n', stderr: '' };
  };

  const updates = [];
  const result = await backend.upload({ files: [file], memoryId: 0 }, (progress) => updates.push(progress));

  assert.equal(result.ok, true);
  assert.ok(updates.some((progress) => progress.status === 'running' && progress.index === 0.25));
  assert.ok(updates.some((progress) => progress.status === 'running' && progress.index === 0.75));
  assert.ok(updates.some((progress) => progress.status === 'running' && progress.index === 1));
  assert.equal(updates.at(-1).status, 'complete');
});

test('restores locally cached artist and album after a Rio 800 upload', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rio800-metadata-'));
  const file = path.join(directory, 'song.mp3');
  const frame = (id, value) => {
    const body = Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]);
    const header = Buffer.alloc(10);
    header.write(id, 0, 'ascii');
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  const frames = Buffer.concat([
    frame('TIT2', '六层楼'),
    frame('TPE1', '宋冬野'),
    frame('TALB', '安和桥北')
  ]);
  const tagSize = Buffer.from([0, 0, 0, frames.length]);
  await fs.writeFile(file, Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'binary'), tagSize, frames]));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const backend = new RioBackend({
    rootDir: '.',
    resourcesDir: '.',
    isPackaged: false,
    dataDir: directory
  });
  backend.run = async () => ({
    stdout: [
      'Name: Rio 800',
      'Serial Number: 00112233445566778899aabbccddeeff',
      'Memory units: 1',
      'Memory unit 0: Internal memory',
      'RIOJSON:{"memoryId":0,"id":4,"rioNumber":5,"internalNumber":4,"duration":3,"sizeKiB":0,"bitrate":128,"trackNumber":0,"title":"六层楼","artist":"","album":"","filename":"song.mp3","year":"","genre":""}'
    ].join('\n'),
    stderr: ''
  });

  const result = await backend.upload({ files: [file], memoryId: 0 }, () => {});

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.tracks[0].artist, '宋冬野');
  assert.equal(result.snapshot.tracks[0].album, '安和桥北');
  await fs.access(path.join(directory, 'metadata-cache.json'));
});

test('probes the USB connection without retrieving the song list', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  const calls = [];
  backend.run = async (args, options) => {
    calls.push({ args, options });
    return { stdout: 'Rio connected\n', stderr: '' };
  };

  const result = await backend.probe();

  assert.deepEqual(result, { state: 'connected' });
  assert.deepEqual(calls, [{ args: ['--nocolor', '--probe'], options: undefined }]);
});

test('latches a data-channel timeout instead of reporting the enumerated USB device as connected', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  const calls = [];
  backend.run = async (args) => {
    calls.push(args);
    if (args.includes('--info')) {
      throw Object.assign(new Error('rioutil exited with 1'), {
        stderr: 'read_bulk() failed: Operation timed out'
      });
    }
    return { stdout: 'Rio connected\n', stderr: '' };
  };

  const snapshot = await backend.getSnapshot();
  const probe = await backend.probe();
  const cached = await backend.getSnapshot();

  assert.equal(snapshot.code, 'data-channel-timeout');
  assert.equal(probe.code, 'data-channel-timeout');
  assert.equal(cached.code, 'data-channel-timeout');
  assert.deepEqual(calls, [
    ['--nocolor', '--info', '--list'],
    ['--nocolor', '--probe']
  ]);
});

test('clears a latched data-channel timeout after a physical disconnect', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  let mode = 'timeout';
  backend.run = async (args) => {
    if (args.includes('--probe')) {
      throw Object.assign(new Error('rioutil exited with 1'), { stderr: 'No such device' });
    }
    if (mode === 'timeout') {
      throw Object.assign(new Error('rioutil exited with 1'), { stderr: 'Operation timed out' });
    }
    return { stdout: 'Name: Rio 800\nMemory units: 0\n', stderr: '' };
  };

  assert.equal((await backend.getSnapshot()).code, 'data-channel-timeout');
  assert.equal((await backend.probe()).state, 'disconnected');
  mode = 'connected';
  assert.equal((await backend.getSnapshot()).state, 'connected');
});

test('allows a forced snapshot refresh to retry a latched data channel', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  let recovered = false;
  backend.run = async () => {
    if (!recovered) {
      throw Object.assign(new Error('rioutil exited with 1'), { stderr: 'Operation timed out' });
    }
    return { stdout: 'Name: Rio 800\nMemory units: 0\n', stderr: '' };
  };

  assert.equal((await backend.getSnapshot()).code, 'data-channel-timeout');
  recovered = true;
  assert.equal((await backend.getSnapshot()).code, 'data-channel-timeout');
  assert.equal((await backend.getSnapshot({ force: true })).state, 'connected');
});

test('serializes all rioutil child processes', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rio800-queue-'));
  const helper = path.join(directory, 'helper.js');
  const log = path.join(directory, 'events.log');
  await fs.writeFile(helper, `
    const fs = require('node:fs');
    const [log, name, delay] = process.argv.slice(2);
    fs.appendFileSync(log, 'start:' + name + '\\n');
    setTimeout(() => {
      fs.appendFileSync(log, 'end:' + name + '\\n');
    }, Number(delay));
  `);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  backend.executablePath = () => process.execPath;

  await Promise.all([
    backend.run([helper, log, 'first', '150']),
    backend.run([helper, log, 'second', '0'])
  ]);

  assert.deepEqual((await fs.readFile(log, 'utf8')).trim().split('\n'), [
    'start:first',
    'end:first',
    'start:second',
    'end:second'
  ]);
});

test('rejects unsupported upload files before starting the backend', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  let started = false;
  backend.run = async () => {
    started = true;
    return { stdout: '', stderr: '' };
  };

  const result = await backend.upload({ files: ['/tmp/readme.txt'], memoryId: 0 }, () => {});

  assert.equal(result.ok, false);
  assert.equal(started, false);
  assert.match(result.message, /MP3、WMA 或 WAV/);
});

test('deletes selected tracks in one backend process per memory unit', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  const calls = [];
  backend.run = async (args, options) => {
    calls.push({ args, options });
    return {
      stdout: [
        'Name: Rio 800',
        'Memory units: 1',
        'Memory unit 0: Internal memory',
        'Free: 32.0 MiB (64.0 MiB Total)',
        'Used: 32.0 MiB in 1 files',
        'Total Time: 00:03:00',
        'RIOJSON:{"memoryId":0,"id":0,"duration":180,"sizeKiB":4096,"bitrate":192,"title":"Remaining","artist":"","album":"","filename":"remaining.mp3"}'
      ].join('\n'),
      stderr: ''
    };
  };

  const result = await backend.deleteTracks({
    tracks: [
      { id: 1, memoryId: 1, title: 'External one' },
      { id: 2, memoryId: 0, title: 'Internal two' },
      { id: 5, memoryId: 0, title: 'Internal five' },
      { id: 3, memoryId: 1, title: 'External three' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.tracks[0].title, 'Remaining');
  assert.deepEqual(calls, [
    {
      args: ['--nocolor', '--memory', '0', '--delete', '5 2'],
      options: { machine: true, env: { RIOUTIL_AFTER_DELETE_SNAPSHOT: '1' } }
    },
    {
      args: ['--nocolor', '--memory', '1', '--delete', '3 1'],
      options: { machine: true, env: { RIOUTIL_AFTER_DELETE_SNAPSHOT: '1' } }
    }
  ]);
});

test('pauses USB connection probes briefly after deleting tracks', async () => {
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false });
  backend.probeCooldownUntil = Date.now() + 1000;
  backend.run = async () => {
    throw new Error('probe should not start during cooldown');
  };

  assert.deepEqual(await backend.probe(), { state: 'busy' });
});

test('records raw backend diagnostics when deletion fails', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rio800-diagnostic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const backend = new RioBackend({ rootDir: '.', resourcesDir: '.', isPackaged: false, dataDir: directory });
  backend.run = async () => {
    throw Object.assign(new Error('rioutil exited with 1'), {
      code: 1,
      stdout: 'Attempting to open Rio',
      stderr: 'read_bulk() failed: Operation timed out'
    });
  };

  const result = await backend.deleteTracks({ tracks: [{ id: 1, memoryId: 0, title: 'Song' }] });
  const diagnostic = await fs.readFile(path.join(directory, 'last-backend-error.log'), 'utf8');

  assert.equal(result.ok, false);
  assert.match(diagnostic, /operation: delete/);
  assert.match(diagnostic, /read_bulk\(\) failed: Operation timed out/);
});
