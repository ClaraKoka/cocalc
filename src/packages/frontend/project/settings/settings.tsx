/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { Alert as AntdAlert } from "antd";
import {
  redux,
  rclass,
  rtypes,
  project_redux_name,
} from "@cocalc/frontend/app-framework";
import { ErrorDisplay, Loading } from "@cocalc/frontend/components";
import {
  Customer,
  ProjectMap,
  StripeCustomer,
  UserMap,
} from "@cocalc/frontend/todo-types";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import * as misc from "@cocalc/util/misc";
import { SCHEMA } from "@cocalc/util/schema";
import React from "react";
import { Body } from "./body";

const { Alert } = require("react-bootstrap");

interface ReactProps {
  project_id: string;
  group?: string;
  name: string;
}

interface ReduxProps {
  project_map?: ProjectMap;
  user_map?: UserMap;
  // NOT used directly -- instead, the QuotaConsole component depends on this in that it calls something in the account store!
  stripe_customer?: StripeCustomer;
  email_address?: string;
  user_type?: string; // needed for projects get_my_group call in render
  account_id?: string;

  customer?: Customer;
}

interface State {
  admin_project?: string;
}

export function ProjectSettings({ project_id }) {
  return (
    <ProjectSettings0
      project_id={project_id}
      name={project_redux_name(project_id)}
      group={redux.getStore("projects").get_my_group(project_id)}
    />
  );
}

const ProjectSettings0 = rclass<ReactProps>(
  class ProjectSettings1 extends React.Component<
    ReactProps & ReduxProps,
    State
  > {
    private _table;
    private _admin_project?: string;

    public static reduxProps() {
      return {
        projects: {
          project_map: rtypes.immutable,
        }, // SMELL isRequired doesn't seem to work here
        users: {
          user_map: rtypes.immutable,
        },
        account: {
          // NOT used directly -- instead, the QuotaConsole component depends on this in that it calls something in the account store!
          stripe_customer: rtypes.immutable,
          email_address: rtypes.string,
          user_type: rtypes.string, // needed for projects get_my_group call in render
          account_id: rtypes.string,
        },
        billing: {
          customer: rtypes.immutable,
        }, // similar to stripe_customer
      };
    }

    constructor(props) {
      super(props);
      this.state = { admin_project: undefined }; // used in case visitor to project is admin
    }

    componentWillUnmount() {
      delete this._admin_project;
      this._table?.close(); // stop listening for changes
    }

    init_admin_view() {
      // try to load it directly for future use
      this._admin_project = "loading";
      const query = {};
      for (const k of misc.keys(SCHEMA.projects.user_query?.get?.fields)) {
        // Do **not** change the null here to undefined, which means something
        // completely different. See
        // https://github.com/sagemathinc/cocalc/issues/4137
        query[k] = k === "project_id" ? this.props.project_id : null;
      }
      this._table = webapp_client.sync_client.sync_table(
        { projects_admin: query },
        []
      );
      this._table.on("change", () => {
        this.setState({
          admin_project: this._table.get(this.props.project_id),
        });
      });
    }

    render_admin_message() {
      return (
        <Alert bsStyle="warning" style={{ margin: "10px" }}>
          <h4>
            <strong>Warning:</strong> you are editing the project settings as an{" "}
            <strong>administrator</strong>.
          </h4>
          <ul>
            <li>
              {" "}
              You are not a collaborator on this project, but can edit files,
              etc.{" "}
            </li>
            <li>
              {" "}
              You are an admin: actions will not be logged to the project log.
            </li>
          </ul>
        </Alert>
      );
    }

    render() {
      if (
        this.props.project_map == undefined ||
        this.props.user_map == undefined
      ) {
        return <Loading />;
      }
      let project = this.props.project_map.get(this.props.project_id);
      if (
        this.props.group != "admin" &&
        this.props.group != "owner" &&
        project?.get("sandbox")
      ) {
        return (
          <AntdAlert
            showIcon
            style={{ margin: "auto", fontSize: "14pt" }}
            type="warning"
            message="Sandboxed Project"
            description={
              <div style={{ maxWidth: "700px" }}>
                Settings are disabled for non-owners of sandboxed projects.
                <br />
                <br />
                You will automatically be removed as a collaborator of this
                project when you stop actively using it.
                <br />
                <br />
                You can easily make your own new private project by clicking on
                the "Projects" button then "Create new project". Copy any files
                to it from the Files tab here.
              </div>
            }
          />
        );
      }
      if (this.props.group === "admin") {
        project = this.state.admin_project;
        if (
          this._admin_project != undefined &&
          this._admin_project !== "loading"
        ) {
          return <ErrorDisplay error={this._admin_project} />;
        }
        if (project == undefined && this._admin_project == undefined) {
          this.init_admin_view();
        }
      }

      if (project == undefined) {
        return <Loading />;
      } else {
        return (
          <div style={{ padding: "15px" }}>
            {this.state.admin_project != undefined
              ? this.render_admin_message()
              : undefined}
            <Body
              project_id={this.props.project_id}
              account_id={this.props.account_id}
              project={project}
              user_map={this.props.user_map}
              customer={this.props.customer}
              email_address={this.props.email_address}
              project_map={this.props.project_map}
              name={this.props.name}
            />
          </div>
        );
      }
    }
  }
);
