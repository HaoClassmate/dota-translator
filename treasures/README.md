# Treasure simulator

This is the React treasure-opening app copied from `dota-skin-changer/web`.
The source stays here; the built page and assets live in `../docs/treasures/`
so the Dota Translator site serves it at `/treasures/`.

```powershell
pnpm install
pnpm build
pnpm test
```

The checked-in assets make the site self-contained. To refresh them from a
local export of `dota-skin-changer/web/public/assets`, run:

```powershell
pnpm sync:assets -- C:\path\to\dota-skin-changer\web
```

The import copies only the models, reward art, animation frames, sounds, and
textures used by this app. Models are stored as gzip files; external textures
are high-quality WebP files. Run the source repository's `optimize:models` script
before syncing refreshed exports. Results remain in each visitor's browser storage;
openings do not grant Steam items.
