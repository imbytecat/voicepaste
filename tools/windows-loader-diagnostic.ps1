param(
    [string]$TargetDirectory = "src-tauri/target/debug"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$target = (Resolve-Path $TargetDirectory).Path
$exe = Get-ChildItem "$target/deps/voicepaste_lib-*.exe" |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (!$exe) { throw "No VoicePaste library test executable found in $target/deps" }

$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$dumpbin = & $vswhere -latest -products '*' -find 'VC/Tools/MSVC/*/bin/Hostx64/x64/dumpbin.exe' |
    Select-Object -First 1
if (!$dumpbin) { throw "dumpbin.exe not found" }

Write-Output "Executable: $($exe.FullName)"
Get-FileHash $exe.FullName -Algorithm SHA256 | Format-List
Write-Output "dumpbin: $dumpbin"
& rustc -vV
& cmake --version

foreach ($build in Get-ChildItem "$target/build/opusic-sys-*" -Directory) {
    foreach ($name in @('output', 'stderr', 'out/build/CMakeCache.txt')) {
        $file = Join-Path $build.FullName $name
        if (Test-Path $file) {
            Write-Output "=== $file ==="
            Get-Content $file
        }
    }
}

$imports = @(& $dumpbin /nologo /imports $exe.FullName)
if ($LASTEXITCODE -ne 0) { throw "dumpbin failed: $LASTEXITCODE" }
$imports | Write-Output

# This probes the same imported names, but inside PowerShell. Actual test-process
# DLL selection is authoritative only in the loader trace below, when available.
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LoaderProbe {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr LoadLibraryExW(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
    public static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetModuleFileNameW(IntPtr module, StringBuilder name, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDllDirectoryW(string path);
    [DllImport("kernel32.dll")]
    public static extern bool FreeLibrary(IntPtr module);
}
'@

if (![LoaderProbe]::SetDllDirectoryW($exe.DirectoryName)) {
    throw "SetDllDirectory failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$module = [IntPtr]::Zero
$dll = $null
$missing = 0
$checked = 0
try {
    foreach ($line in $imports) {
        if ($line -match '^\s+Summary\s*$') { break }
        if ($line -match '^\s+(\S+\.dll)\s*$') {
            if ($module -ne [IntPtr]::Zero) { [void][LoaderProbe]::FreeLibrary($module) }
            $dll = $Matches[1]
            $module = [LoaderProbe]::LoadLibraryExW($dll, [IntPtr]::Zero, 0)
            if ($module -eq [IntPtr]::Zero) {
                Write-Output "LOAD FAILED: $dll Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
                continue
            }
            $path = [Text.StringBuilder]::new(32768)
            [void][LoaderProbe]::GetModuleFileNameW($module, $path, $path.Capacity)
            $version = (Get-Item $path.ToString()).VersionInfo.FileVersion
            Write-Output "PROBE MODULE: $dll -> $path version=$version"
        } elseif ($dll -and $module -ne [IntPtr]::Zero -and $line -match '^\s+[0-9A-Fa-f]+\s+(\S+)\s*$') {
            $symbol = $Matches[1]
            $checked++
            if ([LoaderProbe]::GetProcAddress($module, $symbol) -eq [IntPtr]::Zero) {
                $missing++
                Write-Output "MISSING IMPORT: $dll!$symbol Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
            }
        }
    }
} finally {
    if ($module -ne [IntPtr]::Zero) { [void][LoaderProbe]::FreeLibrary($module) }
    [void][LoaderProbe]::SetDllDirectoryW($null)
}
Write-Output "Named import probe: checked=$checked missing=$missing (not a test-process loader verdict)"

$cdb = "${env:ProgramFiles(x86)}/Windows Kits/10/Debuggers/x64/cdb.exe"
if (Test-Path $cdb) {
    $key = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\$($exe.Name)"
    $keyExisted = Test-Path $key
    $oldFlag = if ($keyExisted) { Get-ItemPropertyValue $key GlobalFlag -ErrorAction SilentlyContinue } else { $null }
    try {
        [void](New-Item $key -Force)
        New-ItemProperty $key GlobalFlag -PropertyType DWord -Value 2 -Force | Out-Null
        Write-Output '=== Actual test executable loader snaps (--list, no tests executed) ==='
        & $cdb -G -c 'g;q' $exe.FullName --list
    } finally {
        if (!$keyExisted) {
            Remove-Item $key
        } elseif ($null -eq $oldFlag) {
            Remove-ItemProperty $key GlobalFlag
        } else {
            Set-ItemProperty $key GlobalFlag $oldFlag
        }
    }
} else {
    Write-Output 'CDB unavailable; direct import probe cannot establish transitive loader failure or test-process DLL selection.'
}

# The original cargo step remains failed; debugger exit status is not a test gate.
exit 0
