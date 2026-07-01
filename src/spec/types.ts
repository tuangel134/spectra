export type SpecType = "feature" | "bugfix"

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped"

export interface Task {
  id: number
  title: string
  description: string
  status: TaskStatus
  dependencies: number[]
  files: string[]
  validation: string
}

export interface Wave {
  number: number
  tasks: Task[]
}

export interface SpecMeta {
  id: string
  title: string
  type: SpecType
  createdAt: string
}
