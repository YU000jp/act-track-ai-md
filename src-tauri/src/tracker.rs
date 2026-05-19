#![allow(dead_code)]

use crate::types::WindowSnapshot;

const MAX_TITLE_LENGTH: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowTrackingKey {
    pub process_name: String,
    pub window_title: String,
}

impl WindowTrackingKey {
    pub fn from_snapshot(snapshot: &WindowSnapshot) -> Self {
        // Keep the persisted snapshot untouched; this key is only for duplicate detection.
        Self {
            process_name: snapshot.process_name.to_lowercase(),
            window_title: normalize_tracking_title_key(&snapshot.window_title),
        }
    }
}

pub fn normalize_snapshot(
    raw: Option<(String, String)>,
    self_process_name: Option<&str>,
) -> Option<WindowSnapshot> {
    let (process_path, window_title) = raw?;
    let process_path = process_path.trim();
    let window_title = normalize_tracking_title(&window_title);

    if process_path.is_empty() && window_title.is_empty() {
        return None;
    }

    let process_name = derive_process_name(process_path);

    if self_process_name
        .map(|value| value.eq_ignore_ascii_case(&process_name))
        .unwrap_or(false)
    {
        return None;
    }

    let window_title = if window_title.is_empty() {
        // Some foreground windows expose no caption text; keep a stable fallback so
        // the tracker still stores a usable record instead of a blank title.
        process_name.clone()
    } else {
        window_title.to_string()
    };

    Some(WindowSnapshot {
        process_name,
        window_title: window_title.chars().take(MAX_TITLE_LENGTH).collect(),
    })
}

fn normalize_tracking_title(window_title: &str) -> String {
    window_title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_tracking_title_key(window_title: &str) -> String {
    normalize_tracking_title(window_title).to_lowercase()
}

fn derive_process_name(process_path: &str) -> String {
    if process_path.is_empty() {
        return "unknown".to_string();
    }

    let separator = if process_path.contains('\\') {
        '\\'
    } else {
        '/'
    };
    process_path
        .split(separator)
        .last()
        .unwrap_or_default()
        .trim()
        .to_lowercase()
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
        fn GetWindowTextLengthW(h_wnd: HWND) -> i32;
        fn GetWindowTextW(h_wnd: HWND, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn SendMessageTimeoutW(
            h_wnd: HWND,
            msg: u32,
            w_param: usize,
            l_param: isize,
            fu_flags: u32,
            u_timeout: u32,
            lpdw_result: *mut usize,
        ) -> isize;
        fn GetWindowThreadProcessId(h_wnd: HWND, lpdw_process_id: *mut u32) -> u32;
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32)
            -> HANDLE;
        fn CloseHandle(h_object: HANDLE) -> i32;
        fn GetTickCount() -> u32;
    }

    #[link(name = "psapi")]
    extern "system" {
        fn GetModuleFileNameExW(
            h_process: HANDLE,
            h_module: HMODULE,
            lp_filename: *mut u16,
            n_size: u32,
        ) -> u32;
    }

    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const PROCESS_VM_READ: u32 = 0x0010;
    const WM_GETTEXT: u32 = 0x000D;
    const WM_GETTEXT_TIMEOUT_MS: u32 = 200;

    let hwnd = GetForegroundWindow();
    if hwnd == 0 {
        return None;
    }

    let title_len = GetWindowTextLengthW(hwnd).max(0) as usize;
    let mut title_buf = vec![0u16; title_len.saturating_add(1)];
    let copied_len =
        GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32).max(0) as usize;
    let mut window_title = String::from_utf16_lossy(&title_buf[..copied_len]);

    if window_title.trim().is_empty() {
        if let Some(fallback_title) =
            read_window_text_with_timeout(hwnd, WM_GETTEXT, WM_GETTEXT_TIMEOUT_MS)
        {
            window_title = fallback_title;
        }
    }

    if window_title.trim().is_empty() {
        if let Some(fallback_title) = read_window_title_via_uiautomation(hwnd) {
            window_title = fallback_title;
        }
    }

    let mut pid: u32 = 0;
    let _ = GetWindowThreadProcessId(hwnd, &mut pid);
    if window_title.trim().is_empty() {
        log::debug!(
            "foreground window title was empty; hwnd={hwnd}, title_length={title_len}, pid={pid}, raw_title={window_title:?}"
        );
    }
    if pid == 0 {
        return normalize_snapshot(Some((String::new(), window_title)), self_process_name);
    }

    let process_handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
    if process_handle == 0 {
        return normalize_snapshot(Some((String::new(), window_title)), self_process_name);
    }

    let mut path_buf = [0u16; 260];
    let path_len = GetModuleFileNameExW(
        process_handle,
        0,
        path_buf.as_mut_ptr(),
        path_buf.len() as u32,
    );
    let _ = CloseHandle(process_handle);

    let process_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
    normalize_snapshot(Some((process_path, window_title)), self_process_name)
}

