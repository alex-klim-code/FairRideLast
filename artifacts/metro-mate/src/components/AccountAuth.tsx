import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}
if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");

const appearance = {
  theme: shadcn, cssLayerName: "clerk",
  options: { logoPlacement: "inside" as const, logoLinkUrl: basePath || "/", logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: "#21644e", colorForeground: "#173d30", colorMutedForeground: "#52675b",
    colorDanger: "#b03030", colorBackground: "#ffffff", colorInput: "#fafaf6", colorInputForeground: "#173d30",
    colorNeutral: "#567164", fontFamily: "DM Sans, sans-serif", borderRadius: "14px" },
  elements: {
    rootBox: "w-full flex justify-center", cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none", footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#173d30]", headerSubtitle: "text-[#52675b]", socialButtonsBlockButtonText: "text-[#173d30]",
    formFieldLabel: "text-[#173d30]", footerActionLink: "text-[#21644e]", footerActionText: "text-[#52675b]",
    dividerText: "text-[#52675b]", identityPreviewEditButton: "text-[#21644e]", formFieldSuccessText: "text-[#21644e]",
    alertText: "text-[#173d30]", formFieldInput: "text-[#173d30] bg-[#fafaf6]",
  },
};
export function AccountAuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: "FairRide — logowanie", subtitle: "Zaloguj się na zweryfikowane konto" } },
      signUp: { start: { title: "Konto FairRide", subtitle: "Nowe konta mają wyłącznie uprawnienia pasażera" } } }}
    routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    {children}
  </ClerkProvider>;
}
export function AccountSignIn() {
  return <div className="login-main" style={{ minHeight: "100dvh", display: "grid", placeContent: "center", gap: 20 }}>
    <Link href="/">FairRide · Powrót</Link>
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/`} />
  </div>;
}
export function AccountSignUp() {
  return <div className="login-main" style={{ minHeight: "100dvh", display: "grid", placeContent: "center", gap: 20 }}>
    <Link href="/">FairRide · Powrót</Link>
    <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/`} />
  </div>;
}