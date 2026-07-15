const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBackendError, normalizeTransferError, parseSnapshot } = require('../lib/rio-parser');

const output = `Attempting to open Rio and retrieve song list.... complete
Name: Rio 800
Serial Number: 00112233445566778899aabbccddeeff

Firmware Version: 2.15
Memory units: 1

Memory unit 0: Internal memory
Free: 38.4 MiB (64.0 MiB Total)
Used: 25.6 MiB in 1 files
[####################                              ] 40.0 %

Total Time: 00:05:31
Player Space Used: 25.6 MiB in 1 files
Total Player Time: 00:05:31

 id |    Title |          Name   mm:ss Size Bitrate rio_num filn
----------------------------------------------------------------
Internal memory:
  0 |          | preferences.bin |  0:00   16       0 0x01 0
  1 | Teardrop |  teardrop.mp3 |  5:31 5190     312 0x02 1
`;

test('parses a Rio snapshot', () => {
  const snapshot = parseSnapshot(output);
  assert.equal(snapshot.device.name, 'Rio 800');
  assert.equal(snapshot.device.memories[0].totalMiB, 64);
  assert.equal(snapshot.device.memories[0].duration, 331);
  assert.equal(snapshot.tracks[0].title, 'Teardrop');
  assert.equal(snapshot.tracks[0].duration, 331);
  assert.equal(snapshot.tracks[0].bitrate, 312);
  assert.equal(snapshot.tracks[0].memoryId, 0);
  assert.equal(snapshot.tracks.length, 1);
});

test('parses structured GUI metadata', () => {
  const machineOutput = `${output}\nRIOJSON:{"memoryId":0,"id":2,"rioNumber":3,"internalNumber":2,"duration":242,"sizeKiB":9467,"bitrate":312,"trackNumber":4,"title":"亲爱的你","artist":"Artist","album":"Album","filename":"song.mp3","year":"2016","genre":"Rock"}`;
  const snapshot = parseSnapshot(machineOutput);

  assert.equal(snapshot.tracks.length, 1);
  assert.equal(snapshot.tracks[0].title, '亲爱的你');
  assert.equal(snapshot.tracks[0].artist, 'Artist');
  assert.equal(snapshot.tracks[0].album, 'Album');
  assert.equal(snapshot.tracks[0].sizeKiB, 9467);
});

test('normalizes a missing USB device', () => {
  const normalized = normalizeBackendError({ stderr: 'Reason: No such device.' });
  assert.equal(normalized.state, 'disconnected');
});

test('normalizes macOS libusb missing-device text', () => {
  const normalized = normalizeBackendError({ stderr: 'Reason: No such file or directory.' });
  assert.equal(normalized.state, 'disconnected');
});

test('normalizes a driver permission error', () => {
  const normalized = normalizeBackendError({ stderr: 'Access denied' });
  assert.equal(normalized.state, 'permission');
});

test('reports a Rio bulk endpoint timeout without calling it a permission error', () => {
  const normalized = normalizeBackendError({
    stderr: 'read_bulk() error reading from device (rc = -7). Reason: Operation not permitted.'
  });
  assert.equal(normalized.state, 'error');
  assert.match(normalized.message, /数据通道超时/);
});

test('reports insufficient transfer space clearly', () => {
  const normalized = normalizeTransferError({ stdout: 'Incomplete: No space left on device' });
  assert.match(normalized.message, /存储空间不足/);
});

test('reports an invalid audio file clearly', () => {
  const normalized = normalizeTransferError({ stderr: 'Error getting song info.' });
  assert.match(normalized.message, /无法解析/);
});
