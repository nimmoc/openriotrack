const test = require('node:test');
const assert = require('node:assert/strict');

const { parseId3Buffer } = require('../lib/id3-metadata');

function synchsafe(value) {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f
  ]);
}

function textFrame(id, value) {
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 'ascii');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('reads UTF-8 title, artist, and album from an ID3v2.3 tag', () => {
  const frames = Buffer.concat([
    textFrame('TIT2', '六层楼'),
    textFrame('TPE1', '宋冬野'),
    textFrame('TALB', '安和桥北')
  ]);
  const header = Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'binary'), synchsafe(frames.length)]);

  assert.deepEqual(parseId3Buffer(Buffer.concat([header, frames])), {
    title: '六层楼',
    artist: '宋冬野',
    album: '安和桥北'
  });
});
