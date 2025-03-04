/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

// Show a file listing.

import React, { useEffect, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import useVirtuosoScrollHook from "@cocalc/frontend/components/virtuoso-scroll-hook";
import * as immutable from "immutable";
import { useInterval } from "react-interval-hook";
import { WATCH_THROTTLE_MS } from "@cocalc/frontend/project/websocket/listings";
import { ProjectActions } from "@cocalc/frontend/project_actions";
import {
  AppRedux,
  Rendered,
  TypedMap,
  usePrevious,
} from "@cocalc/frontend/app-framework";
import { MainConfiguration } from "@cocalc/frontend/project_configuration";
import NoFiles from "./no-files";
import { TerminalModeDisplay } from "./terminal-mode-display";
import { ListingHeader } from "./listing-header";
import { FileRow } from "./file-row";
import { TERM_MODE_CHAR } from "./utils";

import * as misc from "@cocalc/util/misc";
const { Col, Row } = require("react-bootstrap");

interface Props {
  // TODO: everything but actions/redux should be immutable JS data, and use shouldComponentUpdate
  actions: ProjectActions;
  redux: AppRedux;

  name: string;
  active_file_sort: TypedMap<{ column_name: string; is_descending: boolean }>;
  listing: any[];
  file_map: object;
  file_search: string;
  checked_files: immutable.Set<string>;
  current_path: string;
  create_folder: (switch_over?: boolean) => void; // TODO: should be action!
  create_file: (ext?: string, switch_over?: boolean) => void; // TODO: should be action!
  selected_file_index?: number;
  project_id: string;
  shift_is_down: boolean;
  sort_by: (heading: string) => void; // TODO: should be data
  library?: object;
  other_settings?: immutable.Map<any, any>;
  last_scroll_top?: number;
  configuration_main?: MainConfiguration;
  isRunning?: boolean; // true if this project is running
}

export const FileListing: React.FC<Props> = (props: Props) => {
  const {
    actions,
    redux,
    name,
    active_file_sort,
    listing,
    file_map,
    checked_files,
    current_path,
    create_folder,
    create_file,
    selected_file_index,
    project_id,
    shift_is_down,
    sort_by,
    configuration_main,
    file_search = "",
    isRunning,
  } = props;

  const prev_current_path = usePrevious(current_path);

  // once after mounting, when changing paths, and in regular intervals call watch()
  useEffect(() => {
    watch();
  }, []);
  useEffect(() => {
    if (current_path != prev_current_path) watch();
  }, [current_path, prev_current_path]);
  useInterval(watch, WATCH_THROTTLE_MS);

  function watch(): void {
    const store = actions.get_store();
    if (store == null) return;
    try {
      store.get_listings().watch(current_path);
    } catch (err) {
      console.warn("ERROR watching directory", err);
    }
  }

  function render_row(
    name,
    size,
    time,
    mask,
    isdir,
    display_name,
    public_data,
    issymlink,
    index: number,
    link_target?: string // if given, is a known symlink to this file
  ): Rendered {
    const checked = checked_files.has(misc.path_to_file(current_path, name));
    const color = misc.rowBackground({ index, checked });
    const { is_public } = file_map[name];

    return (
      <FileRow
        isdir={isdir}
        name={name}
        display_name={display_name}
        time={time}
        size={size}
        issymlink={issymlink}
        color={color}
        selected={
          index == selected_file_index && file_search[0] != TERM_MODE_CHAR
        }
        mask={mask}
        public_data={public_data}
        is_public={is_public}
        checked={checked}
        key={index}
        current_path={current_path}
        actions={actions}
        no_select={shift_is_down}
        link_target={link_target}
      />
    );
  }

  const virtuosoScroll = useVirtuosoScrollHook({
    cacheId: name + current_path,
  });
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (selected_file_index == null) return;
    virtuosoRef.current?.scrollIntoView({ index: selected_file_index });
  }, [selected_file_index]);

  function render_rows(): Rendered {
    return (
      <Virtuoso
        ref={virtuosoRef}
        increaseViewportBy={10}
        totalCount={listing.length}
        itemContent={(index) => {
          const a = listing[index];
          if (a == null) {
            // shouldn't happen
            return <div key={index} style={{ height: "1px" }}></div>;
          }
          return render_row(
            a.name,
            a.size,
            a.mtime,
            a.mask,
            a.isdir,
            a.display_name,
            a.public,
            a.issymlink,
            index,
            a.link_target
          );
        }}
        {...virtuosoScroll}
      />
    );
  }

  function render_no_files() {
    if (listing.length !== 0) {
      return;
    }
    if (file_search[0] === TERM_MODE_CHAR) {
      return;
    }

    return (
      <NoFiles
        name={name}
        current_path={current_path}
        actions={actions}
        file_search={file_search}
        create_folder={create_folder}
        create_file={create_file}
        project_id={project_id}
        configuration_main={configuration_main}
      />
    );
  }

  function render_terminal_mode(): Rendered {
    if (file_search[0] === TERM_MODE_CHAR) {
      return <TerminalModeDisplay />;
    }
  }

  return (
    <>
      {!isRunning && listing.length > 0 && (
        <div
          style={{ textAlign: "center", marginBottom: "5px", fontSize: "12pt" }}
        >
          To update the directory listing,{" "}
          <a
            onClick={() => {
              redux.getActions("projects").start_project(project_id);
            }}
          >
            start this project
          </a>
          .
        </div>
      )}
      <Col
        sm={12}
        className="smc-vfill"
        style={{
          flex: "1 0 auto",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {render_terminal_mode()}
        {listing.length > 0 && (
          <ListingHeader
            active_file_sort={active_file_sort}
            sort_by={sort_by}
          />
        )}
        {listing.length > 0 && <Row className="smc-vfill">{render_rows()}</Row>}
        {render_no_files()}
      </Col>
    </>
  );
};
