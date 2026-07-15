const fs = require('fs');
const path = require('path');

function synchsafe(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f);
}

function decodeUtf16(buffer, bigEndian) {
  let data = buffer;
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    data = data.subarray(2);
    bigEndian = false;
  } else if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    data = data.subarray(2);
    bigEndian = true;
  }

  if (bigEndian) {
    data = Buffer.from(data);
    for (let index = 0; index + 1 < data.length; index += 2) {
      const byte = data[index];
      data[index] = data[index + 1];
      data[index + 1] = byte;
    }
  }
  return data.toString('utf16le');
}

function decodeTextFrame(frame) {
  if (!frame || frame.length < 2) return '';
  const encoding = frame[0];
  const payload = frame.subarray(1);
  let value = '';

  if (encoding === 0) value = payload.toString('latin1');
  else if (encoding === 1) value = decodeUtf16(payload, false);
  else if (encoding === 2) value = decodeUtf16(payload, true);
  else if (encoding === 3) value = payload.toString('utf8');

  return value.replace(/\0/g, '').trim();
}

function removeUnsynchronization(buffer) {
  const output = [];
  for (let index = 0; index < buffer.length; index += 1) {
    output.push(buffer[index]);
    if (buffer[index] === 0xff && buffer[index + 1] === 0x00) index += 1;
  }
  return Buffer.from(output);
}

function parseId3Buffer(buffer) {
  const metadata = { title: '', artist: '', album: '' };
  if (buffer.length < 10 || buffer.subarray(0, 3).toString('ascii') !== 'ID3') return metadata;

  const version = buffer[3];
  if (version < 2 || version > 4) return metadata;
  const tagEnd = Math.min(buffer.length, 10 + synchsafe(buffer, 6));
  let tag = buffer.subarray(10, tagEnd);
  if (buffer[5] & 0x80) tag = removeUnsynchronization(tag);

  let offset = 0;
  if ((buffer[5] & 0x40) && tag.length >= 4) {
    offset = version === 3 ? 4 + tag.readUInt32BE(0) : synchsafe(tag, 0);
  }

  const frameNames = version === 2
    ? { TT2: 'title', TP1: 'artist', TAL: 'album' }
    : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
  const headerSize = version === 2 ? 6 : 10;

  while (offset + headerSize <= tag.length) {
    const idLength = version === 2 ? 3 : 4;
    const id = tag.subarray(offset, offset + idLength).toString('ascii');
    if (!/^[A-Z0-9]+$/.test(id)) break;

    const size = version === 2
      ? tag.readUIntBE(offset + 3, 3)
      : version === 4
        ? synchsafe(tag, offset + 4)
        : tag.readUInt32BE(offset + 4);
    const frameStart = offset + headerSize;
    const frameEnd = frameStart + size;
    if (size <= 0 || frameEnd > tag.length) break;

    const field = frameNames[id];
    if (field && !metadata[field]) metadata[field] = decodeTextFrame(tag.subarray(frameStart, frameEnd));
    offset = frameEnd;
  }

  return metadata;
}

async function readAudioMetadata(file) {
  if (path.extname(file).toLowerCase() !== '.mp3') return { title: '', artist: '', album: '' };

  const handle = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < header.length || header.subarray(0, 3).toString('ascii') !== 'ID3') {
      return { title: '', artist: '', album: '' };
    }

    const tagSize = Math.min(4 * 1024 * 1024, 10 + synchsafe(header, 6));
    const tag = Buffer.alloc(tagSize);
    await handle.read(tag, 0, tag.length, 0);
    return parseId3Buffer(tag);
  } finally {
    await handle.close();
  }
}

module.exports = { parseId3Buffer, readAudioMetadata };
