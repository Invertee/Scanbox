const state = { batch: null, devices: [], outputDirectory: '', place: null, map: null, marker: null, pendingPlace: null, manualId: 0, drawing: null, rotating: null, moving: null, panning: null, zoom: 1, panX: 0, panY: 0, toastTimer: null, busy: false, numberLookupId: 0 };
const $ = (id) => document.getElementById(id);
const elements = {
  scannerName: $('sidebarScannerName'), scannerDriver: $('sidebarScannerDriver'), scannerDot: $('scannerStatusDot'),
  driver: $('driverSelect'), device: $('deviceSelect'), dpi: $('dpiSelect'), scan: $('scanBtn'), scanDetail: $('scanButtonDetail'),
  import: $('importBtn'), emptyImport: $('emptyImportBtn'), refresh: $('refreshScanners'), setup: $('setupBtn'),
  empty: $('emptyPreview'), canvasWrap: $('canvasWrap'), canvas: $('scanCanvas'), stage: $('previewStage'),
  overlay: $('processingOverlay'), processingTitle: $('processingTitle'), processingDetail: $('processingDetail'), subtitle: $('previewSubtitle'),
  detected: $('detectedPill'), redetect: $('redetectBtn'), list: $('photoList'), selectionSummary: $('selectionSummary'),
  selectAll: $('selectAllBtn'), dateDay: $('dateDayInput'), dateMonth: $('dateMonthInput'), dateYear: $('dateYearInput'), placeSummary: $('placeSummary'), mapOpen: $('mapOpenBtn'),
  folder: $('folderSummary'), chooseFolder: $('chooseFolderBtn'), save: $('saveBtn'),
  prefix: $('filenamePrefix'), start: $('startNumber'), toast: $('toast'), mapModal: $('mapModal'), map: $('map'),
  closeMap: $('closeMapBtn'), coordinateText: $('coordinateText'), confirmPlace: $('confirmLocationBtn'), clearPlace: $('clearLocationBtn'),
  sensitivity: $('sensitivity'), sensitivityValue: $('sensitivityValue')
};

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 4200);
}

function setBusy(busy, title = 'Reading your page…', detail = 'This can take a moment at high resolution') {
  elements.overlay.classList.toggle('hidden', !busy);
  elements.processingTitle.textContent = title;
  elements.processingDetail.textContent = detail;
  elements.scan.disabled = busy;
  elements.import.disabled = busy;
  elements.emptyImport.disabled = busy;
  elements.refresh.disabled = busy;
}

function selectedPhotos() { return state.batch?.crops.filter((photo) => photo.selected) || []; }

function selectedPhotoDate() {
  const parts = [elements.dateDay.value.trim(), elements.dateMonth.value.trim(), elements.dateYear.value.trim()];
  if (parts.every((part) => part === '')) return null;
  if (!/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1]) || !/^\d{4}$/.test(parts[2])) return undefined;
  const [day, month, year] = parts.map(Number);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1) return undefined;
  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsedDate = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== isoDate ? undefined : isoDate;
}

function updatePhotoCount() {
  const crops = state.batch?.crops || [];
  const count = crops.length;
  const selected = crops.filter((photo) => photo.selected).length;
  elements.detected.textContent = `${count} ${count === 1 ? 'photo' : 'photos'} found`;
  elements.selectionSummary.textContent = count ? `${selected} of ${count} selected to save` : 'No photos found yet';
  elements.selectAll.classList.toggle('hidden', count === 0);
  elements.selectAll.textContent = selected === count ? 'Deselect all' : 'Select all';
  elements.save.disabled = state.busy || !count || selected === 0 || !state.outputDirectory;
  elements.redetect.disabled = state.busy || !state.batch;
}

function previewBounds(crop) {
  return { x: crop.x * state.batch.previewWidth / state.batch.width, y: crop.y * state.batch.previewHeight / state.batch.height,
    width: crop.width * state.batch.previewWidth / state.batch.width, height: crop.height * state.batch.previewHeight / state.batch.height };
}

function cropRotation(crop) {
  const rotation = Number(crop.rotation);
  return Number.isFinite(rotation) ? rotation : 0;
}

function handleDimensions() {
  const canvas = elements.canvas;
  const scale = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
  return { gap: Math.max(6, scale * 7), radius: Math.max(5, scale * 6) };
}

