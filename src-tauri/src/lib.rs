use serde::Serialize;
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AppMetadata {
    pub name: &'static str,
    pub product_name: &'static str,
    pub tagline: &'static str,
    pub version: &'static str,
    pub identifier: &'static str,
    pub developer: &'static str,
    pub creator: &'static str,
    pub publisher: &'static str,
    pub author: &'static str,
    pub copyright: &'static str,
    pub repository_url: &'static str,
}

pub struct BackendState {
    pub child: Mutex<Option<Child>>,
    pub url: String,
}

#[tauri::command]
fn get_backend_url(state: tauri::State<'_, BackendState>) -> String {
    state.url.clone()
}

#[tauri::command]
fn get_app_metadata() -> AppMetadata {
    AppMetadata {
        name: "OriginClean",
        product_name: "OriginClean",
        tagline: "Clean Your Files. Preserve Their Origin.",
        version: env!("CARGO_PKG_VERSION"),
        identifier: "com.muhammadlutfimuzaki.originclean",
        developer: "Muhammad Lutfi Muzaki",
        creator: "Muhammad Lutfi Muzaki",
        publisher: "Muhammad Lutfi Muzaki",
        author: "Muhammad Lutfi Muzaki",
        copyright: "Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.",
        repository_url: "https://github.com/MuhammadLutfiMuzakiiVY/OriginClean",
    }
}

#[tauri::command]
fn list_directory_files(dir_path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&dir_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }
    let mut files = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(s) = p.to_str() {
                files.push(s.to_string());
            }
        }
        if files.len() >= 200 {
            break;
        }
    }
    files.sort();
    Ok(files)
}

fn find_server_script() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("backend/service/app_server.py"),
        PathBuf::from("../backend/service/app_server.py"),
    ];
    for c in candidates {
        if c.is_file() {
            return fs::canonicalize(c).ok();
        }
    }
    None
}

fn spawn_python_backend(port: u16) -> Option<Child> {
    let addr = format!("127.0.0.1:{}", port);
    if TcpStream::connect_timeout(&addr.parse().ok()?, Duration::from_millis(200)).is_ok() {
        return None;
    }
    let script = find_server_script()?;
    let python_bins = if cfg!(target_os = "windows") {
        vec!["python", "python3", "py"]
    } else {
        vec!["python3", "python"]
    };
    for bin in python_bins {
        if let Ok(child) = Command::new(bin)
            .arg(&script)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
        {
            return Some(child);
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port: u16 = std::env::var("ORIGINCLEAN_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8765);
    let backend_url = format!("http://127.0.0.1:{}", port);
    let child_proc = spawn_python_backend(port);

    tauri::Builder::default()
        .manage(BackendState {
            child: Mutex::new(child_proc),
            url: backend_url,
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_app_metadata,
            list_directory_files
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<BackendState>();
                if let Ok(mut guard) = state.child.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OriginClean desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_official_metadata() {
        let meta = get_app_metadata();
        assert_eq!(meta.name, "OriginClean");
        assert_eq!(meta.developer, "Muhammad Lutfi Muzaki");
        assert_eq!(meta.publisher, "Muhammad Lutfi Muzaki");
        assert_eq!(meta.identifier, "com.muhammadlutfimuzaki.originclean");
    }

    #[test]
    fn test_list_directory_files_invalid() {
        let res = list_directory_files("/nonexistent_originclean_dir_12345".to_string());
        assert!(res.is_err());
    }
}

