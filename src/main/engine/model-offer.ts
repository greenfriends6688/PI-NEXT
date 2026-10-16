import type { ProviderModel } from "../../shared/types.ts";

/**
 * Whether one stored model is offered at all.
 *
 * Two ways to not be offered, for two different reasons: `systemone` is a decision protocol
 * rather than a chat API, and `hidden` is the user saying 「先不用它」 without losing how the
 * model is configured.
 *
 * It lives in its own module so it can be tested: `providers.ts` imports value constants from
 * `@shared/types`, which `node --test` cannot resolve, and this rule is the one part of the
 * model list worth pinning — `models.json` is the only provider configuration the engine
 * reads, and both it and the composer's list are built through this.
 */
export function isOfferedModel(model: ProviderModel, providerApi: string | undefined): boolean {
  return (model.api ?? providerApi) !== "systemone" && model.hidden !== true;
}
