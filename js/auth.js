// Authentication module — magic link (passwordless) auth via Supabase
const Auth = (() => {
  let client = null;
  let currentSession = null;

  // Timeout (ms) for auth network requests — prevents iOS Safari fetch hanging
  const AUTH_TIMEOUT_MS = 15000;

  function isConfigured() {
    return client !== null;
  }

  function init() {
    if (typeof supabase === 'undefined' || typeof Config === 'undefined') return;

    // Validate Supabase config — skip init if still using placeholder values
    if (!Config.SUPABASE_URL || !Config.SUPABASE_ANON_KEY ||
        Config.SUPABASE_URL.indexOf('your-project') !== -1 ||
        Config.SUPABASE_ANON_KEY === 'your-anon-key-here') {
      console.warn('[Auth] Supabase not configured — auth features disabled.');
      return;
    }

    client = supabase.createClient(Config.SUPABASE_URL, Config.SUPABASE_ANON_KEY);

    client.auth.onAuthStateChange((event, session) => {
      currentSession = session;
      window.dispatchEvent(new CustomEvent('auth-state-change', {
        detail: { event: event, session: session },
      }));
    });

    // Restore existing session
    client.auth.getSession().then(function (result) {
      var data = result.data;
      currentSession = data.session;
      if (currentSession) {
        window.dispatchEvent(new CustomEvent('auth-state-change', {
          detail: { event: 'INITIAL_SESSION', session: currentSession },
        }));
      }
    }).catch(function (err) {
      console.warn('[Auth] Failed to restore session:', err);
    });
  }

  function getClient() {
    return client;
  }

  function getSession() {
    return currentSession;
  }

  function getUser() {
    return currentSession ? currentSession.user : null;
  }

  function isLoggedIn() {
    return !!currentSession;
  }

  function signInWithMagicLink(email) {
    if (!client) return Promise.reject(new Error('Sign-in is not available. Please check your connection and try again.'));

    // Race the OTP request against a timeout to prevent iOS Safari fetch hanging
    var otpPromise = client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });

    var timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error('Request timed out. Please check your connection and try again.'));
      }, AUTH_TIMEOUT_MS);
    });

    return Promise.race([otpPromise, timeoutPromise]);
  }

  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut().then(function () {
      currentSession = null;
    });
  }

  return {
    init: init,
    isConfigured: isConfigured,
    getClient: getClient,
    getSession: getSession,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    signInWithMagicLink: signInWithMagicLink,
    signOut: signOut,
  };
})();
