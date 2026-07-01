/**
 * Shell completion scripts for the `spectra` command.
 *
 * `spectra completion <bash|zsh|fish|powershell>` prints a script the user can
 * source (or install) to get tab-completion for subcommands.
 */

/** Top-level subcommands offered for completion. */
export const COMMANDS = [
  "run",
  "spec",
  "run-spec",
  "serve",
  "web",
  "desktop",
  "ops",
  "fix",
  "doctor",
  "update",
  "models",
  "agent",
  "auth",
  "eval",
  "bench",
  "freebuff",
  "init",
  "acp",
  "completion",
]

export type CompletionShell = "bash" | "zsh" | "fish" | "powershell"

/** Return the completion script for the given shell, or null if unsupported. */
export function completionScript(shell: string): string | null {
  const cmds = COMMANDS.join(" ")
  switch (shell) {
    case "bash":
      return `# spectra bash completion — add to ~/.bashrc:
#   source <(spectra completion bash)
_spectra_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${cmds} --help --version --new" -- "\$cur") )
  fi
}
complete -F _spectra_complete spectra
`
    case "zsh":
      return `# spectra zsh completion — add to ~/.zshrc:
#   source <(spectra completion zsh)
_spectra() {
  local -a cmds
  cmds=(${COMMANDS.map((c) => `'${c}'`).join(" ")} '--help' '--version' '--new')
  _describe 'spectra command' cmds
}
compdef _spectra spectra
`
    case "fish":
      return `# spectra fish completion — install with:
#   spectra completion fish > ~/.config/fish/completions/spectra.fish
${COMMANDS.map((c) => `complete -c spectra -n __fish_use_subcommand -a ${c}`).join("\n")}
complete -c spectra -l help
complete -c spectra -l version
complete -c spectra -l new
`
    case "powershell":
    case "pwsh":
      return `# spectra PowerShell completion — add to your $PROFILE:
#   spectra completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName spectra -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  @(${COMMANDS.map((c) => `'${c}'`).join(", ")}, '--help', '--version', '--new') |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`
    default:
      return null
  }
}