function cropHandlePoint(crop, action = 'rotate') {
  const box = previewBounds(crop);
  const { gap, radius } = handleDimensions();
  const angle = cropRotation(crop) * Math.PI / 180;
  const localX = (action === 'move' ? -1 : 1) * (box.width / 2 + gap);
  const x = box.x + box.width / 2 + Math.cos(angle) * localX;
  const y = box.y + box.height / 2 + Math.sin(angle) * localX;
  const inset = radius + 2;
  const clampToCanvas = (value, size) => Math.max(Math.min(inset, size / 2), Math.min(Math.max(size - inset, size / 2), value));
  return { x: clampToCanvas(x, state.batch.previewWidth), y: clampToCanvas(y, state.batch.previewHeight) };
}

function clampPreviewPan() {
  const canvas = elements.canvas;
  const stage = elements.stage;
  const maxX = Math.max(0, (canvas.offsetWidth * state.zoom - stage.clientWidth) / 2);
  const maxY = Math.max(0, (canvas.offsetHeight * state.zoom - stage.clientHeight) / 2);
  state.panX = Math.max(-maxX, Math.min(maxX, state.panX));
  state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
}

function applyPreviewTransform() {
  clampPreviewPan();
  elements.canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
}

function zoomPreview(event) {
  if (!state.batch) return;
  event.preventDefault();
  const canvasRect = elements.canvas.getBoundingClientRect();
  const oldZoom = state.zoom;
  state.zoom = Math.max(.5, Math.min(8, oldZoom * Math.exp(-event.deltaY * .001)));
  const zoomRatio = state.zoom / oldZoom;
  state.panX += (event.clientX - (canvasRect.left + canvasRect.width / 2)) * (1 - zoomRatio);
  state.panY += (event.clientY - (canvasRect.top + canvasRect.height / 2)) * (1 - zoomRatio);
  applyPreviewTransform();
}

