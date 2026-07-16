# ⚡ Spectra

**Agent-first IDE y agente de programación por IA guiado por especificaciones.**

Spectra combina una TUI potente, un IDE de escritorio, un Core persistente, ejecución multiagente aislada y compatibilidad con modelos cloud o locales. Puede analizar proyectos, diseñar soluciones, editar código, ejecutar comandos, validar resultados y recuperar el trabajo después de un cierre inesperado.

[![Version](https://img.shields.io/badge/version-1.0.0-7c5cff)](https://github.com/tuangel134/spectra/releases/tag/v1.0.0)
[![Production CI](https://github.com/tuangel134/spectra/actions/workflows/production-ci.yml/badge.svg)](https://github.com/tuangel134/spectra/actions/workflows/production-ci.yml)
[![CodeQL](https://github.com/tuangel134/spectra/actions/workflows/codeql.yml/badge.svg)](https://github.com/tuangel134/spectra/actions/workflows/codeql.yml)
[![Tests](https://img.shields.io/badge/tests-393%20passing-success)](test)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](package.json)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

## Spectra 1.0

La versión 1.0 integra seis capas de producto:

1. **Seguridad de escritorio:** perfiles Safe, Balanced, Autonomous y Unrestricted, Workspace Trust y controles contra acciones destructivas.
2. **Core persistente:** daemon por proyecto, estado durable, reconexión automática y recuperación de sesiones.
3. **Desktop IDE:** explorador, pestañas, editor, terminal, Git, diffs, problemas LSP, specs visuales y chat del agente.
4. **Multiagentes aislados:** ramas y worktrees independientes, locks de archivos, revisión de alcance, integración y rollback.
5. **Adaptación al usuario:** onboarding, niveles de experiencia, accesibilidad, idiomas, presupuestos, Model Lab y detección de modelos locales.
6. **Producción:** secretos protegidos, actualizaciones firmadas, crash recovery, E2E, estrés, presupuestos de rendimiento, SBOM y paquetes multiplataforma.

## Capacidades principales

| Área | Capacidades |
|---|---|
| Agente | Chat, planificación, edición, depuración, refactor, revisión, operaciones del sistema y ejecución prolongada |
| Specs | `requirements.md`, `design.md`, `tasks.md`, dependencias y waves paralelas |
| IDE | Explorador, editor con pestañas, terminal, Git, diffs, LSP, Problems, logs y panel visual de specs |
| Multiagente | Worktrees aislados, file locks, revisión de alcance, cherry-pick seguro y rollback |
| Modelos | OpenAI, Anthropic, Gemini, OpenRouter, Groq, Cerebras, Mistral, DeepSeek, xAI, Ollama y endpoints OpenAI-compatible |
| Compatibilidad | Skills, comandos, agentes, plugins y MCP de Spectra y Claude Code |
| Seguridad | Workspace Trust, perfiles, permisos por herramienta, secretos en keychain o fallback AES-256-GCM |
| Recuperación | Core persistente, journal, checkpoints, sesiones reanudables y detección de cierres inesperados |

## Requisitos

- Linux, macOS o Windows 10/11.
- Node.js 20 o superior para la instalación desde código.
- Git.
- `ripgrep` recomendado.
- Rust solo es necesario para compilar localmente la ventana nativa.

## Instalación

### Linux y macOS

```bash
curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash
```

El instalador valida la nueva versión antes de reemplazar la instalación anterior y deja Spectra en:

```text
~/.local/share/spectra
~/.local/bin/spectra
```

### CachyOS / Arch Linux con fish

```fish
sudo pacman -S --needed git nodejs npm ripgrep
curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash
fish_add_path ~/.local/bin
spectra doctor
```

Para compilar la ventana nativa localmente:

```fish
cd ~/.local/share/spectra
npm run desktop:build
spectra desktop
```

Si ya compilaste Desktop durante el desarrollo, normalmente las dependencias WebKitGTK y Rust ya están instaladas.

### Bash o Zsh

Cuando `~/.local/bin` todavía no esté en el `PATH`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"
```

En Zsh cambia `.bashrc` por `.zshrc`.

### Windows

Abre PowerShell:

```powershell
irm https://raw.githubusercontent.com/tuangel134/spectra/main/install.ps1 | iex
spectra doctor
spectra desktop
```

### Instaladores del release

El workflow de release genera los siguientes formatos cuando termina:

- Linux: AppImage, DEB y paquete Pacman para Arch/CachyOS.
- Windows: MSI/WiX y NSIS.
- macOS: aplicación y DMG para Apple Silicon e Intel.

Los artefactos se publican en [GitHub Releases](https://github.com/tuangel134/spectra/releases/tag/v1.0.0) junto con checksums, manifiesto firmado, SBOM y firmas Sigstore.

## Primer inicio

```bash
spectra doctor
spectra desktop
```

Desktop abre el onboarding para seleccionar idioma, experiencia, autonomía, privacidad, estrategia de modelos, accesibilidad y límites de costo. Spectra puede iniciar con un modelo gratuito; los proveedores adicionales se configuran desde **Model Lab** o con `/connect`.

También están disponibles:

```bash
spectra          # TUI interactiva
spectra web      # Interfaz web
spectra desktop  # IDE de escritorio
```

## Comandos útiles

```bash
spectra run "corrige este proyecto y ejecuta sus pruebas"
spectra spec "construye una API con autenticación"
spectra run-spec <spec-id>
spectra doctor
spectra models
spectra agent
spectra eval
spectra core status
spectra core restart
spectra update
spectra --help
```

## Desktop IDE

Spectra Desktop es la interfaz principal. Incluye:

- Explorador de archivos protegido contra escapes del workspace.
- Editor con pestañas y guardado atómico.
- Terminal integrada bajo los perfiles de seguridad.
- Git status, diffs y cambios pendientes.
- Diagnósticos LSP y panel Problems.
- Specs visuales y edición de requirements, design y tasks.
- Panel de multiagentes aislados.
- Model Lab y centro de skills, agentes, plugins y MCP.
- Estado del Core, recuperación y production readiness.

Consulta [Desktop IDE](docs/DESKTOP_IDE.md) y [Adaptive Desktop](docs/ADAPTIVE_DESKTOP.md).

## Core persistente

Cada proyecto utiliza un Core independiente. Cerrar la ventana no destruye el runtime; al abrirla de nuevo, Desktop se reconecta al mismo proyecto y recupera el trabajo disponible.

```bash
spectra core status
spectra core stop
spectra core restart
```

Consulta [Core architecture](docs/CORE_ARCHITECTURE.md).

## Multiagentes aislados

Las tareas independientes pueden ejecutarse en paralelo dentro de ramas y worktrees separados. Spectra:

- declara y bloquea los archivos de cada tarea;
- serializa tareas que se superponen;
- rechaza cambios fuera del alcance;
- valida cada worktree antes del commit;
- integra mediante cherry-pick;
- aborta conflictos y revierte una integración defectuosa.

Consulta [Multiagent isolation](docs/MULTIAGENT_ISOLATION.md).

## Modelos y proveedores

Spectra soporta proveedores directos, modelos locales y cualquier servidor compatible con la API de OpenAI.

```jsonc
{
  "model": "mi-proveedor/mi-modelo",
  "provider": {
    "mi-proveedor": {
      "sdk": "openai-compatible",
      "baseURL": "https://servidor.example/v1",
      "options": {
        "apiKey": "{secret:provider:mi-proveedor}"
      }
    }
  }
}
```

Model Lab normaliza URLs copiadas con `/models`, `/chat/completions` o `/responses`, descubre modelos y puede comprobar tool calling y salida estructurada. También detecta Ollama, LM Studio, llama.cpp y vLLM en loopback.

## Seguridad

- Los proyectos con hooks, plugins o MCP ejecutables requieren Workspace Trust.
- Las API keys no se guardan en texto plano dentro de la configuración.
- Se usa Keychain, DPAPI o Secret Service cuando están disponibles.
- El fallback portátil cifra cada secreto mediante AES-256-GCM.
- Los manifiestos de actualización están firmados con Ed25519.
- Cada artefacto se valida por tamaño y SHA-256 antes de activarse.
- Las acciones privilegiadas o destructivas conservan gates obligatorios.

Consulta [SECURITY.md](SECURITY.md) y [Production 1.0](docs/PRODUCTION_1_0.md).

## Actualización y rollback

```bash
spectra update
```

La actualización desde Git es transaccional: compila y valida la nueva revisión antes de activarla. Las instalaciones empaquetadas comprueban el manifiesto firmado, tamaño y checksum. Si una puerta falla, Spectra mantiene o restaura la versión anterior.

Para reinstalar la versión actual desde `main`:

```bash
curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash
```

## Calidad

Spectra 1.0 se publicó con:

- 393 pruebas unitarias y de integración aprobadas.
- E2E del Core y Desktop.
- Pruebas de estrés de estado, locks y recuperación.
- Auditoría de secretos y recursos remotos.
- Presupuesto de rendimiento.
- `cargo check`, Clippy y rustfmt para Desktop.
- CI en Linux, Windows y macOS con Node.js 20 y 22.
- CodeQL, SBOM SPDX, checksums, Sigstore y build provenance.

## Desarrollo

```bash
git clone https://github.com/tuangel134/spectra.git
cd spectra
npm ci
npm run build
npm run typecheck
npm test
npm run audit:production
npm run test:e2e
npm run test:stress
npm run test:performance
```

Para Desktop nativo:

```bash
npm run desktop:build
```

## Documentación

- [Producción 1.0](docs/PRODUCTION_1_0.md)
- [Arquitectura del Core](docs/CORE_ARCHITECTURE.md)
- [Desktop IDE](docs/DESKTOP_IDE.md)
- [Multiagentes](docs/MULTIAGENT_ISOLATION.md)
- [Perfiles adaptativos](docs/ADAPTIVE_DESKTOP.md)
- [Proceso de release](docs/RELEASING.md)

## Autor y licencia

Creado por [Angel Collazo](https://github.com/tuangel134). Publicado bajo licencia [MIT](LICENSE).

---

**Spectra — del prompt a una implementación validada, recuperable y lista para producción.**
