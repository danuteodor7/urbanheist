# Rulare pe alt PC (dupa copiere/zip)

## 1. Instaleaza o singura data
- **Node.js LTS** (20 sau mai nou) de pe https://nodejs.org (include `npm`).
- Verifica in PowerShell: `node -v` si `npm -v`.

## 2. Pregateste folderul
- La arhivare, **nu include `node_modules/` si `dist/`** (sunt mari si se refac). Daca le-ai inclus, sterge-le.
- Pastreaza **`.env.local`** (contine URL-ul si cheia publica Supabase). Daca lipseste, creeaza-l in radacina proiectului:
  ```
  VITE_SUPABASE_URL=https://<proiectul-tau>.supabase.co
  VITE_SUPABASE_ANON_KEY=<cheia publishable/anon>
  ```
  Valorile se gasesc in Supabase Dashboard, Project Settings, API. Fisierul e ascuns in unele arhivatoare: verifica ca a ajuns pe noul PC.

## 3. Porneste
```powershell
cd calea\catre\urban-heist
npm install
npm run dev
```
Deschide adresa afisata (de obicei http://localhost:5173).

## 4. Baza de date
Nu trebuie refacuta: ruleaza in cloud-ul Supabase, iar `.env.local` indica acelasi proiect. `supabase/schema.sql` ai nevoie de el doar daca creezi un proiect Supabase nou (SQL Editor, rulezi tot fisierul).
Daca vezi "Profil indisponibil", contul nu are rand in `profiles` (verifica trigger-ul din schema).

## 5. Testare multiplayer (Pasul 4)
1. Doua ferestre/browsere (a doua in incognito), doua conturi diferite, ambele logate.
2. Jucatorul A: "Intra pe server".
3. Jucatorul B: "Intra pe server". Ar trebui sa se vada reciproc (siluete + nume).
4. Mouse = tinta, click stang = foc (20 damage, HP 100). La moarte, rucsacul cazut apare ca o cutie rosie; cauta-l cu `E`.
5. Containerele golite de unul se golesc si la celalalt.
6. Cu un jucator nou care intra tarziu: vede containerele deja golite dupa ~1 secunda.

## Probleme frecvente
- **`npm` nu e recunoscut**: reinstaleaza Node si redeschide terminalul.
- **Ecran alb / eroare supabaseUrl required**: `.env.local` lipseste sau a fost redenumit; dupa editare reporneste `npm run dev`.
- **"Serverul e plin"**: 15 jucatori deja in raid.
- **Jucatori care sacadeaza sau cad din raid**: ai depasit 100 mesaje/s pe Free plan (vezi ARCHITECTURE.md, "Buget Realtime").
- **Port ocupat**: Vite alege automat alt port; foloseste adresa din terminal.
- Nu pune `.env.local` pe GitHub public ca obicei bun, chiar daca cheia publishable e menita sa fie publica (securitatea reala sta in RLS/RPC).