function paintCanvas() {
  if (!state.batch) return;
  const canvas = elements.canvas;
  const ctx = canvas.getContext('2d');
  canvas.width = state.batch.previewWidth;
  canvas.height = state.batch.previewHeight;
  applyPreviewTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.batch.previewImage, 0, 0, canvas.width, canvas.height);
  state.batch.crops.forEach((crop, index) => {
    const box = previewBounds(crop);
    const angle = cropRotation(crop) * Math.PI / 180;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.lineWidth = Math.max(2, canvas.width / 750);
    ctx.strokeStyle = crop.selected ? '#74a87f' : '#9ba49c';
    ctx.fillStyle = crop.selected ? 'rgba(74, 135, 86, .12)' : 'rgba(70, 77, 70, .10)';
    ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
    ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
    const badgeW = canvas.width / 31;
    const badgeH = canvas.width / 29;
    ctx.fillStyle = crop.selected ? '#38784f' : '#68736a';
    ctx.fillRect(-box.width / 2, -box.height / 2, badgeW, badgeH);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(10, canvas.width / 105)}px Segoe UI, sans-serif`;
    ctx.fillText(String(index + 1).padStart(2, '0'), -box.width / 2 + badgeW * .22, -box.height / 2 + badgeH * .72);
    if (crop.selected) {
      const { radius } = handleDimensions();
      const localHandlePoint = (action) => {
        const point = cropHandlePoint(crop, action);
        const dx = point.x - centerX;
        const dy = point.y - centerY;
        return { x: dx * Math.cos(angle) + dy * Math.sin(angle), y: -dx * Math.sin(angle) + dy * Math.cos(angle) };
      };
      const rotationHandle = localHandlePoint('rotate');
      const moveHandle = localHandlePoint('move');
      const handleX = rotationHandle.x;
      const handleY = rotationHandle.y;
      ctx.strokeStyle = '#38784f';
      ctx.lineWidth = Math.max(1.5, radius * .28);
      ctx.beginPath(); ctx.moveTo(box.width / 2, 0); ctx.lineTo(handleX, handleY); ctx.stroke();
      ctx.beginPath(); ctx.arc(handleX, handleY, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.arc(handleX, handleY, radius * .43, Math.PI * .2, Math.PI * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(handleX + radius * .28, handleY - radius * .37);
      ctx.lineTo(handleX + radius * .43, handleY - radius * .12);
      ctx.lineTo(handleX + radius * .12, handleY - radius * .12);
      ctx.fillStyle = '#38784f'; ctx.fill();

      const moveHandleX = moveHandle.x;
      const moveHandleY = moveHandle.y;
      ctx.strokeStyle = '#38784f';
      ctx.lineWidth = Math.max(1.5, radius * .28);
      ctx.beginPath(); ctx.moveTo(-box.width / 2, 0); ctx.lineTo(moveHandleX, moveHandleY); ctx.stroke();
      ctx.beginPath(); ctx.arc(moveHandleX, moveHandleY, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(moveHandleX - radius * .52, moveHandleY); ctx.lineTo(moveHandleX + radius * .52, moveHandleY);
      ctx.moveTo(moveHandleX, moveHandleY - radius * .52); ctx.lineTo(moveHandleX, moveHandleY + radius * .52);
      ctx.stroke();
      ctx.fillStyle = '#38784f';
      ctx.beginPath();
      ctx.moveTo(moveHandleX - radius * .52, moveHandleY); ctx.lineTo(moveHandleX - radius * .22, moveHandleY - radius * .2); ctx.lineTo(moveHandleX - radius * .22, moveHandleY + radius * .2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(moveHandleX + radius * .52, moveHandleY); ctx.lineTo(moveHandleX + radius * .22, moveHandleY - radius * .2); ctx.lineTo(moveHandleX + radius * .22, moveHandleY + radius * .2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(moveHandleX, moveHandleY - radius * .52); ctx.lineTo(moveHandleX - radius * .2, moveHandleY - radius * .22); ctx.lineTo(moveHandleX + radius * .2, moveHandleY - radius * .22); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(moveHandleX, moveHandleY + radius * .52); ctx.lineTo(moveHandleX - radius * .2, moveHandleY + radius * .22); ctx.lineTo(moveHandleX + radius * .2, moveHandleY + radius * .22); ctx.fill();
    }
    ctx.restore();
  });
}

function drawThumb(canvas, crop) {
  const ctx = canvas.getContext('2d');
  const source = state.batch.previewImage;
  const scaleX = state.batch.previewWidth / state.batch.width;
  const scaleY = state.batch.previewHeight / state.batch.height;
  const sw = crop.width * scaleX;
  const sh = crop.height * scaleY;
  const ratio = Math.min(canvas.width / sw, canvas.height / sh);
  ctx.fillStyle = '#f1f3ef';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(ratio, ratio);
  ctx.rotate(-cropRotation(crop) * Math.PI / 180);
  ctx.translate(-(crop.x * scaleX + sw / 2), -(crop.y * scaleY + sh / 2));
  ctx.drawImage(source, 0, 0);
}

function renderPhotoList() {
  const crops = state.batch?.crops || [];
  if (!crops.length) {
    elements.list.innerHTML = '<div class="photo-list-empty"><div class="empty-stack">▱</div><strong>Your crops will show up here</strong><span>Each photo is ready to review before saving.</span></div>';
    updatePhotoCount();
    paintCanvas();
    return;
  }
  elements.list.replaceChildren();
  crops.forEach((crop, index) => {
    const item = document.createElement('div');
    item.className = `photo-item${crop.selected ? ' active' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.className = 'photo-check'; checkbox.checked = crop.selected;
    checkbox.setAttribute('aria-label', `Select photo ${index + 1}`);
    checkbox.addEventListener('change', () => { crop.selected = checkbox.checked; item.classList.toggle('active', crop.selected); updatePhotoCount(); paintCanvas(); });
    const thumb = document.createElement('div'); thumb.className = 'photo-thumb';
    const thumbCanvas = document.createElement('canvas'); thumbCanvas.width = 180; thumbCanvas.height = 128; thumb.append(thumbCanvas); drawThumb(thumbCanvas, crop);
    const info = document.createElement('div'); info.className = 'photo-info';
    const title = document.createElement('strong'); title.textContent = `Photo ${String(index + 1).padStart(2, '0')}`;
    const dimensions = document.createElement('span'); dimensions.textContent = `${Math.round(crop.width / state.batch.width * 100)}% page width · ${crop.date ? 'date added' : 'date not set'}`;
    info.append(title, dimensions);
    const remove = document.createElement('button'); remove.className = 'photo-more'; remove.textContent = '×'; remove.title = 'Remove this crop';
    remove.addEventListener('click', () => { state.batch.crops = state.batch.crops.filter((itemCrop) => itemCrop.id !== crop.id); renderPhotoList(); });
    item.append(checkbox, thumb, info, remove); elements.list.append(item);
  });
  updatePhotoCount(); paintCanvas();
}

