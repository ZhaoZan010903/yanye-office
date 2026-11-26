use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, value::RawValue, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;

const MAX_BYTES: usize = 24 * 1024 * 1024;
const TXT_SCHEMA: &str = "CREATE TABLE txt_edits (doc TEXT REFERENCES pages(id) ON DELETE CASCADE,revision INTEGER,patch TEXT NOT NULL,PRIMARY KEY(doc,revision)) WITHOUT ROWID;";
const SCHEMA: &str = "
CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1),meta TEXT NOT NULL,ordering TEXT NOT NULL,legacy_sha256 TEXT);
CREATE TABLE pages (id TEXT PRIMARY KEY,body TEXT NOT NULL,edits INTEGER NOT NULL DEFAULT 0);
CREATE TABLE fields (doc TEXT REFERENCES pages(id) ON DELETE CASCADE,name TEXT,value TEXT NOT NULL,PRIMARY KEY(doc,name)) WITHOUT ROWID;
CREATE TABLE text_edits (doc TEXT REFERENCES pages(id) ON DELETE CASCADE,revision INTEGER,splice TEXT NOT NULL,PRIMARY KEY(doc,revision)) WITHOUT ROWID;
CREATE TABLE commits (revision INTEGER PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,digest TEXT NOT NULL);";

pub fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .with_context(|| format!("工作区缺少字符串字段 {key}"))
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value[key]
        .as_array()
        .with_context(|| format!("工作区缺少数组字段 {key}"))
}
fn id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn validate_page(p: &Value, schema: u64) -> Result<()> {
    ensure!(
        id_valid(string(p, "id")?)
            && string(p, "title")?.encode_utf16().count() <= 120
            && string(p, "markdown")?.encode_utf16().count() <= 2_000_000
            && p["favorite"].is_boolean()
            && p.get("deletedAt")
                .is_some_and(|v| v.is_null() || v.is_string())
            && p.get("parentId")
                .is_some_and(|v| v.is_null() || v.is_string())
            && p["createdAt"].is_string()
            && p["updatedAt"].is_string(),
        "工作区包含无效的页面。"
    );
    match string(p, "kind")? {
        "note" | "desk" | "journal" | "book" | "inbox" | "collection" => (),
        "word" | "spreadsheet" | "database" | "canvas" | "presentation" | "txt" | "pdf" => ensure!(
            schema >= 2 && p["content"].is_object() && (p["kind"] != "word" || schema >= 3),
            "办公文档结构无效。"
        ),
        _ => bail!("未知页面类型。"),
    }
    let disk = &p["disk"];
    if !disk.is_null() {
        ensure!(
            schema >= 3
                && disk["id"].is_string()
                && disk["name"].is_string()
                && disk["revision"].is_string()
                && disk["dirty"].is_boolean()
                && disk["extension"]
                    .as_str()
                    .is_some_and(|ext| crate::files::OFFICE.contains(&ext)),
            "文件绑定无效。"
        );
    }
    Ok(())
}
fn validate(workspace: &Value) -> Result<()> {
    let schema = workspace["schemaVersion"]
        .as_u64()
        .context("未知的工作区版本。")?;
    let rows = array(workspace, "pages")?;
    ensure!(
        (1..=3).contains(&schema)
            && workspace["revision"].as_u64().is_some()
            && rows.len() <= 2000
            && workspace.to_string().len() <= MAX_BYTES,
        "工作区无效或超过大小上限。"
    );
    let mut pages = HashMap::new();
    for p in rows {
        validate_page(p, schema)?;
        ensure!(
            pages.insert(string(p, "id")?, p).is_none(),
            "页面标识重复。"
        );
    }
    validate_tree(workspace, &pages)
}
fn validate_tree(workspace: &Value, pages: &HashMap<&str, &Value>) -> Result<()> {
    let mut complete = HashSet::new();
    for id in pages.keys() {
        let mut next = Some(*id);
        let mut chain = HashSet::new();
        while let Some(key) = next {
            if complete.contains(key) {
                break;
            }
            ensure!(chain.insert(key), "页面目录存在环。");
            next = pages.get(key).context("页面目录缺少父页面。")?["parentId"].as_str();
        }
        complete.extend(chain);
    }
    let mut collapsed = HashSet::new();
    for key in array(workspace, "collapsedIds")? {
        let id = key.as_str().context("页面索引无效。")?;
        ensure!(
            pages.contains_key(id) && collapsed.insert(id),
            "页面索引无效。"
        );
    }
    ensure!(
        workspace
            .get("activeId")
            .is_some_and(|v| v.is_null() || v.is_string()),
        "未找到活动页面。"
    );
    let mut active = workspace["activeId"].as_str();
    while let Some(id) = active {
        let p = pages.get(id).context("活动页面不存在。")?;
        ensure!(p["deletedAt"].is_null(), "活动页面已删除。");
        active = p["parentId"].as_str();
    }
    Ok(())
}
fn set_field(db: &Connection, id: &str, key: &str, value: &Value) -> Result<()> {
    db.prepare_cached("INSERT INTO fields(doc,name,value) VALUES(?,?,?) ON CONFLICT(doc,name) DO UPDATE SET value=excluded.value")?
        .execute(params![id,key,value.to_string()])?;
    Ok(())
}
fn add(db: &Connection, p: &Value) -> Result<()> {
    let id = string(p, "id")?;
    db.prepare_cached("INSERT INTO pages(id,body) VALUES(?,?)")?
        .execute(params![id, p["markdown"].to_string()])?;
    for (key, v) in p.as_object().context("无效页面。")? {
        if key != "id" && key != "markdown" {
            set_field(db, id, key, v)?;
        }
    }
    Ok(())
}

