const S = window.__FB;
let cb = null;
export const getAuth = () => ({});
export const getRedirectResult = async () => null;
export const onAuthStateChanged = (_a, f) => { cb = f; setTimeout(() => f(S.current), 10); return () => {}; };
export class GoogleAuthProvider { setCustomParameters() {} }
export const signInWithPopup = async () => { S.current = S.loginAs; setTimeout(() => cb(S.current), 10); };
export const signInWithRedirect = signInWithPopup;
export const signOut = async () => { S.current = null; S.signOuts = (S.signOuts || 0) + 1; setTimeout(() => cb(null), 10); };
