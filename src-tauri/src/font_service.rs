use std::collections::BTreeSet;

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let source = font_kit::source::SystemSource::new();
        let families = source
            .all_families()
            .map_err(|e| format!("Failed to enumerate fonts: {e}"))?;

        let unique: BTreeSet<String> = families.into_iter().collect();
        let mut sorted: Vec<String> = unique.into_iter().collect();
        sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        Ok(sorted)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}
