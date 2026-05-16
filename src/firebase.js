import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, off, update } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBHn-W2sEAsK9iTDlNgswLK9Kr3j-8-2cU",
  authDomain: "jachtseizoenscharne.firebaseapp.com",
  databaseURL: "https://jachtseizoenscharne-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jachtseizoenscharne",
  storageBucket: "jachtseizoenscharne.firebasestorage.app",
  messagingSenderId: "812677624468",
  appId: "1:812677624468:web:02045c4871cc5b5051fa81",
};

const app = initializeApp(firebaseConfig, "imposter");
const db = getDatabase(app);

const gRef = code => ref(db, `imposter/${code}`);

export const readGame  = async code => { const s = await get(gRef(code)); return s.exists() ? s.val() : null; };
export const writeGame = async (code, data) => set(gRef(code), data);
export const updateGame = async (code, data) => update(gRef(code), data);
export const subscribeGame = (code, cb) => {
  const r = gRef(code);
  onValue(r, s => cb(s.exists() ? s.val() : null));
  return () => off(r);
};
