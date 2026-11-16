# NITROBYTE

Závodní hra v prohlížeči (PC) + mobil jako ovladač.

## Spuštění
```
npm install
npm start
```
- Na PC otevři **http://localhost:3001/game/** (zobrazí QR kód).
- Telefon musí být ve **stejné Wi-Fi** jako PC. Naskenuj QR kód.
- Test bez telefonu: šipky / WASD na klávesnici.

## iPhone (HTTPS + senzory)
Server si při prvním startu sám vytvoří self-signed certifikát (složka `certs/`), nic neinstaluješ.
1. Naskenuj QR kód. Safari ukáže varování "Toto připojení není soukromé".
2. Klepni na **Zobrazit podrobnosti → Navštívit tento web → Navštívit web** (jednou).
3. Klepni na **Připojit a povolit senzory** a povol "Pohyb a orientace".
4. Otoč telefon na šířku, drž jako volant, klepni **Nastavit střed**.

Android Chrome: stejné (Pokročilé → Pokračovat), senzory se povolují automaticky.

## Ladění
Všechny hodnoty fyziky jsou v `public/game/config.js`. Tratě jsou datové soubory v `public/game/tracks/`.
Firewall: při prvním startu povol Node.js pro soukromé sítě (porty 3000 a 3001).

## Hra
- **Menu:** titulní obrazovka (ZÁVOD / GARÁŽ), nastavení závodu (trať, kola, boti, obtížnost), pauza (Esc).
- **Mince:** sbírej je na trati (zlaté = 1, rubínové nad skokánky = 5) a dostaneš odměnu za umístění v cíli.
- **Garáž:** barvy, vzory (skiny), křídla, kola, podsvícení, barva ohně a vylepšení motoru, zrychlení a turba. Vše se ukládá v prohlížeči.
- **Tratě** jsou datové soubory v `public/game/tracks/` (body, převýšení `elevation`, terén, dekorace, pady, rampy).
- **Ladění fyziky:** `public/game/config.js`, za jízdy klávesa T. Obtížnosti botů jsou v `CONFIG.difficulties`.
- **Ceny a nové položky do obchodu:** `public/game/catalog.js`.

## Zvuk a hudba
Vše se generuje v prohlížeči (žádné soubory): hudba pro menu a každou trať, motor, drift, turbo, skoky, dopady, odpočet, mince. Hlasitost hudby a zvuků je v nastavení závodu, klávesa **M** vše ztlumí. Hudba a zvuky začnou po prvním stisku klávesy nebo kliknutí (pravidlo prohlížeče).

## iPhone: přiblížení obrazu
Ovladač blokuje dvojklepnutí, štípnutí i přiblížení. Nejlepší je ale spouštět ho z plochy: v Safari **Sdílet → Přidat na plochu**, pak ikonu otevřít (celá obrazovka bez lišt).

## Ovladač jako aplikace + zamčené otáčení
Ovladač má manifest a ikonu, takže ho jde přidat na plochu (iPhone: Safari → Sdílet → Přidat na plochu; Android: Chrome → Přidat na plochu). Android aplikace se zamkne na šířku. iPhone zamknutí z webu neumí, proto ovladač při převrácení obrazu do portrétu sám otočí celý ovladač o 90°, takže zůstane na šířku a řízení náklonem se nezmění.

## Online hra (každý na svém PC a telefonu)
Architektura: server jen předává zprávy. Každý hráč simuluje své auto u sebe a posílá jeho stav ~20× za sekundu, **hostitel** (ten, kdo vytvoří místnost) navíc simuluje boty. Telefon se páruje se **svým** počítačem čtyřčíslím (je v QR kódu a vidět na obrazovce hry).

### Jak to rozjet (nejjednodušší: tunel z tvého PC)
1. Hostitel spustí `npm start` a v druhém okně tunel (zdarma, bez účtu):
   ```
   winget install --id Cloudflare.cloudflared
   cloudflared tunnel --url http://localhost:3001
   ```
   Vypíše adresu `https://něco.trycloudflare.com`.
2. **Všichni včetně hostitele** otevřou `https://něco.trycloudflare.com/game/`. Telefony naskenují QR kód na téhle stránce (má platný HTTPS certifikát, takže iPhone nepotřebuje žádné varování).
3. Hostitel: menu → ONLINE → VYTVOŘIT MÍSTNOST. Ostatním pošle 4písmenný kód.
4. Ostatní: ONLINE → zadat kód → PŘIPOJIT SE.
5. Hostitel dá Enter v lobby → nastavení závodu → START. Boti a pravidla se řídí hostitelem.

### Trvalý hosting
Server jde nasadit na Render / Railway / Fly: spouštěcí příkaz `npm start`, proměnná `HOSTED=1` (běží jen HTTP na portu `PORT`, HTTPS přidá hosting).

### Omezení
Auta hráčů se jen odrážejí od sebe (každý počítá svou fyziku), není ochrana proti podvádění a při slabém spojení se cizí auta mírně trhají.

## Nasazení na Fly.io (veřejně)
V projektu je `Dockerfile`, `fly.toml` a `.dockerignore`. Server běží v režimu `HOSTED=1`, má kompresi, heartbeat, limity spojení a zpráv a čistí jména a vzhledy aut od hráčů.

1. Účet na https://fly.io (vyžaduje platební kartu) a příkazový řádek:
   ```
   winget install --id Fly-io.flyctl
   fly auth login
   ```
   (nebo v PowerShellu: `iwr https://fly.io/install.ps1 -useb | iex`)
2. V `fly.toml` změň `app = "nitrobyte"` na jedinečný název, např. `nitrobyte-tvojejmeno`.
3. V složce projektu:
   ```
   fly launch --no-deploy --copy-config
   fly deploy --ha=false
   fly scale count 1
   ```
   `--ha=false` a `scale count 1` jsou důležité: místnosti jsou v paměti jednoho serveru, na dvou strojích by se hráči nepotkali.
4. Otevři `https://tvuj-nazev.fly.dev/game/`. Všichni hráči i jejich telefony používají tuhle adresu (QR kód v menu už je správně).
5. Aktualizace po úpravách: znovu `fly deploy --ha=false`. Logy: `fly logs`.

Vlastní doména: `fly certs add hra.tvojedomena.cz` a podle výpisu nastav DNS.
