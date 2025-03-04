/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import {
  Button,
  ButtonGroup,
  ButtonToolbar,
} from "@cocalc/frontend/antd-bootstrap";
import { HiddenSM, Icon, Tip, VisibleLG } from "@cocalc/frontend/components";
import LinkRetry from "@cocalc/frontend/components/link-retry";
import { useStudentProjectFunctionality } from "@cocalc/frontend/course";
import { Available } from "@cocalc/frontend/project_configuration";
import { ProjectActions } from "@cocalc/frontend/project_store";
import { join } from "path";
import React from "react";
import { serverURL, SPEC } from "../named-server-panel";
import track from "@cocalc/frontend/user-tracking";
import TourButton from "./tour/button";

interface Props {
  actions: ProjectActions;
  available_features?: Available;
  current_path: string;
  kucalc?: string;
  project_id: string;
  show_hidden?: boolean;
  show_masked?: boolean;
}

export const MiscSideButtons: React.FC<Props> = (props) => {
  const {
    actions,
    available_features,
    current_path,
    kucalc,
    project_id,
    show_hidden,
    show_masked,
  } = props;

  const student_project_functionality =
    useStudentProjectFunctionality(project_id);

  const handle_hidden_toggle = (e: React.MouseEvent): void => {
    e.preventDefault();
    return actions.setState({
      show_hidden: !show_hidden,
    });
  };

  const handle_masked_toggle = (e: React.MouseEvent): void => {
    e.preventDefault();
    actions.setState({
      show_masked: !show_masked,
    });
  };

  const handle_backup = (e: React.MouseEvent): void => {
    e.preventDefault();
    actions.open_directory(".snapshots");
    track("snapshots", { action: "open", where: "explorer" });
  };

  function render_hidden_toggle(): JSX.Element {
    const icon = show_hidden ? "eye" : "eye-slash";
    return (
      <Button bsSize="small" onClick={handle_hidden_toggle}>
        <Tip title={"Show hidden files"} placement={"bottom"}>
          <Icon name={icon} />
        </Tip>
      </Button>
    );
  }

  function render_masked_toggle(): JSX.Element {
    return (
      <Button
        onClick={handle_masked_toggle}
        active={!show_masked}
        bsSize={"small"}
      >
        <Tip
          title={"Hide autogenerated/temporary files"}
          placement={"bottomLeft"}
        >
          <Icon name={"mask"} />
        </Tip>
      </Button>
    );
  }

  function render_backup(): JSX.Element | undefined {
    // NOTE -- snapshots aren't available except in "kucalc" version
    // -- they are complicated nontrivial thing that isn't usually setup...
    if (kucalc !== "yes") {
      return;
    }
    return (
      <Button bsSize="small" onClick={handle_backup}>
        <Icon name="life-saver" />{" "}
        <span style={{ fontSize: 12 }} className="hidden-sm">
          Backups
        </span>
      </Button>
    );
  }

  const handle_library_click = (_e: React.MouseEvent): void => {
    track("library", { action: "open" });
    actions.toggle_library();
  };

  function render_library_button(): JSX.Element | undefined {
    // library only exists on kucalc, for now.
    if (!available_features?.library) return;
    if (kucalc !== "yes") return;
    return (
      <Button bsSize={"small"} onClick={handle_library_click}>
        <Icon name="book" /> <HiddenSM>Library</HiddenSM>
      </Button>
    );
  }

  function render_vscode_button(): JSX.Element | undefined {
    if (!available_features) return;
    const { vscode, homeDirectory } = available_features;
    if (!vscode || !homeDirectory) return;
    const abspath = join(homeDirectory, current_path ?? "");
    // setting ?folder= tells VS Code to open that directory
    const url = `${serverURL(project_id, "code")}?folder=${abspath}`;
    return (
      <LinkRetry href={url} mode="button">
        <Tip
          title={`Opens the current directory in a Visual Studio Code IDE server instance, running inside this project. ${SPEC.code.description}`}
          placement="bottom"
        >
          <Icon name={SPEC.code.icon} /> <VisibleLG>VS Code</VisibleLG>
        </Tip>
      </LinkRetry>
    );
  }

  function render_jupyterlab_button(): JSX.Element | undefined {
    if (!available_features) return;
    if (!available_features.jupyter_lab) return;
    // appending /tree/[relative path to home dir]
    const base = serverURL(project_id, "jupyterlab");
    // we make sure the url ends wiht a slash, without messing up the full URL
    const s = base.slice(base.length - 1) === "/" ? "" : "/";
    const url = `${base}${s}lab/tree/${current_path ?? ""}`;
    return (
      <LinkRetry href={url} mode="button">
        <Tip
          title={`Opens the current directory in a JupyterLab server instance, running inside this project. ${SPEC.jupyterlab.description}`}
          placement="bottom"
        >
          <Icon name={SPEC.jupyterlab.icon} /> <VisibleLG>JupyterLab</VisibleLG>
        </Tip>
      </LinkRetry>
    );
  }

  function render_upload_button(): JSX.Element | undefined {
    if (student_project_functionality.disableUploads) {
      return;
    }
    return (
      <Button bsSize="small" className="upload-button">
        <Icon name="upload" /> <HiddenSM>Upload</HiddenSM>
      </Button>
    );
  }

  return (
    <ButtonToolbar
      style={{ whiteSpace: "nowrap", padding: "0" }}
      className="pull-right"
    >
      <ButtonGroup>
        <TourButton project_id={project_id} />
        {render_library_button()}
        {render_upload_button()}
        {render_jupyterlab_button()}
        {render_vscode_button()}
      </ButtonGroup>
      <div className="pull-right">
        <ButtonGroup>
          {render_hidden_toggle()}
          {render_masked_toggle()}
          {render_backup()}
        </ButtonGroup>
      </div>
    </ButtonToolbar>
  );
};
