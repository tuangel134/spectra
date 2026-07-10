import { UserAdaptationStore, recommendationsFor } from "./profile.js"
import { detectLocalRuntimes } from "./local-models.js"
import { probeOpenAICompatible } from "./model-probe.js"
import { scanEcosystem } from "./ecosystem.js"
import type { ModelProbeInput } from "./types.js"

export class AdaptationService {
  readonly profiles: UserAdaptationStore
  constructor(readonly projectRoot: string, profileFile?: string) {
    this.profiles = new UserAdaptationStore(profileFile)
  }
  dashboard(): Record<string, unknown> {
    const profile = this.profiles.load()
    return { profile, recommendations: recommendationsFor(profile), ecosystem: scanEcosystem(this.projectRoot) }
  }
  localModels() { return detectLocalRuntimes() }
  probe(input: ModelProbeInput) { return probeOpenAICompatible(input) }
}

const services = new Map<string, AdaptationService>()
export function adaptationFor(projectRoot: string): AdaptationService {
  let service = services.get(projectRoot)
  if (!service) { service = new AdaptationService(projectRoot); services.set(projectRoot, service) }
  return service
}
