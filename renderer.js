const electronMode = Boolean(window.scanbox);
const state = { batch: null, devices: [], outputDirectory: '', place: null, map: null, marker: null, pendingPlace: null, mapSearchRequest: 0, manualId: 0, drawing: null, rotating: null, moving: null, resizing: null, panning: null, zoom: 1, panX: 0, panY: 0, toastTimer: null, busy: false, photoDetectionEnabled: true, birthdayMode: false, numberLookupId: 0, browserSourceUrl: null };
const $ = (id) => document.getElementById(id);
const elements = {
  scannerName: $('sidebarScannerName'), scannerDriver: $('sidebarScannerDriver'), scannerDot: $('scannerStatusDot'),
  driver: $('driverSelect'), device: $('deviceSelect'), dpi: $('dpiSelect'), scan: $('scanBtn'), scanDetail: $('scanButtonDetail'),
  import: $('importBtn'), emptyImport: $('emptyImportBtn'), refresh: $('refreshScanners'), setup: $('setupBtn'),
  empty: $('emptyPreview'), canvasWrap: $('canvasWrap'), canvas: $('scanCanvas'), stage: $('previewStage'), metaToolbar: document.querySelector('.meta-toolbar'),
  overlay: $('processingOverlay'), processingTitle: $('processingTitle'), processingDetail: $('processingDetail'), subtitle: $('previewSubtitle'),
  detected: $('detectedPill'), detectionToggle: $('detectionToggle'), redetect: $('redetectBtn'), list: $('photoList'), selectionSummary: $('selectionSummary'),
  selectAll: $('selectAllBtn'), dateDay: $('dateDayInput'), dateMonth: $('dateMonthInput'), dateYear: $('dateYearInput'),
  birthdayModeToggle: $('birthdayModeToggle'), dateModeLabel: $('dateModeLabel'), birthdayAgeLabel: $('birthdayAgeLabel'), simpleDateFields: $('simpleDateFields'), birthdayAge: $('birthdayAgeInput'), dateInputWrap: $('dateInputWrap'), placeSummary: $('placeSummary'), mapOpen: $('mapOpenBtn'),
  folder: $('folderSummary'), chooseFolder: $('chooseFolderBtn'), save: $('saveBtn'),
  prefix: $('filenamePrefix'), start: $('startNumber'), toast: $('toast'), mapModal: $('mapModal'), map: $('map'),
  closeMap: $('closeMapBtn'), coordinateText: $('coordinateText'), confirmPlace: $('confirmLocationBtn'), clearPlace: $('clearLocationBtn'),
  mapSearch: $('mapSearch'), mapSearchForm: $('mapSearchForm'), mapSearchInput: $('mapSearchInput'), mapSearchButton: $('mapSearchButton'),
  mapSearchResults: $('mapSearchResults'), mapSearchStatus: $('mapSearchStatus'),
  sensitivity: $('sensitivity'), sensitivityValue: $('sensitivityValue'),
  browserImage: $('browserImageInput'), saveNote: $('saveNote')
};

if (!electronMode) {
  document.body.classList.add('browser-mode');
  document.querySelector('.empty-preview h3').textContent = 'Import a page or photo';
  document.querySelector('.empty-preview p').innerHTML = 'Choose an image from your device to start cropping.<br />Your selected photos will download as JPEGs.';
  document.querySelector('.panel-heading h3').textContent = 'Image preview';
  elements.subtitle.textContent = 'Choose an image to begin';
  elements.import.querySelector('strong').textContent = 'Choose an image';
  elements.import.querySelector('small').textContent = 'from this device';
  document.querySelector('.meta-heading span').textContent = 'Details are saved in this browser';
  elements.saveNote.innerHTML = '<span>✓</span> Date, GPS coordinates, and resolution are embedded in each downloaded JPEG.';
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.remove('hidden');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 4200);
}

function storedPhotoDetails() {
  try { return JSON.parse(localStorage.getItem('scanbox-photo-details') || '{}'); }
  catch { return {}; }
}

function savePhotoDetails(details) {
  if (electronMode) return window.scanbox.savePhotoDetails(details);
  try {
    const saved = { ...storedPhotoDetails(), ...details };
    localStorage.setItem('scanbox-photo-details', JSON.stringify(saved));
    return Promise.resolve(saved);
  } catch (error) { return Promise.reject(error); }
}

