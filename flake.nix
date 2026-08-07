{
  description = "VoicePaste Tauri development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ];
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          runtimeLibraries = with pkgs; [
            atk
            cairo
            dbus
            gdk-pixbuf
            glib
            gtk3
            libayatana-appindicator
            librsvg
            libsoup_3
            libxkbcommon
            openssl
            pango
            webkitgtk_4_1
          ];
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              curl
              file
              gcc
              glib.dev
              gtk3.dev
              libayatana-appindicator.dev
              librsvg.dev
              libsoup_3.dev
              libxkbcommon.dev
              mise
              openssl.dev
              pkg-config
              webkitgtk_4_1.dev
              wget
            ];

            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath runtimeLibraries;
          };
        }
      );
    };
}
