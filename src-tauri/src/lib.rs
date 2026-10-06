use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::sync::watch;
#[derive(Default)]
struct Requests(Mutex<HashMap<String, Option<watch::Sender<bool>>>>);
#[derive(Deserialize)]
struct Upload {
    key: String,
    name: String,
    mime: String,
    bytes: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
    body_type: String,
    fields: Vec<(String, String)>,
    files: Vec<Upload>,
    binary: Vec<u8>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
    duration: u128,
    size: usize,
}
async fn execute(request: HttpRequest) -> Result<HttpResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS are supported".into());
    }
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|e| e.to_string())?;
    let has_body = method != reqwest::Method::GET && method != reqwest::Method::HEAD;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }
    if has_body {
        builder = match request.body_type.as_str() {
            "form" => builder.form(&request.fields),
            "multipart" => {
                let mut form = reqwest::multipart::Form::new();
                for (key, value) in request.fields {
                    form = form.text(key, value);
                }
                for file in request.files {
                    let part = reqwest::multipart::Part::bytes(file.bytes)
                        .file_name(file.name)
                        .mime_str(if file.mime.is_empty() {
                            "application/octet-stream"
                        } else {
                            &file.mime
                        })
                        .map_err(|e| e.to_string())?;
                    form = form.part(file.key, part);
                }
                builder.multipart(form)
            }
            "binary" => builder.body(request.binary),
            _ => builder.body(request.body),
        };
    }
    let start = Instant::now();
    let mut response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 20 * 1024 * 1024 {
            return Err("Response exceeds the 20 MB preview limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").into(),
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        duration: start.elapsed().as_millis(),
        size: bytes.len(),
    })
}
#[tauri::command]
async fn send_request(
    id: String,
    request: HttpRequest,
    state: tauri::State<'_, Requests>,
) -> Result<HttpResponse, String> {
    perform(id, request, &state).await
}
async fn perform(
    id: String,
    request: HttpRequest,
    state: &Requests,
) -> Result<HttpResponse, String> {
    let (tx, mut rx) = watch::channel(false);
    {
        let mut entries = state.0.lock().map_err(|e| e.to_string())?;
        if matches!(entries.get(&id), Some(None)) {
            entries.remove(&id);
            return Err("Request cancelled".into());
        }
        entries.insert(id.clone(), Some(tx));
    }
    let result = tokio::select! {result=execute(request)=>result,_=rx.changed()=>Err("Request cancelled".into())};
    state.0.lock().map_err(|e| e.to_string())?.remove(&id);
    result
}
fn cancel(id: String, state: &Requests) -> Result<(), String> {
    let mut entries = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(Some(tx)) = entries.get(&id) {
        let _ = tx.send(true);
    } else {
        if entries.len() > 2000 {
            entries.retain(|_, value| value.is_some());
        }
        entries.insert(id, None);
    }
    Ok(())
}
#[tauri::command]
fn cancel_request(id: String, state: tauri::State<'_, Requests>) -> Result<(), String> {
    cancel(id, &state)
}
fn database(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let path = match std::env::var("FLOWX_DATA_DIR") {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    return database_at(&path);
}
fn database_at(path: &std::path::Path) -> Result<rusqlite::Connection, String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let db = rusqlite::Connection::open(path.join("flowx.sqlite")).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY, data TEXT NOT NULL);").map_err(|e|e.to_string())?;
    Ok(db)
}
#[tauri::command]
fn load_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    database(&app)?
        .query_row("SELECT data FROM workspace WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn save_workspace(app: tauri::AppHandle, data: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&data).map_err(|e| e.to_string())?;
    database(&app)?.execute("INSERT INTO workspace(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",[data]).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
fn save_run(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let id = value["id"].as_str().ok_or("Missing run ID")?;
    let db = database(&app)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()));").map_err(|e|e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO runs(id,data) VALUES(?1,?2)",
        rusqlite::params![id, data],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY created_at DESC LIMIT 100)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn load_runs(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let db = database(&app)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at INTEGER DEFAULT (unixepoch()));").map_err(|e|e.to_string())?;
    let mut stmt = db
        .prepare("SELECT data FROM runs ORDER BY created_at DESC LIMIT 100")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
pub fn run() {
    tauri::Builder::default()
        .manage(Requests::default())
        .invoke_handler(tauri::generate_handler![
            send_request,
            cancel_request,
            load_workspace,
            save_workspace,
            save_run,
            load_runs
        ])
        .run(tauri::generate_context!())
        .expect("Unable to launch FlowX");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    fn request(url: String) -> HttpRequest {
        HttpRequest {
            method: "POST".into(),
            url,
            headers: vec![],
            body: "{\"ok\":true}".into(),
            body_type: "raw".into(),
            fields: vec![],
            files: vec![],
            binary: vec![],
        }
    }
    fn fixture() -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let count = socket.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                let text = String::from_utf8_lossy(&bytes);
                if let Some(at) = text.find("\r\n\r\n") {
                    let length = text[..at]
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|s| s.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= at + 4 + length {
                        break;
                    }
                }
            }
            socket.write_all(b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"id\":1234}").unwrap();
            String::from_utf8_lossy(&bytes).into_owned()
        });
        (format!("http://{address}/items"), handle)
    }
    #[tokio::test]
    async fn native_json_request_and_response() {
        let (url, server) = fixture();
        let result = execute(request(url)).await.unwrap();
        assert_eq!(result.status, 201);
        assert_eq!(result.size, 11);
        assert_eq!(result.body, "{\"id\":1234}");
        assert!(server.join().unwrap().contains("{\"ok\":true}"));
    }
    #[tokio::test]
    async fn native_form_encoding() {
        let (url, server) = fixture();
        let mut request = request(url);
        request.body_type = "form".into();
        request.fields = vec![("query".into(), "a & b".into())];
        execute(request).await.unwrap();
        let raw = server.join().unwrap();
        assert!(raw.contains("application/x-www-form-urlencoded"));
        assert!(raw.contains("query=a+%26+b"));
    }
    #[tokio::test]
    async fn native_multipart_upload() {
        let (url, server) = fixture();
        let mut request = request(url);
        request.body_type = "multipart".into();
        request.files = vec![Upload {
            key: "document".into(),
            name: "test.txt".into(),
            mime: "text/plain".into(),
            bytes: b"test upload".to_vec(),
        }];
        execute(request).await.unwrap();
        let raw = server.join().unwrap();
        assert!(raw.contains("multipart/form-data"));
        assert!(raw.contains("filename=\"test.txt\""));
        assert!(raw.contains("test upload"));
    }
    #[tokio::test]
    async fn cancellation_before_dispatch_does_not_send() {
        let state = Requests::default();
        cancel("id".into(), &state).unwrap();
        assert_eq!(
            perform("id".into(), request("http://127.0.0.1:1".into()), &state)
                .await
                .err()
                .unwrap(),
            "Request cancelled"
        );
        assert!(state.0.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn rejects_non_http_urls() {
        assert!(execute(request("file:///tmp/test".into())).await.is_err());
    }
    #[test]
    fn sqlite_workspace_updates_are_atomic() {
        let path = std::env::temp_dir().join(format!("flowx-test-{}", std::process::id()));
        let db = database_at(&path).unwrap();
        db.execute(
            "INSERT OR REPLACE INTO workspace(id,data) VALUES(1,?1)",
            ["first"],
        )
        .unwrap();
        db.execute("INSERT INTO workspace(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",["second"]).unwrap();
        let value: String = db
            .query_row("SELECT data FROM workspace WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "second");
        drop(db);
        std::fs::remove_dir_all(path).unwrap();
    }
}