function selectedPhotos() { return state.batch?.crops.filter((photo) => photo.selected) || []; }

function validIsoPhotoDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === isoDate;
}

function datePickerPhotoDate() {
  const parts = [elements.dateDay.value.trim(), elements.dateMonth.value.trim(), elements.dateYear.value.trim()];
  if (parts.every((part) => part === '')) return null;
  if (!/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1]) || !/^\d{4}$/.test(parts[2])) return undefined;
  const [day, month, year] = parts.map(Number);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1) return undefined;
  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return validIsoPhotoDate(isoDate) ? isoDate : undefined;
}

function birthdayPhotoDate() {
  const dateOfBirth = datePickerPhotoDate();
  const ageText = elements.birthdayAge.value.trim();
  if (dateOfBirth === null && !ageText) return null;
  if (!dateOfBirth || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(ageText)) return undefined;
  const today = new Date();
  const todayIso = `${String(today.getFullYear()).padStart(4, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (dateOfBirth > todayIso) return undefined;
  const age = Number(ageText);
  if (!Number.isFinite(age) || age < 0 || age > 120) return undefined;
  const [birthYear, month, day] = dateOfBirth.split('-').map(Number);
  const anniversaryDate = (yearsAfterBirth) => {
    const year = birthYear + yearsAfterBirth;
    if (year > 9999) return null;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const anniversaryDay = Math.min(day, daysInMonth[month - 1]);
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(anniversaryDay).padStart(2, '0')}`;
  };
  const wholeYears = Math.floor(age);
  const birthdayAtWholeAge = anniversaryDate(wholeYears);
  if (!birthdayAtWholeAge) return undefined;
  const fraction = age - wholeYears;
  if (fraction === 0) return birthdayAtWholeAge;
  const birthdayNextYear = anniversaryDate(wholeYears + 1);
  if (!birthdayNextYear) return undefined;
  const startTime = new Date(`${birthdayAtWholeAge}T00:00:00Z`).getTime();
  const nextTime = new Date(`${birthdayNextYear}T00:00:00Z`).getTime();
  const estimatedPhotoTime = startTime + Math.round((nextTime - startTime) * fraction);
  return new Date(estimatedPhotoTime).toISOString().slice(0, 10);
}

function updateDateMode() {
  elements.dateInputWrap.classList.toggle('birthday-mode', state.birthdayMode);
  elements.metaToolbar.classList.toggle('birthday-mode', state.birthdayMode);
  elements.birthdayModeToggle.setAttribute('aria-pressed', String(state.birthdayMode));
  elements.dateModeLabel.textContent = state.birthdayMode ? 'DATE OF BIRTH' : 'PHOTO DATE';
  elements.simpleDateFields.setAttribute('aria-label', `${state.birthdayMode ? 'Date of birth' : 'Photo date'}, day month year`);
  elements.birthdayAgeLabel.classList.toggle('hidden', !state.birthdayMode);
  elements.birthdayAge.classList.toggle('hidden', !state.birthdayMode);
}

function selectedPhotoDate() {
  if (state.birthdayMode) return birthdayPhotoDate();
  return datePickerPhotoDate();
}

