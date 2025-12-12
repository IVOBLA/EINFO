// chatbot/server/gpu_status.js
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const isWindows = process.platform === "win32";

const SMI_QUERY =
  "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits";
const SMI_COMMAND = `nvidia-smi ${SMI_QUERY}`;

function buildUnavailable(error) {
  return {
    available: false,
    error
  };
}

function parseNvidiaSmiOutput(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [name, utilization, memUsed, memTotal, temp] = line
      .split(",")
      .map((part) => part.trim());

    return {
      name: name || "GPU",
      utilizationPercent: utilization ? Number(utilization) : null,
      memoryUsedMb: memUsed ? Number(memUsed) : null,
      memoryTotalMb: memTotal ? Number(memTotal) : null,
      temperatureCelsius: temp ? Number(temp) : null
    };
  });
}

export async function getGpuStatus() {
  try {
    const { stdout } = await execAsync(SMI_COMMAND);

    const gpus = parseNvidiaSmiOutput(stdout);

    if (!gpus.length) {
      return buildUnavailable("nvidia-smi lieferte keine GPU-Daten");
    }

    // Warnungen prüfen
    let warning = null;
    for (const gpu of gpus) {
      if (gpu.memoryUsedMb && gpu.memoryTotalMb) {
        const usagePercent = (gpu.memoryUsedMb / gpu.memoryTotalMb) * 100;
        if (usagePercent > 90) {
          warning = `VRAM-Auslastung kritisch: ${usagePercent.toFixed(0)}%`;
        }
      }
      if (gpu.temperatureCelsius && gpu.temperatureCelsius > 80) {
        warning = `GPU-Temperatur hoch: ${gpu.temperatureCelsius}°C`;
      }
    }

    return {
      available: true,
      gpus,
      warning
    };
  } catch (err) {
    if (err?.code === "ENOENT" || /not found/i.test(err?.message || "")) {
      const hint = isWindows
        ? "nvidia-smi wurde nicht gefunden (Windows: NVIDIA-Treiber/CUDA prüfen)"
        : "nvidia-smi wurde nicht gefunden (NVIDIA-Treiber unter Linux prüfen)";
      return buildUnavailable(hint);
    }

    const detailedError = String(err?.stderr || err?.message || err);
    return buildUnavailable(detailedError);
  }
}
