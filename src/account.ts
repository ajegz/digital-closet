import { getStatus, isSignedIn, onStatus, sendCode, signOut, syncNow, verifyCode, type SyncStatus } from "./sync";

type ShowToast = (options: { kind?: "success" | "error" | "info"; title: string; message: string }) => void;
type Step = "email" | "code" | "signedIn" | "off";

const RESEND_COOLDOWN_S = 60;

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function friendlyAuthError(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? String(error);
  const status = (error as { status?: number } | null)?.status;
  if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test(message)) return "You’re offline. Connect to the internet and try again.";
  if (status === 429 || /rate limit|security purposes|too many/i.test(message)) return "Too many codes asked for. Wait a minute, then try again.";
  if (/expired|invalid|otp/i.test(message)) return "That code didn’t work. Check it, or send a new one.";
  if (/signups? not allowed|not allowed for this instance/i.test(message)) return "This email can’t sign in to this closet.";
  if (/email/i.test(message)) return "That email address doesn’t look right.";
  return message;
}

function timeAgo(time: number) {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const SYNC_TEXT: Record<SyncStatus["state"], (status: SyncStatus) => [string, string]> = {
  off: () => ["Saved on this device", ""],
  "signed-out": () => ["Not signed in", ""],
  syncing: () => ["Syncing…", "Backing up your latest changes"],
  synced: (status) => [
    status.pending ? "Changes waiting" : "All backed up",
    status.pending ? `${status.pending} change${status.pending === 1 ? "" : "s"} will sync in a moment` : status.lastSyncedAt ? `Last synced ${timeAgo(status.lastSyncedAt)}` : ""
  ],
  offline: (status) => ["Offline", status.pending ? `${status.pending} change${status.pending === 1 ? "" : "s"} will sync when you’re back online` : "Changes sync when you’re back online"],
  error: (status) => ["Couldn’t sync", status.message ?? "Try again in a moment."]
};

export function initAccount(showToast: ShowToast) {
  const dialog = $<HTMLDialogElement>("#accountDialog");
  const emailStep = $<HTMLFormElement>("#emailStep");
  const codeStep = $<HTMLFormElement>("#codeStep");
  const emailInput = $<HTMLInputElement>("#emailInput");
  const codeInput = $<HTMLInputElement>("#codeInput");
  const resendButton = $<HTMLButtonElement>("#resendButton");
  const signOutButton = $<HTMLButtonElement>("#signOutButton");
  const signOutWarning = $("#signOutWarning");
  let email = "";
  let forceSignOut = false;
  let resendTimer: number | undefined;
  let wasSignedIn = isSignedIn();
  // Only a code typed in this sheet earns the welcome banner, not a session restored on page load.
  let awaitingSignIn = false;

  const steps: Record<Step, HTMLElement> = { email: emailStep, code: codeStep, signedIn: $("#signedInStep"), off: $("#offStep") };

  function showStep(step: Step) {
    for (const [name, element] of Object.entries(steps)) element.hidden = name !== step;
  }

  function showError(element: HTMLElement, message?: string) {
    element.hidden = !message;
    element.textContent = message ?? "";
  }

  function currentStep(): Step {
    if (getStatus().state === "off") return "off";
    if (isSignedIn()) return "signedIn";
    return email ? "code" : "email";
  }

  function open() {
    showError($("#emailError"));
    showError($("#codeError"));
    resetSignOut();
    showStep(currentStep());
    dialog.showModal();
    if (currentStep() === "email") emailInput.focus();
    if (isSignedIn()) void syncNow();
  }

  function resetSignOut() {
    forceSignOut = false;
    signOutButton.textContent = "Sign out";
    showError(signOutWarning);
  }

  function startResendCooldown() {
    let remaining = RESEND_COOLDOWN_S;
    window.clearInterval(resendTimer);
    resendButton.disabled = true;
    resendButton.textContent = `New code in ${remaining}s`;
    resendTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        resendButton.textContent = `New code in ${remaining}s`;
        return;
      }
      window.clearInterval(resendTimer);
      resendButton.disabled = false;
      resendButton.textContent = "Send a new code";
    }, 1000);
  }

  async function withBusy(button: HTMLButtonElement, busyLabel: string, task: () => Promise<void>) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await task();
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  $("#accountButton").addEventListener("click", open);
  dialog.querySelector("[data-close-account]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  emailStep.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = emailInput.value.trim().toLowerCase();
    if (!emailInput.checkValidity() || !value) {
      showError($("#emailError"), "Enter the email address you want to sign in with.");
      return;
    }
    void withBusy($("#sendCodeButton"), "Sending…", async () => {
      try {
        await sendCode(value);
        email = value;
        $("#codeEmail").textContent = value;
        codeInput.value = "";
        showError($("#codeError"));
        showStep("code");
        startResendCooldown();
        codeInput.focus();
      } catch (error) {
        showError($("#emailError"), friendlyAuthError(error));
      }
    });
  });

  codeStep.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = codeInput.value.replace(/\D/g, "");
    if (code.length < 6) {
      showError($("#codeError"), "Enter the 6-digit code from the email.");
      return;
    }
    void withBusy($("#verifyButton"), "Checking…", async () => {
      try {
        awaitingSignIn = true;
        await verifyCode(email, code);
        // The session arrives through onAuthStateChange; the status listener switches the sheet over.
      } catch (error) {
        awaitingSignIn = false;
        showError($("#codeError"), friendlyAuthError(error));
      }
    });
  });

  resendButton.addEventListener("click", () => {
    void withBusy(resendButton, "Sending…", async () => {
      try {
        await sendCode(email);
        showError($("#codeError"));
        showToast({ kind: "info", title: "New code sent", message: `Check ${email}.` });
      } catch (error) {
        showError($("#codeError"), friendlyAuthError(error));
      }
    }).then(startResendCooldown);
  });

  $("#changeEmailButton").addEventListener("click", () => {
    email = "";
    window.clearInterval(resendTimer);
    showStep("email");
    emailInput.focus();
  });

  $("#syncNowButton").addEventListener("click", () => void syncNow());

  signOutButton.addEventListener("click", () => {
    void withBusy(signOutButton, "Signing out…", async () => {
      const { pending } = await signOut({ force: forceSignOut });
      if (pending) {
        forceSignOut = true;
        showError(signOutWarning, `${pending} change${pending === 1 ? " hasn’t" : "s haven’t"} reached your account yet. Sign out anyway and ${pending === 1 ? "it’s" : "they’re"} lost from this device.`);
        return;
      }
      dialog.close();
      showToast({ kind: "info", title: "Signed out", message: "This device’s copy was cleared. Your closet is safe in your account." });
    }).then(() => {
      if (forceSignOut) signOutButton.textContent = "Sign out anyway";
    });
  });

  onStatus((status) => {
    const signedIn = isSignedIn();
    const dot = $("#accountDot");
    dot.hidden = !signedIn;
    dot.dataset.state = status.state;
    $("#syncDot").dataset.state = status.state;
    const [title, detail] = SYNC_TEXT[status.state](status);
    $("#syncTitle").textContent = title;
    $("#syncDetail").textContent = detail;
    $("#accountEmail").textContent = status.email ?? "";
    $("#accountButton").setAttribute("aria-label", signedIn ? `Account: ${title}` : "Sign in to back up your closet");

    if (signedIn && !wasSignedIn) {
      email = "";
      window.clearInterval(resendTimer);
      if (dialog.open) showStep("signedIn");
      if (awaitingSignIn) showToast({ title: "You’re signed in", message: "Backing up your closet now." });
      awaitingSignIn = false;
    }
    if (!signedIn && dialog.open && steps.signedIn.hidden === false) showStep("email");
    wasSignedIn = signedIn;
  });
}
