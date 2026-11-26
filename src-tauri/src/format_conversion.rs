use anyhow::{ensure, Context, Result};
use std::{
    env, fs,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub struct Format {
    pub modern: &'static str,
    import_filter: &'static str,
    export_filter: &'static str,
}

pub fn format(ext: &str) -> Option<Format> {
    let (modern, import_filter, export_filter) = match ext {
        "doc" => ("docx", "Office Open XML Text", "MS Word 97"),
        "rtf" => ("docx", "Office Open XML Text", "Rich Text Format"),
        "odt" => ("docx", "Office Open XML Text", "writer8"),
        "xls" => ("xlsx", "Calc MS Excel 2007 XML", "MS Excel 97"),
        "ods" => ("xlsx", "Calc MS Excel 2007 XML", "calc8"),
        "ppt" => ("pptx", "Impress MS PowerPoint 2007 XML", "MS PowerPoint 97"),
        "odp" => ("pptx", "Impress MS PowerPoint 2007 XML", "impress8"),
        _ => return None,
    };
    Some(Format {
        modern,
        import_filter,
        export_filter,
    })
}
fn engine() -> Result<PathBuf> {
    if let Some(explicit) = env::var_os("YANYE_LIBREOFFICE") {
        let path = PathBuf::from(explicit);
        ensure!(
            path.is_absolute() && path.is_file(),
            "YANYE_LIBREOFFICE 需要指向 soffice.com 的绝对路径。"
        );
        return Ok(path);
    }
    let bundled = env::current_exe()?
        .parent()
        .context("找不到程序目录。")?
        .to_owned();
    std::iter::once(bundled)
        .chain(
            ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]
                .iter()
                .filter_map(env::var_os)
                .map(PathBuf::from),
        )
        .map(|dir| dir.join("LibreOffice/program/soffice.com"))
        .find(|p| p.is_file())
        .context("此格式需要本地转换引擎。请使用砚页完整离线包，或安装 LibreOffice。")
}
fn valid_header(data: &[u8], ext: &str) -> bool {
    match ext {
        "doc" | "xls" | "ppt" => {
            data.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        }
        "rtf" => data.starts_with(br"{\rtf"),
        _ => data.starts_with(b"PK\x03\x04"),
    }
}
// A Compound File directory entry starts on a 128-byte boundary in a sector.
pub fn has_vba(data: &[u8], ext: &str) -> bool {
    matches!(ext, "doc" | "xls" | "ppt")
        && data.chunks_exact(128).any(|e| {
            let size = u16::from_le_bytes([e[64], e[65]]) as usize;
            matches!(e[66], 1 | 2)
                && matches!(size, 8 | 14 | 26)
                && ["VBA", "Macros", "_VBA_PROJECT"].iter().any(|name| {
                    size == (name.len() + 1) * 2
                        && name
                            .bytes()
                            .zip(e.chunks_exact(2))
                            .all(|(c, pair)| pair == [c, 0])
                })
        })
}

pub fn convert(bytes: &[u8], ext: &str, importing: bool) -> Result<Vec<u8>> {
    let f = format(ext).context("不支持此转换格式。")?;
    let (from, to, filter) = if importing {
        (ext, f.modern, f.import_filter)
    } else {
        (f.modern, ext, f.export_filter)
    };
    ensure!(
        valid_header(bytes, from),
        "文件内容与 .{from} 格式不符，或文件已加密。"
    );
    let exe = engine()?;
    let work = tempfile::tempdir()?;
    let profile = work.path().join("profile");
    fs::create_dir_all(profile.join("user"))?;
    fs::write(
        profile.join("user/registrymodifications.xcu"),
        r#"<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>"#,
    )?;
    let input = work.path().join(format!("document.{from}"));
    fs::write(&input, bytes)?;
    let uri = url::Url::from_directory_path(&profile)
        .map_err(|_| anyhow::anyhow!("本地转换目录无效。"))?;
    let mut cmd = Command::new(exe);
    cmd.arg(format!("-env:UserInstallation={uri}"))
        .args([
            "--headless",
            "--nologo",
            "--nodefault",
            "--norestore",
            "--convert-to",
        ])
        .arg(format!("{to}:{filter}"))
        .arg("--outdir")
        .arg(work.path())
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().context("无法启动本地格式转换引擎。")?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            ensure!(status.success(), "本地转换失败（{status}）。");
            break;
        }
        if start.elapsed() > Duration::from_secs(120) {
            #[cfg(windows)]
            if let Some(system_root) = env::var_os("SystemRoot") {
                use std::os::windows::process::CommandExt;
                // soffice.com owns a child process for this private profile.
                let _ = Command::new(PathBuf::from(system_root).join("System32/taskkill.exe"))
                    .args(["/pid", &child.id().to_string(), "/t", "/f"])
                    .creation_flags(0x08000000)
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("本地转换超时，原文件已保留。");
        }
        thread::sleep(Duration::from_millis(75));
    }
    let converted = crate::files::checked_read(&work.path().join(format!("document.{to}")))
        .context("转换引擎未生成可读文件，请检查是否加密、损坏或超出大小上限。")?;
    ensure!(
        valid_header(&converted, to),
        "转换结果格式无效，原文件已保留。"
    );
    Ok(converted)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_format_signatures_and_compound_macro_directories() {
        assert!(valid_header(br"{\rtf1 plain}", "rtf"));
        assert!(!valid_header(b"PK\x03\x04", "xls"));
        assert!(convert(b"not an Office package", "doc", false).is_err());
        let mut entry = [0; 128];
        entry[..8].copy_from_slice(b"V\0B\0A\0\0\0");
        entry[64] = 8;
        entry[66] = 1;
        assert!(has_vba(&entry, "xls"));
        entry[66] = 0;
        assert!(!has_vba(&entry, "xls"));
    }
}
