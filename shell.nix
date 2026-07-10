{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    # Rust/Tauri tooling
    cargo
    rustc
    rustfmt
    clippy
    rust-analyzer
    pkg-config
    # Native Linux dependencies used by Tauri/WebKitGTK.
    at-spi2-atk
    cairo
    curl
    bun
    dbus
    gdk-pixbuf
    glib
    gst_all_1.gstreamer
    gst_all_1.gst-plugins-base
    gst_all_1.gst-plugins-good
    gst_all_1.gst-plugins-bad
    gst_all_1.gst-libav
    gtk3
    harfbuzz
    libayatana-appindicator
    librsvg
    libsoup_3
    openssl
    pango
    webkitgtk_4_1
    wget
  ];

  shellHook = ''
    export PATH="${pkgs.cargo}/bin:${pkgs.rustc}/bin:${pkgs.rustfmt}/bin:${pkgs.clippy}/bin:$PATH"
    export RUST_SRC_PATH="${pkgs.rustPlatform.rustLibSrc}"

    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
      pkgs.at-spi2-atk
      pkgs.cairo
      pkgs.dbus
      pkgs.gdk-pixbuf
      pkgs.glib
      pkgs.gst_all_1.gstreamer
      pkgs.gst_all_1.gst-plugins-base
      pkgs.gst_all_1.gst-plugins-good
      pkgs.gst_all_1.gst-plugins-bad
      pkgs.gst_all_1.gst-libav
      pkgs.gtk3
      pkgs.harfbuzz
      pkgs.libayatana-appindicator
      pkgs.librsvg
      pkgs.libsoup_3
      pkgs.openssl
      pkgs.pango
      pkgs.webkitgtk_4_1
    ]}:$LD_LIBRARY_PATH"

    export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPath "lib/pkgconfig" [
      pkgs.at-spi2-atk
      pkgs.cairo
      pkgs.dbus
      pkgs.gdk-pixbuf
      pkgs.glib
      pkgs.gst_all_1.gstreamer
      pkgs.gst_all_1.gst-plugins-base
      pkgs.gst_all_1.gst-plugins-good
      pkgs.gst_all_1.gst-plugins-bad
      pkgs.gst_all_1.gst-libav
      pkgs.gtk3
      pkgs.harfbuzz
      pkgs.libayatana-appindicator
      pkgs.librsvg
      pkgs.libsoup_3
      pkgs.openssl
      pkgs.pango
      pkgs.webkitgtk_4_1
    ]}:$PKG_CONFIG_PATH"

    export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.lib.makeSearchPath "lib/gstreamer-1.0" [
      pkgs.gst_all_1.gst-plugins-base
      pkgs.gst_all_1.gst-plugins-good
      pkgs.gst_all_1.gst-plugins-bad
      pkgs.gst_all_1.gst-libav
    ]}:$GST_PLUGIN_SYSTEM_PATH_1_0"

    export GDK_BACKEND=x11
    export WEBKIT_DISABLE_DMABUF_RENDERER=1

    echo "Tauri dev shell ready. Run: bun install && bun run tauri dev"
  '';
}
