/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

/*
The main purpose of this component is to provide a big start button that users
use to start this project. When the project is fully up and running this
component is invisible.

It's really more than just that button, since it gives info as starting/stopping
happens, and also when the system is heavily loaded.
*/

import { Alert, Button } from "antd";
import { CSSProperties, useRef } from "react";

import {
  React,
  redux,
  useMemo,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import {
  A,
  Delay,
  Icon,
  ProjectState,
  Space,
  VisibleMDLG,
} from "@cocalc/frontend/components";
import { server_seconds_ago } from "@cocalc/util/misc";
import { COLORS } from "@cocalc/util/theme";
import { useAllowedFreeProjectToRun } from "./client-side-throttle";
import { DOC_TRIAL } from "./project-banner";

interface Props {
  project_id: string;
}

const STYLE: CSSProperties = {
  fontSize: "40px",
  textAlign: "center",
  color: COLORS.GRAY_M,
} as const;

export const StartButton: React.FC<Props> = (props: Props) => {
  const { project_id } = props;
  const project_websockets = useTypedRedux("projects", "project_websockets");
  const connected = project_websockets?.get(project_id) == "online";
  const project_map = useTypedRedux("projects", "project_map");
  const lastNotRunningRef = useRef<null | number>(null);
  const allowed = useAllowedFreeProjectToRun(project_id);

  const state = useMemo(() => {
    const state = project_map?.getIn([project_id, "state"]);
    if (state != null) {
      lastNotRunningRef.current =
        state.get("state") == "running" ? null : Date.now();
    }
    return state;
  }, [project_map]);

  // start_requested is true precisely if a start of this project
  // is currently requested, and obviously didn't get done.
  // Making the UI depend on this instead of *just* the state
  // makes things feel more responsive.
  const starting = useMemo(() => {
    if (state?.get("state") == "starting" || state?.get("state") == "opening")
      return true;
    if (state?.get("state") == "running") return false;
    const action_request = project_map
      ?.getIn([project_id, "action_request"])
      ?.toJS();
    if (action_request == null) {
      return false; // no action request at all
    }
    if (action_request.action != "start") {
      return false; // a non-start action
    }
    if (action_request.finished >= new Date(action_request.time)) {
      return false; // already done
    }
    if (new Date(action_request.time) <= server_seconds_ago(20)) {
      // Something is wrong, and the request got ignored for at least 20s,
      // so allow user to try again.
      return false;
    }

    // action is start and it didn't quite get taken care of yet by backend server,
    // but keep disabled so the user doesn't keep making the request.
    return true;
  }, [project_map]);

  if (state?.get("state") == "running") {
    if (connected) {
      return <></>;
    } else {
      // Show a "Connecting..." banner after a few seconds.
      // We don't show it immediately, since it can appear intermittently
      // for second, which is annoying and not helpful.
      // NOTE: if the project changed to a NOT running state a few seconds ago, then we do
      // show Connecting immediately, since then it's useful and not "flashy".
      const last = lastNotRunningRef.current;
      return (
        <Delay delayMs={last != null && Date.now() - last < 60000 ? 0 : 3000}>
          <Alert
            banner={true}
            type="info"
            style={STYLE}
            showIcon={false}
            message={
              <span
                style={{
                  fontSize: "20pt",
                  color: COLORS.GRAY_M,
                }}
              >
                Connecting... <Icon name="cocalc-ring" spin />
              </span>
            }
          />
        </Delay>
      );
    }
  }

  function render_not_allowed() {
    // only show this warning if we got a clear answer that it is not allowed to run
    if (allowed === false)
      return (
        <VisibleMDLG>
          <Alert
            style={{ margin: "10px 20%" }}
            message={
              <span style={{ fontWeight: 500, fontSize: "14pt" }}>
                Too many trial projects!
              </span>
            }
            type="error"
            description={
              <span style={{ fontSize: "12pt" }}>
                Unfortunately, there are too many{" "}
                <A href={DOC_TRIAL}>trial projects</A> running on CoCalc right
                now and paying customers have priority. Try running your trial
                project later or{" "}
                <a
                  onClick={() => {
                    redux.getActions("page").set_active_tab("account");
                    redux.getActions("account").set_active_tab("licenses");
                  }}
                >
                  <u>upgrade using a license</u>.
                </a>
              </span>
            }
          />
        </VisibleMDLG>
      );
  }

  function render_start_project_button() {
    const enabled =
      state == null ||
      (allowed &&
        ["opened", "closed", "archived"].includes(state?.get("state")));
    return (
      <div>
        <Button
          type="primary"
          size="large"
          disabled={!enabled || starting}
          onClick={() => {
            redux.getActions("projects").start_project(project_id);
          }}
        >
          {starting ? <Icon name="cocalc-ring" spin /> : <Icon name="play" />}
          <Space /> <Space /> Start{starting ? "ing" : ""} project
        </Button>
      </div>
    );
  }

  // In case user is admin viewing another user's project, we provide a
  // special mode.
  function render_admin_view() {
    return (
      <Alert
        banner={true}
        type="error"
        message="Admin Project View"
        description={
          <>
            WARNING: You are viewing this project as an admin! (1) Some things
            won't work. (2) Be <b>VERY careful</b> opening any files, since this
            is a dangerous attack vector.
          </>
        }
      />
    );
  }

  function render_normal_view() {
    return (
      <Alert
        banner={true}
        showIcon={false}
        message={
          <>
            <span
              style={{
                fontSize: "20pt",
                color: COLORS.GRAY_D,
              }}
            >
              <ProjectState state={state} show_desc={allowed} />
            </span>
            {render_start_project_button()}
            {render_not_allowed()}
          </>
        }
        type="info"
      />
    );
  }

  return (
    <div style={STYLE}>
      {state == null && redux.getStore("account")?.get("is_admin")
        ? render_admin_view()
        : render_normal_view()}
    </div>
  );
};