function formatPhotoDateLabel(date) {
  if (!date) return 'date not set';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function photoSummaryText(crop, selectedDate) {
  const dateToApply = crop.selected && selectedDate !== null ? selectedDate : crop.date;
  const dateLabel = crop.selected && selectedDate === undefined ? 'invalid date' : formatPhotoDateLabel(dateToApply);
  return `${Math.round(crop.width / state.batch.width * 100)}% page width · ${dateLabel}`;
}

function persistPhotoDetails({ date = !state.birthdayMode, birthday = false, location = true } = {}) {
  const details = {};
  if (date) details.date = { day: elements.dateDay.value, month: elements.dateMonth.value, year: elements.dateYear.value };
  if (birthday) details.birthday = { enabled: state.birthdayMode, dateOfBirth: datePickerPhotoDate() || '', age: elements.birthdayAge.value };
  if (location) details.location = state.place;
  savePhotoDetails(details).catch((error) => showToast(error.message || 'Could not save the photo details.', true));
}

async function restorePhotoDetails() {
  try {
    const details = electronMode ? await window.scanbox.getLastPhotoDetails() : storedPhotoDetails();
    elements.dateDay.value = details.date?.day || '';
    elements.dateMonth.value = details.date?.month || '';
    elements.dateYear.value = details.date?.year || '';
    state.birthdayMode = details.birthday?.enabled === true;
    if (state.birthdayMode && details.birthday?.dateOfBirth) {
      const [year, month, day] = details.birthday.dateOfBirth.split('-');
      elements.dateDay.value = day || '';
      elements.dateMonth.value = month || '';
      elements.dateYear.value = year || '';
    }
    elements.birthdayAge.value = details.birthday?.age || '';
    updateDateMode();
    state.place = details.location || null;
    elements.placeSummary.textContent = state.place ? formatCoordinate(state.place) : 'No location selected';
    renderPhotoList();
  } catch { /* Keep blank defaults if preferences are unavailable. */ }
}

function updatePhotoCount() {
  const crops = state.batch?.crops || [];
  const count = crops.length;
  const selected = crops.filter((photo) => photo.selected).length;
  elements.detected.textContent = `${count} ${count === 1 ? 'photo' : 'photos'} found`;
  elements.selectionSummary.textContent = count ? `${selected} of ${count} selected to save` : 'No photos found yet';
  elements.selectAll.classList.toggle('hidden', count === 0);
  elements.selectAll.textContent = selected === count ? 'Deselect all' : 'Select all';
  elements.save.disabled = state.busy || !count || selected === 0 || (electronMode && !state.outputDirectory);
  elements.detectionToggle.disabled = state.busy || !state.batch;
  elements.detectionToggle.setAttribute('aria-pressed', String(state.photoDetectionEnabled));
  elements.detectionToggle.setAttribute('aria-label', `Photo detection ${state.photoDetectionEnabled ? 'on' : 'off'}`);
  elements.detectionToggle.lastElementChild.textContent = `Detection ${state.photoDetectionEnabled ? 'on' : 'off'}`;
  elements.redetect.disabled = state.busy || !state.batch || !state.photoDetectionEnabled;
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

const cropCorners = {
  topLeft: { x: -1, y: -1 },
  topRight: { x: 1, y: -1 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: -1, y: 1 }
};

function cropCornerPoint(crop, corner) {
  const box = previewBounds(crop);
  const { x: signX, y: signY } = cropCorners[corner];
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const angle = cropRotation(crop) * Math.PI / 180;
  const localX = signX * box.width / 2;
  const localY = signY * box.height / 2;
  return {
    x: centerX + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: centerY + localX * Math.sin(angle) + localY * Math.cos(angle)
  };
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
    ctx.font = `600 ${Math.max(12, canvas.width / 87.5)}px Segoe UI, sans-serif`;
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

      const cornerSize = radius * 1.35;
      Object.values(cropCorners).forEach(({ x, y }) => {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#38784f';
        ctx.lineWidth = Math.max(1.5, radius * .24);
        ctx.fillRect(x * box.width / 2 - cornerSize / 2, y * box.height / 2 - cornerSize / 2, cornerSize, cornerSize);
        ctx.strokeRect(x * box.width / 2 - cornerSize / 2, y * box.height / 2 - cornerSize / 2, cornerSize, cornerSize);
      });
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
  const selectedDate = selectedPhotoDate();
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
    const thumb = document.createElement('div'); thumb.className = 'photo-thumb';
    const thumbCanvas = document.createElement('canvas'); thumbCanvas.width = 180; thumbCanvas.height = 128; thumb.append(thumbCanvas); drawThumb(thumbCanvas, crop);
    const info = document.createElement('div'); info.className = 'photo-info';
    const title = document.createElement('strong'); title.textContent = `Photo ${String(index + 1).padStart(2, '0')}`;
    const dimensions = document.createElement('span');
    dimensions.textContent = photoSummaryText(crop, selectedDate);
    checkbox.addEventListener('change', () => {
      crop.selected = checkbox.checked;
      item.classList.toggle('active', crop.selected);
      dimensions.textContent = photoSummaryText(crop, selectedDate);
      updatePhotoCount();
      paintCanvas();
    });
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
    state.batch = { ...batch, previewImage: image,
      crops: (batch.crops || []).filter((crop) => state.photoDetectionEnabled || (crop.source !== 'detected' && !crop.id.startsWith('crop-'))) };
    state.zoom = 1; state.panX = 0; state.panY = 0;
    elements.empty.classList.add('hidden'); elements.canvasWrap.classList.remove('hidden');
    elements.subtitle.textContent = `${batch.sourceName || 'Flatbed image'} · ${batch.width.toLocaleString()} × ${batch.height.toLocaleString()} px`;
    renderPhotoList();
    if (!state.batch.crops.length && state.photoDetectionEnabled) showToast('No photos were detected. Try a cleaner scan or drag to add a crop.');
  };
  image.onerror = () => showToast('The image preview could not be loaded.', true);
  image.src = batch.imageData;
}

async function loadDevices() {
  if (!electronMode) return;
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
  if (!electronMode) return importImage();
  if (!elements.device.value) { showToast('Choose a scanner first, or import an image to try the cropper.', true); return; }
  setBusy(true, 'Scanning your A4 page…', `${elements.dpi.value} DPI · colour · flatbed`);
  try {
    const batch = await window.scanbox.scan({ driver: elements.driver.value, device: elements.device.value, dpi: Number(elements.dpi.value), threshold: 242, padding: .025,
      detectPhotos: state.photoDetectionEnabled });
    setBatch(batch);
  } catch (error) { showToast(error.message || 'The scan did not complete.', true); }
  finally { setBusy(false); }
}

async function importImage() {
  if (!electronMode) { elements.browserImage.click(); return; }
  setBusy(true, 'Preparing your image…', state.photoDetectionEnabled ? 'Finding photos against the scanner background' : 'Loading the image without photo detection');
  try { const batch = await window.scanbox.chooseImage({ detectPhotos: state.photoDetectionEnabled }); if (batch) setBatch(batch); }
  catch (error) { showToast(error.message || 'The image could not be opened.', true); }
  finally { setBusy(false); }
}

function browserDetectCrops(image, threshold = Number(elements.sensitivity.value), padding = .025) {
  const scale = Math.min(1, 1400 / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < gray.length; pixel += 1, offset += 4) {
    gray[pixel] = Math.round(pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114);
  }
  const regions = window.ScanboxCropper.findPhotoRegions(gray, width, height, threshold, padding);
  const scaleX = image.naturalWidth / width;
  const scaleY = image.naturalHeight / height;
  return regions.map((region, index) => ({
    id: `crop-${index + 1}`,
    x: Math.max(0, Math.round(region.x * scaleX)),
    y: Math.max(0, Math.round(region.y * scaleY)),
    width: Math.min(image.naturalWidth, Math.round(region.width * scaleX)),
    height: Math.min(image.naturalHeight, Math.round(region.height * scaleY)),
    source: 'detected',
    selected: region.width < width * .98 && region.height < height * .98,
    date: null,
    latitude: null,
    longitude: null
  }));
}

function browserImageBatch(image, file, detectPhotos = true) {
  const previewScale = Math.min(1, 1600 / image.naturalWidth);
  const previewWidth = Math.max(1, Math.round(image.naturalWidth * previewScale));
  const previewHeight = Math.max(1, Math.round(image.naturalHeight * previewScale));
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = previewWidth;
  previewCanvas.height = previewHeight;
  previewCanvas.getContext('2d').drawImage(image, 0, 0, previewWidth, previewHeight);
  return {
    sourceName: file.name,
    imageData: previewCanvas.toDataURL('image/jpeg', .82),
    image: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dpi: 300,
    previewWidth,
    previewHeight,
    crops: detectPhotos ? browserDetectCrops(image) : []
  };
}

function loadBrowserImage(file) {
  if (!file) return;
  setBusy(true, 'Preparing your image…', state.photoDetectionEnabled ? 'Finding photo edges in your browser' : 'Loading the image without photo detection');
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    try {
      if (image.naturalWidth * image.naturalHeight > 160_000_000 || Math.max(image.naturalWidth, image.naturalHeight) > 32767) {
        throw new Error('This image is too large for browser mode. Choose an image under 160 megapixels with sides below 32,768 pixels.');
      }
      const batch = browserImageBatch(image, file, state.photoDetectionEnabled);
      if (state.browserSourceUrl) URL.revokeObjectURL(state.browserSourceUrl);
      state.browserSourceUrl = sourceUrl;
      setBatch(batch);
    } catch (error) {
      URL.revokeObjectURL(sourceUrl);
      showToast(error.message || 'The image could not be prepared.', true);
    } finally { setBusy(false); }
  };
  image.onerror = () => {
    URL.revokeObjectURL(sourceUrl);
    showToast('This browser could not read the image. Try a JPEG, PNG, WebP, or BMP file.', true);
    setBusy(false);
  };
  image.src = sourceUrl;
}

async function redetect() {
  if (!state.batch || !state.photoDetectionEnabled) return false;
  const manualCrops = state.batch.crops.filter((crop) => crop.source === 'manual' || crop.id.startsWith('manual-'));
  setBusy(true, 'Finding photo edges…', 'Re-running the photo separation');
  try {
    if (!electronMode) {
      const crops = browserDetectCrops(state.batch.image, Number(elements.sensitivity.value));
      setBatch({ ...state.batch, crops: [...crops, ...manualCrops] });
      return true;
    }
    const response = await window.scanbox.redetect({ batchId: state.batch.batchId, threshold: Number(elements.sensitivity.value), padding: .025 });
    setBatch({ ...response, crops: [...(response.crops || []), ...manualCrops] });
    return true;
  } catch (error) { showToast(error.message || 'Could not re-detect the photo edges.', true); return false; }
  finally { setBusy(false); }
}

async function togglePhotoDetection() {
  if (!state.batch || state.busy) return;
  if (state.photoDetectionEnabled) {
    state.photoDetectionEnabled = false;
    state.batch.crops = state.batch.crops.filter((crop) => crop.source !== 'detected' && !crop.id.startsWith('crop-'));
    renderPhotoList();
    showToast('Photo detection is off. You can still add crops manually.');
    return;
  }
  state.photoDetectionEnabled = true;
  updatePhotoCount();
  if (!await redetect()) {
    state.photoDetectionEnabled = false;
    updatePhotoCount();
  }
}