#[cfg(windows)]
unsafe fn read_window_text_with_timeout(
    hwnd: isize,
    message: u32,
    timeout_ms: u32,
) -> Option<String> {
    type HWND = isize;

    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(
            h_wnd: HWND,
            msg: u32,
            w_param: usize,
            l_param: isize,
            fu_flags: u32,
            u_timeout: u32,
            lpdw_result: *mut usize,
        ) -> isize;
    }

    const SMTO_BLOCK: u32 = 0x0001;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;

    let mut buffer = vec![0u16; 512];
    let mut result: usize = 0;
    let sent = SendMessageTimeoutW(
        hwnd,
        message,
        buffer.len(),
        buffer.as_mut_ptr() as isize,
        SMTO_BLOCK | SMTO_ABORTIFHUNG,
        timeout_ms,
        &mut result,
    );

    if sent == 0 || result == 0 {
        return None;
    }

    let copied_len = result.min(buffer.len().saturating_sub(1));
    let text = String::from_utf16_lossy(&buffer[..copied_len]);
    let text = text.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(windows)]
unsafe fn read_window_title_via_uiautomation(hwnd: isize) -> Option<String> {
    use windows::core::BSTR;
    use windows::Win32::Foundation::HWND as WinHwnd;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_DISABLE_OLE1DDE, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};

    // UI Automation is a fallback path for windows that do not expose a caption
    // through GetWindowTextW/WM_GETTEXT.
    let needs_uninit = CoInitializeEx(None, COINIT_MULTITHREADED | COINIT_DISABLE_OLE1DDE).is_ok();

    let automation: IUIAutomation =
        match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(automation) => automation,
            Err(error) => {
                log::debug!("uiautomation init failed for hwnd={hwnd}: {error}");
                if needs_uninit {
                    unsafe {
                        CoUninitialize();
                    }
                }
                return None;
            }
        };

    let element = match automation.ElementFromHandle(WinHwnd(hwnd as *mut core::ffi::c_void)) {
        Ok(element) => element,
        Err(error) => {
            log::debug!("uiautomation element lookup failed for hwnd={hwnd}: {error}");
            if needs_uninit {
                unsafe {
                    CoUninitialize();
                }
            }
            return None;
        }
    };

    let title = element
        .CurrentName()
        .ok()
        .map(|value: BSTR| value.to_string())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if needs_uninit {
        unsafe {
            CoUninitialize();
        }
    }

    title
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

#[cfg(test)]
mod tests {
    use super::{normalize_snapshot, WindowTrackingKey};

    #[test]
    fn normalize_snapshot_keeps_title_when_process_path_is_missing() {
        let snapshot =
            normalize_snapshot(Some((String::new(), "Protected Window".to_string())), None)
                .expect("snapshot");

        assert_eq!(snapshot.process_name, "unknown");
        assert_eq!(snapshot.window_title, "Protected Window");
    }

    #[test]
    fn normalize_snapshot_falls_back_to_process_name_when_title_is_missing() {
        let snapshot = normalize_snapshot(
            Some((
                r"C:\\Program Files\\App\\app.exe".to_string(),
                String::new(),
            )),
            None,
        )
        .expect("snapshot");

        assert_eq!(snapshot.process_name, "app.exe");
        assert_eq!(snapshot.window_title, "app.exe");
    }

    #[test]
    fn normalize_snapshot_still_drops_completely_empty_values() {
        assert!(normalize_snapshot(Some((String::new(), String::new())), None).is_none());
    }

    #[test]
    fn tracking_key_collapses_spacing_and_case_for_comparison() {
        let snapshot = normalize_snapshot(
            Some((
                r"C:\\Program Files\\App\\app.exe".to_string(),
                "  GitHub   -  Pull Request  ".to_string(),
            )),
            None,
        )
        .expect("snapshot");

        let key = WindowTrackingKey::from_snapshot(&snapshot);

        assert_eq!(key.process_name, "app.exe");
        assert_eq!(key.window_title, "github - pull request");
    }
}