function setBatch(batch) {
  if (!batch) return;
  const image = new Image();
  image.onload = () => {
    state.batch = { ...batch, previewImage: image, crops: batch.crops || [] };
    state.zoom = 1; state.panX = 0; state.panY = 0;
    elements.empty.classList.add('hidden'); elements.canvasWrap.classList.remove('hidden'); elements.redetect.disabled = false;
    elements.subtitle.textContent = `${batch.sourceName || 'Flatbed image'} · ${batch.width.toLocaleString()} × ${batch.height.toLocaleString()} px`;
    renderPhotoList();
    if (!state.batch.crops.length) showToast('No photos were detected. Try a cleaner scan or drag to add a crop.');
  };
  image.onerror = () => showToast('The image preview could not be loaded.', true);
  image.src = batch.imageData;
}

async function loadDevices() {
  const previousDevice = elements.device.value;
  elements.device.innerHTML = '<option value="">Looking for scanners…</option>';
  elements.refresh.disabled = true;
  try {
    const result = await window.scanbox.listScanners();
    state.devices = result.devices || [];
    const devices = state.devices.filter((device) => device.driver === elements.driver.value);
    elements.device.replaceChildren();
    if (!result.installed) {
      elements.device.add(new Option('Install NAPS2 to scan', ''));
      elements.scannerName.textContent = 'Scanner tool needed'; elements.scannerDriver.textContent = 'Install NAPS2 to scan';
      elements.scannerDot.style.background = '#d2a36a'; elements.scannerDot.style.boxShadow = '0 0 0 3px #faf1e4';
    } else if (!devices.length) {
      elements.device.add(new Option('No scanner found — refresh', ''));
      elements.scannerName.textContent = 'No scanner detected'; elements.scannerDriver.textContent = `${elements.driver.value.toUpperCase()} driver`;
      elements.scannerDot.style.background = '#b5bdb7'; elements.scannerDot.style.boxShadow = '0 0 0 3px #f0f2ef';
    } else {
      if (devices.length > 1) elements.device.add(new Option('Choose a scanner…', ''));
      devices.forEach((device) => elements.device.add(new Option(device.name, device.name)));
      if (devices.some((device) => device.name === previousDevice)) elements.device.value = previousDevice;
      else if (devices.length > 1) elements.device.value = '';
      elements.scannerName.textContent = elements.device.value || (devices.length > 1 ? 'Select your flatbed' : devices[0].name);
      elements.scannerDriver.textContent = `${elements.driver.value.toUpperCase()} flatbed connection`;
      elements.scannerDot.style.background = '#60a477'; elements.scannerDot.style.boxShadow = '0 0 0 3px #eaf5ec';
    }
  } catch (error) {
    elements.device.replaceChildren(new Option('Scanner list unavailable', ''));
    elements.scannerName.textContent = 'Scanner list unavailable'; elements.scannerDriver.textContent = 'Check scanner setup';
    showToast(error.message || 'Could not list scanners.', true);
  } finally { elements.refresh.disabled = false; }
}

function updateScannerStatus() {
  const chosen = state.devices.find((device) => device.name === elements.device.value && device.driver === elements.driver.value);
  if (chosen) { elements.scannerName.textContent = chosen.name; elements.scannerDriver.textContent = `${chosen.driver.toUpperCase()} flatbed connection`; }
  elements.scanDetail.textContent = `${elements.dpi.value} DPI · colour · A4`;
}

function setBusy(busy, title = 'Reading your page…', detail = 'This can take a moment at high resolution') {
  state.busy = busy;
  elements.overlay.classList.toggle('hidden', !busy); elements.processingTitle.textContent = title; elements.processingDetail.textContent = detail;
  elements.scan.disabled = busy; elements.import.disabled = busy; elements.emptyImport.disabled = busy; elements.refresh.disabled = busy;
  elements.chooseFolder.disabled = busy; elements.mapOpen.disabled = busy; elements.sensitivity.disabled = busy;
  updatePhotoCount();
}

