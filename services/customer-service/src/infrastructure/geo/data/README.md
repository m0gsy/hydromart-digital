# Region boundaries (`../regions.json`)

Used by `RegionLookup` to turn an address pin into BPS kecamatan / kelurahan codes (HD-20a).

Attribution: Batas wilayah: Badan Pusat Statistik (BPS) via OCHA ROAP / HDX, CC BY-IGO.
Source: HDX COD-AB Indonesia, https://data.humdata.org/dataset/cod-ab-idn (BPS 2020 boundaries,
licence CC BY-IGO, https://creativecommons.org/licenses/by/3.0/igo/).

Changes made to the original (the licence requires saying so): filtered to provinces 31 (DKI Jakarta),
32 (Jawa Barat) and 36 (Banten); only ADM3 (kecamatan) and ADM4 (kelurahan/desa) kept, with code
(pcode without the "ID" prefix), name and parent code; every ring simplified (Douglas-Peucker,
0.0003 degrees, about 33 m) and rounded to 4 decimals (about 11 m). Edges are therefore only accurate
to a few tens of metres, and two neighbours can overlap or leave a gap of that width.

Rebuild: `node scripts/build-region-asset.mjs <idn_admin_boundaries.geojson.zip> <new empty work dir>`.
