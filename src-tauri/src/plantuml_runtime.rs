//! 使用打包在 `$RESOURCE/resources/plantuml-runtime/` 下的 JRE、plantuml.jar、Graphviz 离线渲染。
//!
//! 默认走 **PicoWeb 长驻子进程**（`java -jar plantuml.jar -picoweb:PORT:127.0.0.1`），通过 HTTP 多次请求渲染；
//! PlantUML 官方 CLI 的 `-pipe` 每次会结束 JVM，无法在同一进程上「多次 pipe」。
//! 超长编码（URL 过大）或 HTTP 失败时回退为单次 `-pipe`。
//!
//! 日志：`{exe 所在目录}/notez-plantuml.log`

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use chrono::Local;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::plantuml_native;

/// `render_plantuml_local` 成功时的载荷：SVG 字节 + 可选告警（Rust 组件图解析等）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlantumlLocalRenderResult {
    pub svg_bytes: Vec<u8>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

fn jar_output_only(bytes: Vec<u8>) -> PlantumlLocalRenderResult {
    PlantumlLocalRenderResult {
        svg_bytes: bytes,
        warnings: Vec::new(),
    }
}

/// PlantUML URL 编码：zlib(deflate) 去头尾 + 6bit 字符表（与官方 PicoWeb / plantuml.com 一致）
fn encode6bit(mut b: u32) -> char {
    if b < 10 {
        return char::from_u32(48 + b).unwrap_or('?');
    }
    b -= 10;
    if b < 26 {
        return char::from_u32(65 + b).unwrap_or('?');
    }
    b -= 26;
    if b < 26 {
        return char::from_u32(97 + b).unwrap_or('?');
    }
    b -= 26;
    match b {
        0 => '-',
        1 => '_',
        _ => '?',
    }
}

fn append_3bytes(buf: &mut String, b1: u8, b2: u8, b3: u8) {
    buf.push(encode6bit((b1 >> 2) as u32));
    buf.push(encode6bit((((b1 & 0x3) << 4) | (b2 >> 4)) as u32));
    buf.push(encode6bit((((b2 & 0xF) << 2) | (b3 >> 6)) as u32));
    buf.push(encode6bit((b3 & 0x3F) as u32));
}

fn encode_6bit_payload(data: &[u8]) -> String {
    let mut r = String::new();
    let mut i = 0usize;
    while i < data.len() {
        if i + 2 < data.len() {
            append_3bytes(&mut r, data[i], data[i + 1], data[i + 2]);
            i += 3;
        } else if i + 1 < data.len() {
            append_3bytes(&mut r, data[i], data[i + 1], 0);
            i += 2;
        } else {
            append_3bytes(&mut r, data[i], 0, 0);
            i += 1;
        }
    }
    r
}

fn encode_plantuml_deflate(source: &str) -> Result<String, String> {
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::best());
    enc.write_all(source.as_bytes())
        .map_err(|e| format!("deflate 写入: {e}"))?;
    let zlib = enc.finish().map_err(|e| format!("deflate 结束: {e}"))?;
    if zlib.len() < 6 {
        return Err("deflate 结果过短".to_string());
    }
    let raw = &zlib[2..zlib.len() - 4];
    Ok(encode_6bit_payload(raw))
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_http_status(headers: &str) -> Result<u16, String> {
    let line = headers
        .lines()
        .next()
        .ok_or_else(|| "无 HTTP 状态行".to_string())?;
    let mut it = line.split_whitespace();
    let _ver = it.next();
    let code = it
        .next()
        .ok_or_else(|| "无状态码".to_string())?
        .parse::<u16>()
        .map_err(|_| "状态码非数字".to_string())?;
    Ok(code)
}

fn parse_content_length(headers: &str) -> Option<usize> {
    for line in headers.lines().skip(1) {
        let t = line.trim();
        let low = t.to_ascii_lowercase();
        if let Some(rest) = low.strip_prefix("content-length:") {
            return rest.trim().parse().ok();
        }
    }
    None
}

