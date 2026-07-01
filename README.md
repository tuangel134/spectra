# ⚡ Spectra

**The spec-driven AI coding agent for your terminal.**

Spectra fusiona lo mejor de dos mundos: la potencia agéntica de terminal de OpenCode con el desarrollo guiado por especificaciones de Kiro. Un agente que planifica en specs, ejecuta tareas en paralelo, y funciona con cualquier proveedor LLM — incluyendo tu suscripción de **OpenCode Zen**.

```
spectra:build › Create a REST endpoint for users

I'll add the endpoint following the existing pattern.
  ⚙ read src/api/index.ts
  ✓ read: import { Router } from "./router"
  ⚙ write src/api/users.ts
  ✓ write: Created src/api/users.ts (412 bytes)
  ⚙ bash npm test
  ✓ bash: PASS  12 passing

Done. Added GET/POST /users with validation and tests.

  2 file(s) changed · 3 tool call(s)
```

## Estado del proyecto

Esto es una implementación **funcional y verificada**, no una maqueta. Incluye:

- ✅ Carga de configuración JSONC con merge multi-fuente y substitución de variables
- ✅ Resolución de proveedores (OpenCode Zen, Anthropic, OpenAI, Google, Ollama, custom base URL)
- ✅ Agent loop real con tool-calling (Anthropic Messages API + OpenAI Chat Completions)
- ✅ Herramientas: `read`, `write`, `edit`, `bash`, `grep`, `glob`, `webfetch`
- ✅ Sistema de permisos granular (allow/ask/deny con patrones por comando)
- ✅ Spec engine: parser de tasks, grafo de dependencias, ejecución en waves paralelas
- ✅ Sistema de hooks event-driven
- ✅ Sesiones con snapshots y undo
- ✅ Servidor HTTP API
- ✅ TUI interactiva (REPL) y CLI no-interactivo
- ✅ 277 tests automatizados (unitarios + integración end-to-end)

## Requisitos

- Node.js >= 20
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) recomendado para `grep`/`glob`

## Instalación

```bash
git clone <repo> spectra
cd spectra
npm install        # compila automáticamente (script prepare)

# Deja el comando `spectra` disponible globalmente:
npm link
# o, sin permisos de root:
ln -sf "$(pwd)/dist/cli.js" ~/.local/bin/spectra
```

## Uso

Spectra tiene tres formas de uso, todas sobre el mismo motor:

```bash
spectra            # 1. TUI interactiva a pantalla completa (terminal)
spectra desktop    # 2. App nativa de escritorio (ventana propia, WebView del SO)
spectra web        # 3. Interfaz web en el navegador
```

La primera vez no te pide nada: arranca con un **modelo gratuito** (`free/deepseek-v4-flash-free`) que funciona **sin API key**. Usa `/connect` (o el selector de modelos) cuando quieras añadir OpenCode Zen, Go, Anthropic, OpenAI, Ollama o una API custom.

## Usar con OpenCode Zen

Spectra es compatible con OpenCode Zen y enruta automáticamente cada modelo al endpoint correcto:

| Familia de modelo | Endpoint | SDK |
|---|---|---|
| `claude*`, `qwen*` | `/zen/v1/messages` | Anthropic |
| `gpt*` | `/zen/v1/responses` | OpenAI |
| resto (gemini, deepseek, glm, minimax…) | `/zen/v1/chat/completions` | OpenAI-compatible |

```jsonc
// spectra.jsonc
{
  "model": "opencode/claude-opus-4-8",
  "provider": {
    "opencode": {
      "options": { "apiKey": "{env:OPENCODE_API_KEY}" }
    }
  }
}
```

### API custom / Base URL

```jsonc
{
  "model": "my-api/custom-model",
  "provider": {
    "my-api": {
      "sdk": "openai-compatible",
      "baseURL": "https://tu-host.com/v1",
      "options": { "apiKey": "{env:MY_API_KEY}" }
    }
  }
}
```

## Comandos CLI

```bash
spectra                  # Lanza la TUI interactiva
spectra run "<prompt>"   # Ejecución one-shot no interactiva
spectra spec "<desc>"    # Genera requirements + design + tasks
spectra run-spec <id>    # Ejecuta las tareas de un spec
spectra serve            # Servidor HTTP API (puerto 4096)
spectra models           # Lista proveedores y modelos configurados
spectra agent            # Lista agentes disponibles
spectra init             # Inicializa .spectra/ en el proyecto
spectra --help           # Ayuda
```

## Comandos de la TUI

