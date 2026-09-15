const si = require('systeminformation');

async function run() {
  const [temperature, graphics] = await Promise.all([
    si.cpuTemperature(),
    si.graphics(),
  ]);
  const gpuTemperatures = (graphics.controllers || [])
    .map((controller) => controller.temperatureGpu)
    .filter(Number.isFinite);
  const result = {
    cpu: {
      main: temperature.main,
      cores: temperature.cores,
      available: Number.isFinite(temperature.main) || temperature.cores.length > 0,
    },
    gpu: {
      controllers: graphics.controllers.length,
      temperatures: gpuTemperatures,
      available: gpuTemperatures.length > 0,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  console.log('Sensor APIs completed. Availability depends on the OS, firmware, and drivers.');
}

run().catch((error) => {
  console.error(`Sensor API test failed: ${error.message}`);
  process.exit(1);
});