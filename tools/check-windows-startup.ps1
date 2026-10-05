param(
    [string]$Application = "src-tauri/target/debug/voicepaste.exe",
    [string]$Screenshot = "$env:RUNNER_TEMP/voicepaste-startup.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StartupWindow {
    public delegate bool Callback(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    public static IntPtr Find(uint process) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, parameter) => {
            uint owner;
            Rect rect;
            GetWindowThreadProcessId(window, out owner);
            if (owner == process && IsWindowVisible(window) && GetWindowRect(window, out rect)
                && rect.Right - rect.Left >= 400 && rect.Bottom - rect.Top >= 300) {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$app = Start-Process $Application -PassThru
try {
    $window = [IntPtr]::Zero
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ($app.WaitForExit(200)) { throw "Application exited before showing settings: $($app.ExitCode)" }
        $window = [StartupWindow]::Find($app.Id)
        if ($window -ne [IntPtr]::Zero) { break }
    }
    if ($window -eq [IntPtr]::Zero) { throw "No visible settings window; helper and overlay windows do not count" }
    # Allow WebView's first paint after the native window becomes visible.
    if ($app.WaitForExit(3000)) { throw "Application exited during first paint" }
    $rect = [StartupWindow+Rect]::new()
    if (![StartupWindow]::GetWindowRect($window, [ref]$rect)) { throw "Cannot read settings window bounds" }
    $bitmap = [Drawing.Bitmap]::new($rect.Right - $rect.Left, $rect.Bottom - $rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Screenshot, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    Write-Output "Visible settings window captured: $Screenshot"
} finally {
    if (!$app.HasExited) { Stop-Process -Id $app.Id }
}
