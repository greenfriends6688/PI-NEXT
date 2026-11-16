// Settings › Providers: the OAuth and API-key sign-in the Models panel used to
// own, now a section of its own.
//
// The lists are `GET /api/auth/providers` (`app/api/auth/providers/route.ts:9-14`);
// `src/api/auth.ts` documents the row shapes and where their status comes from.
// An OAuth row says `loggedIn` when the stored credential's type is `oauth`
// (`lib/provider-listing.ts:113`); an API-key row says `configured` when the
// provider has a credential that is not OAuth (`:89`), so a provider signed in
// with OAuth is not also shown as an API-key account.
//
// Signing in is the stream `GET /api/auth/login/<provider>` (`src/api/auth.ts`
// decodes its frames and names the route's lines). The route sends an `auth`
// event with the authorization URL and a manual-code token, a `device_code`
// event with a user code, `prompt_request` / `select_request` events for a
// value or a choice, and then `success`, `error` or `cancelled`. A pasted
// callback address or code goes back with `POST
// /api/auth/login/<provider>` as `{ token, code }`; a selection posts the
// option's id the same way. After `success` the list is read again, which is
// the only status this panel trusts.
//
// The look is the gallery kit (`../../ui/kit`, through `./parts`): a `Card` per
// list, a sunk `SettingsGroup` per provider, `SettingsRow` for each line,
// `Badge` for the auth kind, `Status` for the state, the kit's `Input` (with
// `inputLook`) and `Button` for a key and its actions, and the kit's
// `SettingsNote` / `SettingsError` / `SettingsLoading` for the flow's words.

