// Only fixed, user-safe messages reach the interface; never raw server errors.
export function authFeedback(error) {
  switch (error?.code) {
    case 'over_email_send_rate_limit':
      return 'A confirmation email was requested recently. Check your inbox and spam folder, or wait a minute before requesting another.';
    case 'email_not_confirmed':
      return 'Confirm your email before signing in. Check your inbox and spam folder, or request another confirmation below.';
    case 'invalid_credentials':
      return 'The email or password is incorrect. Use your candidate account details; recruiter accounts have a separate sign-in.';
    case 'weak_password':
      return 'Choose a stronger password with at least 8 characters, including uppercase and lowercase letters, a number, and a symbol.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Unable to create this account. If you have already registered, use Sign in.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a few minutes before trying again.';
    case 'signup_disabled':
      return 'Account creation is temporarily unavailable. Please try again later or continue as a guest.';
    default:
      return 'Unable to connect or complete this request. Please try again shortly. You can also continue as a guest.';
  }
}
