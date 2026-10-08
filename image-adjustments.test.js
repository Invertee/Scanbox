const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { test } = require('node:test');
const sharp = require('sharp');
const adjustments = require('./image-adjustments');
const { adjustedExport } = require('./adjusted-export');

function pixel(rgb, settings) {
  const data = Buffer.from(rgb);
  adjustments.apply(data, 1, 1, 3, settings);
  return [...data];
}

test('neutral and disabled adjustments preserve pixels exactly', () => {
  const source = [10, 100, 240];
  assert.deepEqual(pixel(source, {}), source);
  assert.deepEqual(pixel(source, { enabled: false, brightness: 100, sharpness: 100 }), source);
});

test('each tonal control affects its intended range', () => {
  assert.ok(pixel([100, 100, 100], { brightness: 40 })[0] > 100);
  assert.ok(pixel([100, 100, 100], { exposure: 1 })[0] > 100);
  assert.ok(pixel([100, 100, 100], { exposure: -1 })[0] < 100);
  assert.ok(pixel([200, 200, 200], { contrast: 50 })[0] > 200);
  assert.ok(pixel([50, 50, 50], { contrast: 50 })[0] < 50);
  const shadowLift = pixel([40, 40, 40], { shadows: 50 })[0] - 40;
  const highlightLift = pixel([220, 220, 220], { shadows: 50 })[0] - 220;
  assert.ok(shadowLift > highlightLift);
  const highlightReduction = 220 - pixel([220, 220, 220], { highlights: -50 })[0];
  const shadowReduction = 40 - pixel([40, 40, 40], { highlights: -50 })[0];
  assert.ok(highlightReduction > shadowReduction);
  const grey = pixel([200, 50, 80], { saturation: -100 });
  assert.equal(grey[0], grey[1]);
  assert.equal(grey[1], grey[2]);
});

test('sharpness increases edges, preserves flat areas and alpha', () => {
  const data = new Uint8ClampedArray([80, 80, 80, 30, 160, 160, 160, 60, 80, 80, 80, 90]);
  adjustments.apply(data, 3, 1, 4, { sharpness: 100 });
  assert.ok(data[4] > 160);
  assert.deepEqual([data[3], data[7], data[11]], [30, 60, 90]);
  assert.deepEqual(pixel([90, 90, 90], { sharpness: 100 }), [90, 90, 90]);
});

test('malformed stored settings are normalized into supported ranges', () => {
  const settings = adjustments.normalize({ brightness: 1000, exposure: Infinity, sharpness: -3, saturation: 'bad' });
  assert.equal(settings.brightness, 100);
  assert.equal(settings.exposure, 0);
  assert.equal(settings.sharpness, 0);
  assert.equal(settings.saturation, 0);
  assert.equal(adjustments.normalize(null).brightness, 0);
  assert.deepEqual(adjustments.normalize(JSON.parse(JSON.stringify(settings))), settings);
});

test('browser and desktop apply identical pixel transformations', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('./image-adjustments'), 'utf8'), context);
  const source = Uint8Array.from({ length: 7 * 5 * 4 }, (_, index) => (index * 17) % 256);
  const settings = { brightness: 10, exposure: 0.3, contrast: 20, highlights: -30, shadows: 40, saturation: 15, sharpness: 25 };
  const browser = source.slice();
  const desktop = Buffer.from(source);
  context.ScanboxAdjustments.apply(browser, 7, 5, 4, settings);
  adjustments.apply(desktop, 7, 5, 4, settings);
  assert.deepEqual([...browser], [...desktop]);
});

test('full-resolution export adjusts pixels and preserves selected EXIF and DPI', async () => {
  const source = sharp({ create: { width: 100, height: 80, channels: 3, background: '#646464' } });
  const output = await adjustedExport(source.extract({ left: 10, top: 10, width: 60, height: 40 }), { brightness: 30 });
  const encoded = await output.withMetadata({ density: 1200 })
    .withExif({ IFD0: { DateTime: '1990:06:15 00:00:00' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
    .jpeg({ quality: 96 }).toBuffer();
  const metadata = await sharp(encoded).metadata();
  assert.equal(metadata.width, 60);
  assert.equal(metadata.height, 40);
  assert.equal(metadata.density, 1200);
  assert.ok(metadata.exif.includes(Buffer.from('1990:06:15')));
  const pixels = await sharp(encoded).raw().toBuffer();
  assert.ok(pixels[0] > 100);
  const original = sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } });
  assert.equal(await adjustedExport(original, { enabled: false, exposure: 2 }), original);
});

