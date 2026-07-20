// Firebase configuration for Hand Cricket Ultimate
// Using compat CDN (loaded via script tags in index.html)

const firebaseConfig = {
  apiKey: "AIzaSyCZvXXjm_sVSvbEIW_RU1mcTvaBQpvOgfE",
  authDomain: "hand-cricket-ultimate.firebaseapp.com",
  projectId: "hand-cricket-ultimate",
  storageBucket: "hand-cricket-ultimate.firebasestorage.app",
  messagingSenderId: "597643444617",
  appId: "1:597643444617:web:2dec059ce4ddd5e167a158"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Auth & Firestore instances
const auth = firebase.auth();
const db = firebase.firestore();