// Electron journals count UTF-16 units. A valid emoji edit can store only its
// low surrogate in an older splice. Decode the JSON string as units before joining.
#[derive(Deserialize)]
struct Splice<'a> {
    start: usize,
    removed: usize,
    #[serde(borrow)]
    inserted: &'a RawValue,
}
fn units(raw: &str) -> Result<Vec<u16>> {
    let s = raw
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .context("修订不是字符串。")?;
    let mut chars = s.chars();
    let mut out = Vec::new();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.extend_from_slice(c.encode_utf16(&mut [0; 2]));
            continue;
        }
        let c = match chars.next().context("JSON 转义不完整。")? {
            'u' => {
                let mut n = 0;
                for _ in 0..4 {
                    n = n * 16
                        + chars
                            .next()
                            .and_then(|c| c.to_digit(16))
                            .context("Unicode 转义无效。")?;
                }
                out.push(n as u16);
                continue;
            }
            'b' => '\x08',
            'f' => '\x0c',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            c @ ('"' | '\\' | '/') => c,
            _ => bail!("JSON 转义无效。"),
        };
        out.push(c as u16);
    }
    Ok(out)
}
fn apply_splice(original: &mut Vec<u16>, raw: &str) -> Result<()> {
    let s: Splice = serde_json::from_str(raw)?;
    let end = s
        .start
        .checked_add(s.removed)
        .context("正文修订位置无效。")?;
    ensure!(end <= original.len(), "无法恢复正文修订。");
    original.splice(s.start..end, units(s.inserted.get())?);
    Ok(())
}
// Applying a patch to a multi-megabyte TXT should not allocate another UTF-16
// copy of the entire document. Old surrogate-fragment journals take the fallback.
fn edit_string(value: &mut Value, raw: &str) -> Result<()> {
    let text = match value {
        Value::String(s) => s,
        _ => bail!("正文修订目标无效。"),
    };
    let patch: Splice = serde_json::from_str(raw)?;
    let end = patch
        .start
        .checked_add(patch.removed)
        .context("正文修订位置无效。")?;
    if let Ok(inserted) = serde_json::from_str::<String>(patch.inserted.get()) {
        if text.is_ascii() {
            ensure!(end <= text.len(), "无法恢复正文修订。");
            text.replace_range(patch.start..end, &inserted);
            return Ok(());
        }
        let mut units = 0;
        let mut start_byte = None;
        let mut end_byte = None;
        for (byte, ch) in text
            .char_indices()
            .chain(std::iter::once((text.len(), '\0')))
        {
            if units == patch.start {
                start_byte = Some(byte);
            }
            if units == end {
                end_byte = Some(byte);
                break;
            }
            if units > end {
                break;
            }
            units += ch.len_utf16();
        }
        if let (Some(start), Some(end)) = (start_byte, end_byte) {
            text.replace_range(start..end, &inserted);
            return Ok(());
        }
    }
    let mut utf16 = text.encode_utf16().collect();
    apply_splice(&mut utf16, raw)?;
    *text = String::from_utf16(&utf16)?;
    Ok(())
}
#[derive(Deserialize)]
struct TxtPatch<'a> {
    set: serde_json::Map<String, Value>,
    unset: Vec<String>,
    #[serde(borrow)]
    text: Option<&'a RawValue>,
    #[serde(rename = "lineMap", borrow)]
    line_map: Option<&'a RawValue>,
}
fn apply_txt(content: &mut Value, raw: &str) -> Result<()> {
    let patch: TxtPatch = serde_json::from_str(raw)?;
    let obj = content.as_object_mut().context("TXT 修订目标无效。")?;
    ensure!(
        !patch.set.contains_key("text") && !patch.set.contains_key("lineMap"),
        "TXT 变更无效。"
    );
    obj.extend(patch.set);
    for key in patch.unset {
        obj.remove(&key);
    }
    for (key, edit) in [("text", patch.text), ("lineMap", patch.line_map)] {
        if let Some(edit) = edit {
            edit_string(
                obj.entry(key.to_owned())
                    .or_insert_with(|| Value::String(String::new())),
                edit.get(),
            )?;
        }
    }
    Ok(())
}
fn page(db: &Connection, id: &str) -> Result<Value> {
    let body: String = db
        .prepare_cached("SELECT body FROM pages WHERE id=?")?
        .query_row([id], |r| r.get(0))?;
    let mut p = json!({"id":id});
    let mut stmt = db.prepare_cached("SELECT name,value FROM fields WHERE doc=?")?;
    let mut rows = stmt.query([id])?;
    while let Some(r) = rows.next()? {
        let key: String = r.get(0)?;
        ensure!(key != "id" && key != "markdown", "页面字段无效。");
        p[&key] = serde_json::from_str(&r.get::<_, String>(1)?)?;
    }
    let mut stmt =
        db.prepare_cached("SELECT splice FROM text_edits WHERE doc=? ORDER BY revision")?;
    let mut rows = stmt.query([id])?;
    if let Some(first) = rows.next()? {
        let mut utf16 = units(&body)?;
        apply_splice(&mut utf16, &first.get::<_, String>(0)?)?;
        while let Some(r) = rows.next()? {
            apply_splice(&mut utf16, &r.get::<_, String>(0)?)?;
        }
        p["markdown"] = Value::String(String::from_utf16(&utf16)?);
    } else {
        p["markdown"] = serde_json::from_str(&body)?;
    }
    let mut stmt =
        db.prepare_cached("SELECT patch FROM txt_edits WHERE doc=? ORDER BY revision")?;
    let mut rows = stmt.query([id])?;
    while let Some(r) = rows.next()? {
        apply_txt(&mut p["content"], &r.get::<_, String>(0)?)?;
    }
    Ok(p)
}
fn read(db: &Connection) -> Result<Value> {
    let (meta, order): (String, String) =
        db.query_row("SELECT meta,ordering FROM workspace WHERE id=1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;
    let mut ws: Value = serde_json::from_str(&meta)?;
    let order: Vec<String> = serde_json::from_str(&order)?;
    let count: usize = db.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0))?;
    ensure!(count == order.len() && count <= 2000, "页面目录不完整。");
    ws["pages"] = Value::Array(order.iter().map(|id| page(db, id)).collect::<Result<_>>()?);
    validate(&ws)?;
    Ok(ws)
}

