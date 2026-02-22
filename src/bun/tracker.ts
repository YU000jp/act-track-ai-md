import type { WindowSnapshot } from "../shared/types";

const MAX_TITLE_LENGTH = 200;

export type RawWindowData = {
  processPath: string;
  windowTitle: string;
};

export function normalizeSnapshot(
  raw: RawWindowData | null,
  selfProcessName?: string,
): WindowSnapshot | null {
  if (!raw) return null;

  const processPath = raw.processPath.trim();
  const windowTitle = raw.windowTitle.trim();

  if (!processPath && !windowTitle) return null;

  const separator = processPath.includes("\\") ? "\\" : "/";
  const segments = processPath.split(separator);
  const processName = (segments[segments.length - 1] || "").toLowerCase();

  if (!processName) return null;

  if (selfProcessName && processName === selfProcessName.toLowerCase()) {
    return null;
  }

  return {
    processName,
    windowTitle: windowTitle.slice(0, MAX_TITLE_LENGTH),
  };
}

export function isIdle(idleMs: number, timeoutMs: number): boolean {
  return idleMs >= timeoutMs;
}

export type TrackerBindings = {
  getForegroundWindow: () => WindowSnapshot | null;
  getIdleMs: () => number;
};

export function createWindowsFFIBindings(): TrackerBindings {
  try {
    const { dlopen, FFIType, ptr } = require("bun:ffi");

    const user32 = dlopen("user32.dll", {
      GetForegroundWindow: { args: [], returns: FFIType.ptr },
      GetWindowTextW: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      GetWindowThreadProcessId: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.u32,
      },
      GetLastInputInfo: {
        args: [FFIType.ptr],
        returns: FFIType.bool,
      },
    });

    const kernel32 = dlopen("kernel32.dll", {
      OpenProcess: {
        args: [FFIType.u32, FFIType.bool, FFIType.u32],
        returns: FFIType.ptr,
      },
      CloseHandle: {
        args: [FFIType.ptr],
        returns: FFIType.bool,
      },
      GetTickCount: {
        args: [],
        returns: FFIType.u32,
      },
    });

    const psapi = dlopen("psapi.dll", {
      GetModuleFileNameExW: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
        returns: FFIType.u32,
      },
    });

    const PROCESS_QUERY_INFORMATION = 0x0400;
    const PROCESS_VM_READ = 0x0010;

    return {
      getForegroundWindow(): WindowSnapshot | null {
        const hwnd = user32.symbols.GetForegroundWindow();
        if (!hwnd) return null;

        const titleBuf = new Uint16Array(256);
        const titleLen = user32.symbols.GetWindowTextW(hwnd, ptr(titleBuf), 256);
        const windowTitle = String.fromCharCode(...titleBuf.slice(0, titleLen));

        const pidBuf = new Uint32Array(1);
        user32.symbols.GetWindowThreadProcessId(hwnd, ptr(pidBuf));
        const pid = pidBuf[0];
        if (!pid) return normalizeSnapshot({ processPath: "", windowTitle });

        const hProcess = kernel32.symbols.OpenProcess(
          PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
          false,
          pid,
        );
        if (!hProcess) return normalizeSnapshot({ processPath: "", windowTitle });

        const pathBuf = new Uint16Array(260);
        const pathLen = psapi.symbols.GetModuleFileNameExW(hProcess, null, ptr(pathBuf), 260);
        kernel32.symbols.CloseHandle(hProcess);

        const processPath = String.fromCharCode(...pathBuf.slice(0, pathLen));
        return normalizeSnapshot({ processPath, windowTitle });
      },

      getIdleMs(): number {
        const buf = new Uint32Array(2);
        buf[0] = 8;
        const ok = user32.symbols.GetLastInputInfo(ptr(buf));
        if (!ok) return 0;
        const lastInput = buf[1];
        const tickCount = kernel32.symbols.GetTickCount();
        return tickCount - lastInput;
      },
    };
  } catch {
    return {
      getForegroundWindow: () => null,
      getIdleMs: () => 0,
    };
  }
}
