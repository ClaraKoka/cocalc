//########################################################################
// This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
// License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
//########################################################################

// Execute code in a subprocess.

import getLogger from "@cocalc/backend/logger";
import { callback } from "awaiting";
import { chmod, rm, writeFile } from "fs/promises";
import { spawn } from "child_process";
import shellEscape from "shell-escape";
import { aggregate } from "@cocalc/util/aggregate";
import { to_json, trunc, walltime } from "@cocalc/util/misc";
import { callback_opts } from "@cocalc/util/async-utils";

const log = getLogger("execute-code");

export interface ExecuteCodeOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface ExecuteCodeOptions {
  command: string;
  args?: string[];
  path?: string; // defaults to home directory; where code is executed from
  timeout?: number; // timeout in *seconds*
  ulimit_timeout?: boolean; // If set (the default), use ulimit to ensure a cpu timeout -- don't use when launching a daemon!
  // This has no effect if bash not true.
  err_on_exit?: boolean; // if true (the default), then a nonzero exit code will result in an error; if false, even with a nonzero exit code you just get back the stdout, stderr and the exit code as usual.
  max_output?: number; // bound on size of stdout and stderr; further output ignored
  bash?: boolean; // if true, ignore args and evaluate command as a bash command
  home?: string;
  uid?: number;
  gid?: number;
  env?: object; // if given, added to exec environment
  aggregate?: string | number; // if given, aggregates multiple calls with same sequence number into one -- see @cocalc/util/aggregate; typically make this a timestamp for compiling code (e.g., latex).
  verbose?: boolean; // default true -- impacts amount of logging
}

export interface ExecuteCodeOptionsWithCallback extends ExecuteCodeOptions {
  cb?: (err: undefined | Error, output?: ExecuteCodeOutput) => void;
}

type ExecuteCodeFunctionWithCallback = (opts: ExecuteCodeOptions) => void;

// Async/await interface to executing code.
export async function executeCode(
  opts: ExecuteCodeOptions
): Promise<ExecuteCodeOutput> {
  return await callback_opts(execute_code)(opts);
}

// Callback interface to executing code.
// This will get deprecated and is only used by some old coffeescript code.
export const execute_code: ExecuteCodeFunctionWithCallback = aggregate(
  (opts: ExecuteCodeOptionsWithCallback) => {
    (async () => {
      try {
        opts.cb?.(undefined, await executeCodeNoAggregate(opts));
      } catch (err) {
        opts.cb?.(err);
      }
    })();
  }
);

// actual implementation, without the aggregate wrapper
async function executeCodeNoAggregate(
  opts: ExecuteCodeOptions
): Promise<ExecuteCodeOutput> {
  if (opts.args == null) opts.args = [];
  if (opts.timeout == null) opts.timeout = 10;
  if (opts.ulimit_timeout == null) opts.ulimit_timeout = true;
  if (opts.err_on_exit == null) opts.err_on_exit = true;
  if (opts.verbose == null) opts.verbose = true;

  if (opts.verbose) {
    log.debug(`execute_code: \"${opts.command} ${opts.args?.join(" ")}\"`);
  }

  const s = opts.command.split(/\s+/g); // split on whitespace
  if (opts.args?.length === 0 && s.length > 1) {
    opts.bash = true;
  } else if (opts.bash && opts.args?.length > 0) {
    // Selected bash, but still passed in args.
    opts.command = shellEscape([opts.command].concat(opts.args));
    opts.args = [];
  }

  if (opts.home == null) {
    opts.home = process.env.HOME;
  }

  if (opts.path == null) {
    opts.path = opts.home;
  } else if (opts.path[0] !== "/") {
    opts.path = opts.home + "/" + opts.path;
  }

  let tempPath: string | undefined = undefined;

  try {
    if (opts.bash) {
      // using bash, which (for better or worse), we do by writing the command to run
      // under bash to a file, then executing that file.
      let cmd: string;
      if (opts.timeout && opts.ulimit_timeout) {
        // This ensures that everything involved with this
        // command really does die no matter what; it's
        // better than killing from outside, since it gets
        // all subprocesses since they inherit the limits.
        // Leave it to the OS.
        cmd = `ulimit -t ${opts.timeout}\n${opts.command}`;
      } else {
        cmd = opts.command;
      }

      if (opts.verbose) {
        log.debug(
          "execute_code: writing temporary file that contains bash program."
        );
      }
      // We write the cmd to a file, and replace the command and args
      // with bash and the filename, then do everything below as we would
      // have done anyways.
      opts.command = "bash";
      // We use this type of import because tempy is a pure ESM package,
      // and some stuff in the hub testing breaks otherwise.
      tempPath = (await import("tempy")).temporaryFile({ extension: ".sh" });
      opts.args = [tempPath];
      await writeFile(tempPath, cmd);
      await chmod(tempPath, 0o700);
    }
    return await callback(doSpawn, opts);
  } finally {
    // clean up
    if (tempPath) {
      await rm(tempPath, { force: true });
    }
  }
}
/*
    (err) => {
      if (!opts.err_on_exit && ran_code) {
        // as long as we made it to running some code, we consider this a
        // success (that is what err_on_exit means).
        opts.cb?.(undefined, { stdout, stderr, exit_code });
      } else {
        opts.cb?.(err, { stdout, stderr, exit_code });
      }
    }
  );
  }
}
*/

