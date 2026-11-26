use crate::files::{checked_read, valid_name, within};
use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

/// Resolve Markdown references relative to the registered source, including
/// parent segments within the folder explicitly opened in the file center.
pub fn resolve(source: &Path, root: Option<&Path>, reference: &str) -> Result<PathBuf> {
    ensure!(
        source
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md")),
        "该资源需要绑定的 Markdown 原件。"
    );
    let directory = dunce::canonicalize(source.parent().context("文档目录无效。")?)?;
    let boundary = root.filter(|r| within(r, &directory)).unwrap_or(&directory);
    let reference = reference.split(['#', '?']).next().unwrap_or_default();
    ensure!(
        !reference.is_empty() && reference.len() <= 8192,
        "相对路径无效。"
    );
    let decoded = percent_decode_str(reference)
        .decode_utf8()
        .context("路径编码无效。")?;
    let mut candidate = directory.clone();
    for part in Path::new(decoded.as_ref()).components() {
        match part {
            Component::Normal(name) => {
                candidate.push(valid_name(name.to_str().context("路径无效。")?)?);
            }
            Component::CurDir => (),
            Component::ParentDir => {
                ensure!(
                    candidate != boundary && candidate.pop(),
                    "链接超出当前文档目录。"
                );
            }
            _ => bail!("请使用相对于文档的本地路径。"),
        }
    }
    let target = dunce::canonicalize(&candidate).context("找不到引用文件。")?;
    ensure!(
        within(boundary, &target) && target.is_file(),
        "引用超出已打开的目录或文件不存在。"
    );
    Ok(target)
}

pub fn image(path: &Path) -> Result<Value> {
    let data = checked_read(path)?;
    let mime = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if data.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        "image/gif"
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if data.starts_with(b"BM") {
        "image/bmp"
    } else if data.starts_with(&[0, 0, 1, 0]) {
        "image/x-icon"
    } else {
        bail!("请选择 PNG、JPEG、GIF、WebP、BMP 或 ICO 图片。");
    };
    Ok(json!({"mime": mime, "data": STANDARD.encode(data)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoded_image_names_and_parent_links_respect_the_opened_directory() -> Result<()> {
        let files = tempfile::tempdir()?;
        let root = dunce::canonicalize(files.path())?;
        std::fs::create_dir(root.join("notes"))?;
        let document = root.join("notes").join("start.md");
        let picture = root.join("sample #1.png");
        std::fs::write(&picture, b"\x89PNG\r\n\x1a\n")?;
        assert_eq!(
            resolve(&document, Some(&root), "../sample%20%231.png")?,
            picture
        );
        assert_eq!(image(&picture)?["mime"], "image/png");
        assert!(resolve(&document, None, "../sample%20%231.png").is_err());
        assert!(resolve(&document, Some(&root), "%2F%2Fexample.invalid%2Fs.png").is_err());
        Ok(())
    }
}
