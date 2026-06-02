let verbose =
  process.env.ARCH_LOG_VERBOSE === "1" ||
  process.env.ARCH_DEBUG === "1" ||
  process.argv.includes("--verbose") ||
  process.argv.includes("-v");

export function setArchLogVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function isArchLogVerbose(): boolean {
  return verbose;
}

type Meta = Record<string, unknown>;

function emit(level: string, message: string, meta?: Meta): void {
  const line = `[arch-engine][${level}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    console.error(line, meta);
  } else {
    console.error(line);
  }
}

export const archLog = {
  info(message: string, meta?: Meta): void {
    emit("INFO", message, meta);
  },
  warn(message: string, meta?: Meta): void {
    emit("WARN", message, meta);
  },
  debug(message: string, meta?: Meta): void {
    if (verbose) emit("DEBUG", message, meta);
  },
};

export async function readHttpErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "(empty response body)";
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return "(failed to read response body)";
  }
}