test('desktop preferences remember adjustments and visibility after a restart', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scanbox-preferences-test-'));
  function session() {
    const handlers = new Map();
    const electron = {
      app: { getPath: () => directory, whenReady: () => new Promise(() => {}), on: () => {} },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) }
    };
    const context = vm.createContext({
      require: (name) => name === 'electron' ? electron : require(name),
      __dirname, process, Buffer, setTimeout
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
      + '\n globalThis.testApi = { loadPreferences, registerIpc };', context);
    return { context, handlers };
  }
  try {
    const event = { senderFrame: { url: `file://${path.join(__dirname, 'index.html').replaceAll('\\', '/')}` } };
    const first = session();
    await first.context.testApi.loadPreferences();
    first.context.testApi.registerIpc();
    const saved = { enabled: false, expanded: true, brightness: 25, exposure: 0.5, contrast: -10, highlights: -40, shadows: 30, saturation: 10, sharpness: 20 };
    await first.handlers.get('adjustments:save')(event, saved);
    await first.handlers.get('photo-details:save')(event, { date: { day: '15', month: '06', year: '1990' } });
    const second = session();
    await second.context.testApi.loadPreferences();
    second.context.testApi.registerIpc();
    const restored = await second.handlers.get('adjustments:last-used')(event);
    assert.deepEqual(JSON.parse(JSON.stringify(restored)), adjustments.normalize(saved));
    const details = await second.handlers.get('photo-details:last-used')(event);
    assert.equal(details.date.year, '1990');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('toolbar restores browser preferences, toggles, resets and saves slider changes', async () => {
  const nodes = new Map();
  function element() {
    const listeners = new Map();
    const classes = new Set();
    const node = {
      listeners, value: '', children: [], attributes: {},
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
      append: (...children) => node.children.push(...children),
      addEventListener: (name, handler) => listeners.set(name, handler),
      setAttribute: (name, value) => { node.attributes[name] = value; }
    };
    Object.defineProperty(node, 'id', { set: (id) => { nodes.set(id, node); }, get: () => '' });
    return node;
  }
  const storage = new Map([['scanbox-image-adjustments', JSON.stringify({ brightness: 30, exposure: 0.5, expanded: true })]]);
  const frames = [];
  const context = vm.createContext({
    window: { ScanboxAdjustments: adjustments },
    document: {
      getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
      querySelector: () => element(), createElement: element
    },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: () => 1, clearTimeout: () => {},
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; }, cancelAnimationFrame: () => {},
    renderPhotoList: () => {}, showToast: (message) => { throw new Error(message); }
  });
  const source = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('\nif (!electronMode) {')), context);
  await vm.runInContext('initializeAdjustments()', context);
  assert.equal(nodes.get('adjustmentsSliders').children.length, 7);
  assert.equal(nodes.get('adjustment-brightness').value, 30);
  assert.equal(nodes.get('adjustmentsBody').classList.contains('hidden'), false);
  nodes.get('adjustment-brightness').value = '45';
  nodes.get('adjustment-brightness').listeners.get('input')();
  await nodes.get('adjustment-brightness').listeners.get('change')();
  assert.equal(JSON.parse(storage.get('scanbox-image-adjustments')).brightness, 45);
  nodes.get('adjustmentsToggle').listeners.get('click')();
  assert.equal(nodes.get('adjustmentsBody').classList.contains('hidden'), true);
  assert.equal(JSON.parse(storage.get('scanbox-image-adjustments')).brightness, 45);
  nodes.get('adjustmentsEnabled').checked = false;
  nodes.get('adjustmentsEnabled').listeners.get('change')();
  assert.equal(nodes.get('adjustment-brightness').disabled, true);
  assert.equal(JSON.parse(storage.get('scanbox-image-adjustments')).brightness, 45);
  nodes.get('adjustmentsReset').listeners.get('click')();
  assert.equal(nodes.get('adjustment-brightness').value, 0);
  assert.equal(nodes.get('adjustmentsEnabled').checked, true);
  assert.equal(nodes.get('adjustmentsBody').classList.contains('hidden'), false);
});
