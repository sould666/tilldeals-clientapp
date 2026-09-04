const byteFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Not reported';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${byteFormatter.format(value / 1024 ** index)} ${units[index]}`;
}

function present(value) {
  return value === undefined || value === null || value === '' ? 'Not reported' : String(value);
}

function list(values, formatter = present) {
  return values?.length ? values.map(formatter).join(', ') : 'Not reported';
}

function addSection(title, entries) {
  const template = document.querySelector('#section-template');
  const section = template.content.cloneNode(true);
  section.querySelector('h2').textContent = title;
  const list = section.querySelector('dl');

  entries.forEach(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = present(value);
    list.append(term, detail);
  });

  document.querySelector('#details').append(section);
}

function render(snapshot) {
  const { os, system, cpu, memory, memoryLayout, graphics, baseboard, bios, disks, filesystems, network, battery, audio } = snapshot;
  document.querySelector('#updated-at').textContent = `Updated ${new Date(snapshot.collectedAt).toLocaleString()} | ${snapshot.source}`;
  document.querySelector('#summary').replaceChildren(
    ...[
      ['Operating system', `${os.distro} ${os.release}`],
      ['Processor', cpu.brand],
      ['Installed memory', formatBytes(memory.total)],
      ['Graphics', list(graphics.controllers, (gpu) => gpu.model)],
    ].map(([label, value]) => {
      const item = document.createElement('div');
      item.innerHTML = `<span>${label}</span><strong>${present(value)}</strong>`;
      return item;
    }),
  );

  document.querySelector('#details').replaceChildren();
  addSection('System', [
    ['Manufacturer', system.manufacturer],
    ['Model', system.model],
    ['Version', system.version],
    ['Platform', os.platform],
    ['Kernel', os.kernel],
    ['Architecture', os.arch],
  ]);
  addSection('Processor', [
    ['Model', cpu.brand],
    ['Physical cores', cpu.physicalCores],
    ['Logical cores', cpu.cores],
    ['Speed', cpu.speed ? `${cpu.speed} GHz` : null],
    ['Socket', cpu.socket],
  ]);
  addSection('Memory', [
    ['Installed', formatBytes(memory.total)],
    ['Available', formatBytes(memory.available)],
    ['Active', formatBytes(memory.active)],
    ['Modules', list(memoryLayout, (module) => `${formatBytes(module.size)} ${module.type || ''} ${module.clockSpeed ? `${module.clockSpeed} MHz` : ''}`.trim())],
  ]);
  addSection('Graphics', [
    ['Controllers', list(graphics.controllers, (gpu) => `${gpu.vendor || 'Unknown'} ${gpu.model || ''}`.trim())],
    ['Displays', list(graphics.displays, (display) => `${display.model || 'Unknown'} ${display.resolutionX || '?'}x${display.resolutionY || '?'}`)],
  ]);
  addSection('Mainboard & BIOS', [
    ['Mainboard', `${baseboard.manufacturer || ''} ${baseboard.model || ''}`.trim()],
    ['BIOS vendor', bios.vendor],
    ['BIOS version', bios.version],
    ['BIOS date', bios.releaseDate],
  ]);
  addSection('Storage', [
    ['Physical disks', list(disks, (disk) => `${disk.name || disk.model || 'Unknown'} (${formatBytes(disk.size)})`)],
    ['Mounted filesystems', list(filesystems, (filesystem) => `${filesystem.fs} (${formatBytes(filesystem.used)} of ${formatBytes(filesystem.size)})`)],
  ]);
  addSection('Network & peripherals', [
    ['Interfaces', list(network, (item) => `${item.iface || item.ifaceName || 'Unknown'}${item.ip4 ? `: ${item.ip4}` : ''}`)],
    ['Battery', battery.hasBattery ? `${battery.percent}%${battery.isCharging ? ', charging' : ''}` : 'No battery reported'],
    ['Audio', list(audio, (device) => device.name || device.manufacturer)],
  ]);
}

async function loadHardware() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#updated-at').textContent = 'Reading hardware details...';

  try {
    render(await window.hardware.read());
  } catch (error) {
    document.querySelector('#updated-at').textContent = `Could not read hardware details: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#refresh').addEventListener('click', loadHardware);
loadHardware();
