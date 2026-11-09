const S = window.__FB;
export const getFirestore = () => ({});
export const doc = (_db, ...p) => ({ path: p.join('/') });
export const collection = (_db, ...p) => ({ path: p.join('/') });
export const where = () => ({}); export const orderBy = () => ({}); export const query = (c) => c;
const allowed = () => S.current && (S.current.email === S.owner || S.list.includes(S.current.email));
export const getDoc = async (r) => {
  if (r.path === 'config/access') { if (S.current?.email !== S.owner) throw Object.assign(new Error('denied'), { code: 'permission-denied' }); return { exists: () => true, data: () => ({ emails: S.list }) }; }
  if (!allowed()) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
  return { exists: () => false, data: () => null };
};
export const getDocs = async () => ({ docs: [] });
export const setDoc = async (r, d) => { if (r.path === 'config/access') S.list = d.emails; };
export const writeBatch = () => ({ set() {}, delete() {}, commit: async () => {} });
