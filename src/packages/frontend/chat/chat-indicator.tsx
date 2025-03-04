/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

// TODO: for a frame tree it really only makes sense for this button
// to always show the chat.  For sagews and old stuff it should hide
// and show it.  But it's very hard to know from here which doc type
// this is... so for now it still sort of toggles.  For now things
// do work properly via a hack in close_chat in project_actions.

import { Button, Tooltip } from "antd";
import { debounce } from "lodash";
import { filename_extension } from "@cocalc/util/misc";
import { useMemo } from "react";
import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components/icon";
import { UsersViewing } from "@cocalc/frontend/account/avatar/users-viewing";
import { HiddenXS } from "@cocalc/frontend/components";
import track from "@cocalc/frontend/user-tracking";

export type ChatState =
  | "" // not opened (also undefined counts as not open)
  | "internal" // chat is open and managed internally (via frame tree)
  | "external" // chat is open and managed externally (e.g., legacy sage worksheet)
  | "pending"; // chat should be opened when the file itself is actually initialized.

const CHAT_INDICATOR_STYLE: React.CSSProperties = {
  fontSize: "15pt",
  paddingTop: "3px",
  cursor: "pointer",
};

const USERS_VIEWING_STYLE: React.CSSProperties = {
  maxWidth: "120px",
  marginRight: "5px",
};

interface Props {
  project_id: string;
  path: string;
  chatState?: ChatState;
}

export function ChatIndicator({ project_id, path, chatState }: Props) {
  const style: React.CSSProperties = {
    ...CHAT_INDICATOR_STYLE,
    ...{ display: "flex" },
  };
  return (
    <div style={style}>
      <UsersViewing
        project_id={project_id}
        path={path}
        style={USERS_VIEWING_STYLE}
      />
      <ChatButton project_id={project_id} path={path} chatState={chatState} />
    </div>
  );
}

function ChatButton({ project_id, path, chatState }) {
  const toggleChat = debounce(
    () => {
      const actions = redux.getProjectActions(project_id);
      if (chatState) {
        track("close-chat", { project_id, path, how: "chat-button" });
        actions.close_chat({ path });
      } else {
        track("open-chat", { project_id, path, how: "chat-button" });
        actions.open_chat({ path });
      }
    },
    1000,
    { leading: true }
  );
  const fileUse = useTypedRedux("file_use", "file_use");
  const isNewChat = useMemo(
    () =>
      !!redux.getStore("file_use")?.get_file_info(project_id, path)
        ?.is_unseenchat,
    [fileUse, project_id, path]
  );

  if (filename_extension(path) === "sage-chat") {
    // Special case: do not show side chat for chatrooms
    return null;
  }

  return (
    <Tooltip
      title={
        <span>
          <Icon name="comment" style={{ marginRight: "5px" }} />
          Hide or Show Document Chat
        </span>
      }
      placement={"leftTop"}
      mouseEnterDelay={0.5}
    >
      <Button
        danger={isNewChat}
        className={isNewChat ? "smc-chat-notification" : undefined}
        onClick={toggleChat}
      >
        <Icon name="comment" />
        <HiddenXS>
          <span style={{ marginLeft: "5px" }}>Chat</span>
        </HiddenXS>
      </Button>
    </Tooltip>
  );
}
