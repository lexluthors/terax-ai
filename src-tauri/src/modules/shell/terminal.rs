use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

/// 打开系统终端（在指定目录）
#[tauri::command]
pub fn open_system_terminal(path: String, is_directory: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    let cwd = if is_directory {
        p.to_path_buf()
    } else {
        p.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| p.to_path_buf())
    };

    open_terminal_at(&cwd)
}

/// 在系统终端中执行文件
#[tauri::command]
pub fn execute_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File does not exist".to_string());
    }
    if !p.is_file() {
        return Err("Path is not a file".to_string());
    }

    execute_file_in_terminal(p)
}

/// 复制文件到剪贴板（文件本身，不是路径）
#[tauri::command]
pub fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No files to copy".to_string());
    }

    // 验证所有路径存在
    for path in &paths {
        let p = Path::new(path);
        if !p.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
    }

    copy_files_to_clipboard_impl(&paths)
}

// ──────────────────────────────────────────────────────────────────────────
// Platform-specific implementations
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn open_terminal_at(cwd: &Path) -> Result<(), String> {
    // Try gnome-terminal first, then fallback to other terminals
    let terminals = [
        ("gnome-terminal", vec!["--working-directory=".to_string() + &cwd.display().to_string()]),
        ("konsole", vec!["--workdir".to_string(), cwd.display().to_string()]),
        ("xfce4-terminal", vec!["--working-directory=".to_string() + &cwd.display().to_string()]),
        ("x-terminal-emulator", vec![]),
    ];

    for (term, args) in &terminals {
        let result = if args.is_empty() {
            Command::new(term)
                .current_dir(cwd)
                .spawn()
        } else {
            Command::new(term)
                .args(args)
                .spawn()
        };

        if result.is_ok() {
            return Ok(());
        }
    }

    Err("Failed to open terminal. No supported terminal emulator found.".to_string())
}