async function chooseFolder() {
  if (!electronMode) return;
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
  if (!electronMode) return;
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
  if (!electronMode) return;
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

function browserCropCanvas(crop) {
  const image = state.batch.image;
  const width = Math.round(crop.width);
  const height = Math.round(crop.height);
  if (width < 1 || height < 1 || width > 32767 || height > 32767 || width * height > 160_000_000) {
    throw new Error('A selected crop is too large to export in this browser.');
  }
  const degrees = cropRotation(crop);
  const radians = -degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotatedWidth = Math.abs(sine) < 1e-10 ? state.batch.width : Math.ceil(state.batch.width * Math.abs(cosine) + state.batch.height * Math.abs(sine));
  const rotatedHeight = Math.abs(sine) < 1e-10 ? state.batch.height : Math.ceil(state.batch.height * Math.abs(cosine) + state.batch.width * Math.abs(sine));
  const centerX = crop.x + width / 2 - state.batch.width / 2;
  const centerY = crop.y + height / 2 - state.batch.height / 2;
  const rotatedCenterX = cosine * centerX - sine * centerY + rotatedWidth / 2;
  const rotatedCenterY = sine * centerX + cosine * centerY + rotatedHeight / 2;
  const left = Math.round(rotatedCenterX - width / 2);
  const top = Math.round(rotatedCenterY - height / 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.translate(-left, -top);
  context.translate(rotatedWidth / 2, rotatedHeight / 2);
  context.rotate(radians);
  context.drawImage(image, -state.batch.width / 2, -state.batch.height / 2);
  return canvas;
}

async function browserJpegBlob(canvas, photo) {
  const jpeg = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode a JPEG download.')), 'image/jpeg', .96);
  });
  return window.ScanboxExif.addExif(jpeg, {
    date: photo.date,
    latitude: photo.latitude,
    longitude: photo.longitude,
    dpi: state.batch.dpi || 300
  });
}

