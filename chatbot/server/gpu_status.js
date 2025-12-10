// chatbot/server/gpu_status.js
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function parseNvidiaSmiOutput(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [name, utilization, memUsed, memTotal] = line
      .split(",")
      .map((part) => part.trim());

    return {
      name: name || "GPU",
      utilizationPercent: utilization ? Number(utilization) : null,
      memoryUsedMb: memUsed ? Number(memUsed) : null,
      memoryTotalMb: memTotal ? Number(memTotal) : null
    };
  });
}

export async function getGpuStatus() {
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits"
    );

    const gpus = parseNvidiaSmiOutput(stdout);

    return {
      available: true,
      gpus
    };
  } catch (err) {
    return {
      available: false,
      error: String(err)
    };
  }
}
