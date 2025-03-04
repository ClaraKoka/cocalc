/*
Handle a general message from the hub.  These are the generic message,
as opposed to the messages specific to "client" functionality such as
database queries.
*/

import { getLogger } from "@cocalc/project/logger";
import { Message } from "./types";
import * as message from "@cocalc/util/message";
import handleNamedServer from "@cocalc/project/named-servers";
import { exec_shell_code } from "@cocalc/project/exec_shell_code";
// Reading and writing files to/from project and sending over socket
const {
  read_file_from_project,
  write_file_to_project,
} = require("@cocalc/project/read_write_files");
const { print_to_pdf } = require("@cocalc/project/print_to_pdf");
import processKill from "@cocalc/backend/misc/process-kill";
const { handle_save_blob_message } = require("@cocalc/project/blobs");
const client = require("@cocalc/project/client");
import { version } from "@cocalc/util/smc-version";
import writeTextFileToProject from "./write-text-file-to-project";
import jupyterExecute from "@cocalc/project/jupyter/stateless-api/execute";
import { get_kernel_data } from "@cocalc/project/jupyter/kernel-data";
import { project_id } from "@cocalc/project/data";

const winston = getLogger("handle-message-from-hub");

export default async function handleMessage(socket, mesg: Message) {
  winston.debug("received a message", {
    event: mesg.event,
    id: mesg.id,
    "...": "...",
  });
  // We can't just log this in general, since it can be big.
  // So only uncomment this for low level debugging, unfortunately.
  // winston.debug("received ", mesg);

  if (client.client?.handle_mesg(mesg, socket)) {
    return;
  }

  switch (mesg.event) {
    case "heartbeat":
      winston.debug(`received heartbeat on socket '${socket.id}'`);
      // Update the last hearbeat timestamp, so we know socket is working.
      socket.heartbeat = new Date();
      return;

    case "ping":
      // ping message is used only for debugging purposes.
      socket.write_mesg("json", message.pong({ id: mesg.id }));
      return;

    case "named_server_port":
      handleNamedServer(socket, mesg);
      return;

    case "project_exec":
      // this is no longer used by web browser clients; however it *is* used by the HTTP api served
      // by the hub to api key users, so do NOT remove it!
      // The web browser clients use the websocket api,
      exec_shell_code(socket, mesg);
      return;

    case "jupyter_execute":
      try {
        await jupyterExecute(socket, mesg);
      } catch (err) {
        socket.write_mesg(
          "json",
          message.error({
            id: mesg.id,
            error: `${err}`,
          })
        );
      }
      return;

    case "jupyter_kernels":
      try {
        socket.write_mesg(
          "json",
          message.jupyter_kernels({
            kernels: await get_kernel_data(),
            id: mesg.id,
          })
        );
      } catch (err) {
        socket.write_mesg(
          "json",
          message.error({
            id: mesg.id,
            error: `${err}`,
          })
        );
      }
      return;

    case "read_file_from_project":
      read_file_from_project(socket, mesg);
      return;

    case "write_file_to_project":
      write_file_to_project(socket, mesg);
      return;

    case "write_text_file_to_project":
      writeTextFileToProject(socket, mesg);
      return;

    case "print_to_pdf":
      print_to_pdf(socket, mesg);
      return;

    case "send_signal":
      if (
        mesg.pid &&
        (mesg.signal == 2 || mesg.signal == 3 || mesg.signal == 9)
      ) {
        processKill(mesg.pid, mesg.signal);
      } else {
        if (mesg.id) {
          socket.write_mesg(
            "json",
            message.error({
              id: mesg.id,
              error: "invalid pid or signal (must be 2,3,9)",
            })
          );
        }
        return;
      }
      if (mesg.id != null) {
        // send back confirmation that a signal was sent
        socket.write_mesg("json", message.signal_sent({ id: mesg.id }));
      }
      return;

    case "save_blob":
      handle_save_blob_message(mesg);
      return;

    case "error":
      winston.error(`ERROR from hub: ${mesg.error}`);
      return;

    case "hello":
      // No action -- this is used by the hub to send an initial control message that has no effect, so that
      // we know this socket will be used for control messages.
      winston.info(`hello from hub -- sending back our version = ${version}`);
      socket.write_mesg("json", message.version({ version }));
      return;
    default:
      if (mesg.id != null) {
        // only respond with error if there is an id -- otherwise response has no meaning to hub.
        const err = message.error({
          id: mesg.id,
          error: `Project ${project_id} does not implement handling mesg with event='${mesg.event}'`,
        });
        socket.write_mesg("json", err);
      } else {
        winston.debug(`Dropping unknown message with event='${mesg.event}'`);
      }
  }
}