function safeBrowserPrefix(value) {
  return String(value || 'Photo').replace(/[<>:"|?*]/g, '-').replaceAll('/', '-').replaceAll('\\', '-').trim() || 'Photo';
}

async function downloadSelectedPhotos(photos) {
  const prefix = safeBrowserPrefix(elements.prefix.value);
  const firstNumber = Math.max(1, Number(elements.start.value) || 1);
  const downloads = await Promise.all(photos.map(async (photo, index) => {
    const canvas = browserCropCanvas(photo);
    const blob = await browserJpegBlob(canvas, photo);
    return { photo, blob, filename: `${prefix}-${String(firstNumber + index).padStart(3, '0')}.jpg` };
  }));
  for (const download of downloads) {
    const url = URL.createObjectURL(download.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = download.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return downloads.map(({ photo }) => photo.id);
}

async function savePhotos() {
  if (!state.batch || (electronMode && !state.outputDirectory)) return;
  const date = selectedPhotoDate();
  if (date === undefined) {
    showToast(state.birthdayMode ? 'Enter a valid birthday and an age from 0 to 120.' : 'Enter a valid date in DD / MM / YYYY format.', true);
    return;
  }
  applyFilledMetadata(date);
  const photos = selectedPhotos().map((photo) => ({
    id: photo.id, x: photo.x, y: photo.y, width: photo.width, height: photo.height, rotation: cropRotation(photo),
    date: photo.date || null, latitude: photo.latitude, longitude: photo.longitude
  }));
  setBusy(true, electronMode ? 'Saving your photos…' : 'Preparing JPEG downloads…', electronMode ? 'Cropping and adding the selected EXIF details' : 'Cropping your selected photos in this browser');
  try {
    if (!electronMode) {
      const savedIds = new Set(await downloadSelectedPhotos(selectedPhotos()));
      state.batch.crops.forEach((photo) => { if (savedIds.has(photo.id)) photo.selected = false; });
      renderPhotoList();
      const saved = savedIds.size;
      showToast(`${saved} ${saved === 1 ? 'photo is' : 'photos are'} downloading. Check your browser’s downloads.`);
      elements.start.value = String((Number(elements.start.value) || 1) + saved);
      return;
    }
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

function selectMapSearchResult(place) {
  const point = { latitude: place.latitude, longitude: place.longitude };
  state.pendingPlace = point;
  state.map.setView([point.latitude, point.longitude], Math.max(state.map.getZoom(), 14));
  syncMapMarker(point);
  elements.coordinateText.textContent = formatCoordinate(point);
  elements.confirmPlace.disabled = false;
  elements.mapSearchResults.classList.add('hidden');
  elements.mapSearchStatus.textContent = `${place.name} selected on the map`;
}

function renderMapSearchResults(results) {
  elements.mapSearchResults.replaceChildren();
  if (!results.length) {
    elements.mapSearchResults.classList.add('hidden');
    elements.mapSearchStatus.textContent = 'No places found. Try a nearby town or a fuller address.';
    return;
  }
  for (const place of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-search-result';
    const name = document.createElement('strong');
    name.textContent = place.name;
    const label = document.createElement('span');
    label.textContent = place.label;
    button.append(name, label);
    button.addEventListener('click', () => selectMapSearchResult(place));
    elements.mapSearchResults.append(button);
  }
  elements.mapSearchResults.classList.remove('hidden');
  elements.mapSearchStatus.textContent = `${results.length} ${results.length === 1 ? 'place' : 'places'} found. Select one to preview it on the map.`;
}

async function searchMapPlaces(event) {
  event.preventDefault();
  const query = elements.mapSearchInput.value.trim();
  if (!query) {
    elements.mapSearchStatus.textContent = 'Enter a place name or address to search.';
    elements.mapSearchInput.focus();
    return;
  }
  const requestId = ++state.mapSearchRequest;
  elements.mapSearchButton.disabled = true;
  elements.mapSearchResults.replaceChildren();
  elements.mapSearchResults.classList.add('hidden');
  elements.mapSearchStatus.textContent = 'Searching places…';
  try {
    const results = electronMode
      ? await window.scanbox.searchMapPlaces(query)
      : await searchBrowserMapPlaces(query);
    if (requestId === state.mapSearchRequest) renderMapSearchResults(results);
  } catch (error) {
    if (requestId === state.mapSearchRequest) elements.mapSearchStatus.textContent = error.message || 'Place search failed. Check your connection and try again.';
  } finally {
    if (requestId === state.mapSearchRequest) elements.mapSearchButton.disabled = false;
  }
}

const browserPlaceCache = new Map();
let browserNextPlaceSearchAt = 0;

async function searchBrowserMapPlaces(query) {
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  const cacheKey = normalizedQuery.toLocaleLowerCase('en-GB');
  const cached = browserPlaceCache.get(cacheKey);
  if (cached) return cached;
  const delay = Math.max(0, browserNextPlaceSearchAt - Date.now());
  browserNextPlaceSearchAt = Math.max(Date.now(), browserNextPlaceSearchAt) + 1100;
  if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
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
    && Math.abs(place.latitude) <= 90 && Math.abs(place.longitude) <= 180);
  browserPlaceCache.set(cacheKey, results);
  return results;
}

function openMap() {
  state.pendingPlace = state.place ? { ...state.place } : null;
  elements.mapModal.classList.remove('hidden');
  elements.mapSearchResults.replaceChildren();
  elements.mapSearchResults.classList.add('hidden');
  elements.mapSearchStatus.textContent = 'Search for a place or address';
  if (!state.map) {
    state.map = L.map(elements.map, { zoomControl: true, scrollWheelZoom: true }).setView(state.place ? [state.place.latitude, state.place.longitude] : [53.6, -2.6], state.place ? 9 : 5);
    L.DomEvent.disableClickPropagation(elements.mapSearch);
    L.DomEvent.disableScrollPropagation(elements.mapSearch);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(state.map);
    const creditsLink = elements.map.querySelector('.leaflet-control-attribution a');
    if (electronMode) creditsLink?.addEventListener('click', (event) => { event.preventDefault(); window.scanbox.openMapCredits(); });
    state.map.on('click', (event) => {
      state.pendingPlace = { latitude: event.latlng.lat, longitude: event.latlng.lng };
      syncMapMarker(state.pendingPlace); elements.coordinateText.textContent = formatCoordinate(state.pendingPlace); elements.confirmPlace.disabled = false;
      elements.mapSearchResults.classList.add('hidden');
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
  persistPhotoDetails({ date: false });
  closeMap();
  if (state.place) showToast(electronMode ? 'Location selected. It will be added to the selected photos when you save.' : 'Location selected for this browser session.');
}
function clearLocation() {
  state.pendingPlace = null; state.place = null; syncMapMarker(null);
  elements.coordinateText.textContent = 'No point selected'; elements.confirmPlace.disabled = true; elements.placeSummary.textContent = 'No location selected';
  persistPhotoDetails({ date: false });
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
    const handles = [
      ...Object.keys(cropCorners).map((corner) => ({ action: 'resize', corner, point: cropCornerPoint(crop, corner) })),
      ...['move', 'rotate'].map((action) => ({ action, point: cropHandlePoint(crop, action) }))
    ];
    for (const { action, corner, point } of handles) {
      const handle = point;
      const screenX = canvasRect.left + handle.x / previewWidth * canvasRect.width;
      const screenY = canvasRect.top + handle.y / previewHeight * canvasRect.height;
      const distance = Math.hypot(clientX - screenX, clientY - screenY);
      if (distance <= hitRadius && distance < nearestDistance) {
        nearest = { crop, action, corner };
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

function resizeCropFromCorner(crop, corner, point) {
  const { x: signX, y: signY } = cropCorners[corner];
  const angle = cropRotation(crop) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const anchorX = centerX + cosine * (-signX * crop.width / 2) - sine * (-signY * crop.height / 2);
  const anchorY = centerY + sine * (-signX * crop.width / 2) + cosine * (-signY * crop.height / 2);
  const dx = point.x - anchorX;
  const dy = point.y - anchorY;
  const localX = cosine * dx + sine * dy;
  const localY = -sine * dx + cosine * dy;
  const minWidth = Math.min(20, state.batch.width);
  const minHeight = Math.min(20, state.batch.height);
  const width = Math.round(Math.max(minWidth, Math.min(state.batch.width, signX * localX)));
  const height = Math.round(Math.max(minHeight, Math.min(state.batch.height, signY * localY)));
  const nextCenterX = anchorX + cosine * (signX * width / 2) - sine * (signY * height / 2);
  const nextCenterY = anchorY + sine * (signX * width / 2) + cosine * (signY * height / 2);
  crop.width = width;
  crop.height = height;
  crop.x = Math.round(nextCenterX - width / 2);
  crop.y = Math.round(nextCenterY - height / 2);
}

function cropAtPoint(point) {
  return [...state.batch.crops].reverse().find((crop) => {
    const dx = point.x - (crop.x + crop.width / 2);
    const dy = point.y - (crop.y + crop.height / 2);
    const angle = cropRotation(crop) * Math.PI / 180;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(localX) <= crop.width / 2 && Math.abs(localY) <= crop.height / 2;
  });
}

function deleteCropAtPointer(event) {
  event.preventDefault();
  if (!state.batch) return;
  const crop = cropAtPoint(eventToImagePoint(event));
  if (!crop) return;
  state.batch.crops = state.batch.crops.filter((item) => item.id !== crop.id);
  renderPhotoList();
  showToast('Crop removed.');
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
  if (handle?.action === 'resize') {
    state.resizing = { crop: handle.crop, corner: handle.corner, pointerId: event.pointerId };
    elements.canvas.style.cursor = 'grabbing';
    elements.canvasWrap.classList.add('is-resizing');
    return;
  }
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
  if (state.resizing?.pointerId === event.pointerId) {
    resizeCropFromCorner(state.resizing.crop, state.resizing.corner, eventToImagePoint(event, false));
    paintCanvas();
    return;
  }
  if (!state.drawing) {
    const handle = cropAtHandle(event.clientX, event.clientY);
    elements.canvas.style.cursor = handle?.action === 'resize'
      ? (handle.corner === 'topLeft' || handle.corner === 'bottomRight' ? 'nwse-resize' : 'nesw-resize')
      : handle ? 'grab' : 'crosshair';
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
  if (state.resizing?.pointerId === event.pointerId) {
    state.resizing = null;
    elements.canvasWrap.classList.remove('is-resizing');
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
      width: Math.round(width), height: Math.round(height), rotation: 0, source: 'manual', selected: true, date: null, latitude: null, longitude: null });
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
elements.browserImage.addEventListener('change', () => {
  loadBrowserImage(elements.browserImage.files?.[0]);
  elements.browserImage.value = '';
});
elements.refresh.addEventListener('click', loadDevices);
elements.driver.addEventListener('change', () => { loadDevices(); updateScannerStatus(); });
elements.device.addEventListener('change', updateScannerStatus);
elements.dpi.addEventListener('change', updateScannerStatus);
elements.setup.addEventListener('click', () => { if (electronMode) window.scanbox.openScannerHelp(); });
elements.redetect.addEventListener('click', redetect);
elements.detectionToggle.addEventListener('click', togglePhotoDetection);
elements.sensitivity.addEventListener('input', () => { elements.sensitivityValue.textContent = elements.sensitivity.value; });
elements.chooseFolder.addEventListener('click', chooseFolder);
elements.save.addEventListener('click', savePhotos);
elements.prefix.addEventListener('change', updateNextNumber);
elements.selectAll.addEventListener('click', () => {
  const crops = state.batch?.crops || []; const next = crops.some((crop) => !crop.selected);
  crops.forEach((crop) => { crop.selected = next; }); renderPhotoList();
});
elements.mapOpen.addEventListener('click', openMap);
elements.mapSearchForm.addEventListener('submit', searchMapPlaces);
elements.closeMap.addEventListener('click', closeMap);
elements.mapModal.addEventListener('click', (event) => { if (event.target === elements.mapModal) closeMap(); });
elements.confirmPlace.addEventListener('click', confirmLocation);
elements.clearPlace.addEventListener('click', clearLocation);
elements.canvas.addEventListener('pointerdown', canvasPointerDown);
elements.canvas.addEventListener('pointermove', canvasPointerMove);
elements.canvas.addEventListener('pointerup', canvasPointerUp);
elements.canvas.addEventListener('contextmenu', deleteCropAtPointer);
elements.canvas.addEventListener('pointercancel', () => { state.drawing = null; state.rotating = null; state.moving = null; state.resizing = null; state.panning = null; elements.canvas.style.cursor = 'crosshair'; elements.canvasWrap.classList.remove('is-panning', 'is-rotating', 'is-moving', 'is-resizing'); paintCanvas(); });
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
    persistPhotoDetails({ date: !state.birthdayMode, birthday: state.birthdayMode, location: false });
    renderPhotoList();
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

elements.birthdayModeToggle.addEventListener('click', () => {
  state.birthdayMode = !state.birthdayMode;
  updateDateMode();
  persistPhotoDetails({ date: !state.birthdayMode, birthday: true, location: false });
  renderPhotoList();
});

elements.birthdayAge.addEventListener('input', () => {
  persistPhotoDetails({ date: false, birthday: true, location: false });
  renderPhotoList();
});

for (const button of document.querySelectorAll('.date-step-button')) {
  button.addEventListener('click', () => {
    const input = $(button.dataset.dateTarget);
    if (input) stepDateValue(input, Number(button.dataset.step));
  });
}
renderPhotoList();
restorePhotoDetails();
restoreOutputFolder();
loadDevices().then(updateScannerStatus);
