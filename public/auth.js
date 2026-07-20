// ===================================================================
// Auth module for Hand Cricket Ultimate
// Handles Google and Guest (Anonymous) sign-in
// ===================================================================

const HCAuth = (() => {
  let currentUser = null;

  // ---- Google Sign-In ----
  async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await auth.signInWithPopup(provider);
      return { success: true, user: result.user };
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        return { success: false, error: 'Sign-in cancelled.' };
      }
      if (err.code === 'auth/account-exists-with-different-credential') {
        return { success: false, error: 'This account is already registered with a different sign-in method.' };
      }
      console.error('Google sign-in error:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Guest (Anonymous) Sign-In ----
  async function signInAsGuest(displayName) {
    try {
      const result = await auth.signInAnonymously();
      await result.user.updateProfile({ displayName: displayName || 'Guest' });
      return { success: true, user: result.user };
    } catch (err) {
      console.error('Guest sign-in error:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Link Guest to Google (upgrade anonymous account) ----
  async function linkGuestToGoogle(localStats) {
    const user = auth.currentUser;
    if (!user || !user.isAnonymous) {
      return { success: false, error: 'Not a guest account.' };
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await user.linkWithPopup(provider);
      // Fresh account — save local stats to cloud
      await createUserDocWithStats(result.user, localStats);
      return { success: true, user: result.user };
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use') {
        // Google account already exists — fetch its stats and ask user
        try {
          // Temporarily sign in to read existing stats
          const tempResult = await auth.signInWithCredential(err.credential);
          const existingStats = await fetchStats(tempResult.user.uid);
          
          // If cloud account has no stats, just merge silently
          if (!existingStats || existingStats.matchesPlayed === 0) {
            if (localStats) {
              await db.collection('users').doc(tempResult.user.uid).update({ stats: localStats });
            }
            return { success: true, user: tempResult.user };
          }
          
          // Cloud has stats — return conflict so UI can ask the user
          return {
            success: false,
            conflict: true,
            user: tempResult.user,
            cloudStats: existingStats,
            localStats: localStats
          };
        } catch (innerErr) {
          return { success: false, error: innerErr.message };
        }
      }
      if (err.code === 'auth/popup-closed-by-user') {
        return { success: false, error: 'Sign-in cancelled.' };
      }
      console.error('Link to Google error:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Resolve stats conflict (user chose which stats to keep) ----
  async function resolveConflict(uid, chosenStats) {
    try {
      await db.collection('users').doc(uid).update({ stats: chosenStats });
      return { success: true };
    } catch (err) {
      console.error('Resolve conflict error:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Create user doc with existing stats ----
  async function createUserDocWithStats(user, localStats) {
    const docRef = db.collection('users').doc(user.uid);
    const doc = await docRef.get();
    if (!doc.exists) {
      await docRef.set({
        displayName: user.displayName || 'Player',
        email: user.email || null,
        provider: user.providerData[0]?.providerId || 'unknown',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        stats: localStats || {
          matchesPlayed: 0, matchesWon: 0, matchesLost: 0,
          totalRuns: 0, highestScore: 0, totalWickets: 0,
          bestBowling: 0, currentStreak: 0, bestStreak: 0
        }
      });
    }
  }

  // ---- Merge stats if account exists but has empty stats ----
  async function mergeStatsIfEmpty(uid, localStats) {
    if (!localStats) return;
    const docRef = db.collection('users').doc(uid);
    const doc = await docRef.get();
    if (doc.exists) {
      const existing = doc.data().stats;
      if (!existing || existing.matchesPlayed === 0) {
        await docRef.update({ stats: localStats });
      }
    }
  }

  // ---- Sign Out ----
  async function signOut() {
    try {
      await auth.signOut();
      return { success: true };
    } catch (err) {
      console.error('Sign-out error:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Get ID Token (for socket auth) ----
  async function getIdToken() {
    const user = auth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(true);
    } catch (err) {
      console.error('Token error:', err);
      return null;
    }
  }

  // ---- Create user doc in Firestore ----
  async function createUserDoc(uid, data) {
    const docRef = db.collection('users').doc(uid);
    const doc = await docRef.get();
    if (!doc.exists) {
      await docRef.set({
        ...data,
        stats: {
          matchesPlayed: 0,
          matchesWon: 0,
          matchesLost: 0,
          totalRuns: 0,
          highestScore: 0,
          totalWickets: 0,
          bestBowling: 0,
          currentStreak: 0,
          bestStreak: 0
        }
      });
    }
  }

  // ---- Ensure user doc exists (for Google/Phone sign-in) ----
  async function ensureUserDoc(user) {
    await createUserDoc(user.uid, {
      displayName: user.displayName || 'Player',
      email: user.email || null,
      phone: user.phoneNumber || null,
      provider: user.providerData[0]?.providerId || 'unknown',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // ---- Fetch user stats from Firestore ----
  async function fetchStats(uid) {
    try {
      const doc = await db.collection('users').doc(uid).get();
      if (doc.exists) {
        return doc.data().stats || null;
      }
      return null;
    } catch (err) {
      console.error('Fetch stats error:', err);
      return null;
    }
  }

  // ---- Update display name ----
  async function updateDisplayName(newName) {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Not signed in.' };
    try {
      await user.updateProfile({ displayName: newName });
      await db.collection('users').doc(user.uid).update({ displayName: newName });
      return { success: true };
    } catch (err) {
      console.error('Update name error:', err);
      return { success: false, error: err.message };
    }
  }

  // ---- Auth state listener ----
  function onAuthStateChanged(callback) {
    auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      if (user && !user.isAnonymous) {
        await ensureUserDoc(user);
      }
      callback(user);
    });
  }

  // ---- Helpers ----
  function isGuest() {
    return currentUser?.isAnonymous === true;
  }

  function getUser() {
    return currentUser;
  }

  function getDisplayName() {
    return currentUser?.displayName || 'Guest';
  }

  function getEmail() {
    return currentUser?.email || null;
  }

  function getPhone() {
    return currentUser?.phoneNumber || null;
  }

  function getProvider() {
    if (!currentUser) return null;
    if (currentUser.isAnonymous) return 'guest';
    return currentUser.providerData[0]?.providerId || 'unknown';
  }

  // ---- Submit Feedback to Firestore ----
  async function submitFeedback(text) {
    if (!currentUser || currentUser.isAnonymous) {
      throw new Error('Must be signed in with Google to submit feedback.');
    }
    await db.collection('feedback').add({
      userId: currentUser.uid,
      displayName: currentUser.displayName || 'Unknown',
      email: currentUser.email || null,
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  return {
    signInWithGoogle,
    linkGuestToGoogle,
    resolveConflict,
    signInAsGuest,
    signOut,
    getIdToken,
    fetchStats,
    updateDisplayName,
    submitFeedback,
    onAuthStateChanged,
    isGuest,
    getUser,
    getDisplayName,
    getEmail,
    getPhone,
    getProvider
  };
})();
