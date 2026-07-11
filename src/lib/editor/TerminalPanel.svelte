<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { FitAddon } from "@xterm/addon-fit";
  import { Terminal } from "@xterm/xterm";
  import "@xterm/xterm/css/xterm.css";
  import { Eraser, TerminalSquare, X } from "lucide-svelte";

  let { onClose }: { onClose: () => void } = $props();
  let host: HTMLDivElement;
  let shellName = $state("Terminal");
  let cwd = $state("");
  let error = $state("");
  let clearTerminal = $state<() => void>(() => {});

  type StartedTerminal = { sessionId: string; shell: string; cwd: string };
  type TerminalOutput = { sessionId: string; data: string };
  type TerminalExit = { sessionId: string };

  onMount(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: "#1e1e1e",
        foreground: "#e7e7e7",
        cursor: "#f4f4f5",
        selectionBackground: "#0d99ff66",
        black: "#252525",
        brightBlack: "#737373",
        blue: "#0d99ff",
        brightBlue: "#60b9ff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    clearTerminal = () => terminal.clear();

    let sessionId = "";
    let disposed = false;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const decoder = (encoded: string) => Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));

    const removeOutput = listen<TerminalOutput>("terminal-output", ({ payload }) => {
      if (payload.sessionId === sessionId) terminal.write(decoder(payload.data));
    });
    const removeExit = listen<TerminalExit>("terminal-exit", ({ payload }) => {
      if (payload.sessionId === sessionId) terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
    });

    const resize = () => {
      if (host.clientWidth < 20 || host.clientHeight < 20) return;
      fit.fit();
      if (!sessionId) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        void invoke("terminal_resize", { sessionId, cols: terminal.cols, rows: terminal.rows });
      }, 50);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const dataDisposable = terminal.onData((data) => {
      if (sessionId) void invoke("terminal_write", { sessionId, data });
    });

    requestAnimationFrame(async () => {
      try {
        fit.fit();
        const started = await invoke<StartedTerminal>("terminal_start", {
          cols: terminal.cols,
          rows: terminal.rows,
          cwd: null,
        });
        if (disposed) {
          await invoke("terminal_close", { sessionId: started.sessionId }).catch(() => undefined);
          return;
        }
        sessionId = started.sessionId;
        shellName = started.shell.split("/").pop() || "Terminal";
        cwd = started.cwd;
        terminal.focus();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    });

    return () => {
      disposed = true;
      observer.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      if (resizeTimer) clearTimeout(resizeTimer);
      void removeOutput.then((remove) => remove());
      void removeExit.then((remove) => remove());
      if (sessionId) void invoke("terminal_close", { sessionId }).catch(() => undefined);
    };
  });
</script>

<section class="terminal-panel" aria-label="Integrated terminal">
  <header>
    <div class="terminal-title"><TerminalSquare size={14} /><strong>{shellName}</strong>{#if cwd}<span title={cwd}>{cwd}</span>{/if}</div>
    <button title="Clear terminal" onclick={clearTerminal}><Eraser size={14} /></button>
    <button title="Close terminal" onclick={onClose}><X size={15} /></button>
  </header>
  {#if error}<div class="terminal-error">Could not start terminal: {error}</div>{/if}
  <div class="terminal-host" bind:this={host}></div>
</section>

<style>
  .terminal-panel { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; background: #1e1e1e; border-top: 1px solid #4a4a4a; color: #ddd; }
  header { height: 35px; flex: 0 0 35px; display: flex; align-items: center; gap: 3px; padding: 0 7px 0 11px; background: #252525; border-bottom: 1px solid #343434; }
  .terminal-title { min-width: 0; flex: 1; display: flex; align-items: center; gap: 7px; }.terminal-title strong { font-size: 10px; text-transform: capitalize; }.terminal-title span { color: #777; font-size: 9px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  button { width: 28px; height: 27px; border: 0; border-radius: 5px; display: grid; place-items: center; background: transparent; color: #aaa; cursor: pointer; } button:hover { color: white; background: #3a3a3a; }
  .terminal-host { flex: 1; min-height: 0; padding: 8px 6px 14px 10px; user-select: text; }
  .terminal-host :global(.xterm), .terminal-host :global(.xterm-screen) { height: 100%; }
  .terminal-error { padding: 9px 12px; color: #fca5a5; background: #351f1f; border-bottom: 1px solid #633; font-size: 10px; }
</style>
