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
          gsettingsSchemaPath = pkgs.lib.concatStringsSep ":" [
            "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}"
            "${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}"
          ];
          runtimeLibraries = with pkgs; [
            alsa-lib
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
            packages =
              (with pkgs; [
                alsa-lib.dev
                curl
                file
                gcc
                glib.dev
                gsettings-desktop-schemas
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
              ]);

            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath runtimeLibraries;
            shellHook = ''
              export VOICEPASTE_REAL_PKG_CONFIG="${pkgs.pkg-config}/bin/pkg-config"
              export PATH="$PWD/tools:$PATH"
              export XDG_DATA_DIRS="${gsettingsSchemaPath}:''${XDG_DATA_DIRS:-}"
            '';
          };
        }
      );
    };
}
