# Emilians Spill — Gorilla-rytter

Et HTML5-spill laget til Emilian (6 år).

**Tema:** Et menneske rir på en gorilla og slåss mot elefanter — og samler bananer for å GÅ BANANAS!

**Spilles på:** Android via Chrome (eller hvilken som helst moderne nettleser).
**Installeres som app:** Trykk "Legg til på startskjerm" i nettleseren — fungerer offline.

## Spill nå

[https://avoidencez-lgtm.github.io/emilians-spill/](https://avoidencez-lgtm.github.io/emilians-spill/) (Pages aktiveres etter første push)

## Slik spiller du

Spillet er laget for å være **lett å lære og veldig gøy** for en 6-åring:
bare to ting å gjøre — **hoppe** og **slå** — pluss masse å samle.

### Kontroller (touch)
- **Trykk hvor som helst** — gorillaen hopper. Trykk en gang til i lufta for **dobbelt-hopp**.
- **SLÅ-knappen** (nede til høyre, alltid synlig) — slår elefanter og T-rex vekk.
- **SPARK-knappen** (nede til venstre, kun under fotball) — skyt fotballer på elefantene!
- **LYD-knappen** (oppe til høyre) — slår musikk og lyd av/på.

### Kontroller (datamaskin)
- **Mellomrom** = hopp
- **X** = slå
- **F** = spark fotball (under fotball-arena)
- **M** = lyd av/på

### Hva du samler 🍌
- 🍌 **Banan** — +5 poeng og fyller BANAN-måleren øverst. Full måler = **GÅ BANANAS!**
- 🥥 **Kokosnøtt** — +10 poeng
- ⭐ **Stjerne** — +25 poeng og konfetti!
- 🥞 **Pannekake** — +1 liv (maks 3)
- 🍡 **Marshmallow** — starter **GÅ BANANAS!** med en gang

### GÅ BANANAS! 🌈
Når banan-måleren er full (eller du tar en marshmallow) blir gorillaen **udødelig**
i 6 sekunder: regnbue-spor, dobbel fart, **x3 poeng**, egen musikk, og du
pløyer rett gjennom elefantene uten å ta skade!

### Hva du møter
- 🐘 **Elefanter** — du mister et liv hvis de treffer deg (unntatt i GÅ BANANAS). Slå dem vekk!
- 🦖 **T-rex (boss)** — kommer hvert 30. sekund. Trenger 3 slag. Stor bonus!
- ⚽ **Fotball-arena** — hvert 60. sekund i 15 sek. Bruk SPARK-knappen!

### Liv, poeng og rekord
- Du starter med 3 liv (pannekaker oppe til venstre).
- **Rekorden din lagres** (REKORD) — slår du den får du "NY REKORD!" med konfetti.
- Hvert 50. poeng feires med konfetti og lyd.
- Slår du flere fiender på rad får du **COMBO**-bonus.
- Mister du alle liv får du en fin "Wow!"-skjerm — trykk for å spille igjen.

## Tekniske detaljer (for far)

- Ren ES2020+ JS, ingen build-chain, ingen npm.
- PWA med service worker — fungerer offline etter første lasting.
- Logisk oppløsning 480x270, skaleres til viewport med pixelated rendering.
- WebAudio: loopende chiptune-musikk (note-scheduler med lookahead) + beeps. Ingen lyd-filer.
- Beste poengsum lagres i `localStorage`.
- Plain `fillRect`-grafikk i Minecraft-blokk-stil, parallax-bakgrunn (skyer, fjell, åser, fugler).

### Filer
- `index.html` — canvas-shell + manifest + sw-registrering
- `game.js` — all spill-logikk (kommentert)
- `style.css` — full-screen canvas
- `manifest.json` — PWA-manifest
- `sw.js` — service worker (precache)
- `icon.svg` — gorilla-fjes 512x512

### Kjør lokalt
```sh
python3 -m http.server 8000
# åpne http://localhost:8000 i Chrome
```
