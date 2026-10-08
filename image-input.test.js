const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const { openImage } = require('./image-input');

// A single 54 MB RGB strip reproduces the scanner's libtiff allocation error.
function largeStripTiff() {
  const width = 6000;
  const height = 3000;
  // LZW, as emitted by NAPS2. Reset before the dictionary needs 10-bit codes.
  const pixelBytes = width * height * 3;
  const codeCount = pixelBytes + Math.ceil(pixelBytes / 200) + 1;
  const strip = Buffer.alloc(Math.ceil(codeCount * 9 / 8));
  let bit = 0;
  function writeCode(code) {
    const byte = bit >> 3;
    const shift = bit & 7;
    const packed = code << (7 - shift);
    strip[byte] |= packed >> 8;
    strip[byte + 1] |= packed & 255;
    bit += 9;
  }
  for (let index = 0; index < pixelBytes; index += 1) {
    if (index % 200 === 0) writeCode(256);
    writeCode(240);
  }
  writeCode(257);
  const tags = [
    [256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, 0],
    [259, 3, 1, 5], [262, 3, 1, 2], [273, 4, 1, 0],
    [277, 3, 1, 3], [278, 4, 1, height], [279, 4, 1, strip.length],
    [282, 5, 1, 0], [283, 5, 1, 0], [296, 3, 1, 2]
  ];
  const bitsOffset = 8 + 2 + tags.length * 12 + 4;
  const xResolutionOffset = bitsOffset + 6;
  const yResolutionOffset = xResolutionOffset + 8;
  const stripOffset = yResolutionOffset + 8;
  tags.find(([tag]) => tag === 258)[3] = bitsOffset;
  tags.find(([tag]) => tag === 273)[3] = stripOffset;
  tags.find(([tag]) => tag === 282)[3] = xResolutionOffset;
  tags.find(([tag]) => tag === 283)[3] = yResolutionOffset;
  const header = Buffer.alloc(stripOffset);
  header.write('II');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  header.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, type, count, value], index) => {
    const offset = 10 + index * 12;
    header.writeUInt16LE(tag, offset);
    header.writeUInt16LE(type, offset + 2);
    header.writeUInt32LE(count, offset + 4);
    header.writeUInt32LE(value, offset + 8);
  });
  for (let index = 0; index < 3; index += 1) header.writeUInt16LE(8, bitsOffset + index * 2);
  for (const offset of [xResolutionOffset, yResolutionOffset]) {
    header.writeUInt32LE(1200, offset);
    header.writeUInt32LE(1, offset + 4);
  }
  return Buffer.concat([header, strip]);
}

test('large TIFF strips load for previews, detection and full-resolution crops', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scanbox-tiff-test-'));
  try {
    const file = path.join(directory, 'scan.TIF');
    await fs.writeFile(file, largeStripTiff());
    await assert.rejects(
      sharp(file, { limitInputPixels: 160_000_000 }).resize({ width: 1600 }).toBuffer(),
      /memory allocation|data buffer|read error/
    );
    const metadata = await openImage(file).metadata();
    assert.equal(metadata.width, 6000);
    assert.equal(metadata.height, 3000);
    assert.equal(metadata.density, 1200);
    const preview = await openImage(file).rotate().resize({ width: 1600 }).jpeg().toBuffer({ resolveWithObject: true });
    assert.equal(preview.info.width, 1600);
    const detection = await openImage(file).rotate().resize({ width: 1400 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    assert.equal(detection.data.length, 1400 * 700);
    for (const rotation of [0, 5]) {
      const crop = await openImage(file).autoOrient().rotate(rotation)
        .extract({ left: 100, top: 100, width: 600, height: 400 })
        .withMetadata({ density: 1200 }).jpeg().toBuffer();
      const result = await sharp(crop).metadata();
      assert.equal(result.width, 600);
      assert.equal(result.height, 400);
      assert.equal(result.density, 1200);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('TIFF allocation override retains the pixel cap and other format defaults', () => {
  assert.equal(openImage('scan.tiff').options.input.unlimited, true);
  assert.equal(openImage('scan.tif').options.input.limitInputPixels, 160_000_000);
  assert.equal(openImage('photo.png').options.input.unlimited, false);
  assert.equal(openImage('photo.jpg').options.input.unlimited, false);
});
