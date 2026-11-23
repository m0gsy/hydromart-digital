// HD-9: can THIS container open a TCP connection to each host:port given? Run inside the AI
// web's container by the isolation probe in scripts/aiweb-deploy.sh, the way ask-the-box runs
// zenziva-balance.cjs:
//
//   docker exec -i <container> node - db:5432 postgres:5432 172.18.0.4:5432 < scripts/lib/tcp-reach.cjs
//
// One line per target, in any order:  "open <target>"  or  "closed <target> <reason>".
// Every target gets an answer, and nothing here throws: a name that does not resolve, a refusal
// and a dropped packet (Docker isolates networks by dropping, so that one is a timeout) are all
// "closed". It only says what it saw; the probe decides what was supposed to be open.
'use strict';
const net = require('node:net');

const TIMEOUT_MS = 3000;

function reach(target) {
  const at = target.lastIndexOf(':');
  const host = target.slice(0, at);
  const port = Number(target.slice(at + 1));
  return new Promise((resolve) => {
    if (at < 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(`closed ${target} not-host:port`);
      return;
    }
    const socket = net.connect({ host, port });
    const end = (line) => {
      socket.destroy();
      resolve(line);
    };
    socket.setTimeout(TIMEOUT_MS, () => end(`closed ${target} timeout`));
    socket.once('connect', () => end(`open ${target}`));
    socket.once('error', (error) => end(`closed ${target} ${error.code || 'error'}`));
  });
}

Promise.all(process.argv.slice(2).map(reach)).then((lines) => {
  process.stdout.write(lines.map((line) => `${line}\n`).join(''));
});
