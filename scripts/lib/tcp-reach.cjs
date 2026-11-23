// HD-9: what happens when THIS container opens a TCP connection to each host:port given. Run
// inside the AI web's container by the isolation probe in scripts/aiweb-deploy.sh, the way
// ask-the-box runs zenziva-balance.cjs:
//
//   docker exec -i <container> node - db:5432 postgres:5432 172.18.0.4:5432 < scripts/lib/tcp-reach.cjs
//
// One line per target, in any order:  "<outcome> <target> <code>", the outcome one of
//   open         the connection was made
//   refused      an RST came back (ECONNREFUSED): the address answers, only the port is shut
//   timeout      nothing came back in time: Docker isolates networks by dropping packets
//   unreachable  EHOSTUNREACH / ENETUNREACH: no route to it
//   not-found    the name does not resolve (ENOTFOUND / EAI_AGAIN)
//   error        anything else, with its code
// It only reports what it saw; the probe decides what each outcome means for each target.
// Every target gets an answer, and nothing here throws.
'use strict';
const net = require('node:net');

const TIMEOUT_MS = 3000;
const OUTCOME = {
  ECONNREFUSED: 'refused',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  ENOTFOUND: 'not-found',
  EAI_AGAIN: 'not-found',
};

function reach(target) {
  const at = target.lastIndexOf(':');
  const host = target.slice(0, at);
  const port = Number(target.slice(at + 1));
  return new Promise((resolve) => {
    if (at < 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(`error ${target} not-host:port`);
      return;
    }
    const socket = net.connect({ host, port });
    const end = (line) => {
      socket.destroy();
      resolve(line);
    };
    socket.setTimeout(TIMEOUT_MS, () => end(`timeout ${target} ETIMEDOUT`));
    socket.once('connect', () => end(`open ${target} connected`));
    socket.once('error', (error) => {
      const code = error.code || 'error';
      end(`${OUTCOME[code] || 'error'} ${target} ${code}`);
    });
  });
}

Promise.all(process.argv.slice(2).map(reach)).then((lines) => {
  process.stdout.write(lines.map((line) => `${line}\n`).join(''));
});
