# Extra Caddy sites

`../Caddyfile` ends with `import sites/*.caddy`, so every `*.caddy` file here is a site
block Caddy serves next to the two hydromart-digital sites. Nothing else in this folder is
read.

- One file per site. The first is `aiweb.caddy` (Plan Eksekusi HD-9).
- The upstream is reached over the `edge` network, never this project's default network.
- A file here may `import hsts`, the snippet defined at the top of `../Caddyfile`.
- A release that changes anything under `infra/caddy/` reloads Caddy (`scripts/deploy.sh`).
  `caddy reload` validates first; a file that does not validate leaves the old config
  serving and raises an alert.