struct CachedPage {
    data: Value,
    bytes: usize,
}
impl CachedPage {
    fn new(data: Value) -> Arc<Self> {
        let bytes = data.to_string().len();
        Arc::new(Self { data, bytes })
    }
}
pub struct Workspace {
    db: Connection,
    pages: HashMap<String, Arc<CachedPage>>,
    revision: u64,
}
impl Workspace {
    pub fn open(profile: &Path, initial: &Value) -> Result<Self> {
        let mut db = Connection::open(profile.join("workspace.sqlite"))?;
        db.execute_batch("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: i32 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        match version {
            0 => {
                let count: usize = tx.query_row(
                    "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
                    [],
                    |r| r.get(0),
                )?;
                ensure!(count == 0, "无法识别现有数据库，已保留原件。");
                let legacy = profile.join("workspace.json");
                let (ws, digest) = match fs::metadata(&legacy) {
                    Ok(m) => {
                        ensure!(m.len() <= MAX_BYTES as u64, "旧工作区超过大小上限。");
                        let data = fs::read(legacy)?;
                        (
                            serde_json::from_slice(&data)?,
                            Some(format!("{:x}", Sha256::digest(&data))),
                        )
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (initial.clone(), None),
                    Err(e) => return Err(e.into()),
                };
                validate(&ws)?;
                tx.execute_batch(SCHEMA)?;
                tx.execute_batch(TXT_SCHEMA)?;
                let mut meta = ws.clone();
                meta.as_object_mut().unwrap().remove("pages");
                let mut order = Vec::new();
                for p in array(&ws, "pages")? {
                    add(&tx, p)?;
                    order.push(string(p, "id")?);
                }
                tx.execute(
                    "INSERT INTO workspace VALUES(1,?,?,?)",
                    params![meta.to_string(), serde_json::to_string(&order)?, digest],
                )?;
                ensure!(read(&tx)? == ws, "旧工作区迁移复核失败。");
                tx.execute_batch("PRAGMA user_version=2")?;
            }
            1 => {
                tx.execute_batch(TXT_SCHEMA)?;
                read(&tx)?;
                tx.execute_batch("PRAGMA user_version=2")?;
            }
            2 => (),
            _ => bail!("工作区由更新的版本创建。"),
        }
        tx.commit()?;
        let mut snapshot = read(&db)?;
        let revision = snapshot["revision"].as_u64().context("无效修订号。")?;
        let mut pages = HashMap::new();
        for p in snapshot["pages"].as_array_mut().unwrap().drain(..) {
            pages.insert(string(&p, "id")?.to_owned(), CachedPage::new(p));
        }
        Ok(Self {
            db,
            pages,
            revision,
        })
    }
    pub fn load(&self) -> Result<Value> {
        let (meta, order): (String, String) = self.db.query_row(
            "SELECT meta,ordering FROM workspace WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut snapshot: Value = serde_json::from_str(&meta)?;
        ensure!(
            snapshot["revision"] == self.revision,
            "工作区已由其他进程修改，请重新打开。"
        );
        let ids: Vec<String> = serde_json::from_str(&order)?;
        let ordered = ids
            .iter()
            .map(|id| {
                self.pages
                    .get(id)
                    .map(|page| page.data.clone())
                    .context("页面目录不完整。")
            })
            .collect::<Result<Vec<_>>>()?;
        snapshot["pages"] = Value::Array(ordered);
        Ok(snapshot)
    }
    pub fn revision(&self) -> Result<u64> {
        let raw: String = self
            .db
            .query_row("SELECT meta FROM workspace WHERE id=1", [], |r| r.get(0))?;
        serde_json::from_str::<Value>(&raw)?["revision"]
            .as_u64()
            .context("工作区缺少修订号。")
    }
    pub fn workbook_bases(&self) -> HashSet<String> {
        self.pages
            .values()
            .filter_map(|page| {
                let base = &page.data["content"]["preserved"]["base"];
                crate::files::workbook_base_name(base["id"].as_str()?, base["revision"].as_str()?)
            })
            .collect()
    }
    pub fn dirty(&self) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for p in self.pages.values() {
            let disk = &p.data["disk"];
            if disk["dirty"] != true || disk["closeAcknowledged"] == true {
                continue;
            }
            let mut entry = Some(p.as_ref());
            let mut visible = true;
            while let Some(node) = entry {
                if !node.data["deletedAt"].is_null() {
                    visible = false;
                    break;
                }
                entry = node.data["parentId"]
                    .as_str()
                    .and_then(|id| self.pages.get(id))
                    .map(Arc::as_ref);
            }
            if visible {
                out.push(string(disk, "name")?.to_owned());
            }
        }
        Ok(out)
    }
    pub fn stage(&mut self, d: &Value) -> Result<u64> {
        let id = string(d, "operationId")?;
        ensure!(id_valid(&id.to_ascii_lowercase()), "无效的保存操作标识。");
        let base = d["baseRevision"].as_u64().context("缺少基础修订号。")?;
        let revision = d["meta"]["revision"].as_u64().context("缺少修订号。")?;
        ensure!(
            base.checked_add(1) == Some(revision) && d["meta"].get("pages").is_none(),
            "保存修订号无效。"
        );
        let hash = format!("{:x}", Sha256::digest(d.to_string().as_bytes()));
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (meta, order): (String, String) =
            tx.query_row("SELECT meta,ordering FROM workspace WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;
        let current: Value = serde_json::from_str(&meta)?;
        ensure!(
            current["revision"] == self.revision,
            "工作区已由其他进程修改，请重新打开。"
        );
        if current["revision"] != base {
            let prior: Option<(u64, String)> = tx
                .query_row(
                    "SELECT revision,digest FROM commits WHERE operation_id=?",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            ensure!(
                prior == Some((revision, hash)),
                "保存冲突，已保留上次确认的版本。"
            );
            return current["revision"].as_u64().context("无法读取修订号。");
        }
        let changes = array(d, "changes")?;
        ensure!(
            changes.len() <= 4000 && d.to_string().len() <= MAX_BYTES + 65536,
            "保存内容超过上限。"
        );
        let mut touched = HashSet::new();
        let mut pages = self.pages.clone();
        let schema = d["meta"]["schemaVersion"]
            .as_u64()
            .context("缺少版本号。")?;
        ensure!(
            (1..=3).contains(&schema)
                && current["schemaVersion"]
                    .as_u64()
                    .is_some_and(|v| schema >= v),
            "工作区版本无效。"
        );
        for c in changes {
            let key = string(c, "id")?;
            ensure!(id_valid(key) && touched.insert(key), "页面变更标识无效。");
            if let Some(p) = c.get("add") {
                ensure!(p["id"] == key, "新页面标识不一致。");
                validate_page(p, schema)?;
                pages.insert(key.to_owned(), CachedPage::new(p.clone()));
                add(&tx, p)?;
                continue;
            }
            if c["remove"] == true {
                pages.remove(key);
                ensure!(
                    tx.execute("DELETE FROM pages WHERE id=?", [key])? == 1,
                    "页面不存在。"
                );
                continue;
            }
            let set = c["set"].as_object().context("无效页面字段。")?;
            let unset = array(c, "unset")?;
            let previous = &pages.get(key).context("页面不存在。")?.data;
            let mut updated = previous.clone();
            for (name, v) in set {
                ensure!(name != "id" && name != "markdown", "无效页面字段。");
                updated[name] = v.clone();
                set_field(&tx, key, name, v)?;
            }
            for name in unset {
                let name = name.as_str().context("无效页面字段。")?;
                ensure!(name != "id" && name != "markdown", "无效页面字段。");
                updated.as_object_mut().unwrap().remove(name);
                tx.execute(
                    "DELETE FROM fields WHERE doc=? AND name=?",
                    params![key, name],
                )?;
            }
            if set.contains_key("content") || unset.iter().any(|v| v == "content") {
                ensure!(c.get("plainText").is_none(), "TXT 变更目标冲突。");
                tx.execute("DELETE FROM txt_edits WHERE doc=?", [key])?;
            }
            if let Some(p) = c.get("plainText") {
                ensure!(
                    previous["kind"] == "txt" && updated["kind"] == "txt",
                    "TXT 变更目标无效。"
                );
                apply_txt(&mut updated["content"], &p.to_string())?;
                tx.execute(
                    "INSERT INTO txt_edits VALUES(?,?,?)",
                    params![key, revision, p.to_string()],
                )?;
            }
            if let Some(p) = c.get("text") {
                edit_string(&mut updated["markdown"], &p.to_string())?;
                tx.execute(
                    "INSERT INTO text_edits VALUES(?,?,?)",
                    params![key, revision, p.to_string()],
                )?;
                tx.execute("UPDATE pages SET edits=edits+1 WHERE id=?", [key])?;
            }
            let needs_compaction:bool=tx.query_row("SELECT edits>=128 OR (SELECT COUNT(*) FROM txt_edits WHERE doc=?1)>=128 FROM pages WHERE id=?1",[key],|r|r.get(0))?;
            if needs_compaction {
                tx.execute(
                    "UPDATE pages SET body=?,edits=0 WHERE id=?",
                    params![updated["markdown"].to_string(), key],
                )?;
                tx.execute("DELETE FROM text_edits WHERE doc=?", [key])?;
                if let Some(content) = updated.get("content") {
                    set_field(&tx, key, "content", content)?;
                }
                tx.execute("DELETE FROM txt_edits WHERE doc=?", [key])?;
            }
            validate_page(&updated, schema)?;
            pages.insert(key.to_owned(), CachedPage::new(updated));
        }
        let order = d.get("order").map(Value::to_string).unwrap_or(order);
        let ordered: Vec<String> = serde_json::from_str(&order)?;
        let mut ids = HashSet::new();
        ensure!(
            ordered.len() == pages.len()
                && ordered.len() <= 2000
                && ordered
                    .iter()
                    .all(|id| pages.contains_key(id) && ids.insert(id)),
            "无效页面顺序。"
        );
        let directory = pages
            .iter()
            .map(|(key, p)| (key.as_str(), &p.data))
            .collect();
        validate_tree(&d["meta"], &directory)?;
        let mut header = d["meta"].clone();
        header["pages"] = json!([]);
        let size = header.to_string().len()
            + pages.len().saturating_sub(1)
            + pages.values().map(|p| p.bytes).sum::<usize>();
        ensure!(size <= MAX_BYTES, "工作区超过 24 MiB 上限。");
        tx.execute(
            "UPDATE workspace SET meta=?,ordering=? WHERE id=1",
            params![d["meta"].to_string(), order],
        )?;
        tx.execute(
            "INSERT INTO commits VALUES(?,?,?)",
            params![revision, id, hash],
        )?;
        tx.commit()?;
        self.pages = pages;
        self.revision = revision;
        Ok(revision)
    }
}
