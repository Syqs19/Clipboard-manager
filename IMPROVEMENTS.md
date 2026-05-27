# Roadmap miglioramenti — Clipboard Manager

Idee di miglioramento per l'app, in ordine di impatto. Stato: ☐ da fare · ⏳ in corso · ✅ fatto.

## 🔑 Alto impatto (esperienza da clipboard manager "vero")

- ⏳ **Navigazione da tastiera + incolla diretto** — frecce ↑↓ per scorrere, `Invio` per
  copiare *e incollare* nell'app dov'eri (simulando Ctrl+V) e nascondere la finestra;
  tasti `1-9` per incollare al volo. È il salto UX più grande (stile Raycast/Paste).
- ☐ **Salta i password manager** — rispettare i formati clipboard "escludi da cronologia"
  (`ExcludeClipboardContentFromMonitorProcessing`) così le password copiate non vengono
  salvate. Era nel piano originale; tocca la priorità privacy.
- ⏳ **Icona personalizzata** — sostituire l'icona default di Tauri con una vera.

## 🔒 Hardening privacy

- ☐ **Cifratura a riposo** dei clip sensibili (o intero DB con SQLCipher) — ora in chiaro nel file SQLite.
- ☐ **Auto-cancellazione** dei clip sensibili dopo X minuti, o opzione "non salvarli affatto".
- ☐ **Hotkey panico** per svuotare tutta la cronologia all'istante.

## ✨ Completare lo spec / feature

- ⏳ **Modifica del contenuto** di un clip (doppio click → editor). Previsto, non fatto.
- ☐ **Riordino drag & drop** dei fissati. Previsto, non fatto.
- ⏳ **Colori dei tag** (il DB ha già il campo `color`, inutilizzato nella UI).
- ☐ **Più tipi di contenuto**: file copiati, HTML/RTF.
- ☐ **"Incolla come testo semplice"**.
- ☐ **Raggruppa per data** in cronologia (Oggi / Ieri / ...).
- ☐ **Multi-selezione** + elimina in blocco.
- ☐ **Export / Import** della cronologia.

## 🎨 Polish & distribuzione

- ☐ **Miniature ridotte** salvate a parte (ora carica i PNG interi → pesante con tante immagini).
- ☐ **Auto-update** (`tauri-plugin-updater`) + **CI GitHub Actions** che genera le release.
- ☐ **Firma del codice** (rimuove l'avviso SmartScreen — richiede certificato a pagamento).
- ☐ **README** con screenshot + onboarding al primo avvio ("premi Ctrl+Shift+V").

## 🧰 Qualità codice

- ☐ Più test (watcher / commands), gestione errori mostrata in UI invece che solo console.

---

### In lavorazione adesso
1. ⏳ Icona personalizzata
2. ⏳ Modifica clip + colori tag
3. ⏳ Navigazione tastiera + incolla diretto
