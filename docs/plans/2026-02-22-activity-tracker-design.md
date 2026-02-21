# Electrobun AI Activity Tracker - Design Document
Date: 2026-02-22

## 1. Overview
A desktop productivity tracker for Windows, built with [Electrobun](https://electrobun.dev/). The app helps the user stay focused by actively monitoring the current foreground window and using AI to determine if the activity is a distraction from their current goal.

## 2. Goals & Constraints
- **Target OS:** Windows
- **Framework:** Electrobun (Bun + Zig + Webview)
- **Primary Mechanism:** AI compares the active window title against a user-defined "Target Focus".
- **Intervention:** A transparent, frameless, always-on-top overlay window that chides the user when they are distracted.

## 3. Architecture
### 3.1. Main Process (Bun)
- **Window Tracking:** Uses Bun's built-in FFI (`bun:ffi`) to call Windows native APIs (`user32.dll` -> `GetForegroundWindow`, `GetWindowTextW`) every 2-3 seconds.
- **AI Integration:** When a new window title is detected, it is sent to an LLM API (e.g., OpenAI, Gemini, or a local provider) along with the "Target Focus". The AI responds with `True` (Distraction) or `False` (Productive).
- **Caching Layer:** Uses Bun's native `bun:sqlite` to cache window titles and their classification. This dramatically reduces API calls and latency. A window title only triggers an AI call if it is missing from the cache for the current target focus.

### 3.2. Renderer Process (BrowserView)
- **Tech Stack:** React (or plain HTML/TS) for the UI.
- **Main View:** A small dashboard/tray app where the user inputs their current focus (e.g., "Designing the new UI") and clicks "Start".
- **Overlay View:** A frameless, transparent `BrowserWindow` that is spawned and set to `alwaysOnTop` when a distraction is detected. It contains a message ("You should be doing X!") and a button to dismiss the overlay ("Back to work").

## 4. Data Flow
1. User enters Focus String -> `MainView` sends IPC to `Main Process`.
2. `Main Process` starts the polling loop.
3. Polling loop fetches the active window title via FFI.
4. Checks `sqlite` Cache.
   - If `Cache Hit`: Use the stored classification.
   - If `Cache Miss`: Call AI API -> Store result in Cache.
5. If classification == `Distraction`:
   - `Main Process` opens/shows the `OverlayView`.
6. User clicks "Back to work" in `OverlayView` -> Sends IPC to `Main Process` -> Hides the overlay.

## 5. UI/UX Design
- **Minimalist Dashboard:** Just the focus input, a timer, and a start/stop button.
- **Strict Overlay:** The overlay should cover enough of the screen to disrupt the distraction but look playful or helpful (e.g., a virtual assistant telling you off).

## 6. Future Considerations
- Analytics and daily statistics (time focused vs. time distracted).
- Allowing the AI to occasionally re-evaluate cached items if context changes.
