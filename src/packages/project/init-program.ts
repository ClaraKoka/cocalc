/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

// parses command line arguments -- https://github.com/visionmedia/commander.js/
import { program } from "commander";

import { BLOBSTORE } from "@cocalc/backend/data";

interface Options {
  hubPort: number;
  browserPort: number;
  hostname: string;
  kucalc: boolean;
  testFirewall: boolean;
  daemon: boolean;
  sshd: boolean;
  init: string;
  blobstore: typeof BLOBSTORE;
}

const DEFAULTS: Options = {
  hubPort: 0,
  browserPort: 0,
  hostname: "127.0.0.1",
  testFirewall: false,
  kucalc: false,
  daemon: false,
  sshd: false,
  init: "",
  blobstore: BLOBSTORE,
};

program
  .name("cocalc-project")
  .usage("[?] [options]")
  .option(
    "--hub-port <n>",
    "TCP server port to listen on (default: 0 = random OS assigned); hub connects to this",
    (n) => parseInt(n),
    DEFAULTS.hubPort
  )
  .option(
    "--browser-port <n>",
    "HTTP server port to listen on (default: 0 = random OS assigned); browser clients connect to this",
    (n) => parseInt(n),
    DEFAULTS.browserPort
  )
  .option(
    "--hostname [string]",
    'hostname of interface to bind to (default: "127.0.0.1")',
    DEFAULTS.hostname
  )
  .option("--kucalc", "Running in the kucalc environment")
  .option(
    "--sshd",
    "Start the SSH daemon (setup script and configuration must be present)"
  )
  .option(
    "--init [string]",
    "Runs the given script via bash and redirects output to .log and .err files."
  )
  .option(
    "--test-firewall",
    "Abort and exit w/ code 99 if internal GCE information *is* accessible"
  )
  .option("--blobstore [string]", "Blobstore type (sqlite or disk)")
  .option("--daemon", "Run as a daemon")
  .parse(process.argv);

function init(): Options {
  const opts = program.opts();
  for (const key in opts) {
    DEFAULTS[key] = opts[key];
  }
  return DEFAULTS;
}

const OPTIONS = init();

export function getOptions() {
  return OPTIONS;
}
