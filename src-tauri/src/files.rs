use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, SecondsFormat, Utc};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

const LIMIT: usize = 32 * 1024 * 1024;
pub(crate) const OFFICE: &[&str] = &[
    "docx", "doc", "odt", "rtf", "xlsx", "xlsm", "xls", "ods", "pptx", "ppt", "odp", "md", "txt",
    "pdf",
];
fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}
fn name(path: &Path) -> Result<&str> {
    path.file_name()
        .and_then(|s| s.to_str())
        .context("文件名无法读取。")
}
fn parent(path: &Path) -> Result<&Path> {
    path.parent().context("无效文件位置。")
}
fn checked_ext(ext: &str) -> Result<()> {
    ensure!(OFFICE.contains(&ext) || ext == "csv", "不支持此文件格式。");
    Ok(())
}
fn digest(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}
fn timestamp(path: &Path) -> Result<String> {
    Ok(DateTime::<Utc>::from(fs::metadata(path)?.modified()?)
        .to_rfc3339_opts(SecondsFormat::Millis, true))
}
pub(crate) fn valid_name(s: &str) -> Result<&str> {
    let stem = s.split('.').next().unwrap_or("").trim_end().to_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
        .is_some_and(|n| {
            matches!(
                n,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        });
    ensure!(
        !s.trim().is_empty()
            && s.encode_utf16().count() <= 255
            && !s.ends_with(['.', ' '])
            && !reserved
            && !s.chars().any(|c| c < ' ' || "<>:\"/\\|?*".contains(c)),
        "请输入有效的 Windows 文件名。"
    );
    Ok(s)
}
fn folded(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}
pub(crate) fn within(base: &Path, path: &Path) -> bool {
    folded(path).starts_with(folded(base))
}
pub fn protect(profile: &Path, path: &Path) -> Result<()> {
    ensure!(
        !within(profile, path) && !within(path, profile),
        "不能修改砚页数据目录或它的上级目录。"
    );
    Ok(())
}
fn check_existing(path: &Path) -> Result<()> {
    ensure!(path.is_absolute(), "无效的文件路径。");
    // Check every component, as a junction in a parent directory can change its target.
    for component in path.ancestors() {
        let info = fs::symlink_metadata(component)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            ensure!(
                info.file_attributes() & 0x400 == 0,
                "不能通过符号链接或目录联接操作文件。"
            );
        }
        ensure!(!info.file_type().is_symlink(), "不能通过符号链接操作文件。");
    }
    Ok(())
}
pub fn checked_read(path: &Path) -> Result<Vec<u8>> {
    check_existing(path)?;
    let file = File::open(path)?;
    let meta = file.metadata()?;
    ensure!(
        meta.is_file() && meta.len() <= LIMIT as u64,
        "请选择 32 MiB 以内的普通文件。"
    );
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= LIMIT, "文件超过 32 MiB。");
    Ok(bytes)
}
fn staged(path: &Path, bytes: &[u8]) -> Result<NamedTempFile> {
    let parent = parent(path)?;
    check_existing(parent)?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    Ok(tmp)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    staged(path, bytes)?.persist(path)?;
    Ok(())
}
pub fn workbook_base_name(id: &str, revision: &str) -> Option<String> {
    let id = Uuid::parse_str(id).ok()?;
    (revision.len() == 64
        && revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
    .then(|| format!("{id}-{revision}.base"))
}
pub fn prune_workbook_bases(
    profile: &Path,
    keep: &std::collections::HashSet<String>,
) -> Result<()> {
    let dir = profile.join("workbook-sources");
    if !dir.try_exists()? {
        return Ok(());
    }
    check_existing(&dir)?;
    for file in fs::read_dir(dir)? {
        let file = file?;
        let filename = file.file_name();
        let Some(name) = filename.to_str() else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".base") else {
            continue;
        };
        let Some((id, hash)) = stem.rsplit_once('-') else {
            continue;
        };
        if workbook_base_name(id, hash).as_deref() == Some(name)
            && !keep.contains(name)
            && file.file_type()?.is_file()
        {
            fs::remove_file(file.path())?;
        }
    }
    Ok(())
}
fn exclusive(path: &Path, bytes: &[u8]) -> Result<()> {
    staged(path, bytes)?
        .persist_noclobber(path)
        .context("目标已存在或无法写入。请选择新的文件名。")?;
    Ok(())
}
fn str_arg(args: &[Value], i: usize) -> Result<&str> {
    args.get(i)
        .and_then(Value::as_str)
        .context("文件操作参数无效。")
}
pub(crate) fn target_dialog(display: &str, ext: &str) -> Result<Option<PathBuf>> {
    let Some(selected) = FileDialog::new()
        .set_title("保存办公文件")
        .add_filter(ext, &[ext])
        .set_file_name(display)
        .save_file()
    else {
        return Ok(None);
    };
    valid_name(name(&selected)?)?;
    let target = dunce::canonicalize(parent(&selected)?)?.join(name(&selected)?);
    ensure!(extension(&target) == ext, "请保留 .{ext} 扩展名。");
    Ok(Some(target))
}
pub(crate) fn decode(s: &str, binary: bool) -> Result<Vec<u8>> {
    ensure!(s.len() <= LIMIT.div_ceil(3) * 4, "文件超过 32 MiB。");
    let bytes = if binary {
        STANDARD.decode(s).context("办公文件编码无效。")?
    } else {
        s.as_bytes().to_vec()
    };
    ensure!(bytes.len() <= LIMIT, "文件超过 32 MiB。");
    Ok(bytes)
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    path: PathBuf,
    modified_at: String,
}
impl Entry {
    fn describe(&self) -> Result<Value> {
        Ok(
            json!({"id":self.id,"path":self.path,"modifiedAt":self.modified_at,"name":name(&self.path)?,"extension":extension(&self.path)}),
        )
    }
}
#[derive(Serialize, Deserialize)]
struct Index {
    version: u32,
    root: Option<PathBuf>,
    files: Vec<Entry>,
}
pub struct Library {
    profile: PathBuf,
    index: Index,
}
impl Library {
    pub fn open(profile: &Path) -> Result<Self> {
        let index: Index = match fs::read(profile.join("file-library.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).context("文件中心索引无法读取。")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Index {
                version: 1,
                root: None,
                files: vec![],
            },
            Err(e) => return Err(e.into()),
        };
        ensure!(
            index.version == 1
                && index.root.as_ref().is_none_or(|p| p.is_absolute())
                && index
                    .files
                    .iter()
                    .all(|f| Uuid::parse_str(&f.id).is_ok() && f.path.is_absolute()),
            "文件中心索引无效。"
        );
        Ok(Self {
            profile: profile.to_owned(),
            index,
        })
    }
    fn persist(&self) -> Result<()> {
        atomic_write(
            &self.profile.join("file-library.json"),
            &serde_json::to_vec(&self.index)?,
        )
    }
    fn root(&self) -> Result<&Path> {
        self.index.root.as_deref().context("请先选择本地文件夹。")
    }
    fn in_root(&self, relative: &str, dir: bool) -> Result<PathBuf> {
        let root = self.root()?;
        let mut p = root.to_owned();
        if !relative.is_empty() {
            for part in relative.split('/') {
                p.push(valid_name(part)?);
            }
        } else {
            ensure!(dir, "文件路径无效。");
        }
        check_existing(&p)?;
        ensure!(
            !within(&self.profile, &p) && (!dir || p.is_dir()),
            "不能操作此目录。"
        );
        Ok(p)
    }
    fn row(&self, path: &Path) -> Result<Value> {
        Ok(
            json!({"name":name(path)?,"path":path.strip_prefix(self.root()?)?.to_string_lossy().replace('\\',"/")}),
        )
    }
    fn known(&self, id: &str) -> Result<&Entry> {
        self.index
            .files
            .iter()
            .find(|e| e.id == id)
            .context("文件已移除，请重新打开或另存为。")
    }
    fn binding(&self, path: &Path) -> Option<&Entry> {
        self.index
            .files
            .iter()
            .find(|e| folded(&e.path) == folded(path))
    }
    fn remember(&mut self, path: &Path, revision: String, new_id: Option<String>) -> Result<Value> {
        let id = self
            .binding(path)
            .map(|e| e.id.clone())
            .or(new_id)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let entry = Entry {
            id: id.clone(),
            path: path.to_owned(),
            modified_at: timestamp(path)?,
        };
        let mut result = entry.describe()?;
        result["revision"] = revision.into();
        self.index.files.retain(|e| e.id != id);
        self.index.files.insert(0, entry);
        self.persist()?;
        Ok(result)
    }
    pub fn open_path(&mut self, path: &Path) -> Result<Value> {
        protect(&self.profile, path)?;
        let ext = extension(path);
        checked_ext(&ext)?;
        let data = checked_read(path)?;
        let utf8 = ext == "txt"
            && std::str::from_utf8(&data).is_ok()
            && (!data.iter().take(1024).any(|b| *b == 0) || data.starts_with(&[239, 187, 191]));
        let content = match ext.as_str() {
            "pdf" => Value::Null,
            e if crate::format_conversion::format(e).is_some() => Value::Null,
            "docx" | "xlsx" | "xlsm" | "pptx" => STANDARD.encode(&data).into(),
            "txt" if !utf8 => STANDARD.encode(&data).into(),
            _ => std::str::from_utf8(&data)
                .context("无法解码 UTF-8 文本。")?
                .into(),
        };
        let mut result = self.remember(path, digest(&data), None)?;
        result["content"] = content;
        if utf8 {
            result["textEncoding"] = "utf-8".into();
        }
        Ok(result)
    }
    fn original(&self, id: &str, revision: &str, pdf: bool) -> Result<Vec<u8>> {
        let p = &self.known(id)?.path;
        protect(&self.profile, p)?;
        let ext = extension(p);
        ensure!(
            if pdf {
                ext == "pdf"
            } else {
                matches!(ext.as_str(), "docx" | "xlsx" | "xlsm" | "pptx")
            },
            "原件格式无效。"
        );
        let bytes = checked_read(p)?;
        ensure!(digest(&bytes) == revision, "磁盘原件已经变化，请重新打开。");
        Ok(bytes)
    }
    fn save(&mut self, v: &Value) -> Result<Value> {
        let name = valid_name(v["name"].as_str().context("请输入文件名。")?)?;
        let ext = v["extension"].as_str().context("请选择格式。")?;
        checked_ext(ext)?;
        ensure!(
            ext != "pdf" && extension(Path::new(name)) == ext,
            "文件名与保存格式不一致，PDF 请另存副本。"
        );
        let bytes = decode(
            v["content"].as_str().context("文件内容无效。")?,
            crate::format_conversion::format(ext).is_some()
                || matches!(ext, "docx" | "xlsx" | "xlsm" | "pptx" | "txt"),
        )?;
        let id = v["id"].as_str();
        let bound = v["directory"].is_null() && v["asNew"] != true && id.is_some();
        let p = if let Some(dir) = v["directory"].as_str() {
            self.in_root(dir, true)?.join(name)
        } else if bound {
            self.known(id.unwrap())?.path.clone()
        } else if let Some(p) = target_dialog(name, ext)? {
            p
        } else {
            return Ok(Value::Null);
        };
        protect(&self.profile, &p)?;
        ensure!(extension(&p) == ext, "文件扩展名与保存格式不一致。");
        if v["preserveSource"] == true {
            if let Some(id) = id {
                ensure!(
                    folded(&p) != folded(&self.known(id)?.path),
                    "转换编码请另选文件名，保留原件。"
                );
            }
        }
        let exists = p.try_exists()?;
        ensure!(!bound || exists, "磁盘文件已移动或删除，请另存为。");
        ensure!(
            !exists || v["directory"].is_null(),
            "已有同名文件或文件夹。"
        );
        let previous = self.binding(&p).map(|e| e.id.clone());
        let handle = previous
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let original = if exists {
            let old = checked_read(&p)?;
            ensure!(
                !crate::format_conversion::has_vba(&old, ext),
                "此旧版文件含 VBA 项目，请另存为新文件以保留原件。"
            );
            let hash = digest(&old);
            if bound || (v["asNew"] == true && id.is_some() && previous.as_deref() == id) {
                ensure!(
                    v["revision"] == hash,
                    "文件已被其他程序修改，请重新打开或另存为。"
                );
            }
            Some((old, hash))
        } else {
            None
        };
        let bytes = if crate::format_conversion::format(ext).is_some() {
            crate::format_conversion::convert(&bytes, ext, false)?
        } else {
            bytes
        };
        let mut backup = None;
        if let Some((old, hash)) = original {
            if old != bytes {
                ensure!(
                    digest(&checked_read(&p)?) == hash,
                    "文件已被其他程序修改，请重新打开或另存为。"
                );
                let dir = self.profile.join("file-backups");
                fs::create_dir_all(&dir)?;
                let path = dir.join(format!("{handle}.bak"));
                atomic_write(&path, &old)?;
                backup = Some(path);
                let tmp = staged(&p, &bytes)?;
                ensure!(
                    digest(&checked_read(&p)?) == hash,
                    "文件已被其他程序修改，请重新打开或另存为。"
                );
                tmp.persist(&p)?;
            }
        } else {
            exclusive(&p, &bytes)?;
        }
        let mut out = self.remember(&p, digest(&bytes), Some(handle))?;
        if let Some(path) = backup {
            out["backupPath"] = json!(path);
        }
        Ok(out)
    }
    fn copy_original(&mut self, args: &[Value], pdf: bool) -> Result<Value> {
        let id = str_arg(args, 0)?;
        let p = self.known(id)?.path.clone();
        let ext = extension(&p);
        let label = if pdf {
            match args.get(3).and_then(Value::as_str) {
                Some("extract") => "选页",
                Some("append") => "合并",
                _ => "副本",
            }
        } else {
            "替换副本"
        };
        let stem = p
            .file_stem()
            .and_then(|s| s.to_str())
            .context("无效文件名。")?;
        let Some(target) = target_dialog(&format!("{stem}-{label}.{ext}"), &ext)? else {
            return Ok(Value::Null);
        };
        protect(&self.profile, &target)?;
        let original = self.original(id, str_arg(args, 1)?, pdf)?;
        let data = if let Some(edited) = args.get(2).filter(|v| !v.is_null()) {
            let bytes = decode(edited["__bytes"].as_str().context("副本编码无效。")?, true)?;
            ensure!(
                if pdf {
                    bytes.starts_with(b"%PDF-")
                } else {
                    bytes.starts_with(b"PK")
                },
                "副本内容无效。"
            );
            bytes
        } else {
            ensure!(pdf, "缺少 Office 副本。");
            original
        };
        exclusive(&target, &data)?;
        self.remember(&target, digest(&data), None)
    }
    fn relocate(&mut self, source: &Path, target: &Path) -> Result<Value> {
        protect(&self.profile, source)?;
        protect(&self.profile, target)?;
        if source.as_os_str() == target.as_os_str() {
            return self.row(source);
        }
        if folded(source) != folded(target) {
            ensure!(
                !within(source, target) && !target.try_exists()?,
                "目标位于源目录中或已存在。"
            );
        }
        ensure!(
            !source.is_file()
                || self.binding(source).is_none()
                || extension(source) == extension(target),
            "已绑定的文件应保留原扩展名。"
        );
        // MoveFileW publishes exclusively even if a second application creates
        // the target after the existence check.
        #[cfg(windows)]
        unsafe {
            use windows::core::HSTRING;
            use windows_sys::Win32::Storage::FileSystem::MoveFileW;
            let from = HSTRING::from(source.as_os_str());
            let to = HSTRING::from(target.as_os_str());
            if MoveFileW(from.as_ptr(), to.as_ptr()) == 0 {
                return Err(std::io::Error::last_os_error().into());
            }
        }
        #[cfg(not(windows))]
        fs::rename(source, target)?;
        for e in &mut self.index.files {
            if within(source, &e.path) {
                let suffix = e
                    .path
                    .components()
                    .skip(source.components().count())
                    .collect::<PathBuf>();
                e.path = if suffix.as_os_str().is_empty() {
                    target.to_owned()
                } else {
                    target.join(suffix)
                };
            }
        }
        self.persist()?;
        self.row(target)
    }
    pub fn call(&mut self, op: &str, args: &[Value]) -> Result<Value> {
        if matches!(op, "markdownResource" | "markdownLink") {
            let source = &self.known(str_arg(args, 0)?)?.path;
            let path = crate::markdown_assets::resolve(
                source,
                self.index.root.as_deref(),
                str_arg(args, 1)?,
            )?;
            protect(&self.profile, &path)?;
            if op == "markdownResource" {
                return crate::markdown_assets::image(&path);
            }
            ensure!(
                OFFICE.contains(&extension(&path).as_str()),
                "该链接的文件类型没有对应的本地编辑器。"
            );
            return self.open_path(&path);
        }
        match op {
            "state" => Ok(json!({"root":self.index.root})),
            "chooseRoot" => {
                let mut dialog = FileDialog::new().set_title("选择文件中心的本地文件夹");
                if let Some(p) = &self.index.root {
                    dialog = dialog.set_directory(p);
                }
                let Some(p) = dialog.pick_folder() else {
                    return Ok(Value::Null);
                };
                let root = dunce::canonicalize(p)?;
                ensure!(
                    root.is_dir() && !within(&self.profile, &root),
                    "请选择保存办公文件的文件夹。"
                );
                self.index.root = Some(root);
                self.persist()?;
                Ok(json!({"root":self.index.root}))
            }
            "list" => {
                let dir = self.in_root(args.first().and_then(Value::as_str).unwrap_or(""), true)?;
                let mut rows = Vec::new();
                for item in fs::read_dir(dir)? {
                    let p = item?.path();
                    if within(&self.profile, &p) || check_existing(&p).is_err() {
                        continue;
                    }
                    let m = fs::metadata(&p)?;
                    if !m.is_dir() && !m.is_file() {
                        continue;
                    }
                    let mut row = self.row(&p)?;
                    row["isDirectory"] = m.is_dir().into();
                    row["size"] = if m.is_file() { m.len() } else { 0 }.into();
                    row["extension"] = if m.is_dir() {
                        String::new()
                    } else {
                        extension(&p)
                    }
                    .into();
                    row["modifiedAt"] = timestamp(&p)?.into();
                    rows.push(row);
                }
                rows.sort_by_cached_key(|v| {
                    (
                        v["isDirectory"] != true,
                        v["name"].as_str().unwrap_or("").to_lowercase(),
                    )
                });
                Ok(rows.into())
            }
            "mkdir" => {
                let p = self
                    .in_root(str_arg(args, 0)?, true)?
                    .join(valid_name(str_arg(args, 1)?)?);
                fs::create_dir(&p)?;
                self.row(&p)
            }
            "rename" | "move" => {
                let src = self.in_root(str_arg(args, 0)?, false)?;
                let target = if op == "rename" {
                    parent(&src)?.join(valid_name(str_arg(args, 1)?)?)
                } else {
                    self.in_root(str_arg(args, 1)?, true)?.join(name(&src)?)
                };
                self.relocate(&src, &target)
            }
            "trash" => {
                let p = self.in_root(str_arg(args, 0)?, false)?;
                protect(&self.profile, &p)?;
                trash::delete(&p)?;
                self.index.files.retain(|e| !within(&p, &e.path));
                self.persist()?;
                Ok(true.into())
            }
            "recent" => Ok(Value::Array(
                self.index
                    .files
                    .iter()
                    .take(40)
                    .map(Entry::describe)
                    .collect::<Result<_>>()?,
            )),
            "describe" => {
                let ids = args
                    .first()
                    .and_then(Value::as_array)
                    .context("文件索引请求无效。")?;
                ensure!(ids.len() <= 2000, "文件索引请求过大。");
                Ok(Value::Array(
                    self.index
                        .files
                        .iter()
                        .filter(|e| ids.iter().any(|id| id == &e.id))
                        .map(Entry::describe)
                        .collect::<Result<_>>()?,
                ))
            }
            "read" => {
                let p = self.in_root(str_arg(args, 0)?, false)?;
                self.open_path(&p)
            }
            "readRecent" => {
                let p = self.known(str_arg(args, 0)?)?.path.clone();
                self.open_path(&p)
            }
            "chooseOpen" => {
                let ext = args.first().and_then(Value::as_str);
                if let Some(e) = ext {
                    checked_ext(e)?;
                }
                let filters = ext.map(|e| vec![e]).unwrap_or_else(|| OFFICE.to_vec());
                let Some(p) = FileDialog::new()
                    .set_title("打开办公文件")
                    .add_filter("办公文档", &filters)
                    .pick_file()
                else {
                    return Ok(Value::Null);
                };
                let p = dunce::canonicalize(p)?;
                ensure!(
                    ext.is_none_or(|e| extension(&p) == e),
                    "所选格式与扩展名不匹配。"
                );
                self.open_path(&p)
            }
            "readConverted" => {
                let (id, revision) = (str_arg(args, 0)?, str_arg(args, 1)?);
                let path = &self.known(id)?.path;
                protect(&self.profile, path)?;
                let ext = extension(path);
                let f = crate::format_conversion::format(&ext).context("此文件不需要格式转换。")?;
                let bytes = checked_read(path)?;
                ensure!(digest(&bytes) == revision, "磁盘原件已经变化，请重新打开。");
                let modern = crate::format_conversion::convert(&bytes, &ext, true)?;
                let mut out = json!({"extension":f.modern,"content":STANDARD.encode(&modern)});
                if f.modern == "xlsx" {
                    let hash = digest(&modern);
                    let dir = self.profile.join("workbook-sources");
                    fs::create_dir_all(&dir)?;
                    atomic_write(
                        &dir.join(workbook_base_name(id, &hash).context("工作簿快照名称无效。")?),
                        &modern,
                    )?;
                    out["base"] = json!({"id":id,"revision":hash,"extension":"xlsx"});
                }
                Ok(out)
            }
            "pinWorkbookBase" | "readWorkbookBase" => {
                let (id, revision) = (str_arg(args, 0)?, str_arg(args, 1)?);
                let filename = workbook_base_name(id, revision).context("工作簿原件修订无效。")?;
                let dir = self.profile.join("workbook-sources");
                let path = dir.join(filename);
                if op == "pinWorkbookBase" {
                    ensure!(
                        matches!(extension(&self.known(id)?.path).as_str(), "xlsx" | "xlsm"),
                        "需要已登记的工作簿。"
                    );
                    let bytes = self.original(id, revision, false)?;
                    fs::create_dir_all(&dir)?;
                    if !path.try_exists()? || digest(&checked_read(&path)?) != revision {
                        atomic_write(&path, &bytes)?;
                    }
                    Ok(true.into())
                } else {
                    let bytes = checked_read(&path).context("工作簿原件快照不可用。")?;
                    ensure!(digest(&bytes) == revision, "工作簿原件快照校验失败。");
                    Ok(json!({"__bytes":STANDARD.encode(bytes)}))
                }
            }
            "readPdf" | "readOfficeSource" => Ok(
                json!({"__bytes":STANDARD.encode(self.original(str_arg(args,0)?,str_arg(args,1)?,op=="readPdf")?)}),
            ),
            "copyPdf" | "saveOfficeCopy" => self.copy_original(args, op == "copyPdf"),
            "save" => self.save(args.first().context("无效保存请求。")?),
            "create" => {
                let name = str_arg(args, 1)?;
                self.save(&json!({"name":name,"directory":str_arg(args,0)?,"extension":extension(Path::new(name)),"content":str_arg(args,2)?}))
            }
            "exportBackup" => {
                let entry = self.known(str_arg(args, 0)?)?;
                let ext = extension(&entry.path);
                let data = checked_read(
                    &self
                        .profile
                        .join("file-backups")
                        .join(format!("{}.bak", entry.id)),
                )
                .context("无法读取上次保存前的备份。")?;
                let stem = entry
                    .path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .context("无效文件名。")?;
                let Some(target) = target_dialog(&format!("{stem}-上次保存前.{ext}"), &ext)?
                else {
                    return Ok(Value::Null);
                };
                protect(&self.profile, &target)?;
                exclusive(&target, &data)?;
                Ok(json!({"name":name(&target)?,"path":target}))
            }
            _ => bail!("未知文件操作。"),
        }
    }
}