import { cleanup, openUrl, resource, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  Badge,
  Button,
  colors,
  inputLook,
  Status,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import {
  authErrorText,
  authMessageText,
  deleteApiKey,
  loadAuthProviders,
  logoutOAuth,
  saveApiKey,
  startOAuthLogin,
  submitOAuthCode,
  type ApiKeyProviderInfo,
  type AuthChoice,
  type AuthLoginEvent,
  type OAuthProviderInfo,
} from "../../api/auth";
import { settingsOpen } from "../../state/session";
import { t } from "../../ui/i18n";
import {
  SettingsCard,
  SettingsCount,
  SettingsError,
  SettingsGroup,
  SettingsLoading,
  SettingsNote,
  SettingsRow,
  settingsCode,
  settingsPage,
} from "./parts";

/** The key field's width at a row's trailing edge. */
const KEY_FIELD_WIDTH = 220;

type LoginState =
  | { phase: "connecting"; provider: string }
  | {
    phase: "auth";
    provider: string;
    url: string;
    instructions: string | null;
    token: string;
  }
  | {
    phase: "device_code";
    provider: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number | null;
    expiresInSeconds: number | null;
  }
  | {
    phase: "prompt";
    provider: string;
    message: string;
    placeholder: string | null;
    token: string;
  }
  | {
    phase: "select";
    provider: string;
    message: string;
    options: AuthChoice[];
    token: string;
  }
  | { phase: "progress"; provider: string; message: string }
  | { phase: "success"; provider: string }
  | { phase: "error"; provider: string; message: string };

type AuthStep = Extract<LoginState, { phase: "auth" }>;
type DeviceStep = Extract<LoginState, { phase: "device_code" }>;
type PromptStep = Extract<LoginState, { phase: "prompt" }>;
type SelectStep = Extract<LoginState, { phase: "select" }>;
type ProgressStep = Extract<LoginState, { phase: "progress" }>;
type SuccessState = Extract<LoginState, { phase: "success" }>;
type ErrorState = Extract<LoginState, { phase: "error" }>;

function modelCountText(count: number): string {
  return t(count === 1 ? "models.modelCountOne" : "models.modelCount", { count });
}

export function Auth() {
  const providers = resource(
    () => (settingsOpen() ? "providers" : null),
    async (_source: string, info) => loadAuthProviders({ signal: info.signal }),
  );

  /** One action at a time: `save:<id>`, `remove:<id>`, `logout:<id>`. */
  const busy = signal<string | null>(null);
  const actionError = signal<string | null>(null);
  /** API-key drafts, by provider id; a saved key clears its entry. */
  const drafts = signal<Record<string, string>>({});
  /** The one paste/typed-value field shared by the active flow. */
  const code = signal("");
  const verifying = signal(false);
  const loginError = signal<string | null>(null);
  const login = signal<LoginState | null>(null);

  const keyField = inputLook({ style: { width: KEY_FIELD_WIDTH } });
  const pasteField = inputLook({ style: { flex: 1 } });

  // A sign-in outlives this render, so its close function is the component's.
  let stopLogin: (() => void) | null = null;
  const stopActiveLogin = (): void => {
    stopLogin?.();
    stopLogin = null;
  };
  cleanup(stopActiveLogin);

  const oauthProviders = (): OAuthProviderInfo[] => providers()?.oauthProviders ?? [];
  const apiKeyProviders = (): ApiKeyProviderInfo[] => providers()?.apiKeyProviders ?? [];
  const signedInCount = (): number => oauthProviders().filter((provider) => provider.loggedIn).length;
  const configuredCount = (): number => apiKeyProviders().filter((provider) => provider.configured).length;

  const providerName = (id: string): string => {
    const oauth = oauthProviders().find((provider) => provider.id === id);
    if (oauth !== undefined) return oauth.name;
    const apiKey = apiKeyProviders().find((provider) => provider.id === id);
    return apiKey?.displayName ?? id;
  };

  const draftFor = (id: string): string => drafts()[id] ?? "";
  const setDraft = (id: string, value: string): void => {
    drafts.update((all) => ({ ...all, [id]: value }));
  };

  const authStep = (): AuthStep | null => {
    const state = login();
    return state?.phase === "auth" ? state : null;
  };
  const deviceStep = (): DeviceStep | null => {
    const state = login();
    return state?.phase === "device_code" ? state : null;
  };
  const promptStep = (): PromptStep | null => {
    const state = login();
    return state?.phase === "prompt" ? state : null;
  };
  const selectStep = (): SelectStep | null => {
    const state = login();
    return state?.phase === "select" ? state : null;
  };
  const progressStep = (): ProgressStep | null => {
    const state = login();
    return state?.phase === "progress" ? state : null;
  };
  const successState = (): SuccessState | null => {
    const state = login();
    return state?.phase === "success" ? state : null;
  };
  const errorState = (): ErrorState | null => {
    const state = login();
    return state?.phase === "error" ? state : null;
  };

  /** Connecting, auth, device code, prompt, select and progress are all work. */
  const working = (): boolean => {
    const state = login();
    return state !== null && state.phase !== "success" && state.phase !== "error";
  };
  const activeFor = (id: string): boolean => working() && login()?.provider === id;
  const loginProviderName = (): string => providerName(login()?.provider ?? "");

  const openLink = async (url: string): Promise<void> => {
    actionError.set(null);
    try {
      const result = await openUrl(url);
      if (!result.opened) {
        actionError.set(t("settings.providers.openLinkFailed"));
      }
    } catch (cause) {
      const denied = cause instanceof Error && cause.message.includes("ERR_ACCESS_DENIED");
      actionError.set(
        denied
          ? t("settings.providers.openLinkDenied")
          : t("settings.providers.openLinkError", { error: errorText(cause) }),
      );
    }
  };

  const cancelLogin = (): void => {
    stopActiveLogin();
    login.set(null);
    loginError.set(null);
    code.set("");
    verifying.set(false);
  };

  const handleLoginEvent = (providerId: string, event: AuthLoginEvent): void => {
    loginError.set(null);
    switch (event.type) {
      case "auth":
        login.set({
          phase: "auth",
          provider: providerId,
          url: event.url,
          instructions: event.instructions,
          token: event.token,
        });
        break;
      case "device_code":
        login.set({
          phase: "device_code",
          provider: providerId,
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
        break;
      case "prompt_request":
        login.set({
          phase: "prompt",
          provider: providerId,
          message: event.message,
          placeholder: event.placeholder,
          token: event.token,
        });
        break;
      case "select_request":
        login.set({
          phase: "select",
          provider: providerId,
          message: event.message,
          options: event.options,
          token: event.token,
        });
        break;
      case "progress":
        login.set({ phase: "progress", provider: providerId, message: event.message });
        break;
      case "success":
        stopActiveLogin();
        verifying.set(false);
        code.set("");
        login.set({ phase: "success", provider: providerId });
        providers.refetch();
        break;
      case "error":
        stopActiveLogin();
        verifying.set(false);
        login.set({
          phase: "error",
          provider: providerId,
          message: authMessageText(event.message),
        });
        break;
      case "cancelled":
        stopActiveLogin();
        verifying.set(false);
        login.set(null);
        break;
    }
  };

  const beginLogin = (provider: OAuthProviderInfo): void => {
    stopActiveLogin();
    actionError.set(null);
    loginError.set(null);
    code.set("");
    verifying.set(false);
    const id = provider.id;
    login.set({ phase: "connecting", provider: id });
    stopLogin = startOAuthLogin(
      id,
      (event) => handleLoginEvent(id, event),
      {
        onError: (cause) => {
          const current = login();
          if (
            current?.provider !== id
            || current.phase === "success"
            || current.phase === "error"
          ) {
            return;
          }
          verifying.set(false);
          login.set({ phase: "error", provider: id, message: authErrorText(cause) });
        },
      },
    );
  };

  const submitValue = async (token: string, value: string, waiting: string): Promise<void> => {
    const state = login();
    if (state === null || value.trim() === "") return;
    const providerId = state.provider;
    verifying.set(true);
    loginError.set(null);
    try {
      await submitOAuthCode(providerId, token, value.trim());
      code.set("");
      // The stream carries the outcome. Only move the panel on if this
      // handshake is still the one on screen (a cancel would have cleared it).
      const after = login();
      if (
        after !== null
        && after.provider === providerId
        && (after.phase === "auth" || after.phase === "prompt" || after.phase === "select")
      ) {
        login.set({ phase: "progress", provider: providerId, message: waiting });
      }
    } catch (cause) {
      loginError.set(authErrorText(cause));
    } finally {
      verifying.set(false);
    }
  };

  const saveKey = async (provider: ApiKeyProviderInfo): Promise<void> => {
    const apiKey = draftFor(provider.id).trim();
    if (apiKey === "") return;
    busy.set(`save:${provider.id}`);
    actionError.set(null);
    try {
      await saveApiKey(provider.id, apiKey);
      setDraft(provider.id, "");
      providers.refetch();
    } catch (cause) {
      actionError.set(authErrorText(cause));
      providers.refetch();
    } finally {
      busy.set(null);
    }
  };

  const removeKey = async (provider: ApiKeyProviderInfo): Promise<void> => {
    busy.set(`remove:${provider.id}`);
    actionError.set(null);
    try {
      await deleteApiKey(provider.id);
      providers.refetch();
    } catch (cause) {
      actionError.set(authErrorText(cause));
      providers.refetch();
    } finally {
      busy.set(null);
    }
  };

  const signOut = async (provider: OAuthProviderInfo): Promise<void> => {
    busy.set(`logout:${provider.id}`);
    actionError.set(null);
    try {
      await logoutOAuth(provider.id);
      providers.refetch();
    } catch (cause) {
      actionError.set(authErrorText(cause));
      providers.refetch();
    } finally {
      busy.set(null);
    }
  };

  return (
    <View style={settingsPage}>
      <If when={providers.loading()}>
        <SettingsLoading label={t("settings.providers.reading")} />
      </If>
      <If when={providers.error()}>
        <SettingsError>{authErrorText(providers.error())}</SettingsError>
      </If>

      <SettingsCard
        title={t("i18n.subscriptions")}
        subtitle={t("settings.providers.subscriptionsSubtitle")}
        right={
          <If when={providers() !== undefined}>
            <SettingsCount label={`${signedInCount()} / ${oauthProviders().length}`} />
          </If>
        }
      >
        <If when={providers() !== undefined && oauthProviders().length === 0}>
          <SettingsNote>{t("settings.providers.noOAuth")}</SettingsNote>
        </If>

        <Each of={oauthProviders()} key={(provider) => provider.id}>
          {(provider) => (
            <SettingsGroup>
              <SettingsRow
                first
                strong
                label={provider().name}
                detail={t(provider().supportsApiKey
                  ? "settings.providers.oauthAndApiKey"
                  : "settings.providers.oauthSignIn")}
                tags={<Badge label="OAuth" />}
                note={
                  <Status
                    label={t(provider().loggedIn
                      ? "settings.providers.signedIn"
                      : "settings.providers.notConnected")}
                    tone={provider().loggedIn ? "up" : undefined}
                  />
                }
              >
                <If when={activeFor(provider().id)}>
                  <Button
                    label={t("i18n.cancel")}
                    variant="secondary"
                    size="small"
                    onPress={cancelLogin}
                  />
                </If>
                <If when={!activeFor(provider().id)}>
                  <Button
                    label={t(provider().loggedIn
                      ? "settings.providers.signInAgain"
                      : "settings.providers.signIn")}
                    variant={provider().loggedIn ? "secondary" : "primary"}
                    size="small"
                    disabled={working() || busy() !== null}
                    onPress={() => beginLogin(provider())}
                  />
                  <If when={provider().loggedIn}>
                    <Button
                      label={t("settings.providers.signOut")}
                      variant="danger"
                      size="small"
                      busy={busy() === `logout:${provider().id}`}
                      disabled={working() || busy() !== null}
                      onPress={() => void signOut(provider())}
                    />
                  </If>
                </If>
              </SettingsRow>
            </SettingsGroup>
          )}
        </Each>

        <If when={working()}>
          <SettingsGroup>
            <View style={{ paddingHorizontal: 4, paddingVertical: 4, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
                  {t("settings.providers.signingInTo", { provider: loginProviderName() })}
                </Text>
                <Badge label="OAuth" />
                <View style={{ flex: 1 }} />
                <Button
                  label={t("i18n.cancel")}
                  variant="secondary"
                  size="small"
                  onPress={cancelLogin}
                />
              </View>

              <If when={login()?.phase === "connecting"}>
                <SettingsLoading label={t("settings.providers.openingSignIn")} />
              </If>

              <If when={progressStep()}>
                {(step) => <SettingsLoading label={step().message} />}
              </If>

              <If when={authStep()}>
                {(step) => (
                  <View style={{ gap: 8 }}>
                    <SettingsNote>{t("settings.providers.finishSignIn")}</SettingsNote>
                    <If when={step().instructions}>
                      <SettingsNote>{step().instructions ?? ""}</SettingsNote>
                    </If>
                    <Text style={{ ...settingsCode(), lineHeight: 17 }}>{step().url}</Text>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        label={t("settings.providers.openSignInPage")}
                        variant="secondary"
                        size="small"
                        onPress={() => void openLink(step().url)}
                      />
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Input
                        class={pasteField.class}
                        style={pasteField.style}
                        value={code()}
                        onChange={({ value }) => code.set(value)}
                        onSubmit={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
                        placeholder="http://localhost:1455/auth/callback?code=…"
                        accessibilityLabel={t("settings.providers.callbackLabel")}
                        autoComplete="off"
                      />
                      <Button
                        label={t("i18n.submit")}
                        size="small"
                        busy={verifying()}
                        disabled={verifying() || code().trim() === ""}
                        onPress={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
                      />
                    </View>
                  </View>
                )}
              </If>

              <If when={promptStep()}>
                {(step) => (
                  <View style={{ gap: 8 }}>
                    <SettingsNote>{step().message}</SettingsNote>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Input
                        class={pasteField.class}
                        style={pasteField.style}
                        value={code()}
                        onChange={({ value }) => code.set(value)}
                        onSubmit={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
                        placeholder={step().placeholder ?? t("settings.providers.pasteValue")}
                        accessibilityLabel={t("settings.providers.valueLabel")}
                        autoComplete="off"
                      />
                      <Button
                        label={t("i18n.submit")}
                        size="small"
                        busy={verifying()}
                        disabled={verifying() || code().trim() === ""}
                        onPress={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
                      />
                    </View>
                  </View>
                )}
              </If>

              <If when={selectStep()}>
                {(step) => (
                  <View style={{ gap: 8 }}>
                    <SettingsNote>{step().message}</SettingsNote>
                    <Each of={step().options} key={(option) => option.id}>
                      {(option) => (
                        <Button
                          label={option().label}
                          variant="secondary"
                          size="small"
                          disabled={verifying()}
                          onPress={() => void submitValue(step().token, option().id, t("settings.providers.waitingForProvider"))}
                        />
                      )}
                    </Each>
                  </View>
                )}
              </If>

              <If when={deviceStep()}>
                {(step) => (
                  <View style={{ gap: 8 }}>
                    <SettingsNote>{t("settings.providers.deviceCodeNote")}</SettingsNote>
                    <Text style={{ ...settingsCode(), fontSize: 18, fontWeight: "600" }}>
                      {step().userCode}
                    </Text>
                    <Text style={{ ...settingsCode(), lineHeight: 17 }}>
                      {step().verificationUri}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        label={t("settings.providers.openVerificationPage")}
                        variant="secondary"
                        size="small"
                        onPress={() => void openLink(step().verificationUri)}
                      />
                    </View>
                    <If when={step().expiresInSeconds}>
                      {(seconds) => (
                        <SettingsNote>
                          {t("settings.providers.codeExpires", { minutes: Math.ceil(seconds() / 60) })}
                        </SettingsNote>
                      )}
                    </If>
                  </View>
                )}
              </If>

              <If when={loginError()}>
                <SettingsError>{loginError() ?? ""}</SettingsError>
              </If>
            </View>
          </SettingsGroup>
        </If>

        <If when={successState()}>
          {(state) => (
            <SettingsNote>
              {t("settings.providers.signedInTo", { provider: providerName(state().provider) })}
            </SettingsNote>
          )}
        </If>
        <If when={errorState()}>
          {(state) => <SettingsError>{state().message}</SettingsError>}
        </If>
      </SettingsCard>

      <SettingsCard
        title={t("settings.providers.apiKeys")}
        subtitle={t("settings.providers.apiKeysSubtitle")}
        right={
          <If when={providers() !== undefined}>
            <SettingsCount label={`${configuredCount()} / ${apiKeyProviders().length}`} />
          </If>
        }
      >
        <If when={providers() !== undefined && apiKeyProviders().length === 0}>
          <SettingsNote>{t("settings.providers.noApiKey")}</SettingsNote>
        </If>

        <Each of={apiKeyProviders()} key={(provider) => provider.id}>
          {(provider) => (
            <SettingsGroup>
              <SettingsRow
                first
                strong
                label={provider().displayName}
                detail={modelCountText(provider().modelCount)}
                tags={<Badge label={t("settings.providers.apiKey")} />}
                note={
                  <Status
                    label={t(provider().configured
                      ? "settings.providers.configured"
                      : "settings.providers.notConfigured")}
                    tone={provider().configured ? "up" : undefined}
                  />
                }
              >
                <If when={provider().configured}>
                  <Text style={settingsCode()}>••••••••</Text>
                  <Button
                    label={t("i18n.remove")}
                    variant="danger"
                    size="small"
                    busy={busy() === `remove:${provider().id}`}
                    disabled={busy() !== null}
                    onPress={() => void removeKey(provider())}
                  />
                </If>
              </SettingsRow>

              <SettingsRow
                label={t(provider().configured
                  ? "settings.providers.replaceApiKey"
                  : "settings.providers.apiKey")}
                detail={t(provider().configured
                  ? "settings.providers.replaceApiKeyDetail"
                  : "settings.providers.apiKeyDetail")}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Input
                    class={keyField.class}
                    style={keyField.style}
                    value={draftFor(provider().id)}
                    onChange={({ value }) => setDraft(provider().id, value)}
                    onSubmit={() => void saveKey(provider())}
                    masked
                    placeholder={provider().configured
                      ? t("settings.providers.newKey")
                      : "sk-…"}
                    accessibilityLabel={t("settings.providers.apiKeyField", {
                      provider: provider().displayName,
                    })}
                    autoComplete="off"
                  />
                  <Button
                    label={t("i18n.save")}
                    size="small"
                    busy={busy() === `save:${provider().id}`}
                    disabled={busy() !== null || draftFor(provider().id).trim() === ""}
                    onPress={() => void saveKey(provider())}
                  />
                </View>
              </SettingsRow>
            </SettingsGroup>
          )}
        </Each>
      </SettingsCard>

      <If when={actionError()}>
        <SettingsError>{actionError() ?? ""}</SettingsError>
      </If>
    </View>
  );
}
