use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    thread,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;

pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedTerminal {
    session_id: String,
    shell: String,
    cwd: String,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 500),
        cols: cols.clamp(2, 500),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> CommandResult<StartedTerminal> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())?;
    let cwd = cwd.map(PathBuf::from).unwrap_or(home);
    if !cwd.is_dir() {
        return Err(format!(
            "Terminal directory does not exist: {}",
            cwd.display()
        ));
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let pair = native_pty_system()
        .openpty(terminal_size(cols, rows))
        .map_err(|error| format!("Could not create terminal: {error}"))?;
    let mut command = CommandBuilder::new(&shell);
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not start {shell}: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not open terminal input: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not open terminal output: {error}"))?;
    let session_id = format!("terminal_{}", Uuid::new_v4().simple());

    state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?
        .insert(
            session_id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                child,
            },
        );

    stream_output(app, session_id.clone(), reader);
    Ok(StartedTerminal {
        session_id,
        shell,
        cwd: cwd.to_string_lossy().into_owned(),
    })
}

fn stream_output(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    thread::Builder::new()
        .name(format!("figmaboy-{session_id}"))
        .spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        let _ = app.emit(
                            "terminal-output",
                            TerminalOutput {
                                session_id: session_id.clone(),
                                data: BASE64.encode(&buffer[..read]),
                            },
                        );
                    }
                }
            }
            let _ = app.emit("terminal-exit", TerminalExit { session_id });
        })
        .ok();
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> CommandResult<()> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Terminal session no longer exists".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| format!("Could not write to terminal: {error}"))
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Terminal session no longer exists".to_string())?;
    session
        .master
        .resize(terminal_size(cols, rows))
        .map_err(|error| format!("Could not resize terminal: {error}"))
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalState>, session_id: String) -> CommandResult<()> {
    let mut session = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?
        .remove(&session_id)
        .ok_or_else(|| "Terminal session no longer exists".to_string())?;
    session
        .child
        .kill()
        .map_err(|error| format!("Could not close terminal: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_dimensions_are_bounded() {
        assert_eq!(terminal_size(0, 900).cols, 2);
        assert_eq!(terminal_size(0, 900).rows, 500);
    }

    #[test]
    fn pty_accepts_input_and_streams_output() {
        let pair = native_pty_system().openpty(terminal_size(80, 24)).unwrap();
        let mut child = pair
            .slave
            .spawn_command(CommandBuilder::new("/bin/sh"))
            .unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer
            .write_all(b"printf FIGMABOY_PTY_OK\\n\nexit\n")
            .unwrap();
        writer.flush().unwrap();
        drop(writer);
        drop(pair.slave);

        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();
        child.wait().unwrap();
        assert!(output.contains("FIGMABOY_PTY_OK"));
    }
}