#[cfg(target_os = "macos")]
fn open_terminal_at(cwd: &Path) -> Result<(), String> {
    let script = format!(
        r#"tell application "Terminal" to do script "cd '{}'" "#,
        cwd.display()
    );
    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("Failed to open Terminal.app: {}", e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_terminal_at(cwd: &Path) -> Result<(), String> {
    Command::new("cmd.exe")
        .args(["/K", &format!("cd /d \"{}\"", cwd.display())])
        .spawn()
        .map_err(|e| format!("Failed to open cmd: {}", e))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn execute_file_in_terminal(file_path: &Path) -> Result<(), String> {
    let path_str = file_path.to_string_lossy();
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let is_app_image = path_str.ends_with(".AppImage") || path_str.ends_with(".appimage");

    // Supported extensions check
    let supported_exts = ["deb", "apk", "py", "sh"];
    if !is_app_image && !supported_exts.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type: .{}", ext));
    }

    // AppImage: auto chmod +x if needed
    if is_app_image {
        if let Ok(metadata) = fs::metadata(file_path) {
            let perms = metadata.permissions();
            if perms.mode() & 0o111 == 0 {
                let mut new_perms = perms.clone();
                new_perms.set_mode(perms.mode() | 0o755);
                fs::set_permissions(file_path, new_perms)
                    .map_err(|e| format!("chmod failed: {}", e))?;
            }
        }
    }

    // Build inner command
    let inner_command = if is_app_image {
        format!("'{}'", path_str)
    } else {
        match ext.as_str() {
            "deb" => format!("sudo apt install -y '{}'", path_str),
            "apk" => format!("adb install '{}'", path_str),
            "py" => format!("python3 '{}'", path_str),
            "sh" => format!("bash '{}'", path_str),
            _ => format!("'{}'", path_str),
        }
    };

    // Wrap with pause
    let full_command = format!(
        "{} ; echo \"\" ; read -n 1 -s -r -p \"Press any key to close...\"",
        inner_command
    );

    // Try different terminals
    let terminals = [
        ("gnome-terminal", vec!["--".to_string(), "bash".to_string(), "-c".to_string(), full_command.clone()]),
        ("konsole", vec!["--noclose".to_string(), "-e".to_string(), format!("bash -c '{}'", full_command.replace('\'', "'\\''"))]),
        ("xfce4-terminal", vec!["--hold".to_string(), "-e".to_string(), format!("bash -c '{}'", full_command.replace('\'', "'\\''"))]),
    ];

    for (term, args) in &terminals {
        let result = Command::new(term).args(args).spawn();
        if result.is_ok() {
            return Ok(());
        }
    }

    Err("Failed to launch terminal for execution".to_string())
}

#[cfg(target_os = "macos")]
fn execute_file_in_terminal(file_path: &Path) -> Result<(), String> {
    let path_str = file_path.to_string_lossy();
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let is_app_image = path_str.ends_with(".AppImage") || path_str.ends_with(".appimage");

    let supported_exts = ["deb", "apk", "py", "sh"];
    if !is_app_image && !supported_exts.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type: .{}", ext));
    }

    if is_app_image {
        if let Ok(metadata) = fs::metadata(file_path) {
            let perms = metadata.permissions();
            if perms.mode() & 0o111 == 0 {
                let mut new_perms = perms.clone();
                new_perms.set_mode(perms.mode() | 0o755);
                fs::set_permissions(file_path, new_perms)
                    .map_err(|e| format!("chmod failed: {}", e))?;
            }
        }
    }

    let inner_command = if is_app_image {
        format!("'{}'", path_str)
    } else {
        match ext.as_str() {
            "deb" => format!("sudo apt install -y '{}'", path_str),
            "apk" => format!("adb install '{}'", path_str),
            "py" => format!("python3 '{}'", path_str),
            "sh" => format!("bash '{}'", path_str),
            _ => format!("'{}'", path_str),
        }
    };

    let full_command = format!(
        "{} ; echo \"\" ; read -n 1 -s -r -p \"Press any key to close...\"",
        inner_command
    );

    let script = format!(
        r#"tell application "Terminal" to do script "{}""#,
        full_command.replace('"', "\\\"")
    );
    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("Failed to launch: {}", e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn execute_file_in_terminal(file_path: &Path) -> Result<(), String> {
    let path_str = file_path.to_string_lossy();
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let supported_exts = ["py", "sh"];
    if !supported_exts.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type on Windows: .{}", ext));
    }

    let inner_command = match ext.as_str() {
        "py" => format!("python \"{}\"", path_str),
        "sh" => format!("bash \"{}\"", path_str),
        _ => format!("\"{}\"", path_str),
    };

    let full_command = format!("{} & echo. & pause", inner_command);

    Command::new("cmd.exe")
        .args(["/K", &full_command])
        .spawn()
        .map_err(|e| format!("Failed to launch: {}", e))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_files_to_clipboard_impl(paths: &[String]) -> Result<(), String> {
    // Check if we're on Wayland or X11
    let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();

    if is_wayland {
        // Wayland: use wl-copy
        let uri_list: String = paths
            .iter()
            .map(|p| format!("file://{}", p))
            .collect::<Vec<_>>()
            .join("\n");

        Command::new("wl-copy")
            .arg("--type")
            .arg("text/uri-list")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(stdin) = child.stdin.as_mut() {
                    let _ = stdin.write_all(uri_list.as_bytes());
                }
                child.wait()
            })
            .map_err(|e| format!("wl-copy failed: {}", e))?;
    } else {
        // X11: use xclip
        let uri_list: String = paths
            .iter()
            .map(|p| format!("file://{}", p))
            .collect::<Vec<_>>()
            .join("\n");

        Command::new("xclip")
            .args(["-selection", "clipboard", "-t", "text/uri-list"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(stdin) = child.stdin.as_mut() {
                    let _ = stdin.write_all(uri_list.as_bytes());
                }
                child.wait()
            })
            .map_err(|e| format!("xclip failed: {}", e))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_files_to_clipboard_impl(paths: &[String]) -> Result<(), String> {
    // macOS: use osascript with NSPasteboard
    let path_list = paths
        .iter()
        .map(|p| format!("POSIX file \"{}\"", p))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        r#"set the clipboard to {{{}}}"#,
        path_list
    );

    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("osascript failed: {}", e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_files_to_clipboard_impl(paths: &[String]) -> Result<(), String> {
    // Windows: use PowerShell
    let path_list = paths
        .iter()
        .map(|p| format!("'{}'", p.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        "Set-Clipboard -Value (Get-Item -Path {})",
        path_list
    );

    Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &script])
        .spawn()
        .map_err(|e| format!("PowerShell failed: {}", e))?;
    Ok(())
}
