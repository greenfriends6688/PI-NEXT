/**
 * GitHub as the identity provider.
 *
 * The smallest thing that turns "somebody with a browser" into "an account with a login": the
 * service is a plain OAuth client here, and what it keeps afterwards is the login, not the
 * GitHub token. Nothing later calls GitHub on the user's behalf, so the token is dropped as
 * soon as the profile has been read.
 */

const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

export type GithubProfile = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
};

export function githubAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("allow_signup", "true");
  return url.toString();
}

export async function exchangeGithubCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: typeof fetch;
}): Promise<string | null> {
  const doFetch = input.fetch ?? fetch;
  const response = await doFetch(TOKEN, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => undefined)) as { access_token?: unknown; error?: unknown } | undefined;
  if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) return null;
  return body.access_token;
}

export async function fetchGithubProfile(accessToken: string, fetchImpl?: typeof fetch): Promise<GithubProfile | null> {
  const doFetch = fetchImpl ?? fetch;
  const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}`, "user-agent": "pinext-cloud" };
  const response = await doFetch(`${API}/user`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => undefined)) as
    | { login?: unknown; name?: unknown; avatar_url?: unknown; email?: unknown }
    | undefined;
  if (!user || typeof user.login !== "string" || !user.login) return null;

  // A profile with no public email answers null, and the account would then have none at all
  // where GitHub does know one. The scope above is what makes this call allowed.
  let email = typeof user.email === "string" && user.email ? user.email : null;
  if (!email) {
    const emails = await doFetch(`${API}/user/emails`, { headers, signal: AbortSignal.timeout(15_000) })
      .then((res) => (res.ok ? (res.json() as Promise<Array<{ email?: unknown; primary?: unknown; verified?: unknown }>>) : []))
      .catch(() => []);
    email = emails.find((item) => item.primary === true && item.verified === true && typeof item.email === "string")?.email as string | undefined ?? null;
  }

  const avatar = typeof user.avatar_url === "string" ? user.avatar_url : null;
  return {
    login: user.login,
    name: typeof user.name === "string" && user.name ? user.name : null,
    // The client requires an https avatar and drops anything else, so a non-https value is
    // reported as none rather than sent to be discarded.
    avatarUrl: avatar && avatar.startsWith("https://") ? avatar : null,
    email,
  };
}
