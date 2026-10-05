// fork:enabled-models — upstream-port marker
import type {
  EnabledModelsModelView,
  EnabledModelsProviderView,
  EnabledModelsView,
} from "@/lib/enabled-models";

/** True when switching this single model off would empty the scope. */
export function isLastEnabledModel(
  view: EnabledModelsView | null,
  model: EnabledModelsModelView,
): boolean {
  return model.enabled && (view?.enabledTotal ?? 0) <= 1;
}

export function findProviderView(
  view: EnabledModelsView | null,
  providerId: string,
): EnabledModelsProviderView | undefined {
  return view?.providers.find((provider) => provider.id === providerId);
}

/** `12/40` style badge for a provider row, or null while nothing is scoped. */
export function providerBadgeLabel(
  view: EnabledModelsView | null,
  providerId: string,
): string | null {
  if (!view || view.allEnabled) return null;
  const provider = findProviderView(view, providerId);
  if (!provider) return null;
  return `${provider.enabledCount}/${provider.models.length}`;
}