| Comando | Acción |
|---|---|
| `/help` | Muestra la ayuda |
| `/agent [id]` | Lista agentes o cambia a uno |
| `/tab` | Cicla al siguiente agente primario |
| `/spec <desc>` | Ejecuta el workflow spec-driven |
| `/models` | Lista proveedores y modelos |
| `/sessions` | Lista las sesiones de la ejecución |
| `/undo` | Revierte el último set de cambios |
| `/clear` | Inicia una sesión nueva |
| `/exit` | Salir |

## Spec-Driven Development

El comando `/spec` (o `spectra spec`) genera tres documentos:

1. **requirements.md** — User stories + criterios de aceptación
2. **design.md** — Arquitectura + diagramas de secuencia + estrategia de tests
3. **tasks.md** — Tareas atómicas con dependencias explícitas

Luego `spectra run-spec <id>` construye un **grafo de dependencias**, agrupa las tareas en **waves** (olas) y ejecuta en paralelo las que no dependen entre sí:

```
Wave 1: #1, #2        (sin dependencias, en paralelo)
Wave 2: #3, #4        (dependen de wave 1)
Wave 3: #5            (depende de #3 y #4)
```

## Agentes

| Agente | Modo | Función |
|---|---|---|
| `build` | primary | Desarrollo con acceso completo |
| `plan` | primary | Análisis read-only sin modificaciones |
| `spec` | primary | Genera y ejecuta especificaciones |
| `review` | subagent | Code review sin ediciones |
| `explore` | subagent | Exploración rápida del codebase |

Define agentes custom en `.spectra/agents/*.md`:

```markdown
---
description: Audita seguridad sin hacer cambios
mode: subagent
model: opencode/claude-opus-4-8
permission:
  edit: deny
  bash: deny
---

Eres un auditor de seguridad. Busca vulnerabilidades OWASP Top 10.
```

## Hooks

Automatizaciones event-driven en `.spectra/hooks/*.json`:

```json
{
  "name": "Lint on Save",
  "version": "1.0.0",
  "when": { "type": "fileEdited", "patterns": ["*.ts"] },
  "then": { "type": "runCommand", "command": "npm run lint" }
}
```

Eventos: `fileEdited`, `fileCreated`, `fileDeleted`, `promptSubmit`, `agentStop`, `preToolUse`, `postToolUse`, `preTaskExecution`, `postTaskExecution`, `userTriggered`.

## Permisos

```jsonc
{
  "permission": {
    "edit": "allow",
    "bash": {
      "*": "allow",
      "npm test*": "allow",
      "rm -rf *": "deny",
      "git push*": "ask"
    }
  }
}
```

Niveles: `allow` (sin aprobación), `ask` (pide confirmación), `deny` (bloqueado). La última regla que coincide gana.

## Arquitectura

```
spectra/
├── src/
│   ├── cli.ts              # Entry point del CLI
│   ├── index.ts            # API pública para embeber Spectra
│   ├── runtime.ts          # Ensambla todos los subsistemas
│   ├── config/             # Carga y merge de configuración JSONC
│   ├── provider/           # Clientes LLM (anthropic, openai, zen, registry)
│   ├── agent/              # Definiciones de agentes y registry
│   ├── tool/               # Herramientas: read, write, edit, bash, grep, glob, webfetch
│   ├── permission/         # Evaluación de permisos
│   ├── session/            # Sesiones, snapshots y el agent loop
│   ├── spec/               # Spec engine: parser, grafo, ejecución en waves
│   ├── hook/               # Sistema de hooks event-driven
│   ├── server/             # Servidor HTTP API (node:http)
│   ├── tui/                # REPL interactivo
│   ├── workflow/           # Spec workflow y undo
│   └── util/               # Logger, glob, ids
├── test/                   # 277 tests (node:test)
└── spectra.example.jsonc   # Config de referencia
```

## Servidor HTTP

```bash
spectra serve
```

| Endpoint | Método | Descripción |
|---|---|---|
| `/health` | GET | Estado del servidor |
| `/api/agents` | GET | Lista de agentes |
| `/api/tools` | GET | Herramientas disponibles |
| `/api/models` | GET | Proveedores y modelos |
| `/api/hooks` | GET | Hooks cargados |
| `/api/sessions` | GET/POST | Listar / crear sesiones |
| `/api/sessions/:id` | GET | Detalle de sesión |

## Desarrollo

```bash
npm run build       # Compila a dist/
npm run typecheck   # Type-check sin emitir
npm test            # Ejecuta los 277 tests
npm run dev -- ...  # Ejecuta desde TypeScript sin compilar
```

## Licencia

MIT

---

**Spectra** — Piensa en specs. Ejecuta en paralelo. Desde tu terminal. ⚡
