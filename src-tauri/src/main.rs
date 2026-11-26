#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod exchange;
mod files;
mod markdown_assets;
#[cfg(test)]
mod native_tests;
mod workspace;

use anyhow::{bail, ensure, Context, Result};
use files::Library;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, WebviewWindow};
use workspace::Workspace;

struct Desktop {
    profile: PathBuf,
    workspace: Mutex<Option<Workspace>>,
    library: Mutex<Option<Library>>,
    launch_files: Mutex<VecDeque<PathBuf>>,
    loaded: AtomicBool,
}
impl Desktop {
    fn new() -> Result<Self> {
        let profile = if let Some(path) = env::var_os("YANYE_PROFILE") {
            PathBuf::from(path)
        } else {
            PathBuf::from(env::var_os("APPDATA").context("找不到 Windows 应用数据目录。")?)
                .join("YanYe")
        };
        ensure!(profile.is_absolute(), "YANYE_PROFILE 必须为绝对路径。");
        fs::create_dir_all(&profile)?;
        Ok(Self {
            profile: dunce::canonicalize(profile)?,
            workspace: Mutex::new(None),
            library: Mutex::new(None),
            launch_files: Mutex::new(VecDeque::new()),
            loaded: AtomicBool::new(false),
        })
    }
    fn enqueue(&self, files: impl Iterator<Item = PathBuf>, cwd: &Path) {
        if let Ok(mut queue) = self.launch_files.lock() {
            for file in files.take(64) {
                let p = if file.is_absolute() {
                    file
                } else {
                    cwd.join(file)
                };
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(
                    ext.as_str(),
                    "docx" | "xlsx" | "xlsm" | "pptx" | "md" | "txt" | "pdf"
                ) && p.is_file()
                {
                    queue.push_back(p);
                }
            }
        }
    }
    fn dispatch(&self, window: &WebviewWindow, op: &str, args: &[Value]) -> Result<Value> {
        if let Some(method) = op.strip_prefix("library:") {
            let mut guard = self
                .library
                .lock()
                .map_err(|_| anyhow::anyhow!("文件中心状态不可用。"))?;
            if guard.is_none() {
                *guard = Some(Library::open(&self.profile)?);
            }
            let library = guard.as_mut().unwrap();
            if method == "next-launch-file" {
                let p = self
                    .launch_files
                    .lock()
                    .map_err(|_| anyhow::anyhow!("文件队列不可用。"))?
                    .pop_front();
                return match p {
                    Some(p) => library.open_path(&p),
                    None => Ok(Value::Null),
                };
            }
            return library.call(method, args);
        }
        if op.starts_with("office:") || op.starts_with("markdown:") {
            return exchange::call(window, op, args, &self.profile);
        }
        if op == "open-link" {
            let s = args.first().and_then(Value::as_str).context("链接无效。")?;
            ensure!(s.len() <= 8192, "链接过长。");
            let url = url::Url::parse(s)?;
            ensure!(
                matches!(url.scheme(), "http" | "https")
                    && url.has_host()
                    && url.username().is_empty()
                    && url.password().is_none(),
                "仅支持 HTTP 或 HTTPS 链接。"
            );
            open::that(url.as_str())?;
            return Ok(Value::Null);
        }
        if op == "workspace:open-folder" {
            open::that(&self.profile)?;
            return Ok(Value::Null);
        }
        let mut guard = self
            .workspace
            .lock()
            .map_err(|_| anyhow::anyhow!("工作区状态不可用。"))?;
        if op == "workspace:load" {
            if guard.is_none() {
                *guard = Some(Workspace::open(
                    &self.profile,
                    args.first().unwrap_or(&Value::Null),
                )?);
            }
            let snapshot = guard.as_ref().unwrap().load()?;
            self.loaded.store(true, Ordering::Release);
            return Ok(json!({"workspace":snapshot,"directory":self.profile}));
        }
        let db = guard.as_mut().context("请先打开本地工作区。")?;
        match op {
            "workspace:stage" => {
                let revision = db.stage(args.first().context("缺少增量保存内容。")?)?;
                window.emit("yanye-save", json!({"state":"saved","revision":revision}))?;
                Ok(revision.into())
            }
            "workspace:flush" => Ok(db.revision()?.into()),
            "workspace:finish-close" => {
                let dirty = db.dirty()?;
                if !dirty.is_empty() {
                    let labels = dirty.iter().take(4).cloned().collect::<Vec<_>>().join("、");
                    let answer = MessageDialog::new()
                        .set_parent(window)
                        .set_level(MessageLevel::Warning)
                        .set_title("保存办公文件")
                        .set_description(format!(
                            "还有 {} 个文件未写回磁盘。已保存本机草稿：{}。关闭窗口？",
                            dirty.len(),
                            labels
                        ))
                        .set_buttons(MessageButtons::YesNo)
                        .show();
                    if answer != MessageDialogResult::Yes {
                        return Ok(false.into());
                    }
                }
                let bases = db.workbook_bases();
                drop(guard);
                // Wait for any file operation in flight before destroying its originating window.
                let _library = self
                    .library
                    .lock()
                    .map_err(|_| anyhow::anyhow!("文件中心状态不可用。"))?;
                // A crash may leave an unreferenced original. Retry cleanup on a future clean exit.
                let _ = files::prune_workbook_bases(&self.profile, &bases);
                window.destroy()?;
                Ok(true.into())
            }
            _ => bail!("未知桌面命令。"),
        }
    }
}
#[tauri::command]
async fn desktop_call(
    window: WebviewWindow,
    operation: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = window.state::<Desktop>();
        let result = state.dispatch(&window, &operation, &args);
        if let Err(err) = &result {
            if operation == "workspace:stage" {
                let _ = window.emit(
                    "yanye-save",
                    json!({"state":"error","message":format!("{err:#}")}),
                );
            }
        }
        result.map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run() -> Result<()> {
    let desktop = Desktop::new()?;
    let mut context = tauri::generate_context!();
    // Two alternate profiles may be used concurrently for migration checks.
    // Only forward shell-open requests to the owner of the same data directory.
    if env::var_os("YANYE_PROFILE").is_some() {
        use sha2::{Digest, Sha256};
        let path = desktop.profile.to_string_lossy().to_lowercase();
        let key = format!("{:x}", Sha256::digest(path.as_bytes()));
        context
            .config_mut()
            .identifier
            .push_str(&format!(".profile.{}", &key[..24]));
    }
    desktop.enqueue(
        env::args_os().skip(1).map(PathBuf::from),
        &env::current_dir()?,
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let state = app.state::<Desktop>();
            state.enqueue(argv.into_iter().skip(1).map(PathBuf::from), Path::new(&cwd));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("yanye-files", ());
            }
        }))
        .manage(desktop)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Desktop>().loaded.load(Ordering::Acquire)
                    && window.emit("yanye-close-request", ()).is_ok()
                {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![desktop_call])
        .run(context)?;
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        MessageDialog::new()
            .set_level(MessageLevel::Error)
            .set_title("无法启动砚页")
            .set_description(format!("{e:#}"))
            .show();
    }
}