async function runScan() {
  if (!elements.device.value) { showToast('Choose a scanner first, or import an image to try the cropper.', true); return; }
  setBusy(true, 'Scanning your A4 page…', `${elements.dpi.value} DPI · colour · flatbed`);
  try {
    const batch = await window.scanbox.scan({ driver: elements.driver.value, device: elements.device.value, dpi: Number(elements.dpi.value), threshold: 242, padding: .025 });
    setBatch(batch);
  } catch (error) { showToast(error.message || 'The scan did not complete.', true); }
  finally { setBusy(false); }
}

async function importImage() {
  setBusy(true, 'Preparing your image…', 'Finding photos against the scanner background');
  try { const batch = await window.scanbox.chooseImage(); if (batch) setBatch(batch); }
  catch (error) { showToast(error.message || 'The image could not be opened.', true); }
  finally { setBusy(false); }
}

async function redetect() {
  if (!state.batch) return;
  setBusy(true, 'Finding photo edges…', 'Re-running the photo separation');
  try {
    const response = await window.scanbox.redetect({ batchId: state.batch.batchId, threshold: Number(elements.sensitivity.value), padding: .025 });
    setBatch(response);
  } catch (error) { showToast(error.message || 'Could not re-detect the photo edges.', true); }
  finally { setBusy(false); }
}

async function chooseFolder() {
  const folder = await window.scanbox.chooseOutputFolder();
  if (folder) {
    state.outputDirectory = folder;
    elements.folder.textContent = folder;
    elements.folder.title = folder;
    updatePhotoCount();
    await updateNextNumber();
  }
}

async function updateNextNumber() {
  const outputDirectory = state.outputDirectory;
  const prefix = elements.prefix.value;
  if (!outputDirectory) return;
  const lookupId = ++state.numberLookupId;
  try {
    const nextNumber = await window.scanbox.getNextOutputNumber({ outputDirectory, prefix });
    if (lookupId === state.numberLookupId && outputDirectory === state.outputDirectory && prefix === elements.prefix.value) {
      elements.start.value = String(nextNumber);
    }
  } catch (error) { showToast(error.message || 'Could not find the next photo number in this folder.', true); }
}

async function restoreOutputFolder() {
  try {
    const folder = await window.scanbox.getLastOutputFolder();
    if (folder && !state.outputDirectory) {
      state.outputDirectory = folder;
      elements.folder.textContent = folder;
      elements.folder.title = folder;
      updatePhotoCount();
      await updateNextNumber();
    }
  } catch (error) { showToast(error.message || 'The previous save folder could not be restored.', true); }
}

function applyFilledMetadata(date) {
  const place = state.place;
  selectedPhotos().forEach((photo) => {
    if (date) photo.date = date;
    if (place) {
      photo.latitude = place?.latitude ?? null;
      photo.longitude = place?.longitude ?? null;
    }
  });
  renderPhotoList();
}

async function savePhotos() {
  if (!state.batch || !state.outputDirectory) return;
  const date = selectedPhotoDate();
  if (date === undefined) { showToast('Enter a valid date in DD / MM / YYYY format.', true); return; }
  applyFilledMetadata(date);
  const photos = selectedPhotos().map((photo) => ({
    id: photo.id, x: photo.x, y: photo.y, width: photo.width, height: photo.height, rotation: cropRotation(photo),
    date: photo.date || null, latitude: photo.latitude, longitude: photo.longitude
  }));
  setBusy(true, 'Saving your photos…', 'Cropping and adding the selected EXIF details');
  try {
    const result = await window.scanbox.saveBatch({ batchId: state.batch.batchId, outputDirectory: state.outputDirectory,
      prefix: elements.prefix.value, startNumber: Number(elements.start.value) || 1, photos });
    const savedIds = new Set(result.savedIds || []);
    state.batch.crops.forEach((photo) => { if (savedIds.has(photo.id)) photo.selected = false; });
    renderPhotoList();
    showToast(`Saved ${result.saved} ${result.saved === 1 ? 'photo' : 'photos'} to ${state.outputDirectory}.`);
    await updateNextNumber();
  } catch (error) { showToast(error.message || 'The photos could not be saved.', true); }
  finally { setBusy(false); }
}

