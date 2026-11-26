use crate::files::{atomic_write, checked_read, decode, protect, target_dialog, valid_name};
use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rfd::FileDialog;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

const BINARY: &[&str] = &["docx", "xlsx", "pptx", "png", "jpeg", "jpg", "pdf"];
const TEXT: &[&str] = &["csv", "json", "svg", "mmd"];
const MARKDOWN: &[&str] = &["md", "markdown", "mdown"];
const MAX_MARKDOWN: usize = 2_000_000;

fn string(args: &[Value], index: usize) -> Result<&str> {
    args.get(index)
        .and_then(Value::as_str)
        .context("文件操作参数无效。")
}

fn filename(title: &str, ext: &str) -> String {
    let mut base = String::new();
    let mut units = 0;
    for ch in title.chars() {
        units += ch.len_utf16();
        if units > 120 {
            break;
        }
        base.push(if ch.is_control() || r#"<>:"/\|?*"#.contains(ch) {
            '_'
        } else {
            ch
        });
    }
    let base = base.trim().trim_end_matches(['.', ' ']);
    let stem = if base.is_empty() {
        "未命名页面"
    } else {
        base
    };
    let result = format!("{stem}.{ext}");
    if valid_name(&result).is_ok() {
        result
    } else {
        format!("_{result}")
    }
}

fn format(ext: &str) -> Result<bool> {
    ensure!(
        BINARY.contains(&ext) || TEXT.contains(&ext),
        "此文件格式尚不支持导入或导出。"
    );
    Ok(BINARY.contains(&ext))
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn import(exts: &[&str], markdown: bool) -> Result<Value> {
    let Some(path) = FileDialog::new()
        .set_title("导入本地文件")
        .add_filter(exts[0], exts)
        .pick_file()
    else {
        return Ok(Value::Null);
    };
    let ext = extension(&path);
    ensure!(exts.contains(&ext.as_str()), "文件扩展名与所选格式不符。");
    let data = checked_read(&path)?;
    if markdown {
        let source = std::str::from_utf8(&data).context("Markdown 文件需要使用 UTF-8 编码。")?;
        ensure!(
            source.encode_utf16().count() <= MAX_MARKDOWN,
            "文件超过单页大小上限。"
        );
        let title: String = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .chars()
            .scan(0, |n, c| {
                *n += c.len_utf16();
                (*n <= 120).then_some(c)
            })
            .collect();
        Ok(json!({"title": title, "markdown": source.strip_prefix('\u{feff}').unwrap_or(source)}))
    } else {
        let text = if format(&ext)? {
            STANDARD.encode(data)
        } else {
            let text = std::str::from_utf8(&data).context("此格式需要 UTF-8 编码。")?;
            text.strip_prefix('\u{feff}').unwrap_or(text).to_owned()
        };
        Ok(json!({"name": path.file_name().unwrap_or_default().to_string_lossy(), "text": text}))
    }
}

fn save_target(profile: &Path, title: &str, ext: &str) -> Result<Option<PathBuf>> {
    let path = target_dialog(&filename(title, ext), ext)?;
    if let Some(target) = &path {
        protect(profile, target)?;
    }
    Ok(path)
}

#[cfg(windows)]
fn print_pdf(window: &WebviewWindow, target: &Path, size: &Value) -> Result<()> {
    use std::{sync::mpsc, time::Duration};
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};

    let mm = |name: &str| -> Result<f64> {
        let value = size[name].as_f64().context("缺少 PDF 纸张尺寸。")?;
        ensure!((10.0..=1500.0).contains(&value), "PDF 纸张尺寸无效。");
        Ok(value / 25.4)
    };
    let (width, height) = (mm("widthMm")?, mm("heightMm")?);
    // The WebView writes to a fresh file. Publish only a completed document.
    let staging = tempfile::tempdir_in(target.parent().context("保存位置无效。")?)?;
    let temp = staging.path().join("print.pdf");
    let destination = HSTRING::from(temp.as_os_str());
    let (tx, rx) = mpsc::channel::<Result<()>>();
    window.with_webview(move |view| {
        let completed = tx.clone();
        let start = || -> Result<()> {
            // WebView2 COM interfaces stay on the UI thread. Only the completion
            // result crosses back to the blocking IPC worker.
            unsafe {
                let webview: ICoreWebView2_7 = view.controller().CoreWebView2()?.cast()?;
                let environment: ICoreWebView2Environment6 = view.environment().cast()?;
                let settings = environment.CreatePrintSettings()?;
                settings.SetPageWidth(width)?;
                settings.SetPageHeight(height)?;
                settings.SetMarginTop(0.0)?;
                settings.SetMarginBottom(0.0)?;
                settings.SetMarginLeft(0.0)?;
                settings.SetMarginRight(0.0)?;
                settings.SetShouldPrintBackgrounds(true)?;
                settings.SetShouldPrintHeaderAndFooter(false)?;
                let handler =
                    PrintToPdfCompletedHandler::create(Box::new(move |status, success| {
                        let result = status.map_err(anyhow::Error::from).and_then(|_| {
                            ensure!(success, "WebView2 未完成 PDF 输出。");
                            Ok(())
                        });
                        let _ = completed.send(result);
                        Ok(())
                    }));
                webview.PrintToPdf(&destination, &settings, &handler)?;
            }
            Ok(())
        };
        if let Err(error) = start() {
            let _ = tx.send(Err(error));
        }
    })?;
    rx.recv_timeout(Duration::from_secs(120))
        .context("等待 PDF 输出超时。")??;
    std::fs::OpenOptions::new()
        .write(true)
        .open(&temp)?
        .sync_all()?;
    // Same-volume atomic replacement, including existing files on Windows.
    tempfile::TempPath::try_from_path(temp)?.persist(target)?;
    Ok(())
}

#[cfg(not(windows))]
fn print_pdf(_: &WebviewWindow, _: &Path, _: &Value) -> Result<()> {
    bail!("系统打印功能需要 Windows WebView2。")
}

pub fn call(window: &WebviewWindow, op: &str, args: &[Value], profile: &Path) -> Result<Value> {
    match op {
        "markdown:import" => import(MARKDOWN, true),
        "office:import" => {
            let ext = string(args, 0)?;
            format(ext)?;
            import(&[ext], false)
        }
        "markdown:export" => {
            let (title, markdown) = (string(args, 0)?, string(args, 1)?);
            ensure!(
                title.encode_utf16().count() <= 120
                    && markdown.encode_utf16().count() <= MAX_MARKDOWN,
                "页面内容超过导出限制。"
            );
            let Some(path) = save_target(profile, title, "md")? else {
                return Ok(false.into());
            };
            atomic_write(&path, markdown.as_bytes())?;
            Ok(true.into())
        }
        "office:export" | "office:print-pdf" => {
            let name = Path::new(string(args, 0)?);
            let ext = extension(name);
            let binary = format(&ext)?;
            let title = name.file_stem().unwrap_or_default().to_string_lossy();
            let bytes = if op == "office:export" {
                Some(decode(string(args, 1)?, binary)?)
            } else {
                ensure!(ext == "pdf", "请保留 PDF 扩展名。");
                None
            };
            let Some(path) = save_target(profile, &title, &ext)? else {
                return Ok(false.into());
            };
            if let Some(bytes) = bytes {
                atomic_write(&path, &bytes)?;
            } else {
                print_pdf(window, &path, args.get(1).context("缺少纸张参数。")?)?;
            }
            Ok(true.into())
        }
        _ => bail!("未知的文档交换操作。"),
    }
}
