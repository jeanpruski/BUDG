use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
struct Backup { id: String, #[serde(rename = "createdAt")] created_at: String, state: Value }
#[derive(Serialize, Deserialize, Default)]
struct LocalData { current: Option<Value>, backups: Vec<Backup> }
struct StorageLock(Mutex<()>);
fn file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("budget-v3.json"))
}
fn read(app: &tauri::AppHandle) -> Result<LocalData, String> {
    let path = file(app)?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Sauvegarde locale illisible : {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LocalData::default()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn load_budget(app: tauri::AppHandle, lock: tauri::State<StorageLock>) -> Result<Option<Value>, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    Ok(read(&app)?.current)
}
#[tauri::command]
fn list_backups(app: tauri::AppHandle, lock: tauri::State<StorageLock>) -> Result<Vec<Backup>, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let mut backups = read(&app)?.backups;
    backups.reverse();
    Ok(backups)
}
#[tauri::command]
fn save_budget(app: tauri::AppHandle, lock: tauri::State<StorageLock>, mut state: Value, expected_revision: i64, created_at: String) -> Result<Value, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let mut data = match read(&app) {
        Ok(data) => data,
        Err(error) if expected_revision < 0 => {
            let path = file(&app)?;
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
            fs::copy(&path, path.with_extension(format!("unreadable-{stamp}.json"))).map_err(|_| error)?;
            LocalData::default()
        }
        Err(error) => return Err(error),
    };
    let revision = data.current.as_ref().and_then(|v| v["revision"].as_u64()).unwrap_or(0);
    if expected_revision >= 0 && revision != expected_revision as u64 { return Err("Les données ont changé dans une autre fenêtre. Rechargez l’application.".into()); }
    if expected_revision < 0 { state["revision"] = serde_json::json!(revision + 1); }
    if state["version"].as_u64() != Some(4) || state["revision"].as_u64() != Some(revision + 1) { return Err("Version de sauvegarde invalide.".into()); }
    if let Some(current) = data.current.take() {
        let id = revision.to_string();
        data.backups.push(Backup { id: id.clone(), created_at, state: current });
        if data.backups.len() > 20 { data.backups.remove(0); }
    }
    data.current = Some(state.clone());
    let path = file(&app)?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let mut output = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    output.write_all(&bytes).map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
    Ok(state)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StorageLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![load_budget, save_budget, list_backups])
        .run(tauri::generate_context!())
        .expect("error while running BUDG");
}
