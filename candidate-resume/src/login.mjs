import { accountClient } from "./account.mjs";
const $ = (id) => document.getElementById(id);
if (!CANDIDATE_URL) $("preview-access").hidden = false;
else {
  const api = accountClient(CANDIDATE_URL, CANDIDATE_KEY, sessionStorage);
  let register = false;
  $("credentials").hidden = false;
  const enter = () => location.replace("./#profile");
  api
    .session()
    .then((session) => {
      if (session) enter();
    })
    .catch(() => {
      $("login-status").textContent = "Sign in to start a fresh session.";
    });
  $("mode").onclick = () => {
    register = !register;
    $("submit-auth").textContent = $("auth-heading").textContent = register
      ? "Create account"
      : "Sign in";
    $("password").autocomplete = register ? "new-password" : "current-password";
    $("mode").textContent = register
      ? "Use existing account"
      : "Create account";
    $("login-status").textContent = "";
  };
  $("credentials").onsubmit = async (e) => {
    e.preventDefault();
    $("credentials").inert = true;
    $("login-status").textContent = "Connecting…";
    try {
      const data = await api[register ? "register" : "login"](
        $("email").value.trim(),
        $("password").value,
      );
      $("password").value = "";
      if (data.session) enter();
      else
        $("login-status").textContent =
          "Check your email to verify your account, then sign in here.";
    } catch {
      $("login-status").textContent =
        "Could not complete sign-in or registration. Check your details and try again.";
    } finally {
      $("credentials").inert = false;
    }
  };
}

if (new URLSearchParams(location.search).get("deleted") === "1")
  $("login-status").textContent = "Account and saved application data deleted.";
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
