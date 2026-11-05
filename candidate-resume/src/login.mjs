import { accountClient } from "./account.mjs";
import { authFeedback } from "./auth-feedback.mjs";
const $ = (id) => document.getElementById(id);
if (!CANDIDATE_URL) $("preview-access").hidden = false;
else {
  const api = accountClient(CANDIDATE_URL, CANDIDATE_KEY, sessionStorage);
  let register = false, pendingEmail = "", busy = false, cooldownUntil = 0;
  const status = (message) => { $("login-status").textContent = message; };
  const enter = () => location.replace("./#profile");
  const remaining = () => Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  function renderCooldown() {
    const seconds = remaining();
    $("resend-confirmation").disabled = busy || seconds > 0;
    $("resend-confirmation").textContent = seconds > 0
      ? `Resend in ${seconds}s` : "Resend confirmation";
    $("submit-auth").disabled = busy || (register && seconds > 0);
  }
  function startCooldown() { cooldownUntil = Date.now() + 60000; renderCooldown(); }
  setInterval(renderCooldown, 1000);
  function setMode(value) {
    register = value;
    $("credentials").hidden = false;
    $("confirmation").hidden = true;
    $("submit-auth").textContent = $("auth-heading").textContent = register ? "Create account" : "Sign in";
    $("password").autocomplete = register ? "new-password" : "current-password";
    $("mode").textContent = register ? "Use existing account" : "Create account";
    status("");
    renderCooldown();
  }
  function showConfirmation(email) {
    pendingEmail = email;
    $("password").value = "";
    $("credentials").hidden = true;
    $("confirmation").hidden = false;
    $("confirmation-email").textContent = email;
    $("confirmation-heading").focus();
  }
  $("credentials").hidden = false;
  api.session().then((session) => { if (session) enter(); })
    .catch(() => status("Sign in to start a fresh session."));
  $("mode").onclick = () => { if (!busy) setMode(!register); };
  $("verified-signin").onclick = () => {
    if (busy) return;
    setMode(false);
    $("password").focus();
  };
  $("resend-confirmation").onclick = async () => {
    if (busy || remaining() || !pendingEmail) return;
    busy = true;
    renderCooldown();
    status("Requesting confirmation…");
    try {
      await api.resendConfirmation(pendingEmail);
      startCooldown();
      status("If your account needs verification, a confirmation email is on its way. Use the most recent email.");
    } catch (error) {
      if (error.code === "over_email_send_rate_limit") startCooldown();
      status(authFeedback(error));
    } finally { busy = false; renderCooldown(); }
  };
  $("credentials").onsubmit = async (e) => {
    e.preventDefault();
    if (busy || (register && remaining())) return;
    busy = true;
    $("credentials").inert = true;
    renderCooldown();
    status("Connecting…");
    const email = $("email").value.trim();
    try {
      const data = await api[register ? "register" : "login"](email, $("password").value);
      $("password").value = "";
      if (data.session) enter();
      else {
        showConfirmation(email);
        startCooldown();
        status("Check your email to finish registration. Already verified? Return to sign in.");
      }
    } catch (error) {
      if (["over_email_send_rate_limit", "email_not_confirmed"].includes(error.code)) {
        showConfirmation(email);
        if (error.code === "over_email_send_rate_limit") startCooldown();
      }
      status(authFeedback(error));
    } finally {
      busy = false;
      $("credentials").inert = false;
      renderCooldown();
    }
  };
}
if (new URLSearchParams(location.search).get("deleted") === "1")
  $("login-status").textContent = "Account and saved application data deleted.";
window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });
