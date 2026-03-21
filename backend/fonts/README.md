# Fonts for Text Overlay

All fonts are SIL Open Font Licence. Download from [fonts.google.com](https://fonts.google.com) —
search the family name, click **Download family**, extract the zip, and grab the
`*-Regular.ttf` file. Some zips have a `static/` subfolder — look inside it for the
non-variable TTF.

Place all files directly in `backend/fonts/`. They land at `/app/fonts/` in the
Railway container via the existing `COPY . .` in Dockerfile — no Dockerfile changes needed.

If a font file is absent (e.g. local Windows dev), the pipeline skips `drawtext` for
that job and logs a warning — the video still renders normally without text.

## Serif

| File to save as | Search on Google Fonts |
|---|---|
| `EBGaramond-Regular.ttf` | EB Garamond |
| `Cormorant-Regular.ttf` | Cormorant Garamond |
| `PlayfairDisplay-Regular.ttf` | Playfair Display |
| `CrimsonText-Regular.ttf` | Crimson Text |
| `Philosopher-Regular.ttf` | Philosopher |
| `Lora-Regular.ttf` | Lora |

## Sans

| File to save as | Search on Google Fonts |
|---|---|
| `Outfit-Regular.ttf` | Outfit |
| `Raleway-Regular.ttf` | Raleway |
| `JosefinSans-Regular.ttf` | Josefin Sans |
| `Inter_18pt-Regular.ttf` | Inter |

## Display

| File to save as | Search on Google Fonts |
|---|---|
| `Cinzel-Regular.ttf` | Cinzel |
| `CinzelDecorative-Regular.ttf` | Cinzel Decorative |
| `UncialAntiqua-Regular.ttf` | Uncial Antiqua |

## Mono

| File to save as | Search on Google Fonts |
|---|---|
| `JetBrainsMono-Regular.ttf` | JetBrains Mono |
| `SpaceMono-Regular.ttf` | Space Mono |