function doSpawn(opts, cb) {
  const start_time = walltime();

  if (opts.verbose) {
    log.debug(
      `Spawning the command ${opts.command} with given args ${opts.args} and timeout of ${opts.timeout}s...`
    );
  }
  const spawnOptions = {
    cwd: opts.path,
    ...(opts.uid ? { uid: opts.uid } : undefined),
    ...(opts.gid ? { uid: opts.gid } : undefined),
    env: {
      ...process.env,
      ...opts.env,
      ...(opts.uid != null && opts.home ? { HOME: opts.home } : undefined),
    },
  };

  let r,
    ran_code = false;
  try {
    r = spawn(opts.command, opts.args, spawnOptions);
    if (r.stdout == null || r.stderr == null) {
      // The docs/examples at https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options
      // suggest that r.stdout and r.stderr are always defined.  However, this is
      // definitely NOT the case in edge cases, as we have observed.
      cb("error creating child process -- couldn't spawn child process");
      return;
    }
  } catch (error) {
    // Yes, spawn can cause this error if there is no memory, and there's no
    // event! --  Error: spawn ENOMEM
    ran_code = false;
    cb(`error ${error}`);
    return;
  }

  ran_code = true;

  if (opts.verbose) {
    log.debug("Listen for stdout, stderr and exit events.");
  }
  let stdout = "";
  let stderr = "";
  let exit_code: undefined | number = undefined;

  r.stdout.on("data", function (data) {
    data = data.toString();
    if (opts.max_output != null) {
      if (stdout.length < opts.max_output) {
        stdout += data.slice(0, opts.max_output - stdout.length);
      }
    } else {
      stdout += data;
    }
  });

  r.stderr.on("data", function (data) {
    data = data.toString();
    if (opts.max_output != null) {
      if (stderr.length < opts.max_output) {
        stderr += data.slice(0, opts.max_output - stderr.length);
      }
    } else {
      stderr += data;
    }
  });

  let stderr_is_done = false;
  let stdout_is_done = false;
  let killed = false;

  r.stderr.on("end", () => {
    stderr_is_done = true;
    finish();
  });

  r.stdout.on("end", () => {
    stdout_is_done = true;
    finish();
  });

  r.on("exit", (code) => {
    exit_code = code;
    finish();
  });

  // This can happen, e.g., "Error: spawn ENOMEM" if there is no memory.  Without this handler,
  // an unhandled exception gets raised, which is nasty.
  // From docs: "Note that the exit-event may or may not fire after an error has occurred. "
  r.on("error", function (err) {
    if (exit_code == null) {
      exit_code = 1;
    }
    stderr += to_json(err);
    // a fundamental issue, we were not running some code
    ran_code = false;
    finish();
  });

  let callback_done = false;
  function finish() {
    if (!killed && (!stdout_is_done || !stderr_is_done || exit_code == null)) {
      // it wasn't killed and one of stdout, stderr, and exit_code hasn't been
      // set, so we let the rest of them get set before actually finishing up.
      return;
    }
    if (callback_done) {
      // we already finished up.
      return;
    }
    // finally finish up.
    callback_done = true;
    if (opts.verbose) {
      log.debug(
        `finished exec of ${opts.command} (took ${walltime(start_time)}s)`
      );
      log.debug(
        `stdout='${trunc(stdout, 512)}', stderr='${trunc(
          stderr,
          512
        )}', exit_code=${exit_code}`
      );
    }
    if (opts.err_on_exit && exit_code != 0) {
      cb(
        `command '${opts.command}' (args=${opts.args?.join(
          " "
        )}) exited with nonzero code ${exit_code} -- stderr='${stderr}'`
      );
    } else if (!ran_code) {
      // regardless of opts.err_on_exit !
      cb(
        `command '${opts.command}' (args=${opts.args?.join(
          " "
        )}) was not able to run -- stderr='${stderr}'`
      );
    } else {
      if (opts.max_output != null) {
        if (stdout.length >= opts.max_output) {
          stdout += ` (truncated at ${opts.max_output} characters)`;
        }
        if (stderr.length >= opts.max_output) {
          stderr += ` (truncated at ${opts.max_output} characters)`;
        }
      }
      if (exit_code == null) {
        // if exit-code not set, may have been SIGKILL so we set it to 1
        exit_code = 1;
      }
      cb(undefined, { stdout, stderr, exit_code });
    }
  }

  if (opts.timeout) {
    // setup a timer that will kill the command after a certain amount of time.
    function f() {
      if (r.exitCode === null) {
        if (opts.verbose) {
          log.debug(
            `execute_code: subprocess did not exit after ${opts.timeout} seconds, so killing with SIGKILL`
          );
        }
        try {
          killed = true;
          r.kill("SIGKILL"); // this does not kill the process group :-(
        } catch (e) {
          // Exceptions can happen, which left uncaught messes up calling code bigtime.
          if (opts.verbose) {
            log.debug("execute_code: r.kill raised an exception.");
          }
        }
        if (!callback_done) {
          callback_done = true;
          cb(`killed command '${opts.command} ${opts.args?.join(" ")}'`);
        }
      }
    }
    setTimeout(f, opts.timeout * 1000);
  }
}
