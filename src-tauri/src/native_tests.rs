use crate::{files::Library, workspace::Workspace};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::fs;
use tempfile::tempdir;

fn initial() -> Value {
    json!({"schemaVersion":3,"revision":0,"activeId":"desk","collapsedIds":[],"pages":[
        {"id":"desk","kind":"note","parentId":null,"title":"原始页","favorite":false,
        "createdAt":"2026-01-01","updatedAt":"2026-01-01","deletedAt":null,"markdown":"甲\u{0}😀乙"}
    ]})
}
fn edit(revision: u64, splice: Value) -> Value {
    let mut meta = initial();
    meta.as_object_mut().unwrap().remove("pages");
    meta["revision"] = (revision + 1).into();
    json!({"operationId":format!("edit-{revision}"),"baseRevision":revision,"meta":meta,
        "changes":[{"id":"desk","set":{},"unset":[],"text":splice}]})
}

#[test]
fn recover_legacy_json_and_old_utf16_sqlite_journal_without_touching_original() {
    let temp = tempdir().unwrap();
    let legacy = temp.path().join("workspace.json");
    let bytes = serde_json::to_vec_pretty(&initial()).unwrap();
    fs::write(&legacy, &bytes).unwrap();
    let mut store = Workspace::open(temp.path(), &Value::Null).unwrap();
    assert_eq!(store.load().unwrap(), initial());
    let expected = edit(0, json!({"start":2,"removed":2,"inserted":"😁"}));
    assert_eq!(store.stage(&expected).unwrap(), 1);
    assert!(store
        .stage(&edit(1, json!({"start":999,"removed":1,"inserted":"?"})))
        .is_err());
    assert_eq!(store.revision().unwrap(), 1);
    drop(store);
    // Replace the new Unicode-safe delta with the equivalent legacy wire encoding.
    let db = Connection::open(temp.path().join("workspace.sqlite")).unwrap();
    db.execute(
        "UPDATE text_edits SET splice=?",
        [r#"{"start":3,"removed":1,"inserted":"\ude01"}"#],
    )
    .unwrap();
    db.execute_batch("DROP TABLE txt_edits; PRAGMA user_version=1")
        .unwrap();
    drop(db);
    let mut reopened = Workspace::open(temp.path(), &Value::Null).unwrap();
    assert_eq!(
        reopened.load().unwrap()["pages"][0]["markdown"],
        "甲\u{0}😁乙"
    );
    assert_eq!(reopened.stage(&expected).unwrap(), 1);
    assert_eq!(fs::read(legacy).unwrap(), bytes);
}

#[test]
fn invalid_legacy_graph_rolls_back_and_can_be_retried() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("workspace.json");
    let mut invalid = initial();
    invalid["pages"][0]["parentId"] = "desk".into();
    fs::write(&path, invalid.to_string()).unwrap();
    assert!(Workspace::open(temp.path(), &Value::Null).is_err());
    let db = Connection::open(temp.path().join("workspace.sqlite")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", params![], |r| r.get::<_, u32>(0))
            .unwrap(),
        0
    );
    drop(db);
    fs::write(&path, initial().to_string()).unwrap();
    assert_eq!(
        Workspace::open(temp.path(), &Value::Null)
            .unwrap()
            .load()
            .unwrap(),
        initial()
    );
}

#[test]
fn previous_file_binding_survives_restart_and_rejects_stale_save() {
    let home = tempdir().unwrap();
    let profile = home.path().join("profile");
    let files = home.path().join("files");
    fs::create_dir(&profile).unwrap();
    fs::create_dir(&files).unwrap();
    let path = files.join("草稿.md");
    fs::write(&path, "初稿").unwrap();
    let id = "ca1cb69a-b2e5-4341-90f9-919afa565300";
    let index =
        json!({"version":1,"root":files,"files":[{"id":id,"path":path,"modifiedAt":"2026-01-01"}]});
    fs::write(profile.join("file-library.json"), index.to_string()).unwrap();
    let mut library = Library::open(&profile).unwrap();
    let opened = library.call("readRecent", &[id.into()]).unwrap();
    assert_eq!(opened["content"], "初稿");
    let request = json!({"id":id,"name":"草稿.md","content":"修订版","revision":opened["revision"],"extension":"md"});
    library
        .call("save", std::slice::from_ref(&request))
        .unwrap();
    assert_eq!(
        fs::read_to_string(profile.join("file-backups").join(format!("{id}.bak"))).unwrap(),
        "初稿"
    );
    fs::write(&path, "其他程序的更改").unwrap();
    drop(library);
    let mut reopened = Library::open(&profile).unwrap();
    assert!(reopened.call("save", &[request]).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "其他程序的更改");
}
