const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const candidates = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NAPS2', 'NAPS2.Console.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NAPS2', 'NAPS2.Console.exe')
];

function resolveCli() {
  if (process.env.SCANBOX_NAPS2_PATH && fs.existsSync(process.env.SCANBOX_NAPS2_PATH)) return process.env.SCANBOX_NAPS2_PATH;
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function runCli(args, timeoutMs = 45000) {
  const cli = resolveCli();
  if (!cli) {
    throw new Error('NAPS2 was not found. Install NAPS2, then restart Scanbox. See Scanner setup for the download.');
  }
  return new Promise((resolve, reject) => {
    const processHandle = spawn(cli, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      processHandle.kill();
      reject(new Error('The scanner did not respond in time. Check the scanner connection and try again.'));
    }, timeoutMs);
    processHandle.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    processHandle.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    processHandle.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start the scanner tool: ${error.message}`));
    });
    processHandle.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `NAPS2 exited with code ${code}`).trim()));
    });
  });
}

async function listDevices() {
  if (!resolveCli()) return { installed: false, devices: [] };
  const drivers = ['wia', 'twain'];
  const results = await Promise.all(drivers.map(async (driver) => {
    try {
      const { stdout } = await runCli(['--listdevices', '--driver', driver], 30000);
      const devices = stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
      return devices.map((name) => ({ name, driver }));
    } catch (_error) {
      return [];
    }
  }));
  const unique = new Map();
  for (const device of results.flat()) unique.set(`${device.driver}:${device.name.toLowerCase()}`, device);
  return { installed: true, devices: [...unique.values()] };
}

async function scanA4({ outputPath, driver, device, dpi }) {
  if (!['wia', 'twain'].includes(driver)) throw new Error('Choose WIA or TWAIN for the scanner driver.');
  const resolution = Number(dpi);
  if (![150, 300, 600, 1200].includes(resolution)) throw new Error('Choose a supported scan resolution.');
  if (typeof device !== 'string' || !device.trim()) throw new Error('Choose a scanner first.');
  const args = [
    '-o', outputPath,
    '--noprofile', '--driver', driver,
    '--device', device,
    '--source', 'glass',
    '--pagesize', 'a4',
    '--dpi', String(resolution),
    '--bitdepth', 'color',
    '--tiffcomp', 'lzw',
    '-f'
  ];
  await runCli(args, 180000);
  return { deviceName: device };
}

module.exports = { listDevices, scanA4 };
