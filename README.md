# Emilians Spill — Gorilla-rytter

Et HTML5-spill laget til Emilian (6 ar) av Hermes-flaten.

**Tema:** Et menneske rir pa en gorilla og slass mot elefanter.

**Spilles pa:** Android via Chrome (eller hvilken som helst moderne nettleser).
**Installeres som app:** Trykk "Legg til pa startskjerm" i nettleseren — fungerer offline.

## Spill na

[https://avoidencez-lgtm.github.io/emilians-spill/](https://avoidencez-lgtm.github.io/emilians-spill/) (Pages aktiveres etter forste push)

## Slik spiller du

### Kontroller (touch)
- **Trykk en gang** — gorillaen hopper
- **Trykk en gang til i lufta** — dobbelt-hopp
- **SLA-knappen** nede til hoyre (alltid synlig) — trykk for a sla elefanter og T-rex vekk!
- **LYD-knappen** oppe til hoyre — slar lyden av/pa

### Kontroller (datamaskin)
- **Mellomrom** = hopp
- **X** = sla (trykk, ikke hold)
- **M** = mute

### Hva du moter
- 🐘 **Elefanter** — du mister et liv hvis de gar inn i deg. Sla dem vekk med punch!
- 🦖 **T-rex (boss)** — kommer hvert 30. sekund. Trenger 3 slag for a forsvinne. Stor bonus!
- ⚽ **Fotball-arena** — hvert 60. sekund forvandles bakken til en fotball-bane i 15 sek. Bruk SPARK-knappen for a skyte fotballer pa elefantene!
- 🥥 **Kokosnott** — +10 poeng
- 🥞 **Pannekake** — +1 liv (maks 3)
- 🍡 **Marshmallow** — 5 sekunder med super-fart og dobbel poeng (regnbue-spor!)

### Liv og poeng
- Du starter med 3 liv (pannekaker oppe til venstre).
- Mister du alle, fa du en fin "Wow!"-skjerm med poengene dine — trykk for a spille igjen.
- Slar du flere fiender pa rad far du COMBO-bonus.
- **Beste poeng** huskes mellom oktene (lagres i nettleseren). Slar du rekorden din
  far du en "NY REKORD!"-feiring — ellers vises "Beste: N" a jakte pa.

## Tekniske detaljer (for far)

- Ren ES2020+ JS, ingen build-chain, ingen npm.
- PWA med service worker — fungerer offline etter forste lasting.
- Logisk opplosning 480x270, skaleres til viewport med pixelated rendering.
- WebAudio-beeps (ingen lyd-filer).
- Plain `fillRect`-grafikk i Minecraft-blokk-stil.

### Filer
- `index.html` — canvas-shell + manifest + sw-registrering
- `game.js` — all spill-logikk (~700 linjer, kommentert)
- `style.css` — full-screen canvas
- `manifest.json` — PWA-manifest
- `sw.js` — service worker (precache)
- `icon.svg` — gorilla-fjes 512x512

### Kjor lokalt
```sh
cd /home/vegard/dev/emilians-spill
python3 -m http.server 8000
# apne http://localhost:8000 i Chrome
```
