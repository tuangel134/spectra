# Instalación de Spectra 1.0

## CachyOS / Arch Linux

```fish
sudo pacman -S --needed git nodejs npm ripgrep
curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash
fish_add_path ~/.local/bin
spectra doctor
```

### Desktop nativo desde código

```fish
cd ~/.local/share/spectra
npm run desktop:build
spectra desktop
```

La compilación requiere Rust, Cargo, GTK3 y WebKitGTK 4.1. En CachyOS:

```fish
sudo pacman -S --needed base-devel rust cargo gtk3 webkit2gtk-4.1
```

## Linux/macOS con Bash o Zsh

```bash
curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
spectra doctor
spectra desktop
```

## Windows

```powershell
irm https://raw.githubusercontent.com/tuangel134/spectra/main/install.ps1 | iex
spectra doctor
spectra desktop
```

## Ubicaciones

| Elemento | Linux/macOS |
|---|---|
| Aplicación | `~/.local/share/spectra` |
| Comando | `~/.local/bin/spectra` |
| Configuración | `~/.config/spectra` o `$XDG_CONFIG_HOME/spectra` |
| Estado del Core | directorio de estado de Spectra fuera del repositorio |

## Actualizar

```bash
spectra update
```

También puedes ejecutar nuevamente el instalador. La instalación es transaccional y restaura la versión anterior si falla una puerta de validación.

## Desinstalar una instalación desde código

```bash
rm -rf ~/.local/share/spectra
rm -f ~/.local/bin/spectra
```

Los perfiles, configuración y secretos se conservan. Elimínalos manualmente solo cuando quieras borrar también tus ajustes.