/// 对 `127.0.0.1:port` 发 `GET path`（path 须含前导 `/`），`Connection: close` 读满响应。
fn http_get_localhost(
    port: u16,
    path: &str,
    read_timeout: Duration,
) -> Result<(u16, Vec<u8>), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .map_err(|e| format!("TCP: {e}"))?;
    stream
        .set_read_timeout(Some(read_timeout))
        .map_err(|e| format!("set_read_timeout: {e}"))?;
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nAccept: */*\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("HTTP 写入: {e}"))?;
    let mut acc = Vec::new();
    stream
        .read_to_end(&mut acc)
        .map_err(|e| format!("HTTP 读响应: {e}"))?;
    let he = find_headers_end(&acc).ok_or_else(|| "HTTP 无头结束".to_string())?;
    let header_str = std::str::from_utf8(&acc[..he]).map_err(|_| "HTTP 头非 UTF-8".to_string())?;
    let status = parse_http_status(header_str)?;
    let body_start = he + 4;
    let body = if let Some(cl) = parse_content_length(header_str) {
        let end = body_start
            .checked_add(cl)
            .ok_or_else(|| "Content-Length 溢出".to_string())?;
        if acc.len() < end {
            return Err(format!("HTTP 体长度不足: 需要 {end} 实得 {}", acc.len()));
        }
        acc[body_start..end].to_vec()
    } else {
        acc[body_start..].to_vec()
    };
    Ok((status, body))
}

static LOG_LOCK: Mutex<()> = Mutex::new(());

/// PicoWeb 子进程 + 端口；全局一把锁，与 `spawn_blocking` 配合。
static PICO_WEB: Mutex<Option<PicoWebServer>> = Mutex::new(None);

struct PicoWebServer {
    child: Child,
    port: u16,
}

/// Tauri/Windows 常返回 `\\?\D:\...` 扩展路径；`java -jar` 对此前缀兼容差，会报无法打开 jar。
#[cfg(windows)]
fn strip_windows_verbatim_prefix(p: PathBuf) -> PathBuf {
    let Some(s) = p.to_str() else {
        return p;
    };
    let Some(rest) = s.strip_prefix(r"\\?\") else {
        return p;
    };
    if let Some(unc_rest) = rest.strip_prefix("UNC\\") {
        return PathBuf::from(format!(r"\\{unc_rest}"));
    }
    PathBuf::from(rest)
}

#[cfg(not(windows))]
fn strip_windows_verbatim_prefix(p: PathBuf) -> PathBuf {
    p
}

fn exe_dir_log_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .map(|d| d.join("notez-plantuml.log"))
}

/// 写入可执行文件同目录的 `notez-plantuml.log`（UTF-8 行）
pub fn plantuml_append_log_line(message: &str) {
    let Ok(_guard) = LOG_LOCK.lock() else {
        return;
    };
    let Some(path) = exe_dir_log_path() else {
        return;
    };
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("[{ts}] {message}\n");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

#[derive(Debug)]
pub struct PlantumlRuntimePaths {
    pub java: PathBuf,
    pub plantuml_jar: PathBuf,
    pub dot: PathBuf,
}

impl PlantumlRuntimePaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let res_dir = app
            .path()
            .resource_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|e| format!("(resource_dir 不可用: {e})"));

        plantuml_append_log_line(&format!(
            "PlantumlRuntimePaths::resolve resource_dir={res_dir}"
        ));

        let java = app
            .path()
            .resolve(
                if cfg!(windows) {
                    "resources/plantuml-runtime/jre/bin/java.exe"
                } else {
                    "resources/plantuml-runtime/jre/bin/java"
                },
                BaseDirectory::Resource,
            )
            .map_err(|e| {
                let m = format!("路径解析失败 (java): {e}");
                plantuml_append_log_line(&m);
                m
            })?;

        let plantuml_jar = app
            .path()
            .resolve(
                "resources/plantuml-runtime/plantuml.jar",
                BaseDirectory::Resource,
            )
            .map_err(|e| {
                let m = format!("路径解析失败 (plantuml.jar): {e}");
                plantuml_append_log_line(&m);
                m
            })?;

        let dot = app
            .path()
            .resolve(
                if cfg!(windows) {
                    "resources/plantuml-runtime/graphviz/bin/dot.exe"
                } else {
                    "resources/plantuml-runtime/graphviz/bin/dot"
                },
                BaseDirectory::Resource,
            )
            .map_err(|e| {
                let m = format!("路径解析失败 (dot): {e}");
                plantuml_append_log_line(&m);
                m
            })?;

        plantuml_append_log_line(&format!("java={}", java.display()));
        plantuml_append_log_line(&format!("plantuml.jar={}", plantuml_jar.display()));
        plantuml_append_log_line(&format!("dot={}", dot.display()));

        if !java.is_file() {
            let m = format!(
                "未找到 JRE 可执行文件: {} —— 请按 README 放置 jre",
                java.display()
            );
            plantuml_append_log_line(&m);
            return Err(m);
        }
        if !plantuml_jar.is_file() {
            let m = format!(
                "plantuml.jar 不是可读文件: {}（若为目录或占位符请换成真实 jar）",
                plantuml_jar.display()
            );
            plantuml_append_log_line(&m);
            return Err(m);
        }
        if !dot.is_file() {
            let m = format!("未找到 Graphviz dot 可执行文件: {}", dot.display());
            plantuml_append_log_line(&m);
            return Err(m);
        }

        plantuml_append_log_line("PlantumlRuntimePaths: 三项文件均存在");

        let java = strip_windows_verbatim_prefix(java);
        let plantuml_jar = strip_windows_verbatim_prefix(plantuml_jar);
        let dot = strip_windows_verbatim_prefix(dot);
        plantuml_append_log_line(&format!("normalized_java={}", java.display()));
        plantuml_append_log_line(&format!(
            "normalized_plantuml.jar={}",
            plantuml_jar.display()
        ));
        plantuml_append_log_line(&format!("normalized_dot={}", dot.display()));

        Ok(Self {
            java,
            plantuml_jar,
            dot,
        })
    }
}

fn pick_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("绑定 127.0.0.1:0 失败（选 PicoWeb 端口）: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn spawn_picoweb(paths: &PlantumlRuntimePaths, port: u16) -> Result<Child, String> {
    plantuml_append_log_line(&format!(
        "PicoWeb 启动 java -jar … -picoweb:{port}:127.0.0.1"
    ));

    let mut cmd = Command::new(&paths.java);
    cmd.arg("-Djava.awt.headless=true");
    match (paths.plantuml_jar.parent(), paths.plantuml_jar.file_name()) {
        (Some(jar_dir), Some(jar_name)) if !jar_dir.as_os_str().is_empty() => {
            cmd.current_dir(jar_dir);
            cmd.arg("-jar").arg(jar_name);
        }
        _ => {
            cmd.arg("-jar").arg(&paths.plantuml_jar);
        }
    }
    cmd.arg(format!("-picoweb:{port}:127.0.0.1"))
        .env("GRAPHVIZ_DOT", &paths.dot)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| {
        let m = format!("启动 PlantUML PicoWeb 失败: {e}");
        plantuml_append_log_line(&m);
        m
    })
}

/// 轮询 HTTP，直到 PicoWeb 能返回 200（或超时）。
fn wait_picoweb_http_ready(port: u16) -> Result<(), String> {
    let probe = "@startuml\n@enduml";
    let enc = encode_plantuml_deflate(probe).map_err(|e| format!("PicoWeb 探测编码失败: {e}"))?;
    let path = format!("/plantuml/svg/{enc}");
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if Instant::now() > deadline {
            return Err("PicoWeb 启动超时（90s 内未响应 HTTP）".to_string());
        }
        match http_get_localhost(port, &path, Duration::from_secs(2)) {
            Ok((200, _)) => {
                plantuml_append_log_line("PicoWeb HTTP 已就绪");
                return Ok(());
            }
            Ok((st, _)) => {
                plantuml_append_log_line(&format!("PicoWeb 探测 HTTP {st}，继续等待"));
            }
            Err(_) => {}
        }
        thread::sleep(Duration::from_millis(80));
    }
}

fn ensure_picoweb(paths: &PlantumlRuntimePaths) -> Result<u16, String> {
    let mut guard = PICO_WEB
        .lock()
        .map_err(|_| "plantuml PicoWeb 锁异常".to_string())?;

    if let Some(s) = guard.as_mut() {
        if s.child
            .try_wait()
            .map_err(|e| format!("try_wait: {e}"))?
            .is_none()
        {
            return Ok(s.port);
        }
        plantuml_append_log_line("PicoWeb 子进程已退出，正在重启");
        let _ = s.child.kill();
        *guard = None;
    }

    let port = pick_loopback_port()?;
    let child = spawn_picoweb(paths, port)?;
    wait_picoweb_http_ready(port)?;
    *guard = Some(PicoWebServer { child, port });
    Ok(port)
}

fn render_via_picoweb(port: u16, encoded: &str, format: &str) -> Result<Vec<u8>, String> {
    let kind = match format {
        "svg" => "svg",
        "png" => "png",
        other => {
            return Err(format!("不支持的 format: {other}"));
        }
    };
    let path = format!("/plantuml/{kind}/{encoded}");
    let (status, buf) = http_get_localhost(port, &path, Duration::from_secs(120))
        .map_err(|e| format!("PicoWeb HTTP: {e}"))?;
    if status != 200 {
        let preview = String::from_utf8_lossy(&buf[..buf.len().min(500)]);
        return Err(format!("PicoWeb HTTP 状态 {status}: {preview}"));
    }
    Ok(buf)
}

/// 单次 `-pipe` 子进程（JVM 冷启动），作回退路径。
fn render_plantuml_pipe_sync(
    paths: &PlantumlRuntimePaths,
    source: &str,
    format: &str,
) -> Result<Vec<u8>, String> {
    plantuml_append_log_line(&format!(
        "render_plantuml pipe 回退 format={format} source_len={}",
        source.len()
    ));

    let type_arg = match format {
        "svg" => "-tsvg",
        "png" => "-tpng",
        other => {
            let m = format!("不支持的 format: {other}（仅支持 svg / png）");
            plantuml_append_log_line(&m);
            return Err(m);
        }
    };

    let mut cmd = Command::new(&paths.java);
    match (paths.plantuml_jar.parent(), paths.plantuml_jar.file_name()) {
        (Some(jar_dir), Some(jar_name)) if !jar_dir.as_os_str().is_empty() => {
            cmd.current_dir(jar_dir);
            cmd.arg("-jar").arg(jar_name);
        }
        _ => {
            cmd.arg("-jar").arg(&paths.plantuml_jar);
        }
    }
    cmd.arg(type_arg)
        .arg("-pipe")
        .arg("-charset")
        .arg("UTF-8")
        .arg("-nometadata")
        .env("GRAPHVIZ_DOT", &paths.dot)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        let m = format!("启动 Java 失败: {e}");
        plantuml_append_log_line(&m);
        m
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(source.as_bytes()) {
            let m = format!("写入 PlantUML 源码失败: {e}");
            plantuml_append_log_line(&m);
            return Err(m);
        }
    }

    let output = child.wait_with_output().map_err(|e| {
        let m = format!("等待 PlantUML 结束失败: {e}");
        plantuml_append_log_line(&m);
        m
    })?;

    let stderr_lossy = String::from_utf8_lossy(&output.stderr);
    if !stderr_lossy.trim().is_empty() {
        let preview: String = stderr_lossy.chars().take(2000).collect();
        plantuml_append_log_line(&format!("pipe stderr: {preview}"));
    }

    if !output.status.success() {
        let m = format!("PlantUML 退出码 {:?}: {stderr_lossy}", output.status.code());
        plantuml_append_log_line(&format!("pipe 失败 {m}"));
        return Err(m);
    }

    if output.stdout.is_empty() {
        let m = format!("PlantUML 无输出: {stderr_lossy}");
        plantuml_append_log_line(&m);
        return Err(m);
    }

    plantuml_append_log_line(&format!("pipe 成功 stdout_len={}", output.stdout.len()));
    Ok(output.stdout)
}

/// 编码后路径过长时 Jetty/浏览器可能截断，直接 pipe。
const MAX_PICO_ENCODED_LEN: usize = 6000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlantumlRenderBackend {
    Jar,
    Rust,
}

fn parse_plantuml_backend(backend: Option<String>) -> Result<PlantumlRenderBackend, String> {
    let key = match backend {
        None => return Ok(PlantumlRenderBackend::Jar),
        Some(b) => b.trim().to_ascii_lowercase(),
    };
    if key.is_empty() {
        return Ok(PlantumlRenderBackend::Jar);
    }
    match key.as_str() {
        "jar" => Ok(PlantumlRenderBackend::Jar),
        "rust" => Ok(PlantumlRenderBackend::Rust),
        _ => Err(format!(
            "不支持的 PlantUML 后端: {key}（仅支持 jar / rust）"
        )),
    }
}

fn render_plantuml_rust_sync(source: &str, format: &str) -> Result<PlantumlLocalRenderResult, String> {
    let fmt = format.to_ascii_lowercase();
    if fmt != "svg" {
        return Err(format!(
            "Rust PlantUML 引擎目前仅支持 SVG 输出（收到 format={fmt}）"
        ));
    }
    plantuml_append_log_line(&format!(
        "render_plantuml_local Rust 路径 source_len={}",
        source.len()
    ));
    plantuml_native::try_render_rust_with_report(source)
        .map(|report| PlantumlLocalRenderResult {
            svg_bytes: report.svg.into_bytes(),
            warnings: report.warnings,
        })
        .map_err(|e| e.to_string())
}

/// JAR / PicoWeb 路径（与新增 `backend` 参数前的行为一致）。
///
/// `format`: `"svg"` 或 `"png"`（小写）
fn render_plantuml_jar_sync(
    app: AppHandle,
    source: String,
    format: String,
) -> Result<PlantumlLocalRenderResult, String> {
    let fmt = format.to_ascii_lowercase();
    plantuml_append_log_line(&format!(
        "render_plantuml_local 开始 format={fmt} source_len={}",
        source.len()
    ));

    let paths = match PlantumlRuntimePaths::resolve(&app) {
        Ok(p) => p,
        Err(e) => {
            plantuml_append_log_line(&format!("resolve 失败: {e}"));
            return Err(e);
        }
    };

    if fmt != "svg" && fmt != "png" {
        let m = format!("不支持的 format: {fmt}（仅支持 svg / png）");
        plantuml_append_log_line(&m);
        return Err(m);
    }

    let encoded = match encode_plantuml_deflate(&source) {
        Ok(e) => e,
        Err(e) => {
            plantuml_append_log_line(&format!("deflate 编码失败，回退 pipe: {e}"));
            return render_plantuml_pipe_sync(&paths, &source, &fmt).map(jar_output_only);
        }
    };

    if encoded.len() > MAX_PICO_ENCODED_LEN {
        plantuml_append_log_line(&format!(
            "编码长度 {} 超过 PicoWeb 安全阈值 {MAX_PICO_ENCODED_LEN}，使用 pipe",
            encoded.len()
        ));
        return render_plantuml_pipe_sync(&paths, &source, &fmt).map(jar_output_only);
    }

    let port_result = ensure_picoweb(&paths);
    match port_result {
        Ok(port) => match render_via_picoweb(port, &encoded, &fmt) {
            Ok(bytes) => {
                plantuml_append_log_line(&format!("PicoWeb 成功 body_len={}", bytes.len()));
                Ok(jar_output_only(bytes))
            }
            Err(e) => {
                plantuml_append_log_line(&format!("PicoWeb 渲染失败，回退 pipe: {e}"));
                {
                    let mut g = PICO_WEB.lock().map_err(|_| "锁异常".to_string())?;
                    if let Some(mut s) = g.take() {
                        let _ = s.child.kill();
                    }
                }
                render_plantuml_pipe_sync(&paths, &source, &fmt).map(jar_output_only)
            }
        },
        Err(e) => {
            plantuml_append_log_line(&format!("PicoWeb 启动失败，回退 pipe: {e}"));
            render_plantuml_pipe_sync(&paths, &source, &fmt).map(jar_output_only)
        }
    }
}

fn render_plantuml_local_sync(
    app: AppHandle,
    source: String,
    format: String,
    backend: Option<String>,
) -> Result<PlantumlLocalRenderResult, String> {
    match parse_plantuml_backend(backend)? {
        PlantumlRenderBackend::Jar => render_plantuml_jar_sync(app, source, format),
        PlantumlRenderBackend::Rust => render_plantuml_rust_sync(&source, &format),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn render_plantuml_local(
    app: AppHandle,
    source: String,
    format: String,
    backend: Option<String>,
) -> Result<PlantumlLocalRenderResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        render_plantuml_local_sync(app, source, format, backend)
    })
    .await
    .map_err(|e| format!("render_plantuml_local 线程: {e}"))?
}

#[tauri::command]
pub fn plantuml_runtime_available(app: AppHandle) -> bool {
    plantuml_append_log_line("plantuml_runtime_available 调用");
    let ok = PlantumlRuntimePaths::resolve(&app).is_ok();
    plantuml_append_log_line(&format!("plantuml_runtime_available => {ok}"));
    ok
}

/// 应用退出时结束 PicoWeb，避免遗留 java 进程。
pub fn shutdown_plantuml_picoweb() {
    let Ok(mut g) = PICO_WEB.lock() else {
        return;
    };
    if let Some(mut s) = g.take() {
        plantuml_append_log_line("shutdown_plantuml_picoweb: kill PicoWeb");
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
}

/// Rust 渲染路径行为（不依赖 `AppHandle` / JVM）。
#[cfg(test)]
mod rust_render_path_tests {
    use super::render_plantuml_rust_sync;
    #[test]
    fn rust_path_rejects_non_svg_format() {
        let err = render_plantuml_rust_sync("@startuml\n@enduml", "png").unwrap_err();
        assert!(
            err.contains("SVG") || err.contains("svg"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn rust_path_empty_sequence_renders_svg_bytes() {
        let out = render_plantuml_rust_sync("@startuml\n@enduml", "svg").unwrap();
        let text = String::from_utf8(out.svg_bytes).expect("utf8");
        assert!(text.contains("<svg"));
    }

    #[test]
    fn rust_path_forwards_forbidden_include() {
        let err =
            render_plantuml_rust_sync("!include x.puml\n@startuml\n@enduml", "svg").unwrap_err();
        assert!(
            err.contains("!include") || err.contains("include"),
            "unexpected message: {err}"
        );
    }
}

#[cfg(test)]
mod backend_parse_tests {
    use super::{parse_plantuml_backend, PlantumlRenderBackend};

    #[test]
    fn none_and_empty_mean_jar() {
        assert_eq!(
            parse_plantuml_backend(None).unwrap(),
            PlantumlRenderBackend::Jar
        );
        assert_eq!(
            parse_plantuml_backend(Some(String::new())).unwrap(),
            PlantumlRenderBackend::Jar
        );
        assert_eq!(
            parse_plantuml_backend(Some("   ".into())).unwrap(),
            PlantumlRenderBackend::Jar
        );
    }

    #[test]
    fn jar_rust_case_insensitive() {
        assert_eq!(
            parse_plantuml_backend(Some("JAR".into())).unwrap(),
            PlantumlRenderBackend::Jar
        );
        assert_eq!(
            parse_plantuml_backend(Some("Rust".into())).unwrap(),
            PlantumlRenderBackend::Rust
        );
    }

    #[test]
    fn unknown_backend_errors() {
        assert!(parse_plantuml_backend(Some("wasm".into())).is_err());
    }
}

#[cfg(test)]
mod encode_tests {
    use super::encode_plantuml_deflate;

    #[test]
    fn deflate_encoding_matches_plantuml_docs_example() {
        let s = "@startuml\nPUML -> RUST\n@enduml";
        let enc = encode_plantuml_deflate(s).expect("encode");
        assert_eq!(enc, "SoWkIImgAStDuGe8zVLHqBLJ20eD3k5oICrB0Ge20000");
    }
}