function syncMapMarker(point) {
  if (state.marker) state.map.removeLayer(state.marker);
  state.marker = null;
  if (!point) return;
  const icon = L.divIcon({ className: 'map-pin-icon', html: '<span></span>', iconSize: [24, 30], iconAnchor: [12, 28] });
  state.marker = L.marker([point.latitude, point.longitude], { icon, keyboard: false }).addTo(state.map);
}

function formatCoordinate(point) { return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`; }

function openMap() {
  state.pendingPlace = state.place ? { ...state.place } : null;
  elements.mapModal.classList.remove('hidden');
  if (!state.map) {
    state.map = L.map(elements.map, { zoomControl: true, scrollWheelZoom: true }).setView(state.place ? [state.place.latitude, state.place.longitude] : [53.6, -2.6], state.place ? 9 : 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(state.map);
    const creditsLink = elements.map.querySelector('.leaflet-control-attribution a');
    creditsLink?.addEventListener('click', (event) => { event.preventDefault(); window.scanbox.openMapCredits(); });
    state.map.on('click', (event) => {
      state.pendingPlace = { latitude: event.latlng.lat, longitude: event.latlng.lng };
      syncMapMarker(state.pendingPlace); elements.coordinateText.textContent = formatCoordinate(state.pendingPlace); elements.confirmPlace.disabled = false;
    });
  }
  if (state.pendingPlace) {
    state.map.setView([state.pendingPlace.latitude, state.pendingPlace.longitude], Math.max(state.map.getZoom(), 9));
    syncMapMarker(state.pendingPlace); elements.coordinateText.textContent = formatCoordinate(state.pendingPlace); elements.confirmPlace.disabled = false;
  } else { syncMapMarker(null); elements.coordinateText.textContent = 'No point selected'; elements.confirmPlace.disabled = true; }
  requestAnimationFrame(() => state.map.invalidateSize());
}

function closeMap() { elements.mapModal.classList.add('hidden'); }
function confirmLocation() {
  state.place = state.pendingPlace ? { ...state.pendingPlace } : null;
  elements.placeSummary.textContent = state.place ? formatCoordinate(state.place) : 'No location selected';
  closeMap();
  if (state.place) showToast('Location selected. It will be added to the selected photos when you save.');
}
function clearLocation() {
  state.pendingPlace = null; state.place = null; syncMapMarker(null);
  elements.coordinateText.textContent = 'No point selected'; elements.confirmPlace.disabled = true; elements.placeSummary.textContent = 'No location selected';
}

function eventToImagePoint(event, clampToImage = true) {
  const rect = elements.canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * state.batch.width;
  const y = (event.clientY - rect.top) / rect.height * state.batch.height;
  return clampToImage
    ? { x: Math.max(0, Math.min(state.batch.width, x)), y: Math.max(0, Math.min(state.batch.height, y)) }
    : { x, y };
}

function cropAtHandle(clientX, clientY) {
  const canvasRect = elements.canvas.getBoundingClientRect();
  const previewWidth = state.batch.previewWidth;
  const previewHeight = state.batch.previewHeight;
  const { radius } = handleDimensions();
  const hitRadius = radius * canvasRect.width / elements.canvas.width + 5;
  let nearest = null;
  let nearestDistance = Infinity;
  [...state.batch.crops].reverse().forEach((crop) => {
    if (!crop.selected) return false;
    for (const action of ['move', 'rotate']) {
      const handle = cropHandlePoint(crop, action);
      const screenX = canvasRect.left + handle.x / previewWidth * canvasRect.width;
      const screenY = canvasRect.top + handle.y / previewHeight * canvasRect.height;
      const distance = Math.hypot(clientX - screenX, clientY - screenY);
      if (distance <= hitRadius && distance < nearestDistance) {
        nearest = { crop, action };
        nearestDistance = distance;
      }
    }
  });
  return nearest;
}

function moveCropTo(crop, x, y) {
  crop.x = Math.round(x);
  crop.y = Math.round(y);
}

function angleDelta(current, previous) {
  let delta = current - previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function normalizeRotation(degrees) {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function canvasPointerDown(event) {
  if (!state.batch) return;
  if (event.button === 1) {
    event.preventDefault();
    if (state.zoom <= 1) return;
    elements.canvas.setPointerCapture(event.pointerId);
    state.panning = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY };
    elements.canvasWrap.classList.add('is-panning');
    return;
  }
  if (event.button !== 0) return;
  elements.canvas.setPointerCapture(event.pointerId);
  const point = eventToImagePoint(event);
  const handle = cropAtHandle(event.clientX, event.clientY);
  if (handle?.action === 'rotate') {
    const { crop } = handle;
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    state.rotating = { crop, pointerId: event.pointerId,
      previousPointerAngle: Math.atan2(point.y - centerY, point.x - centerX), rotation: cropRotation(crop) };
    elements.canvas.style.cursor = 'grabbing';
    elements.canvasWrap.classList.add('is-rotating');
    return;
  }
  if (handle?.action === 'move') {
    const { crop } = handle;
    state.moving = { crop, pointerId: event.pointerId, start: point, x: crop.x, y: crop.y };
    elements.canvas.style.cursor = 'grabbing';
    elements.canvasWrap.classList.add('is-moving');
    return;
  }
  state.drawing = { start: point, current: point };
}
function canvasPointerMove(event) {
  if (state.panning?.pointerId === event.pointerId) {
    state.panX = state.panning.panX + event.clientX - state.panning.startX;
    state.panY = state.panning.panY + event.clientY - state.panning.startY;
    applyPreviewTransform();
    return;
  }
  if (state.rotating?.pointerId === event.pointerId) {
    const point = eventToImagePoint(event, false);
    const { crop } = state.rotating;
    const pointerAngle = Math.atan2(point.y - (crop.y + crop.height / 2), point.x - (crop.x + crop.width / 2));
    state.rotating.rotation += angleDelta(pointerAngle, state.rotating.previousPointerAngle) * 180 / Math.PI;
    state.rotating.previousPointerAngle = pointerAngle;
    crop.rotation = normalizeRotation(state.rotating.rotation);
    paintCanvas();
    return;
  }
  if (state.moving?.pointerId === event.pointerId) {
    const point = eventToImagePoint(event, false);
    moveCropTo(state.moving.crop, state.moving.x + point.x - state.moving.start.x, state.moving.y + point.y - state.moving.start.y);
    paintCanvas();
    return;
  }
  if (!state.drawing) {
    elements.canvas.style.cursor = cropAtHandle(event.clientX, event.clientY) ? 'grab' : 'crosshair';
    return;
  }
  state.drawing.current = eventToImagePoint(event);
  paintCanvas();
  const ctx = elements.canvas.getContext('2d');
  const rect = { x: Math.min(state.drawing.start.x, state.drawing.current.x) * state.batch.previewWidth / state.batch.width,
    y: Math.min(state.drawing.start.y, state.drawing.current.y) * state.batch.previewHeight / state.batch.height,
    width: Math.abs(state.drawing.start.x - state.drawing.current.x) * state.batch.previewWidth / state.batch.width,
    height: Math.abs(state.drawing.start.y - state.drawing.current.y) * state.batch.previewHeight / state.batch.height };
  ctx.save(); ctx.strokeStyle = '#e2ad69'; ctx.lineWidth = Math.max(2, elements.canvas.width / 700); ctx.setLineDash([7, 4]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height); ctx.restore();
}
function canvasPointerUp(event) {
  if (state.panning?.pointerId === event.pointerId) {
    state.panning = null;
    elements.canvasWrap.classList.remove('is-panning');
    return;
  }
  if (state.rotating?.pointerId === event.pointerId) {
    state.rotating = null;
    elements.canvasWrap.classList.remove('is-rotating');
    elements.canvas.style.cursor = 'crosshair';
    renderPhotoList();
    return;
  }
  if (state.moving?.pointerId === event.pointerId) {
    state.moving = null;
    elements.canvasWrap.classList.remove('is-moving');
    elements.canvas.style.cursor = 'crosshair';
    renderPhotoList();
    return;
  }
  if (!state.drawing) return;
  const start = state.drawing.start; const end = eventToImagePoint(event);
  const width = Math.abs(start.x - end.x); const height = Math.abs(start.y - end.y); state.drawing = null;
  const movedOnScreen = Math.hypot(width * elements.canvas.clientWidth / state.batch.width, height * elements.canvas.clientHeight / state.batch.height);
  if (movedOnScreen > 8 && width > state.batch.width * .018 && height > state.batch.height * .018) {
    state.manualId += 1;
    state.batch.crops.push({ id: `manual-${state.manualId}`, x: Math.round(Math.min(start.x, end.x)), y: Math.round(Math.min(start.y, end.y)),
      width: Math.round(width), height: Math.round(height), rotation: 0, selected: true, date: null, latitude: null, longitude: null });
    renderPhotoList(); showToast('Manual crop added. Drag over another photo to add its crop.'); return;
  }
  const hit = [...state.batch.crops].reverse().find((crop) => {
    const dx = start.x - (crop.x + crop.width / 2);
    const dy = start.y - (crop.y + crop.height / 2);
    const angle = cropRotation(crop) * Math.PI / 180;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(localX) <= crop.width / 2 && Math.abs(localY) <= crop.height / 2;
  });
  if (hit) { hit.selected = !hit.selected; renderPhotoList(); } else paintCanvas();
}

elements.scan.addEventListener('click', runScan);
elements.import.addEventListener('click', importImage);
elements.emptyImport.addEventListener('click', importImage);
elements.refresh.addEventListener('click', loadDevices);
elements.driver.addEventListener('change', () => { loadDevices(); updateScannerStatus(); });
elements.device.addEventListener('change', updateScannerStatus);
elements.dpi.addEventListener('change', updateScannerStatus);
elements.setup.addEventListener('click', () => window.scanbox.openScannerHelp());
elements.redetect.addEventListener('click', redetect);
elements.sensitivity.addEventListener('input', () => { elements.sensitivityValue.textContent = elements.sensitivity.value; });
elements.chooseFolder.addEventListener('click', chooseFolder);
elements.save.addEventListener('click', savePhotos);
elements.prefix.addEventListener('change', updateNextNumber);
elements.selectAll.addEventListener('click', () => {
  const crops = state.batch?.crops || []; const next = crops.some((crop) => !crop.selected);
  crops.forEach((crop) => { crop.selected = next; }); renderPhotoList();
});
elements.mapOpen.addEventListener('click', openMap);
elements.closeMap.addEventListener('click', closeMap);
elements.mapModal.addEventListener('click', (event) => { if (event.target === elements.mapModal) closeMap(); });
elements.confirmPlace.addEventListener('click', confirmLocation);
elements.clearPlace.addEventListener('click', clearLocation);
elements.canvas.addEventListener('pointerdown', canvasPointerDown);
elements.canvas.addEventListener('pointermove', canvasPointerMove);
elements.canvas.addEventListener('pointerup', canvasPointerUp);
elements.canvas.addEventListener('pointercancel', () => { state.drawing = null; state.rotating = null; state.moving = null; state.panning = null; elements.canvas.style.cursor = 'crosshair'; elements.canvasWrap.classList.remove('is-panning', 'is-rotating', 'is-moving'); paintCanvas(); });
elements.stage.addEventListener('wheel', zoomPreview, { passive: false });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMap(); });

function stepDateValue(input, step) {
  const limits = input === elements.dateDay ? [1, 31] : input === elements.dateMonth ? [1, 12] : [1, 9999];
  const current = Number(input.value);
  const next = Math.max(limits[0], Math.min(limits[1], (Number.isFinite(current) ? current : 0) + step));
  input.value = String(next).padStart(input === elements.dateYear ? 4 : 2, '0');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus({ preventScroll: true });
}

for (const input of [elements.dateDay, elements.dateMonth, elements.dateYear]) {
  input.addEventListener('input', (event) => {
    input.value = input.value.replace(/\D/g, '').slice(0, input === elements.dateYear ? 4 : 2);
    if (event.isTrusted && input !== elements.dateYear && input.value.length === 2) {
      (input === elements.dateDay ? elements.dateMonth : elements.dateYear).focus();
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    stepDateValue(input, event.key === 'ArrowUp' ? 1 : -1);
  });
}

for (const button of document.querySelectorAll('.date-step-button')) {
  button.addEventListener('click', () => {
    const input = $(button.dataset.dateTarget);
    if (input) stepDateValue(input, Number(button.dataset.step));
  });
}
renderPhotoList();
restoreOutputFolder();
loadDevices().then(updateScannerStatus);
