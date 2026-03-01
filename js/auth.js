// Authentication module — magic link (passwordless) auth via Supabase
const Auth = (() => {
  let client = null;
  let currentSession = null;

  function init() {
    if (typeof supabase === 'undefined' || typeof Config === 'undefined') return;
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
    if (!client) return Promise.reject(new Error('Supabase not initialized'));
    return client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
  }

  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut().then(function () {
      currentSession = null;
    });
  }

  return {
    init: init,
    getClient: getClient,
    getSession: getSession,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    signInWithMagicLink: signInWithMagicLink,
    signOut: signOut,
  };
})();
