const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { listDevices, scanA4 } = require('./scanner');
const { findPhotoRegions } = require('./cropper');

const batches = new Map();
const mapSearchCache = new Map();
let activeBatchId = null;
let isCleaningUp = false;
let lastOutputDirectory = '';
let nextMapSearchAt = 0;
let lastPhotoDate = { day: '', month: '', year: '' };
let lastPhotoBirthday = { enabled: false, dateOfBirth: '', age: '' };
let lastPhotoLocation = null;
let preferenceWrites = Promise.resolve();

function preferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

async function loadPreferences() {
  try {
    const preferences = JSON.parse(await fs.readFile(preferencesPath(), 'utf8'));
    if (typeof preferences.lastOutputDirectory === 'string') lastOutputDirectory = preferences.lastOutputDirectory;
    lastPhotoDate = normalizePhotoDate(preferences.photoDate);
    lastPhotoBirthday = normalizePhotoBirthday(preferences.photoBirthday);
    lastPhotoLocation = normalizePhotoLocation(preferences.photoLocation);
  } catch { /* First launch or unreadable preferences: use defaults. */ }
}

function savePreferences() {
  const filePath = preferencesPath();
  const contents = JSON.stringify({ lastOutputDirectory, photoDate: lastPhotoDate, photoBirthday: lastPhotoBirthday, photoLocation: lastPhotoLocation }, null, 2);
  preferenceWrites = preferenceWrites.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf8');
  });
  return preferenceWrites;
}

function normalizePhotoDate(value) {
  const part = (key, maxLength) => String(value?.[key] ?? '').replace(/\D/g, '').slice(0, maxLength);
  return { day: part('day', 2), month: part('month', 2), year: part('year', 4) };
}

function normalizePhotoBirthday(value) {
  const dateOfBirth = typeof value?.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth)
    && !Number.isNaN(Date.parse(`${value.dateOfBirth}T00:00:00.000Z`))
    && new Date(`${value.dateOfBirth}T00:00:00.000Z`).toISOString().slice(0, 10) === value.dateOfBirth
    ? value.dateOfBirth : '';
  const age = String(value?.age ?? '').trim();
  return { enabled: value?.enabled === true, dateOfBirth, age: /^\d{1,3}$/.test(age) && Number(age) <= 120 ? age : '' };
}

function normalizePhotoLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function sanitizeFilePrefix(value) {
  return String(value || 'Photo').replace(/[<>:"\/\\|?*\u0000-\u001f]/g, '-').trim() || 'Photo';
}

function rotatedImageDimensions(width, height, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  if (Math.abs(sine) < 1e-10) return { width, height };
  if (Math.abs(cosine) < 1e-10) return { width: height, height: width };
  return {
    width: Math.ceil(width * cosine + height * sine),
    height: Math.ceil(height * cosine + width * sine)
  };
}

function cropIntersectionPlan(desired, imageWidth, imageHeight) {
  const left = Math.max(0, desired.left);
  const top = Math.max(0, desired.top);
  const right = Math.min(imageWidth, desired.left + desired.width);
  const bottom = Math.min(imageHeight, desired.top + desired.height);
  const extract = { left, top, width: right - left, height: bottom - top };
  return {
    extract,
    padding: {
      left: left - desired.left,
      top: top - desired.top,
      right: desired.left + desired.width - right,
      bottom: desired.top + desired.height - bottom,
      background: '#fff'
    }
  };
}

function cropAfterRotation(batch, crop, width, height, degrees) {
  const radians = -degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotated = rotatedImageDimensions(batch.width, batch.height, degrees);
  const centerX = crop.x + width / 2 - batch.width / 2;
  const centerY = crop.y + height / 2 - batch.height / 2;
  const rotatedCenterX = cosine * centerX - sine * centerY + rotated.width / 2;
  const rotatedCenterY = sine * centerX + cosine * centerY + rotated.height / 2;
  const desired = { left: Math.round(rotatedCenterX - width / 2), top: Math.round(rotatedCenterY - height / 2), width, height };
  return cropIntersectionPlan(desired, rotated.width, rotated.height);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#f5f6f2',
    title: 'Scanbox Photo Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}

function assertTrustedSender(event) {
  if (event.senderFrame?.url !== `file://${path.join(__dirname, 'index.html').replaceAll('\\', '/')}`) {
    // loadFile may normalize drive letters and encoding differently; origin is
    // still local and navigation is blocked below.
    if (!event.senderFrame?.url?.startsWith('file://')) throw new Error('Untrusted app request');
  }
}

async function getPreviewAndCrops(imagePath, threshold = 242, padding = 0.025, detectPhotos = true) {
  const metadata = await sharp(imagePath, { limitInputPixels: 160_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('This image could not be read.');
  const orientationSwapsDimensions = [5, 6, 7, 8].includes(metadata.orientation);
  const width = orientationSwapsDimensions ? metadata.height : metadata.width;
  const height = orientationSwapsDimensions ? metadata.width : metadata.height;
  const preview = await sharp(imagePath, { limitInputPixels: 160_000_000 })
    .rotate()
    .resize({ width: Math.min(1600, width), withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  let regions = [];
  let scaleX = 1;
  let scaleY = 1;
  let detectionWidth = width;
  let detectionHeight = height;
  if (detectPhotos) {
    const page = await sharp(imagePath, { limitInputPixels: 160_000_000 })
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    regions = findPhotoRegions(page.data, page.info.width, page.info.height, Number(threshold), Number(padding));
    detectionWidth = page.info.width;
    detectionHeight = page.info.height;
    scaleX = width / page.info.width;
    scaleY = height / page.info.height;
  }
  const imageData = `data:image/jpeg;base64,${preview.data.toString('base64')}`;
  return {
    imageData,
    width,
    height,
    dpi: metadata.density || 300,
    previewWidth: preview.info.width,
    previewHeight: preview.info.height,
    crops: regions.map((rect, index) => ({
      id: `crop-${index + 1}`,
      x: Math.max(0, Math.round(rect.x * scaleX)),
      y: Math.max(0, Math.round(rect.y * scaleY)),
      width: Math.min(width, Math.round(rect.width * scaleX)),
      height: Math.min(height, Math.round(rect.height * scaleY)),
      source: 'detected',
      selected: rect.width < detectionWidth * 0.98 && rect.height < detectionHeight * 0.98,
      date: null,
      latitude: null,
      longitude: null
    }))
  };
}

async function prepareBatch(imagePath, sourceName, threshold, padding, dpi, detectPhotos = true) {
  const processed = await getPreviewAndCrops(imagePath, threshold, padding, detectPhotos);
  if (Number.isFinite(Number(dpi)) && Number(dpi) > 0) processed.dpi = Number(dpi);
  const oldBatch = activeBatchId ? batches.get(activeBatchId) : null;
  if (activeBatchId) batches.delete(activeBatchId);
  if (oldBatch && oldBatch.imagePath !== imagePath && oldBatch.imagePath.startsWith(os.tmpdir()) && path.basename(oldBatch.imagePath).startsWith('scanbox-')) {
    await fs.rm(oldBatch.imagePath, { force: true }).catch(() => {});
  }
  const batchId = crypto.randomUUID();
  batches.set(batchId, { imagePath, ...processed });
  activeBatchId = batchId;
  return { batchId, sourceName, ...processed };
}

async function discardActiveBatch() {
  const batch = activeBatchId ? batches.get(activeBatchId) : null;
  if (activeBatchId) batches.delete(activeBatchId);
  activeBatchId = null;
  if (batch && batch.imagePath.startsWith(os.tmpdir()) && path.basename(batch.imagePath).startsWith('scanbox-')) {
    await fs.rm(batch.imagePath, { force: true }).catch(() => {});
  }
}

function requireBatch(batchId) {
  const batch = batches.get(batchId);
  if (!batch) throw new Error('This scan session has expired. Load the image again.');
  return batch;
}

async function searchMapPlaces(query) {
  const normalizedQuery = String(query || '').trim().replace(/\s+/g, ' ');
  if (!normalizedQuery || normalizedQuery.length > 200) throw new Error('Enter a place name or address to search.');
  const cacheKey = normalizedQuery.toLocaleLowerCase('en-GB');
  const cached = mapSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) return cached.results;

  const requestAt = Math.max(Date.now(), nextMapSearchAt);
  nextMapSearchAt = requestAt + 1100;
  const delay = requestAt - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  const endpoint = process.env.SCANBOX_MAP_SEARCH_URL || 'https://nominatim.openstreetmap.org/search';
  const url = new URL(endpoint);
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': `Scanbox-Photo-Studio/${app.getVersion()} (+https://github.com/Invertee/Scanbox)`
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Place search returned an invalid response.');
  const results = data.slice(0, 6).map((place) => ({
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    name: String(place.name || place.display_name || 'Unnamed place'),
    label: String(place.display_name || place.name || 'Unnamed place'),
    type: String(place.type || '')
  })).filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
    && place.latitude >= -90 && place.latitude <= 90 && place.longitude >= -180 && place.longitude <= 180);
  mapSearchCache.set(cacheKey, { cachedAt: Date.now(), results });
  if (mapSearchCache.size > 100) mapSearchCache.delete(mapSearchCache.keys().next().value);
  return results;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function exifDate(date) {
  return `${date.replaceAll('-', ':')} 00:00:00`;
}

function gpsCoordinate(value, positiveRef, negativeRef) {
  let degrees = Math.floor(Math.abs(value));
  const totalMinutes = (Math.abs(value) - degrees) * 60;
  let minutes = Math.floor(totalMinutes);
  let seconds = Math.round((totalMinutes - minutes) * 60 * 1_000_000);
  if (seconds >= 60_000_000) { seconds = 0; minutes += 1; }
  if (minutes >= 60) { minutes = 0; degrees += 1; }
  return {
    reference: value < 0 ? negativeRef : positiveRef,
    value: `${degrees}/1 ${minutes}/1 ${seconds}/1000000`
  };
}

function registerIpc() {
  ipcMain.handle('scanner:list', async (event) => {
    assertTrustedSender(event);
    return listDevices();
  });
  ipcMain.handle('scanner:scan', async (event, options) => {
    assertTrustedSender(event);
    const outputPath = path.join(os.tmpdir(), `scanbox-${crypto.randomUUID()}.tif`);
    try {
      const result = await scanA4({ ...options, outputPath });
      const batch = await prepareBatch(outputPath, result.deviceName || 'Flatbed scan', options.threshold, options.padding, options.dpi, options.detectPhotos !== false);
      batch.scannerName = result.deviceName;
      return batch;
    } catch (error) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
      throw error;
    }
  });
  ipcMain.handle('image:choose', async (event, options = {}) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose a flatbed scan to crop',
      properties: ['openFile'],
      filters: [{ name: 'Scanned images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'webp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return prepareBatch(result.filePaths[0], path.basename(result.filePaths[0]), undefined, undefined, undefined, options.detectPhotos !== false);
  });
  ipcMain.handle('batch:redetect', async (event, { batchId, threshold, padding }) => {
    assertTrustedSender(event);
    const previous = requireBatch(batchId);
    const refreshed = await prepareBatch(previous.imagePath, 'Current scan', threshold, padding);
    return refreshed;
  });
  ipcMain.handle('folder:choose', async (event) => {
    assertTrustedSender(event);
    const previousFolderExists = lastOutputDirectory && await fs.stat(lastOutputDirectory).then((info) => info.isDirectory()).catch(() => false);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose where to save your cropped photos',
      properties: ['openDirectory', 'createDirectory'],
      ...(previousFolderExists ? { defaultPath: lastOutputDirectory } : {})
    });
    if (result.canceled) return null;
    lastOutputDirectory = result.filePaths[0];
    await savePreferences();
    return lastOutputDirectory;
  });
  ipcMain.handle('folder:last-used', async (event) => {
    assertTrustedSender(event);
    return lastOutputDirectory;
  });
  ipcMain.handle('photo-details:last-used', async (event) => {
    assertTrustedSender(event);
    return { date: { ...lastPhotoDate }, birthday: { ...lastPhotoBirthday }, location: lastPhotoLocation ? { ...lastPhotoLocation } : null };
  });
  ipcMain.handle('photo-details:save', async (event, details = {}) => {
    assertTrustedSender(event);
    const updates = details && typeof details === 'object' ? details : {};
    if (Object.prototype.hasOwnProperty.call(updates, 'date')) lastPhotoDate = normalizePhotoDate(updates.date);
    if (Object.prototype.hasOwnProperty.call(updates, 'birthday')) lastPhotoBirthday = normalizePhotoBirthday(updates.birthday);
    if (Object.prototype.hasOwnProperty.call(updates, 'location')) lastPhotoLocation = normalizePhotoLocation(updates.location);
    await savePreferences();
    return { date: { ...lastPhotoDate }, birthday: { ...lastPhotoBirthday }, location: lastPhotoLocation ? { ...lastPhotoLocation } : null };
  });
  ipcMain.handle('folder:next-number', async (event, { outputDirectory, prefix }) => {
    assertTrustedSender(event);
    if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) throw new Error('Choose a save folder first.');
    const directory = path.resolve(outputDirectory);
    const safePrefix = sanitizeFilePrefix(prefix);
    const escapedPrefix = safePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filenamePattern = new RegExp(`^${escapedPrefix}-(\\d+)(?:-\\d+)?\\.jpe?g$`, 'i');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let highestNumber = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(filenamePattern);
      if (!match) continue;
      const number = Number(match[1]);
      if (Number.isSafeInteger(number)) highestNumber = Math.max(highestNumber, number);
    }
    return highestNumber + 1;
  });
  ipcMain.handle('batch:save', async (event, payload) => {
    assertTrustedSender(event);
    const batch = requireBatch(payload.batchId);
    if (typeof payload.outputDirectory !== 'string' || !payload.outputDirectory.trim()) throw new Error('Choose an output folder first.');
    const outputDirectory = path.resolve(payload.outputDirectory);
    await fs.mkdir(outputDirectory, { recursive: true });
    const prefix = sanitizeFilePrefix(payload.prefix);
    const photos = Array.isArray(payload.photos) ? payload.photos : [];
    if (photos.length === 0) throw new Error('Select at least one photo to save.');
    const requestedStart = Number(payload.startNumber);
    const startingNumber = Number.isSafeInteger(requestedStart) && requestedStart > 0 ? requestedStart : 1;
    const successes = [];
    const savedIds = [];
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const crop = photo && typeof photo === 'object' ? photo : null;
      if (!crop || typeof crop.id !== 'string') continue;
      const rectValues = [crop.x, crop.y, crop.width, crop.height].map(Number);
      if (!rectValues.every(Number.isFinite)) throw new Error('A crop has invalid boundaries.');
      const [left, top, cropWidth, cropHeight] = rectValues.map(Math.round);
      if (![left, top, cropWidth, cropHeight].every(Number.isSafeInteger) || cropWidth < 1 || cropHeight < 1 || cropWidth > batch.width || cropHeight > batch.height) {
        throw new Error('A crop has invalid boundaries.');
      }
      const rotation = Number(crop.rotation ?? 0);
      if (!Number.isFinite(rotation) || Math.abs(rotation) > 180) throw new Error('A crop has an invalid rotation.');
      const cropPlan = rotation === 0
        ? cropIntersectionPlan({ left, top, width: cropWidth, height: cropHeight }, batch.width, batch.height)
        : cropAfterRotation(batch, { x: left, y: top }, cropWidth, cropHeight, rotation);
      if (cropPlan.extract.width < 1 || cropPlan.extract.height < 1) throw new Error('This crop does not overlap the scan. Move it back over the image before saving.');
      const cropRect = cropPlan.extract;
      if (rotation === 0 && left <= 0 && top <= 0 && left + cropWidth >= batch.width && top + cropHeight >= batch.height) {
        throw new Error('A full-page selection would export the original image. Draw a crop around each photo instead.');
      }
      const number = startingNumber + index;
      const numberedName = `${prefix}-${String(number).padStart(3, '0')}`;
      let filePath = path.join(outputDirectory, `${numberedName}.jpg`);
      let collision = 1;
      while (await fs.access(filePath).then(() => true).catch(() => false)) {
        filePath = path.join(outputDirectory, `${numberedName}-${collision}.jpg`);
        collision += 1;
      }
      const date = validDate(photo.date);
      const dateTime = date ? exifDate(date) : null;
      const exif = { IFD0: {} };
      if (dateTime) {
        exif.IFD0.DateTime = dateTime;
        exif.IFD2 = { DateTimeOriginal: dateTime, DateTimeDigitized: dateTime };
      }
      const hasLatitude = photo.latitude !== null && photo.latitude !== undefined && photo.latitude !== '';
      const hasLongitude = photo.longitude !== null && photo.longitude !== undefined && photo.longitude !== '';
      const latitude = hasLatitude ? Number(photo.latitude) : NaN;
      const longitude = hasLongitude ? Number(photo.longitude) : NaN;
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        const gpsLatitude = gpsCoordinate(latitude, 'N', 'S');
        const gpsLongitude = gpsCoordinate(longitude, 'E', 'W');
        exif.IFD3 = {
          GPSLatitudeRef: gpsLatitude.reference,
          GPSLatitude: gpsLatitude.value,
          GPSLongitudeRef: gpsLongitude.reference,
          GPSLongitude: gpsLongitude.value
        };
      }
      const image = sharp(batch.imagePath, { limitInputPixels: 160_000_000 });
      if (rotation === 0) image.rotate();
      else image.autoOrient().rotate(-rotation, { background: '#fff' });
      image.extract(cropRect);
      if (Object.values(cropPlan.padding).some((amount) => typeof amount === 'number' && amount > 0)) {
        image.extend(cropPlan.padding);
      }
      await image
        .withMetadata({ density: batch.dpi || 300 })
        .withExif(exif)
        .jpeg({ quality: 96, mozjpeg: true })
        .toFile(filePath);
      successes.push(filePath);
      savedIds.push(crop.id);
    }
    return { saved: successes.length, files: successes, savedIds };
  });
  ipcMain.handle('app:open-scanner-help', async (event) => {
    assertTrustedSender(event);
    await shell.openExternal('https://www.naps2.com/download');
  });
  ipcMain.handle('app:open-map-credits', async (event) => {
    assertTrustedSender(event);
    await shell.openExternal('https://www.openstreetmap.org/copyright');
  });
  ipcMain.handle('map:search', async (event, query) => {
    assertTrustedSender(event);
    return searchMapPlaces(query);
  });
}

app.whenReady().then(async () => {
  await loadPreferences();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (isCleaningUp) return;
  event.preventDefault();
  isCleaningUp = true;
  await discardActiveBatch();
  app.removeAllListeners('before-quit');
  app.quit();
});
