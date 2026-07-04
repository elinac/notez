use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub(crate) struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub(crate) enum StreamEvent {
    #[serde(rename = "token")]
    Token { content: String },
    #[serde(rename = "done")]
    Done {
        #[serde(rename = "fullText")]
        full_text: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Serialize)]
pub struct ModelInfo {
    id: String,
    name: String,
}

fn build_client(proxy_mode: &str, proxy_url: &Option<String>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder();
    match proxy_mode {
        "system" => { /* default behavior reads system proxy env vars */ }
        "custom" => {
            if let Some(url) = proxy_url {
                builder = builder.proxy(
                    reqwest::Proxy::all(url).map_err(|e| format!("Invalid proxy URL: {e}"))?,
                );
            }
        }
        _ => {
            builder = builder.no_proxy();
        }
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

#[tauri::command]
pub async fn ai_chat_stream(
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
    proxy_mode: String,
    proxy_url: Option<String>,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<(), String> {
    let client = build_client(&proxy_mode, &proxy_url)?;
    let mut full_text = String::new();

    let is_anthropic = provider == "anthropic";

    let response = if is_anthropic {
        let system_text: String = messages
            .iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.clone())
            .collect::<Vec<_>>()
            .join("\n");

        let user_messages: Vec<serde_json::Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
            .collect();

        let merged = merge_adjacent_messages(user_messages);

        let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
        let mut body = serde_json::json!({
            "model": model,
            "messages": merged,
            "max_tokens": 4096,
            "stream": true,
        });
        if !system_text.is_empty() {
            body["system"] = serde_json::Value::String(system_text);
        }

        client
            .post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .body(serde_json::to_string(&body).unwrap())
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?
    } else {
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": model,
            "messages": messages.iter().map(|m| serde_json::json!({
                "role": m.role, "content": m.content
            })).collect::<Vec<_>>(),
            "stream": true,
        });

        client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .body(serde_json::to_string(&body).unwrap())
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {body}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if is_anthropic {
                if line.starts_with("event: ") {
                    let event_type = line[7..].trim();
                    if event_type == "message_stop" {
                        let _ = on_event.send(StreamEvent::Done {
                            full_text: full_text.clone(),
                        });
                        return Ok(());
                    }
                    continue;
                }
                if line.starts_with("data: ") {
                    let data = &line[6..];
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(delta) = parsed.get("delta") {
                            if delta.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                    full_text.push_str(text);
                                    let _ = on_event.send(StreamEvent::Token {
                                        content: text.to_string(),
                                    });
                                }
                            }
                        }
                        if let Some(err) = parsed.get("error") {
                            let msg = err
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("Unknown error");
                            let _ = on_event.send(StreamEvent::Error {
                                message: msg.to_string(),
                            });
                            return Err(msg.to_string());
                        }
                    }
                }
            } else {
                if line.starts_with("data: ") {
                    let data = &line[6..];
                    if data.trim() == "[DONE]" {
                        let _ = on_event.send(StreamEvent::Done {
                            full_text: full_text.clone(),
                        });
                        return Ok(());
                    }
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(content) = parsed
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("delta"))
                            .and_then(|d| d.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            if !content.is_empty() {
                                full_text.push_str(content);
                                let _ = on_event.send(StreamEvent::Token {
                                    content: content.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    if !full_text.is_empty() {
        let _ = on_event.send(StreamEvent::Done { full_text });
    }
    Ok(())
}

fn merge_adjacent_messages(messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut merged: Vec<serde_json::Value> = Vec::new();
    for msg in messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if let Some(last) = merged.last_mut() {
            if last.get("role").and_then(|r| r.as_str()) == Some(role) {
                let prev_content = last.get("content").and_then(|c| c.as_str()).unwrap_or("");
                let new_content = msg.get("content").and_then(|c| c.as_str()).unwrap_or("");
                *last = serde_json::json!({
                    "role": role,
                    "content": format!("{prev_content}\n{new_content}"),
                });
                continue;
            }
        }
        merged.push(msg);
    }
    merged
}

#[tauri::command]
pub async fn ai_list_models(
    provider: String,
    base_url: String,
    api_key: String,
    proxy_mode: String,
    proxy_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    let client = build_client(&proxy_mode, &proxy_url)?;

    let (url, headers) = if provider == "anthropic" {
        let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-api-key", api_key.parse().map_err(|e| format!("{e}"))?);
        headers.insert(
            "anthropic-version",
            "2023-06-01".parse().map_err(|e| format!("{e}"))?,
        );
        (url, headers)
    } else {
        let url = format!("{}/models", base_url.trim_end_matches('/'));
        let mut headers = reqwest::header::HeaderMap::new();
        if !api_key.is_empty() {
            headers.insert(
                "Authorization",
                format!("Bearer {api_key}")
                    .parse()
                    .map_err(|e| format!("{e}"))?,
            );
        }
        (url, headers)
    };

    let resp = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;

    let data = json
        .get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let models: Vec<ModelInfo> = data
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            let name = m
                .get("name")
                .or_else(|| m.get("id"))
                .and_then(|n| n.as_str())
                .unwrap_or(&id)
                .to_string();
            Some(ModelInfo { id, name })
        })
        .collect();

    Ok(models)
}
