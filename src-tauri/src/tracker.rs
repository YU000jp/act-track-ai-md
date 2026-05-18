#![allow(dead_code)]

use crate::types::WindowSnapshot;

const MAX_TITLE_LENGTH: usize = 200;

pub fn normalize_snapshot(raw: Option<(String, String)>, self_process_name: Option<&str>) -> Option<WindowSnapshot> {
    let (process_path, window_title) = raw?;
    let process_path = process_path.trim();
    let window_title = window_title.trim();

    if process_path.is_empty() && window_title.is_empty() {
        return None;
    }

    let separator = if process_path.contains('\\') { '\\' } else { '/' };
    let process_name = process_path
        .split(separator)
        .last()
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    if process_name.is_empty() {
        return None;
    }

    if self_process_name
        .map(|value| value.to_lowercase() == process_name)
        .unwrap_or(false)
    {
        return None;
    }

    Some(WindowSnapshot {
        process_name,
        window_title: window_title.chars().take(MAX_TITLE_LENGTH).collect(),
    })
}

pub fn is_idle(idle_ms: u64, timeout_ms: i64) -> bool {
    idle_ms >= timeout_ms.max(0) as u64
}

pub fn get_foreground_window(self_process_name: Option<&str>) -> Option<WindowSnapshot> {
    #[cfg(windows)]
    {
        unsafe { get_foreground_window_windows(self_process_name) }
    }

    #[cfg(not(windows))]
    {
        let _ = self_process_name;
        None
    }
}

pub fn get_idle_ms() -> u64 {
    #[cfg(windows)]
    {
        unsafe { get_idle_ms_windows() }
    }

    #[cfg(not(windows))]
    {
        0
    }
}

#[cfg(windows)]
unsafe fn get_foreground_window_windows(self_process_name: Option<&str>) -> Option<WindowSnapshot> {
    type HWND = isize;
    type HANDLE = isize;
    type HMODULE = isize;

    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> HWND;
        fn GetWindowTextW(h_wnd: HWND, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowThreadProcessId(h_wnd: HWND, lpdw_process_id: *mut u32) -> u32;
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> HANDLE;
        fn CloseHandle(h_object: HANDLE) -> i32;
        fn GetTickCount() -> u32;
    }

    #[link(name = "psapi")]
    extern "system" {
        fn GetModuleFileNameExW(h_process: HANDLE, h_module: HMODULE, lp_filename: *mut u16, n_size: u32) -> u32;
    }

    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const PROCESS_VM_READ: u32 = 0x0010;

    let hwnd = GetForegroundWindow();
    if hwnd == 0 {
        return None;
    }

    let mut title_buf = [0u16; 256];
    let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
    let window_title = String::from_utf16_lossy(&title_buf[..title_len.max(0) as usize]);

    let mut pid: u32 = 0;
    let _ = GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        return normalize_snapshot(Some((String::new(), window_title)), self_process_name);
    }

    let process_handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
    if process_handle == 0 {
        return normalize_snapshot(Some((String::new(), window_title)), self_process_name);
    }

    let mut path_buf = [0u16; 260];
    let path_len = GetModuleFileNameExW(process_handle, 0, path_buf.as_mut_ptr(), path_buf.len() as u32);
    let _ = CloseHandle(process_handle);

    let process_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
    normalize_snapshot(Some((process_path, window_title)), self_process_name)
}

#[cfg(windows)]
unsafe fn get_idle_ms_windows() -> u64 {
    use std::mem::size_of;

    #[allow(dead_code)]
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[allow(dead_code)]
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[allow(dead_code)]
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }

    let mut info = LastInputInfo {
        cb_size: size_of::<LastInputInfo>() as u32,
        dw_time: 0,
    };
    if GetLastInputInfo(&mut info) == 0 {
        return 0;
    }

    let tick_count = GetTickCount();
    tick_count.wrapping_sub(info.dw_time) as u64
}
