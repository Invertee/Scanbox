(function exposeScanboxExif(global) {
  function validPhotoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }

  function validCoordinate(value, limit) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && Math.abs(numeric) <= limit ? numeric : null;
  }

  function exifDate(value) {
    return `${value.replaceAll('-', ':')} 00:00:00`;
  }

  function coordinateRationals(value) {
    let degrees = Math.floor(Math.abs(value));
    const totalMinutes = (Math.abs(value) - degrees) * 60;
    let minutes = Math.floor(totalMinutes);
    let seconds = Math.round((totalMinutes - minutes) * 60 * 1_000_000);
    if (seconds >= 60_000_000) { seconds = 0; minutes += 1; }
    if (minutes >= 60) { minutes = 0; degrees += 1; }
    return [degrees, 1, minutes, 1, seconds, 1_000_000];
  }

  function writeIfd(view, offset, entries) {
    const sorted = [...entries].sort((first, second) => first.tag - second.tag);
    view.setUint16(offset, sorted.length, true);
    sorted.forEach((entry, index) => {
      const entryOffset = offset + 2 + index * 12;
      view.setUint16(entryOffset, entry.tag, true);
      view.setUint16(entryOffset + 2, entry.type, true);
      view.setUint32(entryOffset + 4, entry.count, true);
      if (Array.isArray(entry.inline)) {
        entry.inline.forEach((byte, byteIndex) => view.setUint8(entryOffset + 8 + byteIndex, byte));
      } else {
        view.setUint32(entryOffset + 8, entry.value, true);
      }
    });
    view.setUint32(offset + 2 + sorted.length * 12, 0, true);
  }

  function writeAscii(view, offset, value, count) {
    for (let index = 0; index < count; index += 1) {
      view.setUint8(offset + index, index < value.length ? value.charCodeAt(index) : 0);
    }
  }

  function writeRational(view, offset, values) {
    values.forEach((value, index) => view.setUint32(offset + index * 4, value, true));
  }

  function makeExifPayload({ date: rawDate, latitude: rawLatitude, longitude: rawLongitude, dpi: rawDpi }) {
    const date = validPhotoDate(rawDate);
    const latitude = validCoordinate(rawLatitude, 90);
    const longitude = validCoordinate(rawLongitude, 180);
    const hasGps = latitude !== null && longitude !== null;
    const dpi = Number.isSafeInteger(Number(rawDpi)) && Number(rawDpi) > 0 ? Number(rawDpi) : 300;

    const ifd0EntryCount = 3 + (date ? 2 : 0) + (hasGps ? 1 : 0);
    const ifd0Offset = 8;
    const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
    let cursor = ifd0Offset + ifd0Size;
    const exifIfdOffset = date ? cursor : 0;
    if (date) cursor += 2 + 2 * 12 + 4;
    const gpsIfdOffset = hasGps ? cursor : 0;
    if (hasGps) cursor += 2 + 5 * 12 + 4;

    const xResolutionOffset = cursor; cursor += 8;
    const yResolutionOffset = cursor; cursor += 8;
    const dateTimeOffset = date ? cursor : 0;
    if (date) cursor += 20;
    const originalDateOffset = date ? cursor : 0;
    if (date) cursor += 20;
    const digitizedDateOffset = date ? cursor : 0;
    if (date) cursor += 20;
    const latitudeOffset = hasGps ? cursor : 0;
    if (hasGps) cursor += 24;
    const longitudeOffset = hasGps ? cursor : 0;
    if (hasGps) cursor += 24;

    const tiff = new Uint8Array(cursor);
    const view = new DataView(tiff.buffer);
    view.setUint8(0, 0x49);
    view.setUint8(1, 0x49);
    view.setUint16(2, 42, true);
    view.setUint32(4, ifd0Offset, true);
    writeRational(view, xResolutionOffset, [dpi, 1]);
    writeRational(view, yResolutionOffset, [dpi, 1]);

    const ifd0Entries = [
      { tag: 0x011a, type: 5, count: 1, value: xResolutionOffset },
      { tag: 0x011b, type: 5, count: 1, value: yResolutionOffset },
      { tag: 0x0128, type: 3, count: 1, value: 2 }
    ];
    if (date) {
      const formattedDate = exifDate(date);
      writeAscii(view, dateTimeOffset, formattedDate, 20);
      writeAscii(view, originalDateOffset, formattedDate, 20);
      writeAscii(view, digitizedDateOffset, formattedDate, 20);
      ifd0Entries.push({ tag: 0x0132, type: 2, count: 20, value: dateTimeOffset });
      ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, value: exifIfdOffset });
      writeIfd(view, exifIfdOffset, [
        { tag: 0x9003, type: 2, count: 20, value: originalDateOffset },
        { tag: 0x9004, type: 2, count: 20, value: digitizedDateOffset }
      ]);
    }

    if (hasGps) {
      writeRational(view, latitudeOffset, coordinateRationals(latitude));
      writeRational(view, longitudeOffset, coordinateRationals(longitude));
      ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, value: gpsIfdOffset });
      writeIfd(view, gpsIfdOffset, [
        { tag: 0x0000, type: 1, count: 4, inline: [2, 3, 0, 0] },
        { tag: 0x0001, type: 2, count: 2, inline: [latitude < 0 ? 83 : 78, 0, 0, 0] },
        { tag: 0x0002, type: 5, count: 3, value: latitudeOffset },
        { tag: 0x0003, type: 2, count: 2, inline: [longitude < 0 ? 87 : 69, 0, 0, 0] },
        { tag: 0x0004, type: 5, count: 3, value: longitudeOffset }
      ]);
    }
    writeIfd(view, ifd0Offset, ifd0Entries);

    const payload = new Uint8Array(6 + tiff.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
    payload.set(tiff, 6);
    return payload;
  }

  async function addExif(jpegBlob, metadata) {
    const payload = makeExifPayload(metadata);
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('The browser returned an invalid JPEG image.');
    const segmentLength = payload.length + 2;
    if (segmentLength > 0xffff) throw new Error('The EXIF data is too large to add to this JPEG.');
    const output = new Uint8Array(jpeg.length + payload.length + 4);
    output.set(jpeg.subarray(0, 2), 0);
    output.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], 2);
    output.set(payload, 6);
    output.set(jpeg.subarray(2), payload.length + 6);
    return new Blob([output], { type: 'image/jpeg' });
  }

  global.ScanboxExif = { addExif };
})(window);
